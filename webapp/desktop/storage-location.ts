import { constants } from "node:fs";
import { mkdir, readFile, readdir, copyFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DesktopStore, atomicWrite } from "./store";

// All library, settings and migration operations share one queue. A write that
// arrives during copying therefore commits to the new location after switching.
export class StorageLocation {
  private queue: Promise<unknown> = Promise.resolve();
  private store: DesktopStore;
  private readonly config: string;
  constructor(readonly userRoot: string) {
    this.store = new DesktopStore(path.join(userRoot, "data"));
    this.config = path.join(userRoot, "storage-location.json");
  }
  get directory() { return this.store.directory; }
  async initialize() {
    let raw: string;
    try { raw = await readFile(this.config, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const saved = JSON.parse(raw);
    if (typeof saved.dataPath !== "string" || !path.isAbsolute(saved.dataPath)) throw new Error("存储位置配置无效，请保留配置文件并联系维护者。");
    try {
      if (!(await stat(saved.dataPath)).isDirectory()) throw new Error("不是文件夹");
      const store = new DesktopStore(saved.dataPath);
      if (saved.hasLibrary && !await store.read()) throw new Error("找不到书架文件");
      this.store = store;
    } catch { throw new Error(`无法读取小说存储位置：${saved.dataPath}\n请连接对应磁盘并检查 library.json 后重新打开软件。原数据不会被空书架替换。`); }
  }
  run<T>(operation: (store: DesktopStore) => Promise<T>): Promise<T> {
    const next = this.queue.then(() => operation(this.store));
    this.queue = next.catch(() => undefined);
    return next;
  }
  flush() { return this.queue; }
  migrate(destination: string) {
    return this.run(async (source) => {
      await source.flush();
      const library = await source.read();
      const sourcePath = await realpath(source.directory);
      const targetPath = await realpath(destination);
      const inside = (parent: string, child: string) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
      if (inside(sourcePath, targetPath) || inside(targetPath, sourcePath)) throw new Error("请选择原资料目录之外的空文件夹，不能使用原目录、父目录或子目录。");
      if ((await readdir(targetPath)).length) throw new Error("目标文件夹不是空的，请新建一个空文件夹。现有文件不会被覆盖。");
      const copy = async (from: string, to: string) => {
        for (const entry of await readdir(from, { withFileTypes: true })) {
          const a = path.join(from, entry.name), b = path.join(to, entry.name);
          if (entry.isSymbolicLink()) throw new Error("资料中存在快捷链接，无法安全迁移，请先处理后重试。");
          if (entry.isDirectory()) { await mkdir(b); await copy(a, b); }
          else if (entry.isFile()) {
            await copyFile(a, b, constants.COPYFILE_EXCL);
            if (!(await readFile(a)).equals(await readFile(b))) throw new Error("文件校验失败");
          } else throw new Error("资料中存在不支持的文件");
        }
      };
      try {
        await copy(sourcePath, targetPath);
        const target = new DesktopStore(targetPath);
        if (JSON.stringify(await target.read()) !== JSON.stringify(library)) throw new Error("书架校验失败");
        await atomicWrite(this.config, JSON.stringify({ version: 1, dataPath: targetPath, hasLibrary: Boolean(library) }, null, 2));
        this.store = target;
        return { dataPath: targetPath, previousPath: sourcePath };
      } catch (error) {
        throw new Error(`迁移未完成，仍在使用原目录。目标中的已复制文件保留，请选择新的空文件夹重试。${error instanceof Error ? ` ${error.message}` : ""}`);
      }
    });
  }
}
