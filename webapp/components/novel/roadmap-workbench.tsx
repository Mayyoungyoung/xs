"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, GitBranch, Plus, Pencil, X, Check, Trash2, Link2, ZoomIn, ZoomOut, Maximize2, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { eventLines, eventsForLine, eventStatus, getRoadmap, lineColors, type RoadmapEvent, type Storyline, type StoryRoadmap } from "@/lib/story-roadmap";
import { roadmapSchema } from "@/lib/roadmap-schema";
import type { Chapter, PlotState } from "./book-workspace";

type Editor = { kind: "line"; line: Storyline; fresh: boolean } | { kind: "event"; event: RoadmapEvent; lineId: string; fresh: boolean } | { kind: "join"; lineId: string; eventId: string };
type Props = { state: PlotState; chapters: Chapter[]; busy: boolean; onChange: (change: (plot: PlotState) => PlotState) => void; onDiscuss: () => void };
export function RoadmapWorkbench({ state, chapters, busy, onChange, onDiscuss }: Props) {
  const roadmap = getRoadmap(state);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const zoom = state.zoom;
  const editorElement = useRef<HTMLElement>(null);
  const editorId = editor?.kind === "event" ? editor.event.id : editor?.kind === "line" ? editor.line.id : editor?.lineId;
  useEffect(() => { editorElement.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [editorId, editor?.kind]);
  const lines = roadmap.lines.filter((line) => focus === "all" || line.id === focus || !roadmap.lines.some((item) => item.id === focus)).sort((a, b) => a.kind === b.kind ? 0 : a.kind === "main" ? -1 : 1);
  const events = roadmap.events.filter((event) => lines.some((line) => line.eventIds.includes(event.id))).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const mapWidth = Math.max(780, events.length * 238 + 240);
  const mapHeight = lines.length * 244;
  function setZoom(value: number) { onChange((current) => ({ ...current, zoom: Math.max(.02, Math.min(2, Math.round(value * 100) / 100)) })); }
  function fit() { setZoom(Math.min(1, (viewport.current?.clientWidth || 780) / mapWidth)); viewport.current?.scrollTo({ top: 0, left: 0 }); }
  useEffect(() => { if (!expanded) return; const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [expanded]);
  const x = (id: string) => 222 + events.findIndex((event) => event.id === id) * 238;
  const next = roadmap.lines.filter((line) => line.kind === "main").flatMap((line) => { const event = eventsForLine(roadmap, line).find((item) => item.status !== "done"); return event ? [`${line.title}：${event.title}`] : []; });
  function begin(value: Editor) { setExpanded(false); setError(""); setEditor(value); }
  function newLine(kind: Storyline["kind"]) {
    begin({ kind: "line", fresh: true, line: { id: crypto.randomUUID(), title: "", goal: "", kind, color: lineColors[roadmap.lines.length % lineColors.length], eventIds: [], ...(kind === "branch" ? { originId: roadmap.events[0]?.id } : {}) } });
  }
  function commit(value: StoryRoadmap) {
    const result = roadmapSchema.safeParse(value);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "请检查故事线的关联"); return false; }
    onChange((current) => ({ ...current, roadmap: result.data, version: current.version + 1 })); setEditor(null); setError(""); return true;
  }
  function save() {
    if (!editor || busy) return;
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
  return <div className="roadmap-workbench">
    <div className="roadmap-controls"><div><Button disabled={busy || roadmap.lines.length >= 16} onClick={() => newLine("main")}><Plus />添加主线</Button><Button variant="outline" disabled={busy || !roadmap.events.length || roadmap.lines.length >= 16} onClick={() => newLine("branch")}><GitBranch />衍生支线</Button></div>{roadmap.lines.length > 0 && <NativeSelect aria-label="聚焦故事线" value={focus} onChange={(event) => setFocus(event.target.value)}><NativeSelectOption value="all">全部故事线</NativeSelectOption>{roadmap.lines.map((line) => <NativeSelectOption key={line.id} value={line.id}>{line.title}</NativeSelectOption>)}</NativeSelect>}</div>
    {!roadmap.lines.length ? <div className="roadmap-empty"><GitBranch /><h2>先定主线，再让故事分岔与交汇</h2><p>例如：寻找妹妹、追查幕后交易是两条主线；旧照片的秘密从一次发现衍生，最后在揭露真相时交汇。</p><Button variant="outline" disabled={busy} onClick={onDiscuss}>让 AI 一起设计故事路线</Button></div> : <>
      <div className="roadmap-summary"><span>{roadmap.lines.filter((line) => line.kind === "main").length} 条主线</span><span>{roadmap.lines.filter((line) => line.kind === "branch").length} 条支线</span><span>{roadmap.events.filter((event) => eventLines(roadmap, event.id).length > 1).length} 个交汇点</span><span>已写 {roadmap.events.filter((event) => event.status === "done").length} / {roadmap.events.length} 个事件</span></div>
      <p className="roadmap-reading-guide">从左向右推进 · 每行一条故事线 · 相同的交汇事件用竖线连接 · 点击事件编辑</p>
      <section className={`roadmap-stage ${expanded ? "is-expanded" : ""}`} aria-label="可缩放路线图"><div className="roadmap-zoom-tools"><Button variant="outline" size="icon" aria-label="缩小路线图" disabled={zoom <= .02} onClick={() => setZoom(zoom - .1)}><ZoomOut /></Button><button className="roadmap-zoom-reset" aria-label="路线图恢复原始比例" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><Button variant="outline" size="icon" aria-label="放大路线图" disabled={zoom >= 2} onClick={() => setZoom(zoom + .1)}><ZoomIn /></Button><Button variant="outline" onClick={fit}><Scan />适应宽度</Button><Button variant="outline" onClick={() => setExpanded(!expanded)}>{expanded ? <X /> : <Maximize2 />}{expanded ? "退出大图" : "展开大图"}</Button><span>横向滚动看后续，放大查看细节</span></div>
      <div ref={viewport} className="roadmap-scroll"><div style={{ width: mapWidth * zoom, height: mapHeight * zoom, position: "relative" }}><div className="roadmap-map" style={{ width: mapWidth, height: mapHeight, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
        <svg className="roadmap-connections" width="100%" height="100%" aria-hidden="true">{lines.map((line, row) => { const ordered = eventsForLine(roadmap, line); return ordered.slice(1).map((event, index) => <path key={`${line.id}-${event.id}`} d={`M${x(ordered[index].id) + 95} ${row * 244 + 122} H${x(event.id) + 95}`} fill="none" stroke={line.color} strokeWidth="2" />); })}{events.map((event) => { const rows = lines.flatMap((line, index) => line.eventIds.includes(event.id) ? [index] : []); return rows.length > 1 ? <path key={event.id} d={`M${x(event.id) + 95} ${rows[0] * 244 + 122} V${rows.at(-1)! * 244 + 122}`} stroke="#98866f" strokeWidth="2" strokeDasharray="5 5" /> : null; })}</svg>
        {lines.map((line, row) => <div className="roadmap-lane" key={line.id} style={{ top: row * 244, "--storyline-color": line.color } as CSSProperties}>
          <div className="roadmap-line-heading"><small>{line.kind === "main" ? "主线" : "衍生支线"}</small><button disabled={busy} onClick={() => begin({ kind: "line", line, fresh: false })}><strong>{line.title}</strong><Pencil /></button><p>{line.goal || "点击名称，补充这条线要达成的目标。"}</p>{line.originId && <em>起于：{roadmap.events.find((event) => event.id === line.originId)?.title}</em>}<div><button disabled={busy || roadmap.events.length >= 80} onClick={() => begin({ kind: "event", fresh: true, lineId: line.id, event: { id: crypto.randomUUID(), title: "", note: "", chapter: "待安排", order: Math.max(0, ...roadmap.events.map((event) => event.order)) + 1, status: "planned" } })}><Plus />事件</button><button disabled={busy || !roadmap.events.some((event) => !line.eventIds.includes(event.id))} onClick={() => begin({ kind: "join", lineId: line.id, eventId: "" })}><Link2 />交汇</button></div></div>
          {eventsForLine(roadmap, line).map((event) => { const shared = eventLines(roadmap, event.id).length > 1; return <button key={event.id} disabled={busy} className={`roadmap-event status-${event.status} ${shared ? "is-shared" : ""}`} data-event-id={event.id} style={{ left: x(event.id) }} onClick={() => begin({ kind: "event", event, lineId: line.id, fresh: false })}><header><span>{eventStatus[event.status]}</span><em>{event.chapter || "待安排章节"}</em></header><strong>{event.title}</strong><p>{event.note || "补充发生了什么、人物选择与后果。"}</p><footer>{shared ? <><Link2 />{line.originId === event.id ? "支线起点" : "交汇事件"}</> : <>推进 {event.order}<ArrowRight /></>}</footer></button>; })}
          {!line.eventIds.length && <p className="roadmap-empty-line">这条线还没有事件。从第一次行动开始安排。</p>}
        </div>)}
      </div></div></div></section>
      <div className="roadmap-next"><strong>下一步可推进</strong><p>{next.length ? next.join("；") : "主线事件已全部标记完成，或尚未添加事件。"}</p><small>在「章节正文」选择本章要推进的事件；完成标记由作者确认。</small></div>
    </>}
    {editor && <section ref={editorElement} className="roadmap-editor" aria-label="故事线编辑"><header><h2>{editor.kind === "line" ? `${editor.fresh ? "添加" : "编辑"}${editor.line.kind === "main" ? "主线" : "支线"}` : editor.kind === "join" ? "让两条故事线在此交汇" : editor.fresh ? "添加剧情事件" : "编辑剧情事件"}</h2><Button size="icon" variant="ghost" aria-label="关闭故事线编辑" onClick={() => setEditor(null)}><X /></Button></header>
      {editor.kind === "line" ? <><label className="form-field"><span>故事线名称</span><input aria-label="故事线名称" maxLength={80} value={editor.line.title} onChange={(event) => setEditor({ ...editor, line: { ...editor.line, title: event.target.value } })} /></label><label className="form-field"><span>这条线要达成什么？最终如何收束？</span><Textarea aria-label="故事线目标" maxLength={2000} value={editor.line.goal} onChange={(event) => setEditor({ ...editor, line: { ...editor.line, goal: event.target.value } })} /></label>{editor.line.kind === "branch" && editor.fresh && <label className="form-field"><span>从哪个事件衍生？</span><NativeSelect aria-label="支线衍生起点" value={editor.line.originId ?? ""} onChange={(event) => setEditor({ ...editor, line: { ...editor.line, originId: event.target.value } })}>{roadmap.events.map((event) => <NativeSelectOption key={event.id} value={event.id}>{event.title}</NativeSelectOption>)}</NativeSelect></label>}</> : editor.kind === "join" ? <><p>选择另一条线已有的事件。两条线会共享同一事件，修改和完成状态同步。</p><NativeSelect aria-label="交汇事件" value={editor.eventId} onChange={(event) => setEditor({ ...editor, eventId: event.target.value })}><NativeSelectOption value="">选择交汇点</NativeSelectOption>{roadmap.events.filter((event) => !roadmap.lines.find((line) => line.id === editor.lineId)?.eventIds.includes(event.id)).map((event) => <NativeSelectOption key={event.id} value={event.id}>{event.title} · {eventLines(roadmap, event.id).map((line) => line.title).join(" / ")}</NativeSelectOption>)}</NativeSelect></> : <>
        {!editor.fresh && eventLines(roadmap, editor.event.id).length > 1 && <p className="roadmap-shared-note">这是共享事件，修改会同步到：{eventLines(roadmap, editor.event.id).map((line) => line.title).join("、")}。</p>}
        <label className="form-field"><span>发生什么事？</span><input aria-label="事件标题" maxLength={80} value={editor.event.title} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, title: event.target.value } })} /></label><div className="roadmap-editor-row"><label className="form-field"><span>推进顺序（数字小的在前）</span><input aria-label="事件推进顺序" type="number" min={0} max={10000} step="any" value={editor.event.order} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, order: Number(event.target.value) } })} /></label><label className="form-field"><span>计划章节，例如 1–3</span><input aria-label="事件计划章节" maxLength={40} value={editor.event.chapter} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, chapter: event.target.value } })} /></label><label className="form-field"><span>写作进度</span><NativeSelect aria-label="事件写作进度" value={editor.event.status} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, status: event.target.value as RoadmapEvent["status"] } })}>{Object.entries(eventStatus).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label></div><label className="form-field"><span>人物选择、代价与后果</span><Textarea aria-label="事件剧情说明" maxLength={800} value={editor.event.note} onChange={(event) => setEditor({ ...editor, event: { ...editor.event, note: event.target.value } })} /></label>
      </>}
      {error && <p className="ai-error" role="alert">{error}</p>}<footer>{editor.kind !== "join" && !editor.fresh && <Button variant="ghost" disabled={busy} onClick={remove}><Trash2 />{editor.kind === "line" ? "删除故事线" : "从本线移除"}</Button>}<Button variant="outline" onClick={() => setEditor(null)}>取消</Button><Button disabled={busy} onClick={save}><Check />{editor.kind === "join" ? "建立交汇" : "保存安排"}</Button></footer>
    </section>}
  </div>;
}
