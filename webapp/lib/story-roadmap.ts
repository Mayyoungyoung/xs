import type { BookWorkspace, PlotState } from "@/components/novel/book-workspace";

export type RoadmapEvent = { id: string; title: string; note: string; order: number; chapter: string; status: "planned" | "active" | "done" };
export type Storyline = { id: string; title: string; goal: string; kind: "main" | "branch"; color: string; eventIds: string[]; originId?: string };
export type StoryRoadmap = { lines: Storyline[]; events: RoadmapEvent[] };
export const eventStatus = { planned: "待写", active: "正在写", done: "已写完" };
export const lineColors = ["#8b372f", "#346783", "#357360", "#77548c", "#966027", "#565ea1"];

// Old plots stay intact in backups. Stable derived IDs let old books use chapter bindings too.
export function getRoadmap(plot: Pick<PlotState, "roadmap" | "nodes" | "branches" | "summary">): StoryRoadmap {
  if (plot.roadmap) return plot.roadmap;
  const events: RoadmapEvent[] = (plot.nodes ?? []).map((node, index) => ({ ...node, id: `legacy-event-${index}`, order: index + 1, status: "planned" }));
  if (!events.length) return { lines: [], events: [] };
  const lines: Storyline[] = [{ id: "legacy-main", title: "故事主线", goal: plot.summary ?? "", kind: "main", color: lineColors[0], eventIds: events.map((event) => event.id) }];
  if (events.length > 1) for (const branch of plot.branches) {
    const from = Math.min(events.length - 2, Math.max(0, branch.from ?? Math.round((Number(branch.path.match(/^M([\d.]+)/)?.[1] ?? 95) - 95) / 1135 * (events.length - 1))));
    const to = Math.min(events.length - 1, Math.max(from + 1, branch.to ?? Math.round((Number(branch.path.match(/([\d.]+)\s+244\s*$/)?.[1] ?? 1230) - 95) / 1135 * (events.length - 1))));
    lines.push({ id: `legacy-${branch.id}`, title: branch.title, goal: branch.labels.map((label, i) => `${i === 0 ? "埋线" : "回收"}：${label.text}`).join("\n"), kind: "branch", color: branch.color, originId: events[from].id, eventIds: [events[from].id, events[to].id] });
  }
  return { lines, events };
}
export function eventsForLine(roadmap: StoryRoadmap, line: Storyline) {
  return roadmap.events.filter((event) => line.eventIds.includes(event.id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function eventLines(roadmap: StoryRoadmap, id: string) { return roadmap.lines.filter((line) => line.eventIds.includes(id)); }
export function chapterMatches(range: string, chapter: number) {
  const match = range.trim().match(/^(?:第\s*)?(\d+)\s*(?:[章回节]\s*)?(?:[-–—~～至]\s*(?:第\s*)?(\d+)\s*(?:[章回节])?)?$/);
  return Boolean(match && chapter >= +match[1] && chapter <= +(match[2] ?? match[1]));
}
export function chapterPlan(workspace: BookWorkspace) {
  const roadmap = getRoadmap(workspace.plot);
  const index = Math.max(0, workspace.chapters.findIndex((chapter) => chapter.id === workspace.activeChapterId));
  const chapter = workspace.chapters[index];
  const manual = chapter?.plotEventIds !== undefined;
  let ids = chapter?.plotEventIds;
  if (!ids) {
    const assigned = roadmap.events.filter((event) => event.status !== "done" && chapterMatches(event.chapter, index + 1));
    const candidates = assigned.length ? assigned : roadmap.lines.filter((line) => line.kind === "main" || roadmap.events.find((event) => event.id === line.originId)?.status === "done").flatMap((line) => {
      const next = eventsForLine(roadmap, line).find((event) => event.status !== "done"); return next ? [next] : [];
    }).slice(0, 3);
    ids = [...new Set(candidates.map((event) => event.id))];
  }
  const events = roadmap.events.filter((event) => ids.includes(event.id)).sort((a, b) => a.order - b.order);
  const missing = ids.filter((id) => !roadmap.events.some((event) => event.id === id));
  const earlier = roadmap.events.filter((event) => event.status !== "done" && !ids.includes(event.id) && events.some((target) => event.order < target.order && roadmap.lines.some((line) => line.eventIds.includes(event.id) && line.eventIds.includes(target.id))));
  return { roadmap, chapter, index, manual, ids, events, missing, earlier };
}
export function worldlineContext(workspace: BookWorkspace, active: string) {
  const plan = chapterPlan(workspace);
  const { roadmap, events, missing } = plan;
  if (!roadmap.lines.length) return "【世界线】尚未安排主支线。";
  const lines = roadmap.lines.map((line) => `${line.kind === "main" ? "主线" : "支线"} ${line.title}：${line.goal}\n${eventsForLine(roadmap, line).map((event) => event.id).join(" → ")}`).join("\n");
  const details = roadmap.events.slice().sort((a, b) => a.order - b.order).map((event) => ({ ...event, status: eventStatus[event.status], lines: eventLines(roadmap, event.id).map((line) => line.title), assignedChapters: workspace.chapters.flatMap((chapter, index) => chapter.plotEventIds?.includes(event.id) ? [`${index + 1}：${chapter.title}`] : []) }));
  return ["【世界线写作约束】这是剧情计划，不是已经发生的正文事实。按事件顺序推进，多线交汇必须是同一个事件。未完成事件不能当作已发生；不要提前揭露后续反转或回收后续伏笔。作者标记已写完的事件也必须结合章节位置判断，不得把后文事实带进前章。",
    active === "chapters" ? `【本章推进目标：第 ${plan.index + 1} 个章节】${missing.length ? "绑定事件已不存在，需要作者重新安排。" : events.length ? JSON.stringify(events) : "作者尚未选择推进事件；只按本章要求写作，不擅自完成整条世界线。"}\n只展开本章目标，其他事件作为后续计划；已在当前正文发生的情节不要重复。` : "",
    `【故事线关系】\n${lines}`, `【事件路线，含未来计划】\n${JSON.stringify(details)}`,
  ].join("\n\n").slice(0, 45000);
}
