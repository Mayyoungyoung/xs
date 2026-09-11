import test from "node:test";
import assert from "node:assert/strict";
import {
  ADOPT_MODE_LABELS, anchorFromRange, anchorValid, adoptTextProposal, appendThreadMessage, applyRoadmapOps,
  availableAdoptModes, buildCoContext, clearThread, contentHash, isLocked, makeTextProposal, normalizeProposals,
  normalizeThreads, parseRoadmapOps, pendingProposalsFor, resolveAnchor, targetKey, toggleLock,
} from "../lib/co-creation.ts";

const roadmap = {
  lines: [
    { id: "main-a", title: "追查失踪", goal: "查清妹妹下落", kind: "main", color: "#8b372f", eventIds: ["e1", "e2"] },
    { id: "branch-a", title: "舊照片", goal: "解释照片来源", kind: "branch", color: "#346783", originId: "e1", eventIds: ["e1", "e2"] },
  ],
  events: [
    { id: "e1", title: "妹妹失踪", note: "发现残片", order: 1, chapter: "1-3", status: "planned" },
    { id: "e2", title: "潜入交易所", note: "以记忆为抵押", order: 2, chapter: "4-8", status: "planned" },
  ],
};

const workspace = {
  idea: "妹妹失踪后，林晚发现记忆被买走。", tags: ["悬疑"], assets: { world: "记忆可以交易", characters: "林晚：律所助理", style: "", outline: "" },
  chapters: [
    { id: "c1", title: "第 1 章", content: "林晚站在雨中。", plotEventIds: ["e1"] },
    { id: "c2", title: "第 2 章", content: "", plotEventIds: [] },
  ],
  activeChapterId: "c2",
  references: [{ id: "r1", title: "参考", kind: "小说", summary: "摘要", scope: "plot" }],
  plot: { roadmap, summary: "用记忆换回妹妹" },
};

function proposal(overrides = {}) {
  const content = "林晚站在雨中。";
  return makeTextProposal({ bookId: "bk", target: { moduleId: "chapters", entityId: "c1" }, targetLabel: "章节正文 / 第 1 章", content, after: "林晚站在雨里，风把伞骨掀翻。", scope: "full", baseRevision: 0, threadKey: "chapters::c1", now: "2026-09-11T00:00:00.000Z", id: "p1", ...overrides });
}

test("anchors resolve without guessing: exact, unique-by-context, ambiguous or missing", () => {
  const content = "第一段。第二段。第三段。";
  const anchor = anchorFromRange(content, 4, 7);
  assert.deepEqual([anchor.start, anchor.end, anchor.text], [4, 7, "第二段"]);
  assert.equal(anchorValid(content, anchor), true);
  assert.equal(resolveAnchor(content, anchor).status, "exact");
  assert.equal(anchorValid(content.replace("第二段", "改动段"), anchor), false);
  assert.equal(anchorFromRange(content, 8, 5), null);
  assert.equal(anchorFromRange(content, -1, 2), null);
  assert.equal(anchorFromRange(content, 1.5, 3), null);
  assert.equal(anchorFromRange(content, 3, 3), null);

  // Text inserted before the selection: the same content moves, context still
  // identifies a single occurrence, and it is reported as moved (not silently used).
  const moved = `前言。${content}`;
  const movedResolution = resolveAnchor(moved, anchor);
  assert.equal(movedResolution.status, "unique");
  assert.equal(movedResolution.anchor.start, 7);

  // Two identical lines: the stored context must pick the right one; without a
  // discriminating context the answer is "ambiguous", never the first match.
  const dialogue = "他说：走吧。\n她说：不。\n他说：走吧。\n";
  const second = dialogue.lastIndexOf("走吧");
  const secondAnchor = anchorFromRange(dialogue, second, second + 2);
  assert.equal(anchorValid(dialogue, secondAnchor), true);
  const movedDialogue = `（新增开场。）\n${dialogue}`;
  const dialogueResolution = resolveAnchor(movedDialogue, secondAnchor);
  assert.equal(dialogueResolution.status, "unique");
  assert.equal(dialogueResolution.anchor.start, second + 8, "the context keeps the second line, not the first");

  // An anchor whose text appears twice and whose stored context matches neither:
  // reported as ambiguous, never resolved to the first occurrence.
  const ambiguousAnchor = { start: 1, end: 3, text: "走吧", prefix: "之前。", suffix: "之后。" };
  const ambiguous = resolveAnchor("走吧。走吧。", ambiguousAnchor);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.count, 2);
  assert.equal(resolveAnchor("完全不同的正文", anchor).status, "missing");
  assert.equal(contentHash("abc"), contentHash("abc"));
  assert.notEqual(contentHash("abc"), contentHash("abd"));
});

test("adoption modes apply, dedupe repeats, and refuse to overwrite edited content", () => {
  const full = proposal();
  assert.deepEqual(adoptTextProposal("林晚站在雨中。", full, "replace-all"), { content: "林晚站在雨里，风把伞骨掀翻。", changed: true });
  assert.match(adoptTextProposal("作者改过的新正文", full, "replace-all").error, /已被修改/);
  assert.deepEqual(adoptTextProposal("林晚站在雨中。", full, "append"), { content: "林晚站在雨中。\n\n林晚站在雨里，风把伞骨掀翻。", changed: true });
  assert.deepEqual(adoptTextProposal("林晚站在雨中。\n\n林晚站在雨里，风把伞骨掀翻。", full, "append"), { content: "林晚站在雨中。\n\n林晚站在雨里，风把伞骨掀翻。", changed: false });

  const content = "开头。中间需要润色。结尾。";
  const selectionProposal = makeTextProposal({ bookId: "bk", target: { moduleId: "chapters", entityId: "c1" }, targetLabel: "章节正文", content, after: "中间已被润色。", scope: "selection", anchor: anchorFromRange(content, 3, 10), baseRevision: 1, threadKey: "k", id: "p2" });
  assert.deepEqual(availableAdoptModes(selectionProposal), ["replace-selection", "insert-before", "insert-after", "replace-all", "append"]);
  assert.deepEqual(adoptTextProposal(content, selectionProposal, "replace-selection"), { content: "开头。中间已被润色。结尾。", changed: true });
  assert.deepEqual(adoptTextProposal(content, selectionProposal, "insert-after"), { content: "开头。中间需要润色。\n\n中间已被润色。结尾。", changed: true });
  assert.deepEqual(adoptTextProposal(content, selectionProposal, "insert-before"), { content: "开头。中间已被润色。\n\n中间需要润色。结尾。", changed: true });
  const edited = content.replace("中间需要润色", "中间已被作者重写");
  assert.match(adoptTextProposal(edited, selectionProposal, "replace-selection").error, /找不到原来的选中内容/);
  // Same content moved elsewhere: refused unless the author confirms the new place.
  const shifted = `前言。${content}`;
  assert.match(adoptTextProposal(shifted, selectionProposal, "replace-selection").error, /位置已变化/);
  assert.deepEqual(adoptTextProposal(shifted, selectionProposal, "replace-selection", { allowRelocated: true }), { content: `前言。开头。中间已被润色。结尾。`, changed: true });
  // Two identical lines and no context match: always refused, never the first one.
  const repeated = makeTextProposal({ bookId: "bk", target: { moduleId: "chapters", entityId: "c1" }, targetLabel: "章节正文", content: "走吧。走吧。", after: "离开。", scope: "selection", anchor: { start: 5, end: 7, text: "走吧", prefix: "之前。", suffix: "之后。" }, baseRevision: 1, threadKey: "k", id: "p-repeat" });
  assert.match(adoptTextProposal("走吧。走吧。", repeated, "replace-selection").error, /2 处相同内容/);
  assert.match(adoptTextProposal(content, { ...selectionProposal, status: "adopted" }, "replace-selection").error, /已经处理过/);
  assert.equal(ADOPT_MODE_LABELS["replace-selection"], "替换选中内容");
});

test("pending proposals stay scoped to their own target", () => {
  const chapterProposal = proposal({ id: "p3" });
  const other = proposal({ id: "p4", target: { moduleId: "chapters", entityId: "c2" } });
  const list = [chapterProposal, other];
  assert.deepEqual(pendingProposalsFor(list, { moduleId: "chapters", entityId: "c1" }).map((item) => item.id), ["p3"]);
  assert.deepEqual(pendingProposalsFor(list, { moduleId: "world" }), []);
  assert.equal(targetKey({ moduleId: "event", entityId: "e1" }), "event::e1");
});

test("author can adopt a single event field change and nothing else moves", () => {
  const parsed = parseRoadmapOps(JSON.stringify({ ops: [{ op: "updateEvent", eventId: "e2", fields: { note: "代价是忘记妹妹的生日", order: 2 } }] }), roadmap);
  assert.ok(!("error" in parsed));
  const result = applyRoadmapOps(roadmap, parsed.ops);
  assert.ok(!("error" in result));
  const updated = result.roadmap.events.find((event) => event.id === "e2");
  assert.equal(updated.note, "代价是忘记妹妹的生日");
  assert.equal(updated.title, "潜入交易所");
  assert.deepEqual(result.roadmap.events.map((event) => event.id), ["e1", "e2"]);
  assert.deepEqual(result.roadmap.lines, roadmap.lines);
  assert.equal(roadmap.events[1].note, "以记忆为抵押", "the original roadmap object is never mutated");
});

test("unknown ids, missing fields and non-JSON output keep the original roadmap", () => {
  assert.match(parseRoadmapOps("不是JSON", roadmap).error, /可解析/);
  assert.match(parseRoadmapOps(JSON.stringify({ ops: [{ op: "updateEvent", eventId: "missing", fields: { title: "x" } }] }), roadmap).error, /不存在的事件/);
  assert.match(parseRoadmapOps(JSON.stringify({ ops: [{ op: "updateEvent", eventId: "e1", fields: { id: "hacked", status: "done-ish" } }] }), roadmap).error, /可用的字段/);
  assert.match(parseRoadmapOps(JSON.stringify({ ops: [{ op: "addEvent", event: { title: "新事件" }, lineIds: ["ghost"] }] }), roadmap).error, /不存在的故事线/);
  assert.deepEqual(parseRoadmapOps(JSON.stringify({ ops: [] }), roadmap).ops, [], "an empty op list is a valid 'no change needed' answer");
  assert.match(parseRoadmapOps(JSON.stringify({ ops: "nope" }), roadmap).error, /结构不正确/);
  assert.deepEqual(applyRoadmapOps(roadmap, []), { error: "没有可采纳的修改。" });
  const filtered = parseRoadmapOps(JSON.stringify({ ops: [{ op: "updateEvent", eventId: "e1", fields: { title: "改名", id: "hacked", status: "done" } }] }), roadmap);
  assert.deepEqual(filtered.ops, [{ op: "updateEvent", eventId: "e1", fields: { title: "改名", status: "done" } }], "ids and unknown fields are dropped, allowed fields stay");
  assert.deepEqual(filtered.progressEventIds, ["e1"], "a status change is reported so the author can confirm it separately");
  assert.ok(filtered.warnings.some((warning) => warning.includes("不支持的字段")));
});

test("new events must arrive with their storyline so no dangling reference remains", () => {
  const ops = parseRoadmapOps(JSON.stringify({ ops: [{ op: "addEvent", event: { id: "e3", title: "真相", note: "两线交汇", order: 3, chapter: "9-12" }, lineIds: ["main-a", "branch-a"] }] }), roadmap).ops;
  const result = applyRoadmapOps(roadmap, ops);
  assert.ok(!("error" in result));
  assert.deepEqual(result.roadmap.lines.map((line) => line.eventIds), [["e1", "e2", "e3"], ["e1", "e2", "e3"]]);
  assert.equal(result.roadmap.events.length, 3);
  const failed = applyRoadmapOps(roadmap, [{ op: "addEvent", event: { id: "e9", title: "悬空", note: "", chapter: "待安排", order: 9, status: "planned" }, lineIds: ["ghost"] }]);
  assert.match(failed.error, /故事线已不存在/);
});

test("linking an existing event keeps one shared event id across lines", () => {
  const base = { lines: roadmap.lines.map((line) => ({ ...line, eventIds: [...line.eventIds] })), events: roadmap.events.map((event) => ({ ...event })) };
  const collapsed = { lines: base.lines.map((line) => line.id === "branch-a" ? { ...line, eventIds: ["e1"] } : line), events: base.events };
  const result = applyRoadmapOps(collapsed, [{ op: "linkEvent", lineId: "branch-a", eventId: "e2" }]);
  assert.ok(!("error" in result));
  assert.deepEqual(result.roadmap.lines[0].eventIds, ["e1", "e2"]);
  assert.deepEqual(result.roadmap.lines[1].eventIds, ["e1", "e2"]);
  assert.equal(result.roadmap.events.length, 2, "linking never duplicates the event");
});

test("a transaction that would break the roadmap schema changes nothing", () => {
  const result = applyRoadmapOps(roadmap, [
    { op: "updateEvent", eventId: "e1", fields: { title: "改名" } },
    { op: "linkEvent", lineId: "gone", eventId: "e2" },
  ]);
  assert.match(result.error, /故事线已不存在/);
  assert.equal(roadmap.events[0].title, "妹妹失踪");
});

test("threads are separated per target and never lose the global conversation", () => {
  let threads = {};
  threads = appendThreadMessage(threads, { moduleId: "characters", entityId: "e1" }, { role: "user", text: "反派动机", at: "t1" });
  threads = appendThreadMessage(threads, { moduleId: "characters", entityId: "e1" }, { role: "ai", text: "建议…", at: "t2" });
  threads = appendThreadMessage(threads, { moduleId: "world" }, { role: "user", text: "规则问题", at: "t3" });
  assert.equal(threads["characters::e1"].messages.length, 2);
  assert.equal(threads.world.messages.length, 1);
  assert.equal(Object.keys(threads).length, 2);
  threads = clearThread(threads, { moduleId: "world" });
  assert.deepEqual(Object.keys(threads), ["characters::e1"]);
  const normalized = normalizeThreads({ "world::": { messages: [{ role: "user", text: "ok", at: "" }, { role: "system", text: "drop" }, null] } });
  assert.equal(Object.keys(normalized).length, 1);
  assert.equal(normalized["world::"].messages.length, 1);
  assert.deepEqual(normalizeThreads(null), {});
});

test("locks protect a target until the author unlocks it", () => {
  let locks = toggleLock(undefined, { moduleId: "event", entityId: "e1" });
  assert.equal(isLocked(locks, { moduleId: "event", entityId: "e1" }), true);
  assert.equal(isLocked(locks, { moduleId: "event", entityId: "e2" }), false);
  locks = toggleLock(locks, { moduleId: "event", entityId: "e1" });
  assert.equal(isLocked(locks, { moduleId: "event", entityId: "e1" }), false);
  assert.deepEqual(locks, {});
});

test("normalizing proposals drops unusable entries and keeps the newest", () => {
  const kept = normalizeProposals([
    null, { id: "x" },
    { id: "ok", bookId: "bk", kind: "text", target: { moduleId: "world" }, before: "a", after: "b", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "wrong-kind", bookId: "bk", kind: "roadmap-ops", target: { moduleId: "world" }, before: "", after: "b" },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, "ok");
  assert.equal(kept[0].scope, "full");
  assert.equal(kept[0].baseHash, contentHash("a"));
  const many = normalizeProposals(Array.from({ length: 80 }, (_, index) => ({ id: `p${index}`, bookId: "bk", kind: "text", target: { moduleId: "world" }, before: "", after: `v${index}`, createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z` })));
  assert.equal(many.length, 60);
  assert.equal(many.at(-1).id, "p79");
});

test("the context panel lists what the model actually receives and respects locks", () => {
  const context = buildCoContext(workspace, { moduleId: "chapters", entityId: "c1" }, { key: "chapters::c1", moduleId: "chapters", entityId: "c1", messages: [{ role: "user", text: "写得更冷一些", at: "t" }], updatedAt: "t" }, { "chapters::c1": ["full"] });
  assert.equal(context.targetLabel, "章节正文 / 第 1 章");
  assert.deepEqual(context.locked, ["full"]);
  const labels = context.sections.map((section) => section.label);
  assert.deepEqual(labels, ["当前目标", "作者锁定", "当前内容", "作者选中内容", "相关设定", "剧情事件", "相关前文", "讨论摘要", "待采纳候选", "借鉴资料"]);
  assert.equal(context.sections.find((section) => section.label === "作者锁定").included, true);
  assert.match(context.sections.find((section) => section.label === "相关设定").detail, /世界观/);
  assert.equal(context.sections.find((section) => section.label === "剧情事件").detail, "本章推进目标：妹妹失踪");
  assert.equal(context.sections.find((section) => section.label === "相关前文").detail, "本章是开篇，没有前文");
  assert.equal(context.sections.find((section) => section.label === "相关前文").included, false);
  assert.equal(context.sections.find((section) => section.label === "借鉴资料").included, true);
  assert.ok(context.text.includes("林晚站在雨中。"), "the assembled packet carries the current content");
  assert.ok(context.text.includes("【当前内容】"));
  assert.equal(context.references.length, 1, "only this module's references are sent");
  assert.match(context.discussionSummary, /写得更冷一些/);
  assert.equal(context.referenceScope, "plot");

  const laterChapter = buildCoContext(workspace, { moduleId: "chapters", entityId: "c2" }, undefined, undefined);
  assert.equal(laterChapter.sections.find((section) => section.label === "相关前文").detail, "第 1 章 的末尾片段");
  assert.equal(laterChapter.sections.find((section) => section.label === "相关前文").included, true);

  const eventContext = buildCoContext(workspace, { moduleId: "event", entityId: "e2" }, undefined, undefined);
  assert.equal(eventContext.targetLabel, "剧情事件 / 潜入交易所（追查失踪 / 舊照片）");
  assert.equal(eventContext.sections.find((section) => section.label === "剧情事件").detail, "潜入交易所");
  const lockedSection = eventContext.sections.find((section) => section.label === "作者锁定");
  assert.equal(lockedSection.included, false);
  assert.match(lockedSection.detail, /未锁定/);
});
