import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DesktopStore } from "../desktop/store.ts";

const library = { books: [{ id: "local", title: "本地小说" }], workspaces: { local: { assets: { world: "保存到软件自己的目录" } } } };
async function temporary(t) { const directory = await mkdtemp(path.join(tmpdir(), "momai-test-")); t.after(async () => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith("momai-test-")); await rm(directory, { recursive: true, force: true }); }); return directory; }
test("desktop library persists across restarts with atomic revisions and independent backups", async (t) => {
  const directory = await temporary(t);
  const first = new DesktopStore(directory);
  assert.equal(await first.read(), null);
  assert.equal(await first.save(library, 0), 1);
  const restarted = new DesktopStore(directory);
  assert.equal((await restarted.read()).workspaces.local.assets.world, "保存到软件自己的目录");
  const updated = structuredClone(library); updated.workspaces.local.assets.world = "后续修改";
  const outcomes = await Promise.allSettled([restarted.save(updated, 1), restarted.save(library, 1)]);
  assert.equal(outcomes[0].status, "fulfilled"); assert.equal(outcomes[1].status, "rejected");
  const backup = (await readdir(path.join(directory, "backups")))[0];
  assert.equal(JSON.parse(await readFile(path.join(directory, "backups", backup), "utf8")).workspaces.local.assets.world, "保存到软件自己的目录");
  await restarted.saveKey(new Uint8Array([7, 2, 8, 3]));
  await restarted.savePreferences({ provider: "anthropic", model: "claude-sonnet-4-5" });
  assert.deepEqual(await new DesktopStore(directory).readPreferences(), { provider: "anthropic", model: "claude-sonnet-4-5" });
  await restarted.savePreferences({ provider: "custom", model: "local-novel", baseUrl: "http://127.0.0.1:11434/v1" });
  assert.deepEqual(await new DesktopStore(directory).readPreferences(), { provider: "custom", model: "local-novel", baseUrl: "http://127.0.0.1:11434/v1" });
  await assert.rejects(restarted.savePreferences({ provider: "unknown-vendor", model: "x" }), /供应商/);
  await assert.rejects(restarted.savePreferences({ provider: "deepseek", model: "bad model!" }), /模型名称/);
  await assert.rejects(restarted.savePreferences({ provider: "custom", model: "x", baseUrl: "http://192.168.1.5/v1" }), /接口地址/);
  assert.deepEqual(await new DesktopStore(directory).readPreferences(), { provider: "custom", model: "local-novel", baseUrl: "http://127.0.0.1:11434/v1" });
  await writeFile(path.join(directory, "preferences.json"), JSON.stringify({ model: "deepseek-v4-pro" }));
  assert.deepEqual(await new DesktopStore(directory).readPreferences(), { provider: "deepseek", model: "deepseek-v4-pro" });
  assert.ok(!(await readFile(restarted.libraryPath, "utf8")).includes("credentials"));
});
test("desktop invalid and corrupt files are never overwritten by a fallback library", async (t) => {
  const directory = await temporary(t); const store = new DesktopStore(directory);
  await store.save(library, 0);
  await assert.rejects(store.save({ books: [{ title: 7 }] }, 1));
  assert.equal((await store.read()).books[0].title, "本地小说");
  await writeFile(store.libraryPath, "damaged original data");
  await assert.rejects(store.read()); await assert.rejects(store.save(library, 1));
  assert.equal((await store.recovery()).rawLibrary, "damaged original data");
  assert.equal(await readFile(store.libraryPath, "utf8"), "damaged original data");
});
