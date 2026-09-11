import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StorageLocation } from "../desktop/storage-location.ts";

const library = { books: [{ id: "move", title: "迁移验证" }], workspaces: { move: { assets: { world: "原始设定" } } } };
async function prepare(t) {
  const root = await mkdtemp(path.join(tmpdir(), "momai-location-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("momai-location-")); await rm(root, { recursive: true, force: true }); });
  const manager = new StorageLocation(path.join(root, "profile")); await manager.initialize();
  await manager.run((store) => store.save(library, 0));
  const target = path.join(root, "自定义资料 空格"); await mkdir(target);
  return { root, manager, target };
}
test("storage relocation preserves backups and credentials, queues new edits and survives restart", async (t) => {
  const { manager, target } = await prepare(t); const original = manager.directory;
  await manager.run(async (store) => { await store.save(library, 1); await store.saveKey(new Uint8Array([11, 22, 33])); await store.savePreferences({ provider: "deepseek", model: "deepseek-v4-pro" }); });
  const changed = structuredClone(library); changed.workspaces.move.assets.world = "迁移中的新编辑";
  const migrating = manager.migrate(target);
  const saving = manager.run((store) => store.save(changed, 2));
  assert.equal((await migrating).previousPath, original); assert.equal(await saving, 3);
  assert.equal(JSON.parse(await readFile(path.join(original, "library.json"), "utf8")).revision, 2);
  const restarted = new StorageLocation(manager.userRoot); await restarted.initialize();
  assert.equal(restarted.directory, target);
  await restarted.run(async (store) => {
    assert.equal((await store.read()).workspaces.move.assets.world, "迁移中的新编辑");
    assert.deepEqual([...await store.readKey()], [11, 22, 33]); assert.deepEqual(await store.readPreferences(), { provider: "deepseek", model: "deepseek-v4-pro" });
  });
  assert.ok((await readdir(path.join(target, "backups"))).length);
});
test("occupied or nested destinations and failed location commits leave original data active", async (t) => {
  const { root, manager, target } = await prepare(t); const original = manager.directory;
  await writeFile(path.join(target, "personal.txt"), "不可覆盖");
  await assert.rejects(manager.migrate(target), /不是空的/);
  assert.equal(await readFile(path.join(target, "personal.txt"), "utf8"), "不可覆盖");
  await assert.rejects(manager.migrate(original), /原目录/);
  await assert.rejects(manager.migrate(root), /父目录/);
  const empty = path.join(root, "empty"); await mkdir(empty);
  await mkdir(path.join(manager.userRoot, "storage-location.json"));
  await assert.rejects(manager.migrate(empty), /仍在使用原目录/);
  assert.equal(manager.directory, original);
  assert.equal(await manager.run((store) => store.save(library, 1)), 2);
});
test("an unavailable custom location never creates an empty replacement library", async (t) => {
  const { manager, target } = await prepare(t); await manager.migrate(target);
  await rm(path.join(target, "library.json"));
  const restarted = new StorageLocation(manager.userRoot);
  await assert.rejects(restarted.initialize(), /不会被空书架替换/);
  assert.equal((await readdir(target)).includes("library.json"), false);
});
