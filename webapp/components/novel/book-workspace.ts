import type { BookProject } from "./bookshelf";
import type { ReferenceItem } from "./reference-library-dialog";
import { getRoadmap, worldlineContext, type StoryRoadmap } from "@/lib/story-roadmap";
import { normalizeLocks, normalizeProposals, normalizeThreads, normalizeView, type CoProposalRecord, type CoThreads, type ContextPacket, type LockMap } from "@/lib/co-creation";

export type StoryMessage = { role: "ai" | "user"; text: string };
// A context packet, when present, is the exact payload sent to the model.
export type PlotGenerationOptions = { messages?: StoryMessage[]; context?: string; packet?: ContextPacket };
export type PlotProposal = { summary: string; nodes: Array<{ title: string; chapter: string; note: string }>; branches: PlotBranch[]; roadmap?: StoryRoadmap };

export type PlotBranch = {
  id: string;
  title: string;
  color: string;
  path: string;
  labels: Array<{ x: number; y: number; text: string }>;
  from?: number;
  to?: number;
  status?: "planned" | "active" | "resolved";
};

export type PlotState = {
  instruction: string;
  branches: PlotBranch[];
  selected: string;
  selectedNode: string;
  zoom: number;
  version: number;
  nodes?: Array<{ title: string; chapter: string; note: string }>;
  summary?: string;
  discussion?: StoryMessage[];
  discussionDraft?: string;
  proposal?: PlotProposal;
  roadmap?: StoryRoadmap;
};

export type Chapter = { id: string; title: string; content: string; updatedAt: string; plotEventIds?: string[] };
export type AssetVersion = { id: string; label: string; createdAt: string; content: string };
export type StorySnapshot = Pick<BookWorkspace, "idea" | "tags" | "references" | "assets" | "plot" | "chapters" | "activeChapterId">;

export type BlueprintVersion = {
  id: string;
  label: string;
  createdAt: string;
  idea: string;
  snapshot?: StorySnapshot;
};

export type BookWorkspace = {
  idea: string;
  messages: StoryMessage[];
  tags: string[];
  references: ReferenceItem[];
  assets: Record<string, string>;
  plot: PlotState;
  versions: BlueprintVersion[];
  chapters: Chapter[];
  activeChapterId: string;
  assetVersions: Record<string, AssetVersion[]>;
  proposals: Record<string, string>;
  reviews: Record<string, string>;
  threads: CoThreads;
  coProposals: CoProposalRecord[];
  locks: LockMap;
  view: Record<string, Record<string, number>>;
};

// Viewport/zoom preferences are stored per module and never touch revisions.
export type ViewState = { x: number; y: number; scale: number; lod?: number };

export function createBookWorkspace(book: BookProject): BookWorkspace {
  const idea = book.premise;
  return {
    idea,
    messages: [{ role: "ai", text: `《${book.title}》已经建立独立创作空间。先补全一句话故事、世界规则或人物动机，我会只参考这本书的设定与借鉴资料。` }],
    tags: [book.genre],
    references: [],
    assets: {},
    chapters: [{ id: "chapter-1", title: "第 1 章", content: "", updatedAt: "" }],
    activeChapterId: "chapter-1",
    assetVersions: {},
    proposals: {},
    reviews: {},
    threads: {},
    coProposals: [],
    locks: {},
    view: {},
    plot: {
      instruction: `为《${book.title}》设计一条围绕核心冲突展开的支线，在中段与主线交汇，并在结局前回收。`,
      branches: [],
      selected: "main",
      selectedNode: "",
      zoom: 1,
      version: 1,
    },
    versions: [{ id: "initial", label: "创建小说", createdAt: "初始版本", idea }],
  };
}

// Input coming from storage, imports or the desktop bridge: content fields are
// typed, while co-creation state arrives unvalidated and gets normalized below.
export type SavedWorkspaceInput = Partial<Omit<BookWorkspace, "threads" | "coProposals" | "locks" | "view">> & {
  threads?: unknown;
  coProposals?: unknown;
  locks?: unknown;
  view?: unknown;
};

export function mergeBookWorkspace(book: BookProject, saved?: SavedWorkspaceInput | null): BookWorkspace {
  const base = createBookWorkspace(book);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    assets: { ...base.assets, ...saved.assets },
    chapters: saved.chapters?.length ? saved.chapters : [{ ...base.chapters[0], content: saved.assets?.chapters ?? "" }],
    activeChapterId: saved.chapters?.some((c) => c.id === saved.activeChapterId) ? saved.activeChapterId! : saved.chapters?.[0]?.id ?? "chapter-1",
    assetVersions: saved.assetVersions ?? {},
    proposals: saved.proposals ?? {},
    reviews: saved.reviews ?? {},
    threads: normalizeThreads(saved.threads),
    coProposals: normalizeProposals(saved.coProposals).filter((proposal) => proposal.bookId === book.id),
    locks: normalizeLocks(saved.locks),
    view: normalizeView(saved.view),
    plot: { ...base.plot, ...saved.plot, branches: saved.plot?.branches ?? base.plot.branches },
    versions: saved.versions?.length ? saved.versions : base.versions,
  };
}


export function storySnapshot(workspace: BookWorkspace): StorySnapshot {
  const { idea, tags, references, assets, plot, chapters, activeChapterId } = workspace;
  return structuredClone({ idea, tags, references, assets, plot, chapters, activeChapterId });
}

export function withSnapshot(workspace: BookWorkspace, label: string): BookWorkspace {
  const version = { id: crypto.randomUUID(), createdAt: new Date().toLocaleString("zh-CN"), label, idea: workspace.idea, snapshot: storySnapshot(workspace) };
  return { ...workspace, versions: [version, ...workspace.versions].slice(0, 30) };
}

export function changeAsset(workspace: BookWorkspace, type: string, content: string, saveVersion = false, label = "修改前快照"): BookWorkspace {
  const chapter = workspace.chapters.find((c) => c.id === workspace.activeChapterId) ?? workspace.chapters[0];
  const key = type === "chapters" ? `chapter:${chapter.id}` : type;
  const previous = type === "chapters" ? chapter.content : workspace.assets[type] ?? "";
  const history = workspace.assetVersions[key] ?? [];
  const versions = saveVersion ? [{ id: crypto.randomUUID(), createdAt: new Date().toLocaleString("zh-CN"), label, content: previous }, ...history].slice(0, 30) : history;
  return { ...workspace, assetVersions: { ...workspace.assetVersions, [key]: versions },
    ...(type === "chapters" ? { chapters: workspace.chapters.map((c) => c.id === chapter.id ? { ...c, content, updatedAt: new Date().toISOString() } : c) }
      : { assets: { ...workspace.assets, [type]: content } }),
  };
}

// Writes an adopted candidate into the exact chapter it was generated for, even
// if the author has switched chapters meanwhile, and keeps a restorable snapshot.
export function applyChapterText(workspace: BookWorkspace, chapterId: string, content: string, label: string): BookWorkspace {
  const chapter = workspace.chapters.find((item) => item.id === chapterId);
  if (!chapter) return workspace;
  const key = `chapter:${chapterId}`;
  const history = workspace.assetVersions[key] ?? [];
  return {
    ...workspace,
    assetVersions: { ...workspace.assetVersions, [key]: [{ id: crypto.randomUUID(), createdAt: new Date().toLocaleString("zh-CN"), label, content: chapter.content }, ...history].slice(0, 30) },
    chapters: workspace.chapters.map((item) => item.id === chapterId ? { ...item, content, updatedAt: new Date().toISOString() } : item),
  };
}

const ASSET_LABELS: Record<string, string> = { world: "世界观", characters: "人物角色", timeline: "旧剧情笔记（冲突以已确认正文与当前世界线为准）", style: "文笔文风", outline: "卷章大纲", overview: "故事蓝图", chapters: "章节正文" };

export function buildStoryContext(book: BookProject, workspace: BookWorkspace, active: string): string {
  const chapterIndex = Math.max(0, workspace.chapters.findIndex((c) => c.id === workspace.activeChapterId));
  const chapter = workspace.chapters[chapterIndex];
  const assets = Object.entries(workspace.assets).filter(([key]) => key !== "chapters").map(([key, value]) => `【${ASSET_LABELS[key] ?? key}】\n${value.slice(0, 14000)}`);
  return [
    `书名：${book.title}\n类型：${book.genre}\n故事种子：${workspace.idea.slice(0, 12000)}\n创作偏好：${workspace.tags.join("、").slice(0, 2000)}\n当前工作区：${ASSET_LABELS[active] ?? active}`,
    `【当前编辑内容】\n${active === "chapters" ? `${chapter.title}\n${chapter.content.slice(-24000)}` : workspace.assets[active]?.slice(0, 24000) ?? workspace.idea.slice(0, 12000)}`,
    worldlineContext(workspace, active),
    ...assets, `【主支线说明】\n${workspace.plot.summary ?? "尚未生成"}`,
    `【章节目录】\n${workspace.chapters.map((c) => c.title).join("\n").slice(0, 6000)}`,
    ...workspace.chapters.slice(Math.max(0, chapterIndex - 3), chapterIndex).map((c) => `【前文：${c.title}，末尾片段】\n${c.content.slice(-5000)}`),
  ].join("\n\n").slice(0, 120000);
}

export function preparation(workspace: BookWorkspace) {
  const items = [
    { label: "世界观", done: Boolean(workspace.assets.world?.trim()) },
    { label: "人物", done: Boolean(workspace.assets.characters?.trim()) },
    { label: "世界线", done: Boolean(workspace.assets.timeline?.trim()) || getRoadmap(workspace.plot).events.length >= 2 },
    { label: "文风", done: Boolean(workspace.assets.style?.trim()) },
    { label: "大纲", done: Boolean(workspace.assets.outline?.trim()) },
    { label: "正文", done: workspace.chapters.some((chapter) => chapter.content.trim()) },
  ];
  const completed = items.filter((item) => item.done).length;
  return { items, completed, percent: Math.round(completed / items.length * 100) };
}
