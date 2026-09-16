"use client";

// 文笔文风 page: how THIS book uses a template made in 借鉴库.
// Three blocks: (1) the template in force, (2) the book's own modifications,
// (3) a preview write. Everything shown here reads resolveEffectiveStyle, the
// same source generation uses — no second "apply/sync" concept.

import { useMemo, useState } from "react";
import { BookMarked, Check, LoaderCircle, PenLine, Plus, RotateCcw, Save, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  hasQuickAdjustment, QUICK_ADJUSTMENTS, resolveEffectiveStyle, STYLE_OFF, toggleQuickAdjustment,
  applyTemplate, customStyle, type BookStyleState,
} from "@/lib/book-style";
import { appendProfileVersion, buildStyleProfile, profileDisplayName } from "@/lib/style-fidelity";
import { stableHash } from "@/lib/reference-assist";
import type { BookWorkspace, PlotGenerationOptions } from "./book-workspace";

type Props = {
  bookId: string;
  workspace: BookWorkspace;
  onWorkspaceChange: (patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) => void;
  onGenerate: (prompt: string, task: string, options?: PlotGenerationOptions) => Promise<string>;
  onNotify: (message: string) => void;
  onGoToLibrary: () => void;
};

type ProposedRule = { text: string };

export function StyleApplyPanel({ bookId, workspace, onWorkspaceChange, onGenerate, onNotify, onGoToLibrary }: Props) {
  const [adjustDraft, setAdjustDraft] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [proposed, setProposed] = useState<ProposedRule[] | null>(null);
  const [scene, setScene] = useState("");
  const [trial, setTrial] = useState("");
  const [trialBusy, setTrialBusy] = useState(false);
  const [error, setError] = useState("");

  const templates = useMemo(() => Object.values(workspace.styleProfiles).sort((a, b) => a.scope.note.localeCompare(b.scope.note)), [workspace.styleProfiles]);
  const bookStyle: BookStyleState = workspace.bookStyle ?? { mode: "off", rules: [] };
  const effective = resolveEffectiveStyle(bookStyle, workspace.styleProfiles, workspace.assets.style ?? "");
  const selectedTemplateId = bookStyle.mode === "template" ? bookStyle.templateId! : "";
  const template = templates.find((entry) => entry.id === selectedTemplateId) ?? null;
  const rules = effective.rules;

  function setBookStyle(next: BookStyleState) { onWorkspaceChange((w) => ({ ...w, bookStyle: next })); }

  function selectTemplate(id: string) {
    const profile = workspace.styleProfiles[id];
    if (!profile) return;
    setBookStyle(applyTemplate(profile));
    setProposed(null);
    onNotify(`本书将使用「${profileDisplayName(profile)}」第 ${profile.version} 版（已固定快照）`);
  }

  // Explicit update to a newer template version. Book edits are the working copy,
  // so updating replaces them — the author must confirm, and can save their edits
  // as a new template first.
  async function updateTemplate() {
    if (!template) return;
    const appliedVersion = bookStyle.templateVersion ?? 0;
    if (template.version <= appliedVersion) { onNotify("本书已是该模板的最新版本。"); return; }
    if (!window.confirm(`模板已有第 ${template.version} 版。更新会用模板当前规则替换本书的规则副本（本书修改将丢失，可先「另存为新模板」）。是否更新？`)) return;
    setBookStyle(applyTemplate(template));
    onNotify(`已更新到模板第 ${template.version} 版`);
  }

  function restoreTemplate() {
    if (!template) return;
    setBookStyle(applyTemplate(template));
    onNotify(`已恢复为模板「${profileDisplayName(template)}」第 ${template.version} 版的原始规则`);
  }

  function saveAsTemplate() {
    if (!rules.length) { setError("当前没有规则可保存。"); return; }
    const label = window.prompt("新模板名称：", `${effective.label}（本书版）`);
    if (!label?.trim()) return;
    const now = new Date().toISOString();
    const id = `tpl-${stableHash(`${bookId}|${label}|${now}`)}`;
    const profile = buildStyleProfile({
      bookId, targetId: id, samples: [],
      scope: { author: template?.scope.author ?? "", work: template?.scope.work ?? "", note: label.trim() },
      authorRules: workspace.assets.style ?? "", now,
    });
    profile.rules = rules.map((rule) => ({ ...rule }));
    profile.uncertainties = [...profile.uncertainties, "由本书文风副本另存而来。"];
    onWorkspaceChange((w) => ({
      ...w,
      styleProfiles: { ...w.styleProfiles, [profile.id]: profile },
      styleProfileHistory: { ...w.styleProfileHistory, [profile.id]: appendProfileVersion(w.styleProfileHistory[profile.id] ?? [], profile) },
    }));
    onNotify(`已另存为模板「${profileDisplayName(profile)}」，可在借鉴库中管理`);
  }

  // Natural-language adjustment runs the model for real, then shows the concrete
  // rule changes for confirmation — never a silent append.
  async function adjustWithAI() {
    const instruction = adjustDraft.trim();
    if (!instruction || adjusting) return;
    setAdjusting(true); setError(""); setProposed(null);
    try {
      const prompt = [
        "下面是本书当前的文风规则。请按作者要求修订这份规则列表：",
        `作者要求：${instruction}`,
        "",
        "【当前规则】",
        ...(rules.length ? rules.map((rule) => `- ${rule.text}`) : ["（暂无规则）"]),
        workspace.assets.style?.trim() ? `【作者手写补充（保留，不修改）】\n${workspace.assets.style.trim()}` : "",
        "",
        "要求：输出修订后的完整规则列表。与要求冲突的旧表述必须改写或删除，不得让互相矛盾的规则同时存在（例如「多用修辞」和「少用修辞」）。保留未涉及的规则。规则要具体可执行。",
        '只输出 JSON 对象：{"rules":["修订后的每一条规则", ...]}',
      ].filter(Boolean).join("\n");
      const answer = await onGenerate(prompt, "style_reference");
      const data = (() => { try { return JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { rules?: unknown }; } catch { return null; } })();
      const list = (Array.isArray(data?.rules) ? data.rules : []).filter((rule): rule is string => typeof rule === "string" && rule.trim() !== "");
      if (!list.length) throw new Error("模型没有返回可用的修订规则，本次未修改。");
      setProposed(list.map((text) => ({ text })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 调整失败，请重试。");
    } finally { setAdjusting(false); }
  }

  function adoptProposed() {
    if (!proposed?.length) return;
    setBookStyle({ ...bookStyle, mode: bookStyle.mode === "off" ? "custom" : bookStyle.mode, rules: proposed.map((rule) => ({ id: `rule-adjust-${stableHash(rule.text)}`, text: rule.text.slice(0, 400), layer: "semantic" as const, origin: "model_prior" as const, evidenceIds: [] })), updatedAt: new Date().toISOString() });
    setProposed(null); setAdjustDraft("");
    onNotify("已采用修订后的规则；借鉴库中的模板保持不变");
  }

  async function writeSample() {
    if (trialBusy) return;
    setTrialBusy(true); setError("");
    try {
      const sceneLine = scene.trim()
        ? `以这个场景写一段约 200–400 字的原创示范：${scene.trim()}`
        : "写一个明确的原创测试场景（例如：雨夜的车站，主角在等一个不会来的人），写约 200–400 字的原创示范。";
      const prompt = [
        "你是小说主笔。请依据下面的「本书生效文风」写一段原创示范。",
        "只输出示范正文，不要解释；必须是原创内容，不得复制任何参考原作的文句，也不得声称是原作片段；不要改写、替换或续写作者的正文。",
        sceneLine,
        "",
        effective.text || "（未启用文风规则，按默认写作习惯。）",
      ].join("\n");
      const answer = await onGenerate(prompt, "chapter_write");
      setTrial(answer);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "试写失败，正文未改动。");
    } finally { setTrialBusy(false); }
  }

  return <section className="style-apply-panel" aria-label="本书文风">
    <header><div><strong>本书文风</strong><small>{effective.mode === "off" ? "文风指导已关闭，生成时不会注入任何风格规则。" : effective.label}</small></div></header>
    {effective.notes.map((note) => <p className="reference-source-note" role="status" key={note}>{note}</p>)}

    <div className="style-apply-block">
      <strong>1 · 当前使用的模板</strong>
      {templates.length === 0
        ? <p className="reference-source-note">借鉴库还没有文风模板。<button type="button" className="link-button" onClick={onGoToLibrary}>去借鉴库创建模板 →</button></p>
        : <div className="style-apply-select">
            <NativeSelect aria-label="选择文风模板" value={selectedTemplateId} onChange={(event) => { if (event.target.value) selectTemplate(event.target.value); }}>
              <NativeSelectOption value="">（不使用模板）</NativeSelectOption>
              {templates.map((entry) => <NativeSelectOption key={entry.id} value={entry.id}>{profileDisplayName(entry)} · 第 {entry.version} 版</NativeSelectOption>)}
            </NativeSelect>
            {bookStyle.mode === "template" && template && <>
              <Button variant="outline" size="sm" onClick={() => void updateTemplate()}>更新到模板最新版</Button>
              <Button variant="outline" size="sm" onClick={onGoToLibrary}><BookMarked />在借鉴库中查看</Button>
            </>}
          </div>}
      <div className="style-apply-modes">
        <Button variant={bookStyle.mode === "custom" ? "default" : "outline"} size="sm" onClick={() => { setBookStyle(bookStyle.mode === "custom" ? bookStyle : customStyle(rules)); onNotify("已切换为完全自定义文风"); }} aria-pressed={bookStyle.mode === "custom"}>不使用模板，完全自定义</Button>
        <Button variant={bookStyle.mode === "off" ? "default" : "outline"} size="sm" onClick={() => { setBookStyle(STYLE_OFF); onNotify("已关闭文风指导：生成不再注入任何文风规则"); }} aria-pressed={bookStyle.mode === "off"}>关闭文风指导</Button>
      </div>
    </div>

    <div className="style-apply-block">
      <strong>2 · 本书专属修改{effective.mode === "template" ? "（只影响本书，不改动借鉴库模板）" : ""}</strong>
      <div className="assist-rules">
        <ol>{rules.map((rule, index) => <li key={rule.id}>
          <textarea aria-label={`本书文风规则 ${index + 1}`} value={rule.text}
            onChange={(event) => setBookStyle({ ...bookStyle, rules: rules.map((entry) => entry.id === rule.id ? { ...entry, text: event.target.value } : entry), updatedAt: new Date().toISOString() })} />
          <Button variant="ghost" size="icon" aria-label={`删除规则 ${index + 1}`} onClick={() => setBookStyle({ ...bookStyle, rules: rules.filter((entry) => entry.id !== rule.id), updatedAt: new Date().toISOString() })}><Trash2 /></Button>
        </li>)}</ol>
        {rules.length === 0 && <p className="reference-source-note">还没有规则。可以从模板开始、手写一条，或使用下面的快捷调整。</p>}
        <Button variant="outline" size="sm" onClick={() => setBookStyle({ ...bookStyle, rules: [...rules, { id: `rule-book-${Date.now()}`, text: "（填写你的规则）", layer: "semantic", origin: "author_written", evidenceIds: [] }], updatedAt: new Date().toISOString() })}><Plus />手写一条规则</Button>
      </div>
      <div className="style-apply-quick" aria-label="快捷调整">
        {QUICK_ADJUSTMENTS.map((entry) => <Button key={entry.id} variant={hasQuickAdjustment(bookStyle, entry.id) ? "default" : "outline"} size="sm" aria-pressed={hasQuickAdjustment(bookStyle, entry.id)} onClick={() => { setBookStyle(toggleQuickAdjustment(bookStyle, entry.id)); setProposed(null); }}>{entry.label}</Button>)}
      </div>
      <div className="assist-discuss">
        <label><span>用一句话调整文风</span>
          <input aria-label="自然语言调整" value={adjustDraft} maxLength={400} placeholder="例如：保留克制的叙述，但对白更口语化，少用比喻。" onChange={(event) => setAdjustDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void adjustWithAI(); } }} />
        </label>
        <Button variant="outline" size="sm" disabled={adjusting || !adjustDraft.trim()} onClick={() => void adjustWithAI()}>{adjusting ? <LoaderCircle className="spin" /> : <Sparkles />}AI 调整</Button>
      </div>
      {proposed && <div className="assist-diff">
        <strong>AI 修改预览（确认后才采用）</strong>
        <div className="assist-diff-body">
          <div><em>当前规则</em><pre>{rules.map((rule) => `- ${rule.text}`).join("\n") || "（无）"}</pre></div>
          <div><em>修订后</em><pre>{proposed.map((rule) => `- ${rule.text}`).join("\n")}</pre></div>
        </div>
        <div className="assist-diff-actions">
          <Button onClick={adoptProposed}><Check />采用修订</Button>
          <Button variant="ghost" onClick={() => setProposed(null)}><X />放弃</Button>
        </div>
      </div>}
      <div className="assist-actions">
        {bookStyle.mode === "template" && <Button variant="outline" size="sm" onClick={restoreTemplate}><RotateCcw />恢复应用时的模板设置</Button>}
        <Button variant="outline" size="sm" onClick={saveAsTemplate}><Save />另存为新模板</Button>
      </div>
    </div>

    <div className="style-apply-block">
      <strong>3 · 试写预览</strong>
      <div className="style-apply-trial">
        <input aria-label="试写场景" value={scene} maxLength={400} placeholder="可选：给一个场景，例如「雨夜的车站」" onChange={(event) => setScene(event.target.value)} />
        <Button variant="outline" disabled={trialBusy} onClick={() => void writeSample()}>{trialBusy ? <LoaderCircle className="spin" /> : <PenLine />}试写一段</Button>
      </div>
      {trial && <div className="assist-sample"><strong>原创试写（未写入正文）</strong><p>{trial}</p><small>这是按当前生效文风生成的原创片段，不是参考原作引文，也没有写入任何章节。</small></div>}
      {error && <p className="reference-error" role="alert">{error}</p>}
    </div>
  </section>;
}
