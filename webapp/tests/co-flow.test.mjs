import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";

const window = new Window({ url: "http://localhost:5173" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "CustomEvent", "Event", "MouseEvent", "MutationObserver", "sessionStorage", "localStorage", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  const value = name === "window" ? window : window[name];
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? value.bind(window) : value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollIntoView = () => {};
window.confirm = () => true;

const requests = [];
let respond = () => "候选正文";
let holdResponse = false;
let failures = 0;
globalThis.fetch = async (url, init) => {
  if (url === "/api/generate" && !init) return Response.json({ configured: true, model: "deepseek-v4-flash" });
  if (url === "/api/generate") {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (holdResponse) return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
    if (failures > 0) { failures -= 1; return Response.json({ error: "模型连接或返回格式异常，请稍后再试。" }, { status: 502 }); }
    return Response.json({ content: respond(body) });
  }
  throw new Error(`Unexpected request ${url}`);
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Home } = await import("../app/page.tsx");
const { loadLibrary } = await import("../lib/local-library.ts");
const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const buttons = (label) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === label);
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
async function click(element) { assert.ok(element, "expected interactive element"); await act(async () => { element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await pause(); }); }
async function fill(element, value) { assert.ok(element, "expected editor"); await act(async () => { const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value); element.dispatchEvent(new window.Event("input", { bubbles: true })); await pause(); }); }
async function openBook(title) { await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes(title))); }
async function selectModule(label) { await click(buttons(label)[0]); }
async function typeRequest(text) { await fill(byLabel("本页生成要求"), text); }
async function generate() { await click(buttons("生成预览")[0]); }
function saved() { return loadLibrary([]); }

test("authors keep control: discuss never writes, candidates stay proposals, adoption is one snapshot", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("灵脉残卷");
  await selectModule("世界观");
  await fill(byLabel("世界观编辑器"), "灵脉会吞噬使用者的记忆。");

  // Discussion only produces advice; the manuscript stays exactly as written.
  await click(byLabel("共创助手") ? buttons("共创助手")[0] : buttons("共创助手")[0]);
  await act(async () => { const tab = [...document.querySelectorAll('.co-tabs button')].find((b) => b.textContent.includes("讨论")); await click(tab); });
  await fill(byLabel("共创讨论输入"), "这段规则会不会太模糊？");
  respond = () => "建议补充代价的三档强度。";
  await click(buttons("发送讨论")[0]);
  assert.equal(byLabel("世界观编辑器").value, "灵脉会吞噬使用者的记忆。", "discussion never overwrites the author's text");
  assert.ok(document.querySelector(".co-thread").textContent.includes("建议补充代价的三档强度"));

  // A candidate lands in the proposal tab and still does not touch the text.
  await act(async () => { await click([...document.querySelectorAll('.co-tabs button')].find((b) => b.textContent.includes("详情"))); });
  await typeRequest("把代价改得更具体");
  respond = () => "灵脉每次吞噬一段完整记忆：姓名、地点或一个人。";
  await generate();
  assert.equal(byLabel("世界观编辑器").value, "灵脉会吞噬使用者的记忆。", "generating only creates a candidate");
  assert.equal(byLabel("生成结果预览").value, "灵脉每次吞噬一段完整记忆：姓名、地点或一个人。");
  assert.equal(requests.at(-1).task, "world_design");
  assert.equal(requests.at(-1).context.includes("灵脉会吞噬使用者的记忆"), true, "the candidate request carries the current module text");

  // Adopting replaces the text once and records a restorable snapshot.
  await click(buttons("替换当前内容")[0]);
  assert.equal(byLabel("世界观编辑器").value, "灵脉每次吞噬一段完整记忆：姓名、地点或一个人。");
  assert.equal(document.querySelector(".co-proposal"), null, "an adopted candidate leaves the pending list");
  const afterAdopt = await saved();
  assert.match(afterAdopt.workspaces["spirit-scroll"].assetVersions.world[0].label, /^采纳 AI 候选稿/, "adoption keeps one restorable snapshot");
  assert.equal(afterAdopt.workspaces["spirit-scroll"].assetVersions.world[0].content, "灵脉会吞噬使用者的记忆。", "the snapshot holds the pre-adoption text");
  await click(buttons("恢复")[0]);
  assert.equal(byLabel("世界观编辑器").value, "灵脉会吞噬使用者的记忆。", "the snapshot restores the pre-adoption text");
  await act(async () => { root.unmount(); await pause(); });
});

test("edits during generation are detected instead of silently overwritten", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("灵脉残卷");
  await selectModule("人物角色");
  await fill(byLabel("人物角色编辑器"), "主角：沈砚。");
  await typeRequest("补充动机");
  respond = () => "沈砚为了找回妹妹而行医。";
  await generate();
  // The author keeps editing while the candidate waits, then adopts.
  await fill(byLabel("人物角色编辑器"), "主角：沈砚，失去左手。");
  await click(buttons("替换当前内容")[0]);
  assert.equal(byLabel("人物角色编辑器").value, "主角：沈砚，失去左手。", "a stale candidate never overwrites newer author text");
  assert.ok(document.querySelector(".co-error").textContent.includes("已被修改"));
  await click(buttons("追加到末尾")[0]);
  assert.equal(byLabel("人物角色编辑器").value.startsWith("主角：沈砚，失去左手。"), true, "append still works after a refused overwrite");
  await act(async () => { root.unmount(); await pause(); });
});

test("locking blocks adoption, failures keep the draft, and duplicate adoption is refused", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("长安无梦");
  await selectModule("文笔文风");
  await fill(byLabel("文笔文风编辑器"), "克制、短句。");
  await click(buttons("共创助手")[0]);
  await typeRequest("换成第一人称");
  failures = 1;
  respond = () => "我从不回头看。";
  await generate();
  assert.ok(document.querySelector(".co-error"), "a provider failure is reported");
  assert.equal(document.querySelector(".co-proposal"), null, "a failed request leaves no half candidate");
  assert.equal(byLabel("文笔文风编辑器").value, "克制、短句。");

  await generate();
  assert.ok(byLabel("生成结果预览"));
  await click(document.querySelector(".co-lock"));
  assert.equal(document.querySelector(".co-lock").getAttribute("aria-pressed"), "true");
  await click(buttons("替换当前内容")[0]);
  assert.equal(byLabel("文笔文风编辑器").value, "克制、短句。", "locked targets cannot be rewritten");
  assert.ok(document.querySelector(".co-warning").textContent.includes("已锁定"));
  await act(async () => { await click(document.querySelector(".co-lock")); });
  await click(buttons("替换当前内容")[0]);
  assert.equal(byLabel("文笔文风编辑器").value, "我从不回头看。");
  const second = await saved();
  assert.equal(second.workspaces["chang-an"].locks && Object.keys(second.workspaces["chang-an"].locks).length, 0, "unlocking is persisted");
  await act(async () => { root.unmount(); await pause(); });
});

test("a late response stays bound to the chapter it was generated for", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("灵脉残卷");
  await selectModule("章节正文");
  await fill(byLabel("章节正文编辑器"), "第一章原稿。");
  await typeRequest("续写第一章");
  respond = () => "第一章新增内容。";
  await generate();
  // The author switches to a second chapter before adopting: the candidate stays
  // bound to chapter one and is not offered for chapter two.
  await click(buttons("新章节")[0]);
  await fill(byLabel("章节正文编辑器"), "第二章原稿。");
  assert.equal(document.querySelector(".co-proposal"), null, "another chapter never shows this candidate");
  await act(async () => { const select = byLabel("当前章节"); select.value = (await saved()).workspaces["spirit-scroll"].chapters[0].id; select.dispatchEvent(new window.Event("change", { bubbles: true })); await pause(); });
  assert.ok(document.querySelector(".co-proposal"), "returning to its own chapter brings the candidate back");
  await click(buttons("追加到末尾")[0]);
  const stored = await saved();
  const chapters = stored.workspaces["spirit-scroll"].chapters;
  assert.equal(chapters[0].content, "第一章原稿。\n\n第一章新增内容。", "it lands in its own chapter, not the one the author switched to");
  assert.equal(chapters[1].content, "第二章原稿。");
  await act(async () => { root.unmount(); await pause(); });
});

test("roadmap candidates are validated, previewed as dashed changes and adopted as one transaction", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("长安无梦");
  await selectModule("世界线");
  await click(buttons("添加主线")[0]);
  await fill(byLabel("故事线名称"), "寻找失踪皇帝");
  await click(buttons("保存安排")[0]);
  await click(document.querySelector(".roadmap-line-heading > div button"));
  await fill(byLabel("事件标题"), "被篡改的起居注");
  await fill(byLabel("事件剧情说明"), "女史官发现一段不存在的登基记录。");
  await click(buttons("保存安排")[0]);
  const eventId = (await saved()).workspaces["chang-an"].plot.roadmap.events[0].id;

  // Clicking an event opens the target-scoped co-creation sidebar.
  await click(document.querySelector(`.roadmap-event[data-event-id="${eventId}"]`));
  assert.ok(document.querySelector(".worldline-detail"), "the detail sidebar follows the selection");
  assert.ok(document.querySelector(".co-target").textContent.includes("被篡改的起居注"));

  // A malformed instruction keeps the roadmap untouched and reports why.
  respond = () => "我觉得可以再想想。";
  await fill(byLabel("本页生成要求"), "改一下事件后果");
  await generate();
  assert.ok(document.querySelector(".co-error").textContent.includes("可解析"));
  assert.equal((await saved()).workspaces["chang-an"].plot.roadmap.events[0].note, "女史官发现一段不存在的登基记录。");

  // A valid instruction becomes a dashed candidate that only lands on adoption.
  respond = () => JSON.stringify({ ops: [{ op: "updateEvent", eventId, fields: { note: "起居注被改写了三次，每次都在掩盖同一个名字。", status: "planned" } }, { op: "updateEvent", eventId: "ghost-event", fields: { note: "越权" } }] });
  await generate();
  assert.ok(document.querySelector(".co-error").textContent.includes("不存在的事件"), "unknown ids are refused with a reason");
  respond = () => JSON.stringify({ ops: [{ op: "updateEvent", eventId, fields: { note: "起居注被改写了三次，每次都在掩盖同一个名字。" } }] });
  await generate();
  assert.equal((await saved()).workspaces["chang-an"].plot.roadmap.events[0].note, "女史官发现一段不存在的登基记录。", "candidates never touch the official roadmap before adoption");
  assert.ok(document.querySelector(".roadmap-event.has-candidate"), "the canvas marks the event a candidate would change");
  await click(buttons("采纳这些修改")[0]);
  const adopted = await saved();
  assert.equal(adopted.workspaces["chang-an"].plot.roadmap.events[0].note, "起居注被改写了三次，每次都在掩盖同一个名字。");
  assert.equal(adopted.workspaces["chang-an"].plot.roadmap.events[0].id, eventId, "adoption never renumbers stable ids");
  assert.equal(adopted.workspaces["chang-an"].plot.roadmap.events.length, 1, "no events are created or dropped");
  await act(async () => { root.unmount(); await pause(); });
});

test("cancelling a generation keeps the previous state and the panel reports it", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("第七码头");
  await selectModule("卷章大纲");
  await fill(byLabel("卷章大纲编辑器"), "第一卷：归港。");
  await typeRequest("扩展第一卷");
  holdResponse = true;
  await generate();
  assert.ok(buttons("停止生成")[0], "a running request can be cancelled");
  await click(buttons("停止生成")[0]);
  holdResponse = false;
  assert.equal(byLabel("卷章大纲编辑器").value, "第一卷：归港。");
  const stored = await saved();
  assert.equal(stored.workspaces["star-harbor"].coProposals.length, 0, "a cancelled generation leaves no candidate behind");
  await act(async () => { root.unmount(); await pause(); });
});
