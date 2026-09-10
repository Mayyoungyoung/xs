"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MessageCircle, Send, Sparkles, Square, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseGeneratedPlot } from "@/lib/novel-data";
import { getRoadmap } from "@/lib/story-roadmap";
import { roadmapSchema } from "@/lib/roadmap-schema";
import type { PlotGenerationOptions, PlotProposal, PlotState, StoryMessage } from "./book-workspace";

type Props = {
  state: PlotState; busy: boolean; referenceCount: number;
  onChange: (change: (current: PlotState) => PlotState) => void;
  onGenerate: (prompt: string, task: string, options?: PlotGenerationOptions) => Promise<string>;
  onCancel: () => void; onApplied: () => void;
  boundEventIds?: string[]; placeholder?: string;
};
const starters = ["先帮我梳理主角的目标和核心冲突", "给我三个不同的主线方向，并比较取舍", "检查现有主线的因果漏洞和人物动机", "一起设计一个意外但合理的结局"];
function proposalContext(proposal?: PlotProposal) {
  if (!proposal) return "";
  const roadmap = getRoadmap(proposal);
  return `待采纳方案摘要（尚未成为正式剧情）：\n${JSON.stringify({ summary: proposal.summary.slice(0, 4000), lines: roadmap.lines.map((line) => ({ ...line, goal: line.goal.slice(0, 500) })), events: roadmap.events.map((event) => ({ ...event, note: event.note.slice(0, 400) })) })}`;
}
export function PlotCopilot({ state, busy, referenceCount, onChange, onGenerate, onCancel, onApplied, boundEventIds = [], placeholder = "告诉 AI 这本书的主线方向，或希望如何调整已有路线。" }: Props) {
  const [pending, setPending] = useState<"discuss" | "generate" | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const tail = useRef<HTMLDivElement>(null);
  const history = state.discussion ?? [];
  const draft = state.discussionDraft ?? "";
  const proposal = state.proposal;
  const lostBindings = proposal ? new Set(boundEventIds.filter((id) => !getRoadmap(proposal).events.some((event) => event.id === id))).size : 0;
  const disabled = busy || pending !== null;
  useEffect(() => { if (history.length) tail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [history.length]);
  function setDraft(value: string) { onChange((current) => ({ ...current, discussionDraft: value })); }
  function editProposal(change: (p: PlotProposal) => PlotProposal) { onChange((current) => ({ ...current, proposal: current.proposal ? change(current.proposal) : undefined })); }
  function editEvent(index: number, patch: Partial<{ title: string; chapter: string; note: string }>) {
    editProposal((p) => p.roadmap ? { ...p, roadmap: { ...p.roadmap, events: p.roadmap.events.map((event, i) => index === i ? { ...event, ...patch } : event) } } : { ...p, nodes: p.nodes.map((event, i) => index === i ? { ...event, ...patch } : event) });
  }
  async function run(kind: "discuss" | "generate") {
    if (disabled || lock.current || (kind === "discuss" && !draft.trim())) return;
    lock.current = true; setPending(kind); setError("");
    const instruction = draft.trim() || "根据已讨论并确认的方向，生成完整主线方案。";
    const prompt = kind === "discuss" ? instruction : `请综合主线讨论中作者的选择与本书设定，生成完整、连贯的主线剧情方案。作者本次要求：${instruction}\n先在summary说明主角目标、核心冲突、人物成长、结局及待定事项；为每条主线定义独立目标，为支线指定衍生事件，通过共享事件连接交汇。每个事件的note写清选择、代价和后果，并安排推进顺序与章节范围。待采纳方案存在时，以它为基础吸收最新意见，保留未要求更改的内容。`;
    try {
      const result = await onGenerate(prompt, kind === "discuss" ? "plot_discussion" : "plot_update", { messages: history, context: proposalContext(proposal) });
      const nextProposal = kind === "generate" ? parseGeneratedPlot(result) : undefined;
      onChange((current) => ({ ...current, discussionDraft: "", proposal: nextProposal ?? current.proposal,
        discussion: [...(current.discussion ?? []), { role: "user", text: instruction } as StoryMessage,
          { role: "ai", text: nextProposal ? `已整理一份待采纳主线方案，请查看下方预览。\n${nextProposal.summary}` : result } as StoryMessage],
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "暂时无法连接 AI，请重试。讨论、输入和原方案已保留。"); }
    finally { lock.current = false; setPending(null); }
  }
  function apply() {
    if (!proposal || disabled) return;
    if (!proposal.summary.trim() || proposal.nodes.some((n) => !n.title.trim() || !n.chapter.trim())) { setError("请补全方案说明、节点标题和章节范围后再采纳。"); return; }
    if (!roadmapSchema.safeParse(getRoadmap(proposal)).success) { setError("请补全故事线和事件名称，并检查交汇关系后再采纳。"); return; }
    onChange((current) => current.proposal ? { ...current, ...current.proposal, roadmap: { ...getRoadmap(current.proposal), events: getRoadmap(current.proposal).events.map((event) => ({ ...event, status: getRoadmap(current).events.find((old) => old.id === event.id)?.status ?? "planned" })) }, proposal: undefined, selected: "main", selectedNode: "", version: current.version + 1,
      discussion: [...(current.discussion ?? []), { role: "user", text: `我已采纳主线方案：${getRoadmap(current.proposal).lines.map((line) => line.title).join("、")}\n${current.proposal.summary}` }, { role: "ai", text: "该方案已应用到故事路线图。接下来可以在章节正文中选择本章要推进的事件。" }],
    } : current);
    setError(""); onApplied();
  }
  return <section className="plot-copilot" aria-label="AI 主线共创">
    <header className="copilot-heading"><span className="copilot-mark"><MessageCircle /></span><div><h2>主线共创室</h2><p>聊灵感 → 推敲冲突与转折 → 生成方案 → 采纳到剧情图</p></div><span className="copilot-badge">本书独立讨论</span></header>
    {!history.length ? <div className="copilot-welcome"><h3>故事还没想完整？从一个想法开始聊。</h3><p>告诉 AI 你想写谁、想让读者感受到什么，或者直接提出卡住的问题。它会结合这本书的设定，和你一起推敲主线。</p><div className="copilot-starters">{starters.map((text) => <Button key={text} variant="outline" disabled={disabled} onClick={() => setDraft(text)}>{text}</Button>)}</div></div> : <div className="copilot-conversation" role="log" aria-label="主线讨论记录" aria-live="polite">{history.map((message, i) => <article key={i} className={`copilot-message ${message.role}`}><strong>{message.role === "user" ? "我的想法" : "AI 剧情伙伴"}</strong><p>{message.text}</p></article>)}<div ref={tail} /></div>}
    <div className="copilot-compose"><label htmlFor="plot-discussion-input">{history.length ? "继续讨论或补充修改意见" : "从你的想法开始"}</label><Textarea id="plot-discussion-input" aria-label="主线讨论输入" maxLength={8000} disabled={disabled} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void run("discuss"); } }} /><footer><span>结合本书设定 · {referenceCount} 项剧情借鉴 · 自动保存</span><div>{pending ? <Button variant="outline" onClick={onCancel}><Square />停止生成</Button> : null}<Button variant="outline" disabled={disabled} onClick={() => void run("generate")}>{pending === "generate" ? <LoaderCircle className="spin" /> : <WandSparkles />}{pending === "generate" ? "正在整理方案…" : proposal ? "按讨论更新方案" : "生成主线方案"}</Button><Button disabled={disabled || !draft.trim()} onClick={() => void run("discuss")}>{pending === "discuss" ? <LoaderCircle className="spin" /> : <Send />}{pending === "discuss" ? "正在思考…" : "发送讨论"}</Button></div></footer></div>
    {error && <p className="settings-feedback" role="alert">{error}</p>}
    {proposal && <section className="copilot-proposal" aria-label="主线方案预览"><header><div><Sparkles /><h3>待采纳主线方案</h3></div><span>{getRoadmap(proposal).lines.length} 条故事线 · {getRoadmap(proposal).events.length} 个事件</span></header><p>可以直接编辑下方内容，也可以在讨论框提出意见，再点击“按讨论更新方案”。采纳时替换正式剧情并保存修改前快照。</p><label className="form-field"><span>主线说明与结局</span><Textarea aria-label="主线方案说明" maxLength={8000} disabled={disabled} value={proposal.summary} onChange={(e) => editProposal((p) => ({ ...p, summary: e.target.value }))} /></label>{lostBindings > 0 && <p role="alert" className="chapter-route-warning">此方案替换了 {lostBindings} 个已绑定章节的事件。采纳后需在章节正文中重新选择推进事件。</p>}{proposal.roadmap && <div className="proposal-storylines">{proposal.roadmap.lines.map((line, index) => <article key={line.id}><small>{line.kind === "main" ? "主线" : "衍生支线"}</small><input aria-label={`方案故事线 ${index + 1} 名称`} value={line.title} maxLength={80} disabled={disabled} onChange={(event) => { const title = event.target.value; editProposal((p) => ({ ...p, roadmap: p.roadmap ? { ...p.roadmap, lines: p.roadmap.lines.map((item, i) => i === index ? { ...item, title } : item) } : undefined })); }} /><Textarea aria-label={`方案故事线 ${index + 1} 目标`} value={line.goal} maxLength={2000} disabled={disabled} onChange={(event) => { const goal = event.target.value; editProposal((p) => ({ ...p, roadmap: p.roadmap ? { ...p.roadmap, lines: p.roadmap.lines.map((item, i) => i === index ? { ...item, goal } : item) } : undefined })); }} /><p>{line.eventIds.map((id) => proposal.roadmap?.events.find((event) => event.id === id)?.title).join(" → ")}</p></article>)}</div>}<ol className="copilot-proposal-nodes">{(proposal.roadmap?.events ?? proposal.nodes).map((node, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span><div><div className="copilot-node-title"><input aria-label={`方案节点 ${i + 1} 标题`} maxLength={80} disabled={disabled} value={node.title} onChange={(e) => editEvent(i, { title: e.target.value })} /><input aria-label={`方案节点 ${i + 1} 章节`} maxLength={40} disabled={disabled} value={node.chapter} onChange={(e) => editEvent(i, { chapter: e.target.value })} /></div><Textarea aria-label={`方案节点 ${i + 1} 剧情`} maxLength={proposal.roadmap ? 800 : 400} disabled={disabled} value={node.note} onChange={(e) => editEvent(i, { note: e.target.value })} /></div></li>)}</ol>{proposal.branches.length > 0 && <div className="copilot-proposal-branches">{proposal.branches.map((b) => <article key={b.id}><strong>{b.title}</strong><p>{proposal.nodes[b.from ?? 0]?.title} → {proposal.nodes[b.to ?? proposal.nodes.length - 1]?.title}</p><p>埋线：{b.labels[0]?.text}<br />回收：{b.labels[1]?.text}</p></article>)}</div>}<footer><Button variant="outline" disabled={disabled} onClick={() => { onChange((current) => ({ ...current, proposal: undefined })); setError(""); }}>舍弃待采纳方案</Button><Button disabled={disabled} onClick={apply}><Check />采纳并更新剧情图</Button></footer></section>}
  </section>;
}
