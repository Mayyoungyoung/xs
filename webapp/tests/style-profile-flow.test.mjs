import test from "node:test";
import assert from "node:assert/strict";
import { activeStyleProfile, buildContextPacket } from "../lib/co-creation.ts";
import { buildStyleProfile, makeStyleSample, profileDisplayName } from "../lib/style-fidelity.ts";

const NARRATION = "雨从傍晚下到深夜，屋檐的水线一直没有断过。她把窗子推开一条缝，冷气挤进来，桌上的纸被吹到墙角。她走过去捡起来，顺手把灯调暗了一格。屋里只剩下钟摆的声音，一下，又一下。";

const sample = (id, raw, author) => makeStyleSample({
  bookId: "bk", targetId: `profile-of-${author}`, raw,
  source: { kind: "primary_excerpt", title: `${author}节选`, author, usageBasis: "permitted_excerpt" },
  now: "2026-09-16T00:00:00.000Z", id,
}).sample;

function profileFor(author, samples, extraRules = []) {
  const profile = buildStyleProfile({
    bookId: "bk", targetId: `profile-of-${author}`, scope: { author, work: "", note: "" }, samples,
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

test("profileDisplayName names a profile after its target", () => {
  assert.equal(profileDisplayName({ scope: { author: "金庸", work: "天龙八部", note: "" } }), "金庸 · 天龙八部");
  assert.equal(profileDisplayName({ scope: { author: "", work: "", note: "冷硬侦探风" } }), "冷硬侦探风");
  assert.equal(profileDisplayName({ scope: { author: "", work: "", note: "" } }), "自定义文风");
});

test("a rule-only profile with no samples reaches the manuscript request as rules", () => {
  const profile = profileFor("金庸", [], ["对话不超过三句一轮。"]);
  const context = buildContextPacket({
    workspace: { ...workspaceBase, styleSamples: [], styleProfiles: { [profile.id]: profile }, activeStyleProfileId: profile.id },
    target: { moduleId: "chapters", entityId: "c1" },
  });
  assert.ok(context.styleContext, "the excerpt channel is built from the profile even without samples");
  assert.equal(context.styleContext.sampleIds.length, 0);
  assert.ok(context.text.includes("金庸"), "the target author is named");
  assert.ok(context.text.includes("对话不超过三句一轮"), "a hand-written rule travels into the request");
  assert.ok(!context.text.includes("【本次生效文风 · "), "the standalone snapshot block is not duplicated");
});

test("switching the active profile changes what the request carries, immediately", () => {
  const jin = profileFor("金庸", [sample("j1", NARRATION, "金庸")]);
  const dongye = profileFor("东野圭吾", [], ["短段落推进悬念。"]);
  const profiles = { [jin.id]: jin, [dongye.id]: dongye };
  const withJin = buildContextPacket({ workspace: { ...workspaceBase, styleSamples: workspaceBaseStyleSamples(jin), styleProfiles: profiles, activeStyleProfileId: jin.id }, target: { moduleId: "chapters", entityId: "c1" } });
  assert.ok(withJin.text.includes("金庸"));
  const withDongye = buildContextPacket({ workspace: { ...workspaceBase, styleSamples: workspaceBaseStyleSamples(jin), styleProfiles: profiles, activeStyleProfileId: dongye.id }, target: { moduleId: "chapters", entityId: "c1" } });
  assert.ok(withDongye.text.includes("东野圭吾"), "the switched profile is used without any re-apply step");
  assert.ok(!withDongye.text.includes("【风格规则】\n- 句子以中短句为主：句长中位数 12 字"), "the other profile's measured rules are gone");
});

test("editing a profile's rules takes effect on the next request without re-applying", () => {
  const profile = profileFor("金庸", [], ["旧规则。"]);
  const edited = { ...profile, rules: [...profile.rules.filter((rule) => rule.text !== "旧规则。"), { id: "rule-new", text: "新规则。", layer: "semantic", origin: "author_written", evidenceIds: [] }] };
  const context = buildContextPacket({
    workspace: { ...workspaceBase, styleSamples: [], styleProfiles: { [edited.id]: edited }, activeStyleProfileId: edited.id },
    target: { moduleId: "chapters", entityId: "c1" },
  });
  assert.ok(context.text.includes("新规则。"));
  assert.ok(!context.text.includes("旧规则。"));
});

test("activeStyleProfile prefers the persisted choice, then the legacy key, then a single entry", () => {
  const a = profileFor("金庸", []);
  const b = profileFor("东野圭吾", []);
  assert.equal(activeStyleProfile({ ...workspaceBase, styleProfiles: { [a.id]: a, [b.id]: b }, activeStyleProfileId: b.id }).profile?.id, b.id);
  assert.equal(activeStyleProfile({ ...workspaceBase, styleProfiles: { [a.id]: a, [b.id]: b } }).profile, null, "no silent pick between several profiles");
  assert.equal(activeStyleProfile({ ...workspaceBase, styleProfiles: { [a.id]: a } }).profile?.id, a.id, "a single entry is used");
});

function workspaceBaseStyleSamples(profile) {
  return [sample("j1", NARRATION, "金庸")].filter((entry) => profile.sampleIds.includes(entry.id));
}
