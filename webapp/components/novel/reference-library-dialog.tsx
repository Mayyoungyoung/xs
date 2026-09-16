"use client";

import { useMemo, useRef, useState } from "react";
import {
  BookMarked, Check, ExternalLink, FileText, Globe2, LoaderCircle, MessageCircle,
  PenLine, Search, Sparkles, Trash2, Upload, WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { readSearchCredentials } from "@/lib/model-credentials";
import {
  DIMENSION_LABELS, ENTITY_KIND_LABELS, EVIDENCE_LABELS, MEDIUM_LABELS, mergeModelPlan, parseReferenceBrief,
  reviseStylePlan, stylePlanToRuleText, styleReferencePrompt, statusBadges,
  type AssistDraft, type ReferenceDimension, type ReferenceEntityKind, type ReferenceEvidence, type ReferenceMedium, type StylePlan,
} from "@/lib/reference-assist";

export type ReferenceScope = "plot" | "character" | "style" | "world";
export type ReferenceItem = {
  id: string;
  title: string;
  kind: string;
  summary: string;
  source: string;
  url?: string;
  scope: ReferenceScope;
  entity?: string;
  tier?: number;
  evidence?: ReferenceEvidence;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ReferenceScope;
  selected: ReferenceItem[];
  onAdd: (reference: ReferenceItem) => void;
  onRemove: (reference: ReferenceItem) => void;
  bookId: string;
  assist: AssistDraft;
  onAssistChange: (patch: Partial<AssistDraft> | ((draft: AssistDraft) => AssistDraft)) => void;
  currentStyle: string;
  onGenerateStyle: (prompt: string) => Promise<string>;
  onTrialWrite: (ruleText: string) => Promise<string>;
  onApplyStyle: (ruleText: string, mode: "replace-all" | "append") => { ok: boolean; error?: string };
  // Style-scope only: pasted/uploaded text becomes style samples for the active
  // profile instead of a library entry, so there is one sample store.
  onImportStyleText?: (title: string, text: string) => { ok: boolean; note?: string; error?: string };
};

const scopeNames: Record<ReferenceScope, string> = { plot: "剧情结构", character: "人物设定", style: "文笔指纹", world: "世界观" };
const MAX_LOCAL_LENGTH = 60000;

// The search credential is read from its own session slot and sent in its own
// header, so the writing key never reaches a search provider.
function searchHeaders(): Record<string, string> {
  const credentials = readSearchCredentials();
  return credentials ? { "X-Momai-Search-Key": credentials.key, "X-Momai-Search-Provider": credentials.provider } : {};
}
const EXAMPLES = [
  "文笔参考余华，但人物和故事保持我的。",
  "参考郭敬明，先给我可调整的表达方案。",
  "借鉴《斗破苍穹》的节奏，不复制情节。",
  "情感细腻一些，但别堆砌修饰。",
];
type Entry = "ai" | "search" | "local";

export function ReferenceLibraryDialog({
  open, onOpenChange, scope, selected, onAdd, onRemove,
  bookId, assist, onAssistChange, currentStyle, onGenerateStyle, onTrialWrite, onApplyStyle, onImportStyleText,
}: Props) {
  const [entry, setEntry] = useState<Entry>(scope === "style" ? "local" : "ai");
  const [input, setInput] = useState(assist.input);
  const [running, setRunning] = useState<null | "assist" | "discuss" | "trial">(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [discussDraft, setDiscussDraft] = useState("");
  const [kindDraft, setKindDraft] = useState<ReferenceEntityKind | "">("");
  const [mediumDraft, setMediumDraft] = useState<ReferenceMedium | "">("");
  const [showDiff, setShowDiff] = useState(false);
  // Manual search
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(scope === "character" ? "character" : "novel");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ReferenceItem[]>([]);
  const [sourceNote, setSourceNote] = useState("");
  // Local material
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const plan = assist.plan;
  // For non-style scopes the applied text is the borrow plan; the style scope
  // has its own profile flow on the 文笔文风 page and no longer passes through here.
  const ruleText = useMemo(() => (plan ? stylePlanToRuleText(plan) : ""), [plan]);
  const badges = useMemo(() => (plan ? statusBadges(briefOf(assist), assist.evidence) : []), [assist, plan]);
  const scoped = selected.filter((item) => item.scope === scope);
  const busy = running !== null;

  function updateDraft(patch: Partial<AssistDraft> | ((draft: AssistDraft) => AssistDraft)) {
    onAssistChange((draft) => {
      const next = typeof patch === "function" ? patch(draft) : { ...draft, ...patch };
      return { ...next, updatedAt: new Date().toISOString() };
    });
  }

  function mergeEvidence(incoming: ReferenceEvidence[]) {
    const byId = new Map(assist.evidence.map((item) => [item.evidenceId, item]));
    for (const item of incoming) byId.set(item.evidenceId, item);
    return [...byId.values()].slice(0, 40);
  }

  // One line in: identify, look for evidence, draft a plan, then let the writing
  // model refine the wording. Search or model failures never block the draft.
  async function runAssist() {
    const value = input.trim();
    if (!value || busy) return;
    setRunning("assist"); setError(""); setNotice("");
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch("/api/references/assist", {
        method: "POST", headers: { "Content-Type": "application/json", ...searchHeaders() },
        body: JSON.stringify({
          input: value, scope, bookId, requestId,
          ...(kindDraft ? { entityKind: kindDraft } : {}),
          ...(mediumDraft ? { medium: mediumDraft } : {}),
          evidence: assist.evidence.filter((item) => item.kind === "prose"),
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json() as {
        requestId: string; plan: StylePlan; evidence: ReferenceEvidence[]; badges: string[];
        search: { degraded: boolean; note: string; sources: Array<{ name: string; state: string }> } | null;
        model: { prompt: string; context: string }; error?: string;
      };
      if (!response.ok || !data.plan) throw new Error(data.error ?? "生成借鉴方案失败。");
      let nextPlan = data.plan;
      const evidence = mergeEvidence(data.evidence ?? []);
      const notes: string[] = [];
      if (data.search?.note) notes.push(data.search.note);
      setNotice(data.search?.note ?? "");
      updateDraft((draft) => ({
        ...draft, requestId: data.requestId, input: value, plan: nextPlan, evidence,
        thread: [...draft.thread, { role: "ai" as const, text: `已识别：${describePlan(nextPlan)}${data.search?.degraded ? "（部分来源本次不可用）" : ""}`, at: new Date().toISOString() }],
      }));
      // The model only refines wording and rules; the deterministic plan and the
      // evidence-based honesty gaps survive whatever it returns.
      try {
        const answer = await onGenerateStyle(`${data.model.prompt}\n\n${data.model.context}`);
        const merged = mergeModelPlan(nextPlan, answer);
        nextPlan = merged.plan;
        if (merged.note) notes.push(merged.note);
        updateDraft((draft) => ({
          ...draft, plan: nextPlan,
          thread: [...draft.thread, { role: "ai" as const, text: merged.applied ? "已结合模型建议完善表达方向与规则。" : merged.note ?? "已保留初步方案。", at: new Date().toISOString() }],
        }));
      } catch (reason) {
        notes.push(reason instanceof Error ? reason.message : "模型未参与本次方案，已保留初步方案。");
      }
      setNotice(notes.filter(Boolean).join(" "));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法生成借鉴方案，请重试或改用自己检索。");
    } finally { setRunning(null); }
  }

  // A short follow-up edits the current candidate in place, keeping its source and
  // version; the model then refines the wording of that same candidate.
  async function continueDiscussion() {
    const instruction = discussDraft.trim();
    if (!instruction || !plan || busy) return;
    setRunning("discuss"); setError(""); setNotice("");
    const revised = reviseStylePlan(plan, instruction);
    updateDraft((draft) => ({ ...draft, plan: revised, thread: [...draft.thread, { role: "user" as const, text: instruction, at: new Date().toISOString() }] }));
    setDiscussDraft("");
    try {
      const brief = briefOf({ ...assist, input: assist.input });
      const { prompt, context } = styleReferencePrompt(brief, revised, assist.evidence);
      const answer = await onGenerateStyle(`${prompt}\n\n${context}\n\n作者补充要求：${instruction}`);
      const merged = mergeModelPlan(revised, answer);
      updateDraft((draft) => ({
        ...draft, plan: merged.plan,
        thread: [...draft.thread, { role: "ai" as const, text: merged.applied ? `已按「${instruction}」调整到第 ${merged.plan.version} 版。` : merged.note ?? "已按你的要求调整。", at: new Date().toISOString() }],
      }));
    } catch (reason) {
      setNotice(`${reason instanceof Error ? reason.message : "模型未响应"}已按你的要求调整到第 ${revised.version} 版。`);
    } finally { setRunning(null); }
  }

  // The trial write is author-triggered, uses the current chapter scene, and only
  // ever shows an original sample — it never touches the manuscript.
  async function trialWrite() {
    if (!ruleText || busy) return;
    setRunning("trial"); setError("");
    try {
      const sample = await onTrialWrite(ruleText);
      updateDraft({ sample });
      setNotice("已生成原创试写示范（不是原作片段，也未写入正文）。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "试写失败，正文未改动。"); }
    finally { setRunning(null); }
  }

  function applyStyle(mode: "replace-all" | "append") {
    if (!ruleText) return;
    setError("");
    const outcome = onApplyStyle(ruleText, mode);
    if (!outcome.ok) { setError(outcome.error ?? "应用失败，正文文风未改动。"); return; }
    updateDraft({ applied: { at: new Date().toISOString(), version: plan?.version ?? 1 } });
    setShowDiff(false);
    setNotice(mode === "append" ? "已把规则追加到本书文风。" : "已把这份方案应用为本书正式文风，下次续写就会带上。");
  }

  // 收藏参考 only files the material in the library; it never becomes the book style.
  function favorite() {
    if (!plan) return;
    onAdd({
      id: `assist-${plan.id}`, title: plan.entity.name || "自定义表达方案",
      kind: plan.entity.name ? "assist" : "custom", source: `借鉴助手 · 第 ${plan.version} 版`,
      summary: ruleText, scope, entity: plan.entity.name || undefined,
      ...(plan.basis.find((item) => item.evidenceId)?.evidenceId ? { evidence: assist.evidence.find((item) => item.evidenceId === plan.basis.find((entry) => entry.evidenceId)?.evidenceId) } : {}),
    });
    setNotice("已收藏到借鉴库；正式文风未改动。");
  }

  function updatePlan(patch: (current: StylePlan) => StylePlan) {
    if (!plan) return;
    updateDraft({ plan: patch(plan) });
  }

  async function searchReferences() {
    if (!query.trim() || loading) return;
    setLoading(true); setError(""); setSourceNote("");
    try {
      const response = await fetch("/api/references/search", { method: "POST", headers: { "Content-Type": "application/json", ...searchHeaders() }, body: JSON.stringify({ query, kind, includeBooks: true }), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { results?: ReferenceItem[]; sources?: Array<{ name: string; ok: boolean }>; note?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "检索失败");
      setResults((data.results ?? []).map((item) => ({ ...item, scope })));
      const degraded = (data.sources ?? []).filter((source) => !source.ok).map((source) => source.name);
      setSourceNote(degraded.length ? `当前网络下这些来源不可用：${degraded.join("、")}。结果可能偏少。` : data.note ?? "");
      if (!data.results?.length) setError("没有找到相关结果，已过滤不匹配条目。请更换关键词或导入本地资料。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法检索");
    } finally { setLoading(false); }
  }

  function attachProse(title: string, text: string) {
    const evidence: ReferenceEvidence = {
      evidenceId: `ev-paste-${Date.now()}`, kind: "prose", source: "粘贴原文",
      retrievedAt: new Date().toISOString(), retrieved: true, chars: text.length, note: "作者提供的文本样段，只分析这段范围。",
    };
    const reference: ReferenceItem = { id: `paste-${Date.now()}`, title, kind: "local", summary: text, source: "粘贴原文", scope, evidence };
    onAdd(reference);
    setResults((items) => [reference, ...items.filter((item) => item.id !== reference.id)]);
    updateDraft((draft) => ({ ...draft, evidence: mergeEvidence([evidence]) }));
  }

  function addPasted() {
    const text = pasteText.trim();
    if (!text) { setError("请先粘贴要借鉴的原文片段。"); return; }
    if (text.length > MAX_LOCAL_LENGTH) { setError(`粘贴内容超过 ${MAX_LOCAL_LENGTH / 10000} 万字，请截取代表性的原文片段。`); return; }
    if (scope === "style" && onImportStyleText) {
      const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
      const outcome = onImportStyleText(pasteTitle.trim() || firstLine.slice(0, 30) || "粘贴的原文片段", text);
      if (!outcome.ok) { setError(outcome.error ?? "导入失败。"); return; }
      if (outcome.note) setNotice(outcome.note);
      setPasteTitle(""); setPasteText(""); setError("");
      return;
    }
    const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
    attachProse(pasteTitle.trim() || firstLine.slice(0, 30) || "粘贴的原文片段", text);
    setPasteTitle(""); setPasteText(""); setError("");
  }

  async function loadFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    for (const file of Array.from(files)) {
      if (!/\.(txt|md|json)$/i.test(file.name)) { setError("目前支持 TXT、Markdown 与 JSON 文本资料。"); continue; }
      if (file.size > 2 * 1024 * 1024) { setError("单份资料不能超过 2 MB，请拆分后导入。"); continue; }
      let text: string;
      try { text = await file.text(); } catch { setError(`无法读取 ${file.name}`); continue; }
      if (!text.trim()) { setError(`${file.name} 是空文件。`); continue; }
      if (text.length > MAX_LOCAL_LENGTH) { setError(`${file.name} 超过 6 万字，请拆分后导入，避免截断材料。`); continue; }
      if (scope === "style" && onImportStyleText) {
        const outcome = onImportStyleText(file.name.replace(/\.[^.]+$/, ""), text);
        if (!outcome.ok) { setError(outcome.error ?? `无法导入 ${file.name}`); continue; }
        if (outcome.note) setNotice(outcome.note);
        continue;
      }
      const evidence: ReferenceEvidence = { evidenceId: `ev-file-${file.name}-${file.lastModified}`, kind: "prose", source: "本地文件", retrievedAt: new Date().toISOString(), retrieved: true, chars: text.length, note: "作者提供的文本样段，只分析这段范围。" };
      const reference: ReferenceItem = { id: `local-${file.name}-${file.lastModified}`, title: file.name.replace(/\.[^.]+$/, ""), kind: "local", summary: text, source: "本地文件", scope, evidence };
      onAdd(reference);
      setResults((items) => [reference, ...items.filter((item) => item.id !== reference.id)]);
      updateDraft((draft) => ({ ...draft, evidence: mergeEvidence([evidence]) }));
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="reference-dialog sm:max-w-[860px]">
      <DialogHeader>
        <DialogTitle>添加{scopeNames[scope]}借鉴</DialogTitle>
        <DialogDescription>
          {scope === "style"
            ? "粘贴或导入目标作者/作品的原文片段，会自动整理为文风样段；文风规则在「文笔文风」页编辑。"
            : "输入作者名、作品名或一句自然语言，AI 会先识别对象、给出可调整的表达方案，再按需联网补充资料。搜索只是增强，不是前提。"}
        </DialogDescription>
      </DialogHeader>
      <div className="reference-mode-tabs">
        {scope !== "style" && <button className={entry === "ai" ? "active" : ""} onClick={() => setEntry("ai")}><Sparkles size={16} />AI 帮我借鉴</button>}
        <button className={entry === "search" ? "active" : ""} onClick={() => setEntry("search")}><Globe2 size={16} />自己检索</button>
        <button className={entry === "local" ? "active" : ""} onClick={() => setEntry("local")}><Upload size={16} />导入材料</button>
      </div>

      {entry === "ai" && scope !== "style" && <div className="reference-assist">
        <label className="assist-input"><span>想借鉴谁、借鉴什么</span>
          <textarea aria-label="借鉴要求" value={input} maxLength={600} placeholder="例如：文笔参考余华，但人物和故事保持我的。" onChange={(event) => { setInput(event.target.value); updateDraft({ input: event.target.value }); }} />
        </label>
        <div className="assist-examples">{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => { setInput(example); updateDraft({ input: example }); }}>{example}</button>)}</div>
        <div className="assist-run">
          <Button disabled={busy || !input.trim()} onClick={() => void runAssist()}>{running === "assist" ? <LoaderCircle className="spin" /> : <WandSparkles />}{running === "assist" ? "正在识别并补充资料…" : "生成借鉴方案"}</Button>
          <span>预览目的：{scopeNames[scope]}（可在下面修改识别结果）</span>
        </div>

        {plan && <section className="assist-plan" aria-label="借鉴方案">
          <header>
            <div><strong>{plan.entity.name || "自定义表达方案（未指定对象）"}</strong><small>第 {plan.version} 版 · {plan.basisKind === "verified" ? "有文本样段支撑" : plan.basisKind === "metadata-only" ? "仅百科/元数据" : plan.basisKind === "mixed" ? "混合依据" : "仅模型知识，未联网核验"}</small></div>
            <div className="assist-badges">{badges.map((badge) => <span key={badge}>{badge}</span>)}</div>
          </header>

          <div className="assist-ident">
            <label><span>对象类别</span>
              <NativeSelect aria-label="识别类别" value={kindDraft || plan.entity.kind} onChange={(event) => { setKindDraft(event.target.value as ReferenceEntityKind); updateDraft({ plan: { ...plan, entity: { ...plan.entity, kind: event.target.value as ReferenceEntityKind } } }); }}>
                {(Object.keys(ENTITY_KIND_LABELS) as ReferenceEntityKind[]).map((value) => <NativeSelectOption key={value} value={value}>{ENTITY_KIND_LABELS[value]}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            <label><span>媒介</span>
              <NativeSelect aria-label="参考媒介" value={mediumDraft || plan.entity.medium} onChange={(event) => { setMediumDraft(event.target.value as ReferenceMedium); updateDraft({ plan: { ...plan, entity: { ...plan.entity, medium: event.target.value as ReferenceMedium } } }); }}>
                {(Object.keys(MEDIUM_LABELS) as ReferenceMedium[]).map((value) => <NativeSelectOption key={value} value={value}>{MEDIUM_LABELS[value]}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            {plan.ambiguous && plan.candidates.length > 0 && <div className="assist-candidates"><span>有歧义，请选一个：</span>{plan.candidates.map((candidate) => <button key={candidate.label} type="button" onClick={() => updateDraft({ plan: { ...plan, entity: { ...plan.entity, kind: candidate.kind, medium: candidate.medium }, ambiguous: false } })}>{candidate.label}</button>)}</div>}
          </div>

          <div className="assist-basis"><span>方案依据</span>{plan.basis.map((item, index) => <em key={`${item.label}-${index}`}>{item.evidenceId ? `${item.label} [${item.evidenceId}]` : item.label}</em>)}</div>

          {plan.gaps.length > 0 && <ul className="assist-caveat" role="status">{plan.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>}

          <div className="assist-directions">
            <strong>表达方向（可编辑）</strong>
            {plan.directions.map((direction, index) => <label key={direction.id}>
              <span>{direction.label}<small>{DIMENSION_LABELS[direction.dimension as ReferenceDimension] ?? ""}</small></span>
              <textarea aria-label={`表达方向 ${direction.label}`} value={direction.guidance} onChange={(event) => updatePlan((current) => ({ ...current, directions: current.directions.map((item, position) => position === index ? { ...item, guidance: event.target.value } : item) }))} />
            </label>)}
          </div>

          <div className="assist-lists">
            <div><strong>建议保留</strong><ul>{plan.keep.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><strong>明确不借鉴</strong><ul>{plan.avoid.length ? plan.avoid.map((item) => <li key={item}>{item}</li>) : <li>不复制原作原文、专有名词与情节桥段</li>}</ul></div>
          </div>

          <div className="assist-rules">
            <strong>可直接用于写作的规则（可编辑）</strong>
            <ol>{plan.rules.map((rule, index) => <li key={`${rule}-${index}`}><textarea aria-label={`写作规则 ${index + 1}`} value={rule} onChange={(event) => updatePlan((current) => ({ ...current, rules: current.rules.map((item, position) => position === index ? event.target.value : item) }))} /></li>)}</ol>
          </div>

          {plan.notes.length > 0 && <ul className="assist-notes">{plan.notes.map((note) => <li key={note}>{note}</li>)}</ul>}

          <div className="assist-discuss">
            <label><span>继续讨论</span>
              <input aria-label="继续讨论" value={discussDraft} placeholder="例如：太华丽、少点抒情、节奏更快" onChange={(event) => setDiscussDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void continueDiscussion(); } }} />
            </label>
            <Button variant="outline" size="sm" disabled={busy || !discussDraft.trim()} onClick={() => void continueDiscussion()}>{running === "discuss" ? <LoaderCircle className="spin" /> : <MessageCircle />}按要求调整</Button>
          </div>

          {assist.thread.length > 0 && <ul className="assist-thread" role="log" aria-label="借鉴讨论记录">{assist.thread.slice(-6).map((message, index) => <li key={`${message.at}-${index}`} className={message.role}>{message.role === "user" ? "我" : "AI"}：{message.text}</li>)}</ul>}

          {assist.sample && <div className="assist-sample"><strong>试写示范</strong><p>{assist.sample}</p><small>这是 AI 依据以上规则写的原创片段，不是原作引文，也没有写入正文。</small></div>}

          <div className="assist-actions">
            <Button variant="outline" disabled={busy} onClick={() => void trialWrite()}>{running === "trial" ? <LoaderCircle className="spin" /> : <PenLine />}试写一段</Button>
            <Button variant="outline" disabled={busy} onClick={favorite}><BookMarked />收藏参考</Button>
            <Button disabled={busy} onClick={() => setShowDiff(true)}><Check />应用为本书文风</Button>
          </div>

          {showDiff && <div className="assist-diff">
            <strong>应用前先看差异</strong>
            <div className="assist-diff-body">
              <div><em>当前正式文风</em><pre>{currentStyle.trim() || "（尚未设置文风）"}</pre></div>
              <div><em>将写入的规则</em><pre>{ruleText}</pre></div>
            </div>
            <div className="assist-diff-actions">
              <Button disabled={busy} onClick={() => applyStyle("replace-all")}>替换本书文风</Button>
              <Button variant="outline" disabled={busy} onClick={() => applyStyle("append")}>追加到现有文风</Button>
              <Button variant="ghost" onClick={() => setShowDiff(false)}>取消</Button>
            </div>
            {assist.applied && <small>上次应用：第 {assist.applied.version} 版 · {new Date(assist.applied.at).toLocaleString("zh-CN")}</small>}
          </div>}
        </section>}

        {notice && <p className="reference-source-note" role="status">{notice}</p>}
        {error && <p className="reference-error" role="alert">{error}</p>}
      </div>}

      {entry === "search" && <>
        <div className="reference-search-row">
          <NativeSelect value={kind} onChange={(event) => setKind(event.target.value)} aria-label="借鉴类型">
            <NativeSelectOption value="novel">指定小说</NativeSelectOption><NativeSelectOption value="genre">小说类型</NativeSelectOption>
            <NativeSelectOption value="character">指定人物</NativeSelectOption><NativeSelectOption value="author">作家</NativeSelectOption><NativeSelectOption value="work">作品风格</NativeSelectOption>
          </NativeSelect>
          <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !event.nativeEvent.isComposing && void searchReferences()} placeholder="例如：诡秘之主、群像仙侠、王熙凤、汪曾祺……" /></label>
          <Button onClick={() => void searchReferences()} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}检索</Button>
        </div>
        <p className="reference-source-note">百科与图书元数据只能确认对象和背景，不含原文，不会被当作已提取的文风指纹。</p>
        {sourceNote && <div className="reference-source-note">{sourceNote}</div>}
        {error && <div className="reference-error">{error} {query.trim() && <a href={`https://www.bing.com/search?q=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">在浏览器中检索并核对来源</a>}</div>}
        <SearchResults results={results} selected={scoped} onAdd={onAdd} />
      </>}

      {entry === "local" && <div className="local-upload">
        <div className="local-paste">
          <div className="local-paste-head"><strong>粘贴原文片段</strong><span>{pasteText.length.toLocaleString()} / {MAX_LOCAL_LENGTH.toLocaleString()} 字</span></div>
          <input aria-label="借鉴标题" value={pasteTitle} onChange={(event) => setPasteTitle(event.target.value)} placeholder="名称（可留空，默认取首行）" />
          <textarea aria-label="粘贴原文" value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="粘贴一段能代表目标文风的原文，建议 2–5 千字：包含叙述、对话与情绪转换的段落最能体现节奏与句式。" />
          <Button variant="outline" onClick={addPasted}><Check />加入借鉴并作为文本样段</Button>
        </div>
        <div className="local-files" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void loadFiles(event.dataTransfer.files); }}>
          <input ref={fileInput} type="file" accept=".txt,.md,.json" multiple onChange={(event) => { void loadFiles(event.target.files); event.target.value = ""; }} />
          <div className="upload-orb"><Upload /></div><strong>或选择、拖入你的资料文件</strong><p>支持 TXT、Markdown、JSON，单份不超过 6 万字；内容只在你主动生成时发送给所选模型。</p><Button variant="outline" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }}>选择文件</Button>
        </div>
        {error && <div className="reference-error">{error}</div>}
      </div>}

      {scoped.length > 0 && <section className="selected-references"><strong>已加入本书的{scopeNames[scope]}借鉴</strong>{scoped.map((item) => <div key={`${item.id}-${item.scope}`}><span>{item.title}{item.evidence ? ` · ${EVIDENCE_LABELS[item.evidence.kind]}` : ""}</span><button onClick={() => onRemove(item)} aria-label={`删除借鉴 ${item.title}`}><Trash2 />删除</button></div>)}</section>}
      <div className="reference-dialog-foot"><span>已选 {scoped.length} 项 · 收藏参考与应用为本书文风是两件事</span><Button onClick={() => onOpenChange(false)}>完成</Button></div>
    </DialogContent>
  </Dialog>;
}

function SearchResults({ results, selected, onAdd }: { results: ReferenceItem[]; selected: ReferenceItem[]; onAdd: (item: ReferenceItem) => void }) {
  return <div className="reference-results">
    {results.length === 0 && <div className="reference-empty"><BookMarked /><strong>建立自己的借鉴库</strong><p>搜索作品、类型、人物或作家，结果会作为生成时的结构参考。</p></div>}
    {results.map((result) => {
      const added = selected.some((item) => item.id === result.id && item.scope === result.scope);
      return <article key={result.id}>
        <div className="reference-result-icon">{result.source === "本地文件" || result.source === "粘贴原文" ? <FileText /> : <BookMarked />}</div>
        <div>
          <div className="reference-result-title"><strong>{result.title}</strong><span>{result.source}</span>{result.evidence && <span>{EVIDENCE_LABELS[result.evidence.kind]}</span>}{result.url && <a href={result.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>查看来源 <ExternalLink /></a>}</div>
          <p>{result.summary.slice(0, 190) || "暂无摘要"}</p>
          {result.evidence?.note && <small className="reference-evidence-note">{result.evidence.note}</small>}
        </div>
        <Button variant={added ? "secondary" : "outline"} size="sm" disabled={added} onClick={() => onAdd(result)}>{added ? <><Check />已加入</> : "加入借鉴"}</Button>
      </article>;
    })}
  </div>;
}

function briefOf(assist: AssistDraft) {
  return parseReferenceBrief(assist.input || "自定义表达要求", { scope: assist.scope });
}

function describePlan(plan: StylePlan) {
  const target = plan.entity.name ? `${plan.entity.name}（${ENTITY_KIND_LABELS[plan.entity.kind]}·${MEDIUM_LABELS[plan.entity.medium]}）` : "自定义表达要求";
  return `${target}，共 ${plan.directions.length} 个表达方向、${plan.rules.length} 条规则`;
}
