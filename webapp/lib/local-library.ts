import { parseBackup } from "./novel-data";
import { desktopBridge } from "./desktop-bridge";
import type { BookProject } from "@/components/novel/bookshelf";
import { mergeBookWorkspace, type BookWorkspace } from "@/components/novel/book-workspace";

export type Library = { books: BookProject[]; workspaces: Record<string, BookWorkspace> };
type StoredLibrary = Library & { revision: number };
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("momai-library", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("library");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { database = undefined; reject(new Error("无法打开本地数据库，请检查浏览器存储权限。")); };
    req.onblocked = () => reject(new Error("请关闭其他墨脉页面后重试。"));
  });
  return database;
}
export function normalizeLibrary(input: unknown): Library {
  const parsed = parseBackup(input);
  return { books: parsed.books, workspaces: Object.fromEntries(parsed.books.map((b) => [b.id, mergeBookWorkspace(b, parsed.workspaces[b.id])])) };
}
export async function loadLibrary(fallback: BookProject[]): Promise<StoredLibrary> {
  const desktop = desktopBridge();
  if (desktop) {
    const saved = await desktop.readLibrary() as { revision?: number } | null;
    return saved ? { ...normalizeLibrary(saved), revision: saved.revision ?? 0 } : { ...normalizeLibrary({ books: fallback, workspaces: {} }), revision: 0 };
  }
  const db = await openDatabase();
  const saved = await new Promise<StoredLibrary | undefined>((resolve, reject) => {
    const req = db.transaction("library").objectStore("library").get("current");
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  if (saved) return { ...normalizeLibrary(saved), revision: saved.revision };
  const books = JSON.parse(localStorage.getItem("momai-books") ?? JSON.stringify(fallback));
  const workspaces = JSON.parse(localStorage.getItem("momai-book-workspaces") ?? "{}");
  const library = normalizeLibrary({ books, workspaces });
  const legacy = localStorage.getItem("momai-references");
  if (legacy && books[0] && !Object.keys(workspaces).length) {
    library.workspaces[books[0].id].references = JSON.parse(legacy);
    return { ...normalizeLibrary(library), revision: 0 };
  }
  return { ...library, revision: 0 };
}

export async function readRecoveryData(): Promise<unknown> {
  const desktop = desktopBridge(); if (desktop) return desktop.readRecovery();
  const legacy: Record<string, string | null> = {};
  for (const key of ["momai-books", "momai-book-workspaces", "momai-references"]) legacy[key] = localStorage.getItem(key);
  const db = await openDatabase();
  const saved = await new Promise<unknown>((resolve, reject) => {
    const req = db.transaction("library").objectStore("library").get("current");
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  return { description: "原始数据恢复包，包含未经修正的数据库和旧版数据；请保留此文件用于修复。", database: saved ?? null, legacy };
}
export async function saveLibrary(library: Library, expectedRevision: number): Promise<number> {
  const desktop = desktopBridge(); if (desktop) return desktop.saveLibrary(library, expectedRevision);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("library", "readwrite");
    const store = transaction.objectStore("library");
    const read = store.get("current");
    let conflict = false;
    read.onsuccess = () => {
      if ((read.result?.revision ?? 0) !== expectedRevision) { conflict = true; transaction.abort(); return; }
      store.put({ ...library, version: 3, revision: expectedRevision + 1 }, "current");
    };
    transaction.oncomplete = () => resolve(expectedRevision + 1);
    transaction.onabort = transaction.onerror = () => reject(new Error(conflict
      ? "另一个页面已更新书架。请先导出本页备份，再刷新以载入最新内容。"
      : "保存失败，内容仍在当前页面。请导出备份并检查设备空间和存储权限。"));
  });
}
