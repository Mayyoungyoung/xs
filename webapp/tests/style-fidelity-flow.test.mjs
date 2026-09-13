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
const MODEL_RULE_2 = "句长偏短，动作先于说明。";
const REVIEW_NOTE = "第三段仍在解释情绪，应改为动作。";

const runs = [];
let chapterWrites = 0;
globalThis.fetch = async (url, init) => {
  if (url === "/api/references/assist") {
    const body = JSON.parse(init.body);
    const { parseReferenceBrief, buildStylePlan } = await import("../lib/reference-assist.ts");
    const brief = parseReferenceBrief(body.input, { scope: body.scope });
    const plan = buildStylePlan({ brief, evidence: [], scope: body.scope, requestId: body.requestId });
    return Response.json({ requestId: body.requestId, scope: body.scope, brief, identification: {}, badges: ["AI 初步归纳"], queries: [], evidence: [], plan, search: null, model: { task: "style_reference", prompt: "完善方案", context: "【借鉴对象】余华" } });
  }
  if (url === "/api/generate" && !init) return Response.json({ configured: true, model: "deepseek-v4-flash" });
  if (url === "/api/generate") {
    const body = JSON.parse(init.body);
    runs.push(body);
    if (body.task === "style_reference") return Response.json({ content: JSON.stringify({ directions: [{ label: "句式节奏", guidance: "短句为主。" }, { label: "修饰与意象密度", guidance: "每段一个意象。" }, { label: "情绪呈现", guidance: "情绪落在动作上。" }, { label: "对话写法", guidance: "对话带停顿。" }], rules: [MODEL_RULE], gaps: [] }) });
    // The analysis tasks echo back the excerpt ids that were really sent, so the
    // citation check is exercised against real ids rather than invented ones.
    const ids = [...body.prompt.matchAll(/样段〔([^〕]+)〕/g)].map((match) => match[1]);
    if (body.task === "style_profile") return Response.json({ content: JSON.stringify({ rules: [{ text: MODEL_RULE, evidenceIds: ids.slice(0, 1), scene: "daily" }, { text: MODEL_RULE_2, evidenceIds: ids.slice(1, 2) }, { text: "没有引用的一段。", evidenceIds: [] }], gaps: ["对话场景样段不足。"] }) });
    if (body.task === "style_review") return Response.json({ content: JSON.stringify({ items: [{ location: "第三段", issue: REVIEW_NOTE, evidenceIds: ids.slice(0, 1), severity: "major" }] }) });
    chapterWrites += 1;
    return Response.json({ content: chapterWrites === 1 ? "第一稿候选正文。" : "修订后的候选正文。" });
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

test("author path: one line, import once, profile, review and revise once, apply, and the next chapter uses it", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);

  await openBook("长安无梦");
  await selectModule("文笔文风");
  const styleBefore = byLabel("文笔文风编辑器").value;
  await click(buttons("添加")[0]);
  assert.ok(document.querySelector(".reference-assist"), "the assist entry is the default");

  // 1. one natural-language line -> plan
  await fill(byLabel("借鉴要求"), "语言参考余华，但人物和故事保持我的。");
  await click(buttons("生成借鉴方案")[0]);
  assert.ok(document.querySelector(".assist-plan"), "a plan card appears");
  assert.ok(document.querySelector(".assist-fidelity-panel").textContent.includes("快速建议"), "quick mode is stated before any excerpt exists");

  // 2. one import action -> auto cleaned, split, tagged samples
  await click(buttons("导入样段增强（可选）")[0]);
  await fill(byLabel("样段来源标题"), "《活着》");
  await fill(byLabel("样段文本"), SAMPLE_TEXT);
  await click(buttons("整理并加入样段库")[0]);
  const sampleList = document.querySelector(".assist-sample-list");
  assert.ok(sampleList, "the imported text becomes a sample library without per-segment forms");
  assert.ok(sampleList.textContent.includes("条件"), "samples default to the conditioning split");
  assert.ok(document.querySelectorAll(".assist-sample-row").length >= 1);

  const profileRun = runs.filter((body) => body.task === "style_profile");
  assert.equal(profileRun.length, 0, "no analysis call before the author asks for a profile");

  // 3. profile generation receives the real excerpts and keeps evidence ids
  await click(buttons("生成 / 更新风格档案")[0]);
  const profileCall = runs.find((body) => body.task === "style_profile");
  assert.ok(profileCall, "the profile task is really called");
  assert.ok(profileCall.prompt.includes(SAMPLE_MARK), "the analysis task receives the real excerpt text");
  const ruleBoxes = [...document.querySelectorAll(".assist-rules textarea")];
  assert.ok(ruleBoxes.length >= 2, "the profile exposes a few editable rules");
  assert.ok(ruleBoxes.some((box) => box.value === MODEL_RULE), "the model rule is one of the editable rules");
  assert.ok(ruleBoxes.some((box) => box.value.includes("句子以中短句为主")), "measured rules from the excerpts are present too");
  assert.ok(document.querySelector(".assist-fidelity-panel").textContent.includes("证据："), "a cited rule shows its evidence id");

  // 4. review and at most one revision, candidate saved but never auto-adopted
  await click(buttons("复核并精修一次")[0]);
  const reviewCall = runs.find((body) => body.task === "style_review");
  assert.ok(reviewCall, "the review task is really called");
  assert.ok(reviewCall.prompt.includes(SAMPLE_MARK), "the reviewer sees the real excerpts");
  assert.ok(reviewCall.prompt.includes("第一稿候选正文"), "the reviewer sees the candidate");
  const writes = runs.filter((body) => body.task === "chapter_write");
  assert.equal(writes.length, 2, "one generation plus exactly one revision");
  assert.ok(writes[1].prompt.includes(REVIEW_NOTE), "the revision is targeted at the reported deviation");
  const stage = document.querySelector(".assist-stage");
  assert.ok(stage.textContent.includes("已完成") && stage.textContent.includes("已修订 1 次"), stage.textContent);

  await click(buttons("完成")[0]);
  assert.equal(byLabel("文笔文风编辑器").value, styleBefore, "nothing is adopted automatically");

  // 5. apply, then the next chapter request carries the profile version and excerpts
  await click(buttons("添加")[0]);
  await click(buttons("应用为本书文风")[0]);
  assert.ok(document.querySelector(".assist-diff"), "the diff is shown before applying");
  await click(buttons("替换本书文风")[0]);
  await act(pause);
  await click(buttons("完成")[0]);
  const applied = byLabel("文笔文风编辑器").value;
  assert.ok(applied.includes("【风格档案】") && applied.includes("第 1 版"), "the applied text carries the profile and version");
  assert.ok(applied.includes(MODEL_RULE));

  runs.length = 0;
  await selectModule("章节正文");
  assert.equal(byLabel("章节正文编辑器").value, "", "the manuscript is untouched by the trial run and the review");
  await fill(byLabel("本页生成要求"), "续写这一章");
  await click(buttons("生成预览")[0]);
  const chapterRun = runs.find((body) => body.task === "chapter_write");
  assert.ok(chapterRun.context.includes("【真实样段"), "the chapter request carries matched excerpts");
  assert.ok(chapterRun.context.includes("只提供表达参照"), "excerpts are scoped to expression only");
  assert.match(chapterRun.context, /档案 v1|第 1 版/, "the request states the profile version");

  await act(async () => root.unmount()); await window.happyDOM.abort();
});
