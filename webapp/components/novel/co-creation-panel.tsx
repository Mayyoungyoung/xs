"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GitCompareArrows, Info, LoaderCircle, Lock, LockOpen, MessageCircle, Send, Sparkles, Square, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ADOPT_MODE_LABELS, appendThreadMessage, availableAdoptModes, buildContextPacket, captureBaseFields,
  clearThread, defaultTaskFor, describeOpDiff, describeRoadmapOp, isLocked, isRoadmapProposal, makeRoadmapProposal,
  makeTextProposal, moduleText, parseRoadmapOps, setThreadDraft, splitCandidates, targetKey, toggleLock,
  THREE_DIRECTIONS_HINT, type AdoptMode, type CoProposalRecord, type CoTarget, type TextAnchor,
} from "@/lib/co-creation";
import { getRoadmap } from "@/lib/story-roadmap";
import type { BookWorkspace, PlotGenerationOptions, StoryMessage } from "./book-workspace";
import type { ReferenceItem, ReferenceScope } from "./reference-library-dialog";

type Tab = "detail" | "discuss" | "pending";
type Running = null | "discuss" | "candidate" | "triple" | "convert";

export type AdoptOptions = { mode?: AdoptMode; opIndexes?: number[]; allowRelocatedAnchor?: boolean; confirmProgress?: boolean };
export type AdoptOutcome =
  | { ok: true; note: string }
  | { ok: false; error: string; needsConfirmation?: "progress"; relocation?: { status: string; count?: number } };

type Props = {
  bookId: string;
  workspace: BookWorkspace;
  target: CoTarget;
  busy: boolean;
  modelConnection: string;
  saveState?: string;
  selection?: TextAnchor | null;
  onWorkspaceChange: (patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) => void;
  onGenerate: (prompt: string, task: string, options?: PlotGenerationOptions) => Promise<string>;
  onAdopt: (proposalId: string, options: AdoptOptions) => AdoptOutcome;
  onCancel: () => void;
  onNotify: (message: string) => void;
  onOpenReferences: (scope: ReferenceScope) => void;
  onRemoveReference: (item: ReferenceItem) => void;
  onFocusEditor?: () => void;
  externalRun?: { id: number; instruction: string; task?: string } | null;
};

const tabs: { id: Tab; label: string; icon: typeof Info }[] = [
  { id: "detail", label: "详情", icon: Info },
  { id: "discuss", label: "讨论", icon: MessageCircle },
  { id: "pending", label: "待采纳修改", icon: GitCompareArrows },
];

function nowStamp() { return new Date().toISOString(); }

export function CoCreationPanel({ bookId, workspace, target, busy, modelConnection, saveState, selection, onWorkspaceChange, onGenerate, onAdopt, onCancel, onNotify, onOpenReferences, onRemoveReference, onFocusEditor, externalRun }: Props) {
  const [tab, setTab] = useState<Tab>("detail");
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState<Running>(null);
  const [selectedOps, setSelectedOps] = useState<Record<string, number[]>>({});
  const [progressConfirmed, setProgressConfirmed] = useState<Record<string, boolean>>({});
  const [relocatePrompt, setRelocatePrompt] = useState<Record<string, { status: string; count?: number }>>({});
  const [showLegacy, setShowLegacy] = useState(false);
  const lock = useRef(false);
  const tail = useRef<HTMLDivElement>(null);

  const key = targetKey(target);
  const thread = workspace.threads[key];
  const roadmap = useMemo(() => getRoadmap(workspace.plot), [workspace.plot]);
  const pending = workspace.coProposals.filter((proposal) => proposal.status === "pending" && targetKey(proposal.target) === key);
  const packet = useMemo(() => buildContextPacket({ workspace, target, thread, locks: workspace.locks, selection: selection ?? null, pendingCandidates: pending }), [workspace, target, thread, selection, pending]);
  const locked = isLocked(workspace.locks, target);
  const structured = ["roadmap", "event", "line"].includes(target.moduleId);
  const disabled = busy || running !== null;
  const messages = thread?.messages ?? [];
  const draft = thread?.draft ?? "";
  const legacy = [
    { label: "全书对话（共创助手）", count: workspace.messages.length },
    { label: "世界线旧讨论", count: workspace.plot.discussion?.length ?? 0 },
  ].filter((entry) => entry.count > 0);

  const pendingNow = useRef(pending);
  pendingNow.current = pending;
  useEffect(() => { setTab(pendingNow.current.length ? "pending" : "detail"); setRequest(""); setError(""); }, [key]);
  useEffect(() => {
    if (!externalRun) return;
    void run("candidate", externalRun.instruction, externalRun.task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRun?.id]);
  useEffect(() => { if (tab === "discuss" && messages.length) tail.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, tab]);

  function update(patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) { onWorkspaceChange(patch); }
  function say(message: StoryMessage) { update((w) => ({ ...w, threads: appendThreadMessage(w.threads, target, { ...message, at: nowStamp() }) })); }
  function saveDraft(value: string) { setRequest(value); update((w) => ({ ...w, threads: setThreadDraft(w.threads, target, value) })); }
  function discardProposal(id: string) { update((w) => ({ ...w, coProposals: w.coProposals.map((item) => item.id === id ? { ...item, status: "discarded" as const } : item) })); }

  async function run(kind: Exclude<Running, null>, instructionOverride?: string, taskOverride?: string) {
    if (disabled || lock.current) return;
    const instruction = (instructionOverride ?? request).trim();
    if (kind === "discuss" && !instruction) return;
    lock.current = true; setRunning(kind); setError("");
    try {
      if (kind === "discuss") {
        const answer = await onGenerate(instruction, defaultTaskFor(target, "discuss"), { messages, packet });
        say({ role: "user", text: instruction });
        say({ role: "ai", text: answer });
        saveDraft("");
        setTab("discuss");
      } else if (kind === "convert") {
        const conversion = structured
          ? `把以下讨论中作者已经确认的决定整理成剧情修改。只改讨论中明确确认的部分，其他内容保持不变。\n\n讨论与要求：\n${instruction || "按讨论整理"}`
          : `把以下讨论中作者已经确认的决定整理成可直接采纳的「${packet.targetLabel}」内容，只输出内容，不要解释。\n\n讨论与要求：\n${instruction || "按讨论整理"}`;
        const answer = await onGenerate(conversion, structured ? "roadmap_edit" : defaultTaskFor(target, "generate"), { messages, packet });
        const source = pending[0]?.id;
        say({ role: "ai", text: structured ? "已根据讨论整理出一份待采纳的剧情修改。" : "已根据讨论整理出一份候选稿。" });
        createCandidates(answer, { revisedFrom: source, instruction: instruction || "由讨论整理", label: "整理自讨论" });
      } else if (kind === "triple") {
        if (structured) {
          const answer = await onGenerate(`${instruction || `针对「${packet.targetLabel}」给出三个不同的处理方向，比较取舍，不要直接修改剧情。`}\n请用三小节分别说明，先不要给出修改指令。`, "plot_discussion", { messages, packet });
          say({ role: "user", text: instruction || "讨论三个方向" });
          say({ role: "ai", text: answer });
          saveDraft("");
          setTab("discuss");
        } else {
          const answer = await onGenerate(`${instruction || `为「${packet.targetLabel}」给出三个不同的可选方案。`}\n${THREE_DIRECTIONS_HINT}`, defaultTaskFor(target, "generate"), { messages, packet });
          say({ role: "user", text: instruction || "给我三个方向" });
          createCandidates(answer, { instruction: instruction || "三个方向" });
        }
      } else {
        const prompt = taskOverride === "chapter_polish"
          ? `${instruction || "润色当前章节"}\n只输出润色后的完整正文，不要解释。`
          : `${instruction || `请为「${packet.targetLabel}」生成候选稿。`}\n只输出可直接采用的候选内容，不要解释。`;
        const answer = await onGenerate(prompt, taskOverride ?? defaultTaskFor(target, "generate"), { messages, packet });
        say({ role: "user", text: instruction || (taskOverride === "chapter_polish" ? "润色本章" : "生成候选稿") });
        say({ role: "ai", text: taskOverride === "chapter_polish" && !instruction ? "已生成润色候选，请在「待采纳修改」中对比后决定是否采纳。" : "已生成候选稿，请在「待采纳修改」中确认是否采纳。" });
        createCandidates(answer, { instruction: instruction || undefined, revisedFrom: pending[0]?.id });
      }
      setRequest("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法连接 AI，讨论与输入已保留。");
    } finally { lock.current = false; setRunning(null); }
  }

  // Every generation path funnels into the same candidate creation, so polish,
  // continue, local rewrite and blueprint completion all behave alike.
  function createCandidates(answer: string, options: { instruction?: string; revisedFrom?: string; label?: string }) {
    if (structured) {
      const parsed = parseRoadmapOps(answer, roadmap);
      if ("error" in parsed) {
        say({ role: "ai", text: `这次没有产生可采纳的修改：${parsed.error}\n\n${answer.slice(0, 1500)}` });
        setError(parsed.error);
        return;
      }
      if (!parsed.ops.length) {
        say({ role: "ai", text: `AI 认为当前结构不需要修改：\n\n${answer.slice(0, 1500)}` });
        setError("AI 认为不需要修改世界线结构，可以继续讨论具体想法。");
        return;
      }
      const proposal = makeRoadmapProposal({
        bookId, target, targetLabel: packet.targetLabel, ops: parsed.ops, baseRevision: workspace.plot.version,
        baseFields: captureBaseFields(roadmap, parsed.ops), progressEventIds: parsed.progressEventIds,
        threadKey: key, ...(options.instruction ? { instruction: options.instruction } : {}),
        ...(options.revisedFrom ? { revisedFrom: options.revisedFrom } : {}),
      });
      update((w) => ({ ...w, coProposals: [...w.coProposals, proposal] }));
      if (parsed.warnings.length) say({ role: "ai", text: `注意：${parsed.warnings.join("；")}` });
      setTab("pending");
      return;
    }
    const drafts = options.label === undefined && /===候选/.test(answer) ? splitCandidates(answer) : [answer];
    const created = drafts.map((draftText) => makeTextProposal({
      bookId, target, targetLabel: packet.targetLabel, content: moduleText(workspace, target), after: draftText,
      scope: selection ? "selection" : "full", anchor: selection ?? null,
      baseRevision: workspace.plot.version, threadKey: key,
      ...(options.instruction ? { instruction: options.instruction } : {}),
      ...(options.revisedFrom ? { revisedFrom: options.revisedFrom } : {}),
    }));
    update((w) => ({ ...w, coProposals: [...w.coProposals, ...created] }));
    setTab("pending");
  }

  // Explicit conversion action for event/line targets: the author's own
  // discussion is turned into a candidate by the model, not by copying text.
  function convertDiscussion() {
    void run("convert", messages.length ? "按以上讨论整理" : "");
  }

  function referenceLastReply() {
    const last = [...messages].reverse().find((message) => message.role === "ai");
    if (!last) { setError("还没有可以引用的 AI 建议。"); return; }
    if (structured) { setError("这个目标是结构化剧情，请使用「整理为候选稿」，或在正文模块引用回复。"); return; }
    const created = makeTextProposal({ bookId, target, targetLabel: packet.targetLabel, content: moduleText(workspace, target), after: last.text, scope: selection ? "selection" : "full", anchor: selection ?? null, baseRevision: workspace.plot.version, threadKey: key, instruction: "引用讨论回复" });
    update((w) => ({ ...w, coProposals: [...w.coProposals, created] }));
    onNotify("已引用最后一条建议作为候选（未做改写）");
    setTab("pending");
  }

  function requestAdopt(proposal: CoProposalRecord, options: AdoptOptions) {
    setError("");
    const outcome = onAdopt(proposal.id, options);
    if (outcome.ok) {
      setRelocatePrompt((current) => { const next = { ...current }; delete next[proposal.id]; return next; });
      onNotify(outcome.note);
      return;
    }
    setError(outcome.error);
    if (outcome.relocation) setRelocatePrompt((current) => ({ ...current, [proposal.id]: outcome.relocation! }));
    if (outcome.needsConfirmation === "progress") setProgressConfirmed((current) => ({ ...current, [proposal.id]: true }));
  }

  const opIndexesFor = (proposalId: string, count: number) => selectedOps[proposalId] ?? Array.from({ length: count }, (_, index) => index);
  function toggleOp(proposalId: string, index: number, count: number) {
    const current = opIndexesFor(proposalId, count);
    setSelectedOps((all) => ({ ...all, [proposalId]: current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((a, b) => a - b) }));
  }

  return <section className="co-panel" aria-label="共创助手">
    <header className="co-heading">
      <div>
        <span className="co-mark"><Sparkles /></span>
        <div><h2>共创助手</h2><p className="co-target" title={packet.targetLabel}>{packet.targetLabel}</p></div>
      </div>
      <button type="button" className="co-lock" onClick={() => update((w) => ({ ...w, locks: toggleLock(w.locks, target) }))} aria-pressed={locked} title={locked ? "已锁定：AI 只能建议，不能改写（不影响你手写）" : "锁定本目标，阻止 AI 改写"}>
        {locked ? <Lock /> : <LockOpen />}{locked ? "已锁定" : "锁定"}
      </button>
    </header>

    <div className="co-tabs" role="tablist" aria-label="共创视图">
      {tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><Icon />{label}{id === "pending" && pending.length > 0 && <em>{pending.length}</em>}</button>)}
    </div>

    {tab === "detail" && <div className="co-body">
      <p className="co-note">主编辑区随时可以直接手写；这里的 AI 操作只会产生候选稿，不会直接改写正文。</p>
      <dl className="co-context">
        {packet.sections.map((section) => <div key={section.label} className={section.included ? "" : "is-off"}>
          <dt>{section.label}{section.included ? <Check /> : <em>未包含</em>}</dt>
          <dd>{section.detail}</dd>
        </div>)}
      </dl>
      <div className="co-references">
        <header><strong>参考范围</strong><span>{packet.referenceScope ? `仅发送「${packet.referenceScope}」类借鉴 ${packet.references.length} 项` : `发送全部借鉴 ${packet.references.length} 项`}</span></header>
        {workspace.references.filter((item) => !packet.referenceScope || item.scope === packet.referenceScope).slice(0, 5).map((item) => <div key={`${item.id}-${item.scope}`} className="co-reference-row"><span>{item.title}</span><button type="button" aria-label={`从本目标移除借鉴 ${item.title}`} title="只从本目标的参考范围移除，不会删除借鉴库中的资料" onClick={() => onRemoveReference(item)}><X /></button></div>)}
        {packet.trimming.map((note) => <p key={note} className="co-trimming" role="status">{note}</p>)}
        <Button variant="outline" size="sm" onClick={() => onOpenReferences((packet.referenceScope as ReferenceScope) ?? "plot")}>查看或增减借鉴</Button>
      </div>
      <label className="co-request"><span>本次要求</span><Textarea aria-label="本页生成要求" maxLength={4000} disabled={disabled} value={request} onChange={(event) => saveDraft(event.target.value)} placeholder={`想让 AI 为「${packet.targetLabel}」做什么？留空则按默认要求生成候选稿。`} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void run("candidate"); } }} /></label>
      <div className="co-selection-note">{selection ? `已选中：${selection.text.slice(0, 40)}${selection.text.length > 40 ? "…" : ""}` : "未选择局部目标，候选稿按整段处理"}{!selection && onFocusEditor && <button type="button" onClick={onFocusEditor}>去选中一段</button>}</div>
      <div className="co-actions">
        <Button disabled={disabled} onClick={() => void run("candidate")}>{running === "candidate" ? <LoaderCircle className="spin" /> : <WandSparkles />}{running === "candidate" ? "正在生成…" : "生成预览"}</Button>
        <Button variant="outline" disabled={disabled} onClick={() => void run("triple")}>{running === "triple" ? <LoaderCircle className="spin" /> : <Sparkles />}{structured ? "讨论三个方向" : "给我三个方向"}</Button>
        {running && <Button variant="outline" onClick={() => { onCancel(); setRunning(null); }}><Square />停止生成</Button>}
      </div>
      {error && <p className="co-error" role="alert">{error}</p>}
      <p className="co-footnote">模型连接：{modelConnection || "未配置"}；保存状态：{saveState ?? "—"}。上下文共 {packet.text.length} 字符。</p>
    </div>}

    {tab === "discuss" && <div className="co-body">
      {!messages.length ? <div className="co-empty"><h3>先和 AI 聊聊这一部分</h3><p>讨论默认只给建议，不会改动正式内容；满意时再点「整理为候选稿」。</p><div className="co-starters">{[`帮我检查「${packet.targetLabel}」有没有逻辑漏洞`, "这里有哪些可选的处理方式？", "哪种写法更贴合已有设定？"].map((text) => <button type="button" key={text} disabled={disabled} onClick={() => saveDraft(text)}>{text}</button>)}</div></div>
        : <div className="co-thread" role="log" aria-label="讨论记录">{messages.map((message, index) => <article key={`${message.at}-${index}`} className={message.role}><strong>{message.role === "user" ? "我" : "AI"}</strong><p>{message.text}</p></article>)}<div ref={tail} /></div>}
      <label className="co-request"><span>讨论内容</span><Textarea aria-label="共创讨论输入" maxLength={4000} disabled={disabled} value={draft} onChange={(event) => saveDraft(event.target.value)} placeholder="说说你的想法，或直接提问；Ctrl/Cmd + Enter 发送。切换目标后草稿会保留。" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void run("discuss"); } }} /></label>
      <div className="co-actions">
        <Button disabled={disabled || !draft.trim()} onClick={() => void run("discuss")}>{running === "discuss" ? <LoaderCircle className="spin" /> : <Send />}{running === "discuss" ? "正在思考…" : "发送讨论"}</Button>
        <Button variant="outline" disabled={disabled || !messages.some((message) => message.role === "ai")} onClick={convertDiscussion}>{running === "convert" ? <LoaderCircle className="spin" /> : <WandSparkles />}{running === "convert" ? "正在整理…" : "整理为候选稿"}</Button>
        {!structured && <Button variant="ghost" disabled={disabled || !messages.some((message) => message.role === "ai")} onClick={referenceLastReply}>引用最后一条建议</Button>}
        {running && <Button variant="outline" onClick={() => { onCancel(); setRunning(null); }}><Square />停止生成</Button>}
        {messages.length > 0 && <Button variant="ghost" disabled={disabled} onClick={() => { update((w) => ({ ...w, threads: clearThread(w.threads, target) })); onNotify("已清空本次讨论，正式内容未改动"); }}>清空本次讨论</Button>}
      </div>
      {error && <p className="co-error" role="alert">{error}</p>}
      <p className="co-footnote">讨论按「{packet.targetLabel}」独立保存，不会混入其他模块的对话。</p>
      {legacy.length > 0 && <details className="co-legacy" open={showLegacy} onToggle={(event) => setShowLegacy((event.target as HTMLDetailsElement).open)}><summary>兼容会话（保留原样）</summary>{legacy.map((entry) => <p key={entry.label}>{entry.label}：{entry.count} 条，仍在原入口查看，未归属到当前目标。</p>)}</details>}
    </div>}

    {tab === "pending" && <div className="co-body">
      {!pending.length ? <div className="co-empty"><h3>暂无待采纳的修改</h3><p>在「详情」生成候选稿，或先在「讨论」里聊清楚再整理成候选稿。</p></div> : pending.map((proposal) => isRoadmapProposal(proposal)
        ? <article key={proposal.id} className="co-proposal">
          <header><strong>剧情修改候选</strong><span>{proposal.revisedFrom ? "由讨论修订 · " : ""}{new Date(proposal.createdAt).toLocaleString("zh-CN")}</span></header>
          <ul className="co-op-list">{proposal.ops.map((op, index) => {
            const indexes = opIndexesFor(proposal.id, proposal.ops.length);
            const diffs = describeOpDiff(op, roadmap, proposal.baseFields);
            return <li key={index} className={indexes.includes(index) ? "" : "is-off"}>
              <label><input type="checkbox" disabled={disabled} checked={indexes.includes(index)} onChange={() => toggleOp(proposal.id, index, proposal.ops.length)} /><span>{describeRoadmapOp(op, roadmap)}</span></label>
              <ul className="co-diffs">{diffs.map((diff) => <li key={diff.field} className={diff.progress ? "is-progress" : ""}><em>{diff.label}</em><span className="before">{diff.before}</span><span className="arrow">→</span><span className="after">{diff.after}</span></li>)}</ul>
            </li>;
          })}</ul>
          {proposal.progressEventIds?.length ? <p className="co-progress-note" role="status">包含写作进度变化：{proposal.progressEventIds.join("、")}。AI 改剧情不等于事件已写完。</p> : null}
          {progressConfirmed[proposal.id] && <label className="co-confirm"><input type="checkbox" checked disabled /><span>我会单独确认进度变化后再标记已写完</span></label>}
          {locked && <p className="co-warning" role="alert"><Lock />该目标已锁定，解锁后才能采纳。</p>}
          <div className="co-actions">
            <Button disabled={disabled || locked} onClick={() => requestAdopt(proposal, { opIndexes: opIndexesFor(proposal.id, proposal.ops.length), confirmProgress: Boolean(progressConfirmed[proposal.id]) || !proposal.progressEventIds?.length })}><Check />采纳选中的修改</Button>
            <Button variant="outline" disabled={disabled} onClick={() => discardProposal(proposal.id)}>拒绝这份候选</Button>
          </div>
        </article>
        : <article key={proposal.id} className="co-proposal">
          <header><strong>候选稿</strong><span>{proposal.scope === "selection" ? "针对选中内容" : "针对整段内容"}{proposal.revisedFrom ? " · 由讨论修订" : ""}{proposal.instruction ? ` · ${proposal.instruction}` : ""}</span></header>
          <details className="co-diff" open><summary>原文与候选对比</summary><div className="co-diff-body"><div><em>原文</em><pre>{proposal.before || "（原本为空）"}</pre></div><div><em>候选</em><pre>{proposal.after}</pre></div></div></details>
          <label className="co-candidate"><span>候选内容（可直接编辑）</span><Textarea aria-label={target.moduleId === "overview" ? "故事构想预览" : "生成结果预览"} maxLength={200000} disabled={disabled} value={proposal.after} onChange={(event) => update((w) => ({ ...w, coProposals: w.coProposals.map((item) => item.id === proposal.id && !isRoadmapProposal(item) ? { ...item, after: event.target.value } : item) }))} /></label>
          <div className="co-adopt-modes">{availableAdoptModes(proposal).map((mode) => <Button key={mode} variant={mode === "replace-all" || mode === "replace-selection" ? "default" : "outline"} disabled={disabled || locked} onClick={() => requestAdopt(proposal, { mode })}>{mode === "replace-all" ? (target.moduleId === "overview" ? "采纳故事构想" : "替换当前内容") : mode === "append" ? "追加到末尾" : ADOPT_MODE_LABELS[mode]}</Button>)}</div>
          {relocatePrompt[proposal.id]?.status === "unique" && <div className="co-relocation" role="status"><p>选中内容的位置已变化，但能用上下文确定唯一的新位置。</p><Button variant="outline" size="sm" disabled={disabled} onClick={() => requestAdopt(proposal, { mode: "replace-selection", allowRelocatedAnchor: true })}>按新位置替换</Button></div>}
          {relocatePrompt[proposal.id]?.status === "ambiguous" && <p className="co-warning" role="alert">原文里有 {relocatePrompt[proposal.id]?.count} 处相同内容，请重新选中目标后再生成。</p>}
          {locked && <p className="co-warning" role="alert"><Lock />该目标已锁定，解锁后才能采纳。</p>}
          <Button className="co-discard" variant="ghost" disabled={disabled} onClick={() => discardProposal(proposal.id)}>放弃本次结果</Button>
        </article>)}
      {error && <p className="co-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
