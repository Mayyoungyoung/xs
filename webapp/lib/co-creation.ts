// Unified co-creation protocol shared by every writing module.
// Pure functions only: no React, no storage, no network. The UI, the API route
// and the desktop bridge all build on these helpers so the three entry points
// (write yourself / generate / discuss) operate on the same content.

import { z } from "zod";
import type { RoadmapEvent, Storyline, StoryRoadmap } from "./story-roadmap";
import { getRoadmap } from "./story-roadmap";
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

export type TextAnchor = { start: number; end: number; text: string };

export function contentHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}

export function anchorFromRange(content: string, start: number, end: number): TextAnchor | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > content.length || end <= start) return null;
  return { start, end, text: content.slice(start, end) };
}

// An anchor is only reusable while the exact same text still sits at the same
// offsets. Content edited during generation invalidates it on purpose.
export function anchorValid(content: string, anchor: TextAnchor): boolean {
  return content.slice(anchor.start, anchor.end) === anchor.text;
}

export function relocateAnchor(content: string, anchor: TextAnchor): TextAnchor | null {
  if (anchorValid(content, anchor)) return anchor;
  const found = content.indexOf(anchor.text);
  if (found < 0) return null;
  return { start: found, end: found + anchor.text.length, text: anchor.text };
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
  createdAt: string;
  status: CoProposalStatus;
};

export function makeTextProposal(input: {
  bookId: string; target: CoTarget; targetLabel: string; content: string; after: string;
  anchor?: TextAnchor | null; scope: ProposalScope; baseRevision: number; threadKey: string;
  instruction?: string; now?: string; id?: string;
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
    threadKey: input.threadKey,
    createdAt: input.now ?? new Date().toISOString(),
    status: "pending",
  };
}

export type AdoptResult = { content: string; changed: boolean } | { error: string };

export function adoptTextProposal(current: string, proposal: CoProposal, mode: AdoptMode): AdoptResult {
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
  const anchor = proposal.anchor ? relocateAnchor(current, proposal.anchor) : null;
  if (!anchor) return { error: "找不到原来的选中位置，可能已被修改。请在正文中重新选中目标后重试，或改选整体替换。" };
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
  instruction?: string;
  threadKey: string;
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
  threadKey: string; instruction?: string; now?: string; id?: string;
}): RoadmapProposal {
  return {
    id: input.id ?? crypto.randomUUID(),
    bookId: input.bookId,
    kind: "roadmap-ops",
    target: input.target,
    targetLabel: input.targetLabel,
    ops: input.ops,
    baseRevision: input.baseRevision,
    ...(input.instruction ? { instruction: input.instruction } : {}),
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

const opSchema = z.object({
  op: z.enum(["updateEvent", "addEvent", "linkEvent", "updateLine"]),
  eventId: z.string().min(1).max(160).optional(),
  lineId: z.string().min(1).max(160).optional(),
  lineIds: z.array(z.string().min(1).max(160)).max(16).optional(),
  event: z.unknown().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

// Model output for roadmap edits is validated before it can touch the canvas:
// schema, target existence, reference integrity and allowed fields.
export function parseRoadmapOps(content: string, roadmap: StoryRoadmap): RoadmapOp[] | { error: string } {
  const json = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { error: "模型没有返回可解析的修改指令（需要 JSON），原内容已保留。" }; }
  const rawOps = (data as { ops?: unknown } | null)?.ops;
  const parsed = z.array(opSchema).max(40).safeParse(rawOps);
  if (!parsed.success) return { error: "修改指令结构不正确，原内容已保留。请重试或换一种说法。" };
  if (!parsed.data.length) return [];
  const ops: RoadmapOp[] = [];
  const lines = new Set(roadmap.lines.map((line) => line.id));
  const events = new Set(roadmap.events.map((event) => event.id));
  for (const raw of parsed.data) {
    if (raw.op === "updateEvent") {
      if (!raw.eventId || !events.has(raw.eventId)) return { error: "修改指令引用了不存在的事件，原图已保留。" };
      const fields = pickEventFields(raw.fields);
      if (!Object.keys(fields).length) return { error: "修改指令没有给出可用的字段（标题、说明、章节、顺序或进度），原图已保留。" };
      ops.push({ op: "updateEvent", eventId: raw.eventId, fields });
    } else if (raw.op === "addEvent") {
      const lineIds = (raw.lineIds ?? []).filter((id) => lines.has(id));
      if (!lineIds.length) return { error: "新增事件必须指定已有的故事线，原图已保留。" };
      const event = parsedEvent(raw.event);
      if (!event) return { error: "新增事件的字段不完整，原图已保留。" };
      ops.push({ op: "addEvent", event, lineIds });
    } else if (raw.op === "linkEvent") {
      if (!raw.lineId || !lines.has(raw.lineId) || !raw.eventId || !events.has(raw.eventId)) return { error: "关联指令引用了不存在的故事线或事件，原图已保留。" };
      ops.push({ op: "linkEvent", lineId: raw.lineId, eventId: raw.eventId });
    } else {
      if (!raw.lineId || !lines.has(raw.lineId)) return { error: "修改指令引用了不存在的故事线，原图已保留。" };
      const fields = pickLineFields(raw.fields);
      if (!Object.keys(fields).length) return { error: "修改指令没有给出可用的故事线字段，原图已保留。" };
      ops.push({ op: "updateLine", lineId: raw.lineId, fields });
    }
  }
  return ops;
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

// ---------------------------------------------------------------- threads

export type CoMessage = { role: "user" | "ai"; text: string; at: string };
export type CoThread = { key: string; moduleId: CoModuleId; entityId?: string; messages: CoMessage[]; updatedAt: string };
export type CoThreads = Record<string, CoThread>;

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
    if (!messages.length) continue;
    result[key] = { key, moduleId: (thread.moduleId ?? "world") as CoModuleId, ...(thread.entityId ? { entityId: thread.entityId } : {}), messages, updatedAt: typeof thread.updatedAt === "string" ? thread.updatedAt : "" };
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
      createdAt: typeof proposal.createdAt === "string" ? proposal.createdAt : new Date().toISOString(),
      status: proposal.status === "adopted" || proposal.status === "discarded" ? proposal.status : "pending" as const,
    };
    if (proposal.kind === "roadmap-ops") {
      if (!Array.isArray(proposal.ops) || !proposal.ops.length) continue;
      result.push({ ...base, kind: "roadmap-ops", ops: proposal.ops.slice(0, 40) });
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

export type CoContext = {
  target: CoTarget;
  targetLabel: string;
  locked: string[];
  sections: CoContextSection[];
  text: string;
  discussionSummary: string;
  referenceScope?: string;
};

export function summarizeThread(messages: CoMessage[], limit = 8): string {
  const recent = messages.slice(-limit);
  if (!recent.length) return "";
  return recent.map((message) => `${message.role === "user" ? "作者" : "AI"}：${message.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
}

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

export function moduleText(workspace: WorkspaceLike, target: CoTarget): string {
  if (target.moduleId === "chapters") return workspace.chapters.find((item) => item.id === (target.entityId ?? workspace.activeChapterId))?.content ?? "";
  if (target.moduleId === "overview") return workspace.idea;
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

export function buildCoContext(workspace: WorkspaceLike, target: CoTarget, thread: CoThread | undefined, locks: LockMap | undefined): CoContext {
  const roadmap = getRoadmap(workspace.plot);
  const scope = MODULE_REFERENCE_SCOPE[target.moduleId];
  const label = targetLabelFor(workspace, target, roadmap);
  const locked = lockedLabels(locks, target);
  const text = moduleText(workspace, target);
  const chapterIndex = Math.max(0, workspace.chapters.findIndex((item) => item.id === (target.entityId ?? workspace.activeChapterId)));
  const boundTitles = (workspace.chapters[chapterIndex]?.plotEventIds ?? [])
    .map((id) => roadmap.events.find((event) => event.id === id)?.title)
    .filter((title): title is string => Boolean(title));
  const eventTitles = target.moduleId === "event" && target.entityId ? [roadmap.events.find((event) => event.id === target.entityId)?.title].filter(Boolean) as string[] : [];
  const references = workspace.references.filter((item) => !scope || item.scope === scope);
  const prior = workspace.chapters.slice(Math.max(0, chapterIndex - 3), chapterIndex);
  const sections: CoContextSection[] = [
    { label: "当前目标", detail: label, included: true },
    { label: "作者锁定", detail: locked.length ? locked.map((field) => field === "full" ? "整段内容" : field).join("、") : "未锁定，AI 只会提出候选稿", included: locked.length > 0 },
    { label: "当前内容", detail: text.trim() ? `${text.trim().length} 字` : "还是空的，AI 会先给初稿", included: true },
    { label: "相关设定", detail: settingsSummary(workspace, target), included: true },
    { label: "剧情事件", detail: eventTitles.length ? eventTitles.join("、") : boundTitles.length ? boundTitles.join("、") : "本目标未绑定剧情事件", included: true },
    { label: "相关前文", detail: prior.length ? `${prior.map((chapter) => chapter.title).join("、")} 的末尾片段` : "本章是开篇，没有前文", included: prior.length > 0 },
    { label: "讨论摘要", detail: thread?.messages.length ? `最近 ${Math.min(thread.messages.length, 8)} 条` : "尚无讨论", included: Boolean(thread?.messages.length) },
    { label: "借鉴资料", detail: references.length ? `${references.length} 项` : "本模块暂无借鉴", included: true },
  ];
  return {
    target, targetLabel: label, locked, sections, text,
    discussionSummary: summarizeThread(thread?.messages ?? []),
    ...(scope ? { referenceScope: scope } : {}),
  };
}

function settingsSummary(workspace: WorkspaceLike, target: CoTarget): string {
  const names: Record<string, string> = { world: "世界观", characters: "人物角色", style: "文笔文风", outline: "卷章大纲", timeline: "剧情笔记" };
  const parts = Object.entries(workspace.assets)
    .filter(([key, value]) => key !== target.moduleId && Boolean(value?.trim()))
    .map(([key]) => names[key] ?? key);
  return parts.length ? `会参考：${parts.join("、")}` : "尚未填写其他设定";
}
