import test from "node:test";
import assert from "node:assert/strict";
import { emptyAssistDraft, normalizeAssistDrafts, normalizeStylePlan, parseReferenceBrief, buildStylePlan } from "../lib/reference-assist.ts";
import { parseBackup } from "../lib/novel-data.ts";
import { mergeBookWorkspace, createBookWorkspace } from "../components/novel/book-workspace.ts";

const book = { id: "b1", title: "测试书", genre: "悬疑", premise: "一句话", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#7f302a", glyph: "书" };
const draftFor = (scope = "style") => {
  const brief = parseReferenceBrief("文笔参考余华", { scope: "style" });
  const plan = buildStylePlan({ brief, evidence: [{ evidenceId: "ev-1", kind: "encyclopedia", source: "百度百科", retrievedAt: "2026-09-12T00:00:00.000Z", retrieved: true, chars: 300 }], scope: "style" });
  return { ...emptyAssistDraft(scope, "2026-09-12T00:00:00.000Z"), requestId: "req-1", input: "文笔参考余华", plan, evidence: plan.basis.length ? [{ evidenceId: "ev-1", kind: "encyclopedia", source: "百度百科", retrievedAt: "2026-09-12T00:00:00.000Z", retrieved: true, chars: 300 }] : [] };
};

test("assist drafts round-trip through the backup schema and the workspace merge", () => {
  const library = { version: 3, books: [book], workspaces: { b1: { idea: "一句话", referenceAssist: { style: draftFor("style") } } } };
  const parsed = parseBackup(library);
  assert.ok(parsed.workspaces.b1.referenceAssist, "the draft survives the storage schema");
  const workspace = mergeBookWorkspace(book, parsed.workspaces.b1);
  assert.equal(workspace.referenceAssist.style.requestId, "req-1");
  assert.equal(workspace.referenceAssist.style.plan?.entity.name, "余华");
  assert.equal(workspace.referenceAssist.style.evidence[0].kind, "encyclopedia");
});

test("normalization is idempotent and never relabels encyclopedia as a prose sample", () => {
  const input = {
    style: {
      scope: "style", requestId: "r", input: "参考余华", sample: "", applied: null, updatedAt: "t",
      evidence: [
        { evidenceId: "e1", kind: "encyclopedia", source: "百科", retrievedAt: "t", retrieved: true },
        { evidenceId: "e2", kind: "made-up-kind", source: "坏数据", retrievedAt: "t", retrieved: true },
        { evidenceId: "e3", kind: "prose", source: "粘贴", retrievedAt: "t", retrieved: true, chars: 100 },
      ],
      thread: [{ role: "user", text: "更细腻", at: "t" }, { role: "bogus", text: "x", at: "t" }],
      plan: null,
    },
  };
  const once = normalizeAssistDrafts(input);
  assert.deepEqual(normalizeAssistDrafts(once), once, "normalization is idempotent");
  assert.deepEqual(once.style.evidence.map((item) => item.kind), ["encyclopedia", "prose"], "an unknown kind is dropped, not coerced");
  assert.equal(once.style.thread.length, 1);
  assert.ok(!JSON.stringify(once).includes("made-up-kind"));
});

test("an invalid plan is discarded instead of rendering a broken card", () => {
  assert.equal(normalizeStylePlan(null), null);
  assert.equal(normalizeStylePlan({ id: "p" }), null);
  assert.equal(normalizeStylePlan({ id: "p", directions: [], rules: [] })?.rules.length, 0);
  const coerced = normalizeStylePlan({ id: "p", version: -4, directions: [{ label: "句式", guidance: "短句为主", dimension: "nonsense" }], rules: ["规则一"], basisKind: "verified", entity: { name: "余华", kind: "author", medium: "original" } });
  assert.equal(coerced?.version, 1);
  assert.equal(coerced?.directions[0].dimension, "prose");
  assert.equal(coerced?.entity.kind, "author");
});

test("a legacy ReferenceItem without evidence metadata still loads and is not upgraded", () => {
  const library = { version: 3, books: [book], workspaces: { b1: { references: [{ id: "r1", title: "旧资料", kind: "local", summary: "旧的百科摘要", source: "百度百科", scope: "style" }] } } };
  const workspace = mergeBookWorkspace(book, parseBackup(library).workspaces.b1);
  assert.equal(workspace.references[0].evidence, undefined);
  assert.equal(workspace.references[0].summary, "旧的百科摘要");
});

test("assist drafts are working state: excluded from snapshots but kept per scope", () => {
  const workspace = createBookWorkspace(book);
  const withDraft = { ...workspace, referenceAssist: { style: draftFor("style"), plot: draftFor("plot") } };
  assert.deepEqual(Object.keys(withDraft.referenceAssist).sort(), ["plot", "style"]);
  const chapter = { id: "c1", title: "第 1 章", content: "", updatedAt: "" };
  const other = mergeBookWorkspace(book, { ...withDraft, chapters: [chapter], activeChapterId: "c1" });
  assert.ok(other.referenceAssist.style, "switching books or reopening keeps the draft");
  assert.equal(other.referenceAssist.plot.scope, "plot");
});
