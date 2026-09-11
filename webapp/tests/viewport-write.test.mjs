import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import { loadLibrary, saveLibrary } from "../lib/local-library.ts";
import { createBookWorkspace, mergeBookWorkspace } from "../components/novel/book-workspace.ts";

const window = new Window({ url: "http://localhost:5173" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "CustomEvent", "Event", "MouseEvent", "MutationObserver", "sessionStorage", "localStorage", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  const value = name === "window" ? window : window[name];
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? value.bind(window) : value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.fetch = async (url, init) => {
  if (url === "/api/generate" && !init) return Response.json({ configured: false, model: "deepseek-v4-flash" });
  throw new Error(`Unexpected request ${url}`);
};

const book = { id: "viewport-book", title: "视口验证", genre: "悬疑", premise: "验证视口写入次数。", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#51476a", glyph: "视" };
const roadmap = {
  lines: [
    { id: "main-a", title: "主线", goal: "推进", kind: "main", color: "#8b372f", eventIds: ["e1", "e2"] },
    { id: "branch-a", title: "支线", goal: "衍生", kind: "branch", color: "#346783", originId: "e1", eventIds: ["e1", "e2"] },
  ],
  events: [
    { id: "e1", title: "起点", note: "开始", order: 1, chapter: "1", status: "planned" },
    { id: "e2", title: "转折", note: "变化", order: 2, chapter: "2", status: "planned" },
  ],
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Home } = await import("../app/page.tsx");
const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

test("scrolling the canvas writes the viewport once, not once per scroll event", async () => {
  const base = createBookWorkspace(book);
  await saveLibrary({ books: [book], workspaces: { [book.id]: mergeBookWorkspace(book, { ...base, plot: { ...base.plot, roadmap } }) } }, 0);

  // Count every library write while the test scrolls the canvas.
  const originalPut = IDBObjectStore.prototype.put;
  let writes = 0;
  IDBObjectStore.prototype.put = function (...args) { writes += 1; return originalPut.apply(this, args); };

  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(Home)); await pause(); });
    await act(pause);
    await act(async () => {
      const card = [...document.querySelectorAll("article.book-card")].find((item) => item.textContent.includes("视口验证"));
      card.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await pause(200);
      const worldline = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "世界线");
      worldline.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await pause(300);
    });
    await act(pause);
    const scroller = document.querySelector(".roadmap-scroll");
    assert.ok(scroller, "the canvas scroll container exists");
    let scrollWrites = 0;
    const before = writes;
    for (let index = 0; index < 10; index++) {
      scroller.scrollLeft = index * 20;
      scroller.scrollTop = index * 10;
      scroller.dispatchEvent(new window.Event("scroll", { bubbles: false }));
      await pause(10);
    }
    const during = writes - before;
    assert.ok(during <= 1, `ten scroll events must not produce ten saves (saw ${during})`);
    // Leaving the debounce window persists the final viewport exactly once.
    await act(async () => { await pause(700); });
    scrollWrites = writes - before;
    assert.equal(scrollWrites, 1, `the settled viewport is written exactly once (saw ${scrollWrites})`);

    const stored = await loadLibrary([book]);
    assert.equal(stored.workspaces[book.id].view.roadmap?.x, 180, "the final scroll position is what gets stored");
    assert.equal(stored.workspaces[book.id].plot.roadmap.events.length, 2, "persisting the view never touches story data");
  } finally {
    IDBObjectStore.prototype.put = originalPut;
    await act(async () => root.unmount());
    host.remove();
  }
});
