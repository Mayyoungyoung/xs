import { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, Menu, type IpcMainInvokeEvent } from "electron";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { StorageLocation } from "./storage-location";
import { GET as generateInfo, POST as generate } from "../app/api/generate/route";
import { POST as search } from "../app/api/references/search/route";
import { validApiKey } from "../lib/model-credentials";

const selfTest = process.argv.includes("--self-test");
const userRoot = selfTest && process.env.MOMAI_TEST_ROOT ? path.resolve(process.env.MOMAI_TEST_ROOT) : path.join(app.getPath("appData"), "MomaiNovel");
app.setName("墨脉");
app.setPath("userData", userRoot);
app.setAppUserModelId("cn.momai.novel.desktop");
const storage = new StorageLocation(userRoot);
let window: BrowserWindow | undefined;
let origin = "";
const running = new Map<string, AbortController>();
const requestSchema = z.object({ id: z.string().min(1).max(80), path: z.enum(["/api/generate", "/api/references/search"]), method: z.enum(["GET", "POST"]), body: z.string().max(400000).optional(), key: z.string().max(256).optional() });
function trusted(event: IpcMainInvokeEvent) { return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url.startsWith(`${origin}/`); }
function handle(channel: string, callback: (...args: never[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => { if (!trusted(event)) throw new Error("无效的软件窗口"); return callback(...args as never[]); });
}
async function readKey() { const data = await storage.run((store) => store.readKey()); if (!data) return ""; if (!safeStorage.isEncryptionAvailable()) throw new Error("无法读取本机加密密钥，请检查 Windows 用户配置。"); return safeStorage.decryptString(data); }
async function saveKey(key: string) {
  if (typeof key !== "string" || key && !validApiKey(key)) throw new Error("密钥格式不正确");
  if (key && !safeStorage.isEncryptionAvailable()) throw new Error("Windows 密钥加密暂不可用，密钥未保存。");
  await storage.run((store) => store.saveKey(key ? safeStorage.encryptString(key) : null));
}
handle("library:read", () => storage.run((store) => store.read()));
handle("library:save", (library: unknown, revision: number) => storage.run((store) => store.save(library, revision)));
handle("library:recovery", () => storage.run((store) => store.recovery()));
handle("settings:read", async () => ({ apiKey: await readKey(), ...await storage.run((store) => store.readPreferences()) }));
handle("settings:key", saveKey);
handle("settings:model", (choice: unknown) => storage.run((store) => store.savePreferences(choice)));
handle("app:info", () => ({ dataPath: storage.directory }));
handle("app:open-data", async () => { const failure = await shell.openPath(storage.directory); if (failure) throw new Error("无法打开数据文件夹"); });
let selectingStorage = false;
handle("app:change-data", async () => {
  if (!window || selectingStorage) throw new Error("正在选择或迁移资料，请稍候。");
  selectingStorage = true;
  try {
    const selected = await dialog.showOpenDialog(window, { title: "选择小说资料的新位置（请新建一个空文件夹）", buttonLabel: "迁移到此文件夹", defaultPath: path.dirname(storage.directory), properties: ["openDirectory", "createDirectory", "dontAddToRecent"] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return await storage.migrate(selected.filePaths[0]);
  } finally { selectingStorage = false; }
});
handle("api:request", async (raw: unknown) => {
  const input = requestSchema.parse(raw);
  if (running.has(input.id)) throw new Error("重复请求");
  const controller = new AbortController(); running.set(input.id, controller);
  try {
    const request = new Request(`${origin}${input.path}`, { method: input.method, headers: { "Content-Type": "application/json", ...(input.key ? { "X-Momai-API-Key": input.key } : {}) }, ...(input.method === "POST" ? { body: input.body ?? "{}" } : {}), signal: controller.signal });
    const result = input.path === "/api/generate" ? input.method === "GET" ? await generateInfo() : await generate(request) : input.method === "POST" ? await search(request) : Response.json({ error: "不支持的请求" }, { status: 405 });
    return { status: result.status, body: await result.text() };
  } finally { running.delete(input.id); }
});
ipcMain.on("api:cancel", (event, id) => { if (trusted(event) && typeof id === "string") running.get(id)?.abort(); });

const root = path.join(__dirname, "renderer");
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    // Only this app's own window may talk to the loopback server.
    const hostname = (request.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) { response.writeHead(403).end(); return; }
    const url = new URL(request.url ?? "/", "http://localhost");
    const name = decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
    const filename = path.resolve(root, name);
    if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    const content = await readFile(filename);
    response.writeHead(200, { "Content-Type": types[path.extname(filename)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); response.end(content);
  } catch { response.writeHead(404).end("Not found"); }
});
async function selfTestReport(error?: string) {
  if (!selfTest) return;
  const report = process.env.MOMAI_TEST_REPORT;
  if (report) await writeFile(report, JSON.stringify({ ok: !error, error, revision: await storage.run(async (store) => (await store.read())?.revision).catch(() => undefined), dataPath: storage.directory, packaged: app.isPackaged, windowLoaded: !error, encryptedKeyRoundTrip: await readKey().then((key) => key === "sk-desktop-self-test-only").catch(() => false) }, null, 2));
  app.exit(error ? 1 : 0);
}
handle("app:renderer-ready", async () => { if (selfTest) { await storage.flush(); await selfTestReport(); } });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    await mkdir(userRoot, { recursive: true }); await storage.initialize(); await storage.run((store) => store.writeNote());
    if (selfTest) {
      const previous = await storage.run((store) => store.read());
      if (!previous) {
        await storage.run((store) => store.save({ books: [{ id: "desktop-test", title: "桌面验证", genre: "悬疑", premise: "验证桌面持久化" }], workspaces: { "desktop-test": { idea: "验证桌面持久化", assets: { world: "测试世界规则" }, chapters: [{ id: "chapter-test", title: "验证章节", content: "重启后保留的正文", updatedAt: "" }], activeChapterId: "chapter-test" } } }, 0));
        await saveKey("sk-desktop-self-test-only");
      } else if (await readKey() !== "sk-desktop-self-test-only" || !previous.workspaces["desktop-test"]?.chapters?.some((chapter) => chapter.content === "重启后保留的正文")) throw new Error("重启后的正文或加密密钥不一致");
      if (process.env.MOMAI_TEST_MIGRATE) { await mkdir(process.env.MOMAI_TEST_MIGRATE, { recursive: true }); await storage.migrate(process.env.MOMAI_TEST_MIGRATE); }
      setTimeout(() => { void selfTestReport("软件启动验证超时"); }, 30000).unref();
    }
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("本地界面启动失败"); origin = `http://127.0.0.1:${address.port}`;
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 600, title: "墨脉 · 小说创作", backgroundColor: "#fafaf8", show: false, icon: path.join(__dirname, "assets", "momai.ico"), webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url) && !url.startsWith(origin)) void shell.openExternal(url); return { action: "deny" }; });
    window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(`${origin}/`)) event.preventDefault(); });
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.on("will-prevent-unload", (event) => { if (window && dialog.showMessageBoxSync(window, { type: "question", buttons: ["继续等待保存", "仍然关闭"], defaultId: 0, cancelId: 0, message: "还有内容正在保存。", detail: "建议等保存完成后再关闭软件。" }) === 1) event.preventDefault(); });
    window.webContents.on("did-fail-load", (_event, code, message) => { if (code !== -3 && selfTest) void selfTestReport(message); });
    window.once("ready-to-show", () => { if (!selfTest) window?.show(); });
    await window.loadURL(`${origin}/`);
  }).catch(async (error) => { if (selfTest) await selfTestReport(error instanceof Error ? error.message : "启动失败"); else { dialog.showErrorBox("墨脉启动失败", error instanceof Error ? error.message : "请检查软件目录完整性与本地数据目录权限后重试。"); app.quit(); } });
}
app.on("window-all-closed", () => { for (const controller of running.values()) controller.abort(); server.close(); void storage.flush().finally(() => app.quit()); });
