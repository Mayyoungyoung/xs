"use client";

import { useMemo, useState } from "react";
import { BookMarked, GitBranch, MessageCircle, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writingGuidance } from "@/lib/writing-guidance";
import { Textarea } from "@/components/ui/textarea";
import { RoadmapWorkbench } from "./roadmap-workbench";
import { PlotCopilot } from "./plot-copilot";
import { CoCreationPanel } from "./co-creation-panel";
import { changeAsset, withSnapshot, type BookWorkspace, type PlotGenerationOptions, type PlotState } from "./book-workspace";
import { getRoadmap } from "@/lib/story-roadmap";
import { describeRoadmapOp, isRoadmapProposal, targetLabelFor, type CoTarget } from "@/lib/co-creation";
import type { BookProject } from "./bookshelf";
import type { ReferenceItem, ReferenceScope } from "./reference-library-dialog";
import type { AdoptOptions, AdoptOutcome } from "./co-creation-panel";

type Props = {
  book: BookProject; workspace: BookWorkspace; busy: boolean; saveState: string; connection: string;
  onWorkspaceChange: (change: Partial<BookWorkspace> | ((current: BookWorkspace) => BookWorkspace)) => void;
  onGenerate: (prompt: string, task: string, options?: PlotGenerationOptions) => Promise<string>;
  onAdopt: (proposalId: string, options: AdoptOptions) => AdoptOutcome;
  onOpenReferences: (scope: ReferenceScope) => void; onRemoveReference: (reference: ReferenceItem) => void;
  onCancel: () => void; onNotify: (message: string) => void;
};
const views = [
  { id: "graph", label: "故事路线图", icon: GitBranch },
  { id: "discussion", label: "AI 主线共创", icon: MessageCircle },
] as const;

export function WorldlineWorkbench({ book, workspace, busy, saveState, connection, onWorkspaceChange, onGenerate, onAdopt, onOpenReferences, onRemoveReference, onCancel, onNotify }: Props) {
  const [view, setView] = useState<(typeof views)[number]["id"]>("graph");
  const [target, setTarget] = useState<CoTarget | null>(null);
  const [inspectorHost, setInspectorHost] = useState<HTMLElement | null>(null);
  const roadmap = useMemo(() => getRoadmap(workspace.plot), [workspace.plot]);
  const pendingPreview = useMemo(() => workspace.coProposals
    .filter((proposal) => proposal.status === "pending" && isRoadmapProposal(proposal))
    .map((proposal) => {
      if (!isRoadmapProposal(proposal)) return null;
      return {
        id: proposal.id,
        targetLabel: proposal.targetLabel,
        descriptions: proposal.ops.map((op) => describeRoadmapOp(op, roadmap)),
        eventIds: proposal.ops.flatMap((op) => op.op === "updateEvent" ? [op.eventId] : op.op === "addEvent" ? [op.event.id] : op.op === "linkEvent" ? [op.eventId] : []),
      };
    })
    .filter((preview): preview is NonNullable<typeof preview> => Boolean(preview)), [workspace.coProposals, roadmap]);

  function updatePlot(change: PlotState | ((current: PlotState) => PlotState)) {
    onWorkspaceChange((current) => {
      const plot = typeof change === "function" ? change(current.plot) : change;
      return { ...(plot.version !== current.plot.version ? withSnapshot(current, "世界线修改前") : current), plot };
    });
  }

  const detailTarget = target && (target.moduleId === "event" || target.moduleId === "line") ? target : null;
  const storedView = workspace.view.roadmap;
  const savedView = storedView ? { x: storedView.x ?? 0, y: storedView.y ?? 0, ...(typeof storedView.lod === "number" ? { lod: storedView.lod } : {}) } : undefined;
  const layoutMode: "chapters" | "narrative" = workspace.view.roadmap?.mode === 1 ? "narrative" : "chapters";
  function changeLayoutMode(next: "chapters" | "narrative") {
    onWorkspaceChange((current) => ({ ...current, view: { ...current.view, roadmap: { ...(current.view.roadmap ?? {}), mode: next === "narrative" ? 1 : 0 } } }));
  }

  return <div className="worldline-workbench">
    <div className="page-heading"><div><div className="eyebrow">{book.title} / 故事设计</div><h1>世界线</h1><p>安排故事如何展开：主线向前推进，支线从事件衍生，多条线在关键事件交汇。</p></div><Button variant="outline" onClick={() => onOpenReferences("plot")}><BookMarked />剧情借鉴</Button></div>
    <div className="worldline-tabs" role="tablist" aria-label="世界线视图">{views.map(({ id, label, icon: Icon }, index) => <button type="button" key={id} role="tab" id={`worldline-tab-${id}`} aria-controls={`worldline-panel-${id}`} aria-selected={view === id} tabIndex={view === id ? 0 : -1} disabled={busy} onClick={() => setView(id)} onKeyDown={(event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % views.length : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); setView(views[next].id); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
    }}><Icon /><span>{label}</span>{id === "discussion" && workspace.plot.proposal && <em>待采纳</em>}{id === "discussion" && !workspace.plot.proposal && pendingPreview.length > 0 && <em>待采纳</em>}</button>)}</div>
    {busy && view !== "discussion" && <div className="module-task-status" role="status"><LoaderCircle className="spin" /><span>AI 正在生成，请稍候…</span><Button size="sm" variant="outline" onClick={onCancel}>停止生成</Button></div>}
    <section role="tabpanel" id={`worldline-panel-${view}`} aria-labelledby={`worldline-tab-${view}`} tabIndex={0}>
      <div className={`worldline-layout ${detailTarget ? "has-detail" : ""}`}>
        <div className="worldline-main">
          {view === "graph" && <><div className="worldline-view-heading"><h2>故事路线图</h2><Button variant="outline" disabled={busy} onClick={() => setView("discussion")}>{workspace.plot.proposal ? "查看待采纳方案" : "AI 讨论与生成"}</Button></div><RoadmapWorkbench
            state={workspace.plot}
            chapters={workspace.chapters}
            busy={busy}
            onChange={updatePlot}
            onDiscuss={() => setView("discussion")}
            onSelect={(selection) => setTarget(selection ? { moduleId: selection.kind === "event" ? "event" : "line", entityId: selection.id } : null)}
            pendingPreview={pendingPreview}
            currentChapterId={workspace.activeChapterId}
            view={savedView}
            onViewChange={(next) => onWorkspaceChange((current) => ({ ...current, view: { ...current.view, roadmap: { ...next, ...(current.view.roadmap?.mode !== undefined ? { mode: current.view.roadmap.mode } : {}) } } }))}
            mode={layoutMode}
            onModeChange={changeLayoutMode}
            inspectorHost={inspectorHost}
          /></>}
          {view === "discussion" && <PlotCopilot placeholder={writingGuidance("timeline", book, workspace).placeholder} boundEventIds={workspace.chapters.flatMap((chapter) => chapter.plotEventIds ?? [])} state={workspace.plot} busy={busy} referenceCount={workspace.references.filter((r) => r.scope === "plot").length} onChange={updatePlot} onGenerate={onGenerate} onCancel={onCancel} onApplied={() => { setView("graph"); onNotify("已更新世界线，修改前内容可在故事版本中恢复"); }} />}
        </div>
        {view === "graph" && <aside className="worldline-detail" aria-label="剧情目标详情" aria-hidden={!detailTarget && !inspectorHost ? undefined : undefined}>
          <header><div><strong>{detailTarget ? targetLabelFor(workspace, detailTarget, roadmap) : "剧情详情"}</strong><span>{detailTarget ? "点击图上的其他事件可切换目标" : "点击事件或故事线开始编辑与共创"}</span></div>{detailTarget && <Button size="icon" variant="ghost" aria-label="关闭剧情目标详情" onClick={() => setTarget(null)}><X /></Button>}</header>
          <div className="worldline-inspector" ref={setInspectorHost} />
          {detailTarget ? <CoCreationPanel
            bookId={book.id}
            workspace={workspace}
            target={detailTarget}
            busy={busy}
            modelConnection={connection}
            saveState={saveState}
            onWorkspaceChange={onWorkspaceChange}
            onGenerate={onGenerate}
            onAdopt={onAdopt}
            onCancel={onCancel}
            onNotify={onNotify}
            onOpenReferences={onOpenReferences}
            onRemoveReference={onRemoveReference}
          /> : <p className="worldline-detail-hint">选中一个事件或故事线后，可以在这里直接编辑字段，也可以和 AI 讨论、生成候选。</p>}
        </aside>}
      </div>
    </section>
    {workspace.assets.timeline?.trim() && <details className="roadmap-legacy-notes"><summary>原有剧情笔记</summary><p>以前记录的时间、前史和因果说明保留在这里，AI 仍会参考。</p><Textarea aria-label="原有剧情笔记" value={workspace.assets.timeline} onChange={(event) => { const value = event.target.value; onWorkspaceChange((current) => changeAsset(current, "timeline", value)); }} /></details>}
  </div>;
}
