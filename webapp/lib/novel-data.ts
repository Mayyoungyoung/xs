import { z } from "zod";
import { generatedRoadmapSchema, roadmapSchema, roadmapDraftSchema } from "./roadmap-schema";

const id = z.string().min(1).max(160).refine((s) => !["__proto__", "constructor", "prototype"].includes(s));
export const bookSchema = z.object({
  id, title: z.string().trim().min(1).max(200), genre: z.string().max(200).default("未分类"),
  premise: z.string().default(""), chapters: z.number().nonnegative().default(0),
  words: z.number().nonnegative().default(0), progress: z.number().min(0).max(100).default(0),
  updatedAt: z.string().default(""), accent: z.string().regex(/^#[0-9a-f]{6}$/i).default("#7f302a"), glyph: z.string().max(8).default("书"),
});
export const referenceSchema = z.object({ id, title: z.string(), kind: z.string(), summary: z.string(), source: z.string(),
  url: z.string().refine((s) => !s || /^https?:\/\//i.test(s), "来源链接必须是 HTTP 或 HTTPS").optional(),
  scope: z.enum(["plot", "character", "style", "world"]),
});
const branchSchema = z.object({ from: z.number().int().nonnegative().optional(), to: z.number().int().nonnegative().optional(), status: z.enum(["planned", "active", "resolved"]).optional(), id, title: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/i), path: z.string(), labels: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), text: z.string() })) });
export const plotNodeSchema = z.object({ title: z.string().min(1).max(80), chapter: z.string().min(1).max(40), note: z.string().max(400) });
const plotSchema = z.object({ instruction: z.string(), branches: z.array(branchSchema), selected: z.string(), selectedNode: z.string(), zoom: z.number().min(.02).max(2), version: z.number().int().positive(), nodes: z.array(plotNodeSchema).optional(), summary: z.string().optional(),
  roadmap: roadmapSchema.optional(),
  discussion: z.array(z.object({ role: z.enum(["ai", "user"]), text: z.string() })).optional(),
  discussionDraft: z.string().optional(),
  proposal: z.object({ summary: z.string(), nodes: z.array(z.object({ title: z.string().max(80), chapter: z.string().max(40), note: z.string().max(800) })).max(80), branches: z.array(branchSchema), roadmap: roadmapDraftSchema.optional() }).optional(),
});
export const chapterSchema = z.object({ id, title: z.string().min(1), content: z.string(), updatedAt: z.string(), plotEventIds: z.array(z.string().min(1)).max(80).optional() });
const assetVersionSchema = z.object({ id, label: z.string(), createdAt: z.string(), content: z.string() });
const storySchema = z.object({ idea: z.string(), tags: z.array(z.string()), references: z.array(referenceSchema), assets: z.record(z.string()), plot: plotSchema, chapters: z.array(chapterSchema), activeChapterId: z.string() });
export const workspaceSchema = storySchema.partial().extend({
  messages: z.array(z.object({ role: z.enum(["ai", "user"]), text: z.string() })).optional(),
  versions: z.array(z.object({ id, label: z.string(), createdAt: z.string(), idea: z.string(), snapshot: storySchema.optional() })).optional(),
  assetVersions: z.record(z.array(assetVersionSchema)).optional(),
  proposals: z.record(z.string()).optional(),
  reviews: z.record(z.string()).optional(),
});
const backupSchema = z.object({ version: z.union([z.literal(2), z.literal(3)]).optional(), books: z.array(bookSchema), workspaces: z.record(id, workspaceSchema).default({}) });

export function parseBackup(input: unknown) {
  const shaped = Array.isArray(input) ? { books: input } : input && typeof input === "object" && "books" in input ? input : { books: [input] };
  const result = backupSchema.safeParse(shaped);
  if (!result.success) throw new Error(`备份格式不正确：${result.error.issues[0]?.path.join(".")}。请使用墨脉导出的 JSON 文件。`);
  if (new Set(result.data.books.map((b) => b.id)).size !== result.data.books.length) throw new Error("备份含重复书籍编号，请检查文件。");
  const bookIds = new Set(result.data.books.map((b) => b.id));
  if (Object.keys(result.data.workspaces).some((key) => !bookIds.has(key))) throw new Error("备份中的工作区没有对应书籍。");
  for (const w of Object.values(result.data.workspaces)) {
    if (w.chapters && new Set(w.chapters.map((c) => c.id)).size !== w.chapters.length) throw new Error("备份含重复章节编号。");
  }
  return result.data;
}

export const generatedPlotSchema = z.object({
  summary: z.string().min(1).max(8000), nodes: z.array(plotNodeSchema).min(2).max(8),
  branches: z.array(z.object({ title: z.string().min(1).max(80), from: z.number().int().min(0), to: z.number().int().min(1), setup: z.string().min(1).max(80), payoff: z.string().min(1).max(80) })).max(6),
}).superRefine((plot, ctx) => {
  plot.branches.forEach((b, i) => { if (b.to <= b.from || b.to >= plot.nodes.length) ctx.addIssue({ code: "custom", path: ["branches", i], message: "支线起止节点必须位于主线且按顺序连接" }); });
});
export function parseGeneratedPlot(content: string) {
  const json = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error("模型没有返回有效情节图，原图已保留，请重试。"); }
  if (data && typeof data === "object" && ("lines" in data || "events" in data)) {
    const parsed = generatedRoadmapSchema.safeParse(data);
    if (!parsed.success) throw new Error(`世界线方案无效：${parsed.error.issues[0]?.message}。原方案已保留。`);
    const roadmap = { lines: parsed.data.lines, events: parsed.data.events.map((event) => ({ ...event, status: "planned" as const })) };
    return { summary: parsed.data.summary, nodes: [], branches: [], roadmap };
  }
  const result = generatedPlotSchema.safeParse(data);
  if (!result.success) throw new Error("情节图结构或支线连接无效，原图已保留，请调整指令后重试。");
  const colors = ["#b96357", "#4f7185", "#8a7650", "#6c5a91", "#477d69", "#a85b7c"];
  return { summary: result.data.summary, nodes: result.data.nodes, branches: result.data.branches.map((b, i) => {
    const start = 95 + b.from * (1135 / (result.data.nodes.length - 1));
    const end = 95 + b.to * (1135 / (result.data.nodes.length - 1));
    const y = i % 2 === 0 ? 65 + Math.floor(i / 2) * 44 : 370 + Math.floor(i / 2) * 60;
    return { id: `branch-${i}`, from: b.from, to: b.to, status: "planned" as const, title: b.title, color: colors[i], path: `M${start} 244 C${start + 60} ${y} ${end - 60} ${y} ${end} 244`, labels: [{ x: start + (end - start) * .3, y, text: b.setup }, { x: start + (end - start) * .7, y, text: b.payoff }] };
  }) };
}

export function wordCount(text: string) { return (text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) ?? []).length; }
const chapterCounts = new WeakMap<{ content: string }, number>();
export function chapterWordCount(chapter: { content: string }) {
  let count = chapterCounts.get(chapter);
  if (count === undefined) { count = wordCount(chapter.content); chapterCounts.set(chapter, count); }
  return count;
}
export function downloadText(text: string, filename: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename.replace(/[\\/:*?"<>|]/g, "_"); a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
