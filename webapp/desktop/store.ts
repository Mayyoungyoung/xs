import { mkdir, readFile, writeFile, open, rename, copyFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseBackup } from "../lib/novel-data";
import { CUSTOM_PROVIDER_ID, DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, defaultModelOf, normalizeBaseUrl, providerById, validModelName } from "../lib/model-providers";

export async function atomicWrite(filename: string, content: string | Uint8Array) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx"); try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    // Windows scanners may briefly hold a freshly copied file. Keep the old
    // file intact and retry the atomic replacement, never delete it first.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, filename); break; }
      catch (error) {
        if (attempt >= 9 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(50 * 2 ** attempt, 500)));
      }
    }
  }
  finally { await unlink(temporary).catch(() => undefined); }
}
export class DesktopStore {
  private queue: Promise<unknown> = Promise.resolve();
  private lastBackup = 0;
  readonly libraryPath: string;
  constructor(readonly directory: string) { this.libraryPath = path.join(directory, "library.json"); }
  async read() {
    let text: string;
    try { text = await readFile(this.libraryPath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const raw = JSON.parse(text);
    const data = parseBackup(raw);
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new Error("本地书架版本无效，请从自动备份恢复。");
    return { ...data, revision: raw.revision };
  }
  save(library: unknown, expectedRevision: number) {
    const next = this.queue.then(async () => {
      const data = parseBackup(library);
      const previous = await this.read();
      if (!Number.isSafeInteger(expectedRevision) || (previous?.revision ?? 0) !== expectedRevision) throw new Error("书架已经变更，请导出本页内容后重新打开软件。");
      if (previous && Date.now() - this.lastBackup > 300000) {
        const folder = path.join(this.directory, "backups"); await mkdir(folder, { recursive: true });
        await copyFile(this.libraryPath, path.join(folder, `library-${new Date().toISOString().replace(/[:.]/g, "-")}-r${previous.revision}.json`));
        const names = (await readdir(folder)).filter((name) => /^library-.*\.json$/.test(name)).sort();
        for (const name of names.slice(0, Math.max(0, names.length - 20))) await unlink(path.join(folder, name));
        this.lastBackup = Date.now();
      }
      await atomicWrite(this.libraryPath, JSON.stringify({ ...data, version: 3, revision: expectedRevision + 1 }));
      return expectedRevision + 1;
    });
    this.queue = next.catch(() => undefined); return next;
  }
  flush() { return this.queue; }
  async recovery() { return { description: "墨脉桌面版本地恢复数据", rawLibrary: await readFile(this.libraryPath, "utf8").catch(() => ""), dataPath: this.directory }; }
  async readPreferences() {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, "preferences.json"), "utf8"));
      if (value && typeof value === "object") {
        if (typeof value.provider === "string" && typeof value.model === "string") return this.normalizeChoice(value);
        if (value.model === "deepseek-v4-pro" || value.model === "deepseek-v4-flash") return { provider: DEFAULT_PROVIDER_ID, model: value.model };
      }
    } catch { /* fall through to defaults */ }
    return { provider: DEFAULT_PROVIDER_ID, model: DEFAULT_MODEL_ID };
  }
  private normalizeChoice(input: { provider?: unknown; model?: unknown; baseUrl?: unknown }) {
    const provider = typeof input.provider === "string" && providerById(input.provider) ? input.provider : DEFAULT_PROVIDER_ID;
    const model = typeof input.model === "string" && validModelName(input.model) ? input.model : defaultModelOf(provider);
    const baseUrl = typeof input.baseUrl === "string" ? normalizeBaseUrl(input.baseUrl) : null;
    return { provider, model, ...(provider === CUSTOM_PROVIDER_ID && baseUrl ? { baseUrl } : {}) };
  }
  async savePreferences(input: unknown) {
    if (!input || typeof input !== "object" || typeof (input as { model?: unknown }).model !== "string") throw new Error("无效的模型设置");
    const candidate = input as { provider?: unknown; model?: unknown; baseUrl?: unknown };
    if (typeof candidate.provider !== "string" || !providerById(candidate.provider)) throw new Error("不支持的模型供应商");
    if (typeof candidate.model !== "string" || !validModelName(candidate.model)) throw new Error("模型名称格式不正确");
    if (candidate.baseUrl !== undefined && typeof candidate.baseUrl !== "string") throw new Error("接口地址无效");
    if (typeof candidate.baseUrl === "string" && candidate.baseUrl && !normalizeBaseUrl(candidate.baseUrl)) throw new Error("接口地址无效：需填写 https 地址，或本机 http 地址");
    const normalized = this.normalizeChoice(candidate);
    if (normalized.provider === CUSTOM_PROVIDER_ID && !normalized.baseUrl) throw new Error("自定义接口需要填写接口地址");
    await atomicWrite(path.join(this.directory, "preferences.json"), JSON.stringify(normalized));
  }
  async readKey() { try { return await readFile(path.join(this.directory, "credentials.bin")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
  async saveKey(data: Uint8Array | null) { if (data) await atomicWrite(path.join(this.directory, "credentials.bin"), data); else await unlink(path.join(this.directory, "credentials.bin")).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  async writeNote() { await mkdir(this.directory, { recursive: true }); await writeFile(path.join(this.directory, "说明.txt"), "墨脉桌面版数据目录\n\nlibrary.json：全部小说、章节、世界线与版本记录。\nbackups：自动保留的最近 20 份完整书架备份，可在软件中导入。\ncredentials.bin：Windows 加密的模型密钥，与小说备份分开保存。\n\n请在软件关闭后复制整个文件夹以进行额外备份。不要在软件运行时手动改写 library.json。\n", "utf8"); }
}
