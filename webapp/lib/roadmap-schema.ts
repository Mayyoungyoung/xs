import { z } from "zod";
import type { StoryRoadmap } from "./story-roadmap";

const key = z.string().min(1).max(160);
const event = z.object({ id: key, title: z.string().trim().min(1).max(80), note: z.string().max(800), order: z.number().finite().min(0).max(10000), chapter: z.string().max(40), status: z.enum(["planned", "active", "done"]).default("planned") });
const line = z.object({ id: key, title: z.string().trim().min(1).max(80), goal: z.string().max(2000), kind: z.enum(["main", "branch"]), color: z.string().regex(/^#[0-9a-f]{6}$/i), eventIds: z.array(key).max(80), originId: key.optional() });
function relationships(data: StoryRoadmap, ctx: z.RefinementCtx) {
  const problem = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = new Set(data.events.map((item) => item.id));
  if (ids.size !== data.events.length || new Set(data.lines.map((item) => item.id)).size !== data.lines.length) problem("故事线与事件编号不能重复");
  if (data.lines.length && !data.lines.some((item) => item.kind === "main")) problem("至少保留一条主线");
  for (const item of data.lines) {
    if (new Set(item.eventIds).size !== item.eventIds.length || item.eventIds.some((id) => !ids.has(id))) problem("故事线关联了无效或重复事件");
    if (item.kind === "branch") {
      const origin = data.events.find((event) => event.id === item.originId);
      if (!origin || !item.eventIds.includes(origin.id) || !data.lines.some((other) => other.id !== item.id && other.eventIds.includes(origin.id))) problem("支线必须从已有故事线的事件衍生");
      if (origin && data.events.some((event) => item.eventIds.includes(event.id) && event.order < origin.order)) problem("支线事件不能早于衍生起点");
    }
  }
  if (data.events.some((event) => !data.lines.some((item) => item.eventIds.includes(event.id)))) problem("事件必须属于至少一条故事线");
  const reached = new Set(data.lines.filter((item) => item.kind === "main").map((item) => item.id));
  for (let pass = 0; pass < data.lines.length; pass++) {
    const available = new Set(data.lines.filter((item) => reached.has(item.id)).flatMap((item) => item.eventIds));
    for (const item of data.lines) if (item.originId && available.has(item.originId)) reached.add(item.id);
  }
  if (data.lines.some((item) => !reached.has(item.id))) problem("支线的衍生关系必须能追溯到主线");
}
const base = z.object({ lines: z.array(line).max(16), events: z.array(event).max(80) });
export const roadmapSchema = base.superRefine(relationships);
export const roadmapDraftSchema = base.extend({ lines: z.array(line.extend({ title: z.string().max(80) })).max(16), events: z.array(event.extend({ title: z.string().max(80) })).max(80) }).superRefine(relationships);
export const generatedRoadmapSchema = z.object({ summary: z.string().min(1).max(8000), ...base.shape }).superRefine((value, ctx) => {
  relationships(value, ctx);
  if (value.events.length < 2 || !value.lines.length) ctx.addIssue({ code: "custom", message: "至少需要一条主线与两个事件" });
});
