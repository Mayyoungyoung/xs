import test from "node:test";
import assert from "node:assert/strict";
import { buildContextPacket } from "../lib/co-creation.ts";
import { migrateBookStyle, resolveEffectiveStyle, applyTemplate, customStyle, STYLE_OFF, toggleQuickAdjustment, hasQuickAdjustment, QUICK_ADJUSTMENTS } from "../lib/book-style.ts";
import { buildStyleProfile, makeStyleSample } from "../lib/style-fidelity.ts";
import { parseBackup } from "../lib/novel-data.ts";
import { mergeBookWorkspace } from "../components/novel/book-workspace.ts";

const NARRATION = "雨从傍晚下到深夜，屋檐的水线一直没有断过。她把窗子推开一条缝，冷气挤进来，桌上的纸被吹到墙角。她走过去捡起来，顺手把灯调暗了一格。屋里只剩下钟摆的声音，一下，又一下。";

const sample = (id, raw, author, targetId) => makeStyleSample({
  bookId: "bk", targetId, raw,
  source: { kind: "primary_excerpt", title: `${author}节选`, author, usageBasis: "permitted_excerpt" },
  now: "2026-09-16T00:00:00.000Z", id,
}).sample;

function profileFor(author, samples, extraRules = []) {
  const profile = buildStyleProfile({
    bookId: "bk", targetId: `tpl-${author}`, scope: { author, work: "", note: `tpl-${author}` }, samples,
    modelRules: [], authorRules: "",
  });
  profile.rules = [...profile.rules, ...extraRules.map((text) => ({ id: `rule-author-${text}`, text, layer: "semantic", origin: "author_written", evidenceIds: [] }))];
  return profile;
}

const workspaceBase = {
  idea: "一句话", tags: [], assets: {},
  chapters: [{ id: "c1", title: "第 1 章", content: "", plotEventIds: [] }],
  activeChapterId: "c1",
  references: [],
  plot: { lines: [], events: [] },
};

test("profileDisplayName names a template after its target", () => {
  assert.equal(resolveEffectiveStyle(undefined).mode, "off");
  assert.equal(resolveEffectiveStyle(STYLE_OFF).text, "", "off mode injects nothing");
});

test("resolveEffectiveStyle is the single source: template snapshot + book edits, and never template updates", () => {
  const jin = profileFor("金庸", [sample("j1", NARRATION, "金庸", "tpl-金庸")], ["情绪通过动作呈现。"]);
  const applied = applyTemplate(jin);
  const edited = { ...applied, rules: [{ id: "rule-book", text: "本书专属：对白不超过三句一轮。", layer: "semantic", origin: "author_written", evidenceIds: [] }] };
  const effective = resolveEffectiveStyle(edited, { [jin.id]: jin }, "保持第三人称。");
  assert.ok(effective.text.includes("本书专属：对白不超过三句一轮。"), "book edits are authoritative");
  assert.ok(effective.text.includes("保持第三人称。"), "assets.style rides as the top-priority supplement");
  assert.ok(!effective.text.includes("情绪通过动作呈现。"), "book edits replace template rules in the copy");
  // Template updates and deletions never leak into the book silently.
  const newer = { ...jin, version: 5, rules: [{ id: "rule-new", text: "模板新版规则。", layer: "semantic", origin: "model_prior", evidenceIds: [] }] };
  const effectiveAfterUpdate = resolveEffectiveStyle(edited, { [jin.id]: newer }, "");
  assert.ok(!effectiveAfterUpdate.text.includes("模板新版规则。"), "template updates do not leak in");
  assert.ok(effectiveAfterUpdate.notes.some((note) => note.includes("第 5 版")), "the update is surfaced, not hidden");
  const effectiveAfterDelete = resolveEffectiveStyle(edited, {}, "");
  assert.ok(effectiveAfterDelete.rules.length === 1, "a deleted template keeps the applied snapshot");
  assert.ok(effectiveAfterDelete.notes.some((note) => note.includes("已被删除")), "the deletion is reported");
});

test("migration derives bookStyle once, keeps the active template and the hand-written text, and is idempotent", () => {
  const jin = profileFor("金庸", [], ["模板规则。"]);
  const legacy = { activeStyleProfileId: jin.id, styleProfiles: { [jin.id]: jin }, assets: { style: "作者手写的旧文风文本。" } };
  const derived = migrateBookStyle(legacy);
  assert.equal(derived.mode, "template");
  assert.equal(derived.templateId, jin.id);
  assert.ok(derived.rules.some((rule) => rule.text === "模板规则。"));
  // Re-running on an existing bookStyle never re-derives or duplicates.
  const stored = { mode: "custom", rules: [{ id: "r1", text: "本书规则。", layer: "semantic", origin: "author_written", evidenceIds: [] }] };
  assert.deepEqual(migrateBookStyle({ ...legacy, bookStyle: stored }), stored);
  // No active profile: hand-written text becomes the book's custom content.
  const fromText = migrateBookStyle({ assets: { style: "旧文风说明。" } });
  assert.equal(fromText.mode, "custom");
  assert.ok(fromText.rules.some((rule) => rule.text === "旧文风说明。"));
  // Nothing at all: off — never silently enabled by a single template.
  assert.equal(migrateBookStyle({ styleProfiles: { [jin.id]: jin } }).mode, "off");
});

test("end-to-end packet: selecting a template changes the next request immediately; off removes everything", () => {
  const jin = profileFor("金庸", [sample("j1", NARRATION, "金庸", "tpl-金庸")], ["情绪通过动作呈现。"]);
  const dongye = profileFor("东野圭吾", [], ["短段落推进悬念。"]);
  const templates = { [jin.id]: jin, [dongye.id]: dongye };
  const samples = [sample("j1", NARRATION, "金庸", "tpl-金庸")];
  const withJin = buildContextPacket({ workspace: { ...workspaceBase, assets: { style: "" }, styleSamples: samples, styleProfiles: templates, bookStyle: applyTemplate(jin) }, target: { moduleId: "chapters", entityId: "c1" } });
  assert.ok(withJin.text.includes("【本书生效文风"), "the effective style block is injected");
  assert.ok(withJin.text.includes("情绪通过动作呈现。"));
  assert.ok(withJin.text.includes("【真实样段"), "matched excerpts ride the excerpt channel");
  assert.ok(!withJin.text.includes("短段落推进悬念。"), "unselected templates never mix in");

  const withDongye = buildContextPacket({ workspace: { ...workspaceBase, assets: { style: "" }, styleSamples: samples, styleProfiles: templates, bookStyle: applyTemplate(dongye) }, target: { moduleId: "chapters", entityId: "c1" } });
  assert.ok(withDongye.text.includes("短段落推进悬念。"), "switching applies on the very next request");
  assert.ok(!withDongye.text.includes("【真实样段"), "the other template's samples do not travel");

  const edited = { ...applyTemplate(jin), rules: [{ id: "r", text: "改后的规则。", layer: "semantic", origin: "author_written", evidenceIds: [] }] };
  const withEdit = buildContextPacket({ workspace: { ...workspaceBase, assets: { style: "" }, styleSamples: samples, styleProfiles: templates, bookStyle: edited }, target: { moduleId: "chapters", entityId: "c1" } });
  assert.ok(withEdit.text.includes("改后的规则。") && !withEdit.text.includes("情绪通过动作呈现。"), "book edits apply without any re-apply step");

  const off = buildContextPacket({ workspace: { ...workspaceBase, assets: { style: "" }, styleSamples: samples, styleProfiles: templates, bookStyle: STYLE_OFF }, target: { moduleId: "chapters", entityId: "c1" } });
  assert.ok(!off.text.includes("本书生效文风") && !off.styleRules, "off mode injects nothing");
});

test("quick adjustments are real rules, toggleable", () => {
  let state = customStyle([]);
  assert.ok(!hasQuickAdjustment(state, "concise"));
  state = toggleQuickAdjustment(state, "concise");
  assert.ok(hasQuickAdjustment(state, "concise"));
  assert.ok(state.rules[0].text === QUICK_ADJUSTMENTS.find((entry) => entry.id === "concise").rule);
  state = toggleQuickAdjustment(state, "concise");
  assert.ok(!hasQuickAdjustment(state, "concise") && state.rules.length === 0);
});

test("backup round-trip keeps templates, samples and the applied book style", () => {
  const jin = profileFor("金庸", [], ["模板规则。"]);
  const book = { id: "bk", title: "测试书", genre: "悬疑", premise: "一句话", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#7f302a", glyph: "书" };
  const bookStyle = applyTemplate(jin);
  const parsed = parseBackup({ version: 3, books: [book], workspaces: { bk: { idea: "一句话", styleProfiles: { [jin.id]: jin }, bookStyle } } });
  const merged = mergeBookWorkspace(book, parsed.workspaces.bk);
  assert.equal(merged.bookStyle.mode, "template");
  assert.equal(merged.bookStyle.templateId, jin.id);
  assert.ok(merged.styleProfiles[jin.id], "the template survives export/import");
  const again = mergeBookWorkspace(book, { ...parsed.workspaces.bk, bookStyle: merged.bookStyle });
  assert.equal(again.bookStyle.templateId, jin.id, "reload is idempotent");
});
