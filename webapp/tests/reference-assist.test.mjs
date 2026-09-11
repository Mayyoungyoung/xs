import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchQueries, buildStylePlan, dedupe, evidenceIdFor, identificationStatus, isStylePlanText,
  mergeModelPlan, mergeStylePlans, normalizeReferenceText, parseReferenceBrief, reviseStylePlan,
  statusBadges, stylePlanToRuleText,
} from "../lib/reference-assist.ts";

const evidence = (over = {}) => ({ evidenceId: "ev-test", kind: "encyclopedia", source: "百度百科", url: "https://baike.baidu.com/item/x", retrievedAt: "2026-09-12T00:00:00.000Z", retrieved: true, chars: 300, ...over });

test("one line becomes an editable identification without asking the author to pick a category first", () => {
  const cases = [
    ["余华", "余华"],
    ["余华文风", "余华"],
    ["我想参考余华的文笔", "余华"],
    ["文笔参考余华，但人物和故事保持我的。", "余华"],
    ["参考郭敬明的表达，先给我可调整的表达方案。", "郭敬明"],
    ["借鉴《斗破苍穹》的节奏，不复制情节。", "斗破苍穹"],
    ["借鉴斗破苍穹的节奏", "斗破苍穹"],
    ["斗破苍穹", "斗破苍穹"],
    ["余华 作家", "余华"],
    ["《诡秘之主》", "诡秘之主"],
  ];
  for (const [input, expected] of cases) assert.equal(parseReferenceBrief(input).entity.name, expected, input);
  assert.equal(parseReferenceBrief("我想参考余华的文笔").entity.kind, "author");
  assert.equal(parseReferenceBrief("借鉴《斗破苍穹》的节奏").entity.kind, "work");
  assert.deepEqual(parseReferenceBrief("余华文风").proseFocus.length > 0, true);
});

test("requirements stay out of the object name and become keep/avoid constraints", () => {
  const brief = parseReferenceBrief("文笔参考余华，但人物和故事保持我的，不复制情节。");
  assert.equal(brief.entity.name, "余华");
  assert.ok(brief.keep.some((clause) => clause.includes("人物和故事保持我的")), JSON.stringify(brief.keep));
  assert.ok(brief.avoid.some((clause) => clause.includes("不复制情节")), JSON.stringify(brief.avoid));
  assert.ok(brief.dimensions.includes("prose"));
  assert.ok(!brief.clauses.some((clause) => clause.includes("余华") && clause.includes("保持")), "entity and requirement are separated");
  assert.ok(buildSearchQueries(brief).every((item) => !item.query.includes("保持") && !item.query.includes("但")), "the whole sentence never becomes one phrase");
});

test("a custom expression request has no entity and still produces concrete directions", () => {
  const brief = parseReferenceBrief("情感细腻一些，但别堆砌修饰。");
  assert.equal(brief.custom, true);
  assert.equal(brief.entity.name, "");
  assert.ok(brief.dimensions.includes("emotion") && brief.dimensions.includes("imagery"), JSON.stringify(brief.dimensions));
  assert.ok(brief.avoid.some((clause) => clause.includes("堆砌")), JSON.stringify(brief.avoid));
  const plan = buildStylePlan({ brief, scope: "style" });
  assert.equal(plan.basisKind, "model-only");
  assert.ok(plan.gaps.some((gap) => gap.includes("没有指定借鉴对象")), JSON.stringify(plan.gaps));
  assert.ok(plan.rules.length >= 4 && plan.rules.length <= 10);
  assert.ok(plan.directions.length >= 4 && plan.directions.length <= 6);
});

test("original and adapted media are told apart, and mixed mentions ask for confirmation", () => {
  const adaptation = parseReferenceBrief("参考《斗破苍穹》改编剧的节奏");
  assert.equal(adaptation.entity.medium, "adaptation");
  assert.ok(adaptation.candidates.some((candidate) => candidate.medium === "adaptation"));
  const original = parseReferenceBrief("参考《斗破苍穹》原著的节奏");
  assert.equal(original.entity.medium, "original");
  const both = parseReferenceBrief("参考《斗破苍穹》原著和电视剧的节奏");
  assert.equal(both.ambiguous, true);
  assert.ok(both.ambiguityReasons.some((reason) => reason.includes("原著与改编")), JSON.stringify(both.ambiguityReasons));
});

test("a bare name is never silently classified as an author", () => {
  const brief = parseReferenceBrief("斗破苍穹");
  assert.equal(brief.ambiguous, true);
  assert.deepEqual(brief.candidates.map((candidate) => candidate.kind), ["author", "work"]);
  const plan = buildStylePlan({ brief, scope: "style" });
  assert.ok(plan.gaps.some((gap) => gap.includes("尚未确认")), JSON.stringify(plan.gaps));
  assert.ok(!plan.rules.some((rule) => rule.includes("斗破苍穹")), "no invented biography or plot");
});

test("search queries separate the entity from the requirement with a hard cap", () => {
  const queries = buildSearchQueries(parseReferenceBrief("我想参考余华的文笔"));
  assert.ok(queries.length <= 4);
  assert.equal(queries[0].query, "余华");
  assert.equal(queries[0].role, "primary");
  assert.ok(queries.some((item) => item.query === "余华 作家"), JSON.stringify(queries));
  assert.ok(queries.some((item) => item.query.includes("语言") || item.query.includes("访谈")));
  for (const item of queries) {
    assert.ok(!item.query.includes("我想"), item.query);
    assert.ok(!item.query.includes("文笔"), item.query);
    assert.ok(item.query.length <= 60);
  }
  assert.equal(buildSearchQueries(parseReferenceBrief("借鉴《斗破苍穹》的节奏"))[0].query, "斗破苍穹");
  const custom = buildSearchQueries(parseReferenceBrief("情感细腻一些，但别堆砌修饰。"));
  assert.ok(custom.length >= 1 && custom.every((item) => !item.query.includes("情感细腻一些")));
});

test("encyclopedia material identifies an object and never claims to be a prose sample", () => {
  const brief = parseReferenceBrief("参考余华");
  const plan = buildStylePlan({ brief, evidence: [evidence()], scope: "style" });
  assert.equal(plan.basisKind, "metadata-only");
  assert.ok(plan.gaps.some((gap) => gap.includes("无法据此提取句式与节奏")), JSON.stringify(plan.gaps));
  const badges = statusBadges(brief, [evidence()]);
  assert.ok(badges.includes("身份已匹配"));
  assert.ok(!badges.includes("有文本样段"));
  assert.ok(badges.includes("仍需确认"), "no prose sample means still to confirm");
  const status = identificationStatus(brief, [evidence()]);
  assert.equal(status.hasProseSample, false);
  assert.equal(status.hasAnalysis, false);
});

test("a real prose sample is the only thing that upgrades the basis to verified", () => {
  const brief = parseReferenceBrief("参考余华");
  const plan = buildStylePlan({ brief, evidence: [evidence({ kind: "prose", source: "粘贴原文", url: undefined, chars: 4200 })], scope: "style" });
  assert.equal(plan.basisKind, "verified");
  assert.ok(statusBadges(brief, [evidence({ kind: "prose", retrieved: true })]).includes("有文本样段"));
});

test("no evidence means an explicitly unverified draft, with no fake source citations", () => {
  const brief = parseReferenceBrief("参考余华");
  const plan = buildStylePlan({ brief, evidence: [], scope: "style" });
  assert.equal(plan.basisKind, "model-only");
  assert.deepEqual(plan.basis, [{ kind: "model", label: "模型已有知识" }]);
  assert.ok(plan.gaps.some((gap) => gap.includes("未联网核验")), JSON.stringify(plan.gaps));
  assert.ok(!("confidence" in plan) && !("similarity" in plan));
});

test("plan rule text is concrete, source-cited and free of fake percentages", () => {
  const plan = buildStylePlan({ brief: parseReferenceBrief("文笔参考余华，但人物和故事保持我的。"), evidence: [evidence({ evidenceId: "ev-abc" })], scope: "style" });
  const text = stylePlanToRuleText(plan);
  assert.ok(isStylePlanText(text));
  for (const heading of ["【借鉴对象】", "【方案依据】", "【表达方向】", "【保留】", "【不借鉴】", "【可执行规则】", "【仍需确认】"]) assert.ok(text.includes(heading), heading);
  assert.ok(text.includes("ev-abc"), "citations point at the real evidence id");
  assert.ok(!/\d+\s*%/.test(text), "no percentage may appear");
  assert.ok(!/语言优美|情节紧凑|人物生动/.test(text), "no empty praise");
  assert.ok(!/(出生于|原名|生于\d|代表作有|著有《)/.test(text), "no invented biography");
  const rules = text.split("【可执行规则】")[1].split("【")[0].trim().split("\n");
  assert.ok(rules.length >= 5 && rules.length <= 10, `5-10 rules, got ${rules.length}`);
});

test("a short follow-up edits the current candidate and keeps its identity and version", () => {
  const plan = buildStylePlan({ brief: parseReferenceBrief("参考余华的文笔"), scope: "style" });
  const revised = reviseStylePlan(plan, "太华丽，少点抒情，节奏更快");
  assert.equal(revised.id, plan.id);
  assert.equal(revised.version, 2);
  assert.ok(revised.rules.length >= plan.rules.length);
  assert.ok(revised.notes.some((note) => note.includes("第 2 版")));
  assert.ok(revised.rules.some((rule) => rule.includes("修饰密度")), JSON.stringify(revised.rules));
  assert.equal(revised.basisKind, plan.basisKind, "basis and sources are preserved");
});

test("model refinement only edits wording and never invents sources", () => {
  const plan = buildStylePlan({ brief: parseReferenceBrief("参考余华的文笔"), scope: "style" });
  const applied = mergeModelPlan(plan, JSON.stringify({
    directions: [{ label: "句式节奏", guidance: "短句为主，动作句连缀，段末收一个长句。" }, { label: "修饰与意象密度", guidance: "每段一个意象。" }, { label: "情绪呈现", guidance: "情绪落在手上和呼吸上。" }, { label: "对话写法", guidance: "对话带停顿和回避。" }],
    rules: ["规则一足够长", "规则二足够长", "规则三足够长", "规则四足够长", "规则五足够长"],
    gaps: ["模型补充：仍需原文核对。"],
  }));
  assert.equal(applied.applied, true);
  assert.equal(applied.plan.basisKind, "model-only");
  assert.ok(applied.plan.gaps.some((gap) => gap.includes("未联网核验")));
  assert.equal(applied.plan.basis[0].label, "模型已有知识");
  const broken = mergeModelPlan(plan, "<html>not json</html>");
  assert.equal(broken.applied, false);
  assert.ok(broken.note.includes("保留初步方案"));
  assert.deepEqual(broken.plan.rules, plan.rules);
});

test("mixed references are merged per dimension and conflicts are explained, not averaged", () => {
  const first = buildStylePlan({ brief: parseReferenceBrief("参考余华的文笔"), scope: "style" });
  const second = buildStylePlan({ brief: parseReferenceBrief("参考郭敬明的文笔"), scope: "style" });
  const mixed = mergeStylePlans({ plans: [{ plan: first, dimensions: ["prose"] }, { plan: { ...second, directions: second.directions.map((direction, index) => index === 0 ? { ...direction, guidance: "完全不同的句式处理方式。" } : direction) }, dimensions: ["prose"] }] });
  assert.ok(mixed.notes.some((note) => note.includes("不同")) || mixed.notes.some((note) => note.includes("冲突")) || mixed.notes.some((note) => note.includes("维度")));
  assert.ok(!JSON.stringify(mixed).match(/\d+\s*%/), "no percentage blend");
});

test("normalization folds full-width forms, quotes and punctuation", () => {
  assert.equal(normalizeReferenceText("参考《斗破苍穹》的节奏！！"), "参考《斗破苍穹》的节奏");
  assert.equal(normalizeReferenceText("余华  文风"), "余华 文风");
  assert.equal(normalizeReferenceText("「余华」"), "《余华》");
  assert.equal(normalizeReferenceText("ＡＢＣ"), "ABC");
  assert.equal(evidenceIdFor({ url: "https://a.example/x", source: "s", title: "t" }), evidenceIdFor({ url: "https://a.example/x", source: "s", title: "t" }));
  assert.notEqual(evidenceIdFor({ url: "https://a.example/x", source: "s", title: "t" }), evidenceIdFor({ url: "https://a.example/y", source: "s", title: "t" }));
  assert.deepEqual(dedupe(["a", "a", "b"]), ["a", "b"]);
});
