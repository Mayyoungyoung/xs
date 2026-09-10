"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Aperture, BookMarked, BookOpen, Box, Check, CircleUserRound, Clock3, Cpu,
  Feather, LayoutDashboard, Library, LoaderCircle, MessageCircleMore,
  Network, PanelRightClose, Plus, Search, Settings2,
  Sparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { WorldlineWorkbench } from "@/components/novel/worldline-workbench";
import { ReferenceWorkbench } from "@/components/novel/reference-workbench";
import { AssetWorkbench } from "@/components/novel/asset-workbench";
import { Bookshelf, initialBooks, type BookProject } from "@/components/novel/bookshelf";
import { buildStoryContext, changeAsset, createBookWorkspace, mergeBookWorkspace, preparation, withSnapshot, type BookWorkspace, type PlotGenerationOptions, type StoryMessage } from "@/components/novel/book-workspace";
import { ReferenceLibraryDialog, type ReferenceItem, type ReferenceScope } from "@/components/novel/reference-library-dialog";

import { chapterWordCount, downloadText } from "@/lib/novel-data";
import { loadLibrary, normalizeLibrary, readRecoveryData, saveLibrary } from "@/lib/local-library";

import { ModelSettings } from "@/components/novel/model-settings";
import { desktopBridge } from "@/lib/desktop-bridge";
import { writingGuidance } from "@/lib/writing-guidance";
import { readSessionKey, saveSessionKey } from "@/lib/model-credentials";

const navGroups = [
  { label: "故事设计", items: [
    { id: "overview", label: "故事蓝图", icon: LayoutDashboard, badge: "" },
    { id: "world", label: "世界观", icon: Box, badge: "" },
    { id: "characters", label: "人物角色", icon: CircleUserRound, badge: "" },
    { id: "timeline", label: "世界线", icon: Network, badge: "" },
    { id: "style", label: "文笔文风", icon: Feather, badge: "" },
    { id: "references", label: "借鉴库", icon: BookMarked, badge: "" },
  ]},
  { label: "开始写作", items: [
    { id: "outline", label: "卷章大纲", icon: Library, badge: "" },
    { id: "chapters", label: "章节正文", icon: BookOpen, badge: "" },
  ]},
];

export default function Home() {
  const [screen, setScreen] = useState<"shelf" | "studio">("shelf");
  const [books, setBooks] = useState<BookProject[]>(initialBooks);
  const [currentBookId, setCurrentBookId] = useState(initialBooks[0].id);
  const [workspaces, setWorkspaces] = useState<Record<string, BookWorkspace>>({});
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState("overview");
  const [chat, setChat] = useState("");
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");
  const [rightOpen, setRightOpen] = useState(false);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceScope, setReferenceScope] = useState<ReferenceScope>("plot");
  const [aiError, setAiError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [saveState, setSaveState] = useState("正在读取…");
  const [apiKey, setApiKey] = useState("");
  const [serverConfigured, setServerConfigured] = useState(false);
  const [connection, setConnection] = useState("正在检查模型配置…");
  const revision = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const storageBlocked = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const [textPrompt, setTextPrompt] = useState<{ kind: "rename" | "preference"; value: string } | null>(null);
  const desktopReady = useRef(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const currentBook = useMemo(() => books.find((book) => book.id === currentBookId) ?? books[0] ?? initialBooks[0], [books, currentBookId]);
  const workspace = mergeBookWorkspace(currentBook, workspaces[currentBook.id]);
  const { idea, messages, references, tags } = workspace;
  const readiness = preparation(workspace);
  const currentLabel = useMemo(() => navGroups.flatMap((group) => group.items).find((item) => item.id === active)?.label, [active]);
  const assistantVisible = rightOpen && active !== "timeline" && active !== "references";
  const searchItems = !workspaceSearch.trim() ? navGroups.flatMap((group) => group.items) : navGroups.flatMap((group) => group.items).filter((item) => (item.label + (workspace.assets[item.id] ?? "") + (item.id === "timeline" ? JSON.stringify(workspace.plot) : item.id === "overview" ? workspace.idea : "") + (item.id === "chapters" ? workspace.chapters.map((c) => c.title + c.content).join("\n") : "")).toLowerCase().includes(workspaceSearch.trim().toLowerCase()));

  const updateWorkspace = useCallback((patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) => {
    setWorkspaces((items) => {
      const previous = mergeBookWorkspace(currentBook, items[currentBook.id]);
      return { ...items, [currentBook.id]: typeof patch === "function" ? patch(previous) : { ...previous, ...patch } };
    });
    const updatedAt = new Date().toISOString();
    setBooks((items) => items.map((book) => book.id === currentBook.id ? { ...book, updatedAt } : book));
  }, [currentBook]);

  const setBookIdea = useCallback((nextIdea: string) => {
    updateWorkspace({ idea: nextIdea });
    setBooks((items) => items.map((book) => book.id === currentBook.id ? { ...book, premise: nextIdea } : book));
  }, [currentBook.id, updateWorkspace]);

  function updateMessages(next: StoryMessage[] | ((items: StoryMessage[]) => StoryMessage[])) {
    updateWorkspace((w) => ({ ...w, messages: typeof next === "function" ? next(w.messages) : next }));
  }

  useEffect(() => {
    const modelContext = (document as Document & {
      modelContext?: {
        registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(modelContext.registerTool({
      name: "update_story_seed",
      title: "更新故事种子",
      description: "替作者更新当前小说的一句话故事构想，并同步到页面中的故事蓝图输入框。",
      inputSchema: {
        type: "object",
        properties: { idea: { type: "string", minLength: 2, description: "新的故事构想" } },
        required: ["idea"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input: unknown) {
        const nextIdea = (input as { idea?: unknown })?.idea;
        if (typeof nextIdea !== "string" || nextIdea.trim().length < 2) {
          throw new Error("故事构想至少需要两个字");
        }
        setBookIdea(nextIdea.trim());
        setScreen("studio");
        return { status: "updated", idea: nextIdea.trim() };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [setBookIdea]);

  useEffect(() => {
    let alive = true;
    loadLibrary(initialBooks).then((loaded) => {
      if (!alive) return;
      revision.current = loaded.revision;
      setBooks(loaded.books); setWorkspaces(loaded.workspaces); setHydrated(true);
      if (window.matchMedia("(max-width: 1180px)").matches) setRightOpen(false);
      const savedKey = readSessionKey();
      setApiKey(savedKey);
      const savedModel = localStorage.getItem("momai-model");
      if (savedModel === "deepseek-v4-pro" || savedModel === "deepseek-v4-flash") setModel(savedModel);
    }).catch((error) => { if (alive) { setStorageError(`读取失败，原始数据未覆盖。${error instanceof Error ? error.message : "请检查存储权限。"}`); setSaveState("读取失败"); } });
    fetch("/api/generate").then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<{ configured: boolean; model: string }>; }).then((data) => {
      if (alive) { setServerConfigured(data.configured); setConnection(readSessionKey() || data.configured ? "已配置 · 待测试连接" : "未配置模型密钥"); if (!localStorage.getItem("momai-model")) setModel(data.model); }
    }).catch(() => { if (alive) setConnection("无法获取模型配置"); });
    return () => { alive = false; requestController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let latest = true;
    saveQueue.current = saveQueue.current.then(async () => {
      if (!latest || storageBlocked.current) return;
      if (latest) setSaveState("正在保存…");
      try {
        revision.current = await saveLibrary({ books, workspaces }, revision.current);
        if (latest) setSaveState("已保存到此设备");
      } catch (error) {
        storageBlocked.current = true;
        setStorageError(error instanceof Error ? error.message : "保存失败，请导出备份。"); setSaveState("保存失败");
      }
    });
    return () => { latest = false; };
  }, [books, workspaces, hydrated]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saveState !== "已保存到此设备" && hydrated) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState, hydrated]);

  useEffect(() => { if (hydrated && saveState === "已保存到此设备" && !desktopReady.current) { desktopReady.current = true; void desktopBridge()?.ready?.(); } }, [hydrated, saveState]);
  useEffect(() => { messageEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages.length, generating]);
  useEffect(() => { if (screen === "studio") window.scrollTo({ top: 0, behavior: "instant" }); }, [active, screen]);

  function selectModule(id: string) {
    setActive(id);
    setRightOpen(false);
    if (!generating) setAiError("");
  }

  const displayedBooks = books.map((book) => {
    const w = mergeBookWorkspace(book, workspaces[book.id]);
    return { ...book, chapters: w.chapters.filter((c) => c.content.trim()).length, words: w.chapters.reduce((count, c) => count + chapterWordCount(c), 0), progress: preparation(w).percent };
  });

  function openBook(book: BookProject) {
    requestController.current?.abort();
    setAiError("");
    setCurrentBookId(book.id);
    setWorkspaces((items) => items[book.id] ? items : { ...items, [book.id]: createBookWorkspace(book) });
    setChat("");
    selectModule("overview");
    setScreen("studio");
  }

  function createBook(book: BookProject) {
    setBooks((items) => [book, ...items]);
    setWorkspaces((items) => ({ ...items, [book.id]: createBookWorkspace(book) }));
    requestController.current?.abort();
    setAiError("");
    setCurrentBookId(book.id);
    selectModule("overview");
    setScreen("studio");
  }

  function openReferences(scope: ReferenceScope) {
    setReferenceScope(scope);
    setReferenceOpen(true);
  }

  function addReference(reference: ReferenceItem) {
    updateWorkspace((w) => ({ ...w, references: w.references.some((item) => item.id === reference.id && item.scope === reference.scope) ? w.references : [...w.references, reference] }));
    notify(`已加入借鉴：${reference.title}`);
  }

  function removeReference(reference: ReferenceItem) {
    updateWorkspace((w) => ({ ...w, references: w.references.filter((item) => item.id !== reference.id || item.scope !== reference.scope) }));
    notify(`已删除借鉴：${reference.title}`);
  }

  async function askAI(prompt: string, task = "chat", options?: PlotGenerationOptions) {
    if (requestController.current) throw new Error("已有生成任务，请等待完成或停止后重试。");
    const controller = new AbortController();
    requestController.current = controller;
    setAiError(""); setGenerating(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json", ...(apiKey ? { "X-Momai-API-Key": apiKey } : {}) },
        body: JSON.stringify({ task, prompt, model, context: [options?.context?.slice(0, 60000), buildStoryContext(currentBook, workspace, active).slice(0, options?.context ? 59000 : 120000)].filter(Boolean).join("\n\n"),
          messages: (options?.messages ?? messages).slice(-20).map((m) => ({ ...m, text: m.text.slice(-12000) })),
          references: references.slice(-12).map((r) => ({ title: r.title.slice(0, 500), kind: r.kind.slice(0, 100), summary: r.summary.slice(0, 12000) })),
        }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(190000)]),
      });
      const data = await response.json() as { content?: string; error?: string; truncated?: boolean };
      if (!response.ok || !data.content) throw new Error(data.error ?? "生成失败，请稍后再试。");
      controller.signal.throwIfAborted();
      if (data.truncated) { setAiError("本次结果达到输出长度上限，结尾可能不完整。请检查后分段继续生成。"); notify("结果达到长度上限，请检查结尾"); }
      setConnection("模型连接正常");
      return data.content;
    } catch (error) {
      const message = controller.signal.aborted ? "生成已停止，已有稿件保留。" : error instanceof Error && error.name === "TimeoutError" ? "生成超时，请缩短要求后重试。" : error instanceof Error ? error.message : "连接失败，请重试。";
      setAiError(message); throw new Error(message);
    } finally { requestController.current = null; setGenerating(false); }
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function enrichIdea() {
    try {
      const content = await askAI(idea, "story_seed");
      updateWorkspace((w) => ({ ...w, proposals: { ...w.proposals, overview: content } }));
      notify("故事构想已生成，请预览后采纳");
    } catch { /* error is shown beside the composer */ } finally { /* 请求状态由 askAI 管理 */ }
  }

  async function sendMessage() {
    const value = chat.trim();
    if (!value || generating) return;
    updateMessages((items) => [...items, { role: "user", text: value }]);
    setChat("");
    try {
      const task = "chat";
      const content = await askAI(value, task);
      updateMessages((items) => [...items, { role: "ai", text: content }]);
    } catch { /* surfaced in the UI */ } finally { /* 请求状态由 askAI 管理 */ }
  }

  function addPreference() { setTextPrompt({ kind: "preference", value: "" }); }
  function saveTextPrompt() {
    const value = textPrompt?.value.trim(); if (!value) return;
    if (textPrompt?.kind === "rename") setBooks((items) => items.map((book) => book.id === currentBook.id ? { ...book, title: value, updatedAt: new Date().toISOString() } : book));
    else updateWorkspace((w) => ({ ...w, tags: [...new Set([...w.tags, value])] }));
    setTextPrompt(null);
  }

  function createBlueprintSnapshot(label = "手动保存故事蓝图") {
    updateWorkspace((w) => withSnapshot(w, label));
    notify("已保存设定、情节、章节和借鉴的完整快照");
  }

  function restoreBlueprintSnapshot(versionId: string) {
    const version = workspace.versions.find((item) => item.id === versionId);
    if (!version) return;
    updateWorkspace((w) => ({ ...withSnapshot(w, "恢复前自动备份"), ...(version.snapshot ?? { idea: version.idea }) }));
    setBooks((items) => items.map((b) => b.id === currentBook.id ? { ...b, premise: version.idea } : b));
    setVersionsOpen(false); notify(`已恢复“${version.label}”`);
  }

  function adoptMessage() {
    const text = messages.at(-1)?.text;
    if (!text) return;
    if (active === "overview") { updateWorkspace((w) => withSnapshot(w, "采纳故事种子前")); setBookIdea(text); }
    else if (active === "timeline") { setAiError("请在世界线的 AI 主线共创中生成方案，再采纳到剧情图。"); return; }
    else updateWorkspace((w) => changeAsset(w, active, text, true));
    notify("已采纳到当前编辑器，并保留修改前快照");
  }

  function changeModel(value: string) {
    setModel(value);
    void desktopBridge()?.saveModel(value).catch(() => notify("模型偏好保存失败，下次打开请重新选择"));
    try { localStorage.setItem("momai-model", value); } catch { notify("模型选择仅在本次使用中生效"); }
  }
  async function testConnection(draftKey?: string) {
    const key = draftKey || apiKey;
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "X-Momai-API-Key": key } : {}) }, body: JSON.stringify({ model, task: "chat", prompt: "连接测试，请只回复：连接成功。" }), signal: AbortSignal.timeout(45000) });
      const data = await response.json() as { content?: string; error?: string };
      if (!response.ok || !data.content) throw new Error(data.error ?? "模型没有返回有效内容。");
      if (!draftKey || draftKey === apiKey) setConnection("模型连接正常");
    } catch (reason) {
      if (!draftKey) setConnection("连接失败，请检查密钥与账户状态");
      throw new Error(reason instanceof Error && reason.name === "TimeoutError" ? "连接超时，请稍后重试。" : reason instanceof Error ? reason.message : "暂时无法连接模型。");
    }
  }
  function backToShelf() { setScreen("shelf"); setSettingsOpen(false); }
  const settingsDialog = <ModelSettings open={settingsOpen} onOpenChange={setSettingsOpen} model={model} onModelChange={changeModel} hasSessionKey={Boolean(apiKey)} connection={connection} onSaveKey={async (key) => { await desktopBridge()?.saveKey(key); saveSessionKey(key); setApiKey(key); setConnection(key || serverConfigured ? "已配置 · 待测试连接" : "未配置模型密钥"); }} onTest={testConnection} bookTitle={screen === "studio" ? currentBook.title : undefined} onRename={() => { setSettingsOpen(false); setTextPrompt({ kind: "rename", value: currentBook.title }); }} />;

  const storageBanner = storageError && <div className="storage-banner" role="alert">{storageError}<Button variant="outline" onClick={() => { if (hydrated) exportBookshelf(displayedBooks, workspaces); else void readRecoveryData().then((data) => downloadText(JSON.stringify(data, null, 2), "墨脉原始数据恢复包.json", "application/json")).catch(() => setStorageError("无法读取原始存储，请保留浏览器数据并检查存储权限。")); }}>{hydrated ? "导出当前备份" : "导出原始数据"}</Button><Button variant="outline" onClick={() => window.location.reload()}>重新载入</Button></div>;
  if (!hydrated) return <main className="shelf-shell"><div className="shelf-content"><h1>墨脉 · AI 小说工作台</h1><p>{storageError ? "原始数据仍保留在浏览器中。请勿清除网站数据。" : "正在读取你的书架…"}</p>{storageBanner}</div></main>;

  if (screen === "shelf") {
    return <>{storageBanner}<Bookshelf
      books={displayedBooks}
      onOpenSettings={() => setSettingsOpen(true)}
      saveState={saveState}
      onDeleteBook={(id) => { setBooks((items) => items.filter((b) => b.id !== id)); setWorkspaces((items) => Object.fromEntries(Object.entries(items).filter(([key]) => key !== id))); }}
      onOpenBook={openBook}
      onCreateBook={createBook}
      onImportBooks={(items, importedWorkspaces) => {
        setBooks((booksNow) => [...items, ...booksNow.filter((book) => !items.some((item) => item.id === book.id))]);
        const normalized = normalizeLibrary({ books: items, workspaces: importedWorkspaces ?? {} });
        setWorkspaces((existing) => ({ ...existing, ...normalized.workspaces }));
        notify(`已导入 ${items.length} 本小说${importedWorkspaces ? "及其工作区" : ""}`);
      }}
      onExportBooks={() => exportBookshelf(displayedBooks, workspaces)}
    />{settingsDialog}{toast && <div className="toast" role="status">{toast}</div>}</>;
  }

  return (
    <main className="app-shell">
      {storageBanner}
      <header className="topbar">
        <div className="brand-mark"><span>墨</span></div>
        <div className="brand-name">墨脉 <em>AI 小说工作台</em></div>
        <Button className="back-to-shelf" variant="outline" onClick={backToShelf}><ArrowLeft />返回书架</Button>
        <div className="current-book-heading"><span className="book-dot">{currentBook.glyph}</span><div><strong>{currentBook.title}</strong><small>{currentBook.genre}</small></div></div>
        <div className="top-actions">
          <div className="model-picker"><Cpu size={15} /><NativeSelect value={model} onChange={(event) => changeModel(event.target.value)} size="sm" aria-label="生成模型">
            <NativeSelectOption value="deepseek-v4-flash">DeepSeek V4 Flash</NativeSelectOption>
            <NativeSelectOption value="deepseek-v4-pro">DeepSeek V4 Pro</NativeSelectOption>
          </NativeSelect></div>
          <button className="icon-button" aria-label="搜索" onClick={() => setSearchOpen(true)}><Search size={18} /></button>
          <Button variant="outline" className="open-model-settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16} />模型设置</Button>
          <div className="save-state" role="status"><Check size={14} /> {saveState}</div><button className="avatar" onClick={() => setSettingsOpen(true)}>砚</button>
        </div>
      </header>

      <div className={`workspace ${assistantVisible ? "" : "right-closed"}`}>
        <aside className="leftbar">
          <div className="progress-block" title={readiness.items.map((item) => `${item.done ? "已填写" : "待填写"}：${item.label}`).join("；")}>
            <div className="progress-label"><span>创作准备度</span><strong>{readiness.percent}%</strong></div><div className="progress-track"><span style={{ width: `${readiness.percent}%` }} /></div>
            <p>已填写 {readiness.completed} / {readiness.items.length} 项创作资料。</p>
          </div>
          <nav aria-label="小说模块">{navGroups.map((group) => <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} aria-current={active === item.id ? "page" : undefined} onClick={() => selectModule(item.id)}>
              <Icon size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}
            </button>; })}
          </div>)}</nav>
          <div className="memory-card"><div><Aperture size={16} /><strong>故事记忆</strong><span>独立</span></div><p>《{currentBook.title}》已保存 {messages.length + (workspace.plot.discussion?.length ?? 0)} 条对话、{references.length} 项借鉴与 {workspace.versions.length} 个快照。</p></div>
        </aside>

        <section className="canvas"><div className={active === "timeline" ? "canvas-inner plot-canvas-inner" : "canvas-inner"}>
          <div className="module-tools"><span>创作工作区 / {currentLabel}</span><div><Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}><Clock3 />故事版本</Button>{active !== "timeline" && active !== "references" && <Button variant="outline" size="sm" aria-expanded={assistantVisible} onClick={() => setRightOpen(!assistantVisible)}><MessageCircleMore />{assistantVisible ? "收起共创助手" : "共创助手"}</Button>}</div></div>
          {generating && active !== "timeline" && <div className="module-task-status" role="status"><LoaderCircle className="spin" /><span>AI 正在生成，请稍候…</span><Button size="sm" variant="outline" onClick={() => requestController.current?.abort()}>停止生成</Button></div>}
          {aiError && active !== "timeline" && <p className="ai-error" role="alert">{aiError}</p>}
          {active === "timeline" ? <WorldlineWorkbench key={currentBook.id} book={currentBook} workspace={workspace} busy={generating} saveState={saveState} onWorkspaceChange={updateWorkspace} onOpenReferences={openReferences} onRemoveReference={removeReference} onGenerate={askAI} onCancel={() => requestController.current?.abort()} onNotify={notify} /> : active === "references" ? <ReferenceWorkbench title={currentBook.title} references={references} onAdd={openReferences} onRemove={removeReference} /> : active !== "overview" ? <AssetWorkbench key={`${currentBook.id}-${active}-${workspace.activeChapterId}`} book={currentBook} type={active} workspace={workspace} busy={generating} saveState={saveState} onProposalConsumed={() => {}} references={references} onWorkspaceChange={updateWorkspace} onContentChange={(content, snapshot) => updateWorkspace((w) => changeAsset(w, active, content, snapshot))} onOpenReferences={openReferences} onRemoveReference={removeReference} onGenerate={askAI} onNotify={notify} /> : <>
          <div className="page-heading">
            <div><div className="eyebrow">{currentBook.title} / {currentLabel}</div><h1>故事蓝图</h1><p>确定故事构想、核心卖点和创作偏好。</p></div>

          </div>

          <section className="idea-card">
            <div className="idea-title"><Sparkles size={17} /><span>从一句话开始</span><em>AI 会补全冲突、代价与成长空间</em></div>
            <Textarea aria-label="故事创意" value={idea} onChange={(event) => setBookIdea(event.target.value)} className="idea-input" />
            <div className="idea-footer"><div className="chips">{tags.map((tag) => <button key={tag} onClick={() => updateWorkspace({ tags: tags.filter((item) => item !== tag) })}>{tag} <X size={12} /></button>)}<button className="add-chip" onClick={addPreference}><Plus size={13} /> 添加偏好</button></div>
              <Button className="magic-button" onClick={enrichIdea} disabled={generating || !idea.trim()}><Sparkles />{generating ? "正在推演…" : "让 AI 完善"}</Button>
            </div>
          </section>

          {workspace.proposals.overview && <section className="generation-preview blueprint-preview"><header><h2>故事构想预览</h2><span>采纳后更新上方构想</span></header><Textarea aria-label="故事构想预览" value={workspace.proposals.overview} onChange={(e) => { const value = e.target.value; updateWorkspace((w) => ({ ...w, proposals: { ...w.proposals, overview: value } })); }} /><div><Button disabled={generating} onClick={() => { const content = workspace.proposals.overview; updateWorkspace((w) => ({ ...withSnapshot(w, "采纳故事构想前"), idea: content, proposals: { ...w.proposals, overview: "" } })); setBooks((items) => items.map((book) => book.id === currentBook.id ? { ...book, premise: content } : book)); notify("已采纳故事构想，旧内容已保存快照"); }}>采纳故事构想</Button><Button variant="outline" disabled={generating} onClick={() => updateWorkspace((w) => ({ ...w, proposals: { ...w.proposals, overview: "" } }))}>放弃本次结果</Button></div></section>}
          </>}
        </div></section>

        {assistantVisible && <aside className="copilot" aria-label="共创助手">
          <div className="copilot-head"><div><span className="ai-orb"><Sparkles size={16} /></span><strong>共创助手</strong><i title={connection}>{connection === "模型连接正常" ? "已连接" : "待连接"}</i></div><button aria-label="收起助手" onClick={() => setRightOpen(false)}><PanelRightClose size={18} /></button></div>
          <div className="context-strip"><span>正在讨论</span><strong>{currentLabel}</strong><em>{model === "deepseek-v4-flash" ? "V4 Flash" : "V4 Pro"}</em><button disabled={generating} onClick={() => { if (window.confirm("清空本书对话？设定和正文不会删除。")) updateMessages([]); }}>清空</button></div>
          <div className="messages"><div className="day-divider"><span>今天</span></div>
            {messages.length === 0 && <div className="empty-chat">从一句模糊的想法开始就好。<br />我会帮你把它变成可写的故事。</div>}
            {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.text}-${index}`}>{message.role === "ai" && <div className="mini-orb"><Sparkles size={13} /></div>}<div className="message-bubble">{message.text}</div></div>)}
            {generating && <div className="message ai"><div className="mini-orb"><Sparkles size={13} /></div><div className="message-bubble thinking"><LoaderCircle className="spin" />正在结合设定与借鉴资料推演……</div></div>}
            {messages.length > 1 && messages[messages.length - 1].role === "ai" && <div className="suggestion-actions"><button disabled={generating || active === "timeline"} onClick={adoptMessage}><Check size={14} />采纳到当前页</button><button onClick={() => setChat("再给我一个更有网文爽感、但不俗套的方案")}>换个方案</button></div>}
            <div ref={messageEnd} />
          </div>
          <div className="quick-prompts"><button onClick={() => setChat("检查当前设定有没有逻辑漏洞")}>检查逻辑漏洞</button><button onClick={() => setChat("帮我强化第一卷的章尾钩子")}>强化剧情钩子</button><button onClick={() => setChat("和我一起梳理主角的成长弧光")}>一起头脑风暴</button></div>
          {generating && <Button variant="outline" onClick={() => requestController.current?.abort()}>停止生成</Button>}
          {aiError && <div className="ai-error">{aiError}</div>}
          <div className="composer"><Textarea value={chat} onChange={(event) => setChat(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }} placeholder={writingGuidance(active, currentBook, workspace).request} aria-label="给共创助手发送消息" />
            <div><span>Enter 发送 · Shift + Enter 换行</span><Button disabled={generating || !chat.trim()} size="icon-sm" onClick={sendMessage} aria-label="发送"><Feather /></Button></div>
          </div>
        </aside>}
      </div>
      <ReferenceLibraryDialog key={`${currentBook.id}-${referenceScope}`} open={referenceOpen} onOpenChange={setReferenceOpen} scope={referenceScope} selected={references} onAdd={addReference} onRemove={removeReference} />
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent className="workspace-dialog sm:max-w-[560px]"><DialogHeader><DialogTitle>在《{currentBook.title}》中查找</DialogTitle><DialogDescription>搜索设定内容、章节标题或正文，快速前往匹配的编辑器。借鉴资料请进入“借鉴库”。</DialogDescription></DialogHeader>
        <label className="workspace-search"><Search /><input value={workspaceSearch} onChange={(event) => setWorkspaceSearch(event.target.value)} placeholder="搜索世界观、人物、情节、正文……" autoFocus /></label>
        <div className="workspace-search-results">{searchItems.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => { selectModule(item.id); setSearchOpen(false); }}><span><Icon /><strong>{item.label}</strong></span><em>打开 →</em></button>; })}{searchItems.length === 0 && <p>没有匹配的工作区。</p>}</div>
      </DialogContent></Dialog>
      {settingsDialog}
      <Dialog open={Boolean(textPrompt)} onOpenChange={(open) => { if (!open) setTextPrompt(null); }}><DialogContent className="workspace-dialog"><DialogHeader><DialogTitle>{textPrompt?.kind === "rename" ? "修改书名" : "添加创作偏好"}</DialogTitle><DialogDescription>{textPrompt?.kind === "rename" ? "为当前小说填写新的书名。" : "例如：群像、无系统、克制叙述；填写你希望这本书遵守的偏好。"}</DialogDescription></DialogHeader><input className="native-prompt-input" aria-label="填写内容" value={textPrompt?.value ?? ""} maxLength={textPrompt?.kind === "rename" ? 200 : 80} onChange={(event) => setTextPrompt((current) => current ? { ...current, value: event.target.value } : current)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) saveTextPrompt(); }} autoFocus /><Button disabled={!textPrompt?.value.trim()} onClick={saveTextPrompt}>保存</Button></DialogContent></Dialog>
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}><DialogContent className="workspace-dialog versions-dialog sm:max-w-[600px]"><DialogHeader><DialogTitle>《{currentBook.title}》的完整故事版本</DialogTitle><DialogDescription>恢复旧版本前会自动保留当前内容，你可以随时切回来。</DialogDescription></DialogHeader>
        <div className="version-list"><div className="current"><Clock3 /><span><strong>当前编辑内容</strong><small>刚刚 · 独立保存于《{currentBook.title}》</small></span><em>使用中</em></div>{workspace.versions.map((version) => <div key={version.id}><Clock3 /><span><strong>{version.label}</strong><small>{version.createdAt} · {version.snapshot ? "完整故事" : "故事种子"}</small></span><Button size="sm" variant="outline" onClick={() => restoreBlueprintSnapshot(version.id)}>恢复</Button></div>)}</div>
        <div className="dialog-actions"><span>共 {workspace.versions.length} 个快照</span><Button onClick={() => createBlueprintSnapshot()}>创建当前快照</Button></div>
      </DialogContent></Dialog>
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}

function exportBookshelf(books: BookProject[], workspaces: Record<string, BookWorkspace>) {
  downloadText(JSON.stringify({ version: 3, books, workspaces }, null, 2), "墨脉完整书架备份.json", "application/json");
}
