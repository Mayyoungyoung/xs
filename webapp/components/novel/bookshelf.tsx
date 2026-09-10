"use client";

import { useMemo, useRef, useState } from "react";
import { BookOpen, Check, Clock3, Feather, FolderOpen, Trash2, Plus, Search, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export type BookProject = {
  id: string;
  title: string;
  genre: string;
  premise: string;
  chapters: number;
  words: number;
  progress: number;
  updatedAt: string;
  accent: string;
  glyph: string;
};

type Props = {
  books: BookProject[];
  saveState: string;
  onDeleteBook: (id: string) => void;
  onOpenBook: (book: BookProject) => void;
  onCreateBook: (book: BookProject) => void;
  onImportBooks: (books: BookProject[], workspaces?: Record<string, unknown>) => void;
  onExportBooks: () => void;
  onOpenSettings: () => void;
};

import { parseBackup } from "@/lib/novel-data";

export const initialBooks: BookProject[] = [
  { id: "spirit-scroll", title: "灵脉残卷", genre: "玄幻悬疑", premise: "修复师回到被大雾封锁的故乡，发现所有人都在忘记同一天。", chapters: 0, words: 0, progress: 0, updatedAt: "刚刚", accent: "#7f302a", glyph: "灵" },
  { id: "chang-an", title: "长安无梦", genre: "古风权谋", premise: "女史官在被篡改的起居注中，寻找一位从未登基的皇帝。", chapters: 0, words: 0, progress: 0, updatedAt: "昨天", accent: "#304d57", glyph: "安" },
  { id: "star-harbor", title: "第七码头", genre: "科幻冒险", premise: "每艘归港的飞船，都比离开时少一个人。", chapters: 0, words: 0, progress: 0, updatedAt: "4 天前", accent: "#51476a", glyph: "七" },
];

export function Bookshelf({ books, saveState, onDeleteBook, onOpenBook, onCreateBook, onImportBooks, onExportBooks, onOpenSettings }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [createOpen, setCreateOpen] = useState(false);
  const [shelfInfoOpen, setShelfInfoOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("玄幻");
  const [premise, setPremise] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shownBooks = useMemo(() => {
    const filtered = books.filter((book) => `${book.title}${book.genre}${book.premise}`.toLowerCase().includes(query.toLowerCase()));
    return [...filtered].sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "progress" ? b.progress - a.progress : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  }, [books, query, sort]);

  function createBook() {
    if (!title.trim()) return;
    const glyph = title.trim().slice(0, 1);
    const book: BookProject = { id: crypto.randomUUID(), title: title.trim(), genre, premise: premise.trim(), chapters: 0, words: 0, progress: 0, updatedAt: new Date().toISOString(), accent: ["#7f302a", "#304d57", "#51476a", "#655235"][books.length % 4], glyph };
    onCreateBook(book); setCreateOpen(false); setTitle(""); setPremise("");
  }

  async function importProjects(files: FileList | null) {
    if (!files?.[0]) return;
    try {
      if (files[0].size > 100 * 1024 * 1024) throw new Error("备份超过 100 MB，请拆分后导入。");
      const parsed = parseBackup(JSON.parse(await files[0].text()));
      if (!parsed.books.length) throw new Error("备份中没有小说。");
      const conflicts = parsed.books.filter((b) => books.some((existing) => existing.id === b.id));
      if (conflicts.length && !window.confirm(`导入将覆盖 ${conflicts.length} 本同编号小说。请确认已有备份后继续。`)) return;
      onImportBooks(parsed.books, parsed.workspaces);
    } catch (error) { window.alert(error instanceof Error ? error.message : "项目文件无法识别，请选择墨脉备份。"); }
    finally { if (inputRef.current) inputRef.current.value = ""; }
  }

  return <main className="shelf-shell">
    <header className="shelf-topbar"><div className="brand-mark"><span>墨</span></div><div className="brand-name">墨脉 <em>AI 小说工作台</em></div>
      <nav><button className="active" onClick={() => { setQuery(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>我的书架</button><button onClick={() => inputRef.current?.click()}>导入项目</button><button onClick={onExportBooks}>导出备份</button><button className="shelf-settings-button" onClick={onOpenSettings}><Settings2 size={16} />模型设置</button></nav>
      <div className="shelf-user"><span>{saveState}</span><button className="avatar" onClick={() => setShelfInfoOpen(true)}>砚</button></div>
    </header>
    <div className="shelf-content">
      <section className="shelf-heading"><div><span className="shelf-eyebrow"><Sparkles />你的故事宇宙</span><h1>我的书架</h1><p>每一本书都是独立的世界、人物、剧情与记忆。</p></div><Button className="create-book-button" onClick={() => setCreateOpen(true)}><Plus />创建新小说</Button></section>
      <section className="shelf-toolbar"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名、类型或故事梗概" /></label>
        <NativeSelect value={sort} onChange={(event) => setSort(event.target.value)} aria-label="书架排序"><NativeSelectOption value="updated">最近编辑</NativeSelectOption><NativeSelectOption value="title">按书名</NativeSelectOption><NativeSelectOption value="progress">按准备度</NativeSelectOption></NativeSelect>
        <input ref={inputRef} type="file" accept=".json" hidden onChange={(event) => void importProjects(event.target.files)} />
      </section>
      <section className="book-grid">
        <button className="new-book-card" onClick={() => setCreateOpen(true)}><span><Plus /></span><strong>创建一本新小说</strong><p>只说一两句话，剩下的和 AI 一起完善</p></button>
        {shownBooks.map((book) => <article className="book-card" key={book.id} role="button" tabIndex={0} onClick={() => onOpenBook(book)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenBook(book); } }}>
          <div className="book-cover" style={{ background: `linear-gradient(145deg,${book.accent},#222)` }}><i>墨脉原创</i><strong>{book.title}</strong><span>{book.glyph}</span><small>{book.genre}</small></div>
          <div className="book-info"><div className="book-title-row"><div><h2>{book.title}</h2><span>{book.genre}</span></div><button aria-label={`删除 ${book.title}`} onClick={(event) => { event.stopPropagation(); if (window.confirm(`删除《${book.title}》及其全部工作区？此操作不可撤销，请先导出备份。`)) onDeleteBook(book.id); }}><Trash2 /></button></div>
            <p>{book.premise || "还没有故事构想，进入工作区开始创作。"}</p><div className="book-preparation-label"><span>创作准备度</span><strong>{book.progress === 0 ? "未开始" : book.chapters > 0 ? "正在写作" : "构思中"}</strong></div><div className="book-progress" title="按世界观、人物、世界线、文风、大纲、剧情结构、正文 7 项实际内容统计；不代表全书完成度"><span><i style={{ width: `${book.progress}%` }} /></span><em>{book.progress}%</em></div>
            <footer><span><BookOpen />{book.chapters} 章</span><span><Feather />{book.words.toLocaleString()} 字</span><span><Clock3 />{Number.isNaN(Date.parse(book.updatedAt)) ? book.updatedAt : new Date(book.updatedAt).toLocaleDateString("zh-CN")}</span></footer>
          </div>
        </article>)}
      </section>
      {shownBooks.length === 0 && <div className="shelf-empty"><FolderOpen /><strong>没有找到匹配的小说</strong><p>换个关键词，或者创建一本新书。</p></div>}
      {books[0] && <section className="shelf-tip"><Sparkles /><div><strong>继续你的故事</strong><p>《{books[0].title}》已有 {books[0].chapters} 章正文、{books[0].words.toLocaleString()} 字。设定与章节都可在工作区继续编辑。</p></div><Button variant="outline" onClick={() => onOpenBook(books[0])}>继续写作</Button></section>}
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="create-book-dialog sm:max-w-[600px]"><DialogHeader><DialogTitle>创建新小说</DialogTitle><DialogDescription>有完整构想可以直接填写；只有一两句话也没关系。</DialogDescription></DialogHeader>
      <label className="form-field"><span>书名</span><input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给这个世界一个名字" autoFocus /></label>
      <label className="form-field"><span>类型</span><NativeSelect value={genre} onChange={(event) => setGenre(event.target.value)}><NativeSelectOption value="玄幻">玄幻</NativeSelectOption><NativeSelectOption value="仙侠">仙侠</NativeSelectOption><NativeSelectOption value="都市">都市</NativeSelectOption><NativeSelectOption value="科幻">科幻</NativeSelectOption><NativeSelectOption value="悬疑">悬疑</NativeSelectOption><NativeSelectOption value="历史">历史</NativeSelectOption><NativeSelectOption value="言情">言情</NativeSelectOption></NativeSelect></label>
      <label className="form-field"><span>一句话构想</span><Textarea value={premise} onChange={(event) => setPremise(event.target.value)} placeholder="例如：一个能听见旧物记忆的修复师，回到被大雾封锁的故乡……" /></label>
      <div className="create-book-actions"><p>创建后先进入故事蓝图，你可以让 AI 逐项生成设定。</p><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button onClick={createBook} disabled={!title.trim()}><Sparkles />创建并进入</Button></div>
    </DialogContent></Dialog>
    <Dialog open={shelfInfoOpen} onOpenChange={setShelfInfoOpen}><DialogContent className="workspace-dialog shelf-info-dialog sm:max-w-[520px]"><DialogHeader><DialogTitle>书架与数据</DialogTitle><DialogDescription>当前书架包含 {books.length} 本小说，书架索引与编辑草稿默认保存在此设备。</DialogDescription></DialogHeader>
      <div className="privacy-note"><Check /><div><strong>{saveState}</strong><p>你可以随时使用“导出备份”保存 JSON 文件，再通过“导入项目”恢复。</p></div></div>
      <div className="dialog-actions"><Button onClick={() => setShelfInfoOpen(false)}>知道了</Button></div>
    </DialogContent></Dialog>
  </main>;
}
