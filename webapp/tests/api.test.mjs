import test from "node:test";
import assert from "node:assert/strict";
import { POST, GET } from "../app/api/generate/route.ts";
import { POST as search } from "../app/api/references/search/route.ts";

function request(data) { return new Request("http://localhost/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); }
test("bad requests are 400, including null and wrong field types", async () => {
  for (const value of [null, [], { prompt: 7 }, { prompt: "ok", references: {} }, { prompt: "ok", model: "invalid" }, { prompt: "ok", task: "constructor" }]) assert.equal((await POST(request(value))).status, 400);
  assert.equal((await search(request({ query: 42 }))).status, 400);
});
test("missing and placeholder keys are disclosed honestly without returning secrets", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  assert.equal((await GET()).status, 200); assert.equal((await (await GET()).json()).configured, false);
  assert.equal((await POST(request({ prompt: "写作" }))).status, 503);
  process.env.DEEPSEEK_API_KEY = "replace_with_your_key";
  assert.equal((await POST(request({ prompt: "写作" }))).status, 503);
});
test("model receives settings and chronological conversation; generation returns manuscript", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key-only";
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const sent = JSON.parse(init.body);
    assert.equal(sent.thinking.type, "disabled");
    assert.ok(sent.messages[0].content.includes("魔法消耗记忆"));
    assert.deepEqual(sent.messages.slice(1).map((m) => [m.role, m.content]), [["user", "保留秘密"], ["assistant", "好的"], ["user", "续写"]]);
    return Response.json({ choices: [{ message: { content: "新的原创正文" }, finish_reason: "stop" }] });
  };
  try { const result = await POST(request({ prompt: "续写", context: "魔法消耗记忆", messages: [{ role: "user", text: "保留秘密" }, { role: "ai", text: "好的" }] })); assert.equal((await result.json()).content, "新的原创正文"); }
  finally { globalThis.fetch = old; }
});
test("upstream errors and invalid JSON never leak provider content or claim success", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key-only";
  const old = globalThis.fetch;
  try {
    for (const code of [401, 402, 429, 500]) {
      globalThis.fetch = async () => new Response("secret raw upstream content", { status: code });
      const response = await POST(request({ prompt: "写作" }));
      assert.equal(response.status, code === 429 ? 429 : 502);
      assert.ok(!(await response.text()).includes("secret"));
    }
    globalThis.fetch = async () => new Response("<html>bad gateway</html>");
    assert.equal((await POST(request({ prompt: "写作" }))).status, 502);
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "截断正文" }, finish_reason: "length" }] });
    assert.equal((await (await POST(request({ prompt: "写作" }))).json()).truncated, true);
    assert.equal((await POST(request({ prompt: "生成图", task: "plot_update" }))).status, 502);
  } finally { globalThis.fetch = old; }
});
test("partial search results survive a malformed source and all failures are explicit", async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => url.includes("bing") ? new Response("<rss><item><title>雾城</title><link>https://example.org/book</link><description>简介</description></item></rss>") : new Response("invalid json");
    const result = await search(request({ query: "雾城" }));
    assert.equal(result.status, 200); assert.equal((await result.json()).results[0].title, "雾城");
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal((await search(request({ query: "雾城" }))).status, 502);
  } finally { globalThis.fetch = old; }
});


test("a UI session key overrides environment credentials and is never echoed", async () => {
  const old = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "environment-test-only";
  const key = "sk-user-provided-test-key";
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.ok(!init.body.includes(key));
    return Response.json({ choices: [{ message: { content: "连接成功" }, finish_reason: "stop" }] });
  };
  try {
    const req = request({ prompt: "测试" }); req.headers.set("X-Momai-API-Key", key);
    const result = await POST(req);
    assert.equal(result.status, 200); assert.ok(!(await result.text()).includes(key));
    assert.equal((await (await GET()).json()).apiKey, undefined);
    const invalid = request({ prompt: "测试" }); invalid.headers.set("X-Momai-API-Key", "bad key");
    assert.equal((await POST(invalid)).status, 400);
  } finally { globalThis.fetch = old; delete process.env.DEEPSEEK_API_KEY; }
});

test("plot discussion uses its dedicated instructions and proposals keep structured generation", async () => {
  const old = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "test-key-only";
  let structured = false;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.messages[0].content.includes("妹妹不能死亡"));
    assert.equal(body.messages[1].content, "想要温暖的结局");
    if (structured) {
      assert.deepEqual(body.response_format, { type: "json_object" });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "用记忆换回妹妹", nodes: [{ title: "失踪", chapter: "1", note: "寻找妹妹" }, { title: "重逢", chapter: "2", note: "完成交易" }], branches: [] }) }, finish_reason: "stop" }] });
    }
    assert.ok(body.messages[0].content.includes("主线剧情共创伙伴"));
    assert.equal(body.response_format, undefined);
    return Response.json({ choices: [{ message: { content: "可以用重新建立亲情完成温暖结局。" }, finish_reason: "stop" }] });
  };
  try {
    const payload = { prompt: "继续完善", context: "妹妹不能死亡", messages: [{ role: "user", text: "想要温暖的结局" }] };
    assert.equal((await POST(request({ ...payload, task: "plot_discussion" }))).status, 200);
    structured = true;
    assert.equal((await POST(request({ ...payload, task: "plot_update" }))).status, 200);
  } finally { globalThis.fetch = old; delete process.env.DEEPSEEK_API_KEY; }
});
