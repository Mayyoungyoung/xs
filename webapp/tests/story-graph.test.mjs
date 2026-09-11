import test from "node:test";
import assert from "node:assert/strict";
import { buildStoryGraph, layoutStoryLanes, selectVisibleStoryGraph, unboundEventWarnings, laneColor, eventsOfLineInOrder } from "../lib/story-graph.ts";

const roadmap = {
  lines: [
    { id: "main-a", title: "追查失踪", goal: "查清妹妹下落", kind: "main", color: "#8b372f", eventIds: ["e1", "e2", "e3"] },
    { id: "main-b", title: "交易所", goal: "揭露交易链", kind: "main", color: "#346783", eventIds: ["e2"] },
    { id: "branch-a", title: "旧照片", goal: "解释照片", kind: "branch", color: "#357360", originId: "e1", eventIds: ["e1", "e3"] },
  ],
  events: [
    { id: "e1", title: "妹妹失踪", note: "发现残片", order: 1, chapter: "1-3", status: "done" },
    { id: "e2", title: "潜入交易所", note: "以记忆为抵押", order: 2, chapter: "4-8", status: "planned" },
    { id: "e3", title: "真相与代价", note: "两线交汇", order: 3, chapter: "待安排", status: "planned" },
  ],
};
const chapters = [
  { id: "c1", title: "第 1 章", plotEventIds: ["e1"] },
  { id: "c2", title: "第 2 章", plotEventIds: [] },
  { id: "c3", title: "第 3 章", plotEventIds: ["e1", "e2"] },
];

test("graph derives shared events, bound chapters and progress from one authority", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  const e1 = graph.events.find((event) => event.id === "e1");
  assert.deepEqual(e1.lineIds, ["main-a", "branch-a"]);
  assert.equal(e1.shared, true);
  assert.deepEqual(e1.boundChapters.map((chapter) => chapter.id), ["c1", "c3"]);
  const e2 = graph.events.find((event) => event.id === "e2");
  assert.deepEqual(e2.lineIds, ["main-a", "main-b"]);
  assert.equal(e2.shared, true);
  assert.equal(e2.primaryLineId, "main-a");
  assert.equal(graph.sharedCount, 3, "e1, e2 and e3 are each referenced by more than one line");
  assert.equal(graph.unplannedCount, 1);
  assert.equal(graph.doneEvents, 1);
  assert.deepEqual(graph.lines.map((line) => [line.id, line.done, line.total, line.progress]), [["main-a", 1, 3, 33], ["main-b", 0, 1, 0], ["branch-a", 1, 2, 50]]);
  assert.deepEqual(eventsOfLineInOrder(graph.lines[0], graph).map((event) => event.id), ["e1", "e2", "e3"]);
});

test("columns come from real chapter bindings, and unplanned events get their own area", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  assert.deepEqual(graph.columns.map((column) => [column.id, column.kind, column.label, column.eventIds]), [
    ["chapter-c1", "chapter", "第 1 章", ["e1"]],
    ["chapter-c3", "chapter", "第 3 章", ["e2"]],
    ["unplanned", "unplanned", "待安排章节", ["e3"]],
  ]);
  const withoutBindings = buildStoryGraph(roadmap, []);
  assert.deepEqual(withoutBindings.columns.map((column) => column.id), ["unplanned"]);
  assert.deepEqual(withoutBindings.columns[0].eventIds, ["e1", "e2", "e3"]);
  assert.deepEqual(unboundEventWarnings(buildStoryGraph(roadmap, [{ id: "c1", title: "第 1 章", plotEventIds: ["e1", "e2"] }])).map((warning) => warning.eventId), [], "a placeholder chapter text is not reported as a broken binding");
  assert.deepEqual(unboundEventWarnings(buildStoryGraph({ ...roadmap, events: roadmap.events.map((event) => event.id === "e3" ? { ...event, chapter: "9-12" } : event) }, [])).map((warning) => warning.eventId), ["e1", "e2", "e3"]);
});

test("lane layout is deterministic and never invents positions", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  const first = layoutStoryLanes(graph);
  const second = layoutStoryLanes(graph);
  assert.deepEqual(first, second, "same roadmap always lays out identically");
  assert.equal(first.laneCount, 3);
  assert.equal(first.height, 3 * 244);
  assert.equal(first.width, Math.max(780, 3 * 238 + 240));
  const e1 = first.positions.e1;
  const e2 = first.positions.e2;
  const e3 = first.positions.e3;
  assert.deepEqual([e1.columnIndex, e1.row, e1.lineId], [0, 0, "main-a"]);
  assert.deepEqual([e2.columnIndex, e2.row, e2.lineId], [1, 0, "main-a"]);
  assert.deepEqual([e3.columnIndex, e3.row, e3.lineId], [2, 0, "main-a"], "unplanned area sits after real chapters");
  assert.equal(Object.keys(first.positions).length, 3);
  const single = layoutStoryLanes(buildStoryGraph({ lines: [{ id: "m", title: "M", goal: "", kind: "main", color: "#8b372f", eventIds: ["x"] }], events: [{ id: "x", title: "X", note: "", order: 1, chapter: "", status: "planned" }] }, []));
  assert.equal(single.width, 780, "a short roadmap keeps the minimum comfortable width");
});

test("zoom level decides detail, while focus, collapse and search only dim", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  const layout = layoutStoryLanes(graph);
  const far = selectVisibleStoryGraph(graph, layout, { lod: 0 });
  const near = selectVisibleStoryGraph(graph, layout, { lod: 2 });
  assert.equal(far.lod, 0);
  assert.equal(near.lod, 2);
  assert.deepEqual(far.nodes.map((node) => node.event.id), near.nodes.map((node) => node.event.id), "changing zoom never reorders or drops nodes");

  const focused = selectVisibleStoryGraph(graph, layout, { focusLineId: "main-b" });
  assert.deepEqual(focused.dimmedLineIds.sort(), ["branch-a", "main-a"]);
  assert.equal(focused.nodes.every((node) => node.dimmed === (node.position.lineId !== "main-b")), true);

  const collapsed = selectVisibleStoryGraph(graph, layout, { collapsedLineIds: ["branch-a"] });
  assert.deepEqual(collapsed.hiddenEventIds, [], "an event that also lives on a visible line is never hidden");
  assert.equal(collapsed.nodes.some((node) => node.event.id === "e3"), true, "shared events stay visible while another owner line is expanded");
  const collapsedSolo = selectVisibleStoryGraph(buildStoryGraph({ lines: [{ id: "only", title: "Only", goal: "", kind: "main", color: "#8b372f", eventIds: ["x"] }], events: [{ id: "x", title: "X", note: "", order: 1, chapter: "", status: "planned" }] }, []), layoutStoryLanes(buildStoryGraph({ lines: [{ id: "only", title: "Only", goal: "", kind: "main", color: "#8b372f", eventIds: ["x"] }], events: [{ id: "x", title: "X", note: "", order: 1, chapter: "", status: "planned" }] }, [])), { collapsedLineIds: ["only"] });
  assert.deepEqual(collapsedSolo.nodes, [], "a collapsed line with no other owner hides its events");

  const searched = selectVisibleStoryGraph(graph, layout, { query: "交易所" });
  assert.deepEqual(searched.matchedEventIds, ["e2"]);
  assert.equal(searched.nodes.find((node) => node.event.id === "e1").dimmed, true);
  assert.equal(searched.nodes.find((node) => node.event.id === "e2").dimmed, false);
  const byLine = selectVisibleStoryGraph(graph, layout, { query: "旧照片" });
  assert.ok(byLine.matchedEventIds.includes("e1") && byLine.matchedEventIds.includes("e3"));
  const located = selectVisibleStoryGraph(graph, layout, { currentChapterId: "c3" });
  assert.equal(located.currentColumnId, "chapter-c3");
  assert.equal(located.nodes.find((node) => node.event.id === "e2").boundHere, true);
  assert.equal(located.nodes.find((node) => node.event.id === "e1").boundHere, true);
  assert.equal(laneColor(0), "#8b372f");
  assert.equal(laneColor(7), "#346783");
});
