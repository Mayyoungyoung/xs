// Deterministic layout for the story-lane canvas. Pure functions only, so the
// same roadmap always produces the same geometry and the renderer never guesses.

import { eventLines, lineColors, type RoadmapEvent, type StoryRoadmap, type Storyline } from "./story-roadmap";

export type GraphChapter = { id: string; title: string; plotEventIds?: string[] };

export type StoryGraphEvent = RoadmapEvent & {
  lineIds: string[];
  shared: boolean;
  primaryLineId: string;
  boundChapters: Array<{ id: string; title: string; index: number }>;
};

export type StoryGraphLine = Storyline & { eventIds: string[]; done: number; total: number; progress: number };

// A column is either a chapter segment (derived from the authoritative chapter
// binding) or the explicit "unplanned" area after the last real chapter.
export type StoryColumn = {
  id: string;
  kind: "chapter" | "unplanned";
  label: string;
  chapterId?: string;
  chapterIndex?: number;
  eventIds: string[];
};

export type StoryGraph = {
  lines: StoryGraphLine[];
  events: StoryGraphEvent[];
  columns: StoryColumn[];
  eventOrder: string[];
  sharedCount: number;
  unplannedCount: number;
  totalEvents: number;
  doneEvents: number;
};

export type StoryPosition = { x: number; y: number; columnIndex: number; row: number; index: number; lineId: string };

export type StoryLayout = {
  columns: StoryColumn[];
  columnStarts: Record<string, number>;
  eventOrder: string[];
  positions: Record<string, StoryPosition>;
  width: number;
  height: number;
  laneHeight: number;
  columnWidth: number;
  laneCount: number;
  sharedCount: number;
  unplannedCount: number;
};

export type StoryLayoutOptions = { laneHeight?: number; columnWidth?: number };

export function buildStoryGraph(roadmap: StoryRoadmap, chapters: GraphChapter[] = []): StoryGraph {
  const bound = new Map<string, Array<{ id: string; title: string; index: number }>>();
  chapters.forEach((chapter, index) => {
    for (const eventId of chapter.plotEventIds ?? []) {
      const list = bound.get(eventId) ?? [];
      list.push({ id: chapter.id, title: chapter.title, index });
      bound.set(eventId, list);
    }
  });
  const events: StoryGraphEvent[] = roadmap.events.map((event) => {
    const lineIds = eventLines(roadmap, event.id).map((line) => line.id);
    return { ...event, lineIds, shared: lineIds.length > 1, primaryLineId: lineIds[0] ?? "", boundChapters: (bound.get(event.id) ?? []).sort((a, b) => a.index - b.index) };
  });
  const ordered = [...events].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const lines: StoryGraphLine[] = roadmap.lines
    .map((line) => {
      const total = line.eventIds.length;
      const done = roadmap.events.filter((event) => line.eventIds.includes(event.id) && event.status === "done").length;
      return { ...line, eventIds: [...line.eventIds], done, total, progress: total ? Math.round(done / total * 100) : 0 };
    })
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "main" ? -1 : 1));
  return {
    lines,
    events,
    columns: buildColumns(ordered, chapters),
    eventOrder: ordered.map((event) => event.id),
    sharedCount: events.filter((event) => event.shared).length,
    unplannedCount: events.filter((event) => !event.boundChapters.length).length,
    totalEvents: events.length,
    doneEvents: events.filter((event) => event.status === "done").length,
  };
}

function buildColumns(ordered: StoryGraphEvent[], chapters: GraphChapter[]): StoryColumn[] {
  const columns: StoryColumn[] = [];
  const chapterColumns = new Map<number, StoryColumn>();
  for (const event of ordered) {
    const first = event.boundChapters[0];
    if (!first) continue;
    let column = chapterColumns.get(first.index);
    if (!column) {
      column = { id: `chapter-${first.id}`, kind: "chapter", label: chapters[first.index]?.title ?? first.title, chapterId: first.id, chapterIndex: first.index, eventIds: [] };
      chapterColumns.set(first.index, column);
      columns.push(column);
    }
    column.eventIds.push(event.id);
  }
  columns.sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0));
  const unplanned = ordered.filter((event) => !event.boundChapters.length).map((event) => event.id);
  // The unplanned area always sits at the end so nothing looks scheduled by accident.
  return unplanned.length ? [...columns, { id: "unplanned", kind: "unplanned", label: "待安排章节", eventIds: unplanned }] : columns;
}

// Lane rows follow the graph order (main lines on top), positions follow the
// narrative order left to right, and each event's stage comes from its column.
// Same input, same output — no randomness, no measuring.
export function layoutStoryLanes(graph: StoryGraph, options: StoryLayoutOptions = {}): StoryLayout {
  const laneHeight = options.laneHeight ?? 244;
  const columnWidth = options.columnWidth ?? 238;
  const columns = graph.columns;
  const columnIndex = new Map(columns.map((column, index) => [column.id, index]));
  const eventColumn = new Map<string, string>();
  for (const column of columns) for (const eventId of column.eventIds) if (!eventColumn.has(eventId)) eventColumn.set(eventId, column.id);
  const rowOf = new Map(graph.lines.map((line, index) => [line.id, index]));
  const perColumnIndex = new Map<string, number>();
  const positions: Record<string, StoryPosition> = {};
  graph.eventOrder.forEach((eventId, narrativeIndex) => {
    const event = graph.events.find((item) => item.id === eventId);
    if (!event) return;
    const lineId = event.primaryLineId || graph.lines[0]?.id || "";
    const columnId = eventColumn.get(eventId) ?? "unplanned";
    const key = `${columnId}::${lineId}`;
    const index = perColumnIndex.get(key) ?? 0;
    perColumnIndex.set(key, index + 1);
    positions[eventId] = {
      x: 222 + narrativeIndex * columnWidth,
      y: (rowOf.get(lineId) ?? 0) * laneHeight,
      columnIndex: columnIndex.get(columnId) ?? 0,
      row: rowOf.get(lineId) ?? 0,
      index,
      lineId,
    };
  });
  const columnStarts: Record<string, number> = {};
  for (const column of columns) {
    const xs = column.eventIds.map((id) => positions[id]?.x).filter((value): value is number => typeof value === "number");
    if (xs.length) columnStarts[column.id] = Math.max(0, Math.min(...xs) - columnWidth / 2 - 20);
  }
  return {
    columns,
    columnStarts,
    eventOrder: graph.eventOrder,
    positions,
    width: Math.max(780, graph.eventOrder.length * columnWidth + 240),
    height: Math.max(graph.lines.length, 1) * laneHeight,
    laneHeight,
    columnWidth,
    laneCount: Math.max(graph.lines.length, 1),
    sharedCount: graph.sharedCount,
    unplannedCount: graph.unplannedCount,
  };
}

export type GraphView = {
  focusLineId?: string;
  collapsedLineIds?: string[];
  query?: string;
  lod?: 0 | 1 | 2;
  currentChapterId?: string;
};

export type VisibleStoryGraph = {
  lines: StoryGraphLine[];
  nodes: Array<{ event: StoryGraphEvent; position: StoryPosition; dimmed: boolean; shared: boolean; boundHere: boolean }>;
  matchedEventIds: string[];
  dimmedLineIds: string[];
  lod: 0 | 1 | 2;
  hiddenEventIds: string[];
  currentColumnId?: string;
};

// Zoom decides how much information a node carries; focus, collapse and search
// only dim or hide, so the layout never reshuffles under the author.
export function selectVisibleStoryGraph(graph: StoryGraph, layout: StoryLayout, view: GraphView = {}): VisibleStoryGraph {
  const collapsed = new Set(view.collapsedLineIds ?? []);
  const query = (view.query ?? "").trim().toLowerCase();
  const dimmedLineIds = graph.lines.filter((line) => view.focusLineId && view.focusLineId !== "all" && line.id !== view.focusLineId).map((line) => line.id);
  const matchedEventIds: string[] = [];
  const nodes: VisibleStoryGraph["nodes"] = [];
  const hiddenEventIds: string[] = [];
  for (const event of graph.events) {
    const position = layout.positions[event.id];
    if (!position) continue;
    if (collapsed.has(position.lineId) && event.lineIds.every((id) => collapsed.has(id))) { hiddenEventIds.push(event.id); continue; }
    let dimmed = dimmedLineIds.includes(position.lineId);
    if (query) {
      const haystack = `${event.title} ${event.note} ${event.chapter} ${event.lineIds.map((id) => graph.lines.find((line) => line.id === id)?.title ?? "").join(" ")}`.toLowerCase();
      if (haystack.includes(query)) matchedEventIds.push(event.id); else dimmed = true;
    }
    nodes.push({
      event,
      position,
      dimmed,
      shared: event.shared,
      boundHere: Boolean(view.currentChapterId && event.boundChapters.some((chapter) => chapter.id === view.currentChapterId)),
    });
  }
  const currentColumn = view.currentChapterId ? graph.columns.find((column) => column.chapterId === view.currentChapterId) : undefined;
  return {
    lines: graph.lines,
    nodes,
    matchedEventIds,
    dimmedLineIds,
    lod: view.lod ?? 2,
    hiddenEventIds,
    ...(currentColumn ? { currentColumnId: currentColumn.id } : {}),
  };
}

// Events whose chapter text *looks* scheduled but that no chapter actually
// binds. Reported so the author fixes the binding instead of trusting free text.
export function unboundEventWarnings(graph: StoryGraph): Array<{ eventId: string; title: string; chapter: string }> {
  return graph.events
    .filter((event) => !event.boundChapters.length && Boolean(event.chapter.trim()) && !/^(待安排|待定|未安排)/.test(event.chapter.trim()))
    .map((event) => ({ eventId: event.id, title: event.title, chapter: event.chapter }));
}

export function laneColor(index: number): string {
  return lineColors[index % lineColors.length];
}

export function lineProgressLabel(line: StoryGraphLine): string {
  return `${line.done}/${line.total} 已写`;
}

export function eventsOfLineInOrder(line: StoryGraphLine, graph: StoryGraph): StoryGraphEvent[] {
  return graph.eventOrder.flatMap((id) => {
    const event = graph.events.find((item) => item.id === id);
    return event && line.eventIds.includes(event.id) ? [event] : [];
  });
}

export function sharedEventHint(graph: StoryGraph, eventId: string): string {
  const event = graph.events.find((item) => item.id === eventId);
  if (!event?.shared) return "";
  return `同一事件，出现在：${event.lineIds.map((id) => graph.lines.find((line) => line.id === id)?.title ?? id).join("、")}`;
}
