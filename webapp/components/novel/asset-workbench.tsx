"use client";

import { useState } from "react";
import { BookMarked, BookOpen, Box, Check, CircleUserRound, Clock3, Download, Feather, GitCommit, Library, LoaderCircle, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { assetInitialContent } from "./book-workspace";
import type { BookProject } from "./bookshelf";
import type { ReferenceItem, ReferenceScope } from "./reference-library-dialog";

type Props = {
  book: BookProject;
  type: string;
  content?: string;
  references: ReferenceItem[];
  onContentChange: (content: string) => void;
  onOpenReferences: (scope: ReferenceScope) => void;
  onRemoveReference: (reference: ReferenceItem) => void;
  onGenerate: (prompt: string, task: string) => Promise<string>;
  onNotify: (message: string) => void;
};

type LocalDirectoryHandle = {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>;
};

const configs: Record<string, { title: string; desc: string; icon: typeof Box; scope: ReferenceScope; task: string }> = {
  world: { title: "世界观", desc: "定义这个世界能发生什么、不能发生什么，以及一切力量的代价。", icon: Box, scope: "world", task: "chat" },
  characters: { title: "人物角色", desc: "让人物拥有独立欲望、恐惧、秘密与会发生变化的关系。", icon: CircleUserRound, scope: "character", task: "character_design" },
  timeline: { title: "世界线", desc: "固定历史事件与故事现在，避免时间、年龄和因果关系漂移。", icon: Clock3, scope: "world", task: "chat" },
  style: { title: "文风指纹", desc: "把抽象的“像某种作品”转化为可执行、可调节的写作参数。", icon: Feather, scope: "style", task: "style_fingerprint" },
  outline: { title: "卷章大纲", desc: "把主线和支线落实到每一卷、每一章的冲突、转折与钩子。", icon: Library, scope: "plot", task: "plot_update" },
  chapters: { title: "章节正文", desc: "在设定、人物、大纲和文风约束下写作，并保留每次修改。", icon: BookOpen, scope: "plot", task: "chat" },
};

export function AssetWorkbench({ book, type, content, references, onContentChange, onOpenReferences, onRemoveReference, onGenerate, onNotify }: Props) {
  const config = configs[type] ?? configs.world;
  const Icon = config.icon;
  const [loading, setLoading] = useState(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const [request, setRequest] = useState(placeholderFor(type));
  const editorContent = content ?? assetInitialContent(type, book);
  const scopedReferences = references.filter((item) => item.scope === config.scope);

  async function generate() {
    if (!request.trim()) return;
    setLoading(true);
    try {
      const result = await onGenerate(request, config.task);
      onContentChange(result);
      onNotify(`${config.title}已生成新版本`);
    } finally { setLoading(false); }
  }

  async function saveChapterToDirectory() {
    const picker = window as typeof window & { showDirectoryPicker?: () => Promise<LocalDirectoryHandle> };
    if (!picker.showDirectoryPicker) {
      downloadChapter(editorContent, book.title);
      onNotify("当前浏览器不支持目录写入，已改为下载 Markdown 文件");
      return;
    }
    setSavingLocal(true);
    try {
      const directory = await picker.showDirectoryPicker();
      const filename = `${safeFilename(book.title)}-第1章.md`;
      const file = await directory.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(editorContent);
      await writable.close();
      onNotify(`已保存到所选目录：${filename}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onNotify("保存到本地目录失败，请重新选择一个可写目录");
    } finally { setSavingLocal(false); }
  }

  return <div className="asset-workbench">
    <div className="page-heading asset-heading"><div><div className="eyebrow">{book.title} / {config.title}</div><h1>{config.title}</h1><p>{config.desc}</p></div><div className="heading-actions"><Button variant="outline" onClick={() => onOpenReferences(config.scope)}><BookMarked />添加借鉴</Button>{type === "chapters" && <Button variant="outline" onClick={() => void saveChapterToDirectory()} disabled={savingLocal}>{savingLocal ? <LoaderCircle className="spin" /> : <Download />}保存到本地路径</Button>}<Button className="ink-button" onClick={generate} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Sparkles />}AI 生成新版</Button></div></div>
    <section className="asset-layout">
      <div className="asset-editor">
        <div className="asset-editor-head"><span><Icon />当前版本</span><div><em>本书独立保存</em><Button size="sm" variant="outline" onClick={() => { onContentChange(editorContent); onNotify("已保存到这本书的工作区"); }}><Save />保存</Button></div></div>
        <Textarea value={editorContent} onChange={(event) => onContentChange(event.target.value)} aria-label={`${config.title}编辑器`} />
        <footer><span><Check />已保存至《{book.title}》</span><span>{editorContent.length.toLocaleString()} 字</span></footer>
      </div>
      <aside className="asset-side">
        <section className="asset-ai-card"><header><span><Sparkles /></span><div><strong>让 AI 修改</strong><p>用自然语言描述，不需要写提示词</p></div></header><Textarea value={request} onChange={(event) => setRequest(event.target.value)} /><Button onClick={generate} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Sparkles />}生成并替换编辑器</Button></section>
        <section className="asset-reference-card"><header><strong>本页借鉴</strong><button onClick={() => onOpenReferences(config.scope)}><Plus />添加</button></header>{scopedReferences.length === 0 ? <div className="asset-no-reference"><BookMarked /><p>尚未选择借鉴资料</p></div> : scopedReferences.map((item) => <div className="asset-reference-row" key={`${item.id}-${item.scope}`}><span>{item.source === "网页搜索" ? "网" : item.source === "本地文件" ? "本" : "书"}</span><div><strong>{item.title}</strong><small>{item.source}</small></div><button className="remove-reference" onClick={() => onRemoveReference(item)} aria-label={`删除借鉴 ${item.title}`}><Trash2 /></button></div>)}</section>
        <section className="asset-version-card"><strong>最近版本</strong><div><GitCommit /><span>当前编辑版本<small>刚刚</small></span></div><div><GitCommit /><span>AI 生成版本<small>保存在《{book.title}》内</small></span></div></section>
      </aside>
    </section>
  </div>;
}

function placeholderFor(type: string) {
  const values: Record<string, string> = {
    world: "补全这个世界的社会运行方式，并让力量的代价真正影响普通人的生活。",
    characters: "借鉴已选人物的功能与弧光，重新设计一个立场会变化的关键配角。",
    timeline: "检查过去事件、现在冲突与未来转折之间的时间因果。",
    style: "保持既定意象和叙述距离，但让动作场面更有速度感。",
    outline: "重做第一卷大纲，让每三章形成一次小高潮，并保留章尾钩子。",
    chapters: "续写当前场景，强化动作、选择和人物之间的潜台词。",
  };
  return values[type] ?? values.world;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名小说";
}

function downloadChapter(content: string, title: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(title)}-第1章.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
