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

const SAMPLE_MARK = "屋檐的水线一直没有断过";
const SAMPLE_TEXT = "雨从傍晚下到深夜，屋檐的水线一直没有断过。她把窗子推开一条缝，冷气挤进来，桌上的纸被吹到墙角。她走过去捡起来，顺手把灯调暗了一格。屋里只剩下钟摆的声音，一下，又一下。\n" +
  "第二天早上，天放晴了。她把昨晚捡回来的纸摊在桌上，一行一行地看。字迹被水汽浸得发虚，有些地方已经看不清楚。她没有再去找人问，只是把纸收进抽屉，锁上。\n" +
  "出门的时候，楼下的早点摊刚支起来。她买了一杯豆浆，站在路边喝完，然后往地铁站走。街上的人越来越多，没有人注意到她。";
const MODEL_RULE = "情绪通过动作呈现，不直接解释心情。";
const AUTHOR = "金庸";
const WORK = "天龙八部";

const runs = [];
globalThis.fetch = async (url, init) => {
  if (url === "/api/generate" && !init) return Response.json({ configured: true, model: "deepseek-v4-flash" });
  if (url === "/api/generate") {
    const body = JSON.parse(init.body);
    runs.push(body);
    const ids = [...body.prompt.matchAll(/样段〔([^〕]+)〕/g)].map((match) => match[1]);
    if (body.task === "style_profile") return Response.json({ content: JSON.stringify({ rules: [{ text: MODEL_RULE, evidenceIds: ids.slice(0, 1), scene: "daily" }, { text: "句长偏短，动作先于说明。", evidenceIds: ids.slice(1, 2) }], gaps: ["对话场景样段不足。"] }) });
    return Response.json({ content: "候选正文。" });
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
async function fill(element, value) { assert.ok(element, "expected editor"); await act(async () => { const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value); element.dispatchEvent(new window.Event("input", { bubbles: true })); await pause(); }); }
async function openBook(title) { await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes(title))); }
async function selectModule(label) { await click(buttons(label)[0]); }

test("author path: name an author, import excerpts once, extract evidence-labelled rules, and the next chapter uses that profile", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);

  await openBook("长安无梦");
  await selectModule("文笔文风");
  const styleBefore = byLabel("文笔文风编辑器").value;

  // 1. name the target author/work -> a profile card appears and becomes active
  await fill(byLabel("目标作者"), AUTHOR);
  await fill(byLabel("目标作品"), WORK);
  await click(buttons("新建文风配置")[0]);
  const card = document.querySelector(".style-profile-card");
  assert.ok(card, "a profile card appears");
  assert.ok(card.textContent.includes(AUTHOR) && card.textContent.includes(WORK), "the card is named after the target");
  assert.ok(document.querySelector(".style-profile-badge"), "the first profile becomes active without an extra apply step");

  // 2. one import action -> auto cleaned, split, tagged samples bound to this profile
  await click(buttons("导入与管理样段（可选）")[0]);
  await fill(byLabel("样段来源标题"), `《${WORK}》节选`);
  await fill(byLabel("样段文本"), SAMPLE_TEXT);
  await click(buttons("整理并加入样段库")[0]);
  const sampleList = document.querySelector(".assist-sample-list");
  assert.ok(sampleList, "the imported text becomes a sample library without per-segment forms");
  assert.ok(sampleList.textContent.includes("条件"), "samples default to the conditioning split");
  assert.equal(runs.length, 0, "no model call is made before the author asks for extraction");

  // 3. extraction receives the real excerpts and keeps evidence ids
  await click(buttons("从样段自动提取规则")[0]);
  const profileCall = runs.find((body) => body.task === "style_profile");
  assert.ok(profileCall, "the profile task is really called");
  assert.ok(profileCall.prompt.includes(SAMPLE_MARK), "the analysis task receives the real excerpt text");
  assert.ok(profileCall.prompt.includes(AUTHOR), "the target author travels into the extraction prompt");
  const ruleBoxes = [...document.querySelectorAll(".assist-rules textarea")];
  assert.ok(ruleBoxes.some((box) => box.value === MODEL_RULE), "the model rule is one of the editable rules");
  assert.ok(ruleBoxes.some((box) => box.value.includes("句子以中短句为主")), "measured rules from the excerpts are present too");
  assert.ok(document.querySelector(".assist-fidelity-panel").textContent.includes("证据："), "a cited rule shows its evidence id");

  // 4. a hand-written rule survives and the editor text stays untouched
  await click(buttons("手写一条规则")[0]);
  const boxes = [...document.querySelectorAll(".assist-rules textarea")];
  await fill(boxes.at(-1), "对话不超过三句一轮。");
  assert.equal(byLabel("文笔文风编辑器").value, styleBefore, "nothing is adopted automatically");

  // 5. the next chapter request carries the profile and matched excerpts directly
  runs.length = 0;
  await selectModule("章节正文");
  await fill(byLabel("本页生成要求"), "续写这一章");
  await click(buttons("生成预览")[0]);
  const chapterRun = runs.find((body) => body.task === "chapter_write");
  assert.ok(chapterRun, "the chapter task is really called");
  assert.ok(chapterRun.context.includes("【真实样段"), "the chapter request carries matched excerpts");
  assert.ok(chapterRun.context.includes("只提供表达参照"), "excerpts are scoped to expression only");
  assert.ok(chapterRun.context.includes(AUTHOR), "the profile names the target author");
  assert.match(chapterRun.context, /档案 v\d|第 \d 版/, "the request states the profile version");
  assert.ok(chapterRun.context.includes("对话不超过三句一轮"), "the hand-written rule travels into the request");
  assert.ok(byLabel("章节正文编辑器").value === "" || byLabel("章节正文编辑器").value === styleBefore, "the manuscript is only ever changed by adoption");

  await act(async () => root.unmount()); await window.happyDOM.abort();
});
