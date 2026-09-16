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

const AUTHOR = "金庸";
const DRAFT_RULE = "情绪变化优先通过动作、停顿和注意力转移呈现，减少直接使用情绪标签。";
const BOOK_RULE = "本书专属：对白不超过三句一轮，关键信息藏在潜台词里。";

const runs = [];
globalThis.fetch = async (url, init) => {
  if (url === "/api/generate" && !init) return Response.json({ configured: true, model: "deepseek-v4-flash" });
  if (url === "/api/generate") {
    const body = JSON.parse(init.body);
    runs.push(body);
    if (body.task === "style_reference") {
      return Response.json({ content: JSON.stringify({ rules: [DRAFT_RULE, "动作段落先交代动作，再表现直接后果，减少插入式解释。"], avoid: ["原作人名与情节"], gaps: ["对话场景需样段确认"] }) });
    }
    return Response.json({ content: "试写：他站在檐下没有动，雨顺着瓦当连成线。" });
  }
  throw new Error(`Unexpected request ${url}`);
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Home } = await import("../app/page.tsx");
const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const buttons = (label) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === label);
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
async function click(element) { assert.ok(element, "expected interactive element"); await act(async () => { element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await pause(); }); }
async function fill(element, value, label = "") { assert.ok(element, `expected editor ${label}`); await act(async () => { const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value); element.dispatchEvent(new window.Event("input", { bubbles: true })); await pause(); }); }
async function openBook(title) { await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes(title))); }
async function selectModule(label) { await click(buttons(label)[0]); }

test("library makes a template, the style page picks and edits it, generation uses it", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);

  await openBook("长安无梦");

  // A. name-only path: a real model call drafts a rule-bearing template
  await selectModule("借鉴库");
  await click(buttons("新建模板")[0]);
  await fill(byLabel("模板名称"), `金庸式武侠叙述`);
  assert.equal(byLabel("模板名称").value, "金庸式武侠叙述", `name fill failed; got=${byLabel("模板名称")?.value}; count=${document.querySelectorAll('[aria-label="模板名称"]').length}`);
  await fill(byLabel("参考作者或作品"), AUTHOR);
  await fill(byLabel("借鉴偏好"), "减少修饰，多一些对白。");
  assert.equal(runs.length, 0, "no model call before the author asks for a template");
  const nameValue = byLabel("模板名称")?.value;
  await click(buttons("生成模板")[0]);
  await act(pause);
  const nameInputs = [...document.querySelectorAll('input[aria-label="模板名称"]')].map((entry) => entry.value);
  assert.ok(document.querySelector(".style-template-card"), `template card missing; nameBefore=${JSON.stringify(nameValue)}; nameInputs=${JSON.stringify(nameInputs)}; runs=${JSON.stringify(runs.map((body) => body.task))}`);
  const draftCall = runs.find((body) => body.task === "style_reference");
  assert.ok(draftCall, "the draft task really ran");
  assert.ok(draftCall.prompt.includes(AUTHOR) && draftCall.prompt.includes("减少修饰"), "the target and preference travel into the prompt");
  const card = [...document.querySelectorAll(".style-template-card")].find((entry) => entry.textContent.includes("金庸式武侠叙述"));
  assert.ok(card, `the template appears in the library; cards=${[...document.querySelectorAll(".style-template-card")].map((entry) => entry.textContent.slice(0, 80)).join(" | ")}`);
  assert.ok(card.textContent.includes(DRAFT_RULE.slice(0, 20)), "the drafted rules are real, not a name card");
  assert.ok(card.textContent.includes("自定义") || card.textContent.includes(AUTHOR));
  // Saving a template never changes the book by itself.
  assert.ok(!document.querySelector(".style-template-card.is-active"), "not active until applied");

  // C. the style page selects the saved template without re-entering anything
  await selectModule("文笔文风");
  const selector = byLabel("选择文风模板");
  assert.ok(selector, "the style page offers a template selector");
  const option = [...selector.options].find((entry) => entry.textContent.includes("金庸式武侠叙述"));
  assert.ok(option, "the library template is directly selectable");
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(selector, option.value); selector.dispatchEvent(new window.Event("change", { bubbles: true })); await pause(); });
  assert.ok(document.querySelector(".style-apply-panel").textContent.includes(DRAFT_RULE.slice(0, 20)), "the applied template's rules show as the book's working copy");

  // D. a book-specific edit changes the working copy only
  await click(buttons("手写一条规则")[0]);
  await fill(byLabel("本书文风规则 2"), BOOK_RULE);
  await selectModule("借鉴库");
  const libraryCard = [...document.querySelectorAll(".style-template-card")].find((entry) => entry.textContent.includes("金庸式武侠叙述"));
  assert.ok(!libraryCard.textContent.includes(BOOK_RULE), "book edits never leak back into the library template");

  // G. the next generation request carries the final effective style
  runs.length = 0;
  await selectModule("章节正文");
  await fill(byLabel("本页生成要求"), "续写这一章");
  await click(buttons("生成预览")[0]);
  const chapterRun = runs.find((body) => body.task === "chapter_write");
  assert.ok(chapterRun, "the chapter task is really called");
  assert.ok(chapterRun.context.includes("【本书生效文风"), "the unified style block is injected");
  assert.ok(chapterRun.context.includes(DRAFT_RULE), "template rules reach the request");
  assert.ok(chapterRun.context.includes(BOOK_RULE), "book edits reach the request");
  assert.ok(chapterRun.context.includes("不得引入参考作品的人名、地名"), "reference leakage is explicitly forbidden in the request");

  // E/F. trial write previews without touching the manuscript
  runs.length = 0;
  await selectModule("文笔文风");
  await fill(byLabel("试写场景"), "雨夜的车站");
  await click(buttons("试写一段")[0]);
  const trialCall = runs.find((body) => body.task === "chapter_write");
  assert.ok(trialCall && trialCall.prompt.includes("【本书生效文风"), "the trial write uses the same effective style");
  assert.ok(document.querySelector(".assist-sample"), "the trial result is a preview");
  await selectModule("章节正文");
  assert.equal(byLabel("章节正文编辑器").value, "", "trial writing never touches the manuscript");

  await act(async () => root.unmount()); await window.happyDOM.abort();
});
