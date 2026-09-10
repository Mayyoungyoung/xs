import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { parseBackup, parseGeneratedPlot, wordCount } from "../lib/novel-data.ts";
import { createBookWorkspace, mergeBookWorkspace, changeAsset, withSnapshot, buildStoryContext, preparation } from "../components/novel/book-workspace.ts";
import { loadLibrary, saveLibrary, normalizeLibrary } from "../lib/local-library.ts";

const book = { id: "book-one", title: "雾城", genre: "悬疑", premise: "所有人忘记同一天", chapters: 0, words: 0, progress: 0, updatedAt: "", accent: "#123456", glyph: "雾" };
test("legacy chapter migration preserves manuscript and supports backup round trip", () => {
  const legacy = { books: [book], version: 2, workspaces: { [book.id]: { assets: { chapters: "旧稿不能丢失" } } } };
  const normalized = normalizeLibrary(legacy);
  assert.equal(normalized.workspaces[book.id].chapters[0].content, "旧稿不能丢失");
  assert.deepEqual(normalizeLibrary(JSON.parse(JSON.stringify({ ...normalized, version: 3 }))), normalized);
});
test("malformed and conflicting backups fail before mutation", () => {
  for (const input of [null, { books: [{ id: "a", title: 5 }] }, { books: [book, book] }, { version: 99, books: [book] }, { books: [book], workspaces: { other: {} } }]) assert.throws(() => parseBackup(input));
  assert.throws(() => parseBackup({ books: [book], workspaces: { [book.id]: { references: [{ id: "r", title: "r", kind: "r", summary: "", source: "", scope: "plot", url: "javascript:alert(1)" }] } } }));
});
test("replacement and restore preserve the previous chapter without altering another book", () => {
  const original = createBookWorkspace(book);
  const second = createBookWorkspace({ ...book, id: "book-two" });
  const edited = changeAsset(original, "chapters", "作者原稿");
  const replaced = changeAsset(edited, "chapters", "AI新版", true);
  assert.equal(replaced.assetVersions["chapter:chapter-1"][0].content, "作者原稿");
  const restored = changeAsset(replaced, "chapters", replaced.assetVersions["chapter:chapter-1"][0].content, true);
  assert.equal(restored.chapters[0].content, "作者原稿");
  assert.equal(restored.assetVersions["chapter:chapter-1"][0].content, "AI新版");
  assert.equal(second.chapters[0].content, ""); assert.equal(original.chapters[0].content, "");
});
test("full snapshot holds independent setting, chapter and plot data", () => {
  const workspace = changeAsset(createBookWorkspace(book), "chapters", "原稿");
  const snap = withSnapshot(workspace, "保存");
  workspace.chapters[0].content = "后续修改";
  assert.equal(snap.versions[0].snapshot.chapters[0].content, "原稿");
  assert.equal(snap.versions[0].snapshot.plot.version, 1);
});
test("context includes author constraints, settings, active manuscript and previous chapters", () => {
  const w = mergeBookWorkspace(book, { assets: { world: "魔法必须付出记忆", characters: "主角不能说谎", style: "第三人称" }, tags: ["无系统"], chapters: [{ id: "c1", title: "开端", content: "上章失去左手", updatedAt: "" }, { id: "c2", title: "转折", content: "正在调查失踪者", updatedAt: "" }], activeChapterId: "c2" });
  const context = buildStoryContext(book, w, "chapters");
  for (const fragment of ["无系统", "魔法必须付出记忆", "主角不能说谎", "第三人称", "上章失去左手", "正在调查失踪者"]) assert.ok(context.includes(fragment));
});
test("plot nodes and connections are built from model data, invalid references are rejected", () => {
  const result = { summary: "记忆失窃案", nodes: [{ title: "雾起", chapter: "1", note: "调查开始" }, { title: "归来", chapter: "2", note: "揭露真相" }], branches: [{ title: "失踪者", from: 0, to: 1, setup: "照片", payoff: "见面" }] };
  const plot = parseGeneratedPlot("```json\n" + JSON.stringify(result) + "\n```");
  assert.equal(plot.branches[0].title, "失踪者"); assert.equal(plot.nodes[1].title, "归来");
  assert.match(plot.branches[0].path, /M95 244/);
  assert.throws(() => parseGeneratedPlot(JSON.stringify({ ...result, branches: [{ ...result.branches[0], to: 5 }] })));
  assert.throws(() => parseGeneratedPlot("自由文本不是情节图"));
});
test("word count excludes punctuation and treats English words as words", () => assert.equal(wordCount("你好，世界！ Hello world 123"), 7));
test("IndexedDB saves atomically, survives reload and rejects stale tabs", async () => {
  const local = new Map(); globalThis.localStorage = { getItem: (k) => local.get(k) ?? null };
  const original = await loadLibrary([book]);
  const revision = await saveLibrary(original, original.revision);
  const loaded = await loadLibrary([]);
  assert.equal(loaded.revision, revision); assert.equal(loaded.books[0].title, book.title);
  const next = { books: loaded.books, workspaces: { ...loaded.workspaces, [book.id]: changeAsset(loaded.workspaces[book.id], "chapters", "持久化正文") } };
  await saveLibrary(next, revision);
  await assert.rejects(saveLibrary(original, revision), /另一个页面/);
  const after = await loadLibrary([]);
  assert.equal(after.workspaces[book.id].chapters[0].content, "持久化正文");
});


test("a seed and default template never count as completed creative work", () => {
  const empty = createBookWorkspace(book);
  assert.equal(preparation(empty).percent, 0);
  empty.assets.world = "   ";
  assert.equal(preparation(empty).percent, 0);
  empty.assets.world = "力量以记忆为代价";
  assert.equal(preparation(empty).completed, 1);
  assert.equal(preparation(empty).percent, 17);
  empty.assets.timeline = "前史";
  const before = preparation(empty).completed;
  empty.plot.nodes = [{ title: "开端", chapter: "1", note: "" }, { title: "结局", chapter: "2", note: "" }];
  assert.equal(preparation(empty).completed, before, "worldline and plot count as one module");
});
