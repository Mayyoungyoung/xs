"use client";

import { useMemo, useState } from "react";
import { Check, GitBranch, LoaderCircle, MessageCircleMore, Plus, RefreshCw, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReferenceItem } from "./reference-library-dialog";

type Props = {
  bookTitle: string;
  references: ReferenceItem[];
  onOpenReferences: () => void;
  onGenerate: (prompt: string, task: string) => Promise<string>;
};

const mainNodes = [
  { x: 95, chapter: "1–3", title: "归乡与异响", note: "铜铃唤回第一段记忆" },
  { x: 315, chapter: "4–8", title: "旧案重启", note: "镇民开始集体遗忘" },
  { x: 545, chapter: "9–14", title: "祭典真相", note: "主角身份第一次反转" },
  { x: 780, chapter: "15–20", title: "雾中决裂", note: "同盟因代价产生分歧" },
  { x: 1010, chapter: "21–26", title: "记忆坍塌", note: "所有支线汇入主冲突" },
  { x: 1230, chapter: "27–30", title: "以忘换生", note: "做出不可逆的选择" },
];

const initialBranches = [
  { id: "affection", title: "沈青霜 · 信任支线", color: "#b96357", path: "M315 244 C350 75 650 65 780 244", labels: [{ x: 420, y: 87, text: "互相试探" }, { x: 625, y: 87, text: "共同保守秘密" }] },
  { id: "clue", title: "铜铃 · 母亲线索", color: "#4f7185", path: "M95 244 C150 415 430 430 545 244", labels: [{ x: 225, y: 400, text: "月相密信" }, { x: 420, y: 400, text: "残缺名字" }] },
  { id: "town", title: "镇民 · 集体遗忘", color: "#8a7650", path: "M545 244 C625 500 930 495 1010 244", labels: [{ x: 690, y: 466, text: "名单消失" }, { x: 885, y: 466, text: "记忆暴动" }] },
];

export function PlotWorkbench({ bookTitle, references, onOpenReferences, onGenerate }: Props) {
  const [instruction, setInstruction] = useState("在第 8 章后增加一条围绕沈青霜身世的支线，第 20 章与主线交汇，但不要抢走主角的核心矛盾。");
  const [branches, setBranches] = useState(initialBranches);
  const [selected, setSelected] = useState("clue");
  const [selectedNode, setSelectedNode] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [version, setVersion] = useState(3);
  const plotRefs = useMemo(() => references.filter((item) => item.scope === "plot"), [references]);

  async function regenerate() {
    if (!instruction.trim()) return;
    setLoading(true);
    try {
      await onGenerate(instruction, "plot_update");
      if (!branches.some((item) => item.id === "identity")) {
        setBranches((items) => [...items, { id: "identity", title: "沈青霜 · 身世暗线", color: "#6c5a91", path: "M315 244 C405 535 900 545 1010 244", labels: [{ x: 520, y: 520, text: "族谱缺页" }, { x: 790, y: 520, text: "守雾人血脉" }] }]);
        setSelected("identity");
      }
      setVersion((value) => value + 1);
    } finally { setLoading(false); }
  }

  return <div className="plot-workbench">
    <div className="page-heading plot-heading"><div><div className="eyebrow">{bookTitle} / 主线与支线</div><h1>情节编排</h1><p>主线保持方向，支线从关键节点生长并在需要时回收。</p></div>
      <div className="plot-heading-actions"><span>蓝图 v{version}</span><Button variant="outline" onClick={onOpenReferences}><Plus />添加剧情借鉴</Button><Button className="ink-button" onClick={regenerate} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <RefreshCw />}按讨论更新图</Button></div>
    </div>
    <section className="plot-command-card"><div className="plot-command-title"><span><MessageCircleMore size={17} /></span><div><strong>告诉 AI 你想怎么改</strong><p>例如“第 12 章长出一条复仇支线，在第二卷结尾反噬主线”</p></div></div>
      <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} aria-label="情节图修改指令" />
      <div className="plot-command-foot"><div className="active-reference-list"><span>本次借鉴</span>{plotRefs.length === 0 ? <button onClick={onOpenReferences}>尚未选择，点击添加</button> : plotRefs.slice(0, 3).map((item) => <button key={item.id} onClick={onOpenReferences} title="打开借鉴库管理">{item.title}</button>)}</div><Button onClick={regenerate} disabled={loading}><Sparkles />讨论并重绘</Button></div>
    </section>
    <section className="plot-board-shell">
      <div className="plot-board-toolbar"><div className="plot-legend"><span><i className="main-legend" />主线</span>{branches.map((branch) => <button className={selected === branch.id ? "active" : ""} onClick={() => setSelected(branch.id)} key={branch.id}><i style={{ background: branch.color }} />{branch.title}</button>)}</div>
        <div><button aria-label="缩小" onClick={() => setZoom((value) => Math.max(.78, value - .1))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大" onClick={() => setZoom((value) => Math.min(1.18, value + .1))}><ZoomIn /></button></div>
      </div>
      <div className="plot-board-scroll"><div className="plot-board" style={{ transform: `scale(${zoom})`, transformOrigin: "left top" }}>
        <div className="volume-band"><span>第一卷 · 雾起</span><span>第二卷 · 失名</span><span>第三卷 · 记忆之海</span></div>
        <svg viewBox="0 0 1340 590" preserveAspectRatio="none" aria-label="主线与支线关系图">
          <path className="main-path" d="M55 244 L1285 244" />
          {branches.map((branch) => <path key={branch.id} d={branch.path} className={selected === branch.id ? "branch-path selected" : "branch-path"} style={{ stroke: branch.color }} />)}
        </svg>
        {mainNodes.map((node, index) => <button key={node.title} className={`main-node ${selectedNode === node.title ? "selected" : ""}`} style={{ left: node.x, top: 199 }} onClick={() => { setSelected("main"); setSelectedNode(node.title); setInstruction(`围绕“${node.title}”继续拆分章节，补充冲突升级、人物选择和章尾钩子，并检查支线如何进入或离开主线。`); }}>
          <span className="main-node-dot">{index < 2 ? <Check /> : index + 1}</span><em>第 {node.chapter} 章</em><strong>{node.title}</strong><small>{node.note}</small><i className="node-add"><Plus /></i>
        </button>)}
        {branches.flatMap((branch) => branch.labels.map((label) => <button key={`${branch.id}-${label.text}`} className={`branch-node ${selected === branch.id ? "selected" : ""}`} onClick={() => { setSelected(branch.id); setSelectedNode(label.text); setInstruction(`调整“${branch.title}”中的“${label.text}”节点，让它更自然地影响主线，同时保持人物动机成立。`); }} style={{ left: label.x, top: label.y, borderColor: branch.color }}><i style={{ background: branch.color }} /><strong>{label.text}</strong><span>{branch.title}</span></button>))}
      </div></div>
      <div className="plot-board-foot"><span><GitBranch />当前显示 1 条主线、{branches.length} 条支线、{mainNodes.length + branches.length * 2} 个关键节点</span><p>点击任意节点可继续拆分章节或与 AI 讨论</p></div>
    </section>
  </div>;
}
