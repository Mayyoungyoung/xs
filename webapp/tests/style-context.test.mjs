import test from "node:test";
import assert from "node:assert/strict";
import { activeStyleProfile, assembleByPriority, buildContextPacket, buildCoContext } from "../lib/co-creation.ts";
import { buildStyleProfile, makeStyleSample } from "../lib/style-fidelity.ts";
import { parseBackup } from "../lib/novel-data.ts";
import { mergeBookWorkspace } from "../components/novel/book-workspace.ts";

const roadmap = {
  lines: [{ id: "main-a", title: "追查失踪", goal: "查清妹妹下落", kind: "main", color: "#8b372f", eventIds: ["e1", "e2"] }],
  events: [
    { id: "e1", title: "妹妹失踪", note: "发现残片", order: 1, chapter: "1-3", status: "planned" },
    { id: "e2", title: "潜入交易所", note: "以记忆为抵押", order: 2, chapter: "4-8", status: "planned" },
  ],
};

const DIALOGUE = "“你到底想说什么？”他把杯子放下。\n“没什么。”她低着头，“我只是不想再等了。”\n“那就不等。”他站起来，“明天我就走。”";
const NARRATION = "雨从傍晚下到深夜，屋檐的水线一直没有断过。她把窗子推开一条缝，冷气挤进来，桌上的纸被吹到墙角。她走过去捡起来，顺手把灯调暗了一格。";

const sample = ({ id, raw, title }) => makeStyleSample({
  bookId: "bk", targetId: "style", raw,
  source: { kind: "primary_excerpt", title, locator: "第 3 章", author: "余华", work: "活着", usageBasis: "permitted_excerpt" },
  now: "2026-09-12T00:00:00.000Z", id,
}).sample;

const SAMPLES = [
  sample({ id: "s1", raw: NARRATION, title: "《活着》叙述段" }),
  sample({ id: "s2", raw: DIALOGUE, title: "《活着》对话段" }),
  sample({ id: "s3", raw: `${NARRATION}${DIALOGUE}`, title: "《在细雨中呼喊》混合段" }),
];

function workspaceWith(over = {}) {
  const profile = buildStyleProfile({
    bookId: "bk", targetId: "style", scope: { author: "余华", note: "作者整体倾向" }, samples: SAMPLES,
    modelRules: [{ text: "情绪通过动作呈现，不解释心情。", evidenceIds: ["s1"] }], authorRules: "保持第三人称，不要抒情。",
  });
  return {
    idea: "妹妹失踪后，林晚发现记忆被买走。", tags: ["悬疑"],
    assets: { world: "记忆可以交易", characters: "林晚：律所助理", style: "【借鉴对象】余华（作者）\n1. 保持第三人称，不要抒情。", outline: "" },
    chapters: [
      { id: "c1", title: "第 1 章", content: "林晚站在雨中。", plotEventIds: ["e1"] },
      { id: "c2", title: "第 2 章", content: "", plotEventIds: [] },
    ],
    activeChapterId: "c2",
    references: [{ id: "r1", title: "剧情参考", kind: "小说", summary: "剧情摘要", scope: "plot" }],
    plot: { roadmap, summary: "用记忆换回妹妹" },
    assetVersions: { style: [{ id: "v1" }] },
    styleSamples: SAMPLES,
    styleProfiles: { style: profile },
    ...over,
  };
}

test("without an adopted profile the manuscript gets rules only, never excerpts", () => {
  const context = buildCoContext(workspaceWith({ styleProfiles: {}, styleSamples: [] }), { moduleId: "chapters", entityId: "c1" });
  assert.equal(context.styleContext, null);
  assert.ok(context.text.includes("【本次生效文风"), "the adopted rules still reach the chapter");
  assert.ok(!context.text.includes("真实样段"));
  assert.equal(context.styleRules?.version, 2);
});

test("an adopted profile puts matched excerpts into the chapter request only through styleContext", () => {
  const context = buildCoContext(workspaceWith(), { moduleId: "chapters", entityId: "c1" });
  assert.ok(context.styleContext, "the excerpt channel is present for a prose target");
  assert.equal(context.styleContext.profileVersion, 1);
  assert.ok(context.styleContext.sampleIds.length >= 2 && context.styleContext.sampleIds.length <= 4);
  for (const id of context.styleContext.sampleIds) assert.ok(context.text.includes(id), `excerpt ${id} is really in the packet`);
  assert.ok(context.text.includes("只提供表达参照"));
  assert.ok(context.text.includes("不得带入其中的人名、地名"));
  // The author rules appear exactly once: the excerpt channel carries them, so the
  // standalone block is not duplicated.
  assert.equal(context.text.split("保持第三人称，不要抒情。").length - 1, 1);
  assert.equal(context.text.split("【作者确认规则（最高优先，不得被样段推翻）】").length - 1, 1);
  // Raw style material is not smuggled in through the reference channel.
  assert.ok(!context.references.some((reference) => reference.kind === "local" && reference.summary.includes("屋檐")));
});

test("plot, world and style targets never receive the manuscript excerpt channel", () => {
  for (const moduleId of ["plot", "world", "characters", "overview"]) {
    const context = buildCoContext(workspaceWith(), { moduleId, entityId: undefined });
    assert.equal(context.styleContext, null, `${moduleId} must not receive excerpts`);
    assert.ok(!context.text.includes("只提供表达参照"));
  }
  const styleContext = buildCoContext(workspaceWith(), { moduleId: "style" });
  assert.equal(styleContext.styleContext, null, "the style module reads the rules as its own content, not as an excerpt block");
});

test("the same excerpts reach chapter_write, polish and local rewrite, since all share one packet", () => {
  for (const target of [{ moduleId: "chapters", entityId: "c1" }, { moduleId: "chapters", entityId: "c2" }]) {
    const context = buildCoContext(workspaceWith(), target);
    assert.ok(context.styleContext?.sampleIds.length);
  }
  // Rewrite/polish tasks send this exact packet, so the assertion is on the packet
  // text the request body uses.
  const context = buildCoContext(workspaceWith(), { moduleId: "chapters", entityId: "c1" });
  assert.ok(context.text.includes("【真实样段"));
});

test("a long context keeps the rules and reports every cut instead of a blind tail slice", () => {
  const huge = "很长的前文。".repeat(4000);
  const context = buildContextPacket({ workspace: workspaceWith({
    chapters: [
      { id: "c0", title: "第 0 章", content: huge, plotEventIds: [] },
      { id: "c1", title: "第 1 章", content: "林晚站在雨中。", plotEventIds: ["e1"] },
    ],
    activeChapterId: "c1",
  }), target: { moduleId: "chapters", entityId: "c1" }, budget: 6000 });
  assert.ok(context.text.length <= 6200, `assembled ${context.text.length}`);
  assert.ok(context.text.includes("【本次目标】") && context.text.includes("【当前内容】"), "critical blocks survive");
  assert.ok(context.text.includes("只提供表达参照") || context.text.includes("【本次生效文风"), "style material survives");
  assert.ok(context.trimming.some((line) => line.includes("省略") || line.includes("截断")), JSON.stringify(context.trimming));
  assert.ok(!context.text.includes("…（已裁剪）\n…（已裁剪）"), "no repeated blind cut marker");
});

test("priority assembly reserves critical blocks and drops low-priority ones by policy", () => {
  const trimming = [];
  const text = assembleByPriority([
    { key: "低", priority: 11, text: "L".repeat(500) },
    { key: "高", priority: 1, text: "H".repeat(500) },
    { key: "中", priority: 9, text: "M".repeat(500) },
  ], 1100, trimming);
  assert.ok(text.includes("H".repeat(500)), "the critical block is whole");
  assert.ok(!text.includes("L".repeat(500)), "the lowest priority block is dropped");
  assert.ok(text.indexOf("H") < text.indexOf("M"), "original order is restored for reading");
  assert.ok(trimming.some((line) => line.includes("「低」")));
});

test("the profile in force is explicit or unambiguous, never a silent pick", () => {
  assert.equal(activeStyleProfile({ ...workspaceWith() }).profile?.targetId, "style");
  const two = workspaceWith();
  const second = { ...two.styleProfiles.style, id: "profile-2", targetId: "ref-郭敬明-work" };
  assert.equal(activeStyleProfile({ ...two, styleProfiles: { a: second, b: two.styleProfiles.style } }).profile, null);
  assert.ok(activeStyleProfile({ ...two, styleProfiles: { a: second, b: two.styleProfiles.style } }).reason.includes("没有指定生效档案"));
  assert.equal(activeStyleProfile({ ...two, styleProfiles: { style: two.styleProfiles.style } }, "style").profile?.id, two.styleProfiles.style.id);
});

test("excerpts and profiles survive the storage schema, export and restart", () => {
  const workspace = workspaceWith();
  const book = { id: "bk", title: "测试书", genre: "悬疑", premise: "一句话", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#7f302a", glyph: "书" };
  const parsed = parseBackup({ version: 3, books: [book], workspaces: { bk: { idea: "一句话", styleSamples: workspace.styleSamples, styleProfiles: workspace.styleProfiles } } });
  assert.equal(parsed.workspaces.bk.styleSamples.length, 3, "excerpts are not dropped by the storage schema");
  assert.equal(parsed.workspaces.bk.styleSamples[0].source.usageBasis, "permitted_excerpt");
  const merged = mergeBookWorkspace(book, parsed.workspaces.bk);
  assert.equal(merged.styleSamples.length, 3);
  const profileId = workspace.styleProfiles.style.id;
  // Profiles are keyed by their own id after migration, not by the legacy "style" key.
  assert.deepEqual(merged.styleProfiles[profileId].rules.map((rule) => rule.id), workspace.styleProfiles.style.rules.map((rule) => rule.id));
  assert.equal(merged.activeStyleProfileId, profileId, "the migrated legacy profile stays active");
  assert.deepEqual(mergeBookWorkspace(book, { styleSamples: merged.styleSamples, styleProfiles: merged.styleProfiles, activeStyleProfileId: merged.activeStyleProfileId }).styleSamples, merged.styleSamples, "reload is idempotent");
  assert.equal(merged.styleProfiles[profileId].sampleIds.length, 2, "the library keeps all 3 excerpts while the profile deduplicates the mirrored one");
});
