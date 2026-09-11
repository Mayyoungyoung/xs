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
    return {
      ...event,
      lineIds,
      shared: lineIds.length > 1,
      primaryLineId: lineIds[0] ?? "",
      boundChapters: (bound.get(event.id) ?? []).sort((a, b) => a.index - b.index),
    };
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

export type StoryPosition = { x: number; y: number; zoneId: string; slot: number; row: number; lineId: string };

// A zone is a real region on the canvas: one chapter (from the authoritative
// chapter bindings) or the explicit unplanned area. It has a start, a width and
// the events that live inside it.
export type StoryZone = {
  id: string;
  kind: "chapter" | "unplanned";
  label: string;
  chapterId?: string;
  chapterIndex?: number;
  x: number;
  width: number;
  slotCount: number;
  eventIds: string[];
};

export type StoryLayout = {
  zones: StoryZone[];
  eventOrder: string[];
  positions: Record<string, StoryPosition>;
  width: number;
  height: number;
  laneHeight: number;
  cardWidth: number;
  laneCount: number;
  sharedCount: number;
  unplannedCount: number;
  warnings: string[];
};

export type StoryLayoutOptions = { laneHeight?: number; cardWidth?: number; zoneWidth?: number };

const ZONE_PADDING = 18;
const ZONE_GAP = 28;

// Lane rows follow the graph order (main lines on top). Inside a zone the events
// are ordered by narrative order and packed into slots: events whose lanes do not
// clash share a slot, so a chapter does not need one column per event.
export function layoutStoryLanes(graph: StoryGraph, options: StoryLayoutOptions = {}): StoryLayout {
  const laneHeight = options.laneHeight ?? 244;
  const cardWidth = options.cardWidth ?? 190;
  const zoneWidth = options.zoneWidth ?? cardWidth + 56;
  const rowOf = new Map(graph.lines.map((line, index) => [line.id, index]));
  const rowsOfEvent = (eventId: string) => {
    const event = graph.events.find((item) => item.id === eventId);
    if (!event) return [];
    const rows = new Set<number>();
    // The primary lane draws the card; every other lane referencing it draws an anchor.
    for (const lineId of event.lineIds) {
      const row = rowOf.get(lineId);
      if (row !== undefined) rows.add(row);
    }
    if (event.primaryLineId) {
      const row = rowOf.get(event.primaryLineId);
      if (row !== undefined) rows.add(row);
    }
    return [...rows].sort((a, b) => a - b);
  };

  const warnings: string[] = [];
  const positions: Record<string, StoryPosition> = {};
  const zones: StoryZone[] = [];
  let cursorX = 0;

  for (const column of graph.columns) {
    // Slots inside this zone: a slot is a set of occupied rows.
    const slots: Array<Set<number>> = [];
    const slotOf = new Map<string, number>();
    for (const eventId of column.eventIds) {
      const rows = rowsOfEvent(eventId);
      let slot = slots.findIndex((occupied) => rows.every((row) => !occupied.has(row)));
      if (slot < 0) { slots.push(new Set()); slot = slots.length - 1; }
      for (const row of rows) slots[slot].add(row);
      slotOf.set(eventId, slot);
    }
    const slotCount = Math.max(slots.length, 1);
    const width = slotCount * zoneWidth + ZONE_PADDING * 2;
    const zone: StoryZone = {
      id: column.id, kind: column.kind, label: column.label,
      ...(column.chapterId ? { chapterId: column.chapterId } : {}),
      ...(column.chapterIndex !== undefined ? { chapterIndex: column.chapterIndex } : {}),
      x: cursorX, width, slotCount, eventIds: [...column.eventIds],
    };
    zones.push(zone);
    for (const eventId of column.eventIds) {
      const slot = slotOf.get(eventId) ?? 0;
      const row = rowOf.get(graph.events.find((item) => item.id === eventId)?.primaryLineId ?? "") ?? 0;
      positions[eventId] = {
        x: zone.x + ZONE_PADDING + slot * zoneWidth,
        y: row * laneHeight,
        zoneId: zone.id,
        slot,
        row,
        lineId: graph.events.find((item) => item.id === eventId)?.primaryLineId ?? "",
      };
    }
    cursorX += width + ZONE_GAP;
  }

  // An event whose chapter text points at a different chapter than its binding is
  // reported, never silently re-scheduled.
  for (const event of graph.events) {
    const bound = event.boundChapters[0];
    if (!bound) continue;
    const text = event.chapter.trim();
    if (!text || /^(待安排|待定|未安排)/.test(text)) continue;
    const single = text.match(/^(?:第\s*)?(\d+)\s*(?:章)?$/);
    if (single && Number(single[1]) !== bound.index + 1) {
      warnings.push(`「${event.title}」写在第 ${single[1]} 章，但已绑定到「${bound.title}」；以章节绑定为准。`);
    }
  }

  const laneCount = Math.max(graph.lines.length, 1);
  return {
    zones,
    eventOrder: graph.eventOrder,
    positions,
    width: Math.max(780, cursorX - ZONE_GAP),
    height: laneCount * laneHeight,
    laneHeight,
    cardWidth,
    laneCount,
    sharedCount: graph.sharedCount,
    unplannedCount: graph.unplannedCount,
    warnings,
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
  hiddenMatches: string[];
  currentColumnId?: string;
};

// Zoom decides how much information a node carries; focus, collapse and search
// only dim or hide, so the layout never reshuffles under the author.
export function selectVisibleStoryGraph(graph: StoryGraph, layout: StoryLayout, view: GraphView = {}): VisibleStoryGraph {
  const collapsed = new Set(view.collapsedLineIds ?? []);
  const query = (view.query ?? "").trim().toLowerCase();
  const focused = view.focusLineId && view.focusLineId !== "all" ? view.focusLineId : undefined;
  const dimmedLineIds = graph.lines.filter((line) => focused && line.id !== focused).map((line) => line.id);
  const matchedEventIds: string[] = [];
  const nodes: VisibleStoryGraph["nodes"] = [];
  const hiddenEventIds: string[] = [];
  for (const event of graph.events) {
    const position = layout.positions[event.id];
    if (!position) continue;
    // Collapsing really removes nodes and their edges, but a shared event stays
    // while at least one of the lines it belongs to is still expanded.
    if (event.lineIds.length && event.lineIds.every((id) => collapsed.has(id))) { hiddenEventIds.push(event.id); continue; }
    // Focus follows every line the event belongs to, not just its primary lane,
    // so a focused branch keeps its origin and its shared intersections visible.
    let dimmed = focused ? !event.lineIds.includes(focused) : false;
    if (!dimmed && focused && dimmedLineIds.length && event.lineIds.length === 0) dimmed = false;
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
  // Search hits inside collapsed lines are surfaced so the author can expand them.
  const hiddenMatches = graph.events.filter((event) => hiddenEventIds.includes(event.id) && query && `${event.title} ${event.note}`.toLowerCase().includes(query)).map((event) => event.id);
  const currentColumn = view.currentChapterId ? graph.columns.find((column) => column.chapterId === view.currentChapterId) : undefined;
  return {
    lines: graph.lines,
    nodes,
    matchedEventIds,
    dimmedLineIds,
    lod: view.lod ?? 2,
    hiddenEventIds,
    hiddenMatches,
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
