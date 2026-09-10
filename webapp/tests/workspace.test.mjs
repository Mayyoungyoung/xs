import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
let generationNumber = 0;
const prompts = [];
const sentHeaders = [];
let plotFailure = false;
let plotWait = false;
const plotResult = { summary: "主角为救妹妹追查记忆交易，最终放弃能力。", lines: [
  { id: "rescue", title: "救回妹妹", kind: "main", goal: "救人而不恢复记忆", color: "#8b372f", eventIds: ["letter", "reunion"] },
  { id: "trade", title: "追查交易", kind: "main", goal: "揭开幕后交易", color: "#346783", eventIds: ["ledger", "reunion"] },
  { id: "photo", title: "旧照片", kind: "branch", goal: "照片成为重认亲人的证据", color: "#357360", originId: "letter", eventIds: ["letter", "reunion"] },
], events: [
  { id: "letter", title: "妹妹失踪", chapter: "1", note: "主角发现记忆被交易，决定调查。", order: 1, status: "planned" },
  { id: "ledger", title: "找到秘密账本", chapter: "2", note: "调查者追踪幕后交易。", order: 2, status: "planned" },
  { id: "reunion", title: "选择遗忘", chapter: "3–5", note: "主角用自己的记忆换回妹妹，所有故事线在这里交汇。", order: 3, status: "planned" },
] };
globalThis.fetch = async (url, init) => {
  if (url === "/api/generate" && !init) return Response.json({ configured: true, model: "deepseek-v4-flash" });
  if (url === "/api/generate") {
    sentHeaders.push(init.headers); const body = JSON.parse(init.body); prompts.push(body);
    if (body.task.startsWith("plot_")) {
      if (plotWait) return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
      if (plotFailure) return Response.json({ error: "测试连接失败" }, { status: 502 });
      return Response.json({ content: body.task === "plot_update" ? JSON.stringify(plotResult) : "可以让主角在救回妹妹与保留记忆之间做出选择。你希望妹妹知道这个代价吗？" });
    }
    return Response.json({ content: `模型结果${++generationNumber}` });
  }
  throw new Error(`Unexpected request ${url}`);
};
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Home } = await import("../app/page.tsx");
const { ModelSettings } = await import("../components/novel/model-settings.tsx");
const { loadLibrary, saveLibrary } = await import("../lib/local-library.ts");
const pause = () => new Promise((resolve) => setTimeout(resolve, 35));
const buttons = (label) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === label);
async function click(element) { assert.ok(element, "expected interactive element"); await act(async () => { element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await pause(); }); }
async function fill(element, value) {
  assert.ok(element, "expected editor");
  await act(async () => {
    const prototype = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
    await pause();
  });
}

async function choose(element, value) { assert.ok(element); await act(async () => { element.value = value; element.dispatchEvent(new window.Event("change", { bubbles: true })); await pause(); }); }

test("author can edit, preview, adopt, restore, switch chapters, chat, and reload persisted work", async () => {
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);
  assert.ok(document.body.textContent.includes("我的书架"));
  assert.ok(!document.body.textContent.includes("第三章已经通过"));
  await click(document.querySelector("article.book-card"));
  await click(buttons("世界观")[0]);
  await fill(document.querySelector('[aria-label="世界观编辑器"]'), "世界规则：魔法要付出记忆");
  await act(async () => { assert.equal((await loadLibrary([])).workspaces["spirit-scroll"].assets.world, "世界规则：魔法要付出记忆"); await pause(); });
  await click(buttons("章节正文")[0]);
  await fill(document.querySelector('[aria-label="章节正文编辑器"]'), "作者原稿，主角失去左手。");
  await click(buttons("生成预览")[0]);
  assert.equal(document.querySelector('[aria-label="章节正文编辑器"]').value, "作者原稿，主角失去左手。");
  assert.equal(document.querySelector('[aria-label="生成结果预览"]').value, "模型结果1");
  assert.ok(prompts[0].context.includes("魔法要付出记忆"));
  assert.ok(prompts[0].context.includes("主角失去左手"));
  await click(buttons("世界观")[0]);
  await click(buttons("章节正文")[0]);
  assert.equal(document.querySelector('[aria-label="生成结果预览"]').value, "模型结果1");
  await click(buttons("追加到末尾")[0]);
  assert.ok(document.querySelector('[aria-label="章节正文编辑器"]').value.endsWith("模型结果1"));
  await click(buttons("恢复")[0]);
  assert.equal(document.querySelector('[aria-label="章节正文编辑器"]').value, "作者原稿，主角失去左手。");
  await click(buttons("新章节")[0]);
  assert.equal(document.querySelector('[aria-label="章节正文编辑器"]').value, "");
  await fill(document.querySelector('[aria-label="章节正文编辑器"]'), "第二章的独立内容");
  await click(buttons("共创助手")[0]);
  await fill(document.querySelector('[aria-label="给共创助手发送消息"]'), "不要让左手恢复");
  await click(document.querySelector('[aria-label="发送"]'));
  assert.ok(document.querySelector(".messages").textContent.includes("不要让左手恢复"));
  assert.ok(document.querySelector(".messages").textContent.includes("模型结果2"));
  let saved;
  await act(async () => { saved = await loadLibrary([]); await pause(); });
  assert.equal(saved.workspaces["spirit-scroll"].chapters.length, 2);
  assert.equal(saved.workspaces["spirit-scroll"].chapters[0].content, "作者原稿，主角失去左手。");
  assert.equal(saved.workspaces["spirit-scroll"].chapters[1].content, "第二章的独立内容");
  await act(async () => { root.unmount(); await pause(); });
  root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);
  await click(document.querySelector("article.book-card"));
  await click(buttons("章节正文")[0]);
  assert.equal(document.querySelector('[aria-label="章节正文编辑器"]').value, "第二章的独立内容");
  await act(async () => root.unmount());
  await window.happyDOM.abort();
});


test("empty books show zero, navigation is explicit, credentials stay out of books, and plots are editable", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/@import[^;]+;/g, "");
  document.head.append(style);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); });
  await act(pause);
  const emptyBook = [...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes("长安无梦"));
  assert.equal(emptyBook.querySelector(".book-progress em").textContent, "0%");
  assert.ok(emptyBook.textContent.includes("未开始"));
  const primaryStyle = window.getComputedStyle(buttons("创建新小说")[0]);
  assert.ok(["#fff", "rgb(255, 255, 255)"].includes(primaryStyle.color));
  assert.ok(["#8b372f", "rgb(139, 55, 47)"].includes(primaryStyle.backgroundColor));
  await click(buttons("模型设置")[0]);
  const key = "sk-session-test-only-not-a-real-key";
  const keyInput = document.querySelector('[aria-label="DeepSeek API Key"]');
  assert.equal(keyInput.type, "password");
  await fill(keyInput, key);
  await click(buttons("保存密钥")[0]);
  assert.equal(keyInput.value, "");
  assert.equal(sessionStorage.getItem("momai-deepseek-session-key"), key);
  await click(buttons("测试连接")[0]);
  assert.equal(sentHeaders.at(-1)["X-Momai-API-Key"], key);
  assert.equal(prompts.at(-1).context, undefined);
  assert.ok(document.body.textContent.includes("连接成功，可以开始创作"));
  await click(buttons("完成")[0]);
  await click(emptyBook);
  assert.ok(buttons("返回书架")[0]);
  assert.equal(document.querySelector(".current-book-heading").tagName, "DIV");
  await click(buttons("世界线")[0]);
  assert.ok(document.body.textContent.includes("先定主线"));
  await click(buttons("添加主线")[0]);
  await fill(document.querySelector('[aria-label="故事线名称"]'), "寻找失踪皇帝");
  await fill(document.querySelector('[aria-label="故事线目标"]'), "查清被篡改的登基记录");
  await click(buttons("保存安排")[0]);
  for (const [title, note] of [["被篡改的起居注", "女史官发现一段不存在的登基记录。"], ["重返皇城", "揭开身份"]]) {
    await click(document.querySelector(".roadmap-line-heading > div button"));
    await fill(document.querySelector('[aria-label="事件标题"]'), title);
    await fill(document.querySelector('[aria-label="事件剧情说明"]'), note);
    await click(buttons("保存安排")[0]);
  }
  await click(buttons("添加主线")[0]);
  await fill(document.querySelector('[aria-label="故事线名称"]'), "宫廷权力斗争");
  await click(buttons("保存安排")[0]);
  await click(document.querySelectorAll(".roadmap-line-heading")[1].querySelectorAll(":scope > div > button")[1]);
  const join = document.querySelector('[aria-label="交汇事件"]');
  await choose(join, join.options[2].value);
  await click(buttons("建立交汇")[0]);
  await click(buttons("衍生支线")[0]);
  await fill(document.querySelector('[aria-label="故事线名称"]'), "私印的来历");
  await fill(document.querySelector('[aria-label="故事线目标"]'), "发现私印，揭开身份");
  await click(buttons("保存安排")[0]);
  assert.equal(document.querySelectorAll(".roadmap-lane").length, 3);
  assert.equal(document.querySelectorAll(".roadmap-event.is-shared").length, 4);
  assert.ok(document.querySelector(".roadmap-workbench").textContent.includes("发现私印"));
  await click(buttons("返回书架")[0]);
  assert.ok(document.body.textContent.includes("我的书架"));
  await act(async () => { const saved = await loadLibrary([]); assert.ok(!JSON.stringify(saved).includes(key)); assert.equal(saved.workspaces["chang-an"].plot.roadmap.lines.length, 3); assert.equal(saved.workspaces["chang-an"].plot.roadmap.events.length, 2); await pause(); });
  await click(buttons("模型设置")[0]);
  await click(buttons("清除密钥")[0]);
  assert.equal(sessionStorage.getItem("momai-deepseek-session-key"), null);
  await act(async () => { root.unmount(); await pause(); });
  style.remove();
  await window.happyDOM.abort();
});

test("plot coauthor keeps book-specific discussion, previews and edits before adoption, and preserves failed work", async () => {
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const openBook = async (title) => { await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes(title))); await click(buttons("世界线")[0]); await click(document.getElementById("worldline-tab-discussion")); };
  const draft = () => document.querySelector('[aria-label="主线讨论输入"]');
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("长安无梦");
  await fill(draft(), "主角救妹妹时会失去记忆，不要让妹妹死亡");
  await click(buttons("发送讨论")[0]);
  assert.equal(prompts.at(-1).task, "plot_discussion");
  assert.deepEqual(prompts.at(-1).messages, []);
  assert.ok(document.querySelector('[aria-label="主线讨论记录"]').textContent.includes("救回妹妹与保留记忆"));
  assert.equal(draft().value, "");
  await fill(draft(), "妹妹应该知道代价，但结局要温暖");
  await click(buttons("生成主线方案")[0]);
  assert.equal(prompts.at(-1).task, "plot_update");
  assert.ok(prompts.at(-1).messages[0].text.includes("不要让妹妹死亡"));
  assert.ok(prompts.at(-1).prompt.includes("结局要温暖"));
  assert.ok(document.querySelector('[aria-label="主线方案预览"]'));
  assert.equal(document.querySelectorAll(".roadmap-event").length, 0, "discussion view does not mix in the graph");
  await act(async () => { assert.equal((await loadLibrary([])).workspaces["chang-an"].plot.roadmap.events.length, 2, "preview must not replace current graph"); await pause(); });
  await fill(document.querySelector('[aria-label="方案节点 1 标题"]'), "");
  await act(async () => { assert.equal((await loadLibrary([])).workspaces["chang-an"].plot.proposal.roadmap.events[0].title, ""); await pause(); });
  await click(buttons("采纳并更新剧情图")[0]);
  assert.ok(document.body.textContent.includes("请补全故事线"));
  await fill(document.querySelector('[aria-label="方案节点 1 标题"]'), "失踪前的最后一封信");
  await fill(draft(), "保留这封信作为关键伏笔");
  await click(buttons("返回书架")[0]);
  await openBook("灵脉残卷");
  assert.equal(document.querySelector('[aria-label="主线讨论记录"]'), null);
  assert.equal(document.querySelector('[aria-label="主线方案预览"]'), null);
  await click(buttons("返回书架")[0]);
  await act(async () => { root.unmount(); await pause(); }); root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await openBook("长安无梦");
  assert.equal(draft().value, "保留这封信作为关键伏笔");
  assert.equal(document.querySelector('[aria-label="方案节点 1 标题"]').value, "失踪前的最后一封信");
  const historyLength = document.querySelectorAll(".copilot-message").length;
  plotFailure = true;
  await click(buttons("按讨论更新方案")[0]);
  assert.ok(document.querySelector(".plot-copilot").textContent.includes("测试连接失败"));
  assert.equal(draft().value, "保留这封信作为关键伏笔");
  assert.equal(document.querySelectorAll(".copilot-message").length, historyLength);
  assert.equal(document.querySelector('[aria-label="方案节点 1 标题"]').value, "失踪前的最后一封信");
  plotFailure = false; plotWait = true;
  await click(buttons("发送讨论")[0]);
  assert.ok(buttons("正在思考…")[0].disabled);
  await click([...document.querySelector(".plot-copilot").querySelectorAll("button")].find((button) => button.textContent.trim() === "停止生成"));
  assert.equal(draft().value, "保留这封信作为关键伏笔");
  assert.ok(document.querySelector(".plot-copilot").textContent.includes("生成已停止"));
  plotWait = false;
  await click(buttons("发送讨论")[0]);
  assert.ok(prompts.at(-1).context.includes("失踪前的最后一封信"), "discussion sees author-edited pending proposal");
  assert.equal(document.querySelectorAll(".copilot-message").length, historyLength + 2);
  await click(buttons("采纳并更新剧情图")[0]);
  assert.equal(document.querySelector('[aria-label="主线方案预览"]'), null);
  assert.equal(document.querySelectorAll(".roadmap-event").length, 6);
  assert.ok(document.querySelector(".roadmap-event").textContent.includes("失踪前的最后一封信"));
  await act(async () => { const w = (await loadLibrary([])).workspaces["chang-an"]; assert.equal(w.plot.roadmap.events.length, 3); assert.equal(w.versions[0].snapshot.plot.roadmap.events.length, 2); assert.equal(w.plot.roadmap.lines[2].originId, "letter"); await pause(); });
  await act(async () => root.unmount()); await window.happyDOM.abort();
});

test("module navigation renders only the selected workspace and preserves unified worldline content", async () => {
  const previous = await loadLibrary([]);
  previous.workspaces["chang-an"].assets.timeline = "旧世界线：十年前妹妹出生；今年主角追查记忆交易。";
  await saveLibrary(previous, previous.revision);
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const moduleButton = (label) => [...document.querySelectorAll('[aria-label="小说模块"] button')].find((button) => button.textContent.trim() === label);
  const select = async (label) => { await click(moduleButton(label)); assert.equal(document.querySelectorAll(".canvas h1").length, 1); assert.equal(document.querySelector(".canvas h1").textContent, label); assert.equal(moduleButton(label).getAttribute("aria-current"), "page"); };
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes("长安无梦")));
  assert.equal(moduleButton("主线与支线"), undefined);
  assert.equal(document.querySelectorAll('[aria-label="小说模块"] button').length, 8);
  assert.equal(document.querySelector(".copilot"), null, "general assistant is opt-in");
  assert.equal(document.querySelector(".blueprint-grid"), null);
  assert.equal(document.querySelector(".roadmap-workbench"), null);
  assert.equal(buttons("生成卷章大纲").length, 0);
  const seed = document.querySelector('[aria-label="故事创意"]').value;
  await click(buttons("让 AI 完善")[0]);
  assert.equal(document.querySelector('[aria-label="故事创意"]').value, seed, "blueprint generation previews before replacing");
  assert.ok(document.querySelector('[aria-label="故事构想预览"]'));
  assert.equal(document.querySelector(".copilot"), null, "generation does not open another panel");
  await select("世界观");
  assert.equal(document.querySelector('[aria-label="故事创意"]'), null);
  assert.equal(buttons("生成预览").length, 1, "one generation action per editor");
  for (const label of ["人物角色", "文笔文风", "卷章大纲", "章节正文", "借鉴库"]) {
    await select(label);
    assert.equal(document.querySelector(".worldline-workbench"), null);
  }
  assert.equal(document.querySelector('[role="dialog"]'), null, "reference library is its own workspace");
  await select("世界线");
  assert.equal(document.querySelectorAll('.worldline-workbench [role="tabpanel"]').length, 1);
  assert.ok(document.querySelector(".roadmap-event").textContent.includes("失踪前的最后一封信"));
  assert.equal(document.querySelector(".plot-copilot"), null);
  assert.equal(document.getElementById("worldline-tab-chronology"), null);
  assert.equal(document.querySelectorAll(".canvas h1").length, 1);
  assert.ok(document.querySelector(".roadmap-workbench"));
  await fill(document.querySelector('[aria-label="原有剧情笔记"]'), "旧世界线：十年前妹妹出生；今年主角追查记忆交易。");
  await click(document.getElementById("worldline-tab-discussion"));
  assert.ok(document.querySelector('[aria-label="原有剧情笔记"]'));
  assert.ok(document.querySelector('[aria-label="主线讨论记录"]').textContent.includes("不要让妹妹死亡"));
  assert.equal(document.querySelector(".copilot"), null, "worldline never shows two assistants");
  await select("故事蓝图");
  assert.ok(document.querySelector('[aria-label="故事构想预览"]'));
  assert.equal(document.querySelector(".worldline-workbench"), null);
  await select("世界线");
  assert.equal(document.getElementById("worldline-tab-chronology"), null);
  assert.ok(document.querySelector('[aria-label="原有剧情笔记"]').value.includes("旧世界线"));
  await act(async () => { root.unmount(); await pause(); }); root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes("长安无梦")));
  await select("世界线");
  assert.equal(document.querySelectorAll(".roadmap-event").length, 6);
  assert.equal(document.getElementById("worldline-tab-chronology"), null);
  assert.ok(document.querySelector('[aria-label="原有剧情笔记"]').value.includes("旧世界线"));
  await act(async () => root.unmount()); await window.happyDOM.abort();
});

test("chapter generation follows bound events and only author confirmation advances shared storylines", async () => {
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes("长安无梦")));
  await click(buttons("章节正文")[0]);
  const guidance = () => document.querySelector('[aria-label="本章剧情安排"]');
  assert.ok(guidance().textContent.includes("失踪前的最后一封信"));
  assert.ok(!document.querySelector(".chapter-route-targets").textContent.includes("选择遗忘"));
  assert.ok(buttons("确认本章事件已写完")[0].disabled);
  await click(buttons("生成预览")[0]);
  const targetContext = prompts.at(-1).context.split("【本章推进目标")[1].split("【故事线关系】")[0];
  assert.ok(targetContext.includes("失踪前的最后一封信"));
  assert.ok(!targetContext.includes("选择遗忘"));
  await act(async () => { const w = (await loadLibrary([])).workspaces["chang-an"]; assert.deepEqual(w.chapters[0].plotEventIds, ["letter"]); assert.equal(w.plot.roadmap.events.find((event) => event.id === "letter").status, "planned"); await pause(); });
  await click(buttons("替换当前内容")[0]);
  assert.ok(!buttons("确认本章事件已写完")[0].disabled);
  await click(buttons("确认本章事件已写完")[0]);
  assert.ok(buttons("确认本章事件已写完")[0].disabled);
  await click(buttons("世界线")[0]);
  assert.equal(document.querySelectorAll('.roadmap-event[data-event-id="letter"].status-done').length, 2, "completion is shared by mainline and branch");
  await click(buttons("章节正文")[0]);
  await click(buttons("新章节")[0]);
  assert.ok(document.querySelector(".chapter-route-targets").textContent.includes("找到秘密账本"));
  await click(buttons("生成预览")[0]);
  const secondContext = prompts.at(-1).context.split("【本章推进目标")[1].split("【故事线关系】")[0];
  assert.ok(secondContext.includes("找到秘密账本")); assert.ok(!secondContext.includes("选择遗忘"));
  await click(buttons("世界线")[0]);
  await click(document.querySelector('.roadmap-event[data-event-id="ledger"]'));
  await click(buttons("从本线移除")[0]);
  assert.ok(document.querySelector('[aria-label="故事线编辑"]').textContent.includes("已安排到章节"));
  await click(document.querySelector('[aria-label="关闭故事线编辑"]'));
  await act(async () => { root.unmount(); await pause(); }); root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes("长安无梦")));
  await click(buttons("章节正文")[0]);
  assert.ok(document.querySelector(".chapter-route-targets").textContent.includes("找到秘密账本"));
  assert.ok(guidance().textContent.includes("已指定事件"));
  await act(async () => root.unmount()); await window.happyDOM.abort();
});

test("roadmap supports zoom, fit, expanded view and persisted book-specific scale", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(createElement(Home)); await pause(); }); await act(pause);
  await click([...document.querySelectorAll("article.book-card")].find((card) => card.textContent.includes("长安无梦")));
  await click(buttons("世界线")[0]);
  await click(document.querySelector('[aria-label="放大路线图"]'));
  assert.equal(document.querySelector('[aria-label="路线图恢复原始比例"]').textContent, "110%");
  assert.ok(document.querySelector('.roadmap-map').style.transform.includes("1.1"));
  await click(buttons("展开大图")[0]); assert.ok(document.querySelector(".roadmap-stage.is-expanded"));
  await click(buttons("退出大图")[0]); assert.equal(document.querySelector(".roadmap-stage.is-expanded"), null);
  await click(buttons("适应宽度")[0]);
  assert.ok(parseInt(document.querySelector('[aria-label="路线图恢复原始比例"]').textContent) < 100);
  await click(document.querySelector('[aria-label="路线图恢复原始比例"]'));
  assert.equal(document.querySelector('[aria-label="路线图恢复原始比例"]').textContent, "100%");
  await act(async () => { assert.equal((await loadLibrary([])).workspaces["chang-an"].plot.zoom, 1); await pause(); root.unmount(); }); await window.happyDOM.abort();
});

test("desktop settings select and migrate storage, report cancellation and preserve path on failure", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let outcome = null; let opened = false;
  window.momaiDesktop = {
    info: async () => ({ dataPath: "C:\\旧资料" }),
    openDataFolder: async () => { opened = true; },
    changeDataFolder: async () => { if (outcome instanceof Error) throw outcome; return outcome; },
  };
  try {
    await act(async () => { root.render(createElement(ModelSettings, { open: true, onOpenChange: () => {}, model: "deepseek-v4-flash", onModelChange: () => {}, hasSessionKey: false, connection: "未配置", onSaveKey: () => {}, onTest: async () => {} })); await pause(); });
    await act(pause);
    assert.ok(document.body.textContent.includes("C:\\旧资料"));
    await click(buttons("更改位置并迁移")[0]);
    assert.ok(!document.body.textContent.includes("资料已迁移"));
    outcome = new Error("目标文件夹不是空的");
    await click(buttons("更改位置并迁移")[0]);
    assert.ok(document.body.textContent.includes("目标文件夹不是空的"));
    assert.ok(document.body.textContent.includes("C:\\旧资料"));
    outcome = { dataPath: "D:\\小说资料", previousPath: "C:\\旧资料" };
    await click(buttons("更改位置并迁移")[0]);
    assert.ok(document.body.textContent.includes("D:\\小说资料"));
    assert.ok(document.body.textContent.includes("资料已迁移"));
    await click(buttons("打开数据文件夹")[0]); assert.equal(opened, true);
  } finally { await act(async () => root.unmount()); host.remove(); delete window.momaiDesktop; }
});
