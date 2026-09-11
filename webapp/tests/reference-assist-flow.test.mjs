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

const MODEL_RULE = "把每段的第一句写成短句，长度不超过十二个字。";
const runs = [];
globalThis.fetch = async (url, init) => {
  if (url === "/api/references/assist") {
    const body = JSON.parse(init.body);
    const { parseReferenceBrief, buildStylePlan } = await import("../lib/reference-assist.ts");
    const brief = parseReferenceBrief(body.input, { scope: body.scope });
    const plan = buildStylePlan({ brief, evidence: [], scope: body.scope, requestId: body.requestId });
    return Response.json({ requestId: body.requestId, scope: body.scope, brief, identification: {}, badges: ["AI 初步归纳", "仍需确认"], queries: [], evidence: [], plan, search: null, model: { task: "style_reference", prompt: "请完善方案", context: "【借鉴对象】余华" } });
  }
  if (url === "/api/generate" && !init) return Response.json({ configured: true, model: "deepseek-v4-flash" });
  if (url === "/api/generate") {
    const body = JSON.parse(init.body);
    runs.push(body);
    if (body.task === "style_reference") return Response.json({ content: JSON.stringify({ directions: [{ label: "句式节奏", guidance: "短句为主，动作句连缀。" }, { label: "修饰与意象密度", guidance: "每段一个意象。" }, { label: "情绪呈现", guidance: "情绪落在动作上。" }, { label: "对话写法", guidance: "对话带停顿。" }], rules: [MODEL_RULE, "删掉程度副词。", "场景末留一个未解决的问题。", "同一段不重复信息。", "保持术语一致。"], gaps: ["模型补充：仍需原文核对。"] }) });
    return Response.json({ content: "章节候选正文" });
  }
  throw new Error(`Unexpected request ${url}`);
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Home } = await import("../app/page.tsx");
const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const buttons = (label) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === label);
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
async function click(element) { assert.ok(element, "expected interactive element"); await act(async () => { element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await pause(); }); }
async function fill(element, value) { assert.ok(element, "expected editor"); await act(async () => { const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value); element.dispatchEvent(new window.Event("input", { bubbles: true })); await pause(); }); }
async function openBook(title) { await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes(title))); }
async function selectModule(label) { await click(buttons(label)[0]); }

test("one line becomes a plan, applying it changes the book style and the next chapter request uses it", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);

  await openBook("长安无梦");
  await selectModule("文笔文风");
  const styleBefore = byLabel("文笔文风编辑器").value;
  assert.equal(document.querySelector('[role="dialog"]'), null, "the dialog starts closed");

  // 默认入口是 AI 帮我借鉴
  await click(buttons("添加")[0]);
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.ok(document.querySelector(".reference-assist"), "AI 帮我借鉴 is the default entry");
  assert.equal(document.querySelector('[aria-label="借鉴要求"]').value, "");

  await fill(byLabel("借鉴要求"), "文笔参考余华，但人物和故事保持我的。");
  await click(buttons("生成借鉴方案")[0]);
  await act(pause);

  const card = document.querySelector(".assist-plan");
  assert.ok(card, "a plan card is produced from one line");
  assert.ok(card.textContent.includes("余华"), "the identification is shown and editable");
  assert.ok(card.textContent.includes("人物和故事保持我的"), "the author's own constraint is kept");
  assert.ok(card.textContent.includes("AI 初步归纳"));
  assert.ok(document.querySelector('[aria-label="表达方向 句式节奏"]') || document.querySelector(".assist-directions"), "expression directions are editable");
  assert.ok(document.querySelectorAll(".assist-rules textarea").length >= 5, "5-10 concrete rules");

  // 未经采纳不影响正文与正式文风
  await click(buttons("完成")[0]);
  assert.equal(byLabel("文笔文风编辑器").value, styleBefore, "an unadopted plan never becomes the book style");
  await click(buttons("添加")[0]);

  // 应用前先看差异，再替换
  await click(buttons("应用为本书文风")[0]);
  assert.ok(document.querySelector(".assist-diff"), "the difference is shown before applying");
  await click(buttons("替换本书文风")[0]);
  await act(pause);
  await click(buttons("完成")[0]);

  const styleText = byLabel("文笔文风编辑器").value;
  assert.ok(styleText.startsWith("【借鉴对象】"), "the applied plan is written as the book style");
  assert.ok(styleText.includes(MODEL_RULE), "the refined rules are what got applied");

  // 下一次续写确实带上已采纳的规则
  runs.length = 0;
  await selectModule("章节正文");
  await fill(byLabel("本页生成要求"), "续写这一章");
  await click(buttons("生成预览")[0]);
  await act(pause);
  const chapterRun = runs.find((body) => body.task === "chapter_write");
  assert.ok(chapterRun, "a chapter write request was sent");
  assert.ok(chapterRun.context.includes("【本次生效文风"), "the chapter request carries the adopted style block");
  assert.ok(chapterRun.context.includes(MODEL_RULE), "the adopted rule text is really in the request");
  assert.ok(chapterRun.context.includes("只约束表达方式"), "style is scoped to wording, not to facts");
  assert.ok(!runs.some((body) => body.task === "style_reference"), "the style model call happened before, not again");

  await act(async () => root.unmount()); await window.happyDOM.abort();
});

test("locking the style target blocks applying a plan, and nothing is written", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);
  await openBook("长安无梦");
  await selectModule("文笔文风");
  const styleBefore = byLabel("文笔文风编辑器").value;

  // 锁住文笔文风目标
  await click(buttons("锁定")[0]);
  await act(pause);

  await click(buttons("添加")[0]);
  await fill(byLabel("借鉴要求"), "参考余华的文笔");
  await click(buttons("生成借鉴方案")[0]);
  await act(pause);
  await click(buttons("应用为本书文风")[0]);
  await click(buttons("替换本书文风")[0]);
  await act(pause);
  const error = document.querySelector(".reference-error");
  assert.ok(error && error.textContent.includes("锁定"), `expected a lock error, got ${error?.textContent}`);
  await click(buttons("完成")[0]);
  assert.equal(byLabel("文笔文风编辑器").value, styleBefore, "a locked target is never overwritten");

  await act(async () => root.unmount()); await window.happyDOM.abort();
});
