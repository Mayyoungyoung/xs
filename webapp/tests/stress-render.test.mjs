import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import { buildStoryGraph, layoutStoryLanes, selectVisibleStoryGraph } from "../lib/story-graph.ts";
import { roadmapSchema } from "../lib/roadmap-schema.ts";
import { loadLibrary, saveLibrary } from "../lib/local-library.ts";
import { createBookWorkspace, mergeBookWorkspace } from "../components/novel/book-workspace.ts";

// The largest roadmap the app accepts today: 16 storylines and 80 events. The
// sample stays inside the published limits; no limit is raised for the test.
const LINE_COUNT = 16;
const EVENT_COUNT = 80;
const CHAPTER_COUNT = 20;

function maxRoadmap() {
  const lines = Array.from({ length: LINE_COUNT }, (_, index) => {
    const kind = index < 4 ? "main" : "branch";
    const eventIds = Array.from({ length: EVENT_COUNT }, (_, eventIndex) => `e${eventIndex}`).filter((_, eventIndex) => eventIndex % 5 === index % 5 || index === 0);
    // A branch must include the event it derives from, so the sample stays valid.
    if (kind === "branch" && !eventIds.includes("e0")) eventIds.unshift("e0");
    return {
      id: `line-${index}`, title: `故事线 ${index + 1}`, goal: `第 ${index + 1} 条线要达成的目标`, kind,
      color: ["#8b372f", "#346783", "#357360", "#77548c", "#966027", "#565ea1"][index % 6],
      eventIds: eventIds.slice(0, 26),
      ...(kind === "branch" ? { originId: "e0" } : {}),
    };
  });
  const events = Array.from({ length: EVENT_COUNT }, (_, index) => ({
    id: `e${index}`, title: `事件 ${index + 1}`, note: `第 ${index + 1} 个事件的说明`.repeat(3),
    order: index + 1, chapter: `${(index % CHAPTER_COUNT) + 1}`, status: index % 3 === 0 ? "done" : index % 3 === 1 ? "active" : "planned",
  }));
  return { lines, events };
}

test("the largest accepted roadmap stays inside the schema, lays out deterministically and quickly", () => {
  const roadmap = maxRoadmap();
  assert.equal(roadmapSchema.safeParse(roadmap).success, true, "16 lines and 80 events are still within the published limits");

  const chapters = Array.from({ length: CHAPTER_COUNT }, (_, index) => ({ id: `c${index + 1}`, title: `第 ${index + 1} 章`, plotEventIds: [] }));
  for (const event of roadmap.events) if (chapters[Number(event.chapter) - 1]) chapters[Number(event.chapter) - 1].plotEventIds.push(event.id);

  const started = Date.now();
  const graph = buildStoryGraph(roadmap, chapters);
  const layout = layoutStoryLanes(graph);
  const visible = selectVisibleStoryGraph(graph, layout, { lod: 1 });
  const elapsed = Date.now() - started;

  assert.equal(graph.lines.length, LINE_COUNT);
  assert.equal(graph.events.length, EVENT_COUNT);
  assert.equal(Object.keys(layout.positions).length, EVENT_COUNT);
  assert.equal(layout.zones.length, CHAPTER_COUNT, "one zone per bound chapter");
  assert.equal(visible.nodes.length, EVENT_COUNT);
  assert.ok(elapsed < 500, `layout of the largest roadmap stays fast (took ${elapsed}ms)`);
  assert.deepEqual(layout, layoutStoryLanes(buildStoryGraph(roadmap, chapters)), "layout stays deterministic at this size");

  // Geometry still holds at the cap: zones do not invert, every node is inside
  // its own zone, and cards in the same zone never share a lane in one slot.
  for (let index = 1; index < layout.zones.length; index++) {
    assert.ok(layout.zones[index].x >= layout.zones[index - 1].x + layout.zones[index - 1].width, "zones never overlap at the cap");
  }
  const zoneOf = new Map();
  for (const zone of layout.zones) for (const eventId of zone.eventIds) zoneOf.set(eventId, zone);
  for (const [eventId, position] of Object.entries(layout.positions)) {
    const zone = zoneOf.get(eventId);
    assert.ok(position.x >= zone.x && position.x + layout.cardWidth <= zone.x + zone.width, `${eventId} stays inside ${zone.id}`);
  }
  const occupancy = new Map();
  for (const zone of layout.zones) {
    for (const eventId of zone.eventIds) {
      const position = layout.positions[eventId];
      const event = graph.events.find((item) => item.id === eventId);
      const rows = event.lineIds.map((lineId) => graph.lines.findIndex((line) => line.id === lineId));
      const key = `${zone.id}:${position.x}`;
      const taken = occupancy.get(key) ?? new Set();
      for (const row of rows) {
        assert.ok(!taken.has(row), "cards sharing a slot never share a lane");
        taken.add(row);
      }
      occupancy.set(key, taken);
    }
  }
});

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

test("the canvas renders the largest roadmap in isolation within a budget", async () => {
  const book = { id: "max-book", title: "上限样例", genre: "悬疑", premise: "接近上限的剧情。", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#51476a", glyph: "上" };
  const roadmap = maxRoadmap();
  const chapters = Array.from({ length: CHAPTER_COUNT }, (_, index) => ({ id: `c${index + 1}`, title: `第 ${index + 1} 章`, content: "", updatedAt: "", plotEventIds: [] }));
  for (const event of roadmap.events) if (chapters[Number(event.chapter) - 1]) chapters[Number(event.chapter) - 1].plotEventIds.push(event.id);
  const base = createBookWorkspace(book);
  await saveLibrary({ books: [book], workspaces: { [book.id]: mergeBookWorkspace(book, { ...base, chapters, activeChapterId: "c1", plot: { ...base.plot, roadmap } }) } }, 0);

  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Home } = await import("../app/page.tsx");
  const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(Home)); await pause(); });
    await act(pause);
    const started = Date.now();
    await act(async () => {
      const card = [...document.querySelectorAll("article.book-card")].find((item) => item.textContent.includes("上限样例"));
      card.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await pause(200);
      const worldline = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "世界线");
      worldline.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await pause(1200);
    });
    await act(async () => { await pause(200); });
    const renderMs = Date.now() - started;
    console.log(`[stress] 上限样例（${LINE_COUNT} 线 / ${EVENT_COUNT} 事件 / ${CHAPTER_COUNT} 章节）隔离渲染耗时 ${renderMs}ms`);
    assert.equal(document.querySelectorAll(".roadmap-lane").length, LINE_COUNT, "every storyline gets a lane");
    assert.equal(document.querySelectorAll(".roadmap-event").length, roadmap.events.reduce((total, event) => total + roadmap.lines.filter((line) => line.eventIds.includes(event.id)).length, 0), "one card or anchor per line reference");
    assert.equal(document.querySelectorAll(".roadmap-zone").length, CHAPTER_COUNT);
    assert.ok(renderMs < 5000, `the largest roadmap renders in isolation within budget (took ${renderMs}ms)`);
    assert.ok(document.querySelector(".roadmap-next"), "the canvas still renders its summary affordances");
    const stored = await loadLibrary([book]);
    assert.equal(stored.workspaces[book.id].plot.roadmap.events.length, EVENT_COUNT, "rendering never mutates the stored roadmap");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
