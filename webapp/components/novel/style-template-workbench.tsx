"use client";

// 借鉴库 · 文风模板工作台。Templates are made here: one form covers all three
// creation paths (name-only AI draft, pasted excerpts, pure custom preference).
// The 文笔文风 page only SELECTS a template made here — it never re-implements
// this editor.

import { useMemo, useState } from "react";
import { Check, Copy, FileText, LoaderCircle, Pencil, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildSampleDigest, importTextAsSamples, parseProfileRules, profileDisplayName, profileRulesToText,
  appendProfileVersion, buildStyleProfile,
  type StyleProfile,
} from "@/lib/style-fidelity";
import { stableHash } from "@/lib/reference-assist";
import type { BookWorkspace, PlotGenerationOptions } from "./book-workspace";
import { applyTemplate, resolveEffectiveStyle } from "@/lib/book-style";
import { StyleFidelityPanel, type FidelityRunResult } from "./style-fidelity-panel";

type Props = {
  bookId: string;
  workspace: BookWorkspace;
  onWorkspaceChange: (patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) => void;
  onGenerate: (prompt: string, task: string, options?: PlotGenerationOptions) => Promise<string>;
  onFidelityRun: (payload: { ruleText: string; profile: StyleProfile | null; sceneRange: "selection" | "chapter" }) => Promise<FidelityRunResult>;
  onNotify: (message: string) => void;
};

const MAX_DRAFT_CHARS = 200000;

function parseJson(content: string): Record<string, unknown> | null {
  try { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>; }
  catch { return null; }
}

export function StyleTemplateWorkbench({ bookId, workspace, onWorkspaceChange, onGenerate, onFidelityRun, onNotify }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [preference, setPreference] = useState("");
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [editingId, setEditingId] = useState("");

  const templates = useMemo(() => Object.values(workspace.styleProfiles).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [workspace.styleProfiles]);
  const effective = resolveEffectiveStyle(workspace.bookStyle, workspace.styleProfiles, workspace.assets.style ?? "");

  function storeProfile(profile: StyleProfile) {
    onWorkspaceChange((w) => ({
      ...w,
      styleProfiles: { ...w.styleProfiles, [profile.id]: profile },
      styleProfileHistory: { ...w.styleProfileHistory, [profile.id]: appendProfileVersion(w.styleProfileHistory[profile.id] ?? [], profile) },
    }));
  }

  function resetForm() { setName(""); setTarget(""); setPreference(""); setRawText(""); setError(""); setNotes([]); }

  function makeBaseProfile(now: string): StyleProfile {
    const targetAuthor = extractAuthor(target);
    const targetWork = extractWork(target);
    const label = name.trim() || target || "自定义文风模板";
    const id = `tpl-${stableHash(`${bookId}|${label}|${now}`)}`;
    return buildStyleProfile({
      bookId, targetId: id, samples: [],
      scope: { author: targetAuthor, work: targetWork, note: label },
      authorRules: preference.trim(),
      now,
    });
  }

  // Creation path 1 & 3: name-only AI draft or pure custom preference. The model
  // really runs and really produces rules; the result is labelled a model-knowledge
  // draft, never as analysed excerpts.
  async function draftFromName(base: StyleProfile): Promise<StyleProfile> {
    const prompt = [
      target.trim() ? `参考对象：${target.trim()}。` : "参考对象：未指定（按作者的表达偏好起草）。",
      preference.trim() ? `作者要求：${preference.trim()}` : "",
      "请基于你对上述对象的公开知识，起草一份中文小说文风模板草稿。只覆盖表达方式：叙述距离与视角习惯、句式与段落节奏、措辞与修饰、对白写法、情绪呈现方式、动作/环境/心理描写的分配、场景切换与信息揭示。每条规则必须可执行，禁止“文笔优美、情节紧凑”这类空话。",
      "明确声明这是基于模型知识的草案：不得编造原作引文、网页来源或统计数据；不得声称已阅读或分析过原文；不得输出相似度或百分比。",
      '只输出 JSON 对象：{"rules":["具体规则", ...],"avoid":["明确不借鉴的内容", ...],"gaps":["无法确认、需要作者补充样段的特点"]}',
    ].filter(Boolean).join("\n");
    const answer = await onGenerate(prompt, "style_reference");
    const data = parseJson(answer);
    const rules = (Array.isArray(data?.rules) ? data.rules : []).filter((rule): rule is string => typeof rule === "string" && rule.trim() !== "").slice(0, 12);
    if (!rules.length) throw new Error("模型没有返回可用规则，未生成模板；请重试或改用粘贴参考文本。");
    const avoid = (Array.isArray(data?.avoid) ? data.avoid : []).filter((item): item is string => typeof item === "string").slice(0, 6);
    const gaps = (Array.isArray(data?.gaps) ? data.gaps : []).filter((item): item is string => typeof item === "string").slice(0, 6);
    return {
      ...base,
      rules: rules.map((text) => ({ id: `rule-draft-${stableHash(text)}`, text: text.slice(0, 400), layer: "semantic" as const, origin: "model_prior" as const, evidenceIds: [] })),
      constraints: [...base.constraints, ...avoid.map((item) => `不借鉴：${item.slice(0, 200)}`)],
      uncertainties: [...gaps.map((item) => item.slice(0, 300)), "本模板来自模型知识草案，未使用任何原文样段；粘贴目标作者/作品的原文后重新分析会更可靠。"],
    };
  }

  // Creation path 2: real excerpts -> the existing clean/split/dedupe/extract chain.
  async function draftFromExcerpts(base: StyleProfile, text: string): Promise<StyleProfile> {
    if (text.length > MAX_DRAFT_CHARS) throw new Error("参考文本超过 20 万字，请分段导入。");
    const imported = importTextAsSamples({
      bookId, targetId: base.targetId, raw: text,
      source: { kind: "primary_excerpt", title: target.trim() || name.trim() || "模板参考文本", usageBasis: "unknown", author: base.scope.author || undefined, work: base.scope.work || undefined },
    });
    if (!imported.samples.length) throw new Error("没有从参考文本整理出可用样段：文本太短或全是模板行。");
    const conditioning = imported.samples.filter((sample) => sample.split === "conditioning");
    const digest = buildSampleDigest(conditioning, 8000);
    const prompt = [
      base.scope.author || base.scope.work ? `目标文风：${profileDisplayName(base)}。` : "",
      "请只根据下面这些真实样段，抽取能直接指导写作的表达规则。",
      '只输出 JSON 对象：{"rules":[{"text":"具体规则","evidenceIds":["样段 ID"],"scene":"dialogue|daily|conflict|action|interior|environment|mixed"}],"gaps":["仍无法确认的特点"]}',
      "",
      digest.text,
      "",
      `只能引用这些样段 ID：${digest.sampleIds.join("、")}`,
    ].filter(Boolean).join("\n");
    const answer = await onGenerate(prompt, "style_profile");
    const parsed = parseProfileRules(answer, digest.sampleIds);
    if (parsed.unparsed) throw new Error("模型没有返回可解析的分析结果（JSON 无效），模板未生成；样段已保留。");
    const profile = buildStyleProfile({
      bookId, targetId: base.targetId, samples: imported.samples,
      scope: base.scope, modelRules: parsed.rules, authorRules: preference.trim(), id: base.id, now: base.createdAt,
    });
    if (parsed.gaps.length) profile.uncertainties.push(...parsed.gaps);
    return profile;
  }

  async function createTemplate() {
    if (busy) return;
    setBusy(true); setError(""); setNotes([]);
    try {
      const now = new Date().toISOString();
      const base = makeBaseProfile(now);
      const profile = rawText.trim() ? await draftFromExcerpts(base, rawText) : await draftFromName(base);
      storeProfile(profile);
      setNotes([`模板「${profileDisplayName(profile)}」已保存到借鉴库（第 1 版）。只保存，未改变本书正在使用的文风。`]);
      resetForm(); setCreating(false); setEditingId(profile.id);
      onNotify(`文风模板「${profileDisplayName(profile)}」已创建`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成模板失败，请重试。");
    } finally { setBusy(false); }
  }

  // Author writes without re-entering the form: their text becomes one
  // hand-written rule, the rest of the template stays.
  function createCustomTemplate() {
    if (!preference.trim()) { setError("请先填写希望借鉴的特点或补充要求。"); return; }
    const now = new Date().toISOString();
    const profile = makeBaseProfile(now);
    profile.rules = [{ id: `rule-author-${stableHash(preference.trim())}`, text: preference.trim().slice(0, 400), layer: "semantic", origin: "author_written", evidenceIds: [] }];
    storeProfile(profile);
    setNotes([`模板「${profileDisplayName(profile)}」已保存（纯自定义）。`]);
    resetForm(); setCreating(false); setEditingId(profile.id);
    onNotify(`文风模板「${profileDisplayName(profile)}」已创建`);
  }

  function copyTemplate(profile: StyleProfile) {
    const now = new Date().toISOString();
    const id = `tpl-${stableHash(`${bookId}|${profile.scope.note}|copy|${now}`)}`;
    const copy: StyleProfile = {
      ...structuredClone(profile), id, targetId: id, version: 1, createdAt: now,
      scope: { ...profile.scope, note: `${profile.scope.note || profileDisplayName(profile)} 副本` },
      notes: [...profile.notes, `复制自模板 ${profileDisplayName(profile)} 第 ${profile.version} 版。`],
    };
    storeProfile(copy);
    onNotify(`已复制为「${profileDisplayName(copy)}」`);
  }

  function deleteTemplate(profile: StyleProfile) {
    if (!window.confirm(`删除模板「${profileDisplayName(profile)}」？正在使用它的书会继续使用应用时的规则快照，不受影响。`)) return;
    onWorkspaceChange((w) => {
      const nextProfiles = { ...w.styleProfiles };
      delete nextProfiles[profile.id];
      return { ...w, styleProfiles: nextProfiles };
    });
    if (editingId === profile.id) setEditingId("");
    onNotify(`已删除模板「${profileDisplayName(profile)}」`);
  }

  // Saving a template never changes the book; "save and use" does, explicitly.
  function applyToBook(profile: StyleProfile) {
    onWorkspaceChange((w) => ({ ...w, bookStyle: applyTemplate(profile) }));
    onNotify(`本书将使用「${profileDisplayName(profile)}」的文风（已固定为第 ${profile.version} 版）`);
  }

  const editing = editingId ? workspace.styleProfiles[editingId] : null;

  return <section className="style-template-workbench" aria-label="文风模板">
    <div className="page-heading"><div><div className="eyebrow">借鉴库 / 文风模板</div><h2>文风模板</h2><p>围绕作者、作品或你自己的表达偏好，制作可复用、可编辑的文风模板；在「文笔文风」页选择后才会影响本书。</p></div><Button onClick={() => { setCreating(!creating); setEditingId(""); }}><Plus />新建模板</Button></div>
    {effective.mode === "template" && <p className="reference-source-note">本书正在使用模板「{effective.label}」。在这里修改模板不会改变本书——本书用的是应用时的快照。</p>}

    {creating && <div className="style-template-create">
      <label><span>模板名称</span><input aria-label="模板名称" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="例如：金庸式武侠叙述" /></label>
      <label><span>参考作者 / 作品（可选）</span><input aria-label="参考作者或作品" value={target} maxLength={200} onChange={(event) => setTarget(event.target.value)} placeholder="例如：金庸 / 《天龙八部》" /></label>
      <label className="style-template-create-wide"><span>希望借鉴的特点或补充要求（可选）</span><input aria-label="借鉴偏好" value={preference} maxLength={400} onChange={(event) => setPreference(event.target.value)} placeholder="例如：参考其表达特点，但减少修饰，多一些对白。" /></label>
      <label className="style-template-create-wide"><span>参考文本（可选，粘贴后会按真实样段分析）</span><textarea aria-label="模板参考文本" value={rawText} maxLength={MAX_DRAFT_CHARS} onChange={(event) => setRawText(event.target.value)} placeholder="粘贴一段或多段能代表目标文风的原文，建议 2–5 千字。留空则按名称/偏好生成 AI 草案。" /></label>
      <div className="assist-actions">
        <Button disabled={busy || (!name.trim() && !target.trim() && !preference.trim() && !rawText.trim())} onClick={() => void createTemplate()}>
          {busy ? <LoaderCircle className="spin" /> : <Sparkles />}{rawText.trim() ? "按样段生成模板" : "生成模板"}
        </Button>
        <Button variant="outline" disabled={busy || !preference.trim()} onClick={createCustomTemplate}><Pencil />只保存我的偏好（不调用模型）</Button>
        <Button variant="ghost" onClick={() => { setCreating(false); resetForm(); }}>取消</Button>
      </div>
      <p className="reference-source-note">{rawText.trim()
        ? "将按粘贴的真实样段分析：自动清理、切分、去重，并标注每条规则的样段证据。"
        : "将基于模型知识生成草案模板：不会编造原作引文或统计数据，也不会声称分析过原文。"}</p>
      {notes.map((note) => <p className="reference-source-note" role="status" key={note}>{note}</p>)}
      {error && <p className="reference-error" role="alert">{error}</p>}
    </div>}

    <div className="style-template-list">
      {templates.length === 0 && !creating && <div className="reference-library-empty"><FileText /><h3>还没有文风模板</h3><p>用上面的表单创建：可以只给一个作者名，也可以粘贴一段喜欢的文字。</p></div>}
      {templates.map((profile) => {
        const inUse = effective.mode === "template" && effective.sampleTemplateId === profile.id;
        return <article key={profile.id} className={`style-template-card ${inUse ? "is-active" : ""}`}>
          <div className="style-template-card-main">
            <strong>{profileDisplayName(profile)}</strong>
            <small>第 {profile.version} 版 · {profile.rules.length} 条规则 · {profile.sampleIds.length} 段样段 · {profile.scope.author || profile.scope.work ? `参考：${[profile.scope.author, profile.scope.work].filter(Boolean).join(" / ")}` : "自定义"}</small>
            {profile.rules[0] && <p>{profile.rules[0].text.slice(0, 80)}…</p>}
          </div>
          <div className="style-template-card-actions">
            {inUse ? <span className="style-profile-badge"><Check />本书使用中</span> : <Button variant="outline" size="sm" onClick={() => applyToBook(profile)}><Save />保存并用于本书</Button>}
            <Button variant="ghost" size="sm" aria-label={`编辑模板 ${profileDisplayName(profile)}`} onClick={() => { setEditingId(editingId === profile.id ? "" : profile.id); setCreating(false); }}><Pencil />编辑</Button>
            <Button variant="ghost" size="icon" aria-label={`复制模板 ${profileDisplayName(profile)}`} onClick={() => copyTemplate(profile)}><Copy /></Button>
            <Button variant="ghost" size="icon" aria-label={`删除模板 ${profileDisplayName(profile)}`} onClick={() => deleteTemplate(profile)}><Trash2 /></Button>
          </div>
        </article>;
      })}
    </div>

    {editing && <StyleFidelityPanel
      bookId={bookId}
      profile={editing}
      authorRules={workspace.assets.style ?? ""}
      samples={workspace.styleSamples.filter((sample) => sample.targetId === editing.targetId)}
      run={workspace.referenceAssist.style?.run ?? null}
      onSamplesChange={(next) => onWorkspaceChange((w) => ({ ...w, styleSamples: [...w.styleSamples.filter((sample) => sample.targetId !== editing.targetId), ...next] }))}
      onProfileChange={storeProfile}
      onGenerateProfile={(prompt) => onGenerate(prompt, "style_profile")}
      onRun={onFidelityRun}
    />}
    {editing && <details className="assist-stats"><summary>模板当前完整规则（预览）</summary><pre>{profileRulesToText(editing)}</pre></details>}
  </section>;
}

function extractAuthor(target: string): string {
  const cleaned = target.trim().replace(/^《|》$/g, "");
  if (!cleaned) return "";
  const separators = [" / ", "/", "·", "｜", "|"];
  for (const separator of separators) {
    const parts = cleaned.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[0];
  }
  return cleaned.includes("《") ? "" : cleaned;
}

function extractWork(target: string): string {
  const match = target.trim().match(/《([^》]+)》/);
  if (match) return match[1];
  const cleaned = target.trim();
  const separators = [" / ", "/", "·", "｜", "|"];
  for (const separator of separators) {
    const parts = cleaned.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[1];
  }
  return "";
}
