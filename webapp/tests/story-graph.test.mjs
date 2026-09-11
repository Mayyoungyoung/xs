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
  assert.equal(Object.keys(first.positions).length, 3);
  const single = layoutStoryLanes(buildStoryGraph({ lines: [{ id: "m", title: "M", goal: "", kind: "main", color: "#8b372f", eventIds: ["x"] }], events: [{ id: "x", title: "X", note: "", order: 1, chapter: "", status: "planned" }] }, []));
  assert.ok(single.width >= 780, "a short roadmap keeps the minimum comfortable width");
});

test("chapter zones have real extents, never invert, and hold their own nodes", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  const layout = layoutStoryLanes(graph);
  assert.deepEqual(layout.zones.map((zone) => [zone.id, zone.kind]), [["chapter-c1", "chapter"], ["chapter-c3", "chapter"], ["unplanned", "unplanned"]]);
  for (let index = 1; index < layout.zones.length; index++) {
    const previous = layout.zones[index - 1];
    const current = layout.zones[index];
    assert.ok(current.x >= previous.x + previous.width, "zones never overlap or invert");
    assert.ok(current.width > 0 && previous.width > 0, "every zone has a real width");
  }
  const unplanned = layout.zones.at(-1);
  assert.equal(unplanned.kind, "unplanned");
  assert.equal(unplanned.label, "待安排章节", "the pending area is not dressed up as a scheduled chapter");
  for (const zone of layout.zones) {
    for (const eventId of zone.eventIds) {
      const position = layout.positions[eventId];
      assert.ok(position.x >= zone.x && position.x + layout.cardWidth <= zone.x + zone.width, `${eventId} sits inside ${zone.id}`);
    }
  }
  // e3 is unplanned: it must not appear in a chapter zone's box.
  const e3Zone = layout.zones.find((zone) => zone.eventIds.includes("e3"));
  assert.equal(e3Zone.kind, "unplanned");
  assert.ok(layout.width >= unplanned.x + unplanned.width);
});

test("parallel events share a slot, clashing cards get another one, nothing overlaps", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  const layout = layoutStoryLanes(graph);
  for (const zone of layout.zones) {
    // Two cards in the same zone may share an x only when their lane sets are disjoint.
    const byX = new Map();
    for (const eventId of zone.eventIds) {
      const position = layout.positions[eventId];
      const rows = new Set(graph.events.find((event) => event.id === eventId).lineIds.map((lineId) => graph.lines.findIndex((line) => line.id === lineId)));
      const others = byX.get(position.x) ?? [];
      for (const other of others) for (const row of rows) assert.ok(!other.has(row), "cards sharing a slot never share a lane");
      others.push(rows);
      byX.set(position.x, others);
    }
  }
  // Two events on the same lane inside one chapter cannot share a slot.
  const sameLane = buildStoryGraph({
    lines: [{ id: "m", title: "M", goal: "", kind: "main", color: "#8b372f", eventIds: ["a", "b"] }],
    events: [
      { id: "a", title: "A", note: "", order: 1, chapter: "1", status: "planned" },
      { id: "b", title: "B", note: "", order: 2, chapter: "1", status: "planned" },
    ],
  }, [{ id: "c1", title: "第 1 章", plotEventIds: ["a", "b"] }]);
  const packed = layoutStoryLanes(sameLane);
  assert.notEqual(packed.positions.a.x, packed.positions.b.x, "the second card takes the next slot in the same chapter");
  assert.equal(packed.zones[0].slotCount, 2);

  // Events on different lanes of the same chapter may share one slot.
  const parallel = buildStoryGraph({
    lines: [
      { id: "m", title: "M", goal: "", kind: "main", color: "#8b372f", eventIds: ["a"] },
      { id: "n", title: "N", goal: "", kind: "main", color: "#346783", eventIds: ["b"] },
    ],
    events: [
      { id: "a", title: "A", note: "", order: 1, chapter: "1", status: "planned" },
      { id: "b", title: "B", note: "", order: 2, chapter: "1", status: "planned" },
    ],
  }, [{ id: "c1", title: "第 1 章", plotEventIds: ["a", "b"] }]);
  const shared = layoutStoryLanes(parallel);
  assert.equal(shared.positions.a.x, shared.positions.b.x, "parallel work in one chapter shares a column");
  assert.equal(shared.zones[0].slotCount, 1);
});

test("the narrative view lays events by narrative order with the chapter as an attribute", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  const chapterView = layoutStoryLanes(graph);
  const narrativeView = layoutStoryLanes(graph, { mode: "narrative" });
  assert.equal(chapterView.mode, "chapters");
  assert.equal(narrativeView.mode, "narrative");
  assert.deepEqual(narrativeView.zones, [], "the narrative view has no chapter zones: the two semantics never share one axis");
  const xs = narrativeView.eventOrder.map((id) => narrativeView.positions[id].x);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, "events run left to right in narrative order");
  assert.equal(new Set(xs).size, xs.length, "each event owns one column in this view");
  assert.deepEqual(narrativeView.eventOrder, chapterView.eventOrder, "both views describe the same events in the same order");
  assert.deepEqual(graph.events.find((event) => event.id === "e2").boundChapters.map((chapter) => chapter.id), ["c3"], "the chapter stays available as an event attribute");
  assert.deepEqual(layoutStoryLanes(graph, { mode: "narrative" }), narrativeView, "narrative layout is deterministic too");
});

test("chapter text that contradicts the binding is reported, never re-scheduled", () => {
  const conflicting = buildStoryGraph({
    lines: [{ id: "m", title: "M", goal: "", kind: "main", color: "#8b372f", eventIds: ["a"] }],
    events: [{ id: "a", title: "A", note: "", order: 1, chapter: "5", status: "planned" }],
  }, [{ id: "c1", title: "第 1 章", plotEventIds: ["a"] }]);
  const layout = layoutStoryLanes(conflicting);
  assert.equal(layout.zones[0].id, "chapter-c1", "the binding wins over the free-text chapter");
  assert.ok(layout.warnings.some((warning) => warning.includes("第 5 章")), "the contradiction is surfaced");
  assert.deepEqual(conflicting.events[0].chapter, "5", "the author's data is never rewritten");
});

test("zoom level decides detail, while focus, collapse and search only dim", () => {
  const graph = buildStoryGraph(roadmap, chapters);
  const layout = layoutStoryLanes(graph);
  const before = JSON.stringify(layout);
  const far = selectVisibleStoryGraph(graph, layout, { lod: 0 });
  const near = selectVisibleStoryGraph(graph, layout, { lod: 2 });
  assert.equal(JSON.stringify(layout), before, "changing the view never rewrites geometry");
  assert.deepEqual(graph.eventOrder, buildStoryGraph(roadmap, chapters).eventOrder, "changing the view never rewrites event ids or order");
  assert.equal(far.lod, 0);
  assert.equal(near.lod, 2);
  assert.deepEqual(far.nodes.map((node) => node.event.id), near.nodes.map((node) => node.event.id), "changing zoom never reorders or drops nodes");

  const focused = selectVisibleStoryGraph(graph, layout, { focusLineId: "main-b" });
  assert.deepEqual(focused.dimmedLineIds.sort(), ["branch-a", "main-a"]);
  assert.equal(focused.nodes.every((node) => node.dimmed === !node.event.lineIds.includes("main-b")), true, "focus follows every owning line, not just the primary lane");
  const sharedInFocus = focused.nodes.find((node) => node.event.id === "e2");
  assert.equal(sharedInFocus.position.lineId, "main-a");
  assert.equal(sharedInFocus.dimmed, false, "a shared event stays visible even when its card lives on another lane");

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
