import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProposalTransaction, captureBaseFields, checkRoadmapOps, describeOpDiff, makeRoadmapProposal, makeTextProposal,
  normalizeProposals, readTarget, setThreadDraft, normalizeThreads,
} from "../lib/co-creation.ts";

const roadmap = {
  lines: [
    { id: "main-a", title: "追查失踪", goal: "查清妹妹下落", kind: "main", color: "#8b372f", eventIds: ["e1", "e2"] },
    { id: "main-b", title: "交易所", goal: "揭露交易链", kind: "main", color: "#346783", eventIds: ["e2"] },
  ],
  events: [
    { id: "e1", title: "妹妹失踪", note: "发现残片", order: 1, chapter: "1-3", status: "planned" },
    { id: "e2", title: "潜入交易所", note: "以记忆为抵押", order: 2, chapter: "4-8", status: "planned" },
  ],
};

function workspace(overrides = {}) {
  return {
    idea: "妹妹失踪后，林晚发现记忆被买走。",
    tags: ["悬疑"],
    assets: { world: "记忆可以交易", characters: "林晚：律所助理" },
    chapters: [
      { id: "c1", title: "第 1 章", content: "林晚站在雨中。", updatedAt: "", plotEventIds: ["e1"] },
      { id: "c2", title: "第 2 章", content: "", updatedAt: "", plotEventIds: [] },
    ],
    activeChapterId: "c1",
    plot: { roadmap, version: 4, summary: "用记忆换回妹妹" },
    references: [],
    versions: [],
    assetVersions: {},
    coProposals: [],
    threads: {},
    locks: {},
    ...overrides,
  };
}

function eventProposal(ops, extra = {}) {
  return makeRoadmapProposal({
    bookId: "bk", target: { moduleId: "event", entityId: "e1" }, targetLabel: "剧情事件 / 妹妹失踪",
    ops, baseRevision: 4, baseFields: captureBaseFields(roadmap, ops), threadKey: "event::e1", id: "road-1", now: "2026-09-11T00:00:00.000Z",
    ...extra,
  });
}

test("a roadmap adoption lands as one transaction and refuses to run twice", () => {
  const ops = [{ op: "updateEvent", eventId: "e1", fields: { note: "作者确认：代价是忘记妹妹的生日" } }];
  const state = workspace({ coProposals: [eventProposal(ops)] });
  const first = applyProposalTransaction({ bookId: "bk", workspace: state, proposalId: "road-1", snapshot: (w) => ({ ...w, versions: [{ id: "v", label: "snap", createdAt: "", idea: "" }] }) });
  assert.ok(!("error" in first));
  const next = first.workspace;
  assert.equal(next.plot.roadmap.events.find((event) => event.id === "e1").note, "作者确认：代价是忘记妹妹的生日");
  assert.equal(next.plot.roadmap.events.find((event) => event.id === "e2").note, "以记忆为抵押", "untouched events stay as they were");
  assert.equal(next.plot.version, state.plot.version + 1, "one revision for one adoption");
  assert.equal(next.versions.length, 1, "one snapshot for one adoption");
  assert.equal(next.coProposals[0].status, "adopted", "content and candidate status move together");
  assert.match(next.threads["event::e1"].messages.at(-1).text, /采纳 1 项剧情修改/);

  const second = applyProposalTransaction({ bookId: "bk", workspace: next, proposalId: "road-1" });
  assert.match(second.error, /已经处理过/);
});

test("nothing is written when the target, the book or the content no longer matches", () => {
  const ops = [{ op: "updateEvent", eventId: "e1", fields: { note: "新说明" } }];
  const missingTarget = workspace({ coProposals: [eventProposal([{ op: "updateEvent", eventId: "gone", fields: { note: "x" } }])] });
  const targetResult = applyProposalTransaction({ bookId: "bk", workspace: missingTarget, proposalId: "road-1" });
  assert.match(targetResult.error, /已不存在/);
  assert.equal(missingTarget.coProposals[0].status, "pending");

  const otherBook = workspace({ coProposals: [eventProposal(ops)] });
  assert.match(applyProposalTransaction({ bookId: "another", workspace: otherBook, proposalId: "road-1" }).error, /其他书籍/);

  const unknownId = workspace({ coProposals: [eventProposal(ops)] });
  assert.match(applyProposalTransaction({ bookId: "bk", workspace: unknownId, proposalId: "nope" }).error, /找不到/);

  // Someone edited the exact field the candidate wants to change.
  const drifted = workspace({ coProposals: [eventProposal(ops)] });
  drifted.plot = { ...drifted.plot, roadmap: { ...roadmap, events: roadmap.events.map((event) => event.id === "e1" ? { ...event, note: "作者自己改过了" } : event) } };
  const driftResult = applyProposalTransaction({ bookId: "bk", workspace: drifted, proposalId: "road-1" });
  assert.match(driftResult.error, /已被修改（note）/);
  assert.equal(drifted.coProposals[0].status, "pending", "a refused adoption never marks the candidate adopted");

  // An unrelated event changing must not invalidate the candidate.
  const unrelated = workspace({ coProposals: [eventProposal(ops)] });
  unrelated.plot = { ...unrelated.plot, roadmap: { ...roadmap, events: roadmap.events.map((event) => event.id === "e2" ? { ...event, note: "别的线改了" } : event) } };
  const unrelatedResult = applyProposalTransaction({ bookId: "bk", workspace: unrelated, proposalId: "road-1" });
  assert.ok(!("error" in unrelatedResult), "only the fields the candidate touches are compared");
});

test("a candidate cannot smuggle changes outside its target or into locked objects", () => {
  const smuggled = [{ op: "updateEvent", eventId: "e1", fields: { note: "ok" } }, { op: "updateEvent", eventId: "e2", fields: { note: "越权" } }];
  const state = workspace({ coProposals: [eventProposal(smuggled)] });
  const result = applyProposalTransaction({ bookId: "bk", workspace: state, proposalId: "road-1" });
  assert.match(result.error, /只能修改「妹妹失踪」范围/);
  assert.equal(state.plot.roadmap.events.find((event) => event.id === "e1").note, "发现残片", "no partial application");

  const lockedState = workspace({ locks: { "event::e1": ["full"] }, coProposals: [eventProposal([{ op: "updateEvent", eventId: "e1", fields: { note: "x" } }])] });
  assert.match(applyProposalTransaction({ bookId: "bk", workspace: lockedState, proposalId: "road-1" }).error, /已锁定/);

  // Scope is checked before the lock: an event candidate may not touch another line.
  const lockedLineState = workspace({ locks: { "line::main-b": ["full"] }, coProposals: [eventProposal([{ op: "linkEvent", lineId: "main-b", eventId: "e1" }])] });
  assert.match(applyProposalTransaction({ bookId: "bk", workspace: lockedLineState, proposalId: "road-1" }).error, /只能修改/);
  // A whole-roadmap candidate that touches a locked line is refused by the lock.
  const lineProposal = makeRoadmapProposal({ bookId: "bk", target: { moduleId: "roadmap" }, targetLabel: "世界线", ops: [{ op: "linkEvent", lineId: "main-b", eventId: "e1" }], baseRevision: 4, threadKey: "roadmap", id: "road-line" });
  const lockedForReal = workspace({ locks: { "line::main-b": ["full"] }, coProposals: [lineProposal] });
  assert.match(applyProposalTransaction({ bookId: "bk", workspace: lockedForReal, proposalId: "road-line" }).error, /已锁定/);

  // A whole-roadmap candidate is still blocked by a lock on the object it touches.
  const roadmapProposal = makeRoadmapProposal({ bookId: "bk", target: { moduleId: "roadmap" }, targetLabel: "世界线", ops: [{ op: "updateEvent", eventId: "e2", fields: { note: "整图候选" } }], baseRevision: 4, baseFields: captureBaseFields(roadmap, [{ op: "updateEvent", eventId: "e2", fields: { note: "整图候选" } }]), threadKey: "roadmap", id: "road-2" });
  const roadmapLocked = workspace({ locks: { "event::e2": ["full"] }, coProposals: [roadmapProposal] });
  assert.match(applyProposalTransaction({ bookId: "bk", workspace: roadmapLocked, proposalId: "road-2" }).error, /已锁定/);
  // ...and allowed once unlocked, because a whole-roadmap candidate may touch anything.
  const roadmapUnlocked = workspace({ coProposals: [roadmapProposal] });
  assert.ok(!("error" in applyProposalTransaction({ bookId: "bk", workspace: roadmapUnlocked, proposalId: "road-2" })));
});

test("progress changes need a separate confirmation and partial adoption is possible", () => {
  const ops = [
    { op: "updateEvent", eventId: "e1", fields: { note: "改了说明" } },
    { op: "updateEvent", eventId: "e1", fields: { status: "done" } },
  ];
  const state = workspace({ coProposals: [eventProposal(ops)] });
  const blocked = applyProposalTransaction({ bookId: "bk", workspace: state, proposalId: "road-1" });
  assert.equal(blocked.needsConfirmation, "progress");
  assert.match(blocked.error, /写作进度变化/);
  assert.equal(state.coProposals[0].status, "pending");

  const confirmed = applyProposalTransaction({ bookId: "bk", workspace: state, proposalId: "road-1", confirmProgress: true });
  assert.ok(!("error" in confirmed));
  assert.equal(confirmed.workspace.plot.roadmap.events.find((event) => event.id === "e1").status, "done");

  // Adopting only the first op leaves the progress untouched.
  const partial = applyProposalTransaction({ bookId: "bk", workspace: state, proposalId: "road-1", acceptedOpIndexes: [0] });
  assert.ok(!("error" in partial));
  assert.equal(partial.workspace.plot.roadmap.events.find((event) => event.id === "e1").note, "改了说明");
  assert.equal(partial.workspace.plot.roadmap.events.find((event) => event.id === "e1").status, "planned", "the unselected progress change is not applied");
  assert.equal(partial.workspace.coProposals[0].status, "adopted");
});

test("adding an event and linking it is one dependency group, validated together", () => {
  const ops = [
    { op: "addEvent", event: { id: "e3", title: "真相", note: "两线交汇", chapter: "9-12", order: 3, status: "planned" }, lineIds: ["main-a", "main-b"] },
    { op: "linkEvent", lineId: "main-b", eventId: "e3" },
  ];
  const proposal = makeRoadmapProposal({ bookId: "bk", target: { moduleId: "roadmap" }, targetLabel: "世界线", ops, baseRevision: 4, threadKey: "roadmap", id: "road-3" });
  const state = workspace({ coProposals: [proposal] });
  const result = applyProposalTransaction({ bookId: "bk", workspace: state, proposalId: "road-3" });
  assert.ok(!("error" in result));
  const next = result.workspace.plot.roadmap;
  assert.equal(next.events.length, 3);
  assert.deepEqual(next.lines.map((line) => line.eventIds), [["e1", "e2", "e3"], ["e2", "e3"]], "the new event is linked to both lines");

  // A group whose linkage points at an id that only exists after an addEvent the
  // author did not select must fail as a group, never half-apply.
  const dangling = makeRoadmapProposal({ bookId: "bk", target: { moduleId: "roadmap" }, targetLabel: "世界线", ops, baseRevision: 4, threadKey: "roadmap", id: "road-4" });
  const danglingState = workspace({ coProposals: [dangling] });
  const danglingResult = applyProposalTransaction({ bookId: "bk", workspace: danglingState, proposalId: "road-4", acceptedOpIndexes: [1] });
  assert.match(danglingResult.error, /已不存在/);
  assert.equal(danglingState.plot.roadmap.events.length, 2);
});

test("text adoption writes content, version record, candidate status and note in one workspace", () => {
  const state = workspace({
    coProposals: [makeTextProposal({
      bookId: "bk", target: { moduleId: "chapters", entityId: "c1" }, targetLabel: "章节正文 / 第 1 章",
      content: "林晚站在雨中。", after: "林晚站在雨里，风把伞骨掀翻。", scope: "full", baseRevision: 4, threadKey: "chapters::c1", id: "text-1",
    })],
  });
  const result = applyProposalTransaction({ bookId: "bk", workspace: state, proposalId: "text-1" });
  assert.ok(!("error" in result));
  const next = result.workspace;
  assert.equal(next.chapters[0].content, "林晚站在雨里，风把伞骨掀翻。");
  assert.equal(next.chapters[1].content, "", "another chapter is untouched");
  assert.match(next.assetVersions["chapter:c1"][0].label, /采纳 AI 候选稿/);
  assert.equal(next.assetVersions["chapter:c1"][0].content, "林晚站在雨中。");
  assert.equal(next.coProposals[0].status, "adopted");
  assert.equal(readTarget(next, { moduleId: "chapters", entityId: "c1" }).content, "林晚站在雨里，风把伞骨掀翻。");

  // Locked chapter: refused, candidate untouched.
  const locked = workspace({ locks: { "chapters::c1": ["full"] }, coProposals: state.coProposals });
  assert.match(applyProposalTransaction({ bookId: "bk", workspace: locked, proposalId: "text-1" }).error, /已锁定/);

  // Target deleted meanwhile: refused with a clear reason.
  const deleted = workspace({ coProposals: state.coProposals });
  deleted.chapters = [deleted.chapters[1]];
  assert.match(applyProposalTransaction({ bookId: "bk", workspace: deleted, proposalId: "text-1" }).error, /目标已不存在/);
});

test("before/after diffs are concrete and drafts survive switching targets", () => {
  const op = { op: "updateEvent", eventId: "e1", fields: { note: "新的说明", chapter: "1-5" } };
  const diffs = describeOpDiff(op, roadmap, captureBaseFields(roadmap, [op]));
  assert.deepEqual(diffs.map((diff) => [diff.label, diff.before, diff.after]), [
    ["说明", "发现残片", "新的说明"],
    ["章节", "1-3", "1-5"],
  ]);
  const progressDiff = describeOpDiff({ op: "updateEvent", eventId: "e1", fields: { status: "done" } }, roadmap, captureBaseFields(roadmap, [{ op: "updateEvent", eventId: "e1", fields: { status: "done" } }]));
  assert.deepEqual(progressDiff.map((diff) => [diff.before, diff.after, diff.progress]), [["待写", "已写完", true]]);

  let threads = setThreadDraft({}, { moduleId: "chapters", entityId: "c1" }, "写到雨夜那场");
  threads = setThreadDraft(threads, { moduleId: "chapters", entityId: "c2" }, "另一章的草稿");
  assert.equal(threads["chapters::c1"].draft, "写到雨夜那场", "each target keeps its own unsent input");
  assert.equal(threads["chapters::c2"].draft, "另一章的草稿");
  const normalized = normalizeThreads(JSON.parse(JSON.stringify(threads)));
  assert.equal(normalized["chapters::c1"].draft, "写到雨夜那场");
});

test("proposal metadata round trips through normalization", () => {
  const proposal = eventProposal([{ op: "updateEvent", eventId: "e1", fields: { note: "x" } }], { progressEventIds: ["e1"], revisedFrom: "prev-proposal" });
  const restored = normalizeProposals(JSON.parse(JSON.stringify([proposal])));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].revisedFrom, "prev-proposal");
  assert.deepEqual(restored[0].progressEventIds, ["e1"]);
  assert.deepEqual(restored[0].baseFields, [{ kind: "event", id: "e1", fields: { note: "发现残片" } }]);
});

test("ops checking reports every blocking reason before anything is written", () => {
  assert.deepEqual(checkRoadmapOps([{ op: "updateEvent", eventId: "e1", fields: { note: "x" } }], { target: { moduleId: "event", entityId: "e1" }, roadmap }).ok, true);
  const missing = checkRoadmapOps([{ op: "updateEvent", eventId: "ghost", fields: { note: "x" } }], { target: { moduleId: "roadmap" }, roadmap });
  assert.match(missing.error, /已不存在/);
  const empty = checkRoadmapOps([], { target: { moduleId: "roadmap" }, roadmap });
  assert.match(empty.error, /没有选中/);
});
