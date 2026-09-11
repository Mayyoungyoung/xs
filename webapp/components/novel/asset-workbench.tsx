"use client";

import { useRef, useState } from "react";
import { BookMarked, BookOpen, Box, Check, CircleUserRound, Clock3, Download, Feather, Library, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { withSnapshot, type BookWorkspace, type PlotGenerationOptions } from "./book-workspace";
import { writingGuidance } from "@/lib/writing-guidance";
import { downloadText, wordCount } from "@/lib/novel-data";
import type { BookProject } from "./bookshelf";
import type { ReferenceItem, ReferenceScope } from "./reference-library-dialog";
import { ChapterRoadmap } from "./chapter-roadmap";
import { anchorFromRange, type CoModuleId, type CoTarget, type TextAnchor } from "@/lib/co-creation";
import type { AdoptOptions, AdoptOutcome } from "./co-creation-panel";
import { CoCreationPanel } from "./co-creation-panel";

type Props = {
  embedded?: boolean;
  book: BookProject; type: string; workspace: BookWorkspace; busy: boolean; saveState: string;
  connection: string;
  references: ReferenceItem[];
  onContentChange: (content: string, snapshot?: boolean) => void;
  onWorkspaceChange: (patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) => void;
  onOpenReferences: (scope: ReferenceScope) => void;
  onRemoveReference: (reference: ReferenceItem) => void;
  onGenerate: (prompt: string, task: string, options?: PlotGenerationOptions) => Promise<string>;
  onAdopt: (proposalId: string, options: AdoptOptions) => AdoptOutcome;
  onCancel: () => void;
  onNotify: (message: string) => void;
};
type LocalDirectoryHandle = {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>;
};
const configs: Record<string, { title: string; desc: string; icon: typeof Box; scope: ReferenceScope; task: string }> = {
  world: { title: "世界观", desc: "定义世界规则、社会运行与力量的代价。", icon: Box, scope: "world", task: "world_design" },
  characters: { title: "人物角色", desc: "记录欲望、恐惧、秘密与关系变化。", icon: CircleUserRound, scope: "character", task: "character_design" },
  timeline: { title: "时间与因果", desc: "记录故事前史、事件顺序与人物年龄，对照剧情图检查因果。", icon: Clock3, scope: "plot", task: "timeline_design" },
  style: { title: "文笔文风", desc: "形成可执行的视角、节奏、意象与对话原则。", icon: Feather, scope: "style", task: "style_fingerprint" },
  outline: { title: "卷章大纲", desc: "把主支线落实为章节冲突、转折与钩子。", icon: Library, scope: "plot", task: "outline_design" },
  chapters: { title: "章节正文", desc: "按章节写作，参考设定和前文，预览后采纳生成内容。", icon: BookOpen, scope: "plot", task: "chapter_write" },
};
export function AssetWorkbench({ embedded = false, book, type, workspace, busy, saveState, connection, references, onContentChange, onWorkspaceChange, onOpenReferences, onRemoveReference, onGenerate, onAdopt, onCancel, onNotify }: Props) {
  const config = configs[type] ?? configs.world;
  const Icon = config.icon;
  const [savingLocal, setSavingLocal] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<TextAnchor | null>(null);
  const [polishRun, setPolishRun] = useState<{ id: number; instruction: string; task?: string } | null>(null);
  const polishCounter = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const guidance = writingGuidance(type, book, workspace);
  const chapter = workspace.chapters.find((c) => c.id === workspace.activeChapterId) ?? workspace.chapters[0];
  const editorContent = type === "chapters" ? chapter.content : workspace.assets[type] ?? "";
  const versionKey = type === "chapters" ? `chapter:${chapter.id}` : type;
  const review = workspace.reviews[versionKey] ?? "";
  const target: CoTarget = { moduleId: type as CoModuleId, ...(type === "chapters" ? { entityId: chapter.id } : {}) };
  function setReview(content: string) { onWorkspaceChange((w) => ({ ...w, reviews: { ...w.reviews, [versionKey]: content } })); }
  const versions = workspace.assetVersions[versionKey] ?? [];
  const scopedReferences = references.filter((item) => item.scope === config.scope);

  function captureSelection(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    setSelection(anchorFromRange(field.value, field.selectionStart ?? 0, field.selectionEnd ?? 0));
  }

  // Polish, continue and local rewrite all go through the co-creation panel, so
  // every AI result becomes a candidate bound to this chapter. Generating never
  // writes the chapter's recommended event binding: that stays the author's
  // explicit confirmation in the chapter roadmap.
  function requestPolish() {
    polishCounter.current += 1;
    setPolishRun({ id: polishCounter.current, instruction: "", task: "chapter_polish" });
  }

  async function reviewChapter() {
    if (!editorContent.trim() || busy) return;
    setError("");
    try {
      const result = await onGenerate("结合本书设定与前文审查当前章节，给出具体位置及修改建议。", "continuity_review");
      setReview(result);
      onNotify("审查完成，正文保持原样");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败，请重试。"); }
  }

  function addChapter() {
    const next = { id: crypto.randomUUID(), title: `第 ${workspace.chapters.length + 1} 章`, content: "", updatedAt: new Date().toISOString() };
    onWorkspaceChange((w) => ({ ...w, chapters: [...w.chapters, next], activeChapterId: next.id }));
    setSelection(null);
  }
  function deleteChapter() {
    if (!window.confirm(`删除“${chapter.title}”？删除前会保留完整故事快照。`)) return;
    onWorkspaceChange((w) => ({ ...withSnapshot(w, `删除章节：${chapter.title}`), chapters: w.chapters.filter((c) => c.id !== chapter.id), activeChapterId: w.chapters.find((c) => c.id !== chapter.id)!.id }));
  }
  function exportBook() {
    const text = `# ${book.title}\n\n${workspace.chapters.map((c) => `## ${c.title}\n\n${c.content}`).join("\n\n---\n\n")}`;
    downloadText(text, `${book.title}-全书.md`); onNotify("已导出全部章节");
  }
  async function saveToDirectory() {
    const filename = `${book.title}-${type === "chapters" ? chapter.title : config.title}.md`.replace(/[\\/:*?"<>|]/g, "_");
    const picker = window as typeof window & { showDirectoryPicker?: () => Promise<LocalDirectoryHandle> };
    if (!picker.showDirectoryPicker) { downloadText(editorContent, filename); onNotify("已下载 Markdown 文件"); return; }
    setSavingLocal(true);
    try {
      const directory = await picker.showDirectoryPicker();
      const file = await directory.getFileHandle(filename, { create: true });
      const writable = await file.createWritable(); await writable.write(editorContent); await writable.close();
      onNotify(`已保存：${filename}`);
    } catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("目录写入失败，请使用导出文件或重选可写目录。"); }
    finally { setSavingLocal(false); }
  }
  return <div className="asset-workbench">
    <div className={embedded ? "worldline-view-heading asset-heading" : "page-heading asset-heading"}><div>{!embedded && <div className="eyebrow">{book.title} / {config.title}</div>}{embedded ? <h2>{config.title}</h2> : <h1>{config.title}</h1>}<p>{config.desc}</p></div><div className="heading-actions"><Button variant="outline" onClick={() => void saveToDirectory()} disabled={savingLocal}>{savingLocal ? <LoaderCircle className="spin" /> : <Download />}导出文件</Button></div></div>
    {type === "chapters" && <section className="chapter-toolbar">
      <NativeSelect aria-label="当前章节" disabled={busy} value={chapter.id} onChange={(e) => { onWorkspaceChange({ activeChapterId: e.target.value }); setSelection(null); }}>{workspace.chapters.map((c) => <NativeSelectOption value={c.id} key={c.id}>{c.title} · {wordCount(c.content)} 字</NativeSelectOption>)}</NativeSelect>
      <input aria-label="章节标题" value={chapter.title} onChange={(e) => { const title = e.target.value; onWorkspaceChange((w) => ({ ...w, chapters: w.chapters.map((c) => c.id === chapter.id ? { ...c, title: title || "未命名章节" } : c) })); }} />
      <Button variant="outline" disabled={busy} onClick={addChapter}><Plus />新章节</Button>
      <Button variant="outline" disabled={busy || workspace.chapters.length < 2} onClick={deleteChapter}><Trash2 />删除本章</Button>
      <Button variant="outline" onClick={exportBook}><Download />导出全书</Button>
    </section>}
    {type === "chapters" && <ChapterRoadmap workspace={workspace} busy={busy} onChange={onWorkspaceChange} />}
    <section className="asset-layout"><div>
      <div className="asset-editor"><div className="asset-editor-head"><span><Icon />{type === "chapters" ? chapter.title : "当前内容"}</span><Button size="sm" variant="outline" onClick={() => { onContentChange(editorContent, true); onNotify("已创建当前内容快照"); }}><Save />保存快照</Button></div>
        <Textarea ref={editorRef} value={editorContent} placeholder={guidance.placeholder} onChange={(event) => { onContentChange(event.target.value); setSelection(null); }} onSelect={captureSelection} onBlur={captureSelection} aria-label={`${config.title}编辑器`} />
        <footer><span><Check />{saveState}</span><span>{wordCount(editorContent).toLocaleString()} 字</span></footer>
      </div>
      {error && <p className="ai-error" role="alert">{error}</p>}
      {type === "chapters" && <div className="chapter-ai-actions"><Button variant="outline" disabled={busy || !editorContent.trim()} onClick={requestPolish}>润色本章</Button><Button variant="outline" disabled={busy || !editorContent.trim()} onClick={() => void reviewChapter()}>连续性检查</Button></div>}
      {review && <section className="generation-preview"><h2>连续性审查</h2><div className="review-text">{review}</div><Button variant="outline" onClick={() => downloadText(review, `${book.title}-${chapter.title}-审查.md`)}>导出审查</Button></section>}
    </div><aside className="asset-side">
      <CoCreationPanel
        bookId={book.id}
        workspace={workspace}
        target={target}
        busy={busy}
        modelConnection={connection}
        saveState={saveState}
        selection={selection}
        onWorkspaceChange={onWorkspaceChange}
        onGenerate={onGenerate}
        onAdopt={onAdopt}
        onCancel={onCancel}
        onNotify={onNotify}
        onOpenReferences={onOpenReferences}
        onRemoveReference={onRemoveReference}
        onFocusEditor={() => editorRef.current?.focus()}
        externalRun={polishRun}
      />
      <section className="asset-reference-card"><header><strong>本页借鉴</strong><button onClick={() => onOpenReferences(config.scope)}><Plus />添加</button></header>{scopedReferences.length === 0 ? <div className="asset-no-reference"><BookMarked /><p>尚未选择借鉴资料</p></div> : scopedReferences.map((item) => <div className="asset-reference-row" key={`${item.id}-${item.scope}`}><div><strong>{item.title}</strong><small>{item.source}</small></div><button className="remove-reference" onClick={() => onRemoveReference(item)} aria-label={`删除借鉴 ${item.title}`}><Trash2 /></button></div>)}</section>
      <section className="asset-version-card"><strong>版本记录 · 最近 30 次</strong>{versions.length === 0 && <p>保存快照或采纳生成内容后，可在此恢复。</p>}{versions.map((version) => <div key={version.id}><Save /><span>{version.label}<small>{version.createdAt}</small></span><Button variant="outline" size="sm" onClick={() => { onContentChange(version.content, true); onNotify("已恢复，恢复前内容已备份"); }}>恢复</Button></div>)}</section>
    </aside></section>
  </div>;
}
