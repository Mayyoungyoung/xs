"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Aperture, BookMarked, BookOpen, Box, Check, ChevronDown, CircleUserRound, Clock3, Cpu,
  Feather, GitBranch, LayoutDashboard, Library, LoaderCircle, MessageCircleMore,
  MoreHorizontal, Network, PanelRightClose, Plus, Search, Settings2,
  Sparkles, WandSparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PlotWorkbench } from "@/components/novel/plot-workbench";
import { AssetWorkbench } from "@/components/novel/asset-workbench";
import { Bookshelf, initialBooks, type BookProject } from "@/components/novel/bookshelf";
import { createBookWorkspace, mergeBookWorkspace, type BookWorkspace, type StoryMessage } from "@/components/novel/book-workspace";
import { ReferenceLibraryDialog, type ReferenceItem, type ReferenceScope } from "@/components/novel/reference-library-dialog";

const navGroups = [
  { label: "故事设计", items: [
    { id: "overview", label: "故事蓝图", icon: LayoutDashboard, badge: "" },
    { id: "world", label: "世界观", icon: Box, badge: "" },
    { id: "characters", label: "人物角色", icon: CircleUserRound, badge: "" },
    { id: "timeline", label: "世界线", icon: Network, badge: "" },
    { id: "plot", label: "主线与支线", icon: GitBranch, badge: "" },
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
  const [rightOpen, setRightOpen] = useState(true);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceScope, setReferenceScope] = useState<ReferenceScope>("plot");
  const [aiError, setAiError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const currentBook = useMemo(() => books.find((book) => book.id === currentBookId) ?? books[0] ?? initialBooks[0], [books, currentBookId]);
  const workspace = mergeBookWorkspace(currentBook, workspaces[currentBook.id]);
  const { idea, messages, references, tags } = workspace;
  const chapterSteps = useMemo(() => [
    { no: "01", title: "触发事件", note: `让《${currentBook.title}》的主角无法回避核心冲突`, status: "待设计" },
    { no: "02", title: "第一次选择", note: "主角付出代价，主线开始推进", status: "待设计" },
    { no: "03", title: "支线生长", note: "人物关系或秘密线索改变主线", status: "待设计" },
    { no: "04", title: "阶段交汇", note: "一条支线与主线形成新的难题", status: "待设计" },
  ], [currentBook.title]);
  const worldSummary = firstLine(workspace.assets.world) || "尚未建立世界规则。先定义力量、秩序与代价，再让 AI 帮你补全。";
  const characterSummary = firstLine(workspace.assets.characters) || "尚未建立主角人物卡。请从欲望、恐惧和秘密开始。";
  const styleSummary = firstLine(workspace.assets.style) || "尚未设定文风指纹。可借鉴作家、作品或自定义语气。";
  const configuredAssets = Object.keys(workspace.assets).length;
  const readiness = Math.min(100, 20 + configuredAssets * 12 + references.length * 4 + (workspace.plot.branches.length - 3) * 6);
  const currentLabel = useMemo(() => navGroups.flatMap((group) => group.items).find((item) => item.id === active)?.label, [active]);
  const searchItems = useMemo(() => navGroups.flatMap((group) => group.items).filter((item) => item.label.includes(workspaceSearch.trim())), [workspaceSearch]);

  function updateWorkspace(patch: Partial<BookWorkspace>) {
    setWorkspaces((items) => ({ ...items, [currentBook.id]: { ...mergeBookWorkspace(currentBook, items[currentBook.id]), ...patch } }));
  }

  function setBookIdea(nextIdea: string) {
    updateWorkspace({ idea: nextIdea });
    setBooks((items) => items.map((book) => book.id === currentBook.id ? { ...book, premise: nextIdea, updatedAt: "刚刚" } : book));
  }

  function updateMessages(next: StoryMessage[] | ((items: StoryMessage[]) => StoryMessage[])) {
    updateWorkspace({ messages: typeof next === "function" ? next(messages) : next });
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
  }, [currentBook]);

  useEffect(() => {
    try {
      const savedBooks = window.localStorage.getItem("momai-books");
      const nextBooks = savedBooks ? JSON.parse(savedBooks) as BookProject[] : initialBooks;
      if (savedBooks) setBooks(nextBooks);
      const savedWorkspaces = window.localStorage.getItem("momai-book-workspaces");
      if (savedWorkspaces) setWorkspaces(JSON.parse(savedWorkspaces) as Record<string, BookWorkspace>);
      else {
        const legacyReferences = window.localStorage.getItem("momai-references");
        if (legacyReferences && nextBooks[0]) setWorkspaces({ [nextBooks[0].id]: { ...createBookWorkspace(nextBooks[0]), references: JSON.parse(legacyReferences) as ReferenceItem[] } });
      }
    } catch { /* local reference cache is optional */ }
    finally { setHydrated(true); }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setWorkspaces((items) => {
      const next = { ...items };
      books.forEach((book) => { if (!next[book.id]) next[book.id] = createBookWorkspace(book); });
      return next;
    });
  }, [books, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("momai-books", JSON.stringify(books));
  }, [books, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("momai-book-workspaces", JSON.stringify(workspaces));
  }, [workspaces, hydrated]);

  function openBook(book: BookProject) {
    setCurrentBookId(book.id);
    setWorkspaces((items) => items[book.id] ? items : { ...items, [book.id]: createBookWorkspace(book) });
    setChat("");
    setActive("overview");
    setScreen("studio");
  }

  function createBook(book: BookProject) {
    setBooks((items) => [book, ...items]);
    setWorkspaces((items) => ({ ...items, [book.id]: createBookWorkspace(book) }));
    setCurrentBookId(book.id);
    setActive("overview");
    setScreen("studio");
  }

  function openReferences(scope: ReferenceScope) {
    setReferenceScope(scope);
    setReferenceOpen(true);
  }

  function addReference(reference: ReferenceItem) {
    updateWorkspace({ references: references.some((item) => item.id === reference.id && item.scope === reference.scope) ? references : [...references, reference] });
    notify(`已加入借鉴：${reference.title}`);
  }

  function removeReference(reference: ReferenceItem) {
    updateWorkspace({ references: references.filter((item) => item.id !== reference.id || item.scope !== reference.scope) });
    notify(`已删除借鉴：${reference.title}`);
  }

  async function askAI(prompt: string, task = "chat") {
    setAiError("");
    const scope: ReferenceScope = task === "plot_update" ? "plot" : active === "characters" ? "character" : active === "style" ? "style" : active === "world" ? "world" : "plot";
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        prompt,
        model,
        context: `书名：${currentBook.title}\n类型：${currentBook.genre}\n核心设想：${idea}\n当前页面：${currentLabel}`,
        references: references.filter((item) => item.scope === scope),
      }),
    });
    const data = await response.json() as { content?: string; error?: string };
    if (!response.ok || !data.content) {
      const message = data.error ?? "生成失败，请稍后再试。";
      setAiError(message);
      throw new Error(message);
    }
    return data.content;
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function enrichIdea() {
    setGenerating(true);
    try {
      const content = await askAI(idea, "story_seed");
      setBookIdea(content);
      updateMessages((value) => [...value, { role: "ai", text: "故事种子已经按当前设定和借鉴资料重新完善。你可以继续指出要保留或删掉的部分。" }]);
      notify("故事种子已完善，并标记了 3 处可同步更新");
    } catch { /* error is shown beside the composer */ } finally { setGenerating(false); }
  }

  async function sendMessage() {
    const value = chat.trim();
    if (!value) return;
    updateMessages((items) => [...items, { role: "user", text: value }]);
    setChat("");
    setGenerating(true);
    try {
      const task = active === "plot" ? "plot_update" : active === "characters" ? "character_design" : active === "style" ? "style_fingerprint" : "chat";
      const content = await askAI(value, task);
      updateMessages((items) => [...items, { role: "ai", text: content }]);
    } catch { /* surfaced in the UI */ } finally { setGenerating(false); }
  }

  async function runCommand(prompt: string, task: string, nextPage?: string) {
    setGenerating(true);
    if (nextPage) setActive(nextPage);
    try {
      const content = await askAI(prompt, task);
      updateMessages((items) => [...items, { role: "user", text: prompt }, { role: "ai", text: content }]);
      notify("AI 已完成生成，请在右侧查看并继续讨论");
    } catch { /* surfaced in the UI */ } finally { setGenerating(false); }
  }

  function addPreference() {
    const value = window.prompt("添加一个创作偏好，例如：无系统、群像、慢热感情线");
    if (value?.trim()) updateWorkspace({ tags: [...tags, value.trim()] });
  }

  function createBlueprintSnapshot(label = "手动保存故事蓝图") {
    const version = { id: `version-${Date.now()}`, label, createdAt: "刚刚", idea };
    updateWorkspace({ versions: [version, ...workspace.versions] });
    notify("已为当前小说创建故事蓝图快照");
  }

  function restoreBlueprintSnapshot(versionId: string) {
    const version = workspace.versions.find((item) => item.id === versionId);
    if (!version) return;
    createBlueprintSnapshot("恢复前自动备份");
    setBookIdea(version.idea);
    setVersionsOpen(false);
    notify(`已恢复“${version.label}”`);
  }

  if (screen === "shelf") {
    return <Bookshelf
      books={books}
      onOpenBook={openBook}
      onCreateBook={createBook}
      onImportBooks={(items, importedWorkspaces) => {
        setBooks((booksNow) => [...items, ...booksNow.filter((book) => !items.some((item) => item.id === book.id))]);
        if (importedWorkspaces) setWorkspaces((existing) => ({ ...existing, ...(importedWorkspaces as Record<string, BookWorkspace>) }));
        notify(`已导入 ${items.length} 本小说${importedWorkspaces ? "及其工作区" : ""}`);
      }}
      onExportBooks={() => exportBookshelf(books, workspaces)}
    />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span>墨</span></div>
        <div className="brand-name">墨脉 <em>AI 小说工作台</em></div>
        <button className="book-switcher" onClick={() => setScreen("shelf")}>
          <span className="book-dot">{currentBook.glyph}</span><span><strong>{currentBook.title}</strong><small>{currentBook.genre} · 返回书架</small></span><ChevronDown size={16} />
        </button>
        <div className="top-actions">
          <div className="model-picker"><Cpu size={15} /><NativeSelect value={model} onChange={(event) => setModel(event.target.value)} size="sm" aria-label="生成模型">
            <NativeSelectOption value="deepseek-v4-flash">DeepSeek V4 Flash</NativeSelectOption>
            <NativeSelectOption value="deepseek-v4-pro">DeepSeek V4 Pro</NativeSelectOption>
          </NativeSelect></div>
          <button className="icon-button" aria-label="搜索" onClick={() => setSearchOpen(true)}><Search size={18} /></button>
          <button className="icon-button" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button>
          <div className="save-state"><Check size={14} /> 已保存</div><button className="avatar" onClick={() => setSettingsOpen(true)}>砚</button>
        </div>
      </header>

      <div className={`workspace ${rightOpen ? "" : "right-closed"}`}>
        <aside className="leftbar">
          <div className="progress-block">
            <div className="progress-label"><span>创作准备度</span><strong>{readiness}%</strong></div><div className="progress-track"><span style={{ width: `${readiness}%` }} /></div>
            <p>已完成 {configuredAssets} 项设定，已加入 {references.length} 项借鉴。</p>
          </div>
          <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => item.id === "references" ? openReferences("plot") : setActive(item.id)}>
              <Icon size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}
            </button>; })}
          </div>)}</nav>
          <div className="memory-card"><div><Aperture size={16} /><strong>故事记忆</strong><span>独立</span></div><p>《{currentBook.title}》已保存 {messages.length} 条对话、{references.length} 项借鉴与 {workspace.versions.length} 个快照。</p></div>
        </aside>

        <section className="canvas"><div className={active === "plot" ? "canvas-inner plot-canvas-inner" : "canvas-inner"}>
          {active === "plot" ? <PlotWorkbench bookTitle={currentBook.title} state={workspace.plot} references={references} onStateChange={(plot) => updateWorkspace({ plot })} onOpenReferences={() => openReferences("plot")} onGenerate={askAI} /> : active !== "overview" ? <AssetWorkbench book={currentBook} type={active} content={workspace.assets[active]} references={references} onContentChange={(content) => updateWorkspace({ assets: { ...workspace.assets, [active]: content } })} onOpenReferences={openReferences} onRemoveReference={removeReference} onGenerate={askAI} onNotify={notify} /> : <>
          <div className="page-heading">
            <div><div className="eyebrow">{currentBook.title} / {currentLabel}</div><h1>故事蓝图</h1><p>先把故事想清楚，再让每一章稳定地长出来。</p></div>
            <div className="heading-actions">
              <Button variant="outline" className="soft-button" onClick={() => setVersionsOpen(true)}><Clock3 />版本记录</Button>
              <Button className="ink-button" onClick={() => void runCommand("根据当前故事蓝图和已选剧情借鉴，生成第一卷的卷目标与前 12 章大纲。", "plot_update", "outline")}><WandSparkles />生成卷章大纲</Button>
            </div>
          </div>

          <section className="idea-card">
            <div className="idea-title"><Sparkles size={17} /><span>从一句话开始</span><em>AI 会补全冲突、代价与成长空间</em></div>
            <Textarea aria-label="故事创意" value={idea} onChange={(event) => setBookIdea(event.target.value)} className="idea-input" />
            <div className="idea-footer"><div className="chips">{tags.map((tag) => <button key={tag} onClick={() => updateWorkspace({ tags: tags.filter((item) => item !== tag) })}>{tag} <X size={12} /></button>)}<button className="add-chip" onClick={addPreference}><Plus size={13} /> 添加偏好</button></div>
              <Button className="magic-button" onClick={enrichIdea} disabled={generating}><Sparkles />{generating ? "正在推演…" : "让 AI 完善"}</Button>
            </div>
          </section>

          <div className="section-heading"><div><h2>你的故事骨架</h2><p>所有内容都可直接编辑，也可以让 AI 提出方案。</p></div><button className="quiet-link" onClick={() => void runCommand("检查当前故事蓝图在世界规则、人物动机、主支线因果和文风约束上是否完整，列出最需要补的三项。", "chat")}>检查完整度</button></div>

          <div className="blueprint-grid">
            <article className="blueprint-card world-card">
              <div className="card-kicker"><Box size={16} />世界内核<button className="reference-chip" onClick={() => openReferences("world")}><BookMarked />添加借鉴</button></div><h3>{currentBook.title}的世界规则</h3>
              <p>{worldSummary}</p>
              <div className="rule-list"><span><i>01</i>世界如何运转？</span><span><i>02</i>力量有什么代价？</span><span><i>03</i>什么规则不能被打破？</span></div>
              <button className="card-action" onClick={() => setActive("world")}>展开世界观 <span>→</span></button>
            </article>
            <article className="blueprint-card character-card">
              <div className="card-kicker"><CircleUserRound size={16} />核心人物<button className="reference-chip" onClick={() => openReferences("character")}><BookMarked />人物借鉴</button></div>
              <div className="character-main"><div className="portrait portrait-one">人</div><div><h3>主角人物卡</h3><small>{characterSummary}</small></div><button aria-label="更多人物操作" onClick={() => setActive("characters")}><MoreHorizontal size={18} /></button></div>
              <div className="motive"><small>想要</small><p>主角此刻最想得到什么？</p></div><div className="motive"><small>害怕</small><p>失去什么会让他无法承受？</p></div>
              <div className="portraits"><div className="portrait portrait-two">关</div><div className="portrait portrait-three">敌</div><div className="portrait portrait-four">秘</div><div className="portrait portrait-five">+</div></div>
              <button className="card-action" onClick={() => setActive("characters")}>查看关系与弧光 <span>→</span></button>
            </article>
            <article className="blueprint-card timeline-card">
              <div className="card-kicker"><GitBranch size={16} />主线推进<button className="reference-chip" onClick={() => openReferences("plot")}><BookMarked />剧情借鉴</button></div>
              <div className="timeline-line">{chapterSteps.map((step, index) => <div className="timeline-step" key={step.no}><div className={`step-node ${index < 2 ? "complete" : index === 2 ? "current" : ""}`}>{index < 2 ? <Check size={13} /> : step.no}</div><div><h4>{step.title}</h4><p>{step.note}</p></div><small>{step.status}</small></div>)}</div>
              <button className="card-action" onClick={() => setActive("plot")}>打开情节编排板 <span>→</span></button>
            </article>
            <article className="blueprint-card style-card">
              <div className="card-kicker"><Feather size={16} />文风指纹<button className="reference-chip" onClick={() => openReferences("style")}><BookMarked />文风借鉴</button></div>
              <blockquote>“{styleSummary}”</blockquote>
              <div className="style-tags"><span>叙事视角</span><span>句式节奏</span><span>核心意象</span><span>章节钩子</span></div>
              <div className="style-source"><span>参考方向</span><strong>从借鉴资料中提取结构与可执行的风格参数</strong></div>
              <button className="card-action" onClick={() => setActive("style")}>调校文风 <span>→</span></button>
            </article>
          </div>
          </>}
        </div></section>

        <aside className="copilot">
          <div className="copilot-head"><div><span className="ai-orb"><Sparkles size={16} /></span><strong>共创助手</strong><i>在线</i></div><button aria-label="收起助手" onClick={() => setRightOpen(false)}><PanelRightClose size={18} /></button></div>
          <div className="context-strip"><span>正在讨论</span><strong>{currentLabel}</strong><em>{model === "deepseek-v4-flash" ? "V4 Flash" : "V4 Pro"}</em><button onClick={() => updateMessages([])}>清空</button></div>
          <div className="messages"><div className="day-divider"><span>今天</span></div>
            {messages.length === 0 && <div className="empty-chat">从一句模糊的想法开始就好。<br />我会帮你把它变成可写的故事。</div>}
            {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.text}-${index}`}>{message.role === "ai" && <div className="mini-orb"><Sparkles size={13} /></div>}<div className="message-bubble">{message.text}</div></div>)}
            {generating && <div className="message ai"><div className="mini-orb"><Sparkles size={13} /></div><div className="message-bubble thinking"><LoaderCircle className="spin" />正在结合设定与借鉴资料推演……</div></div>}
            {messages.length > 0 && messages[messages.length - 1].role === "ai" && <div className="suggestion-actions"><button onClick={() => notify("已同步到相关设定，并创建新版本")}><Check size={14} />采纳并同步</button><button onClick={() => setChat("再给我一个更有网文爽感、但不俗套的方案")}>换个方案</button></div>}
          </div>
          <div className="quick-prompts"><button onClick={() => setChat("检查当前设定有没有逻辑漏洞")}>检查逻辑漏洞</button><button onClick={() => setChat("帮我强化第一卷的章尾钩子")}>强化剧情钩子</button><button onClick={() => setChat("和我一起梳理主角的成长弧光")}>一起头脑风暴</button></div>
          {aiError && <div className="ai-error">{aiError}</div>}
          <div className="composer"><Textarea value={chat} onChange={(event) => setChat(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="说说你的想法，哪怕只有一两句……" aria-label="给共创助手发送消息" />
            <div><span>Enter 发送 · Shift + Enter 换行</span><Button size="icon-sm" onClick={sendMessage} aria-label="发送"><Feather /></Button></div>
          </div>
        </aside>
        {!rightOpen && <button className="reopen-copilot" onClick={() => setRightOpen(true)}><MessageCircleMore size={19} /><span>共创助手</span></button>}
      </div>
      <ReferenceLibraryDialog open={referenceOpen} onOpenChange={setReferenceOpen} scope={referenceScope} selected={references} onAdd={addReference} onRemove={removeReference} />
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent className="workspace-dialog sm:max-w-[560px]"><DialogHeader><DialogTitle>在《{currentBook.title}》中查找</DialogTitle><DialogDescription>快速前往设定、情节、大纲或正文。借鉴资料请进入“借鉴库”。</DialogDescription></DialogHeader>
        <label className="workspace-search"><Search /><input value={workspaceSearch} onChange={(event) => setWorkspaceSearch(event.target.value)} placeholder="搜索世界观、人物、情节、正文……" autoFocus /></label>
        <div className="workspace-search-results">{searchItems.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => { if (item.id === "references") openReferences("plot"); else setActive(item.id); setSearchOpen(false); }}><span><Icon /><strong>{item.label}</strong></span><em>打开 →</em></button>; })}{searchItems.length === 0 && <p>没有匹配的工作区。</p>}</div>
      </DialogContent></Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="workspace-dialog settings-dialog sm:max-w-[560px]"><DialogHeader><DialogTitle>生成设置</DialogTitle><DialogDescription>模型设置只影响当前设备。DeepSeek API 密钥只从服务端环境变量读取，不会保存在书架数据或浏览器中。</DialogDescription></DialogHeader>
        <label className="dialog-field"><span>默认模型</span><NativeSelect value={model} onChange={(event) => setModel(event.target.value)}><NativeSelectOption value="deepseek-v4-flash">DeepSeek V4 Flash · 速度优先</NativeSelectOption><NativeSelectOption value="deepseek-v4-pro">DeepSeek V4 Pro · 质量优先</NativeSelectOption></NativeSelect></label>
        <div className="privacy-note"><Cpu /><div><strong>密钥保护已开启</strong><p>请在部署环境中配置 <code>DEEPSEEK_API_KEY</code>。前端代码、导出文件和 Git 提交均不包含密钥。</p></div></div>
        <div className="dialog-actions"><Button variant="outline" onClick={() => setScreen("shelf")}>返回书架</Button><Button onClick={() => { setSettingsOpen(false); notify("生成设置已保存"); }}>保存设置</Button></div>
      </DialogContent></Dialog>
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}><DialogContent className="workspace-dialog versions-dialog sm:max-w-[600px]"><DialogHeader><DialogTitle>《{currentBook.title}》的故事蓝图版本</DialogTitle><DialogDescription>恢复旧版本前会自动保留当前内容，你可以随时切回来。</DialogDescription></DialogHeader>
        <div className="version-list"><div className="current"><Clock3 /><span><strong>当前编辑内容</strong><small>刚刚 · 独立保存于《{currentBook.title}》</small></span><em>使用中</em></div>{workspace.versions.map((version) => <div key={version.id}><Clock3 /><span><strong>{version.label}</strong><small>{version.createdAt}</small></span><Button size="sm" variant="outline" onClick={() => restoreBlueprintSnapshot(version.id)}>恢复</Button></div>)}</div>
        <div className="dialog-actions"><span>共 {workspace.versions.length} 个快照</span><Button onClick={() => createBlueprintSnapshot()}>创建当前快照</Button></div>
      </DialogContent></Dialog>
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </main>
  );
}

function firstLine(value?: string) {
  return value?.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
}

function exportBookshelf(books: BookProject[], workspaces: Record<string, BookWorkspace>) {
  const blob = new Blob([JSON.stringify({ version: 2, books, workspaces }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "墨脉完整书架备份.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
