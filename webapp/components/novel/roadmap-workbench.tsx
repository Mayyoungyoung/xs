"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, GitBranch, Plus, Pencil, X, Check, Trash2, Link2, ZoomIn, ZoomOut, Maximize2, Scan, Search, Crosshair, Eye, EyeOff, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { eventLines, eventStatus, eventsForLine, getRoadmap, lineColors, type RoadmapEvent, type Storyline, type StoryRoadmap } from "@/lib/story-roadmap";
import { roadmapSchema } from "@/lib/roadmap-schema";
import { buildStoryGraph, layoutStoryLanes, selectVisibleStoryGraph, sharedEventHint, unboundEventWarnings, type StoryGraph } from "@/lib/story-graph";
import { debounce } from "@/lib/timing";
import type { Chapter, PlotState } from "./book-workspace";

type EditorBase = { kind: "line"; id: string; title: string; goal: string } | { kind: "event"; id: string; title: string; note: string; chapter: string; order: number; status: string };
type Editor = { kind: "line"; line: Storyline; fresh: boolean; base?: EditorBase } | { kind: "event"; event: RoadmapEvent; lineId: string; fresh: boolean; base?: EditorBase } | { kind: "join"; lineId: string; eventId: string; base?: EditorBase };
type PendingPreview = { id: string; targetLabel: string; descriptions: string[]; eventIds: string[] };
type Props = {
  state: PlotState; chapters: Chapter[]; busy: boolean;
  onChange: (change: (plot: PlotState) => PlotState) => void;
  onDiscuss: () => void;
  onSelect?: (target: { kind: "event" | "line"; id: string; lineId?: string } | null) => void;
  pendingPreview?: PendingPreview[];
  currentChapterId?: string;
  view?: { x: number; y: number; lod?: number; mode?: number };
  onViewChange?: (view: { x: number; y: number; lod: number }) => void;
  mode?: "chapters" | "narrative";
  onModeChange?: (mode: "chapters" | "narrative") => void;
  inspectorHost?: HTMLElement | null;
};

// Zoom decides how much each node shows. The level is derived from the zoom in
// one step (so "fit whole book" lands on the right level immediately), with a
// hysteresis band only near the thresholds so it cannot flicker.
function lodFor(zoom: number, previous?: 0 | 1 | 2): 0 | 1 | 2 {
  const far = previous === 0 ? .58 : .5;
  const near = previous === 2 ? .9 : .98;
  if (zoom < far) return 0;
  if (zoom > near) return 2;
  return 1;
}

export function RoadmapWorkbench({ state, chapters, busy, onChange, onDiscuss, onSelect, pendingPreview = [], currentChapterId, view, onViewChange, mode = "chapters", onModeChange, inspectorHost }: Props) {
  const roadmap = getRoadmap(state);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [lod, setLod] = useState<0 | 1 | 2>(() => (typeof view?.lod === "number" ? view.lod as 0 | 1 | 2 : 1));
  const viewport = useRef<HTMLDivElement>(null);
  const zoom = state.zoom;
  const editorElement = useRef<HTMLElement>(null);
  const editorId = editor?.kind === "event" ? editor.event.id : editor?.kind === "line" ? editor.line.id : editor?.lineId;
  const graph = useMemo(() => buildStoryGraph(roadmap, chapters), [roadmap, chapters]);
  const layout = useMemo(() => layoutStoryLanes(graph, { mode }), [graph, mode]);
  const visible = useMemo(() => selectVisibleStoryGraph(graph, layout, { focusLineId: focus, collapsedLineIds: collapsed, query, lod, ...(currentChapterId ? { currentChapterId } : {}) }), [graph, layout, focus, collapsed, query, lod, currentChapterId]);
  const warnings = useMemo(() => unboundEventWarnings(graph), [graph]);
  const candidateEvents = useMemo(() => new Set(pendingPreview.flatMap((preview) => preview.eventIds)), [pendingPreview]);
  const dimmedEvents = useMemo(() => new Set(visible.nodes.filter((node) => node.dimmed).map((node) => node.event.id)), [visible]);

  // Selecting a node must not throw the author out of the canvas or scroll the
  // page away, so the inspector stays where it is.
  useEffect(() => { editorElement.current?.focus?.({ preventScroll: true }); }, [editorId, editor?.kind]);
  useEffect(() => { if (!expanded) return; const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [expanded]);

  function setZoom(value: number) {
    const next = Math.max(.02, Math.min(2, Math.round(value * 100) / 100));
    setLod((current) => lodFor(next, current));
    onChange((current) => ({ ...current, zoom: next }));
  }
  function fit() { setZoom(Math.min(1, (viewport.current?.clientWidth || 780) / layout.width)); viewport.current?.scrollTo({ top: 0, left: 0 }); }
  function locateCurrentChapter() {
    if (!currentChapterId) return;
    const zone = layout.zones.find((item) => item.chapterId === currentChapterId);
    if (zone) { viewport.current?.scrollTo({ left: Math.max(0, zone.x * zoom - 40), behavior: "smooth" }); return; }
    // Narrative view has no zones: jump to the first event bound to this chapter.
    const target = graph.eventOrder.map((id) => graph.events.find((event) => event.id === id)).find((event) => event?.boundChapters.some((chapter) => chapter.id === currentChapterId));
    if (!target) return;
    const position = layout.positions[target.id];
    if (position) viewport.current?.scrollTo({ left: Math.max(0, position.x * zoom - 40), behavior: "smooth" });
  }
  function toggleCollapse(lineId: string) { setCollapsed((current) => current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]); }

  // Viewport memory is a per-book preference: scroll position and detail level
  // are saved when the interaction ends. Zoom stays in plot.zoom, so restoring a
  // view can never overwrite the author's zoom choice.
  // Scroll fires many times per gesture; the viewport is written once the
  // interaction settles, and once more when leaving the page. The debounced
  // writer is created on first use so no ref is touched during render, and it is
  // rebuilt when the detail level changes so it never writes a stale value.
  const viewWriter = useRef<{ call: () => void; flush: () => void } | null>(null);
  const viewWriterLod = useRef<0 | 1 | 2 | null>(null);
  function rememberView() {
    if (!viewWriter.current || viewWriterLod.current !== lod) {
      viewWriterLod.current = lod;
      viewWriter.current = debounce(() => {
        const element = viewport.current;
        if (!element) return;
        onViewChange?.({ x: element.scrollLeft, y: element.scrollTop, lod });
      }, 400);
    }
    viewWriter.current.call();
  }
  useEffect(() => () => viewWriter.current?.flush(), []);
  useEffect(() => {
    if (!view || !viewport.current || viewport.current.dataset.restored) return;
    viewport.current.dataset.restored = "1";
    viewport.current.scrollTo({ left: view.x ?? 0, top: view.y ?? 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = graph.lines.filter((line) => line.kind === "main").flatMap((line) => { const event = eventsForLine(roadmap, line).find((item) => item.status !== "done"); return event ? [`${line.title}：${event.title}`] : []; });
  function baseOf(value: Editor): EditorBase | undefined {
    if (value.kind === "join" || value.fresh) return undefined;
    if (value.kind === "line") return { kind: "line", id: value.line.id, title: value.line.title, goal: value.line.goal };
    if (value.kind === "event") return { kind: "event", id: value.event.id, title: value.event.title, note: value.event.note, chapter: value.event.chapter, order: value.event.order, status: value.event.status };
    return undefined;
  }
  function begin(value: Editor) {
    setError("");
    const next = { ...value, base: baseOf(value) };
    setEditor(next);
    onSelect?.(next.kind === "event" ? { kind: "event", id: next.event.id, lineId: next.lineId } : next.kind === "line" ? { kind: "line", id: next.line.id } : null);
  }
  function closeEditor() { setEditor(null); onSelect?.(null); }
  function newLine(kind: Storyline["kind"]) {
    begin({ kind: "line", fresh: true, line: { id: crypto.randomUUID(), title: "", goal: "", kind, color: lineColors[roadmap.lines.length % lineColors.length], eventIds: [], ...(kind === "branch" ? { originId: roadmap.events[0]?.id } : {}) } });
  }
  function commit(value: StoryRoadmap) {
    const result = roadmapSchema.safeParse(value);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "请检查故事线的关联"); return false; }
    onChange((current) => ({ ...current, roadmap: result.data, version: current.version + 1 })); closeEditor(); setError(""); return true;
  }
  // A draft is only saved when the object it was based on is still current: an
  // adopted AI change (or another edit) must never be overwritten by a stale form.
  function staleFields(): string[] {
    if (!editor?.base) return [];
    if (editor.base.kind === "event") {
      const current = roadmap.events.find((event) => event.id === editor.base!.id);
      if (!current) return ["这个事件已被删除"];
      const changed: string[] = [];
      if (current.title !== editor.base.title) changed.push("标题");
      if (current.note !== editor.base.note) changed.push("说明");
      if (current.chapter !== editor.base.chapter) changed.push("章节");
      if (current.status !== editor.base.status) changed.push("进度");
      if (current.order !== editor.base.order) changed.push("顺序");
      return changed;
    }
    const current = roadmap.lines.find((line) => line.id === editor.base!.id);
    if (!current) return ["这条故事线已被删除"];
    const changed: string[] = [];
    if (current.title !== editor.base.title) changed.push("名称");
    if (current.goal !== editor.base.goal) changed.push("目标");
    return changed;
  }

  function save() {
    if (!editor || busy) return;
    const stale = staleFields();
    if (stale.length) {
      setError(`这条内容在编辑期间已被更新（${stale.join("、")}）。请先重新载入正式内容再保存，避免覆盖刚采纳的修改。`);
      return;
    }
    if (editor.kind === "line") {
      const line = { ...editor.line, title: editor.line.title.trim(), goal: editor.line.goal.trim() };
      if (!line.title) { setError("请填写故事线名称。"); return; }
      if (editor.fresh && line.kind === "branch") line.eventIds = line.originId ? [line.originId] : [];
      commit({ ...roadmap, lines: editor.fresh ? [...roadmap.lines, line] : roadmap.lines.map((item) => item.id === line.id ? line : item) });
    } else if (editor.kind === "event") {
      const event = { ...editor.event, title: editor.event.title.trim() };
      if (!event.title) { setError("请填写具体发生的事件。"); return; }
      commit({ ...roadmap, events: editor.fresh ? [...roadmap.events, event] : roadmap.events.map((item) => item.id === event.id ? event : item), lines: roadmap.lines.map((line) => line.id === editor.lineId && editor.fresh ? { ...line, eventIds: [...line.eventIds, event.id] } : line) });
    } else {
      if (!editor.eventId) { setError("请先选择其他故事线的事件。"); return; }
      commit({ ...roadmap, lines: roadmap.lines.map((line) => line.id === editor.lineId ? { ...line, eventIds: [...line.eventIds, editor.eventId] } : line) });
    }
  }
  function remove() {
    if (!editor || editor.kind === "join" || editor.fresh || busy) return;
    let candidate = roadmap;
    if (editor.kind === "line") candidate = { ...roadmap, lines: roadmap.lines.filter((line) => line.id !== editor.line.id) };
    else candidate = { ...roadmap, lines: roadmap.lines.map((line) => line.id === editor.lineId ? { ...line, eventIds: line.eventIds.filter((id) => id !== editor.event.id) } : line) };
    const detached = candidate.events.filter((event) => !candidate.lines.some((line) => line.eventIds.includes(event.id)));
    if (chapters.some((chapter) => chapter.plotEventIds?.some((id) => detached.some((event) => event.id === id)))) { setError("此事件已安排到章节。请先在章节正文中调整推进安排，再移除事件。"); return; }
    candidate = { ...candidate, events: candidate.events.filter((event) => !detached.some((item) => item.id === event.id)) };
    if (!roadmapSchema.safeParse(candidate).success) { setError("其他支线仍从这里衍生，请先调整相关支线，且至少保留一条主线。"); return; }
    if (window.confirm(editor.kind === "line" ? "删除这条故事线？修改前会保留快照。" : "从本线移除此事件？其他故事线中的同一事件会保留。")) commit(candidate);
  }

  // The editable fields render in the worldline's single right sidebar when it
  // offers a host, and inline otherwise.
  function renderEditor(node: React.ReactElement) {
    return inspectorHost ? createPortal(node, inspectorHost) : node;
  }

  const lineRows = graph.lines.map((line) => ({ line, events: graph.eventOrder.flatMap((id) => { const event = graph.events.find((item) => item.id === id); return event && line.eventIds.includes(event.id) ? [event] : []; }) }));
  const laneClass = `lod-${lod}`;

  return <div className="roadmap-workbench">
    <div className="roadmap-controls">
      <div><Button disabled={busy || roadmap.lines.length >= 16} onClick={() => newLine("main")}><Plus />添加主线</Button><Button variant="outline" disabled={busy || !roadmap.events.length || roadmap.lines.length >= 16} onClick={() => newLine("branch")}><GitBranch />衍生支线</Button></div>
      <div className="roadmap-view-tools">
        <label className="roadmap-search"><Search /><input aria-label="搜索剧情" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事件或故事线" /></label>
        {query && <span className="roadmap-search-count">{visible.matchedEventIds.length} 个匹配{visible.hiddenMatches.length ? ` · 另有 ${visible.hiddenMatches.length} 个在折叠的故事线中` : ""}</span>}
        <Button variant="outline" size="sm" disabled={!currentChapterId} onClick={locateCurrentChapter}><Crosshair />定位当前章节</Button>
        <span className="roadmap-lod" title="缩小看结构与进度，放大看事件细节">{lod === 0 ? <Layers /> : lod === 1 ? <Eye /> : <EyeOff />}{lod === 0 ? "远景" : lod === 1 ? "中景" : "近景"}</span>
        <NativeSelect aria-label="剧情视图" value={mode} onChange={(event) => onModeChange?.(event.target.value === "narrative" ? "narrative" : "chapters")}>
          <NativeSelectOption value="chapters">章节分区视图</NativeSelectOption>
          <NativeSelectOption value="narrative">叙事顺序视图</NativeSelectOption>
        </NativeSelect>
        {roadmap.lines.length > 0 && <NativeSelect aria-label="聚焦故事线" value={focus} onChange={(event) => setFocus(event.target.value)}><NativeSelectOption value="all">全部故事线</NativeSelectOption>{roadmap.lines.map((line) => <NativeSelectOption key={line.id} value={line.id}>{line.title}</NativeSelectOption>)}</NativeSelect>}
      </div>
    </div>
    {!roadmap.lines.length ? <div className="roadmap-empty"><GitBranch /><h2>先定主线，再让故事分岔与交汇</h2><p>例如：寻找妹妹、追查幕后交易是两条主线；旧照片的秘密从一次发现衍生，最后在揭露真相时交汇。</p><Button variant="outline" disabled={busy} onClick={onDiscuss}>让 AI 一起设计故事路线</Button></div> : <>
      <div className="roadmap-summary"><span>{graph.lines.filter((line) => line.kind === "main").length} 条主线</span><span>{graph.lines.filter((line) => line.kind === "branch").length} 条支线</span><span>{graph.sharedCount} 个交汇点</span><span>已写 {graph.doneEvents} / {graph.totalEvents} 个事件</span>{graph.unplannedCount > 0 && <span className="is-pending">{graph.unplannedCount} 个事件待安排章节</span>}</div>
      <p className="roadmap-reading-guide">{layout.mode === "narrative" ? "按叙事顺序从左向右推进 · 章节写在事件卡上作为属性 · 每行一条故事线" : "按章节分区 · 区内从左向右推进 · 每行一条故事线 · 相同的交汇事件用竖线连接"}</p>
      {warnings.length > 0 && <p className="roadmap-warning" role="status">这些事件的章节文字没有对应的章节绑定，请到「章节正文」重新选择：{warnings.map((warning) => warning.title).join("、")}。</p>}
      {layout.warnings.length > 0 && <p className="roadmap-warning" role="status">{layout.warnings.join("；")}</p>}
      {pendingPreview.length > 0 && <section className="roadmap-candidates" aria-label="待采纳剧情修改"><header><Layers /><strong>AI 提出了 {pendingPreview.length} 组待采纳修改</strong><span>虚线标记的事件会变化，未采纳前不影响正式剧情</span></header>{pendingPreview.map((preview) => <div key={preview.id}><em>{preview.targetLabel}</em><ul>{preview.descriptions.map((description, index) => <li key={index}>{description}</li>)}</ul></div>)}<Button variant="outline" size="sm" onClick={onDiscuss}>去采纳或拒绝</Button></section>}
      <section className={`roadmap-stage ${expanded ? "is-expanded" : ""}`} aria-label="可缩放路线图">
        <div className="roadmap-zoom-tools"><Button variant="outline" size="icon" aria-label="缩小路线图" disabled={zoom <= .02} onClick={() => setZoom(zoom - .1)}><ZoomOut /></Button><button className="roadmap-zoom-reset" aria-label="路线图恢复原始比例" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><Button variant="outline" size="icon" aria-label="放大路线图" disabled={zoom >= 2} onClick={() => setZoom(zoom + .1)}><ZoomIn /></Button><Button variant="outline" onClick={fit}><Scan />适应宽度</Button><Button variant="outline" onClick={() => setExpanded(!expanded)}>{expanded ? <X /> : <Maximize2 />}{expanded ? "退出大图" : "展开大图"}</Button><span>横向滚动看后续，放大查看细节</span></div>
        <div ref={viewport} className="roadmap-scroll" onScroll={rememberView} onMouseUp={rememberView}>
          <div style={{ width: layout.width * zoom, height: layout.height * zoom, position: "relative" }}>
            <div className={`roadmap-map ${laneClass}`} style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
              <svg className="roadmap-connections" width="100%" height="100%" aria-hidden="true">
                {lineRows.map(({ line, events }, row) => events.filter((event) => !visible.hiddenEventIds.includes(event.id)).slice(1).map((event, index, shown) => <path key={`${line.id}-${event.id}`} d={`M${layout.positions[shown[index - 1]?.id ?? event.id].x + 95} ${row * layout.laneHeight + 122} H${layout.positions[event.id].x + 95}`} fill="none" stroke={line.color} strokeWidth="2" />))}
                {graph.events.filter((event) => !visible.hiddenEventIds.includes(event.id)).map((event) => {
                  const rows = lineRows.flatMap(({ line }, index) => line.eventIds.includes(event.id) ? [index] : []);
                  return rows.length > 1 ? <path key={event.id} d={`M${layout.positions[event.id].x + 95} ${rows[0] * layout.laneHeight + 122} V${rows.at(-1)! * layout.laneHeight + 122}`} stroke="#98866f" strokeWidth="2" strokeDasharray="5 5" /> : null;
                })}
              </svg>
              {layout.mode === "chapters" && layout.zones.length > 0 && <div className="roadmap-stages" aria-hidden="true">{layout.zones.map((zone) => <div key={zone.id} className={`roadmap-zone ${zone.kind === "unplanned" ? "is-unplanned" : ""} ${visible.currentColumnId === zone.id ? "is-current" : ""}`} style={{ left: zone.x, width: zone.width }}><header><span>{zone.label}</span><em>{zone.kind === "unplanned" ? "计划区 · 未安排章节" : `${zone.eventIds.length} 个事件`}{visible.currentColumnId === zone.id ? " · 正在写" : ""}</em></header></div>)}</div>}
              {lineRows.map(({ line }, row) => {
                const isCollapsed = collapsed.includes(line.id);
                const dimmed = visible.dimmedLineIds.includes(line.id);
                return <div className={`roadmap-lane ${dimmed ? "is-dimmed" : ""} ${isCollapsed ? "is-collapsed" : ""}`} key={line.id} style={{ top: row * layout.laneHeight, "--storyline-color": line.color } as CSSProperties}>
                  <div className="roadmap-line-heading">
                    <button type="button" className="roadmap-collapse" aria-expanded={!isCollapsed} disabled={busy} onClick={() => toggleCollapse(line.id)}>{isCollapsed ? <EyeOff /> : <Eye />}{isCollapsed ? "展开" : "折叠"}</button>
                    <small>{line.kind === "main" ? "主线" : "衍生支线"} · 已写 {line.done}/{line.total}</small>
                    <button disabled={busy} onClick={() => begin({ kind: "line", line, fresh: false })}><strong>{line.title}</strong><Pencil /></button>
                    <p>{line.goal || "点击名称，补充这条线要达成的目标。"}</p>
                    {line.originId && <em>起于：{roadmap.events.find((event) => event.id === line.originId)?.title}</em>}
                    <div><button disabled={busy || roadmap.events.length >= 80} onClick={() => begin({ kind: "event", fresh: true, lineId: line.id, event: { id: crypto.randomUUID(), title: "", note: "", chapter: "待安排", order: Math.max(0, ...roadmap.events.map((event) => event.order)) + 1, status: "planned" } })}><Plus />事件</button><button disabled={busy || !roadmap.events.some((event) => !line.eventIds.includes(event.id))} onClick={() => begin({ kind: "join", lineId: line.id, eventId: "" })}><Link2 />交汇</button></div>
                  </div>
                  {lineRows[row].events.filter((event) => !visible.hiddenEventIds.includes(event.id)).map((event) => {
                    const shared = event.shared;
                    const isPrimary = event.primaryLineId === line.id;
                    const position = layout.positions[event.id];
                    return <button key={event.id} disabled={busy} className={`roadmap-event status-${event.status} ${shared ? "is-shared" : ""} ${isPrimary ? "is-primary" : "is-anchor"} ${dimmedEvents.has(event.id) ? "is-dimmed" : ""} ${candidateEvents.has(event.id) ? "has-candidate" : ""} ${currentChapterId && event.boundChapters.some((chapter) => chapter.id === currentChapterId) ? "is-current-chapter" : ""}`} data-event-id={event.id} style={{ left: position.x }} title={sharedEventHint(graph, event.id)} onClick={() => begin({ kind: "event", event, lineId: line.id, fresh: false })}>
                      <header><span>{eventStatus[event.status]}</span><em>{event.chapter || "待安排章节"}</em></header>
                      <strong>{event.title}</strong>
                      {lod > 0 && <p>{event.note || "补充发生了什么、人物选择与后果。"}</p>}
                      <footer>{shared ? <><Link2 />{isPrimary ? "交汇事件 · 主卡片" : "同一事件"}</> : <>{lod > 1 && `推进 ${event.order} `}<ArrowRight /></>}</footer>
                    </button>;
                  })}
                  {!line.eventIds.length && <p className="roadmap-empty-line">这条线还没有事件。从第一次行动开始安排。</p>}
                  {isCollapsed && <p className="roadmap-collapsed-hint">{line.eventIds.length} 个事件已折叠</p>}
                </div>;
              })}
            </div>
          </div>
        </div>
      </section>
      <div className="roadmap-next"><strong>下一步可推进</strong><p>{next.length ? next.join("；") : "主线事件已全部标记完成，或尚未添加事件。"}</p><small>在「章节正文」选择本章要推进的事件；完成标记由作者确认。</small></div>
    </>}
    {editor && renderEditor(<section ref={editorElement} className="roadmap-editor" aria-label="故事线编辑"><header><h2>{editor.kind === "line" ? `${editor.fresh ? "添加" : "编辑"}${editor.line.kind === "main" ? "主线" : "支线"}` : editor.kind === "join" ? "让两条故事线在此交汇" : editor.fresh ? "添加剧情事件" : "编辑剧情事件"}</h2><Button size="icon" variant="ghost" aria-label="关闭故事线编辑" onClick={closeEditor}><X /></Button></header>
      {editor.kind === "line" ? <><label className="form-field"><span>故事线名称</span><input aria-label="故事线名称" maxLength={80} value={editor.line.title} onChange={(event) => setEditor({ ...editor, line: { ...editor.line, title: event.target.value } })} /></label><label className="form-field"><span>这条线要达成什么？最终如何收束？</span><Textarea aria-label="故事线目标" maxLength={2000} value={editor.line.goal} onChange={(event) => setEditor({ ...editor, line: { ...editor.line, goal: event.target.value } })} /></label>{editor.line.kind === "branch" && editor.fresh && <label className="form-field"><span>从哪个事件衍生？</span><NativeSelect aria-label="支线衍生起点" value={editor.line.originId ?? ""} onChange={(event) => setEditor({ ...editor, line: { ...editor.line, originId: event.target.value } })}>{roadmap.events.map((event) => <NativeSelectOption key={event.id} value={event.id}>{event.title}</NativeSelectOption>)}</NativeSelect></label>}</> : editor.kind === "join" ? <><p>选择另一条线已有的事件。两条线会共享同一事件，修改和完成状态同步。</p><NativeSelect aria-label="交汇事件" value={editor.eventId} onChange={(event) => setEditor({ ...editor, eventId: event.target.value })}><NativeSelectOption value="">选择交汇点</NativeSelectOption>{roadmap.events.filter((event) => !roadmap.lines.find((line) => line.id === editor.lineId)?.eventIds.includes(event.id)).map((event) => <NativeSelectOption key={event.id} value={event.id}>{event.title} · {eventLines(roadmap, event.id).map((line) => line.title).join(" / ")}</NativeSelectOption>)}</NativeSelect></> : <>
        {!editor.fresh && eventLines(roadmap, editor.event.id).length > 1 && <p className="roadmap-shared-note">这是共享事件，修改会同步到：{eventLines(roadmap, editor.event.id).map((line) => line.title).join("、")}。</p>}
        <label className="form-field"><span>发生什么事？</span><input aria-label="事件标题" maxLength={80} value={editor.event.title} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, title: event.target.value } })} /></label><div className="roadmap-editor-row"><label className="form-field"><span>推进顺序（数字小的在前）</span><input aria-label="事件推进顺序" type="number" min={0} max={10000} step="any" value={editor.event.order} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, order: Number(event.target.value) } })} /></label><label className="form-field"><span>计划章节，例如 1–3</span><input aria-label="事件计划章节" maxLength={40} value={editor.event.chapter} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, chapter: event.target.value } })} /></label><label className="form-field"><span>写作进度</span><NativeSelect aria-label="事件写作进度" value={editor.event.status} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, status: event.target.value as RoadmapEvent["status"] } })}>{Object.entries(eventStatus).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label></div><label className="form-field"><span>人物选择、代价与后果</span><Textarea aria-label="事件剧情说明" maxLength={800} value={editor.event.note} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, note: event.target.value } })} /></label>
      </>}
      {error && <p className="ai-error" role="alert">{error}</p>}
      {staleFields().length > 0 && <p className="roadmap-stale" role="status">正式内容已更新，可重新载入：<Button variant="outline" size="sm" disabled={busy} onClick={() => begin(editor.kind === "event" ? { kind: "event", event: roadmap.events.find((event) => event.id === editor.event.id) ?? editor.event, lineId: editor.lineId, fresh: false } : editor.kind === "line" ? { kind: "line", line: roadmap.lines.find((line) => line.id === editor.line.id) ?? editor.line, fresh: false } : editor)}>重新载入正式内容</Button></p>}
      <footer>{editor.kind !== "join" && !editor.fresh && <Button variant="ghost" disabled={busy} onClick={remove}><Trash2 />{editor.kind === "line" ? "删除故事线" : "从本线移除"}</Button>}<Button variant="outline" onClick={closeEditor}>取消</Button><Button disabled={busy} onClick={save}><Check />{editor.kind === "join" ? "建立交汇" : "保存安排"}</Button></footer>
    </section>)}
  </div>;
}

export type { StoryGraph };
