"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GitCompareArrows, Info, LoaderCircle, Lock, LockOpen, MessageCircle, Send, Sparkles, Square, Trash2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ADOPT_MODE_LABELS, adoptTextProposal, appendThreadMessage, availableAdoptModes, buildCoContext, clearThread,
  defaultTaskFor, describeRoadmapOp, isLocked, isRoadmapProposal, lockInstruction, makeRoadmapProposal, makeTextProposal,
  moduleText, parseRoadmapOps, applyRoadmapOps, splitCandidates, targetKey, toggleLock,
  THREE_DIRECTIONS_HINT, type AdoptMode, type CoProposalRecord, type CoTarget, type TextAnchor,
} from "@/lib/co-creation";
import { getRoadmap, type StoryRoadmap } from "@/lib/story-roadmap";
import type { BookWorkspace, PlotGenerationOptions, StoryMessage } from "./book-workspace";
import type { ReferenceItem, ReferenceScope } from "./reference-library-dialog";

type Tab = "detail" | "discuss" | "pending";
type Running = null | "discuss" | "candidate" | "triple";

type Props = {
  bookId: string;
  workspace: BookWorkspace;
  target: CoTarget;
  busy: boolean;
  connection: string;
  selection?: TextAnchor | null;
  onWorkspaceChange: (patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) => void;
  onGenerate: (prompt: string, task: string, options?: PlotGenerationOptions) => Promise<string>;
  onApplyText: (target: CoTarget, content: string, label: string) => void;
  onApplyRoadmap: (roadmap: StoryRoadmap, label: string) => void;
  onCancel: () => void;
  onNotify: (message: string) => void;
  onOpenReferences: (scope: ReferenceScope) => void;
  onRemoveReference: (item: ReferenceItem) => void;
  onFocusEditor?: () => void;
  externalRun?: { id: number; instruction: string } | null;
};

const tabs: { id: Tab; label: string; icon: typeof Info }[] = [
  { id: "detail", label: "详情", icon: Info },
  { id: "discuss", label: "讨论", icon: MessageCircle },
  { id: "pending", label: "待采纳修改", icon: GitCompareArrows },
];

function nowStamp() { return new Date().toISOString(); }

export function CoCreationPanel({ bookId, workspace, target, busy, connection, selection, onWorkspaceChange, onGenerate, onApplyText, onApplyRoadmap, onCancel, onNotify, onOpenReferences, onRemoveReference, onFocusEditor, externalRun }: Props) {
  const [tab, setTab] = useState<Tab>("detail");
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState<Running>(null);
  const [showLegacy, setShowLegacy] = useState(false);
  const lock = useRef(false);
  const tail = useRef<HTMLDivElement>(null);

  const key = targetKey(target);
  const thread = workspace.threads[key];
  const roadmap = useMemo(() => getRoadmap(workspace.plot), [workspace.plot]);
  const context = useMemo(() => buildCoContext(workspace, target, thread, workspace.locks), [workspace, target, thread]);
  const locked = isLocked(workspace.locks, target);
  const proposals = workspace.coProposals.filter((proposal) => proposal.status === "pending" && targetKey(proposal.target) === key);
  const text = moduleText(workspace, target);
  const structured = ["roadmap", "event", "line"].includes(target.moduleId);
  const disabled = busy || running !== null;
  const messages = thread?.messages ?? [];
  const legacy = [
    { label: "全书对话（共创助手）", count: workspace.messages.length },
    { label: "世界线旧讨论", count: workspace.plot.discussion?.length ?? 0 },
  ].filter((entry) => entry.count > 0);

  // Opening a target that already has pending drafts lands on them, so a
  // preview created before navigating away is still in front of the author.
  const pendingNow = useRef(proposals);
  pendingNow.current = proposals;
  useEffect(() => { setTab(pendingNow.current.length ? "pending" : "detail"); setRequest(""); setError(""); }, [key]);
  // Blueprint's own "让 AI 完善" button drives the same candidate flow.
  useEffect(() => {
    if (!externalRun) return;
    void run("candidate", externalRun.instruction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRun?.id]);
  useEffect(() => { if (tab === "discuss" && messages.length) tail.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, tab]);

  function update(patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) { onWorkspaceChange(patch); }
  function say(message: StoryMessage) { update((w) => ({ ...w, threads: appendThreadMessage(w.threads, target, { ...message, at: nowStamp() }) })); }
  function setProposalStatus(id: string, status: "adopted" | "discarded") {
    update((w) => ({ ...w, coProposals: w.coProposals.map((proposal) => proposal.id === id ? { ...proposal, status } : proposal) }));
  }

  function candidateContext() {
    const parts = [`【本次修改目标】${context.targetLabel}`];
    if (locked) parts.push(`【作者锁定】${context.locked.map((field) => field === "full" ? "整段内容" : field).join("、")}，不要改写锁定内容。`);
    if (selection) parts.push(`【作者选中内容】\n${selection.text}`);
    if (context.discussionSummary) parts.push(`【讨论摘要】\n${context.discussionSummary}`);
    return parts.join("\n\n");
  }

  async function run(kind: "discuss" | "candidate" | "triple", instructionOverride?: string) {
    if (disabled || lock.current) return;
    const instruction = (instructionOverride ?? request).trim();
    if (kind === "discuss" && !instruction) return;
    lock.current = true; setRunning(kind); setError("");
    try {
      if (kind === "discuss") {
        const answer = await onGenerate(instruction, defaultTaskFor(target, "discuss"), { messages, context: candidateContext() });
        say({ role: "user", text: instruction });
        say({ role: "ai", text: answer });
        setRequest("");
        setTab("discuss");
      } else {
        const prompt = kind === "triple"
          ? `${instruction || `为「${context.targetLabel}」给出可选方案。`}\n${THREE_DIRECTIONS_HINT}`
          : `${instruction || `请为「${context.targetLabel}」生成候选稿。`}\n只输出可直接采用的候选内容，不要解释。`;
        const answer = await onGenerate(`${prompt}${lockInstruction(context.locked)}`, defaultTaskFor(target, "generate"), { messages, context: candidateContext() });
        say({ role: "user", text: instruction || (kind === "triple" ? "给我三个方向" : "生成候选稿") });
        if (structured) {
          const ops = parseRoadmapOps(answer, roadmap);
          if ("error" in ops) {
            say({ role: "ai", text: `这次没有产生可采纳的修改：${ops.error}\n\n${answer.slice(0, 1500)}` });
            setError(ops.error);
          } else if (!ops.length) {
            say({ role: "ai", text: `AI 认为当前结构不需要修改：\n\n${answer.slice(0, 1500)}` });
            setError("AI 认为不需要修改世界线结构，可以继续讨论具体想法。");
          } else {
            const proposal = makeRoadmapProposal({ bookId, target, targetLabel: context.targetLabel, ops, baseRevision: workspace.plot.version, threadKey: key, instruction: instruction || undefined });
            update((w) => ({ ...w, coProposals: [...w.coProposals, proposal] }));
            say({ role: "ai", text: `已整理 ${ops.length} 项待采纳修改：\n${ops.map((op) => `· ${describeRoadmapOp(op, roadmap)}`).join("\n")}` });
            setTab("pending");
          }
        } else {
          const drafts = kind === "triple" ? splitCandidates(answer) : [answer];
          const created = drafts.map((draft) => makeTextProposal({
            bookId, target, targetLabel: context.targetLabel, content: text, after: draft,
            scope: selection ? "selection" : "full", anchor: selection ?? null,
            baseRevision: workspace.plot.version, threadKey: key, instruction: instruction || undefined,
          }));
          update((w) => ({ ...w, coProposals: [...w.coProposals, ...created] }));
          say({ role: "ai", text: created.length > 1 ? `已生成 ${created.length} 份候选稿，请在「待采纳修改」中比较后选择。` : "已生成候选稿，请在「待采纳修改」中确认是否采纳。" });
          setTab("pending");
        }
        setRequest("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法连接 AI，讨论与输入已保留。");
    } finally { lock.current = false; setRunning(null); }
  }

  function draftFromLastReply() {
    const last = [...messages].reverse().find((message) => message.role === "ai");
    if (!last) { setError("还没有可以整理的 AI 建议。"); return; }
    const created = makeTextProposal({ bookId, target, targetLabel: context.targetLabel, content: text, after: last.text, scope: selection ? "selection" : "full", anchor: selection ?? null, baseRevision: workspace.plot.version, threadKey: key, instruction: "由讨论整理" });
    update((w) => ({ ...w, coProposals: [...w.coProposals, created] }));
    onNotify("已把最后一条建议整理为候选稿");
    setTab("pending");
  }

  function adopt(proposal: CoProposalRecord, mode: AdoptMode) {
    setError("");
    if (locked) { setError(`「${proposal.targetLabel}」已被作者锁定，AI 不能改写。请先解锁再采纳。`); return; }
    if (isRoadmapProposal(proposal)) {
      const result = applyRoadmapOps(roadmap, proposal.ops);
      if ("error" in result) { setError(result.error); return; }
      onApplyRoadmap(result.roadmap, `采纳 AI 剧情修改：${proposal.ops.length} 项`);
      setProposalStatus(proposal.id, "adopted");
      say({ role: "ai", text: "已按作者的确认采纳本次剧情修改，修改前内容保留在故事版本中。" });
      onNotify("已采纳剧情修改，可在故事版本中恢复");
      return;
    }
    const result = adoptTextProposal(moduleText(workspace, target), proposal, mode);
    if ("error" in result) { setError(result.error); return; }
    if (!result.changed) { setProposalStatus(proposal.id, "adopted"); onNotify("内容已经是最新的，无需重复写入"); return; }
    onApplyText(target, result.content, `采纳 AI 候选稿：${proposal.targetLabel}`);
    setProposalStatus(proposal.id, "adopted");
    onNotify("已采纳候选稿，修改前内容保留在版本记录中");
  }

  function editCandidate(proposal: CoProposalRecord, value: string) {
    if (isRoadmapProposal(proposal)) return;
    update((w) => ({ ...w, coProposals: w.coProposals.map((item) => item.id === proposal.id && !isRoadmapProposal(item) ? { ...item, after: value } : item) }));
  }

  return <section className="co-panel" aria-label="共创助手">
    <header className="co-heading">
      <div>
        <span className="co-mark"><Sparkles /></span>
        <div><h2>共创助手</h2><p className="co-target" title={context.targetLabel}>{context.targetLabel}</p></div>
      </div>
      <button type="button" className="co-lock" onClick={() => update((w) => ({ ...w, locks: toggleLock(w.locks, target) }))} aria-pressed={locked} title={locked ? "已锁定：AI 只能建议，不能改写" : "锁定本目标，阻止 AI 改写"}>
        {locked ? <Lock /> : <LockOpen />}{locked ? "已锁定" : "锁定"}
      </button>
    </header>

    <div className="co-tabs" role="tablist" aria-label="共创视图">
      {tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><Icon />{label}{id === "pending" && proposals.length > 0 && <em>{proposals.length}</em>}</button>)}
    </div>

    {tab === "detail" && <div className="co-body">
      <p className="co-note">主编辑区随时可以直接手写；这里的 AI 操作只会产生候选稿，不会直接改写正文。</p>
      <dl className="co-context">
        {context.sections.map((section) => <div key={section.label} className={section.included ? "" : "is-off"}>
          <dt>{section.label}{section.included ? <Check /> : <em>未包含</em>}</dt>
          <dd>{section.detail}</dd>
        </div>)}
      </dl>
      <div className="co-references">
        <header><strong>参考范围</strong><span>{context.referenceScope ? `仅使用「${context.referenceScope}」类借鉴` : "使用全部借鉴"}</span></header>
        {workspace.references.filter((item) => !context.referenceScope || item.scope === context.referenceScope).slice(0, 5).map((item) => <div key={`${item.id}-${item.scope}`} className="co-reference-row"><span>{item.title}</span><button type="button" aria-label={`移除借鉴 ${item.title}`} onClick={() => onRemoveReference(item)}><Trash2 /></button></div>)}
        <Button variant="outline" size="sm" onClick={() => onOpenReferences((context.referenceScope as ReferenceScope) ?? "plot")}>增减借鉴资料</Button>
      </div>
      <label className="co-request"><span>本次要求</span><Textarea aria-label="本页生成要求" maxLength={4000} disabled={disabled} value={request} onChange={(event) => setRequest(event.target.value)} placeholder={`想让 AI 为「${context.targetLabel}」做什么？留空则按默认要求生成候选稿。`} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void run("candidate"); } }} /></label>
      <div className="co-selection-note">{selection ? `已选中：${selection.text.slice(0, 40)}${selection.text.length > 40 ? "…" : ""}` : "未选择局部目标，候选稿按整段处理"}{!selection && onFocusEditor && <button type="button" onClick={onFocusEditor}>去选中一段</button>}</div>
      <div className="co-actions">
        <Button disabled={disabled} onClick={() => void run("candidate")}>{running === "candidate" ? <LoaderCircle className="spin" /> : <WandSparkles />}{running === "candidate" ? "正在生成…" : "生成预览"}</Button>
        <Button variant="outline" disabled={disabled} onClick={() => void run("triple")}>{running === "triple" ? <LoaderCircle className="spin" /> : <Sparkles />}给我三个方向</Button>
        {running && <Button variant="outline" onClick={() => { onCancel(); setRunning(null); }}><Square />停止生成</Button>}
      </div>
      {error && <p className="co-error" role="alert">{error}</p>}
      <p className="co-footnote">连接状态：{connection || "未配置"}。上下文=本书设定 + 本目标要求 + 讨论摘要，候选稿经你确认才会写入。</p>
    </div>}

    {tab === "discuss" && <div className="co-body">
      {!messages.length ? <div className="co-empty"><h3>先和 AI 聊聊这一部分</h3><p>讨论默认只给建议，不会改动正式内容；满意时再点「整理为候选稿」。</p><div className="co-starters">{[`帮我检查「${context.targetLabel}」有没有逻辑漏洞`, "这里有哪些可选的处理方式？", "哪种写法更贴合已有设定？"].map((text) => <button type="button" key={text} disabled={disabled} onClick={() => setRequest(text)}>{text}</button>)}</div></div>
        : <div className="co-thread" role="log" aria-label="讨论记录">{messages.map((message, index) => <article key={`${message.at}-${index}`} className={message.role}><strong>{message.role === "user" ? "我" : "AI"}</strong><p>{message.text}</p></article>)}<div ref={tail} /></div>}
      <label className="co-request"><span>讨论内容</span><Textarea aria-label="共创讨论输入" maxLength={4000} disabled={disabled} value={request} onChange={(event) => setRequest(event.target.value)} placeholder="说说你的想法，或直接提问；Ctrl/Cmd + Enter 发送。" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void run("discuss"); } }} /></label>
      <div className="co-actions">
        <Button disabled={disabled || !request.trim()} onClick={() => void run("discuss")}>{running === "discuss" ? <LoaderCircle className="spin" /> : <Send />}{running === "discuss" ? "正在思考…" : "发送讨论"}</Button>
        <Button variant="outline" disabled={disabled || !messages.some((message) => message.role === "ai")} onClick={draftFromLastReply}>整理为候选稿</Button>
        {running && <Button variant="outline" onClick={() => { onCancel(); setRunning(null); }}><Square />停止生成</Button>}
        {messages.length > 0 && <Button variant="ghost" disabled={disabled} onClick={() => { update((w) => ({ ...w, threads: clearThread(w.threads, target) })); onNotify("已清空本次讨论，正式内容未改动"); }}>清空本次讨论</Button>}
      </div>
      {error && <p className="co-error" role="alert">{error}</p>}
      <p className="co-footnote">讨论按「{context.targetLabel}」独立保存，不会混入其他模块的对话。</p>
      {legacy.length > 0 && <details className="co-legacy" open={showLegacy} onToggle={(event) => setShowLegacy((event.target as HTMLDetailsElement).open)}><summary>兼容会话（保留原样）</summary>{legacy.map((entry) => <p key={entry.label}>{entry.label}：{entry.count} 条，仍在原入口查看，未归属到当前目标。</p>)}</details>}
    </div>}

    {tab === "pending" && <div className="co-body">
      {!proposals.length ? <div className="co-empty"><h3>暂无待采纳的修改</h3><p>在「详情」生成候选稿，或先在「讨论」里聊清楚再整理成候选稿。</p></div> : proposals.map((proposal) => isRoadmapProposal(proposal)
        ? <article key={proposal.id} className="co-proposal">
          <header><strong>剧情修改候选</strong><span>{new Date(proposal.createdAt).toLocaleString("zh-CN")}</span></header>
          <ul className="co-ops">{proposal.ops.map((op, index) => <li key={index}>{describeRoadmapOp(op, roadmap)}</li>)}</ul>
          {locked && <p className="co-warning" role="alert"><Lock />该目标已锁定，解锁后才能采纳。</p>}
          <div className="co-actions"><Button disabled={disabled || locked} onClick={() => adopt(proposal, "replace-all")}><Check />采纳这些修改</Button><Button variant="outline" disabled={disabled} onClick={() => setProposalStatus(proposal.id, "discarded")}>拒绝这份候选</Button></div>
        </article>
        : <article key={proposal.id} className="co-proposal">
          <header><strong>候选稿</strong><span>{proposal.scope === "selection" ? "针对选中内容" : "针对整段内容"}</span></header>
          <details className="co-diff"><summary>查看原文对比</summary><pre>{proposal.before || "（原本为空）"}</pre></details>
          <label className="co-candidate"><span>候选内容（可直接编辑）</span><Textarea aria-label={target.moduleId === "overview" ? "故事构想预览" : "生成结果预览"} maxLength={200000} disabled={disabled} value={proposal.after} onChange={(event) => editCandidate(proposal, event.target.value)} /></label>
          <div className="co-adopt-modes">{availableAdoptModes(proposal).map((mode) => <Button key={mode} variant={mode === "replace-all" || mode === "replace-selection" ? "default" : "outline"} disabled={disabled || locked} onClick={() => adopt(proposal, mode)}>{mode === "replace-all" ? (target.moduleId === "overview" ? "采纳故事构想" : "替换当前内容") : mode === "append" ? "追加到末尾" : ADOPT_MODE_LABELS[mode]}</Button>)}</div>
          {locked && <p className="co-warning" role="alert"><Lock />该目标已锁定，解锁后才能采纳。</p>}
          <Button className="co-discard" variant="ghost" disabled={disabled} onClick={() => setProposalStatus(proposal.id, "discarded")}>放弃本次结果</Button>
        </article>)}
      {error && <p className="co-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
