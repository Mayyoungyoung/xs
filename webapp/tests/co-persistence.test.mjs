import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { parseBackup } from "../lib/novel-data.ts";
import { createBookWorkspace, mergeBookWorkspace, storySnapshot, withSnapshot } from "../components/novel/book-workspace.ts";
import { normalizeLibrary, loadLibrary, saveLibrary } from "../lib/local-library.ts";

const book = { id: "book-co", title: "记忆交易所", genre: "悬疑", premise: "妹妹失踪后，记忆被买走", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#123456", glyph: "记" };

function thread(count, at) {
  return { key: "characters::e1", moduleId: "characters", entityId: "e1", messages: Array.from({ length: count }, (_, index) => ({ role: index % 2 ? "ai" : "user", text: `消息${index}`, at })), updatedAt: at };
}
function proposal(overrides = {}) {
  return {
    id: "p1", bookId: book.id, kind: "text", target: { moduleId: "characters", entityId: "e1" }, targetLabel: "人物角色 / 反派",
    scope: "selection", anchor: { start: 0, end: 2, text: "林晚" }, baseHash: "abc", baseRevision: 0,
    before: "林晚", after: "林晚（更冷）", threadKey: "characters::e1", createdAt: "2026-09-11T00:00:00.000Z", status: "pending", ...overrides,
  };
}

test("working state survives export, import and reload without breaking old backups", async () => {
  const first = createBookWorkspace(book);
  const workspace = mergeBookWorkspace(book, {
    ...first,
    assets: { ...first.assets, characters: "林晚：律所助理" },
    threads: { "characters::e1": thread(3, "t3") },
    coProposals: [proposal()],
    locks: { "characters::e1": ["full"] },
    view: { roadmap: { x: 120, y: 40, scale: 0.8, lod: 1 } },
  });
  const backup = { version: 3, books: [book], workspaces: { [book.id]: workspace } };
  const reloaded = normalizeLibrary(JSON.parse(JSON.stringify(backup)));
  assert.equal(reloaded.workspaces[book.id].threads["characters::e1"].messages.length, 3);
  assert.equal(reloaded.workspaces[book.id].coProposals.length, 1);
  assert.deepEqual(reloaded.workspaces[book.id].coProposals[0].anchor, { start: 0, end: 2, text: "林晚" });
  assert.deepEqual(reloaded.workspaces[book.id].locks, { "characters::e1": ["full"] });
  assert.deepEqual(reloaded.workspaces[book.id].view, { roadmap: { x: 120, y: 40, scale: 0.8, lod: 1 } });

  await saveLibrary({ books: [book], workspaces: { [book.id]: workspace } }, 0);
  const stored = await loadLibrary([book]);
  assert.equal(stored.workspaces[book.id].threads["characters::e1"].messages.length, 3);
  assert.equal(stored.workspaces[book.id].coProposals[0].after, "林晚（更冷）");

  const legacy = normalizeLibrary({ version: 2, books: [book], workspaces: { [book.id]: { assets: { chapters: "旧稿" } } } });
  assert.deepEqual(legacy.workspaces[book.id].threads, {});
  assert.deepEqual(legacy.workspaces[book.id].coProposals, []);
  assert.deepEqual(legacy.workspaces[book.id].locks, {});
  assert.deepEqual(legacy.workspaces[book.id].view, {});
  assert.equal(legacy.workspaces[book.id].chapters[0].content, "旧稿");
  assert.doesNotThrow(() => parseBackup({ version: 3, books: [book], workspaces: { [book.id]: {} } }));
});

test("malformed co-creation state is dropped instead of corrupting the book", () => {
  const parsed = parseBackup({
    version: 3, books: [book],
    workspaces: {
      [book.id]: {
        threads: { good: thread(2, "t"), bad: { messages: [{ role: "system", text: "x" }] }, worse: "nope" },
        coProposals: [proposal(), { id: "x" }, { id: "y", bookId: book.id, kind: "text", target: { moduleId: "world" }, before: "", after: "" }],
        locks: { "characters::e1": ["full", 5] },
      },
    },
  });
  const saved = mergeBookWorkspace(book, parsed.workspaces[book.id]);
  assert.equal(saved.threads.good.messages.length, 2);
  assert.equal(saved.threads.bad, undefined);
  assert.equal(saved.threads.worse, undefined);
  assert.deepEqual(saved.coProposals.map((item) => item.id), ["p1", "y"]);
  assert.deepEqual(saved.locks, { "characters::e1": ["full"] }, "non-string lock fields are dropped, valid ones survive");
  assert.deepEqual(mergeBookWorkspace(book, { locks: { t: "not-an-array", u: ["ok", ""] } }).locks, { u: ["ok"] });
  assert.deepEqual(mergeBookWorkspace(book, { view: { roadmap: { x: 10, scale: 99, lod: 7, bad: "no" } } }).view, { roadmap: { x: 10, scale: 4, lod: 2 } });
});

test("proposals and threads are bounded and scoped to their own book", () => {
  const first = createBookWorkspace(book);
  const many = Array.from({ length: 90 }, (_, index) => proposal({ id: `p${index}`, createdAt: `2026-09-11T00:00:${String(index % 60).padStart(2, "0")}.000Z` }));
  const merged = mergeBookWorkspace(book, { ...first, coProposals: many, threads: { t: thread(300, "t") } });
  assert.equal(merged.coProposals.length, 60);
  assert.equal(merged.threads.t.messages.length, 200);
  const foreign = mergeBookWorkspace(book, { ...first, coProposals: [proposal({ bookId: "another-book" })] });
  assert.deepEqual(foreign.coProposals, []);
});

test("view preferences and candidate drafts never enter content snapshots", () => {
  const first = createBookWorkspace(book);
  const workspace = mergeBookWorkspace(book, { ...first, coProposals: [proposal()], threads: { t: thread(1, "t") }, locks: { t: ["full"] }, view: { roadmap: { x: 1, y: 2, scale: 1 } } });
  const snapshot = storySnapshot(workspace);
  assert.deepEqual(Object.keys(snapshot).sort(), ["activeChapterId", "assets", "chapters", "idea", "plot", "references", "tags"]);
  const versioned = withSnapshot(workspace, "采纳前");
  assert.equal(versioned.versions[0].snapshot.coProposals, undefined);
  assert.equal(versioned.versions[0].snapshot.threads, undefined);
  assert.equal(versioned.versions[0].snapshot.view, undefined);
  assert.equal(versioned.plot.version, workspace.plot.version, "snapshots do not bump the plot revision");
});
