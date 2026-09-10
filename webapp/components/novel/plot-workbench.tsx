"use client";

import { useMemo, useState } from "react";
import { Check, GitBranch, LoaderCircle, MessageCircleMore, Plus, RefreshCw, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PlotState } from "./book-workspace";
import type { ReferenceItem } from "./reference-library-dialog";

type Props = {
  bookTitle: string;
  state: PlotState;
  references: ReferenceItem[];
  onStateChange: (next: PlotState) => void;
  onOpenReferences: () => void;
  onGenerate: (prompt: string, task: string) => Promise<string>;
};

export function PlotWorkbench({ bookTitle, state, references, onStateChange, onOpenReferences, onGenerate }: Props) {
  const [loading, setLoading] = useState(false);
  const plotRefs = useMemo(() => references.filter((item) => item.scope === "plot"), [references]);
  const mainNodes = useMemo(() => [
    { x: 95, chapter: "1–3", title: "触发事件", note: `《${bookTitle}》的主角被迫行动` },
    { x: 315, chapter: "4–8", title: "第一次深入", note: "代价显现，支线开始生长" },
    { x: 545, chapter: "9–14", title: "中段反转", note: "主角对目标产生新的理解" },
    { x: 780, chapter: "15–20", title: "关系决裂", note: "同盟或信念受到考验" },
    { x: 1010, chapter: "21–26", title: "危机汇流", note: "主线回收关键支线" },
    { x: 1230, chapter: "27–30", title: "终局选择", note: "做出不可逆的决定" },
  ], [bookTitle]);

  function update(patch: Partial<PlotState>) { onStateChange({ ...state, ...patch }); }

  async function regenerate() {
    if (!state.instruction.trim()) return;
    setLoading(true);
    try {
      await onGenerate(state.instruction, "plot_update");
      const nextBranches = state.branches.some((item) => item.id === "ai-new") ? state.branches : [...state.branches, { id: "ai-new", title: "AI 新增支线", color: "#6c5a91", path: "M315 244 C405 535 900 545 1010 244", labels: [{ x: 520, y: 520, text: "埋下代价" }, { x: 790, y: 520, text: "回收选择" }] }];
      update({ branches: nextBranches, selected: "ai-new", version: state.version + 1 });
    } finally { setLoading(false); }
  }

  return <div className="plot-workbench">
    <div className="page-heading plot-heading"><div><div className="eyebrow">{bookTitle} / 主线与支线</div><h1>情节编排</h1><p>主线保持方向，支线从关键节点生长并在需要时回收。</p></div>
      <div className="plot-heading-actions"><span>《{bookTitle}》蓝图 v{state.version}</span><Button variant="outline" onClick={onOpenReferences}><Plus />添加剧情借鉴</Button><Button className="ink-button" onClick={regenerate} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <RefreshCw />}按讨论更新图</Button></div>
    </div>
    <section className="plot-command-card"><div className="plot-command-title"><span><MessageCircleMore size={17} /></span><div><strong>告诉 AI 你想怎么改</strong><p>例如“第 12 章长出一条复仇支线，在第二卷结尾反噬主线”</p></div></div>
      <Textarea value={state.instruction} onChange={(event) => update({ instruction: event.target.value })} aria-label="情节图修改指令" />
      <div className="plot-command-foot"><div className="active-reference-list"><span>本次借鉴</span>{plotRefs.length === 0 ? <button onClick={onOpenReferences}>尚未选择，点击添加</button> : plotRefs.slice(0, 3).map((item) => <button key={item.id} onClick={onOpenReferences} title="打开借鉴库管理">{item.title}</button>)}</div><Button onClick={regenerate} disabled={loading}><Sparkles />讨论并重绘</Button></div>
    </section>
    <section className="plot-board-shell">
      <div className="plot-board-toolbar"><div className="plot-legend"><span><i className="main-legend" />主线</span>{state.branches.map((branch) => <button className={state.selected === branch.id ? "active" : ""} onClick={() => update({ selected: branch.id })} key={branch.id}><i style={{ background: branch.color }} />{branch.title}</button>)}</div>
        <div><button aria-label="缩小" onClick={() => update({ zoom: Math.max(.78, state.zoom - .1) })}><ZoomOut /></button><span>{Math.round(state.zoom * 100)}%</span><button aria-label="放大" onClick={() => update({ zoom: Math.min(1.18, state.zoom + .1) })}><ZoomIn /></button></div>
      </div>
      <div className="plot-board-scroll"><div className="plot-board" style={{ transform: `scale(${state.zoom})`, transformOrigin: "left top" }}>
        <div className="volume-band"><span>第一卷 · 铺陈</span><span>第二卷 · 深入</span><span>第三卷 · 回收</span></div>
        <svg viewBox="0 0 1340 590" preserveAspectRatio="none" aria-label="主线与支线关系图">
          <path className="main-path" d="M55 244 L1285 244" />
          {state.branches.map((branch) => <path key={branch.id} d={branch.path} className={state.selected === branch.id ? "branch-path selected" : "branch-path"} style={{ stroke: branch.color }} />)}
        </svg>
        {mainNodes.map((node, index) => <button key={node.title} className={`main-node ${state.selectedNode === node.title ? "selected" : ""}`} style={{ left: node.x, top: 199 }} onClick={() => update({ selected: "main", selectedNode: node.title, instruction: `围绕“${node.title}”继续拆分章节，补充冲突升级、人物选择和章尾钩子，并检查支线如何进入或离开主线。` })}>
          <span className="main-node-dot">{index < 2 ? <Check /> : index + 1}</span><em>第 {node.chapter} 章</em><strong>{node.title}</strong><small>{node.note}</small><i className="node-add"><Plus /></i>
        </button>)}
        {state.branches.flatMap((branch) => branch.labels.map((label) => <button key={`${branch.id}-${label.text}`} className={`branch-node ${state.selected === branch.id ? "selected" : ""}`} onClick={() => update({ selected: branch.id, selectedNode: label.text, instruction: `调整“${branch.title}”中的“${label.text}”节点，让它更自然地影响主线，同时保持人物动机成立。` })} style={{ left: label.x, top: label.y, borderColor: branch.color }}><i style={{ background: branch.color }} /><strong>{label.text}</strong><span>{branch.title}</span></button>))}
      </div></div>
      <div className="plot-board-foot"><span><GitBranch />当前显示 1 条主线、{state.branches.length} 条支线、{mainNodes.length + state.branches.length * 2} 个关键节点</span><p>点击节点即可调整指令，再让 AI 重绘</p></div>
    </section>
  </div>;
}
