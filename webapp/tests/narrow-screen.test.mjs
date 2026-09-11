import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import { loadLibrary, saveLibrary } from "../lib/local-library.ts";
import { createBookWorkspace, mergeBookWorkspace } from "../components/novel/book-workspace.ts";

// A narrow window exercises the same code path a 125%/150% display scale hits:
// fewer CSS pixels available, so the layout switches to its compact branch.
const window = new Window({ url: "http://localhost:5173", width: 900, height: 700 });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "CustomEvent", "Event", "MouseEvent", "MutationObserver", "sessionStorage", "localStorage", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  const value = name === "window" ? window : window[name];
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? value.bind(window) : value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollIntoView = () => {};
Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
const mediaQueries = [];
window.matchMedia = (query) => {
  mediaQueries.push(query);
  const matches = /max-width:\s*(\d+)px/.test(query) ? 900 <= Number(RegExp.$1) : false;
  return { matches, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } };
};
globalThis.fetch = async (url, init) => {
  if (url === "/api/generate" && !init) return Response.json({ configured: false, model: "deepseek-v4-flash" });
  throw new Error(`Unexpected request ${url}`);
};

const book = { id: "narrow-book", title: "窄屏验证", genre: "悬疑", premise: "窄屏下的侧栏行为。", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#7f302a", glyph: "窄" };
const roadmap = {
  lines: [
    { id: "main-a", title: "主线", goal: "推进", kind: "main", color: "#8b372f", eventIds: ["e1"] },
    { id: "branch-a", title: "支线", goal: "衍生", kind: "branch", color: "#346783", originId: "e1", eventIds: ["e1"] },
  ],
  events: [{ id: "e1", title: "起点", note: "开始", order: 1, chapter: "1", status: "planned" }],
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Home } = await import("../app/page.tsx");
const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

test("a narrow screen keeps the single sidebar usable and does not open a second panel", async () => {
  const base = createBookWorkspace(book);
  await saveLibrary({ books: [book], workspaces: { [book.id]: mergeBookWorkspace(book, { ...base, plot: { ...base.plot, roadmap } }) } }, 0);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(Home)); await pause(); });
    await act(pause);
    await act(async () => {
      const card = [...document.querySelectorAll("article.book-card")].find((item) => item.textContent.includes("窄屏验证"));
      card.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await pause(200);
      const worldline = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "世界线");
      worldline.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await pause(300);
      document.querySelector(".roadmap-event").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await pause(300);
    });
    assert.ok(mediaQueries.some((query) => query.includes("max-width: 1180px")), "the compact branch is driven by the same query a scaled display triggers");
    assert.equal(document.querySelector(".copilot"), null, "the assistant does not open on a narrow screen");
    assert.ok(document.querySelector(".worldline-detail"), "the sidebar is still present as the compact drawer");
    assert.ok(document.querySelector('.worldline-detail [aria-label="事件标题"]'), "fields stay editable in the compact drawer");
    assert.ok(document.querySelector(".worldline-detail .co-panel"), "co-creation stays in the same drawer");
    assert.equal(document.querySelectorAll('[aria-label="事件标题"]').length, 1, "still exactly one editor");
    const stored = await loadLibrary([book]);
    assert.equal(stored.workspaces[book.id].plot.roadmap.events.length, 1, "the compact layout never mutates story data");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
