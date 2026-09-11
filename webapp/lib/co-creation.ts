// Unified co-creation protocol shared by every writing module.
// Pure functions only: no React, no storage, no network. The UI, the API route
// and the desktop bridge all build on these helpers so the three entry points
// (write yourself / generate / discuss) operate on the same content.

import { z } from "zod";
import type { RoadmapEvent, Storyline, StoryRoadmap } from "./story-roadmap";
import { chapterPlan, getRoadmap } from "./story-roadmap";
import { roadmapSchema } from "./roadmap-schema";

export type CoModuleId = "overview" | "world" | "characters" | "style" | "outline" | "timeline" | "chapters" | "roadmap" | "event" | "line";

export type CoTarget = { moduleId: CoModuleId; entityId?: string };

export const MODULE_LABELS: Record<CoModuleId, string> = {
  overview: "故事蓝图", world: "世界观", characters: "人物角色", style: "文笔文风", outline: "卷章大纲",
  timeline: "世界线笔记", chapters: "章节正文", roadmap: "世界线", event: "剧情事件", line: "故事线",
};

export function targetKey(target: CoTarget): string {
  return target.entityId ? `${target.moduleId}::${target.entityId}` : target.moduleId;
}

export function parseTargetKey(key: string): CoTarget {
  const [moduleId, entityId] = key.split("::");
  return { moduleId: (moduleId || "world") as CoModuleId, ...(entityId ? { entityId } : {}) };
}

// ---------------------------------------------------------------- selection

export type TextAnchor = { start: number; end: number; text: string; prefix?: string; suffix?: string };

export function contentHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}

const ANCHOR_CONTEXT = 24;

export function anchorFromRange(content: string, start: number, end: number): TextAnchor | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > content.length || end <= start) return null;
  return {
    start, end, text: content.slice(start, end),
    prefix: content.slice(Math.max(0, start - ANCHOR_CONTEXT), start),
    suffix: content.slice(end, Math.min(content.length, end + ANCHOR_CONTEXT)),
  };
}

// An anchor is only reusable while the exact same text still sits at the same
// offsets. Content edited during generation invalidates it on purpose.
export function anchorValid(content: string, anchor: TextAnchor): boolean {
  return content.slice(anchor.start, anchor.end) === anchor.text;
}

export type AnchorResolution =
  | { status: "exact"; anchor: TextAnchor }
  | { status: "unique"; anchor: TextAnchor }
  | { status: "ambiguous"; count: number }
  | { status: "missing" };

// Never guesses: an anchor that moved is only accepted when the stored
// surrounding context identifies exactly one occurrence, and the UI still asks
// the author to confirm before using it.
export function resolveAnchor(content: string, anchor: TextAnchor): AnchorResolution {
  if (anchorValid(content, anchor)) return { status: "exact", anchor };
  if (!anchor.text) return { status: "missing" };
  const offsets: number[] = [];
  let index = content.indexOf(anchor.text);
  while (index >= 0) { offsets.push(index); index = content.indexOf(anchor.text, index + 1); }
  if (!offsets.length) return { status: "missing" };
  if (offsets.length === 1) return { status: "unique", anchor: rebuildAnchor(content, offsets[0], anchor.text) };
  const withContext = offsets.filter((start) => {
    const prefix = anchor.prefix ?? "";
    const suffix = anchor.suffix ?? "";
    const prefixOk = !prefix || content.slice(Math.max(0, start - prefix.length), start) === prefix;
    const end = start + anchor.text.length;
    const suffixOk = !suffix || content.slice(end, end + suffix.length) === suffix;
    return prefixOk && suffixOk;
  });
  if (withContext.length === 1) return { status: "unique", anchor: rebuildAnchor(content, withContext[0], anchor.text) };
  return { status: "ambiguous", count: offsets.length };
}

function rebuildAnchor(content: string, start: number, text: string): TextAnchor {
  const end = start + text.length;
  return {
    start, end, text,
    prefix: content.slice(Math.max(0, start - ANCHOR_CONTEXT), start),
    suffix: content.slice(end, Math.min(content.length, end + ANCHOR_CONTEXT)),
  };
}

// ---------------------------------------------------------------- proposals

export type ProposalScope = "full" | "selection" | "insert-before" | "insert-after" | "append";
export type AdoptMode = "replace-all" | "replace-selection" | "insert-before" | "insert-after" | "append";
export type CoProposalStatus = "pending" | "adopted" | "discarded";

export type CoProposal = {
  id: string;
  bookId: string;
  kind: "text";
  target: CoTarget;
  targetLabel: string;
  scope: ProposalScope;
  anchor?: TextAnchor;
  baseHash: string;
  baseRevision: number;
  before: string;
  after: string;
  instruction?: string;
  threadKey: string;
  revisedFrom?: string;
  createdAt: string;
  status: CoProposalStatus;
};

export function makeTextProposal(input: {
  bookId: string; target: CoTarget; targetLabel: string; content: string; after: string;
  anchor?: TextAnchor | null; scope: ProposalScope; baseRevision: number; threadKey: string;
  instruction?: string; revisedFrom?: string; now?: string; id?: string;
}): CoProposal {
  return {
    id: input.id ?? crypto.randomUUID(),
    bookId: input.bookId,
    kind: "text",
    target: input.target,
    targetLabel: input.targetLabel,
    scope: input.scope,
    ...(input.anchor ? { anchor: input.anchor } : {}),
    baseHash: contentHash(input.content),
    baseRevision: input.baseRevision,
    before: input.content,
    after: input.after,
    ...(input.instruction ? { instruction: input.instruction } : {}),
    ...(input.revisedFrom ? { revisedFrom: input.revisedFrom } : {}),
    threadKey: input.threadKey,
    createdAt: input.now ?? new Date().toISOString(),
    status: "pending",
  };
}

export type AdoptResult = { content: string; changed: boolean } | { error: string };

// Selection modes never relocate on their own: a moved anchor is refused unless
// the caller explicitly passes allowRelocated after the author confirmed the
// unique new position.
export function adoptTextProposal(current: string, proposal: CoProposal, mode: AdoptMode, options: { allowRelocated?: boolean } = {}): AdoptResult {
  if (proposal.status !== "pending") return { error: "这份候选稿已经处理过，不会重复写入。" };
  const incoming = proposal.after.trim();
  if (!incoming) return { error: "候选稿是空的，没有可采纳的内容。" };
  if (mode === "append") {
    if (current.trimEnd().endsWith(incoming)) return { content: current, changed: false };
    return { content: current.trimEnd() ? `${current.trimEnd()}\n\n${incoming}` : incoming, changed: true };
  }
  if (mode === "replace-all") {
    if (contentHash(current) !== proposal.baseHash && current !== proposal.before) return { error: `「${proposal.targetLabel}」在生成后已被修改，未自动覆盖。请重新生成，或确认后手动替换。` };
    if (current === proposal.after) return { content: current, changed: false };
    return { content: proposal.after, changed: true };
  }
  if (!proposal.anchor) return { error: "这份候选稿没有可用的选中位置，请改用整体替换或追加。" };
  const resolved = resolveAnchor(current, proposal.anchor);
  if (resolved.status === "ambiguous") return { error: `原文里有 ${resolved.count} 处相同内容，无法确定要改哪一处。请重新选中目标后再生成。` };
  if (resolved.status === "missing") return { error: "找不到原来的选中内容（可能已被删除或改写）。请重新选中目标后再生成。" };
  if (resolved.status === "unique" && !options.allowRelocated) return { error: "选中内容的位置已变化。请确认新的位置后再采纳，或重新选中目标。" };
  const anchor = resolved.anchor;
  if (mode === "replace-selection") {
    if (current.slice(anchor.start, anchor.end) === proposal.after) return { content: current, changed: false };
    return { content: `${current.slice(0, anchor.start)}${proposal.after}${current.slice(anchor.end)}`, changed: true };
  }
  if (mode === "insert-before") {
    if (current.slice(Math.max(0, anchor.start - incoming.length), anchor.start) === incoming) return { content: current, changed: false };
    return { content: `${current.slice(0, anchor.start)}${incoming}\n\n${current.slice(anchor.start)}`, changed: true };
  }
  if (current.slice(anchor.end, anchor.end + incoming.length) === incoming) return { content: current, changed: false };
  return { content: `${current.slice(0, anchor.end)}\n\n${incoming}${current.slice(anchor.end)}`, changed: true };
}

// Reported to the UI so the author can confirm a moved-but-unique selection.
export function selectionRelocation(current: string, proposal: CoProposal): { status: AnchorResolution["status"]; count?: number } {
  if (!proposal.anchor) return { status: "missing" };
  const resolved = resolveAnchor(current, proposal.anchor);
  return resolved.status === "ambiguous" ? { status: "ambiguous", count: resolved.count } : { status: resolved.status };
}

export function availableAdoptModes(proposal: CoProposal): AdoptMode[] {
  if (proposal.scope === "selection" || proposal.scope === "insert-before" || proposal.scope === "insert-after") {
    return ["replace-selection", "insert-before", "insert-after", "replace-all", "append"];
  }
  return ["replace-all", "append"];
}

export const ADOPT_MODE_LABELS: Record<AdoptMode, string> = {
  "replace-selection": "替换选中内容", "insert-before": "插入到选中之前", "insert-after": "插入到选中之后",
  "replace-all": "整体替换", "append": "追加到末尾",
};

// ------------------------------------------------------- roadmap proposals

export type RoadmapOp =
  | { op: "updateEvent"; eventId: string; fields: Partial<Pick<RoadmapEvent, "title" | "note" | "chapter" | "order" | "status">> }
  | { op: "addEvent"; event: RoadmapEvent; lineIds: string[] }
  | { op: "linkEvent"; lineId: string; eventId: string }
  | { op: "updateLine"; lineId: string; fields: Partial<Pick<Storyline, "title" | "goal" | "color">> };

export type RoadmapProposal = {
  id: string;
  bookId: string;
  kind: "roadmap-ops";
  target: CoTarget;
  targetLabel: string;
  ops: RoadmapOp[];
  baseRevision: number;
  baseFields?: BaseFieldEntry[];
  progressEventIds?: string[];
  instruction?: string;
  threadKey: string;
  revisedFrom?: string;
  createdAt: string;
  status: CoProposalStatus;
};

export const ROADMAP_OP_LABELS: Record<RoadmapOp["op"], string> = {
  updateEvent: "修改事件字段", addEvent: "新增事件", linkEvent: "关联已有事件", updateLine: "修改故事线",
};

// Text drafts and structured roadmap edits share one candidate list, so the
// author sees a single "待采纳修改" surface per target.
export type CoProposalRecord = CoProposal | RoadmapProposal;

export function isRoadmapProposal(value: CoProposalRecord): value is RoadmapProposal {
  return value.kind === "roadmap-ops";
}

export function makeRoadmapProposal(input: {
  bookId: string; target: CoTarget; targetLabel: string; ops: RoadmapOp[]; baseRevision: number;
  baseFields?: BaseFieldEntry[]; progressEventIds?: string[];
  threadKey: string; instruction?: string; revisedFrom?: string; now?: string; id?: string;
}): RoadmapProposal {
  return {
    id: input.id ?? crypto.randomUUID(),
    bookId: input.bookId,
    kind: "roadmap-ops",
    target: input.target,
    targetLabel: input.targetLabel,
    ops: input.ops,
    baseRevision: input.baseRevision,
    ...(input.baseFields?.length ? { baseFields: input.baseFields } : {}),
    ...(input.progressEventIds?.length ? { progressEventIds: input.progressEventIds } : {}),
    ...(input.instruction ? { instruction: input.instruction } : {}),
    ...(input.revisedFrom ? { revisedFrom: input.revisedFrom } : {}),
    threadKey: input.threadKey,
    createdAt: input.now ?? new Date().toISOString(),
    status: "pending",
  };
}

export function describeProposal(proposal: CoProposalRecord, roadmap: StoryRoadmap): string {
  if (!isRoadmapProposal(proposal)) return proposal.after.trim().slice(0, 120);
  return proposal.ops.map((op) => describeRoadmapOp(op, roadmap)).join("；").slice(0, 300);
}

export function describeRoadmapOp(op: RoadmapOp, roadmap: StoryRoadmap): string {
  if (op.op === "updateEvent") return `「${roadmap.events.find((event) => event.id === op.eventId)?.title ?? op.eventId}」修改：${Object.keys(op.fields).join("、")}`;
  if (op.op === "addEvent") return `新增事件「${op.event.title}」→ ${op.lineIds.map((id) => roadmap.lines.find((line) => line.id === id)?.title ?? id).join("、")}`;
  if (op.op === "linkEvent") return `「${roadmap.lines.find((line) => line.id === op.lineId)?.title ?? op.lineId}」关联事件「${roadmap.events.find((event) => event.id === op.eventId)?.title ?? op.eventId}」`;
  return `故事线「${roadmap.lines.find((line) => line.id === op.lineId)?.title ?? op.lineId}」修改：${Object.keys(op.fields).join("、")}`;
}

const EVENT_FIELD_LABELS: Record<string, string> = { title: "标题", note: "说明", chapter: "章节", order: "顺序", status: "进度" };
const LINE_FIELD_LABELS: Record<string, string> = { title: "名称", goal: "目标", color: "颜色" };
const STATUS_LABELS: Record<string, string> = { planned: "待写", active: "正在写", done: "已写完" };

export type OpDiff = { field: string; label: string; before: string; after: string; progress: boolean };

// Concrete before/after per changed field, so a candidate never shows just
// "修改：note".
export function describeOpDiff(op: RoadmapOp, roadmap: StoryRoadmap, baseFields?: BaseFieldEntry[]): OpDiff[] {
  const base = baseFields?.find((entry) => entry.id === (op.op === "updateEvent" ? op.eventId : op.op === "updateLine" ? op.lineId : ""));
  const render = (value: unknown, statusField: boolean) => {
    const text = value === undefined || value === null || value === "" ? "（空）" : String(value);
    return statusField ? STATUS_LABELS[text] ?? text : text;
  };
  if (op.op === "updateEvent" || op.op === "updateLine") {
    const labels = op.op === "updateEvent" ? EVENT_FIELD_LABELS : LINE_FIELD_LABELS;
    return Object.entries(op.fields).map(([field, value]) => ({
      field,
      label: labels[field] ?? field,
      before: render(base?.fields?.[field], field === "status"),
      after: render(value, field === "status"),
      progress: field === "status",
    }));
  }
  if (op.op === "addEvent") {
    return [
      { field: "title", label: "新增事件", before: "（不存在）", after: op.event.title, progress: false },
      { field: "note", label: "说明", before: "（空）", after: op.event.note || "（空）", progress: false },
      { field: "chapter", label: "章节", before: "（空）", after: op.event.chapter || "待安排", progress: false },
    ];
  }
  return [{
    field: "eventIds", label: "关联事件", before: "未关联", progress: false,
    after: roadmap.events.find((event) => event.id === op.eventId)?.title ?? op.eventId,
  }];
}

export function isProgressDiff(diffs: OpDiff[]): boolean {
  return diffs.some((diff) => diff.progress && diff.before !== diff.after);
}

const opSchema = z.object({
  op: z.enum(["updateEvent", "addEvent", "linkEvent", "updateLine"]),
  eventId: z.string().min(1).max(160).optional(),
  lineId: z.string().min(1).max(160).optional(),
  lineIds: z.array(z.string().min(1).max(160)).max(16).optional(),
  event: z.unknown().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

// Model output for roadmap edits is validated before it can touch the canvas:
// structure, allowed fields, known ids and references. New events are validated
// on a staging graph, so "add an event, then link it" stays one valid group
// instead of being rejected against the original id set.
export type ParsedOps = { ops: RoadmapOp[]; progressEventIds: string[]; warnings: string[] };

export function parseRoadmapOps(content: string, roadmap: StoryRoadmap): ParsedOps | { error: string } {
  const json = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { error: "模型没有返回可解析的修改指令（需要 JSON），原内容已保留。" }; }
  const rawOps = (data as { ops?: unknown } | null)?.ops;
  const parsed = z.array(opSchema).max(40).safeParse(rawOps);
  if (!parsed.success) return { error: "修改指令结构不正确，原内容已保留。请重试或换一种说法。" };
  if (!parsed.data.length) return { ops: [], progressEventIds: [], warnings: [] };

  // Pass 1: ids that will exist once the whole group is applied.
  const stagingLines = new Set(roadmap.lines.map((line) => line.id));
  const stagingEvents = new Set(roadmap.events.map((event) => event.id));
  for (const raw of parsed.data) {
    if (raw.op !== "addEvent") continue;
    const event = parsedEvent(raw.event);
    if (!event) continue;
    if (stagingEvents.has(event.id)) return { error: `新增事件的编号 ${event.id} 与已有事件重复，原图已保留。` };
    stagingEvents.add(event.id);
  }

  const ops: RoadmapOp[] = [];
  const progressEventIds: string[] = [];
  const warnings: string[] = [];
  const currentStatus = (id: string) => roadmap.events.find((event) => event.id === id)?.status;
  for (const raw of parsed.data) {
    if (raw.op === "updateEvent") {
      if (!raw.eventId || !stagingEvents.has(raw.eventId)) return { error: "修改指令引用了不存在的事件，原图已保留。" };
      const fields = pickEventFields(raw.fields);
      const rejected = unknownEventFields(raw.fields);
      if (!Object.keys(fields).length) return { error: "修改指令没有给出可用的字段（标题、说明、章节、顺序或进度），原图已保留。" };
      if (rejected.length) warnings.push(`已忽略不支持的字段：${rejected.join("、")}`);
      if (fields.status && fields.status !== currentStatus(raw.eventId)) progressEventIds.push(raw.eventId);
      ops.push({ op: "updateEvent", eventId: raw.eventId, fields });
    } else if (raw.op === "addEvent") {
      const requested = raw.lineIds ?? [];
      const unknownLines = requested.filter((id) => !stagingLines.has(id));
      if (unknownLines.length) return { error: `新增事件引用了不存在的故事线（${unknownLines.join("、")}），原图已保留。` };
      const lineIds = requested.filter((id) => stagingLines.has(id));
      if (!lineIds.length) return { error: "新增事件必须指定已有的故事线，原图已保留。" };
      const event = parsedEvent(raw.event);
      if (!event) return { error: "新增事件的字段不完整，原图已保留。" };
      ops.push({ op: "addEvent", event, lineIds });
    } else if (raw.op === "linkEvent") {
      if (!raw.lineId || !stagingLines.has(raw.lineId)) return { error: "关联指令引用了不存在的故事线，原图已保留。" };
      if (!raw.eventId || !stagingEvents.has(raw.eventId)) return { error: "关联指令引用了不存在的事件，原图已保留。" };
      if (roadmap.lines.find((line) => line.id === raw.lineId)?.eventIds.includes(raw.eventId)) warnings.push("该事件已在这条故事线中，重复关联已跳过。");
      else ops.push({ op: "linkEvent", lineId: raw.lineId, eventId: raw.eventId });
    } else {
      if (!raw.lineId || !stagingLines.has(raw.lineId)) return { error: "修改指令引用了不存在的故事线，原图已保留。" };
      const fields = pickLineFields(raw.fields);
      const rejected = unknownLineFields(raw.fields);
      if (!Object.keys(fields).length) return { error: "修改指令没有给出可用的故事线字段，原图已保留。" };
      if (rejected.length) warnings.push(`已忽略不支持的字段：${rejected.join("、")}`);
      ops.push({ op: "updateLine", lineId: raw.lineId, fields });
    }
  }
  return { ops, progressEventIds, warnings };
}

function unknownEventFields(fields?: Record<string, unknown>): string[] {
  const allowed = new Set(["title", "note", "chapter", "order", "status"]);
  return Object.keys(fields ?? {}).filter((key) => !allowed.has(key));
}

function unknownLineFields(fields?: Record<string, unknown>): string[] {
  const allowed = new Set(["title", "goal", "color"]);
  return Object.keys(fields ?? {}).filter((key) => !allowed.has(key));
}

type EventFields = Partial<Pick<RoadmapEvent, "title" | "note" | "chapter" | "order" | "status">>;
type LineFields = Partial<Pick<Storyline, "title" | "goal" | "color">>;

function pickEventFields(fields?: Record<string, unknown>): EventFields {
  const result: EventFields = {};
  if (typeof fields?.title === "string" && fields.title.trim() && fields.title.length <= 80) result.title = fields.title.trim();
  if (typeof fields?.note === "string" && fields.note.length <= 800) result.note = fields.note;
  if (typeof fields?.chapter === "string" && fields.chapter.length <= 40) result.chapter = fields.chapter;
  if (typeof fields?.order === "number" && Number.isFinite(fields.order) && fields.order >= 0 && fields.order <= 10000) result.order = fields.order;
  if (fields?.status === "planned" || fields?.status === "active" || fields?.status === "done") result.status = fields.status;
  return result;
}

function pickLineFields(fields?: Record<string, unknown>): LineFields {
  const result: LineFields = {};
  if (typeof fields?.title === "string" && fields.title.trim() && fields.title.length <= 80) result.title = fields.title.trim();
  if (typeof fields?.goal === "string" && fields.goal.length <= 2000) result.goal = fields.goal;
  if (typeof fields?.color === "string" && /^#[0-9a-f]{6}$/i.test(fields.color)) result.color = fields.color;
  return result;
}

function parsedEvent(input: unknown): RoadmapEvent | null {
  const value = input as Partial<RoadmapEvent> | undefined;
  if (!value || typeof value.title !== "string" || !value.title.trim()) return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id.slice(0, 160) : `event-${crypto.randomUUID().slice(0, 8)}`,
    title: value.title.trim().slice(0, 80),
    note: typeof value.note === "string" ? value.note.slice(0, 800) : "",
    chapter: typeof value.chapter === "string" ? value.chapter.slice(0, 40) : "待安排",
    order: typeof value.order === "number" && Number.isFinite(value.order) ? Math.max(0, Math.min(10000, value.order)) : 0,
    status: "planned",
  };
}

export type RoadmapApplyResult = { roadmap: StoryRoadmap; applied: RoadmapOp[] } | { error: string };

// Adoption is one transaction: either every operation lands and the result
// passes the roadmap schema, or nothing changes and the author sees why.
export function applyRoadmapOps(roadmap: StoryRoadmap, ops: RoadmapOp[]): RoadmapApplyResult {
  if (!ops.length) return { error: "没有可采纳的修改。" };
  let next: StoryRoadmap = {
    lines: roadmap.lines.map((line) => ({ ...line, eventIds: [...line.eventIds] })),
    events: roadmap.events.map((event) => ({ ...event })),
  };
  for (const op of ops) {
    if (op.op === "updateEvent") {
      if (!next.events.some((event) => event.id === op.eventId)) return { error: "要修改的事件已不存在，请重新生成指令。" };
      next = { ...next, events: next.events.map((event) => event.id === op.eventId ? { ...event, ...op.fields } : event) };
    } else if (op.op === "addEvent") {
      if (next.events.some((event) => event.id === op.event.id)) return { error: "新增事件的编号已存在，请重试。" };
      const missing = op.lineIds.find((id) => !next.lines.some((line) => line.id === id));
      if (missing) return { error: "新增事件要加入的故事线已不存在，请重新生成指令。" };
      next = {
        ...next,
        events: [...next.events, op.event],
        lines: next.lines.map((line) => op.lineIds.includes(line.id) ? { ...line, eventIds: [...line.eventIds, op.event.id] } : line),
      };
    } else if (op.op === "linkEvent") {
      if (!next.events.some((event) => event.id === op.eventId)) return { error: "要关联的事件已不存在，请重新生成指令。" };
      const line = next.lines.find((item) => item.id === op.lineId);
      if (!line) return { error: "要关联的故事线已不存在，请重新生成指令。" };
      if (line.eventIds.includes(op.eventId)) continue;
      next = { ...next, lines: next.lines.map((item) => item.id === op.lineId ? { ...item, eventIds: [...item.eventIds, op.eventId] } : item) };
    } else {
      if (!next.lines.some((line) => line.id === op.lineId)) return { error: "要修改的故事线已不存在，请重新生成指令。" };
      next = { ...next, lines: next.lines.map((line) => line.id === op.lineId ? { ...line, ...op.fields } : line) };
    }
  }
  const validated = roadmapSchema.safeParse(next);
  if (!validated.success) return { error: `采纳后会违反剧情结构约束（${validated.error.issues[0]?.message ?? "请检查引用关系"}），原图已保留。` };
  return { roadmap: validated.data, applied: ops };
}

// ------------------------------------------------- constraints on candidates

export type BaseFieldEntry = { kind: "event" | "line"; id: string; fields: Record<string, unknown> };

// Snapshot the exact values a candidate is about to change, so adoption can tell
// a real conflict (those fields were edited meanwhile) from unrelated drift.
export function captureBaseFields(roadmap: StoryRoadmap, ops: RoadmapOp[]): BaseFieldEntry[] {
  const captured = new Map<string, BaseFieldEntry>();
  const entriesOf = (source: Record<string, unknown> | undefined, fields: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(fields).map((field) => [field, source?.[field]]));
  for (const op of ops) {
    if (op.op === "updateEvent") {
      const event = roadmap.events.find((item) => item.id === op.eventId) as unknown as Record<string, unknown> | undefined;
      if (!event) continue;
      const key = `event:${op.eventId}`;
      const entry = captured.get(key) ?? { kind: "event" as const, id: op.eventId, fields: {} };
      Object.assign(entry.fields, entriesOf(event, op.fields));
      captured.set(key, entry);
    } else if (op.op === "updateLine") {
      const line = roadmap.lines.find((item) => item.id === op.lineId) as unknown as Record<string, unknown> | undefined;
      if (!line) continue;
      const key = `line:${op.lineId}`;
      const entry = captured.get(key) ?? { kind: "line" as const, id: op.lineId, fields: {} };
      Object.assign(entry.fields, entriesOf(line, op.fields));
      captured.set(key, entry);
    }
  }
  return [...captured.values()];
}

// Only the touched fields are compared: an unrelated edit elsewhere in the
// roadmap must not invalidate the whole candidate.
export function changedBaseFields(roadmap: StoryRoadmap, base: BaseFieldEntry[]): string[] {
  const changed: string[] = [];
  for (const entry of base) {
    const current = (entry.kind === "event"
      ? roadmap.events.find((item) => item.id === entry.id)
      : roadmap.lines.find((item) => item.id === entry.id)) as unknown as Record<string, unknown> | undefined;
    if (!current) { changed.push(entry.kind === "event" ? "事件已被删除" : "故事线已被删除"); continue; }
    for (const [field, value] of Object.entries(entry.fields)) if (current[field] !== value) changed.push(field);
  }
  return [...new Set(changed)];
}

function allowedScope(target: CoTarget, roadmap: StoryRoadmap): { eventIds?: string[]; lineIds?: string[]; label: string } {
  if (target.moduleId === "event" && target.entityId) {
    return {
      eventIds: [target.entityId],
      lineIds: roadmap.lines.filter((line) => line.eventIds.includes(target.entityId!)).map((line) => line.id),
      label: roadmap.events.find((event) => event.id === target.entityId)?.title ?? target.entityId,
    };
  }
  if (target.moduleId === "line" && target.entityId) {
    const line = roadmap.lines.find((item) => item.id === target.entityId);
    return { lineIds: [target.entityId], eventIds: line ? [...line.eventIds] : [], label: line?.title ?? target.entityId };
  }
  return { label: "整份世界线" };
}

export type OpsCheck = { ok: true; touchedEventIds: string[]; touchedLineIds: string[] } | { error: string; needsConfirmation?: "progress" };

// A candidate may only touch what its target allows, and never a locked object.
// Author-written edits are never blocked by these locks.
export function checkRoadmapOps(ops: RoadmapOp[], options: { target: CoTarget; roadmap: StoryRoadmap; locks?: LockMap; confirmProgress?: boolean }): OpsCheck {
  const { target, roadmap, locks } = options;
  if (isLocked(locks, { moduleId: "roadmap" }) || isLocked(locks, target)) return { error: "这个目标已锁定，AI 不能改写。请先解锁。" };
  const allowed = allowedScope(target, roadmap);
  const scopeError = `这份候选只能修改「${allowed.label}」范围内的内容，已拒绝越权修改。`;
  const touchedEventIds: string[] = [];
  const touchedLineIds: string[] = [];
  const progressEvents: string[] = [];
  const lineTitle = (id: string) => roadmap.lines.find((line) => line.id === id)?.title ?? id;
  const eventTitle = (id: string) => roadmap.events.find((event) => event.id === id)?.title ?? id;
  // Events that exist once this group lands: "add an event, then link it" is one
  // group, so linkage is checked against the staging result, not the old ids.
  const stagingEvents = new Set(roadmap.events.map((event) => event.id));
  for (const op of ops) if (op.op === "addEvent") stagingEvents.add(op.event.id);
  for (const op of ops) {
    if (op.op === "updateEvent") {
      if (!stagingEvents.has(op.eventId)) return { error: "要修改的事件已不存在，请重新生成候选。" };
      if (allowed.eventIds && !allowed.eventIds.includes(op.eventId)) return { error: scopeError };
      if (isLocked(locks, { moduleId: "event", entityId: op.eventId })) return { error: `事件「${eventTitle(op.eventId)}」已锁定，AI 不能改写。请先解锁。` };
      touchedEventIds.push(op.eventId);
      if (op.fields.status) progressEvents.push(op.eventId);
    } else if (op.op === "addEvent") {
      if (!op.lineIds.length) return { error: "新增事件必须属于至少一条故事线。" };
      for (const lineId of op.lineIds) {
        if (!roadmap.lines.some((line) => line.id === lineId)) return { error: "要加入的故事线已不存在，请重新生成候选。" };
        if (allowed.lineIds && !allowed.lineIds.includes(lineId)) return { error: scopeError };
        if (isLocked(locks, { moduleId: "line", entityId: lineId })) return { error: `故事线「${lineTitle(lineId)}」已锁定，AI 不能新增事件。` };
        touchedLineIds.push(lineId);
      }
      if (roadmap.events.some((event) => event.id === op.event.id)) return { error: "新增事件的编号已存在，请重新生成。" };
      touchedEventIds.push(op.event.id);
    } else if (op.op === "linkEvent") {
      if (!stagingEvents.has(op.eventId)) return { error: "要关联的事件已不存在，请重新生成候选。" };
      if (!roadmap.lines.some((line) => line.id === op.lineId)) return { error: "要关联的故事线已不存在，请重新生成候选。" };
      if (allowed.eventIds && !allowed.eventIds.includes(op.eventId)) return { error: scopeError };
      if (allowed.lineIds && !allowed.lineIds.includes(op.lineId)) return { error: scopeError };
      if (isLocked(locks, { moduleId: "line", entityId: op.lineId })) return { error: `故事线「${lineTitle(op.lineId)}」已锁定，不能改交汇关系。` };
      touchedLineIds.push(op.lineId);
      touchedEventIds.push(op.eventId);
    } else {
      if (!roadmap.lines.some((line) => line.id === op.lineId)) return { error: "要修改的故事线已不存在，请重新生成候选。" };
      if (allowed.lineIds && !allowed.lineIds.includes(op.lineId)) return { error: scopeError };
      if (isLocked(locks, { moduleId: "line", entityId: op.lineId })) return { error: `故事线「${lineTitle(op.lineId)}」已锁定，AI 不能改写。请先解锁。` };
      touchedLineIds.push(op.lineId);
    }
  }
  if (!ops.length) return { error: "没有选中任何修改。" };
  if (progressEvents.length && !options.confirmProgress) {
    return { error: `候选包含写作进度变化（${progressEvents.map(eventTitle).join("、")}）。AI 改剧情不等于事件已写完，请单独确认后再采纳。`, needsConfirmation: "progress" };
  }
  return { ok: true, touchedEventIds: [...new Set(touchedEventIds)], touchedLineIds: [...new Set(touchedLineIds)] };
}

// ------------------------------------------------------ adoption transaction

// Structural shape the transaction needs; the real BookWorkspace satisfies it,
// and using a generic keeps the caller's precise type on the way out.
export type TransactionWorkspace = {
  idea: string;
  tags: string[];
  assets: Record<string, string>;
  chapters: Array<{ id: string; title: string; content: string; updatedAt: string; plotEventIds?: string[] }>;
  activeChapterId: string;
  plot: PlotLike & { version: number };
  references: Array<{ id: string; title: string; kind: string; summary: string; scope: string }>;
  versions: unknown[];
  assetVersions: Record<string, Array<{ id: string; label: string; createdAt: string; content: string }>>;
  coProposals: CoProposalRecord[];
  threads: CoThreads;
  locks: LockMap;
};

export type TransactionInput<W extends TransactionWorkspace> = {
  bookId: string;
  workspace: W;
  proposalId: string;
  mode?: AdoptMode;
  acceptedOpIndexes?: number[];
  allowRelocatedAnchor?: boolean;
  confirmProgress?: boolean;
  snapshot?: (workspace: W, label: string) => W;
  now?: string;
};

export type TransactionOutcome<W extends TransactionWorkspace> =
  | { workspace: W; label: string; note: string; adoptedOpCount: number; changed: boolean }
  | { error: string; needsConfirmation?: "progress"; relocation?: { status: AnchorResolution["status"]; count?: number } };

const MAX_ASSET_VERSIONS = 30;

export function readTarget(workspace: TransactionWorkspace, target: CoTarget): { content: string; exists: boolean } {
  if (target.moduleId === "chapters") {
    const chapter = workspace.chapters.find((item) => item.id === (target.entityId ?? workspace.activeChapterId));
    return { content: chapter?.content ?? "", exists: Boolean(chapter) };
  }
  if (target.moduleId === "overview") return { content: workspace.idea, exists: true };
  const roadmap = getRoadmap(workspace.plot);
  if (target.moduleId === "event") {
    const event = roadmap.events.find((item) => item.id === target.entityId);
    return { content: event?.note ?? "", exists: Boolean(event) };
  }
  if (target.moduleId === "line") {
    const line = roadmap.lines.find((item) => item.id === target.entityId);
    return { content: line?.goal ?? "", exists: Boolean(line) };
  }
  return { content: workspace.assets[target.moduleId] ?? "", exists: true };
}

function recordAssetVersion<W extends TransactionWorkspace>(workspace: W, key: string, previous: string, label: string, now: string): W {
  const entry = { id: crypto.randomUUID(), createdAt: new Date(now).toLocaleString("zh-CN"), label, content: previous };
  return { ...workspace, assetVersions: { ...workspace.assetVersions, [key]: [entry, ...(workspace.assetVersions[key] ?? [])].slice(0, MAX_ASSET_VERSIONS) } };
}

function withThreadNote<W extends TransactionWorkspace>(workspace: W, target: CoTarget, text: string, now: string): W {
  return { ...workspace, threads: appendThreadMessage(workspace.threads, target, { role: "ai", text, at: now }) };
}

function markProposal<W extends TransactionWorkspace>(workspace: W, proposalId: string, status: CoProposalStatus): W {
  return { ...workspace, coProposals: workspace.coProposals.map((item) => item.id === proposalId ? { ...item, status } : item) };
}

// One transaction for every adoption path: validate while looking at the latest
// state, then hand back a single new workspace (content + candidate status +
// snapshot + thread note) so callers cannot half-apply it.
export function applyProposalTransaction<W extends TransactionWorkspace>(input: TransactionInput<W>): TransactionOutcome<W> {
  const { bookId, workspace, proposalId } = input;
  const now = input.now ?? new Date().toISOString();
  const proposal = workspace.coProposals.find((item) => item.id === proposalId);
  if (!proposal) return { error: "找不到这份候选稿（可能已被清理）。请在列表中重新选择。" };
  if (proposal.bookId !== bookId) return { error: "这份候选稿属于其他书籍，不能在当前书中采纳。" };
  // Idempotency is keyed on the proposal, not on content comparison.
  if (proposal.status !== "pending") return { error: "这份候选稿已经处理过，不会重复写入。" };

  if (isRoadmapProposal(proposal)) {
    const indexes = input.acceptedOpIndexes?.length ? input.acceptedOpIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < proposal.ops.length) : undefined;
    const ops = indexes ? indexes.map((index) => proposal.ops[index]) : proposal.ops;
    if (!ops.length) return { error: "没有选中要采纳的修改项。" };
    const roadmap = getRoadmap(workspace.plot);
    const check = checkRoadmapOps(ops, { target: proposal.target, roadmap, locks: workspace.locks, confirmProgress: input.confirmProgress });
    if ("error" in check) return { error: check.error, ...(check.needsConfirmation ? { needsConfirmation: check.needsConfirmation } : {}) };
    const touched = new Set([...check.touchedEventIds, ...check.touchedLineIds]);
    const drifted = changedBaseFields(roadmap, (proposal.baseFields ?? []).filter((entry) => touched.has(entry.id)));
    if (drifted.length) return { error: `候选要改的内容在生成后已被修改（${drifted.join("、")}）。请重新生成候选，或先确认这些改动。` };
    const applied = applyRoadmapOps(roadmap, ops);
    if ("error" in applied) return { error: applied.error };
    const label = `采纳 AI 剧情修改：${ops.length} 项`;
    let next: W = { ...workspace, plot: { ...workspace.plot, roadmap: applied.roadmap, version: workspace.plot.version + 1 } };
    if (input.snapshot) next = input.snapshot(next, label);
    next = markProposal(next, proposalId, "adopted");
    next = withThreadNote(next, proposal.target, `已按作者确认采纳 ${ops.length} 项剧情修改（修改前内容保留在快照中）。`, now);
    return { workspace: next, label, note: "已采纳剧情修改，可在故事版本中恢复", adoptedOpCount: ops.length, changed: true };
  }

  if (isLocked(workspace.locks, proposal.target) || isLocked(workspace.locks, { moduleId: "event", entityId: proposal.target.entityId }) || isLocked(workspace.locks, { moduleId: "line", entityId: proposal.target.entityId })) {
    return { error: `「${proposal.targetLabel}」已锁定，AI 不能改写。请先解锁。` };
  }
  const target = readTarget(workspace, proposal.target);
  if (!target.exists) return { error: "目标已不存在（可能已被删除）。候选稿保留，可放弃这份候选。" };
  const mode = input.mode ?? (proposal.scope === "selection" ? "replace-selection" : "replace-all");
  const adopted = adoptTextProposal(target.content, proposal, mode, { allowRelocated: input.allowRelocatedAnchor });
  if ("error" in adopted) {
    const relocation = proposal.anchor ? selectionRelocation(target.content, proposal) : undefined;
    return { error: adopted.error, ...(relocation ? { relocation } : {}) };
  }
  const label = `采纳 AI 候选稿：${proposal.targetLabel}`;
  if (!adopted.changed) {
    let unchanged: W = markProposal(workspace, proposalId, "adopted");
    unchanged = withThreadNote(unchanged, proposal.target, "候选内容与当前内容一致，未重复写入。", now);
    return { workspace: unchanged, label, note: "内容已经是最新的，无需重复写入", adoptedOpCount: 0, changed: false };
  }
  const content = adopted.content;
  let next: W;
  if (proposal.target.moduleId === "chapters") {
    const chapterId = proposal.target.entityId ?? workspace.activeChapterId;
    next = recordAssetVersion(workspace, `chapter:${chapterId}`, target.content, label, now);
    next = { ...next, chapters: next.chapters.map((chapter) => chapter.id === chapterId ? { ...chapter, content, updatedAt: now } : chapter) };
  } else if (proposal.target.moduleId === "overview") {
    next = { ...workspace, idea: content };
    if (input.snapshot) next = input.snapshot(next, label);
  } else if (proposal.target.moduleId === "event" || proposal.target.moduleId === "line") {
    const roadmap = getRoadmap(workspace.plot);
    next = proposal.target.moduleId === "event"
      ? { ...workspace, plot: { ...workspace.plot, version: workspace.plot.version + 1, roadmap: { ...roadmap, events: roadmap.events.map((event) => event.id === proposal.target.entityId ? { ...event, note: content } : event) } } }
      : { ...workspace, plot: { ...workspace.plot, version: workspace.plot.version + 1, roadmap: { ...roadmap, lines: roadmap.lines.map((line) => line.id === proposal.target.entityId ? { ...line, goal: content } : line) } } };
    if (input.snapshot) next = input.snapshot(next, label);
  } else {
    next = recordAssetVersion(workspace, proposal.target.moduleId, target.content, label, now);
    next = { ...next, assets: { ...next.assets, [proposal.target.moduleId]: content } };
  }
  next = markProposal(next, proposalId, "adopted");
  next = withThreadNote(next, proposal.target, "已采纳候选稿，修改前内容保留在快照或版本记录中。", now);
  return { workspace: next, label, note: "已采纳候选稿，修改前内容保留在版本记录中", adoptedOpCount: 0, changed: true };
}

// ---------------------------------------------------------------- threads

export type CoMessage = { role: "user" | "ai"; text: string; at: string };
export type CoThread = { key: string; moduleId: CoModuleId; entityId?: string; messages: CoMessage[]; updatedAt: string; draft?: string };
export type CoThreads = Record<string, CoThread>;

// Unsent input belongs to its target, so switching nodes and coming back keeps it.
export function setThreadDraft(threads: CoThreads, target: CoTarget, draft: string): CoThreads {
  const key = targetKey(target);
  const existing = threads[key];
  const base: CoThread = existing ?? { key, moduleId: target.moduleId, ...(target.entityId ? { entityId: target.entityId } : {}), messages: [], updatedAt: "" };
  return { ...threads, [key]: { ...base, draft: draft.slice(0, 8000) } };
}

export function appendThreadMessage(threads: CoThreads, target: CoTarget, message: CoMessage): CoThreads {
  const key = targetKey(target);
  const existing = threads[key];
  const thread: CoThread = existing
    ? { ...existing, messages: [...existing.messages, message].slice(-MAX_THREAD_MESSAGES), updatedAt: message.at }
    : { key, moduleId: target.moduleId, ...(target.entityId ? { entityId: target.entityId } : {}), messages: [message], updatedAt: message.at };
  return { ...threads, [key]: thread };
}

export function clearThread(threads: CoThreads, target: CoTarget): CoThreads {
  return Object.fromEntries(Object.entries(threads).filter(([key]) => key !== targetKey(target)));
}

// ---------------------------------------------------------------- locks

export type LockMap = Record<string, string[]>;

export function isLocked(locks: LockMap | undefined, target: CoTarget, field = "full"): boolean {
  const fields = locks?.[targetKey(target)];
  return Boolean(fields?.includes(field) || fields?.includes("full"));
}

export function toggleLock(locks: LockMap | undefined, target: CoTarget, field = "full"): LockMap {
  const key = targetKey(target);
  const current = locks?.[key] ?? [];
  const next = current.includes(field) ? current.filter((item) => item !== field) : [...current, field];
  const result = { ...(locks ?? {}) };
  if (next.length) result[key] = next; else delete result[key];
  return result;
}

export function lockedLabels(locks: LockMap | undefined, target: CoTarget): string[] {
  return locks?.[targetKey(target)] ?? [];
}

// Locks come from user data: keep well-formed field names, drop the rest.
export function normalizeLocks(input: unknown): LockMap {
  if (!input || typeof input !== "object") return {};
  const result: LockMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const fields = value.filter((field): field is string => typeof field === "string" && field.length > 0 && field.length <= 60).slice(0, 30);
    if (fields.length) result[key.slice(0, 200)] = [...new Set(fields)];
  }
  return result;
}

export type ViewStateMap = Record<string, Record<string, number>>;

// Viewport memory is a preference, not content: keep finite numbers only.
export function normalizeView(input: unknown): ViewStateMap {
  if (!input || typeof input !== "object") return {};
  const result: ViewStateMap = {};
  for (const [moduleId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const next: Record<string, number> = {};
    for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      if (field === "scale") next.scale = Math.min(4, Math.max(.02, raw));
      else if (field === "lod") next.lod = Math.max(0, Math.min(2, Math.round(raw)));
      else next[field.slice(0, 40)] = Math.max(-1e6, Math.min(1e6, raw));
    }
    if (Object.keys(next).length) result[moduleId.slice(0, 80)] = next;
  }
  return result;
}

// ------------------------------------------------------------ normalization

export const MAX_THREAD_MESSAGES = 200;
export const MAX_PROPOSALS = 60;

export function normalizeThreads(input: unknown): CoThreads {
  if (!input || typeof input !== "object") return {};
  const result: CoThreads = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const thread = value as Partial<CoThread> | undefined;
    if (!thread || !Array.isArray(thread.messages)) continue;
    const messages = thread.messages.flatMap((message): CoMessage[] => {
      const item = message as Partial<CoMessage> | undefined;
      if (!item || (item.role !== "user" && item.role !== "ai") || typeof item.text !== "string" || !item.text) return [];
      return [{ role: item.role, text: item.text.slice(0, 20000), at: typeof item.at === "string" ? item.at : "" }];
    }).slice(-MAX_THREAD_MESSAGES);
    const draft = typeof thread.draft === "string" && thread.draft.trim() ? thread.draft.slice(0, 8000) : undefined;
    if (!messages.length && !draft) continue;
    result[key] = {
      key, moduleId: (thread.moduleId ?? "world") as CoModuleId,
      ...(thread.entityId ? { entityId: thread.entityId } : {}),
      messages, updatedAt: typeof thread.updatedAt === "string" ? thread.updatedAt : "",
      ...(draft ? { draft } : {}),
    };
  }
  return result;
}

export function normalizeProposals(input: unknown): CoProposalRecord[] {
  if (!Array.isArray(input)) return [];
  const result: CoProposalRecord[] = [];
  for (const value of input) {
    const proposal = value as Partial<CoProposal> & Partial<RoadmapProposal> | undefined;
    if (!proposal) continue;
    if (typeof proposal.id !== "string" || typeof proposal.bookId !== "string" || !proposal.target) continue;
    const base = {
      id: proposal.id.slice(0, 160), bookId: proposal.bookId, target: proposal.target,
      targetLabel: typeof proposal.targetLabel === "string" ? proposal.targetLabel.slice(0, 120) : MODULE_LABELS[proposal.target.moduleId] ?? proposal.target.moduleId,
      baseRevision: typeof proposal.baseRevision === "number" ? proposal.baseRevision : 0,
      ...(typeof proposal.instruction === "string" ? { instruction: proposal.instruction.slice(0, 2000) } : {}),
      threadKey: typeof proposal.threadKey === "string" ? proposal.threadKey : "",
      ...(typeof proposal.revisedFrom === "string" && proposal.revisedFrom ? { revisedFrom: proposal.revisedFrom.slice(0, 160) } : {}),
      createdAt: typeof proposal.createdAt === "string" ? proposal.createdAt : new Date().toISOString(),
      status: proposal.status === "adopted" || proposal.status === "discarded" ? proposal.status : "pending" as const,
    };
    if (proposal.kind === "roadmap-ops") {
      if (!Array.isArray(proposal.ops) || !proposal.ops.length) continue;
      result.push({
        ...base, kind: "roadmap-ops", ops: proposal.ops.slice(0, 40),
        ...(Array.isArray(proposal.baseFields) ? { baseFields: (proposal.baseFields as BaseFieldEntry[]).slice(0, 40) } : {}),
        ...(Array.isArray(proposal.progressEventIds) ? { progressEventIds: (proposal.progressEventIds as string[]).slice(0, 40) } : {}),
      });
      continue;
    }
    if (proposal.kind !== "text") continue;
    if (typeof proposal.after !== "string" || typeof proposal.before !== "string") continue;
    const anchor = proposal.anchor && typeof proposal.anchor.start === "number" && typeof proposal.anchor.end === "number" && typeof proposal.anchor.text === "string"
      ? { start: proposal.anchor.start, end: proposal.anchor.end, text: proposal.anchor.text.slice(0, 20000) } : undefined;
    const scope = (["full", "selection", "insert-before", "insert-after", "append"] as const).includes(proposal.scope as ProposalScope) ? proposal.scope as ProposalScope : "full";
    result.push({
      ...base, kind: "text", scope, ...(anchor ? { anchor } : {}),
      baseHash: typeof proposal.baseHash === "string" ? proposal.baseHash : contentHash(proposal.before),
      before: proposal.before.slice(0, 200000), after: proposal.after.slice(0, 200000),
    });
  }
  return result.slice(-MAX_PROPOSALS).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function pendingProposalsFor(proposals: CoProposalRecord[], target: CoTarget): CoProposalRecord[] {
  const key = targetKey(target);
  return proposals.filter((proposal) => proposal.status === "pending" && targetKey(proposal.target) === key);
}

// Which API task serves each target: discussion never writes, generation always
// produces a candidate instead of touching the manuscript.
export function defaultTaskFor(target: CoTarget, mode: "discuss" | "generate"): string {
  const structured = target.moduleId === "roadmap" || target.moduleId === "event" || target.moduleId === "line";
  if (structured) return mode === "discuss" ? "plot_discussion" : "roadmap_edit";
  if (mode === "discuss") return "chat";
  if (target.moduleId === "overview") return "story_seed";
  if (target.moduleId === "world") return "world_design";
  if (target.moduleId === "characters") return "character_design";
  if (target.moduleId === "style") return "style_fingerprint";
  if (target.moduleId === "outline") return "outline_design";
  if (target.moduleId === "chapters") return "chapter_write";
  return "chat";
}

export const CANDIDATE_DELIMITER = "===候选";
export const THREE_DIRECTIONS_HINT = "请给出三个明显不同的方向，用 ===候选1===、===候选2===、===候选3=== 三个小节分隔，每节只写可直接采用的正文，不要解释。";

// The author only pays for three drafts when they explicitly ask for them.
export function splitCandidates(text: string): string[] {
  const parts = text.split(/===+\s*候选\s*[0-9一二三四五]\s*===+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, 3) : [text.trim()].filter(Boolean);
}

// Instructions sent with every candidate request so locked ranges are respected.
export function lockInstruction(locked: string[]): string {
  if (!locked.length) return "";
  return `\n\n作者已锁定：${locked.map((field) => field === "full" ? "整段内容" : field).join("、")}。只提出建议或候选，不要改动锁定内容。`;
}

// ------------------------------------------------ context for the model call

export type CoContextSection = { label: string; detail: string; included: boolean };

export type ContextPacket = {
  target: CoTarget;
  targetLabel: string;
  locked: string[];
  sections: CoContextSection[];
  text: string;
  discussionSummary: string;
  referenceScope?: string;
  references: Array<{ title: string; kind: string; summary: string }>;
  candidates: Array<{ id: string; label: string; instruction?: string; excerpt: string }>;
  trimming: string[];
  selectionText?: string;
};

export type CoContext = ContextPacket;

export function summarizeThread(messages: CoMessage[], limit = 8): string {
  const recent = messages.slice(-limit);
  if (!recent.length) return "";
  return recent.map((message) => `${message.role === "user" ? "作者" : "AI"}：${message.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
}

export type PacketInput = {
  workspace: WorkspaceLike;
  target: CoTarget;
  thread?: CoThread;
  locks?: LockMap;
  selection?: TextAnchor | null;
  pendingCandidates?: CoProposalRecord[];
  budget?: number;
};

// One packet drives both the panel preview and the request payload, so what the
// UI says is included is exactly what the model receives. Cutting is reported
// instead of silently dropping material.
export function buildContextPacket(input: PacketInput): ContextPacket {
  const { workspace, target, thread, locks, selection } = input;
  const budget = input.budget ?? 120000;
  const roadmap = getRoadmap(workspace.plot);
  const scope = MODULE_REFERENCE_SCOPE[target.moduleId];
  const label = targetLabelFor(workspace, target, roadmap);
  const locked = lockedLabels(locks, target);
  const text = moduleText(workspace, target);
  const chapterIndex = Math.max(0, workspace.chapters.findIndex((item) => item.id === (target.entityId ?? workspace.activeChapterId)));
  const boundTitles = (workspace.chapters[chapterIndex]?.plotEventIds ?? [])
    .map((id) => roadmap.events.find((event) => event.id === id)?.title)
    .filter((title): title is string => Boolean(title));
  const targetEvent = target.moduleId === "event" && target.entityId ? roadmap.events.find((event) => event.id === target.entityId) : undefined;
  const targetLine = target.moduleId === "line" && target.entityId ? roadmap.lines.find((line) => line.id === target.entityId) : undefined;
  const references = workspace.references.filter((item) => !scope || item.scope === scope);
  const prior = workspace.chapters.slice(Math.max(0, chapterIndex - 3), chapterIndex);
  const pending = input.pendingCandidates ?? [];
  const trimming: string[] = [];

  const settingsEntries = Object.entries(workspace.assets)
    .filter(([key, value]) => key !== target.moduleId && Boolean(value?.trim()));
  const settingsText = settingsEntries.map(([key, value]) => `【${ASSET_LABELS[key] ?? key}】\n${value.slice(0, 14000)}`).join("\n\n");
  const chapterPlan = target.moduleId === "chapters" ? chapterPlanText(workspace, target) : "";
  const eventText = targetEvent ? `【当前事件】\n${JSON.stringify({ id: targetEvent.id, title: targetEvent.title, note: targetEvent.note, chapter: targetEvent.chapter, order: targetEvent.order, status: targetEvent.status })}\n属于故事线：${roadmap.lines.filter((line) => line.eventIds.includes(targetEvent.id)).map((line) => line.title).join("、")}` : "";
  const lineText = targetLine ? `【当前故事线】\n${JSON.stringify({ id: targetLine.id, title: targetLine.title, goal: targetLine.goal, kind: targetLine.kind })}\n事件顺序：${targetLine.eventIds.map((id) => roadmap.events.find((event) => event.id === id)?.title ?? id).join(" → ")}` : "";
  const candidateText = pending.length
    ? `【待采纳候选，尚未成为正式内容】\n${pending.map((candidate) => `候选 ${candidate.id}（${candidate.targetLabel}）：${isRoadmapProposal(candidate) ? candidate.ops.map((op) => describeRoadmapOp(op, roadmap)).join("；") : candidate.after.slice(0, 1500)}`).join("\n")}`
    : "";
  const selectionText = selection ? `【作者选中的内容】\n${selection.text}` : "";
  const priorText = prior.map((chapter) => `【前文：${chapter.title}，末尾片段】\n${chapter.content.slice(-5000)}`).join("\n\n");
  const referenceText = references.slice(-12).map((item, index) => `${index + 1}. ${item.title} [${item.kind}]\n${item.summary.slice(0, 12000)}`).join("\n\n");

  const parts = [
    `【本次目标】${label}`,
    locked.length ? `【作者锁定】${locked.map((field) => field === "full" ? "整段内容" : field).join("、")}，不要改写锁定内容。` : "",
    `【当前内容】\n${text.slice(0, 24000) || "（当前为空）"}`,
    selectionText,
    settingsText,
    chapterPlan,
    eventText,
    lineText,
    candidateText,
    workspace.plot.summary ? `【主支线说明】\n${workspace.plot.summary}` : "",
    `【世界线写作约束】剧情事件是计划，不是已经发生的正文事实；未选中的后续事件只作伏笔。`,
    priorText,
    `【讨论摘要】\n${summarizeThread(thread?.messages ?? [])}`,
    referenceText ? `【参考材料】\n${referenceText}` : "",
  ].filter(Boolean);
  let assembled = parts.join("\n\n");
  if (assembled.length > budget) {
    trimming.push(`相关内容超过 ${Math.round(budget / 1000)}k 字符，已按优先级裁剪：参考材料与前文最先缩短。`);
    assembled = `${assembled.slice(0, budget - 40)}\n…（已裁剪）`;
  }
  const sections: CoContextSection[] = [
    { label: "当前目标", detail: label, included: true },
    { label: "作者锁定", detail: locked.length ? locked.map((field) => field === "full" ? "整段内容" : field).join("、") : "未锁定，AI 只会提出候选稿", included: locked.length > 0 },
    { label: "当前内容", detail: text.trim() ? `${text.trim().length} 字` : "还是空的，AI 会先给初稿", included: true },
    { label: "作者选中内容", detail: selection ? `${selection.text.length} 字：${selection.text.slice(0, 40)}…` : "未选择局部目标", included: Boolean(selection) },
    { label: "相关设定", detail: settingsEntries.length ? `会参考：${settingsEntries.map(([key]) => ASSET_LABELS[key] ?? key).join("、")}` : "尚未填写其他设定", included: settingsEntries.length > 0 },
    { label: "剧情事件", detail: targetEvent ? targetEvent.title : targetLine ? `${targetLine.title} 的 ${targetLine.eventIds.length} 个事件` : chapterPlan ? `本章推进目标：${boundTitles.join("、")}` : boundTitles.length ? boundTitles.join("、") : "本目标未绑定剧情事件", included: true },
    { label: "相关前文", detail: prior.length ? `${prior.map((chapter) => chapter.title).join("、")} 的末尾片段` : "本章是开篇，没有前文", included: prior.length > 0 },
    { label: "讨论摘要", detail: thread?.messages.length ? `最近 ${Math.min(thread.messages.length, 8)} 条` : "尚无讨论", included: Boolean(thread?.messages.length) },
    { label: "待采纳候选", detail: pending.length ? `${pending.length} 份会一起带上，便于继续修改` : "当前没有候选", included: pending.length > 0 },
    { label: "借鉴资料", detail: references.length ? `${references.length} 项（仅本模块范围）` : "本模块暂无借鉴", included: references.length > 0 },
    ...(trimming.length ? [{ label: "裁剪", detail: trimming.join("；"), included: true }] : []),
  ];
  return {
    target, targetLabel: label, locked, sections, text: assembled,
    discussionSummary: summarizeThread(thread?.messages ?? []),
    ...(scope ? { referenceScope: scope } : {}),
    references: references.slice(-12).map((item) => ({ title: item.title.slice(0, 500), kind: item.kind.slice(0, 100), summary: item.summary.slice(0, 12000) })),
    candidates: pending.map((candidate) => ({
      id: candidate.id, label: candidate.targetLabel,
      ...(candidate.instruction ? { instruction: candidate.instruction } : {}),
      excerpt: isRoadmapProposal(candidate) ? candidate.ops.map((op) => describeRoadmapOp(op, roadmap)).join("；").slice(0, 300) : candidate.after.slice(0, 300),
    })),
    trimming,
    ...(selection ? { selectionText: selection.text } : {}),
  };
}

// The plan for this request: persisted bindings when the author set them,
// otherwise the recommended targets. It is context only — generating never
// writes plotEventIds, that stays the author's own confirmation.
function chapterPlanText(workspace: WorkspaceLike, target: CoTarget): string {
  const plan = chapterPlan({ ...workspace, activeChapterId: target.entityId ?? workspace.activeChapterId } as never);
  if (!plan.events.length) return "";
  const suffix = plan.manual ? "作者已指定本章推进事件。" : "按世界线推荐，作者尚未确认。";
  return `【本章推进目标】\n${plan.events.map((event) => `${event.title}：${event.note}`).join("\n")}\n${suffix}只展开本章目标，其他事件作为后续计划。`;
}

export function buildCoContext(workspace: WorkspaceLike, target: CoTarget, thread: CoThread | undefined, locks: LockMap | undefined): ContextPacket {
  return buildContextPacket({ workspace, target, thread, locks });
}

const ASSET_LABELS: Record<string, string> = { world: "世界观", characters: "人物角色", timeline: "旧剧情笔记（冲突以已确认正文与当前世界线为准）", style: "文笔文风", outline: "卷章大纲", overview: "故事蓝图", chapters: "章节正文" };

// Reference scope per module keeps references from other modules out of the call.
export const MODULE_REFERENCE_SCOPE: Record<CoModuleId, string | undefined> = {
  overview: undefined, world: "world", characters: "character", style: "style", outline: "plot",
  timeline: "plot", chapters: "plot", roadmap: "plot", event: "plot", line: "plot",
};

// Mirrors plot data with the few fields every module needs, so tests and the
// desktop store can pass plain objects.
export type PlotLike = Parameters<typeof getRoadmap>[0];

export type WorkspaceLike = {
  idea: string; tags: string[]; assets: Record<string, string>;
  chapters: Array<{ id: string; title: string; content: string; plotEventIds?: string[] }>;
  activeChapterId: string;
  references: Array<{ id: string; title: string; kind: string; summary: string; scope: string }>;
  plot: PlotLike;
};

// Text of the target the author is working on. Structured targets read their
// real field instead of an empty assets entry.
export function moduleText(workspace: WorkspaceLike, target: CoTarget): string {
  if (target.moduleId === "chapters") return workspace.chapters.find((item) => item.id === (target.entityId ?? workspace.activeChapterId))?.content ?? "";
  if (target.moduleId === "overview") return workspace.idea;
  if (target.moduleId === "event" && target.entityId) return getRoadmap(workspace.plot).events.find((event) => event.id === target.entityId)?.note ?? "";
  if (target.moduleId === "line" && target.entityId) return getRoadmap(workspace.plot).lines.find((line) => line.id === target.entityId)?.goal ?? "";
  return workspace.assets[target.moduleId] ?? "";
}

export function targetLabelFor(workspace: WorkspaceLike, target: CoTarget, roadmap: StoryRoadmap = getRoadmap(workspace.plot)): string {
  const moduleLabel = MODULE_LABELS[target.moduleId] ?? target.moduleId;
  if (target.moduleId === "event" && target.entityId) {
    const event = roadmap.events.find((item) => item.id === target.entityId);
    const lines = roadmap.lines.filter((line) => line.eventIds.includes(target.entityId!));
    return event ? `${moduleLabel} / ${event.title}${lines.length ? `（${lines.map((line) => line.title).join(" / ")}）` : ""}` : moduleLabel;
  }
  if (target.moduleId === "line" && target.entityId) return `${moduleLabel} / ${roadmap.lines.find((line) => line.id === target.entityId)?.title ?? "故事线"}`;
  if (target.moduleId === "chapters") return `${moduleLabel} / ${workspace.chapters.find((item) => item.id === (target.entityId ?? workspace.activeChapterId))?.title ?? "当前章"}`;
  return moduleLabel;
}

