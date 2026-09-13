import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceFidelityRun, buildEvalPlan, buildSceneSpec, buildStyleContext, buildStyleProfile, candidateLockMatches,
  cleanSampleText, dedupeSamples, isAuthorEvidence, makeStyleSample, majorDeviationCount, markDerivedStale,
  mechanicalStats, normalizeStyleProfiles, normalizeStyleSamples, overlapReport, parseStyleReview,
  partitionSamples, sceneTagsFor, selectStyleSamples, startFidelityRun, summarizeEvalObservations, textRoleFor,
  importTextAsSamples, buildSampleDigest, estimateTokens, parseProfileRules, appendProfileVersion,
  buildStyleConfigRef, resolveStyleConfigRef, normalizeProfileHistory,
} from "../lib/style-fidelity.ts";

const NARRATION = "雨从傍晚下到深夜，屋檐的水线一直没有断过。她把窗子推开一条缝，冷气挤进来，桌上的纸被吹到墙角。她走过去捡起来，顺手把灯调暗了一格。屋里只剩下钟摆的声音，一下，又一下。";
const DIALOGUE = "“你到底想说什么？”他把杯子放下。\n“没什么。”她低着头，“我只是不想再等了。”\n“那就不等。”他站起来，“明天我就走。”";
const CONFLICT = "他冲上去抓住对方的衣领，怒吼着质问账本在哪里。对方挣脱，一脚踢翻了椅子，冷笑说你拿什么威胁我。两个人在狭小的房间扭打，撞得桌上的碗摔了一地。";

const sample = ({ title = "《活着》", ...over } = {}) => makeStyleSample({
  bookId: "b1", targetId: "ref-余华-author",
  raw: NARRATION,
  source: { kind: "primary_excerpt", title, locator: "第 3 章", author: "余华", work: "活着", usageBasis: "permitted_excerpt" },
  now: "2026-09-12T00:00:00.000Z",
  ...over,
}).sample;

test("template lines are cleaned without touching narrative sentences", () => {
  const raw = ["第十二章", "上一章 下一章 返回目录", "广告", "https://spam.example/x", NARRATION].join("\n");
  const cleaned = cleanSampleText(raw);
  assert.ok(cleaned.text.includes("雨从傍晚下到深夜"), "narrative text survives");
  assert.ok(!cleaned.text.includes("返回目录") && !cleaned.text.includes("spam.example"));
  assert.ok(cleaned.removedLines >= 4);
  const withWord = cleanSampleText(`他在广告公司上班，每天改文案。${NARRATION}`);
  assert.ok(withWord.text.includes("广告公司"), "a narrative sentence containing 广告 is never removed");
});

test("mirrored excerpts collapse into one evidence and the stronger provenance wins", () => {
  const primary = sample();
  const mirror = makeStyleSample({
    bookId: "b1", targetId: "ref-余华-author", raw: `  ${NARRATION}  `, now: "2026-09-12T01:00:00.000Z",
    source: { kind: "critical_analysis", title: "某转载站", usageBasis: "unknown" },
  }).sample;
  const { kept, dropped } = dedupeSamples([mirror, primary]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source.kind, "primary_excerpt");
  assert.equal(dropped.length, 1);
  assert.ok(dropped[0].reason.includes("重叠"));
});

test("user-approved AI output is never author evidence", () => {
  assert.equal(isAuthorEvidence("user_approved_output"), false);
  assert.equal(isAuthorEvidence("primary_excerpt"), true);
  const profile = buildStyleProfile({
    bookId: "b1", targetId: "t", scope: { author: "余华" }, samples: [sample()],
    modelRules: [{ text: "句子偏短，动作先于解释。" }],
  });
  assert.equal(profile.rules.find((rule) => rule.text.includes("句子偏短"))?.origin, "model_prior");
  assert.equal(profile.uncertainties.some((line) => line.includes("少于建议")), true);
});

test("only conditioning samples feed stats, rules and selection; evaluation never leaks", () => {
  const conditioning = [sample(), sample({ raw: DIALOGUE, id: "s-dialogue" }), sample({ raw: CONFLICT, id: "s-conflict" })];
  const evaluation = sample({ raw: NARRATION.replace("雨", "雪"), id: "s-eval", split: "evaluation" });
  const samples = [...conditioning, evaluation];
  const stats = mechanicalStats(samples);
  assert.equal(stats.samples, 3, "the evaluation excerpt is excluded from statistics");
  const profile = buildStyleProfile({
    bookId: "b1", targetId: "t", scope: { author: "余华" }, samples,
    modelRules: [
      { text: "叙述紧贴动作，不解释情绪。", evidenceIds: ["s-dialogue"] },
      { text: "这条引用了评测样段。", evidenceIds: ["s-eval"] },
    ],
  });
  assert.equal(profile.rules.find((rule) => rule.text.includes("紧贴动作"))?.origin, "primary_excerpt");
  assert.deepEqual(profile.rules.find((rule) => rule.text.includes("紧贴动作"))?.evidenceIds, ["s-dialogue"]);
  const leakedRule = profile.rules.find((rule) => rule.text.includes("引用了评测样段"));
  assert.deepEqual(leakedRule.evidenceIds, [], "a citation to an evaluation excerpt is dropped");
  assert.equal(leakedRule.origin, "model_prior");
  assert.ok(profile.notes.some((note) => note.includes("评测样段")), JSON.stringify(profile.notes));
  assert.ok(profile.sampleIds.includes("s-eval"), "the excerpt is still stored, just isolated");
  assert.ok(profile.uncertainties.some((line) => line.includes("隔离保存")));

  const scene = buildSceneSpec({ chapterId: "c1", chapterTitle: "第 2 章", chapterContent: DIALOGUE, boundEvents: [{ id: "e1", title: "摊牌", note: "两人摊牌", chapter: "2", status: "planned" }], futureEvents: [] });
  const selection = selectStyleSamples(profile, scene, samples);
  assert.ok(selection.picks.every((pick) => pick.sample.split === "conditioning"));
  assert.ok(!selection.picks.some((pick) => pick.sample.id === "s-eval"));
  assert.ok(selection.notes.some((note) => note.includes("评测样段")));
});

test("sample selection is explainable: scene match wins, mismatch is rejected, budget binds", () => {
  const dialogueSample = sample({ raw: DIALOGUE, id: "s-dialogue", title: "《活着》对话段" });
  const conflictSample = sample({ raw: CONFLICT, id: "s-conflict", title: "《在细雨中呼喊》冲突段" });
  const narrationSample = sample({ id: "s-narration", title: "《许三观卖血记》叙述段" });
  const samples = [dialogueSample, conflictSample, narrationSample];
  const profile = buildStyleProfile({ bookId: "b1", targetId: "t", scope: { author: "余华" }, samples });
  const scene = buildSceneSpec({ chapterId: "c1", chapterTitle: "摊牌", chapterContent: DIALOGUE, boundEvents: [], futureEvents: [] });
  const selection = selectStyleSamples(profile, scene, samples, { maxSamples: 3, maxCharsPerSample: 1000, budgetChars: 4000 });
  assert.equal(selection.picks[0].sample.id, "s-dialogue", "the dialogue excerpt wins the dialogue scene");
  assert.ok(selection.picks[0].reasons.some((reason) => reason.includes("场景匹配")));
  assert.equal(selection.picks.length, 1, "excerpts that cannot serve the scene are rejected, not silently mixed in");
  assert.ok(selection.rejected.some((entry) => entry.sampleId === "s-conflict" && entry.reason.includes("场景不匹配")));
  assert.ok(selection.rejected.some((entry) => entry.sampleId === "s-narration"));
  assert.ok(selection.notes.some((note) => note.includes("样段条件会变弱")));

  const untagged = buildSceneSpec({ chapterId: "c1", chapterTitle: "嗯", chapterContent: "嗯。", boundEvents: [], futureEvents: [] });
  const permissive = selectStyleSamples(profile, untagged, samples, { maxSamples: 3, maxCharsPerSample: 1000, budgetChars: 4000 });
  assert.equal(permissive.rejected.length, 0, "an untaggable scene rejects nothing");
  assert.equal(permissive.picks.length, 3);

  const long = (raw, id, title) => sample({ raw: raw.repeat(4), id, title });
  const longSamples = [long(DIALOGUE, "L1", "样段甲"), long(CONFLICT, "L2", "样段乙"), long(NARRATION, "L3", "样段丙")];
  const longProfile = buildStyleProfile({ bookId: "b1", targetId: "t", scope: { author: "余华" }, samples: longSamples });
  const roomy = selectStyleSamples(longProfile, untagged, longSamples, { maxSamples: 3, maxCharsPerSample: 400, budgetChars: 4000 });
  const tight = selectStyleSamples(longProfile, untagged, longSamples, { maxSamples: 3, maxCharsPerSample: 400, budgetChars: 700 });
  assert.ok(tight.chars <= 700);
  assert.ok(tight.picks.length < roomy.picks.length, "a binding budget yields fewer samples");
  assert.ok(tight.skipped.some((entry) => entry.reason.includes("预算")));

  const single = sample({ id: "only", title: "唯一来源" });
  const singleProfile = buildStyleProfile({ bookId: "b1", targetId: "t", scope: {}, samples: [single] });
  const weak = selectStyleSamples(singleProfile, untagged, [single], { maxSamples: 3 });
  assert.equal(weak.picks.length, 1);
  assert.ok(weak.notes.some((note) => note.includes("样段条件会变弱")));
});

test("style context reserves rules and trims samples first, with accurate ids and no fake citations", () => {
  const samples = [sample({ id: "s1" }), sample({ raw: DIALOGUE, id: "s2" }), sample({ raw: CONFLICT, id: "s3" })];
  const profile = buildStyleProfile({ bookId: "b1", targetId: "t", scope: { author: "余华" }, samples, modelRules: [{ text: "短句推进，动作先于解释。", evidenceIds: ["s1"] }] });
  const scene = buildSceneSpec({ chapterId: "c1", chapterTitle: "第 2 章", chapterContent: DIALOGUE, boundEvents: [], futureEvents: [] });
  const picks = selectStyleSamples(profile, scene, samples, { maxSamples: 3 }).picks;
  const context = buildStyleContext(profile, picks, "保持第三人称，不要抒情。", 4000);
  assert.ok(context.text.includes("【作者确认规则（最高优先，不得被样段推翻）】"));
  assert.ok(context.text.includes("保持第三人称，不要抒情。"));
  assert.ok(context.text.includes("只提供表达参照"));
  assert.ok(context.text.includes("不得带入其中的人名、地名"));
  for (const id of context.sampleIds) assert.ok(context.text.includes(id), `cited sample ${id} is present`);
  assert.equal(context.sampleIds.length, picks.length);
  const tight = buildStyleContext(profile, picks, "保持第三人称。", 200);
  assert.ok(tight.chars <= 200 + 400, "rules are kept even when the budget is tiny");
  assert.ok(tight.text.includes("作者确认规则") && tight.text.includes("硬约束"));
  assert.ok(tight.trimming.some((line) => line.includes("样段超出预算")) || tight.trimming.some((line) => line.includes("请精简作者规则")));
  // no evaluation material can appear even if a caller passes it
  const withEval = [...samples, sample({ id: "s-eval", split: "evaluation", raw: CONFLICT.replace("账本", "玉佩") })];
  const evalPicks = selectStyleSamples(profile, scene, withEval, { maxSamples: 4 }).picks;
  assert.ok(evalPicks.every((pick) => pick.sample.split === "conditioning"));
});

test("overlap is a review reminder, not a legal threshold", () => {
  const shared = "他把窗子推开一条缝，冷气挤进来，桌上的纸被吹到墙角。";
  const report = overlapReport(`${shared}然后他坐下。`, [{ id: "s1", text: `开头${shared}结尾。` }]);
  assert.equal(report.level !== "distinct", true);
  assert.ok(report.longest >= 20);
  assert.ok(report.note.includes("不是法律安全阈值"));
  const common = overlapReport("他站起来，走了出去。", [{ id: "s1", text: "她坐下，什么也没说。他站起来，走了出去。" }]);
  assert.equal(common.longest >= 20, false, "a stock short sentence does not trigger a long match");
  assert.ok(!("confidence" in report));
});

test("the fidelity loop allows one revision at most and keeps the last valid candidate", () => {
  const run = startFidelityRun({ bookId: "b1", chapterId: "c1", baseRevision: 3, profileVersion: 2, enabled: true });
  const first = advanceFidelityRun(run, { status: "ok" });
  assert.equal(first.action, "style-review");
  const second = advanceFidelityRun(first.run, { status: "ok", majorDeviations: 2 });
  assert.equal(second.action, "revise");
  const third = advanceFidelityRun(second.run, { status: "ok", majorDeviations: 1 });
  assert.equal(third.action, "finish");
  assert.equal(third.run.revisions, 1, "never revises twice by default");
  assert.equal(third.run.requests, 3);
  const failed = advanceFidelityRun(first.run, { status: "failed", reason: "模型超时" });
  assert.equal(failed.action, "finish");
  assert.ok(failed.note.includes("保留最后一次有效候选"));
  assert.ok(failed.note.includes("未继续重写"));
  const disabled = startFidelityRun({ bookId: "b1", chapterId: "c1", baseRevision: 1, profileVersion: 1, enabled: false });
  const noRevise = advanceFidelityRun(advanceFidelityRun(disabled, { status: "ok" }).run, { status: "ok", majorDeviations: 3 });
  assert.equal(noRevise.action, "finish");
  assert.equal(noRevise.run.maxRevisions, 0);
});

test("a candidate is locked to its book, chapter, base revision and selection", () => {
  const lock = { bookId: "b1", chapterId: "c1", profileVersion: 2, baseRevision: 5, anchorHash: "a1" };
  assert.equal(candidateLockMatches(lock, { ...lock }).ok, true);
  assert.equal(candidateLockMatches(lock, { ...lock, bookId: "b2" }).ok, false);
  assert.equal(candidateLockMatches(lock, { ...lock, chapterId: "c2" }).ok, false);
  assert.equal(candidateLockMatches(lock, { ...lock, baseRevision: 6 }).ok, false);
  assert.equal(candidateLockMatches(lock, { ...lock, anchorHash: "a2" }).ok, false);
});

test("style review cites only real samples and is a suggestion, not proof", () => {
  const parsed = parseStyleReview(JSON.stringify({ items: [
    { location: "第 3 段", issue: "解释性句子偏多，情绪没有落在动作上。", evidenceIds: ["s1", "s-unknown"], severity: "major" },
    { location: "结尾", issue: "收束过快。", evidenceIds: [], severity: "minor" },
  ] }), ["s1"]);
  assert.equal(parsed.unparsed, false);
  assert.deepEqual(parsed.items[0].evidenceIds, ["s1"]);
  assert.equal(parsed.droppedCitations, 1);
  assert.equal(majorDeviationCount(parsed), 1);
  assert.equal(parseStyleReview("not json", ["s1"]).unparsed, true);
});

test("profile derivation is flagged stale when the author edits the written rules", () => {
  const profile = buildStyleProfile({ bookId: "b1", targetId: "t", scope: { author: "余华" }, samples: [sample()], authorRules: "保持第三人称。" });
  assert.equal(markDerivedStale(profile, "保持第三人称。").derivedStale, false);
  const stale = markDerivedStale(profile, "保持第三人称，少抒情。");
  assert.equal(stale.derivedStale, true);
  assert.equal(stale.version, profile.version, "flagging does not create a second competing version");
});

test("persistence is idempotent and never promotes a URL, metadata or fake sample", () => {
  const clean = [
    sample({ id: "s1" }),
    { id: "bad", text: "x", source: { kind: "not-a-kind", title: "t", usageBasis: "unknown" } },
    { id: "no-source", text: NARRATION, source: undefined },
  ];
  const once = normalizeStyleSamples(clean);
  assert.equal(once.length, 1);
  assert.equal(once[0].source.kind, "primary_excerpt");
  assert.deepEqual(normalizeStyleSamples(once), once, "idempotent");
  const profile = buildStyleProfile({ bookId: "b1", targetId: "t", scope: { author: "余华" }, samples: once });
  const profiles = { t: profile };
  assert.deepEqual(normalizeStyleProfiles(profiles), profiles, "profile normalization is idempotent");
  const short = makeStyleSample({ bookId: "b1", targetId: "t", raw: "太短。", source: { kind: "primary_excerpt", title: "x", usageBasis: "user_owned" } });
  assert.equal(short.sample, null);
  assert.ok(short.error?.includes("太短"));
});

test("scene helpers are explainable and marked as hints", () => {
  assert.ok(sceneTagsFor(DIALOGUE).includes("dialogue"));
  assert.equal(textRoleFor(DIALOGUE), "dialogue");
  assert.equal(textRoleFor(NARRATION), "narration");
  const spec = buildSceneSpec({
    chapterId: "c1", chapterTitle: "第 4 章", chapterContent: "", boundEvents: [],
    futureEvents: [{ id: "e9", title: "真相揭晓", chapter: "9" }], selectionText: DIALOGUE,
  });
  assert.deepEqual(spec.mustNotReveal, ["真相揭晓（9）"]);
  assert.ok(spec.notes.some((note) => note.includes("没有绑定剧情事件")));
  assert.ok(spec.pointOfView.length > 0);
});

test("the evaluation harness refuses to claim a result without human blind review", () => {
  const samples = [sample({ id: "s1" }), sample({ id: "s2", raw: DIALOGUE }), sample({ id: "s3", raw: CONFLICT, split: "calibration" })];
  const scenes = Array.from({ length: 3 }, (_, index) => ({ id: `scene-${index}`, title: `场景 ${index}`, originalScene: "雨夜车站，主角等一个不会来的人。", mustHappen: ["等待", "离开"] }));
  const plan = buildEvalPlan({ scope: "余华文笔", scenes, samples, realCallsEnabled: false });
  assert.deepEqual(plan.arms, ["A", "B", "C", "D"]);
  assert.deepEqual(plan.conditioningSampleIds, ["s1", "s2"]);
  assert.deepEqual(plan.calibrationSampleIds, ["s3"]);
  assert.equal(plan.evaluationSampleIds.length, 0);
  assert.ok(plan.notes.some((note) => note.includes("8–12")));
  assert.ok(plan.notes.some((note) => note.includes("没有独立评测样段")));
  assert.ok(plan.notes.some((note) => note.includes("未开启真实模型调用")));
  const report = summarizeEvalObservations(plan, [{ arm: "C", sceneId: "scene-0", content: "x", requests: 2, ms: 1200 }]);
  assert.equal(report.completed, false);
  assert.equal(report.perScene[0].winner, "待评价");
  assert.ok(report.notes.some((note) => note.includes("不能用自评或 mock 替代")));
  assert.ok(report.notes.some((note) => note.includes("不是绝对风格相似度")));
});

test("partitions and leak guard work on mixed splits", () => {
  const samples = [sample({ id: "a" }), sample({ id: "b", split: "calibration" }), sample({ id: "c", split: "evaluation" })];
  const parts = partitionSamples(samples);
  assert.deepEqual([parts.conditioning.length, parts.calibration.length, parts.evaluation.length], [1, 1, 1]);
  assert.deepEqual(normalizeStyleSamples(samples).map((entry) => entry.split), ["conditioning", "calibration", "evaluation"]);
  const profile = buildStyleProfile({ bookId: "b1", targetId: "t", scope: {}, samples });
  assert.equal(profile.rules.some((rule) => rule.evidenceIds.includes("c")), false);
});

test("one import action cleans, splits, tags and de-duplicates without per-segment forms", () => {
  const long = [NARRATION, DIALOGUE, CONFLICT].join("\n");
  const first = importTextAsSamples({ bookId: "b1", targetId: "t", raw: `第十二章\n上一章 下一章 返回目录\n${long}`, source: { kind: "primary_excerpt", title: "《活着》", usageBasis: "permitted_excerpt" }, now: "2026-09-12T00:00:00.000Z" });
  assert.ok(first.samples.length >= 1, "the text becomes usable excerpts");
  assert.ok(first.samples.every((entry) => entry.split === "conditioning"));
  assert.ok(first.samples.every((entry) => entry.sceneTags.length > 0 && entry.source.locator?.includes("自动切分")), "scene tags and locators are filled automatically");
  assert.ok(first.notes.some((note) => note.includes("清理")), JSON.stringify(first.notes));
  const mirrored = importTextAsSamples({ bookId: "b1", targetId: "t", raw: `\n${long}\n`, source: { kind: "critical_analysis", title: "转载站", usageBasis: "unknown" }, now: "2026-09-12T01:00:00.000Z" });
  const merged = dedupeSamples([...first.samples, ...mirrored.samples]);
  assert.ok(merged.dropped.length >= 1, "mirrors are dropped rather than counted as extra evidence");
  assert.ok(merged.kept.every((entry) => entry.source.kind === "primary_excerpt"), "the stronger provenance wins");
  const tiny = importTextAsSamples({ bookId: "b1", targetId: "t", raw: "太短。", source: { kind: "primary_excerpt", title: "x", usageBasis: "user_owned" } });
  assert.equal(tiny.samples.length, 0);
  assert.ok(tiny.notes.some((note) => note.includes("快速建议")), "a failed import points back to the quick path");
});

test("analysis digests carry real excerpts, refuse evaluation material and respect the budget", () => {
  const conditioning = [sample({ id: "a1", title: "甲" }), sample({ id: "a2", raw: DIALOGUE, title: "乙" })];
  const held = sample({ id: "ev-holdout", raw: NARRATION.replace("雨", "雪"), title: "丙", split: "evaluation" });
  const digest = buildSampleDigest([...conditioning, held], 4000);
  assert.deepEqual(digest.sampleIds, ["a1", "a2"], "only conditioning excerpts are analysed");
  assert.ok(digest.text.includes(NARRATION.slice(0, 20)), "the excerpt text itself is included, not a summary");
  assert.ok(!digest.text.includes("ev-holdout"), "evaluation material never reaches an analysis task");
  assert.ok(digest.trimming.some((line) => line.includes("非条件样段")), JSON.stringify(digest.trimming));
  const big = [sample({ id: "b1", raw: NARRATION.repeat(5), title: "甲" }), sample({ id: "b2", raw: DIALOGUE.repeat(5), title: "乙" })];
  const tight = buildSampleDigest(big, 200);
  assert.ok(tight.chars <= 320, `digest stayed near the budget: ${tight.chars}`);
  assert.deepEqual(tight.sampleIds, ["b1"], "once the budget is spent the remaining excerpts are left out, not cut mid-sentence");
  assert.ok(tight.trimming.some((line) => line.includes("分析预算")), JSON.stringify(tight.trimming));
  const tokens = estimateTokens("雨夜的车站。");
  assert.ok(tokens.estimatedTokens > 0 && tokens.chars === 6);
  assert.ok(tokens.basis.includes("估算"), "token figures are labelled as estimates");
});

test("model profile output is validated: unknown citations are dropped and unusable output is reported", () => {
  const parsed = parseProfileRules(JSON.stringify({ rules: [
    { text: "情绪落在动作上，不解释心情。", evidenceIds: ["a1", "ghost"], scene: "daily" },
    { text: "未引用的规则。", evidenceIds: [] },
  ], gaps: ["对话样段不足。"] }), ["a1"]);
  assert.equal(parsed.unparsed, false);
  assert.deepEqual(parsed.rules[0].evidenceIds, ["a1"]);
  assert.equal(parsed.dropped, 1);
  assert.equal(parsed.rules[0].scene, "daily");
  assert.deepEqual(parsed.gaps, ["对话样段不足。"]);
  assert.equal(parseProfileRules("not json", ["a1"]).unparsed, true);
  assert.equal(parseProfileRules(JSON.stringify({ nothing: true }), ["a1"]).unparsed, true);
});

test("profile versions are append-only and an old snapshot restores its own version", () => {
  const v1 = buildStyleProfile({ bookId: "b1", targetId: "style", scope: { author: "余华" }, samples: [sample({ id: "a1" })], authorRules: "保持第三人称。", now: "2026-09-12T00:00:00.000Z" });
  assert.equal(v1.version, 1);
  const refV1 = buildStyleConfigRef(v1, "保持第三人称。", [sample({ id: "a1" })]);
  assert.equal(refV1.profileVersion, 1);
  const v2 = buildStyleProfile({ bookId: "b1", targetId: "style", scope: { author: "余华" }, samples: [sample({ id: "a1" })], authorRules: "保持第三人称，少抒情。", previous: v1, now: "2026-09-12T02:00:00.000Z" });
  assert.equal(v2.version, 2);
  const history = appendProfileVersion(appendProfileVersion([], v1), v2);
  assert.deepEqual(history.map((entry) => entry.version), [2, 1], "both versions are kept");
  const restored = resolveStyleConfigRef(refV1, history, [sample({ id: "a1" })]);
  assert.equal(restored.profile?.version, 1, "restoring an old snapshot restores that version, not the latest");
  assert.equal(restored.missingSamples.length, 0);
  assert.ok(restored.note.includes("第 1 版"));
  const missing = resolveStyleConfigRef({ ...refV1, profileVersion: 99 }, history, [sample({ id: "a1" })]);
  assert.equal(missing.profile, null);
  assert.ok(missing.note.includes("未用最新版顶替"), "a missing version is never silently replaced by the newest");
  const lostEvidence = resolveStyleConfigRef(refV1, history, []);
  assert.deepEqual(lostEvidence.missingSamples, ["a1"]);
  assert.ok(lostEvidence.note.includes("历史样段已不存在"));
  const profiles = { style: v2 };
  assert.deepEqual(normalizeProfileHistory({ style: history }), { style: history }, "history normalization is idempotent");
  assert.equal(Object.keys(profiles).length, 1);
});
