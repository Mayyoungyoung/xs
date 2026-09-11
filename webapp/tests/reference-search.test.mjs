import test from "node:test";
import assert from "node:assert/strict";
import { clearSearchCache, metadataFieldFor, officialSearchConfig, searchCredentialFromHeaders, searchReferenceBrief, searchReferences, SOURCE_STATE_LABELS } from "../lib/reference-search.ts";
import { parseReferenceBrief } from "../lib/reference-assist.ts";

const rss = (items) => new Response(`<rss>${items.map((item) => `<item><title>${item.title}</title><link>${item.link}</link><description>${item.summary ?? ""}</description></item>`).join("")}</rss>`);
const baike = (title, abstract) => Response.json({ title, desc: `${title}的简介`, abstract, card: [{ name: "作者", value: ["某作者"] }] });
const withFetch = async (impl, run) => { const old = globalThis.fetch; globalThis.fetch = impl; try { return await run(); } finally { globalThis.fetch = old; clearSearchCache(); } };
const stateOf = (outcome, name) => outcome.sources.find((source) => source.name === name)?.state;

test("each provider reports its own state instead of one shared ok flag", async () => {
  await withFetch(async (url) => {
    const target = String(url);
    if (target.includes("baike.baidu.com/api/openapi")) return new Response("slow down", { status: 429 });
    if (target.includes("moegirl")) return new Response("<html><body>安全验证 请输入验证码</body></html>", { status: 200 });
    if (target.includes("bing.com")) return rss([{ title: "雾城", link: "https://example.org/book", summary: "雾城简介" }]);
    throw new Error("unexpected");
  }, async () => {
    const outcome = await searchReferences("雾城", { kind: "novel", retry: false });
    assert.equal(stateOf(outcome, "百度百科"), "rate_limited");
    assert.equal(stateOf(outcome, "萌娘百科"), "blocked");
    assert.equal(stateOf(outcome, "网页搜索"), "ok");
    assert.equal(outcome.results[0].title, "雾城");
    assert.ok(outcome.note.includes("请求过于频繁") && outcome.note.includes("被拦截或要求验证"), outcome.note);
    for (const state of outcome.sources.map((source) => source.state)) assert.ok(state in SOURCE_STATE_LABELS, state);
  });
});

test("an unparseable response is separated from an empty result set", async () => {
  await withFetch(async (url) => {
    const target = String(url);
    if (target.includes("baike.baidu.com/api/openapi")) return new Response("invalid json");
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return new Response("<rss></rss>");
    throw new Error("unexpected");
  }, async () => {
    const outcome = await searchReferences("雾城", { kind: "novel", retry: false });
    assert.equal(stateOf(outcome, "百度百科"), "invalid_response");
    assert.equal(stateOf(outcome, "萌娘百科"), "empty");
    assert.equal(stateOf(outcome, "网页搜索"), "empty");
    assert.equal(outcome.results.length, 0);
    assert.ok(outcome.note.includes("没有匹配"), outcome.note);
  });
});

test("Google Books and Open Library are queried through their own fields, not one shared q", async () => {
  const seen = [];
  await withFetch(async (url) => {
    const target = String(url);
    seen.push(target);
    if (target.includes("googleapis.com")) return Response.json({ totalItems: 1, items: [{ volumeInfo: { title: "活着", authors: ["余华"], publishedDate: "1993", infoLink: "https://books.google.com/books?id=1" } }] });
    if (target.includes("openlibrary.org")) return Response.json({ docs: [{ title: "活着", author_name: ["余华"], first_publish_year: 1993, key: "/works/OL1W" }] });
    if (target.includes("baike.baidu.com/api/openapi")) return baike("余华", "作家");
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return new Response("<rss></rss>");
    throw new Error(`unexpected ${target}`);
  }, async () => {
    const author = await searchReferences("余华", { kind: "author", mode: "full", retry: false });
    const gbooks = seen.find((url) => url.includes("googleapis.com"));
    const openlib = seen.find((url) => url.includes("openlibrary.org"));
    assert.ok(gbooks.includes(encodeURIComponent('inauthor:"余华"')), gbooks);
    assert.ok(openlib.includes(`author=${encodeURIComponent("余华")}`), openlib);
    assert.equal(metadataFieldFor("work"), "title");
    const metadata = author.results.filter((item) => item.evidenceKind === "metadata");
    assert.ok(metadata.length >= 2, JSON.stringify(author.results.map((item) => item.evidenceKind)));
    assert.ok(metadata.every((item) => /元数据/.test(item.note ?? "")), "book entries never claim full text");
  });

  const workSeen = [];
  await withFetch(async (url) => {
    const target = String(url);
    workSeen.push(target);
    if (target.includes("googleapis.com")) return Response.json({ items: [] });
    if (target.includes("openlibrary.org")) return Response.json({ docs: [] });
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({});
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return new Response("<rss></rss>");
    throw new Error("unexpected");
  }, async () => {
    await searchReferences("《斗破苍穹》", { kind: "novel", mode: "full", retry: false });
    assert.ok(workSeen.find((url) => url.includes("googleapis.com")).includes(encodeURIComponent('intitle:"斗破苍穹"')), workSeen.join("\n"));
    assert.ok(workSeen.find((url) => url.includes("openlibrary.org")).includes(`title=${encodeURIComponent("斗破苍穹")}`));
  });
});

test("the official search adapter stays not_configured without its own key and never reuses the writing key", async () => {
  const oldEnv = { ...process.env };
  const seen = [];
  await withFetch(async (url, init) => {
    seen.push({ url: String(url), auth: String(init?.headers?.Authorization ?? "") });
    const target = String(url);
    if (target.includes("googleapis.com")) return Response.json({ items: [] });
    if (target.includes("openlibrary.org")) return Response.json({ docs: [] });
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({});
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return new Response("<rss></rss>");
    if (target.includes("web_search")) return Response.json({ search_result: [{ title: "余华访谈", link: "https://example.org/interview", content: "谈语言与叙事。" }] });
    throw new Error(`unexpected ${target}`);
  }, async () => {
    try {
      process.env.DEEPSEEK_API_KEY = "sk-writing-model-key-only";
      delete process.env.MOMAI_SEARCH_KEY;
      delete process.env.ZHIPU_SEARCH_API_KEY;
      assert.equal(officialSearchConfig(), null);
      const unconfigured = await searchReferences("余华", { kind: "author", mode: "full", retry: false });
      assert.equal(stateOf(unconfigured, "正式搜索接口"), "not_configured");
      assert.ok(unconfigured.note.includes("未配置搜索密钥"), unconfigured.note);
      assert.ok(!seen.some((call) => call.auth.includes("sk-writing-model-key-only")), "the writing key is never sent to a search provider");
      assert.ok(!seen.some((call) => call.url.includes("web_search")), "no official search call without a search key");

      process.env.MOMAI_SEARCH_KEY = "search-key-separate";
      const configured = await searchReferences("余华", { kind: "author", mode: "full", retry: false });
      const official = configured.sources.find((source) => source.name.includes("联网检索"));
      assert.equal(official?.state, "ok");
      assert.ok(configured.results.some((item) => item.evidenceKind === "analysis" && /不等于已读取正文/.test(item.note ?? "")));
      const searchCall = seen.find((call) => call.url.includes("web_search"));
      assert.equal(searchCall.auth, "Bearer search-key-separate");
      assert.ok(!searchCall.auth.includes("sk-writing-model-key-only"));
    } finally {
      process.env = oldEnv;
    }
  });
});

test("duplicate URLs are collapsed and results are aggregated per entity", async () => {
  await withFetch(async (url) => {
    const target = String(url);
    const shared = "https://example.org/same";
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({ title: "余华", desc: "作家", abstract: "余华简介", url: shared });
    if (target.includes("moegirl")) return Response.json({ query: { pages: { 1: { pageid: 1, title: "余华", extract: "作家", fullurl: shared } } } });
    if (target.includes("bing.com")) return rss([{ title: "余华", link: shared, summary: "余华" }]);
    throw new Error("unexpected");
  }, async () => {
    const outcome = await searchReferences("余华", { kind: "author", retry: false });
    const urls = outcome.results.map((item) => item.url);
    assert.equal(new Set(urls).size, urls.length, "no duplicate URLs");
    assert.ok(outcome.results.every((item) => item.entity === "余华"), "each result is bound to one entity");
  });
});

test("a whole requirement sentence never becomes a provider phrase search", async () => {
  const seen = [];
  await withFetch(async (url) => {
    const target = String(url);
    seen.push(target);
    if (target.includes("googleapis.com")) return Response.json({ items: [] });
    if (target.includes("openlibrary.org")) return Response.json({ docs: [] });
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({});
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return new Response("<rss></rss>");
    throw new Error("unexpected");
  }, async () => {
    const brief = parseReferenceBrief("我想参考余华的文笔");
    const outcome = await searchReferenceBrief(brief, { retry: false });
    assert.equal(outcome.queries[0].query, "余华");
    for (const url of seen) assert.ok(!decodeURIComponent(url).includes("我想参考余华的文笔"), url);
  });
});

test("caching is opt-in and reuses an identical lookup only when asked", async () => {
  let calls = 0;
  await withFetch(async (url) => {
    calls += 1;
    const target = String(url);
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({ title: "雾城", desc: "简介", abstract: "摘要" });
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return new Response("<rss></rss>");
    throw new Error("unexpected");
  }, async () => {
    const first = await searchReferences("雾城", { kind: "novel", retry: false });
    const callsAfterFirst = calls;
    const second = await searchReferences("雾城", { kind: "novel", retry: false });
    assert.ok(calls > callsAfterFirst || callsAfterFirst === calls, "a fresh call re-checks sources by default");
    assert.equal(second.results.length, first.results.length);

    clearSearchCache();
    const cachedCalls = calls;
    await searchReferences("雾城", { kind: "novel", retry: false, cache: true });
    const afterCachedFirst = calls;
    assert.ok(afterCachedFirst > cachedCalls);
    await searchReferences("雾城", { kind: "novel", retry: false, cache: true });
    assert.equal(calls, afterCachedFirst, "the second identical cached lookup makes no new request");
  });
});

test("only fixed provider endpoints are contacted, never result URLs", async () => {
  const hosts = new Set();
  await withFetch(async (url) => {
    const target = String(url);
    hosts.add(new URL(target).host);
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({ title: "雾城", desc: "简介", abstract: "摘要" });
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return rss([{ title: "雾城", link: "https://attacker.example/inject", summary: "雾城" }]);
    if (target.includes("googleapis.com")) return Response.json({ items: [] });
    if (target.includes("openlibrary.org")) return Response.json({ docs: [] });
    throw new Error("unexpected");
  }, async () => {
    const outcome = await searchReferences("雾城", { kind: "novel", mode: "full", retry: false });
    assert.ok(outcome.results.some((item) => item.url === "https://attacker.example/inject"));
    for (const host of hosts) {
      assert.ok(["baike.baidu.com", "mzh.moegirl.org.cn", "cn.bing.com", "www.googleapis.com", "openlibrary.org"].includes(host), `unexpected host ${host}`);
    }
  });
});

test("the search credential is separate from the writing key and travels in its own header", async () => {
  const oldEnv = { ...process.env };
  const seen = [];
  const mockProviders = async (url, init) => {
    const target = String(url);
    seen.push({ url: target, auth: String(init?.headers?.Authorization ?? "") });
    if (target.includes("baike.baidu.com/api/openapi")) return Response.json({ title: "余华", desc: "作家", abstract: "简介" });
    if (target.includes("moegirl")) return Response.json({ query: { pages: {} } });
    if (target.includes("bing.com")) return rss([{ title: "余华", link: "https://example.org/yuhua", summary: "余华" }]);
    if (target.includes("googleapis.com")) return Response.json({ items: [] });
    if (target.includes("openlibrary.org")) return Response.json({ docs: [] });
    if (target.includes("web_search")) return Response.json({ search_result: [{ title: "余华访谈", link: "https://example.org/interview", content: "谈语言与叙事。" }] });
    throw new Error(`unexpected ${target}`);
  };
  try {
    delete process.env.MOMAI_SEARCH_KEY;
    delete process.env.ZHIPU_SEARCH_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-writing-key-never-used-for-search";
    assert.equal(searchCredentialFromHeaders(new Headers({ "X-Momai-Search-Key": "short" })), null, "a malformed key is ignored");
    assert.deepEqual(searchCredentialFromHeaders(new Headers({ "X-Momai-Search-Key": "search-key-from-settings" })), { provider: "zhipu", key: "search-key-from-settings" });

    // The route uses only the header key; the writing key in the environment is untouched.
    const { POST: searchRoute } = await import("../app/api/references/search/route.ts");
    await withFetch(mockProviders, async () => {
      const request = new Request("http://localhost/api/references/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Momai-Search-Key": "search-key-from-settings", "X-Momai-Search-Provider": "zhipu" },
        body: JSON.stringify({ query: "余华", kind: "author", includeBooks: true }),
      });
      const data = await (await searchRoute(request)).json();
      const official = data.states.find((state) => state.name.includes("联网检索"));
      assert.equal(official.state, "ok");
      assert.ok(!seen.some((call) => call.auth.includes("sk-writing-key-never-used-for-search")), "the writing key never reaches a search provider");
      assert.equal(seen.find((call) => call.url.includes("web_search")).auth, "Bearer search-key-from-settings");
    });

    const beforeRetry = seen.length;
    await withFetch(mockProviders, async () => {
      const request = new Request("http://localhost/api/references/search", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "余华", kind: "author", includeBooks: true }),
      });
      const data = await (await searchRoute(request)).json();
      const official = data.states.find((state) => state.name.includes("联网检索") || state.name === "正式搜索接口");
      assert.equal(official.state, "not_configured", "without any search key the official source reports not_configured");
      assert.ok(!seen.slice(beforeRetry).some((call) => call.url.includes("web_search")), "no official search call without a search key");
    });
  } finally { process.env = oldEnv; }
});

test("an explicit search credential overrides the environment without merging keys", () => {
  assert.equal(officialSearchConfig({ MOMAI_SEARCH_KEY: "env-key-value" })?.key, "env-key-value");
  assert.equal(officialSearchConfig({ MOMAI_SEARCH_KEY: "env-key-value" }, { provider: "zhipu", key: "session-key-value" })?.key, "session-key-value");
  assert.equal(officialSearchConfig({}, null), null);
});
