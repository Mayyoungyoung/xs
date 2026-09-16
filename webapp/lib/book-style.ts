// The single source of what style the book currently writes with.
//
// Data semantics (three layers, one resolver):
// - Library template (workspace.styleProfiles): a reusable draft of rules, edited
//   on the 借鉴库 page. Versioned, append-only history already exists.
// - Book style state (workspace.bookStyle): WHICH template the book writes with,
//   pinned to the version applied, plus the book's own edits. Template updates
//   never leak in until the author explicitly updates.
// - Effective style (resolveEffectiveStyle): the rules actually sent to the model.
//   Every writing entry (packet assembly, trial write, previews) reads this.
//
// assets.style keeps exactly one job: the author's own hand-written supplement,
// which outranks template rules (it feeds buildStyleContext's 作者确认规则).

import type { StyleProfile, StyleRule } from "./style-fidelity";
import { profileDisplayName } from "./style-fidelity";

export type BookStyleMode = "template" | "custom" | "off";

export type BookStyleState = {
  mode: BookStyleMode;
  // Template the book applied, pinned to the applied version.
  templateId?: string;
  templateVersion?: number;
  templateName?: string;
  // The book's working copy of the rules: copied from the template at apply
  // time, then edited here. Edits never write back to the library template.
  rules?: StyleRule[];
  updatedAt?: string;
};

const MODES: BookStyleMode[] = ["template", "custom", "off"];

function normalizeRule(rule: unknown): StyleRule | null {
  const value = rule as Partial<StyleRule> | undefined;
  if (!value || typeof value.text !== "string" || !value.text.trim()) return null;
  return {
    id: typeof value.id === "string" ? value.id.slice(0, 160) : `rule-${Math.random().toString(36).slice(2, 10)}`,
    text: value.text.slice(0, 400),
    layer: value.layer === "mechanical" || value.layer === "chapter" ? value.layer : "semantic",
    origin: value.origin === "author_written" || value.origin === "primary_excerpt" || value.origin === "critical_analysis" || value.origin === "bibliographic_metadata" || value.origin === "user_approved_output" ? value.origin : "model_prior",
    evidenceIds: (Array.isArray(value.evidenceIds) ? value.evidenceIds : []).filter((id): id is string => typeof id === "string").slice(0, 40),
  };
}

export function normalizeBookStyle(input: unknown): BookStyleState | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Partial<BookStyleState>;
  if (!value.mode || !MODES.includes(value.mode)) return null;
  if (value.mode === "off") return { mode: "off" };
  const rules = (Array.isArray(value.rules) ? value.rules : []).flatMap((rule) => {
    const normalized = normalizeRule(rule);
    return normalized ? [normalized] : [];
  });
  if (value.mode === "template") {
    if (typeof value.templateId !== "string" || !value.templateId) return null;
    return {
      mode: "template",
      templateId: value.templateId.slice(0, 160),
      ...(typeof value.templateVersion === "number" ? { templateVersion: value.templateVersion } : {}),
      ...(typeof value.templateName === "string" ? { templateName: value.templateName.slice(0, 200) } : {}),
      rules,
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt.slice(0, 60) } : {}),
    };
  }
  return { mode: "custom", rules, ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt.slice(0, 60) } : {}) };
}

// The book's working copy of a template's rules, frozen at the applied version.
export function applyTemplate(profile: StyleProfile, now = new Date().toISOString()): BookStyleState {
  return {
    mode: "template",
    templateId: profile.id,
    templateVersion: profile.version,
    templateName: profileDisplayName(profile),
    rules: profile.rules.filter((rule) => rule.text.trim()).map((rule) => ({ ...rule, evidenceIds: [...rule.evidenceIds] })),
    updatedAt: now,
  };
}

export function customStyle(rules: StyleRule[], now = new Date().toISOString()): BookStyleState {
  return { mode: "custom", rules: rules.filter((rule) => rule.text.trim()), updatedAt: now };
}

export const STYLE_OFF: BookStyleState = { mode: "off" };

// One-time, deterministic migration of pre-bookStyle workspaces. Runs on every
// load but only derives when bookStyle is absent, so it is idempotent:
// - activeStyleProfileId pointing at a stored profile -> template mode with a
//   snapshot of that profile's rules (its samples keep working);
// - otherwise non-empty assets.style -> custom mode with the author's text as a
//   hand-written rule (nothing is deleted);
// - otherwise off.
export function migrateBookStyle(input: { bookStyle?: unknown; activeStyleProfileId?: unknown; styleProfiles?: unknown; assets?: Record<string, string> | unknown }): BookStyleState {
  const existing = normalizeBookStyle(input.bookStyle);
  if (existing) return existing;
  const profiles = (input.styleProfiles && typeof input.styleProfiles === "object" && !Array.isArray(input.styleProfiles) ? input.styleProfiles : {}) as Record<string, StyleProfile>;
  const activeId = typeof input.activeStyleProfileId === "string" ? input.activeStyleProfileId : "";
  const active = profiles[activeId];
  if (active) return applyTemplate(active);
  const styleText = (input.assets && typeof input.assets === "object" && typeof (input.assets as Record<string, string>).style === "string" ? (input.assets as Record<string, string>).style : "")?.trim();
  if (styleText) {
    return customStyle([{ id: "rule-book-legacy", text: styleText.slice(0, 400), layer: "semantic", origin: "author_written", evidenceIds: [] }]);
  }
  return { mode: "off" };
}

export type EffectiveStyle = {
  mode: BookStyleMode;
  // What the UI shows as "现在按什么风格写".
  label: string;
  version?: number;
  rules: StyleRule[];
  // Ready-to-inject prompt block, or "" when the mode contributes nothing.
  text: string;
  notes: string[];
  // Template the sample channel may draw from, when one is in force.
  sampleTemplateId?: string;
};

const TEMPLATE_MISSING_NOTE = "原模板已被删除或不存在：本书继续使用应用时的规则快照，不受影响。";

// The single resolver. Template updates and deletions never change what this
// returns: the book writes with its own pinned copy until the author acts.
export function resolveEffectiveStyle(bookStyle: unknown, templates: Record<string, StyleProfile> = {}, authorSupplement = ""): EffectiveStyle {
  const state = normalizeBookStyle(bookStyle) ?? { mode: "off" as const };
  const supplement = authorSupplement.trim();
  if (state.mode === "off") {
    return { mode: "off", label: "文风指导已关闭", rules: [], text: "", notes: [] };
  }
  if (state.mode === "custom") {
    const rules = state.rules ?? [];
    const notes: string[] = [];
    if (supplement) notes.push("作者手写补充（assets.style）与本书规则同时生效，手写补充优先。");
    return {
      mode: "custom",
      label: supplement ? "本书自定义文风（含手写补充）" : "本书自定义文风",
      rules,
      text: effectiveText("本书自定义文风", rules, supplement),
      notes,
    };
  }
  // Templates are matched by their own id, not the record key: older data may
  // key styleProfiles by targetId ("style") while profile.id differs.
  const template = Object.values(templates).find((entry) => entry.id === state.templateId) ?? null;
  const notes: string[] = [];
  const label = template
    ? `${profileDisplayName(template)} · 第 ${state.templateVersion ?? template.version} 版（应用时快照）`
    : state.templateName || "本书文风模板";
  const version = state.templateVersion;
  if (template) {
    if (template.version !== state.templateVersion) notes.push(`模板已更新到第 ${template.version} 版，本书仍使用应用时的第 ${state.templateVersion ?? "?"} 版；需要更新请在下方确认。`);
  } else {
    notes.push(TEMPLATE_MISSING_NOTE);
  }
  if (supplement) notes.push("作者手写补充（assets.style）优先于模板规则。");
  const rules = state.rules ?? [];
  return {
    mode: "template",
    label,
    version,
    rules,
    text: effectiveText(label, rules, supplement),
    notes,
    sampleTemplateId: state.templateId,
  };
}

// One labelled block. Same-dimension conflicts are resolved by order of writing,
// not by stacking every historical wording: the caller passes the working copy,
// which is already the reconciled set.
function effectiveText(label: string, rules: StyleRule[], supplement: string): string {
  if (!rules.length && !supplement) return "";
  const lines = [`【本书生效文风 · ${label} · 只约束表达方式】`];
  if (supplement) lines.push("【作者手写补充（最高优先，不得被下方规则推翻）】", supplement.slice(0, 8000));
  if (rules.length) lines.push("【规则】", ...rules.map((rule) => `- ${rule.text}`));
  lines.push("（本书的人物、设定、锁定内容与本次明确要求优先于以上文风规则；不得引入参考作品的人名、地名、设定、情节或成段语句。）");
  return lines.join("\n");
}

// Quick adjustments are real rule edits, not UI-only toggles. Each maps to an
// explicit rule so the author can see and undo exactly what changed.
export const QUICK_ADJUSTMENTS: Array<{ id: string; label: string; rule: string }> = [
  { id: "concise", label: "语言更简练", rule: "语言更简练：删去不承担信息或节奏功能的修饰词，一句话只保留一个重心。" },
  { id: "restrained", label: "情绪更含蓄", rule: "情绪更含蓄：不使用情绪标签词，情绪通过动作、停顿和注意力转移呈现。" },
  { id: "less-rhetoric", label: "减少修辞", rule: "减少修辞：每段至多一个比喻或意象性修饰，优先具体名词与动词。" },
  { id: "more-dialogue", label: "增加对白", rule: "增加对白：人物间的关键信息尽量通过对白给出，对白要口语化、有停顿与潜台词。" },
];

export function toggleQuickAdjustment(state: BookStyleState, id: string): BookStyleState {
  const adjustment = QUICK_ADJUSTMENTS.find((entry) => entry.id === id);
  if (!adjustment) return state;
  const current = state.rules ?? [];
  const without = current.filter((rule) => !rule.id.startsWith(`rule-quick-${adjustment.id}-`));
  const has = current.length !== without.length;
  if (has) return { ...state, rules: without, updatedAt: new Date().toISOString() };
  return { ...state, rules: [...without, { id: `rule-quick-${adjustment.id}-${Date.now()}`, text: adjustment.rule, layer: "chapter", origin: "author_written", evidenceIds: [] }], updatedAt: new Date().toISOString() };
}

export function hasQuickAdjustment(state: BookStyleState, id: string): boolean {
  return (state.rules ?? []).some((rule) => rule.id.startsWith(`rule-quick-${id}-`));
}
