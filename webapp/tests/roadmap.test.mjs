import test from "node:test";
import assert from "node:assert/strict";
import { getRoadmap, chapterPlan, chapterMatches } from "../lib/story-roadmap.ts";
import { roadmapSchema } from "../lib/roadmap-schema.ts";
import { parseGeneratedPlot, parseBackup } from "../lib/novel-data.ts";
import { buildStoryContext, createBookWorkspace, withSnapshot } from "../components/novel/book-workspace.ts";

const book = { id: "routes", title: "记忆交易", genre: "悬疑", premise: "寻找妹妹", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#8b372f", glyph: "忆" };
const source = { summary: "两条主线在拍卖会交汇", lines: [
  { id: "a", title: "救人", goal: "找到妹妹", kind: "main", color: "#8b372f", eventIds: ["one", "joint"] },
  { id: "b", title: "调查", goal: "揭开幕后势力", kind: "main", color: "#346783", eventIds: ["two", "joint"] },
  { id: "c", title: "照片秘密", goal: "解释旧照片", kind: "branch", color: "#357360", originId: "one", eventIds: ["one", "joint"] },
], events: [
  { id: "one", title: "妹妹失踪", note: "收到密信", chapter: "1", order: 1, status: "planned" },
  { id: "two", title: "查到账本", note: "调查线推进", chapter: "2", order: 2, status: "planned" },
  { id: "joint", title: "拍卖会交汇", note: "此时才揭露幕后人", chapter: "3–4", order: 3, status: "planned" },
] };

test("legacy mainline and branch notes survive conversion, snapshots and backup round trips", () => {
  const w = createBookWorkspace(book);
  w.assets.timeline = "十年前的旧事";
  w.plot.nodes = [{ title: "起点", chapter: "1", note: "开端" }, { title: "终点", chapter: "5", note: "收束" }];
  w.plot.branches = [{ id: "old", title: "旧照片", color: "#346783", path: "M95 244 C155 65 1170 65 1230 244", labels: [{ x: 200, y: 65, text: "发现照片" }, { x: 1000, y: 65, text: "认出身份" }], status: "resolved" }];
  const original = JSON.stringify(w);
  const roadmap = getRoadmap(w.plot);
  assert.equal(JSON.stringify(w), original, "reading old data does not mutate it");
  assert.equal(roadmap.lines[1].originId, "legacy-event-0");
  assert.ok(roadmap.lines[1].goal.includes("认出身份"));
  assert.ok(roadmap.events.every((event) => event.status === "planned"), "old planned branch status does not claim manuscript was written");
  w.plot.roadmap = roadmap;
  w.chapters[0].plotEventIds = ["legacy-event-0"];
  const saved = withSnapshot(w, "路线图修改前");
  const reloaded = parseBackup(JSON.parse(JSON.stringify({ books: [book], workspaces: { routes: saved } }))).workspaces.routes;
  assert.equal(reloaded.assets.timeline, "十年前的旧事");
  assert.deepEqual(reloaded.chapters[0].plotEventIds, ["legacy-event-0"]);
  assert.equal(reloaded.versions[0].snapshot.plot.roadmap.events[0].title, "起点");
});

test("multi-line proposals validate shared intersections and reject dangling, duplicate or backwards references", () => {
  const generated = parseGeneratedPlot(JSON.stringify(source));
  assert.equal(generated.roadmap.lines.length, 3);
  assert.equal(generated.roadmap.events.length, 3);
  assert.equal(generated.roadmap.lines.filter((line) => line.eventIds.includes("joint")).length, 3);
  const bad = [];
  let value = structuredClone(source); value.lines[0].eventIds.push("missing"); bad.push(value);
  value = structuredClone(source); value.events.push(value.events[0]); bad.push(value);
  value = structuredClone(source); value.lines[2].originId = "missing"; bad.push(value);
  value = structuredClone(source); value.events[2].order = 0; bad.push(value);
  value = structuredClone(source); value.events.push({ ...value.events[0], id: "orphan" }); bad.push(value);
  value = { summary: "无来源支线", lines: [{ ...source.lines[0], eventIds: [] }, { ...source.lines[2], eventIds: ["one"], originId: "one" }, { ...source.lines[2], id: "circle", eventIds: ["one"], originId: "one" }], events: [source.events[0]] }; bad.push(value);
  for (const invalid of bad) assert.throws(() => parseGeneratedPlot(JSON.stringify(invalid)));
  const modelClaimsDone = structuredClone(source); modelClaimsDone.events[0].status = "done";
  assert.equal(parseGeneratedPlot(JSON.stringify(modelClaimsDone)).roadmap.events[0].status, "planned");
  assert.ok(roadmapSchema.safeParse({ lines: [], events: [] }).success);
});

test("chapter guidance distinguishes selected events from future plans and reports removed bindings", () => {
  const w = createBookWorkspace(book); w.plot.roadmap = parseGeneratedPlot(JSON.stringify(source)).roadmap;
  assert.deepEqual(chapterPlan(w).ids, ["one"]);
  assert.equal(chapterMatches("第 1 章至第 3 章", 2), true);
  assert.equal(chapterMatches("第一卷", 1), false);
  w.chapters[0].plotEventIds = ["two"];
  const plan = chapterPlan(w);
  assert.equal(plan.manual, true); assert.equal(plan.events[0].title, "查到账本");
  const context = buildStoryContext(book, w, "chapters");
  const targets = context.split("【本章推进目标")[1].split("【故事线关系】")[0];
  assert.ok(targets.includes("查到账本")); assert.ok(!targets.includes("拍卖会交汇"));
  assert.ok(context.includes("未完成事件不能当作已发生"));
  w.chapters[0].plotEventIds = ["removed"];
  assert.deepEqual(chapterPlan(w).missing, ["removed"]);
  w.chapters[0].plotEventIds = [];
  assert.deepEqual(chapterPlan(w).ids, [], "explicitly choosing no events does not silently enable auto-selection");
});
