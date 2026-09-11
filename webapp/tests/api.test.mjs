import test from "node:test";
import assert from "node:assert/strict";
import { POST, GET } from "../app/api/generate/route.ts";
import { POST as search } from "../app/api/references/search/route.ts";

function request(data) { return new Request("http://localhost/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); }
test("bad requests are 400, including null and wrong field types", async () => {
  for (const value of [null, [], { prompt: 7 }, { prompt: "ok", references: {} }, { prompt: "ok", model: "bad model!" }, { prompt: "ok", task: "constructor" }, { prompt: "ok", provider: "not-a-vendor" }]) assert.equal((await POST(request(value))).status, 400);
  assert.equal((await search(request({ query: 42 }))).status, 400);
});
test("missing and placeholder keys are disclosed honestly without returning secrets", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  assert.equal((await GET()).status, 200); assert.equal((await (await GET()).json()).configured, false);
  assert.equal((await POST(request({ prompt: "写作" }))).status, 503);
  process.env.DEEPSEEK_API_KEY = "replace_with_your_key";
  assert.equal((await POST(request({ prompt: "写作" }))).status, 503);
});
test("a server key for one vendor is not silently reused for another", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key-only";
  try {
    const response = await POST(request({ prompt: "写作", provider: "anthropic", model: "claude-sonnet-4-5" }));
    assert.equal(response.status, 503);
    assert.ok((await response.json()).error.includes("Anthropic"));
  } finally { delete process.env.DEEPSEEK_API_KEY; }
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
test("each provider adapter speaks its own protocol and parses its own responses", async () => {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const last = calls.at(-1);
    if (last.url.includes("anthropic.com")) return Response.json({ content: [{ type: "text", text: "克劳德正文" }, { type: "text", text: "（续）" }], stop_reason: "max_tokens" });
    if (last.url.includes("generativelanguage")) return Response.json({ candidates: [{ content: { parts: [{ text: "双子正文" }] }, finishReason: "STOP" }] });
    if (last.url.includes("moonshot") && last.body.response_format) return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "用记忆换回妹妹", nodes: [{ title: "失踪", chapter: "1", note: "寻找妹妹" }, { title: "重逢", chapter: "2", note: "完成交易" }], branches: [] }) }, finish_reason: "stop" }] });
    return Response.json({ choices: [{ message: { content: "兼容正文" }, finish_reason: "stop" }] });
  };
  try {
    const key = "sk-multi-test-only";
    const withKey = (data) => { const req = request(data); req.headers.set("X-Momai-API-Key", key); return req; };

    let result = await POST(withKey({ prompt: "写", provider: "anthropic", model: "claude-sonnet-4-5", messages: [{ role: "user", text: "保留秘密" }, { role: "user", text: "再次强调" }] }));
    assert.equal(result.status, 200);
    const anthropicPayload = await result.json();
    assert.equal(anthropicPayload.content, "克劳德正文（续）");
    assert.equal(anthropicPayload.truncated, true);
    const anthropic = calls.at(-1);
    assert.ok(anthropic.url.endsWith("/v1/messages"));
    assert.equal(anthropic.headers["x-api-key"], key);
    assert.equal(anthropic.headers["anthropic-version"], "2023-06-01");
    assert.ok(anthropic.body.system.includes("当前小说上下文"));
    assert.equal(anthropic.body.max_tokens, 12000);
    assert.deepEqual(anthropic.body.messages.map((m) => m.role), ["user"], "consecutive turns are merged and prompts stay chronological");
    assert.deepEqual(anthropic.body.messages[0].content.split("\n\n"), ["保留秘密", "再次强调", "写"], "same-role turns are concatenated, not reordered");

    result = await POST(withKey({ prompt: "写", provider: "gemini", model: "gemini-2.5-flash", messages: [{ role: "ai", text: "先说结论" }] }));
    assert.equal((await result.json()).content, "双子正文");
    const gemini = calls.at(-1);
    assert.ok(gemini.url.includes("/v1beta/models/gemini-2.5-flash:generateContent"));
    assert.equal(gemini.headers["x-goog-api-key"], key);
    assert.ok(gemini.body.systemInstruction.parts[0].text.length > 0);
    assert.equal(gemini.body.contents[0].role, "user", "a leading assistant turn gets a user preamble");
    assert.equal(gemini.body.contents[1].role, "model");

    result = await POST(withKey({ prompt: "写", provider: "openai", model: "gpt-5-mini" }));
    assert.equal((await result.json()).content, "兼容正文");
    const reasoning = calls.at(-1);
    assert.ok(reasoning.url.startsWith("https://api.openai.com/v1/chat/completions"));
    assert.equal(reasoning.body.max_completion_tokens, 12000);
    assert.equal(reasoning.body.temperature, undefined);
    assert.equal(reasoning.body.thinking, undefined);

    result = await POST(withKey({ prompt: "写", provider: "moonshot", model: "kimi-k2-turbo-preview", task: "plot_update" }));
    assert.equal(result.status, 200);
    assert.deepEqual(calls.at(-1).body.response_format, { type: "json_object" });
  } finally { globalThis.fetch = old; }
});
test("custom endpoints stay loopback-or-https and known providers ignore baseUrl overrides", async () => {
  const old = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }); };
  const withKey = (data) => { const req = request(data); req.headers.set("X-Momai-API-Key", "sk-custom-test-only"); return req; };
  try {
    let result = await POST(withKey({ prompt: "写", provider: "custom", model: "local-novel", baseUrl: "http://127.0.0.1:11434/v1" }));
    assert.equal(result.status, 200);
    assert.equal(seen.at(-1), "http://127.0.0.1:11434/v1/chat/completions");

    assert.equal((await POST(withKey({ prompt: "写", provider: "custom", model: "x", baseUrl: "http://192.168.1.5:8000/v1" }))).status, 400);
    assert.equal((await POST(withKey({ prompt: "写", provider: "custom", model: "x", baseUrl: "https://169.254.169.254/latest/meta-data" }))).status, 400);
    assert.equal((await POST(withKey({ prompt: "写", provider: "custom", model: "x" }))).status, 400);

    await POST(withKey({ prompt: "写", provider: "deepseek", model: "deepseek-chat", baseUrl: "https://evil.example.com/v1" }));
    assert.equal(seen.at(-1), "https://api.deepseek.com/chat/completions", "known providers cannot be redirected");
  } finally { globalThis.fetch = old; }
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

test("the configured vendor is reported without exposing its key", async () => {
  const previous = { a: process.env.ANTHROPIC_API_KEY, m: process.env.MOMAI_PROVIDER, d: process.env.DEEPSEEK_API_KEY };
  try {
    process.env.ANTHROPIC_API_KEY = "sk-ant-server-test-only";
    process.env.MOMAI_PROVIDER = "anthropic";
    delete process.env.DEEPSEEK_API_KEY;
    const info = await (await GET()).json();
    assert.equal(info.provider, "anthropic");
    assert.equal(info.model, "claude-sonnet-4-5");
    assert.equal(info.configured, true);
    assert.ok(!JSON.stringify(info).includes("sk-ant-server-test-only"));
  } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
