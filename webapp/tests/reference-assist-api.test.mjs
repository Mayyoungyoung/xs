import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/references/assist/route.ts";
import { clearSearchCache } from "../lib/reference-search.ts";

const request = (data) => new Request("http://localhost/api/references/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const rss = (items) => new Response(`<rss>${items.map((item) => `<item><title>${item.title}</title><link>${item.link}</link><description>${item.summary ?? ""}</description></item>`).join("")}</rss>`);
const noSearch = { search: false };
const withFetch = async (impl, run) => { const old = globalThis.fetch; globalThis.fetch = impl; clearSearchCache(); try { return await run(); } finally { globalThis.fetch = old; clearSearchCache(); } };

test("one line yields an editable identification, badges, queries and a plan", async () => {
  const response = await POST(request({ input: "文笔参考余华，但人物和故事保持我的。", scope: "style", requestId: "req-1", ...noSearch }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.requestId, "req-1");
  assert.equal(data.brief.entity.name, "余华");
  assert.equal(data.scope, "style");
  assert.ok(data.badges.includes("AI 初步归纳"));
  assert.ok(data.badges.includes("仍需确认"));
  assert.ok(data.plan.rules.length >= 5 && data.plan.rules.length <= 10);
  assert.ok(data.plan.directions.length >= 4 && data.plan.directions.length <= 6);
  assert.ok(data.plan.keep.some((item) => item.includes("人物和故事保持我的")));
  assert.equal(data.model.task, "style_reference");
  assert.ok(data.queries.some((item) => item.query === "余华 作家"));
  assert.equal(data.brief.proseFocus.includes("prose"), true);
});

test("without search configuration the first draft still returns and stays explicitly unverified", async () => {
  const data = await (await POST(request({ input: "参考郭敬明的表达", scope: "style", ...noSearch }))).json();
  assert.equal(data.plan.basisKind, "model-only");
  assert.deepEqual(data.plan.basis, [{ kind: "model", label: "模型已有知识" }]);
  assert.ok(data.plan.gaps.some((gap) => gap.includes("未联网核验")), JSON.stringify(data.plan.gaps));
  assert.ok(data.model.prompt.includes("没有联网能力"));
  assert.ok(data.model.prompt.includes("不得输出相似度"));
  assert.ok(!/\d+\s*%/.test(JSON.stringify(data.plan)));
});

test("search failure never blocks the plan and is reported honestly", async () => {
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    const response = await POST(request({ input: "参考余华的文笔", scope: "style" }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.search.attempted, true);
    assert.equal(data.search.degraded, true);
    assert.ok(data.search.note.length > 0);
    assert.equal(data.plan.basisKind, "model-only");
    assert.ok(data.plan.rules.length >= 5);
  });
});

test("a successful search attaches real evidence ids and never upgrades metadata to prose", async () => {
  await withFetch(async (url) => {
    const target = String(url);
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({ title: "余华", desc: "作家", abstract: "当代作家。", card: [{ name: "代表作品", value: ["活着"] }] });
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return rss([{ title: "余华：语言的克制", link: "https://example.org/yuhua", summary: "评余华的叙事语言。" }]);
    if (target.includes("googleapis.com")) return Response.json({ items: [] });
    if (target.includes("openlibrary.org")) return Response.json({ docs: [] });
    throw new Error("unexpected");
  }, async () => {
    const data = await (await POST(request({ input: "参考余华的文笔", scope: "style" }))).json();
    assert.equal(data.plan.basisKind, "metadata-only");
    assert.ok(data.badges.includes("身份已匹配"));
    assert.ok(!data.badges.includes("有文本样段"));
    for (const item of data.plan.basis) {
      if (item.evidenceId) assert.ok(data.evidence.some((entry) => entry.evidenceId === item.evidenceId), "citations point at obtained evidence only");
    }
    assert.ok(data.plan.gaps.some((gap) => gap.includes("无法据此提取句式与节奏")), JSON.stringify(data.plan.gaps));
    const proseEvidence = data.evidence.filter((item) => item.kind === "prose");
    assert.equal(proseEvidence.length, 0, "encyclopedia is never relabelled as a prose sample");
  });
});

test("an author-provided prose sample is the only thing that makes the basis verified", async () => {
  const pasted = { evidenceId: "ev-paste-1", kind: "prose", source: "粘贴原文", retrievedAt: "2026-09-12T00:00:00.000Z", retrieved: true, chars: 3200 };
  const data = await (await POST(request({ input: "参考余华的文笔", scope: "style", evidence: [pasted], ...noSearch }))).json();
  assert.equal(data.plan.basisKind, "verified");
  assert.ok(data.badges.includes("有文本样段"));
  const text = JSON.stringify(data.plan);
  assert.ok(text.includes("ev-paste-1"));
});

test("the model packet is compact and carries the honesty constraints", async () => {
  const data = await (await POST(request({ input: "借鉴《斗破苍穹》的节奏，不复制情节。", scope: "plot", ...noSearch }))).json();
  assert.ok(data.model.context.includes("借鉴对象"));
  assert.ok(!data.model.context.includes("我想"), "no whole-book or whole-sentence dump");
  assert.ok(data.model.prompt.includes("不得编造作者生平"));
  assert.ok(data.model.prompt.includes("不得把你自创的例句标成原作引文"));
  assert.equal(data.brief.entity.kind, "work");
  assert.ok(data.plan.avoid.some((item) => item.includes("不复制情节")));
});

test("a bare unknown object keeps the author's goal without inventing facts", async () => {
  const data = await (await POST(request({ input: "情感细腻一些，但别堆砌修饰。", scope: "style", ...noSearch }))).json();
  assert.equal(data.brief.custom, true);
  assert.equal(data.brief.entity.name, "");
  assert.ok(data.plan.notes.length >= 0);
  assert.ok(data.plan.rules.some((rule) => rule.includes("修饰") || rule.includes("抒情") || rule.includes("情绪")));
  assert.ok(!/余华|郭敬明|斗破苍穹/.test(JSON.stringify(data.plan)), "no sample-author hardcoding");
});

test("invalid requests are rejected", async () => {
  assert.equal((await POST(request({ input: "" }))).status, 400);
  assert.equal((await POST(request({ input: "参考余华", scope: "chapters" }))).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/references/assist", { method: "POST", body: "not json" }))).status, 400);
});
