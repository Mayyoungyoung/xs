// The "AI 借鉴助手" brain: pure functions only. No React, no storage, no network.
// One natural-language line goes in; an identification, a bounded set of search
// queries, a style plan and the exact rule text written into the book style come
// out. The UI, the API routes and the desktop bridge share these helpers so the
// panel preview and the request payload can never disagree.
//
// Honesty rules encoded here:
// - encyclopedia/metadata material can identify an object, never its prose;
// - the model's own knowledge is labelled as an unverified first draft;
// - an unknown object never gets invented biography, bibliography or plot;
// - no similarity or confidence percentages are ever produced.

import { z } from "zod";

// ---------------------------------------------------------------- vocabulary

export type ReferenceEntityKind = "author" | "work" | "character" | "genre" | "world" | "unknown";
export type ReferenceMedium = "original" | "adaptation" | "unknown";

export const ENTITY_KIND_LABELS: Record<ReferenceEntityKind, string> = {
  author: "作者", work: "作品", character: "人物", genre: "类型", world: "世界观", unknown: "待确认",
};
export const MEDIUM_LABELS: Record<ReferenceMedium, string> = { original: "原著", adaptation: "改编", unknown: "媒介待确认" };

// Craft dimensions a borrow request can target. Kept small on purpose: they map
// onto concrete writing rules instead of vague praise.
export type ReferenceDimension = "prose" | "imagery" | "emotion" | "dialogue" | "rhythm" | "narration" | "plot" | "character" | "world";
export const DIMENSION_LABELS: Record<ReferenceDimension, string> = {
  prose: "句式节奏", imagery: "修饰与意象密度", emotion: "情绪呈现", dialogue: "对话写法",
  rhythm: "叙事节奏", narration: "叙述距离与视角", plot: "剧情推进", character: "人物塑造", world: "世界观呈现",
};
// "文笔/语言" and "叙事节奏/剧情结构" are deliberately separate groups: borrowing
// a plot structure is not borrowing a prose style.
export const PROSE_DIMENSIONS: ReferenceDimension[] = ["prose", "imagery", "emotion", "dialogue", "narration"];
export const STRUCTURE_DIMENSIONS: ReferenceDimension[] = ["rhythm", "plot", "character", "world"];

const DIMENSION_WORDS: Array<[string, ReferenceDimension]> = [
  ["文笔", "prose"], ["笔法", "prose"], ["文字", "prose"], ["语言", "prose"], ["文风", "prose"], ["风格", "prose"],
  ["表达", "prose"], ["写法", "prose"], ["句式", "prose"], ["行文", "prose"],
  ["修饰", "imagery"], ["意象", "imagery"], ["辞藻", "imagery"], ["描写", "imagery"], ["画面感", "imagery"],
  ["抒情", "emotion"], ["情感", "emotion"], ["情绪", "emotion"], ["细腻", "emotion"],
  ["对话", "dialogue"], ["台词", "dialogue"],
  ["节奏", "rhythm"], ["推进", "rhythm"], ["快慢", "rhythm"], ["张弛", "rhythm"], ["钩子", "rhythm"],
  ["叙事", "narration"], ["叙述", "narration"], ["视角", "narration"], ["人称", "narration"], ["距离", "narration"],
  ["剧情", "plot"], ["情节", "plot"], ["结构", "plot"], ["大纲", "plot"], ["伏笔", "plot"], ["布局", "plot"],
  ["人物", "character"], ["角色", "character"], ["群像", "character"], ["弧光", "character"], ["塑造", "character"],
  ["世界观", "world"], ["设定", "world"],
];

const AUTHOR_MARKERS = ["作者", "作家", "诗人", "写手"];
const WORK_MARKERS = ["小说", "作品", "原著", "这本书", "该书", "书籍"];
const CHARACTER_MARKERS = ["人物", "角色", "主角", "配角"];
const GENRE_MARKERS = ["类型", "题材", "流派", "风格类型"];
const ORIGINAL_MARKERS = ["原著", "原小说", "原作", "小说原著"];
const ADAPTATION_MARKERS = ["改编", "剧版", "电视剧", "影视", "电影", "动画", "动漫", "漫画", "游戏", "有声"];
// Words that only describe the author's requirement, never part of the entity name.
const REQUEST_WORDS = ["先给我", "给我", "但要", "但是", "不过", "别", "不要", "不能", "不复制", "不照搬", "保持", "保留", "我要", "我的", "更", "少点", "多点", "一点", "一些", "如何", "怎么", "请"];
const TRIGGERS = ["参考", "借鉴", "模仿", "仿照", "参照", "学习", "类似", "像", "学"];
// Generic craft or filler words that are never an object name.
const NAME_STOPWORDS = new Set(["写作", "文笔", "笔法", "写法", "行文", "表达", "语言", "文风", "风格", "小说", "作品", "原著", "书籍", "这本书", "该书", "一下", "一点", "一些", "一种", "某种", "老师", "大师", "别人", "人家", "某某", "那个", "这个", "作者", "作家", "人物", "角色", "剧情", "情节", "节奏", "结构", "叙事", "叙述", "设定", "世界观", "东西", "感觉"]);

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ------------------------------------------------------------- normalization

// Full-width forms, stray spaces, book-title brackets and trailing punctuation
// are normalized once, so every later matcher sees the same shape.
export function normalizeReferenceText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u3000\u00a0\t\r\n]+/g, " ")
    .replace(/[「」『』“”„‟]/g, (char) => (["「", "『"].includes(char) ? "《" : "》"))
    .replace(/[〈＜]/g, "《").replace(/[〉＞]/g, "》")
    .replace(/[。！？!?；;]+/g, "，")
    .replace(/，{2,}/g, "，")
    .replace(/\s*([，、])\s*/g, "$1")
    .replace(/^[，、]+|[，、]+$/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/_{2,}/g, "")
    .trim()
    .slice(0, 600);
}

// Book-title brackets are the strongest signal that the object is a work.
export function stripTitleBrackets(value: string) { return value.replace(/^《+|》+$/g, "").trim(); }

// ------------------------------------------------------------- identification

export type ReferenceCandidate = { kind: ReferenceEntityKind; medium: ReferenceMedium; label: string };

export type ReferenceBrief = {
  input: string;
  normalized: string;
  entity: { name: string; kind: ReferenceEntityKind; medium: ReferenceMedium };
  identified: boolean;
  custom: boolean;
  ambiguous: boolean;
  ambiguityReasons: string[];
  candidates: ReferenceCandidate[];
  dimensions: ReferenceDimension[];
  proseFocus: ReferenceDimension[];
  structureFocus: ReferenceDimension[];
  borrowPurpose: string;
  keep: string[];
  avoid: string[];
  clauses: string[];
};

export type ParseOptions = {
  // The current module pre-selects the borrow purpose; the author can change it.
  scope?: string;
  // A hint from the UI selection; never required before the author types.
  kindHint?: ReferenceEntityKind;
};

const SCOPE_PURPOSE: Record<string, { purpose: string; dimensions: ReferenceDimension[] }> = {
  style: { purpose: "借鉴文笔表达", dimensions: ["prose", "imagery", "emotion", "narration"] },
  plot: { purpose: "借鉴叙事节奏与结构", dimensions: ["rhythm", "plot"] },
  outline: { purpose: "借鉴叙事节奏与结构", dimensions: ["rhythm", "plot"] },
  timeline: { purpose: "借鉴叙事节奏与结构", dimensions: ["rhythm", "plot"] },
  chapters: { purpose: "借鉴叙事节奏与结构", dimensions: ["rhythm", "plot"] },
  character: { purpose: "借鉴人物塑造", dimensions: ["character"] },
  characters: { purpose: "借鉴人物塑造", dimensions: ["character"] },
  world: { purpose: "借鉴世界观呈现", dimensions: ["world"] },
  overview: { purpose: "整体参考", dimensions: ["prose", "rhythm"] },
};

function purposeFor(scope: string | undefined) {
  return SCOPE_PURPOSE[scope ?? ""] ?? { purpose: "整体参考", dimensions: ["prose", "rhythm"] as ReferenceDimension[] };
}

function clausesOf(text: string): string[] {
  return text.split(/[，,]/).map((part) => part.trim()).filter(Boolean);
}

function detectDimensions(text: string): ReferenceDimension[] {
  const found: ReferenceDimension[] = [];
  for (const [word, dimension] of DIMENSION_WORDS) if (text.includes(word) && !found.includes(dimension)) found.push(dimension);
  return found;
}

function detectMedium(text: string): { medium: ReferenceMedium; both: boolean } {
  const original = ORIGINAL_MARKERS.some((word) => text.includes(word));
  const adaptation = ADAPTATION_MARKERS.some((word) => text.includes(word));
  if (original && adaptation) return { medium: "unknown", both: true };
  if (adaptation) return { medium: "adaptation", both: false };
  if (original) return { medium: "original", both: false };
  return { medium: "unknown", both: false };
}

function stripRequestWords(value: string): string {
  let name = value.trim();
  for (const word of REQUEST_WORDS) name = name.split(word)[0] ?? name;
  for (const [word] of DIMENSION_WORDS) name = name.replace(new RegExp(`${escapeRegExp(word)}$`), "");
  name = name.replace(/[的之]$/, "").replace(/^[的之]/, "");
  return stripTitleBrackets(name.trim());
}

function kindFromMarkers(text: string): ReferenceEntityKind | undefined {
  if (AUTHOR_MARKERS.some((word) => text.includes(word))) return "author";
  if (WORK_MARKERS.some((word) => text.includes(word))) return "work";
  if (CHARACTER_MARKERS.some((word) => text.includes(word))) return "character";
  if (GENRE_MARKERS.some((word) => text.includes(word))) return "genre";
  return undefined;
}

type EntitySource = "bracket" | "trigger" | "possessive" | "suffix" | "bare" | "none";
type ExtractedEntity = { name: string; source: EntitySource };

// The object name is taken after a borrow trigger, inside book-title brackets, in
// front of「的+表达特征」, or as a bare name. Nothing here is author-specific: the
// same generic rules handle 余华, 郭敬明, 斗破苍穹 or an unknown name.
function extractEntity(text: string): ExtractedEntity {
  const bracket = text.match(/《([^《》]{1,40})》/);
  if (bracket) {
    const name = stripTitleBrackets(bracket[1]);
    if (name && !NAME_STOPWORDS.has(name)) return { name, source: "bracket" };
  }
  for (const trigger of TRIGGERS) {
    const match = text.match(new RegExp(`${escapeRegExp(trigger)}\\s*([^，,。；、！!？?《》]{1,30})`));
    if (match) {
      const name = stripRequestWords(match[1]);
      if (name && !NAME_STOPWORDS.has(name)) return { name, source: "trigger" };
    }
  }
  const possessive = text.match(/([^，,。；、！!？?《》\s]{1,24})的(?:文笔|笔法|写法|行文|表达|语言|文风|风格|节奏|叙事|叙述|结构|剧情|情节|人物|对话|设定)/);
  if (possessive) {
    const name = stripRequestWords(possessive[1]);
    if (name && !NAME_STOPWORDS.has(name)) return { name, source: "possessive" };
  }
  // 「余华文风」: a dimension word glued straight onto the name.
  const suffix = text.match(/^([^，,。；、！!？?《》\s]{1,20}?)(?:文笔|笔法|写法|行文|表达|语言|文风|风格|节奏|叙事|叙述|结构|剧情|情节|对话|设定)$/);
  if (suffix) {
    const name = stripRequestWords(suffix[1]);
    if (name && !NAME_STOPWORDS.has(name)) return { name, source: "suffix" };
  }
  // A single short clause with no borrow wording anywhere else is the name itself
  // (e.g. the author just types「斗破苍穹」or「余华 作家」). Requirement clauses are
  // excluded so「情感细腻一些，但别堆砌修饰」stays a custom expression request.
  const clauses = clausesOf(text);
  const single = clauses.length === 1 ? text.replace(/^(请|帮我|我想|我要|想)\s*/, "").trim() : "";
  const tokens = single.split(/\s+/).filter(Boolean);
  const bare = tokens.length === 1 ? tokens[0] : tokens.length === 2 && isKindMarker(tokens[1]) ? tokens[0] : "";
  if (bare && bare.length <= 24 && !detectDimensions(bare).length && !REQUEST_WORDS.some((word) => bare.includes(word)) && !NAME_STOPWORDS.has(bare)) {
    return { name: bare, source: "bare" };
  }
  return { name: "", source: "none" };
}

function isKindMarker(word: string): boolean {
  return [...AUTHOR_MARKERS, ...WORK_MARKERS, ...CHARACTER_MARKERS, ...GENRE_MARKERS].includes(word);
}

// Weak, explainable inference only — used to pre-fill the editable result, never
// to assert a fact. The author can change kind or medium before continuing.
function inferKind(text: string, name: string, source: EntitySource, dimensions: ReferenceDimension[], hint?: ReferenceEntityKind): { kind: ReferenceEntityKind; ambiguous: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const marker = kindFromMarkers(text);
  if (hint && hint !== "unknown") return { kind: hint, ambiguous: false, reasons };
  if (marker) return { kind: marker, ambiguous: false, reasons };
  if (source === "bracket") return { kind: "work", ambiguous: false, reasons };
  if (source === "bare") {
    reasons.push(`只给出了名称「${name}」，无法判断是作者还是作品；请确认类别后再联网核对。`);
    return { kind: "unknown", ambiguous: true, reasons };
  }
  if (dimensions.some((dimension) => STRUCTURE_DIMENSIONS.includes(dimension))) {
    reasons.push(`「${name}」没有书名号或作者标记，按“节奏 / 结构”类要求更可能是作品，也可能是作者整体。`);
    return { kind: "unknown", ambiguous: true, reasons };
  }
  if (name.length <= 1) reasons.push("名称过短，可能是简称或同名对象。");
  if (/^(他|她|它|这|那|我们|你们)$/.test(name)) reasons.push("名称是代词，无法确定指向。");
  if (name.length > 1 && /[的了是在有和与及]/.test(name)) reasons.push("名称里混有虚词，可能是识别错误。");
  return { kind: dimensions.some((dimension) => PROSE_DIMENSIONS.includes(dimension)) ? "author" : "unknown", ambiguous: reasons.length > 0, reasons };
}

function collectConstraints(clauses: string[]): { keep: string[]; avoid: string[] } {
  const keep: string[] = [];
  const avoid: string[] = [];
  for (const clause of clauses) {
    if (/(保留|保持|维持|沿用)/.test(clause)) keep.push(clause.replace(/^(但|不过|只是|而)/, "").trim());
    if (/(不|别|不要|不能|不想|避免|拒绝)/.test(clause)) avoid.push(clause.replace(/^(但|不过|只是|而)/, "").trim());
  }
  return { keep: dedupe(keep).slice(0, 6), avoid: dedupe(avoid).slice(0, 6) };
}

export function dedupe(values: string[]): string[] { return [...new Set(values.filter((value) => value.trim()))]; }

// Parse one author line into an editable identification plus separated
// requirements. Never asks the author to pick author/work/novel first, and never
// treats a requirement clause as part of the object name.
export function parseReferenceBrief(input: string, options: ParseOptions = {}): ReferenceBrief {
  const normalized = normalizeReferenceText(input);
  const extracted = extractEntity(normalized);
  const { name } = extracted;
  const clauses = clausesOf(normalized);
  const constraints = collectConstraints(clauses);
  // Category, medium and craft dimensions are read from the clause that names the
  // object plus the author's positive requests. A keep/avoid clause such as
  //「人物和故事保持我的」must not turn 余华 into a character reference or add a
  // 人物 dimension.
  const reserved = (clause: string) => /(保留|保持|维持|沿用)/.test(clause) || /(不|别|不要|不能|不想|避免|拒绝)/.test(clause);
  const requestClauses = clauses.filter((clause) => !reserved(clause));
  const entityClause = name ? clauses.find((clause) => clause.includes(name)) ?? normalized : normalized;
  const dimensionSource = name ? [...new Set([entityClause, ...requestClauses])].join("，") : normalized;
  const detected = detectDimensions(dimensionSource);
  const scopeDefault = purposeFor(options.scope);
  const dimensions = detected.length ? detected : scopeDefault.dimensions;
  const medium = detectMedium(entityClause);
  const inferred = inferKind(entityClause, name, extracted.source, dimensions, options.kindHint);
  const custom = !name;
  const reasons = [...inferred.reasons];
  if (medium.both) reasons.push("同时提到原著与改编版本，需要确认参考的是哪一种。");
  const candidates: ReferenceCandidate[] = [];
  if (name) {
    const kinds: ReferenceEntityKind[] = inferred.kind === "unknown" ? ["author", "work"] : [inferred.kind];
    for (const kind of kinds) candidates.push({ kind, medium: medium.medium === "unknown" ? (kind === "work" ? "original" : "unknown") : medium.medium, label: `${name}（${ENTITY_KIND_LABELS[kind]}）` });
    if (medium.medium === "adaptation" || medium.both) candidates.push({ kind: inferred.kind === "author" ? "work" : inferred.kind, medium: "adaptation", label: `${name}（改编版本）` });
  }
  return {
    input: input.trim().slice(0, 600),
    normalized,
    entity: { name, kind: inferred.kind, medium: medium.medium },
    identified: Boolean(name) && !inferred.ambiguous && !medium.both,
    custom,
    ambiguous: !name ? false : inferred.ambiguous || medium.both || inferred.kind === "unknown",
    ambiguityReasons: dedupe(reasons),
    candidates,
    dimensions: dedupe(dimensions) as ReferenceDimension[],
    proseFocus: dimensions.filter((dimension) => PROSE_DIMENSIONS.includes(dimension)),
    structureFocus: dimensions.filter((dimension) => STRUCTURE_DIMENSIONS.includes(dimension)),
    borrowPurpose: custom ? scopeDefault.purpose : `${scopeDefault.purpose} · ${name}`,
    keep: constraints.keep,
    avoid: constraints.avoid,
    clauses,
  };
}

// ------------------------------------------------------------ search queries

export type SearchQuery = { id: string; query: string; purpose: "entity" | "attribute" | "analysis"; role: "primary" | "secondary" };

const KIND_ATTRIBUTES: Record<ReferenceEntityKind, string[]> = {
  author: ["作家", "小说 语言 叙事", "访谈 创作谈"],
  work: ["小说 结构 节奏", "书评 分析"],
  character: ["人物形象 分析", "人物 解读"],
  genre: ["小说 写作 特点", "类型 代表作"],
  world: ["世界观 设定 分析", "设定 解析"],
  unknown: ["作品 简介", "写作 特点"],
};

// Bounded, de-duplicated queries with entity and requirement kept apart. The
// author's whole sentence never becomes an exact phrase search.
export function buildSearchQueries(brief: ReferenceBrief, limit = 4): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const push = (query: string, purpose: SearchQuery["purpose"]) => {
    const cleaned = query.replace(/\s+/g, " ").trim().slice(0, 60);
    if (cleaned && !queries.some((item) => item.query === cleaned)) {
      queries.push({ id: `q${queries.length}`, query: cleaned, purpose, role: queries.length ? "secondary" : "primary" });
    }
  };
  if (brief.entity.name) {
    push(brief.entity.name, "entity");
    for (const attribute of KIND_ATTRIBUTES[brief.entity.kind]) push(`${brief.entity.name} ${attribute}`, "attribute");
    if (brief.proseFocus.length) push(`${brief.entity.name} 语言 风格 分析`, "analysis");
    if (brief.structureFocus.length) push(`${brief.entity.name} 结构 节奏 分析`, "analysis");
  } else {
    const keywords = brief.dimensions.map((dimension) => DIMENSION_LABELS[dimension]).slice(0, 2);
    for (const keyword of keywords) push(`${keyword} 写作 技巧`, "attribute");
  }
  return queries.slice(0, limit);
}

// ---------------------------------------------------------------- evidence

export type EvidenceKind = "encyclopedia" | "metadata" | "analysis" | "prose" | "model";

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  encyclopedia: "百科摘要", metadata: "图书元数据", analysis: "评论/访谈", prose: "文本样段", model: "模型已有知识",
};

// What the evidence can and cannot support. Encyclopedia and metadata identify an
// object and its background; they carry no original prose, so they never become
// "extracted style fingerprints".
export type ReferenceEvidence = {
  evidenceId: string;
  kind: EvidenceKind;
  source: string;
  url?: string;
  retrievedAt: string;
  retrieved: boolean;
  chars?: number;
  note?: string;
};

export function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}

export function evidenceIdFor(input: { url?: string; source: string; title: string }): string {
  return `ev-${stableHash(`${input.url ?? ""}|${input.source}|${input.title}`)}`;
}

export function evidenceSupportsProse(kind: EvidenceKind): boolean { return kind === "prose"; }

// A source citation may only point at an evidenceId we actually obtained. The
// model cannot turn an invented URL into a verified source.
export function citationsFor(evidence: ReferenceEvidence[]): ReferenceEvidence[] {
  return evidence.filter((item) => item.retrieved && Boolean(item.evidenceId));
}

export type IdentificationStatus = {
  identityMatched: boolean;
  hasAnalysis: boolean;
  hasProseSample: boolean;
  aiDraft: boolean;
  needsConfirmation: boolean;
};

export function identificationStatus(brief: ReferenceBrief, evidence: ReferenceEvidence[]): IdentificationStatus {
  const retrieved = evidence.filter((item) => item.retrieved);
  return {
    identityMatched: retrieved.some((item) => item.kind === "encyclopedia" || item.kind === "metadata") || (brief.identified && evidence.length > 0),
    hasAnalysis: retrieved.some((item) => item.kind === "analysis"),
    hasProseSample: retrieved.some((item) => evidenceSupportsProse(item.kind)),
    aiDraft: true,
    needsConfirmation: brief.ambiguous || evidence.length === 0,
  };
}

export function statusBadges(brief: ReferenceBrief, evidence: ReferenceEvidence[]): string[] {
  const status = identificationStatus(brief, evidence);
  const badges: string[] = [];
  if (status.identityMatched) badges.push("身份已匹配");
  if (status.hasAnalysis) badges.push("有分析资料");
  if (status.hasProseSample) badges.push("有文本样段");
  badges.push("AI 初步归纳");
  if (status.needsConfirmation) badges.push("仍需确认");
  return badges;
}

// -------------------------------------------------------------- style plan

export type StyleDirection = { id: string; dimension: ReferenceDimension; label: string; guidance: string };
export type StylePlanBasis = { kind: EvidenceKind; label: string; evidenceId?: string; source?: string };
export type StylePlan = {
  id: string;
  version: number;
  requestId?: string;
  scope: string;
  createdAt: string;
  entity: ReferenceBrief["entity"];
  identified: boolean;
  ambiguous: boolean;
  candidates: ReferenceCandidate[];
  basisKind: "verified" | "metadata-only" | "model-only" | "mixed";
  basis: StylePlanBasis[];
  gaps: string[];
  directions: StyleDirection[];
  keep: string[];
  avoid: string[];
  rules: string[];
  notes: string[];
  sample?: string;
};

// Concrete, general craft directives per dimension. These are writing craft, not
// claims about any specific author, so they stay truthful when nothing was
// verified — the plan's gaps section states that explicitly.
const CRAFT_RULES: Record<ReferenceDimension, string[]> = {
  prose: ["句子以短句为主，长句只在需要铺陈时使用；避免连续三句以上同构句式。", "叙述句和描写句交替，段内至少出现一次节奏变化。"],
  imagery: ["每段最多保留一个比喻或意象，删掉叠词、四字堆叠和空泛形容词。", "用具体名词和动作代替抽象概括，写“风把纸吹到墙角”而不是“气氛很萧瑟”。"],
  emotion: ["情绪落在动作、身体反应和具体细节上，不用“他很难过”这类判断句直接宣告。", "同一场景里情绪要有变化，不从头到尾维持一种强度。"],
  dialogue: ["对话承担冲突与信息差，删掉只为解释设定的对白。", "给主要人物不同的说话习惯：句子长度、口头禅、回避方式。"],
  rhythm: ["紧张段落用短句和动作推进，舒缓段落放长句；段落长度随节奏变化。", "每个场景结束在一个未解决的问题上，章节末留一个具体的钩子。"],
  narration: ["保持贴身第三人称，只写视角人物能感知到的信息，不插入作者议论。", "视角人物不在场时用侧面信息交代，不切换到全知解说。"],
  plot: ["每个场景有目标、阻碍和结果，场景之间靠因果链连接，不靠巧合推进。", "冲突升级要有代价，主角每次获胜都失去或欠下什么。"],
  character: ["主要人物各有一个欲望、一个恐惧和一次无法回避的抉择。", "人物靠选择与代价显形，不用旁白介绍性格。"],
  world: ["世界规则通过使用和代价呈现，不集中写说明文段落。", "每条规则都要有限制和反噬，避免无敌设定。"],
};

// Turns the author's own wording into concrete tuning. This is the only place a
// follow-up like「太华丽」「节奏更快」changes the plan.
export function tuningFromInstruction(instruction: string): { add: string[]; removeDimensions: ReferenceDimension[] } {
  const text = normalizeReferenceText(instruction);
  const add: string[] = [];
  const removeDimensions: ReferenceDimension[] = [];
  if (/(太华丽|太繁复|堆砌|辞藻|修饰太多|形容词太多)/.test(text)) {
    add.push("进一步压低修饰密度：删掉一半比喻和所有叠词，只用最能承载情绪的细节。");
    removeDimensions.push("imagery");
  }
  if (/(少点抒情|别抒情|不要抒情|减少抒情|克制)/.test(text)) {
    add.push("减少直接抒情句，把抒情改写成动作、对白或留白。");
    removeDimensions.push("emotion");
  }
  if (/(节奏更快|加快|快一点|拖沓|慢)/.test(text)) {
    add.push("压缩过场和重复信息，把下一个冲突提前到场景前三分之一处发生。");
  }
  if (/(节奏更慢|放慢|细致一点|铺陈)/.test(text)) {
    add.push("在转折处放慢，加入感官细节和人物内心权衡，再推进下一个事件。");
  }
  if (/(对话更少|少点对白)/.test(text)) add.push("把解释性对白改成动作和叙述，只保留推动冲突的对话。");
  if (/(第一人称|第三人称|换个视角|视角)/.test(text)) add.push("视角按作者本次要求调整，并保持全书一致，不在同一场景内跳视角。");
  if (/(更短|短句|干脆|利落)/.test(text)) add.push("句子平均长度再降一档，连续动作不合并成复句。");
  if (/(更长|长句|绵长|舒缓)/.test(text)) add.push("适当使用复句和从句串联动作与感受，但每段保留至少一个短句收束。");
  if (!add.length) add.push(`按作者本次要求调整：${text.slice(0, 120)}。只改表达方式，不改动人物、设定和已发生情节。`);
  return { add, removeDimensions };
}

function directionsFromDimensions(dimensions: ReferenceDimension[], scope: string): StyleDirection[] {
  const ordered = dedupe([...dimensions, ...purposeFor(scope).dimensions]) as ReferenceDimension[];
  const picked = ordered.slice(0, 6);
  while (picked.length < 4) {
    const filler = (["prose", "rhythm", "emotion", "dialogue", "narration"] as ReferenceDimension[]).find((dimension) => !picked.includes(dimension));
    if (!filler) break;
    picked.push(filler);
  }
  return picked.map((dimension, index) => ({
    id: `direction-${index + 1}`, dimension, label: DIMENSION_LABELS[dimension],
    guidance: CRAFT_RULES[dimension][0],
  }));
}

function basisFromEvidence(evidence: ReferenceEvidence[]): { basis: StylePlanBasis[]; basisKind: StylePlan["basisKind"] } {
  const retrieved = citationsFor(evidence);
  const basis: StylePlanBasis[] = retrieved.map((item) => ({
    kind: item.kind, label: `${EVIDENCE_LABELS[item.kind]} · ${item.source}`,
    evidenceId: item.evidenceId, source: item.source,
  }));
  if (!retrieved.length) return { basis: [{ kind: "model", label: EVIDENCE_LABELS.model }], basisKind: "model-only" };
  const hasProse = retrieved.some((item) => evidenceSupportsProse(item.kind));
  return { basis, basisKind: hasProse ? "verified" : "metadata-only" };
}

function gapsFor(brief: ReferenceBrief, evidence: ReferenceEvidence[], basisKind: StylePlan["basisKind"]): string[] {
  const gaps: string[] = [];
  if (brief.custom) {
    gaps.push("这是自定义表达要求，没有指定借鉴对象；方案只依据你提出的方向与限制，不涉及任何作者或作品。");
  } else if (!brief.identified) {
    gaps.push(`尚未确认「${brief.entity.name}」的身份（类别或媒介有歧义），未生成任何作者生平、书目或剧情内容。`);
  }
  if (basisKind === "model-only") gaps.push("本次未联网核验：以上为 AI 依据你的要求与通用写作经验给出的初步方案，未声称已读过原作。");
  else if (basisKind === "metadata-only") gaps.push("当前资料是百科摘要或图书元数据，只能确认对象与背景，无法据此提取句式与节奏；文笔参数仍是待确认方向。");
  if (!evidence.some((item) => evidenceSupportsProse(item.kind))) gaps.push("尚未取得原文样段；如要核对具体句式与用词，请粘贴一段原文或导入文本样段。");
  return gaps;
}

export type BuildStylePlanInput = {
  brief: ReferenceBrief;
  evidence?: ReferenceEvidence[];
  scope?: string;
  requestId?: string;
  now?: string;
  id?: string;
};

// The deterministic skeleton. It is always available — no search key, no network
// and no model are required to produce an honest, editable plan.
export function buildStylePlan(input: BuildStylePlanInput): StylePlan {
  const { brief } = input;
  const evidence = input.evidence ?? [];
  const scope = input.scope ?? "style";
  const { basis, basisKind } = basisFromEvidence(evidence);
  return {
    id: input.id ?? `plan-${stableHash(`${brief.normalized}|${scope}|${input.requestId ?? ""}`)}`,
    version: 1,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    scope,
    createdAt: input.now ?? new Date().toISOString(),
    entity: brief.entity,
    identified: brief.identified,
    ambiguous: brief.ambiguous,
    candidates: brief.candidates,
    basisKind,
    basis,
    gaps: gapsFor(brief, evidence, basisKind),
    directions: directionsFromDimensions(brief.dimensions, scope),
    keep: brief.keep.length ? brief.keep : ["人物、设定和已发生情节保持你自己的版本"],
    avoid: brief.avoid.length ? brief.avoid : (brief.structureFocus.length ? ["不复制原作的人物、设定与情节"] : []),
    rules: rulesFromBrief(brief),
    notes: [],
  };
}

// Concrete craft rules that are true regardless of the borrow target. They only
// top up a plan to the promised 5-rule floor; they never assert anything about a
// specific author or work.
const GENERAL_RULES = [
  "每个场景至少有一个明确目的；删掉只交代信息、不产生变化的段落。",
  "同一段不要重复已经出现过的信息，包括换一种说法的重复。",
  "删掉“非常、十分、极其”这类程度副词，改用具体细节或动作表达强度。",
  "容易被跳过的说明性段落，改成人物对白、动作或场景细节来呈现。",
  "术语、称呼和人物状态保持前后一致；视角人物不知道的信息不写进他的判断。",
];

export function rulesFromBrief(brief: ReferenceBrief): string[] {
  const rules: string[] = [];
  for (const dimension of brief.dimensions) for (const rule of CRAFT_RULES[dimension]) rules.push(rule);
  if (brief.avoid.some((clause) => /(不复制|不照搬|别抄|不要抄)/.test(clause))) rules.push("只迁移可描述的表达特征，不复刻原文句子、专有名词和情节桥段。");
  if (brief.entity.kind === "author" && brief.proseFocus.length) rules.push("作者不同作品的风格并不统一：本方案面向作者整体倾向，套用到具体作品前请再确认。");
  if (brief.entity.kind === "work" && brief.structureFocus.length) rules.push("参考作品的结构不等于照搬其人物与情节；迁移的是节奏与场景组织方式。");
  for (const rule of GENERAL_RULES) {
    if (rules.length >= 5) break;
    rules.push(rule);
  }
  return dedupe(rules).slice(0, 10);
}

// --------------------------------------------------------- model refinement

const stylePlanModelSchema = z.object({
  directions: z.array(z.object({ label: z.string().min(1).max(40), guidance: z.string().min(4).max(400), dimension: z.string().max(30).optional() })).optional(),
  keep: z.array(z.string().max(200)).max(8).optional(),
  avoid: z.array(z.string().max(200)).max(8).optional(),
  rules: z.array(z.string().min(4).max(400)).max(14).optional(),
  gaps: z.array(z.string().max(300)).max(6).optional(),
});

// The model only ever refines direction wording and rules; it cannot add sources,
// change the identification or remove the honesty gaps. Unparseable output leaves
// the deterministic plan untouched instead of failing the flow.
export function mergeModelPlan(plan: StylePlan, content: string): { plan: StylePlan; applied: boolean; note?: string } {
  let data: unknown;
  try { data = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { return { plan, applied: false, note: "模型返回的内容不是可解析的方案，已保留初步方案，你可以继续讨论或试写。" }; }
  const parsed = stylePlanModelSchema.safeParse(data);
  if (!parsed.success) return { plan, applied: false, note: "模型方案结构不完整，已保留初步方案。" };
  const value = parsed.data;
  const directions: StyleDirection[] = (value.directions ?? []).slice(0, 6).map((direction, index) => {
    const known = (Object.keys(DIMENSION_LABELS) as ReferenceDimension[]).find((dimension) => DIMENSION_LABELS[dimension] === direction.label);
    return {
      id: `direction-${index + 1}`, dimension: known ?? plan.directions[index]?.dimension ?? "prose",
      label: direction.label, guidance: direction.guidance,
    };
  });
  const merged: StylePlan = {
    ...plan,
    directions: directions.length >= 4 ? directions : plan.directions,
    keep: value.keep?.length ? dedupe(value.keep) : plan.keep,
    avoid: value.avoid?.length ? dedupe(value.avoid) : plan.avoid,
    rules: value.rules?.length ? dedupe([...value.rules, ...plan.rules]).slice(0, 10) : plan.rules,
    gaps: dedupe([...(value.gaps ?? []), ...plan.gaps]).slice(0, 6),
  };
  return { plan: merged, applied: true };
}

// ------------------------------------------------------------- refinement

// A follow-up like「太华丽」「节奏更快」edits the current candidate in place and keeps
// its identity, source basis and version instead of restarting the flow.
export function reviseStylePlan(plan: StylePlan, instruction: string, now?: string): StylePlan {
  const { add, removeDimensions } = tuningFromInstruction(instruction);
  const directions = plan.directions
    .filter((direction) => !removeDimensions.includes(direction.dimension))
    .map((direction) => direction);
  return {
    ...plan,
    version: plan.version + 1,
    createdAt: now ?? new Date().toISOString(),
    directions: directions.length >= 4 ? directions : plan.directions,
    rules: dedupe([...add, ...plan.rules]).slice(0, 10),
    avoid: dedupe([...plan.avoid, ...(removeDimensions.length ? [instruction.trim()] : [])]).slice(0, 8),
    notes: dedupe([...plan.notes, `按作者要求调整（第 ${plan.version + 1} 版）：${instruction.trim().slice(0, 120)}`]),
  };
}

export type MixedPlanInput = { plans: Array<{ plan: StylePlan; dimensions: ReferenceDimension[] }>; scope?: string; now?: string };

// Mixed references are chosen per dimension. Conflicting guidance is surfaced as
// two alternatives with an explanation — never blended into a fake precision
// percentage.
export function mergeStylePlans(input: MixedPlanInput): StylePlan {
  if (!input.plans.length) throw new Error("没有可合并的方案。");
  const first = input.plans[0];
  const directions: StyleDirection[] = [];
  const conflicts: string[] = [];
  for (const entry of input.plans) {
    for (const direction of entry.plan.directions) {
      if (!entry.dimensions.includes(direction.dimension)) continue;
      const existing = directions.find((item) => item.dimension === direction.dimension);
      if (!existing) directions.push(direction);
      else if (existing.guidance !== direction.guidance) conflicts.push(`${DIMENSION_LABELS[direction.dimension]}：「${existing.label}」与「${direction.label}」给出的方向不同，请择一或分别试写后再决定。`);
    }
  }
  const evidence = input.plans.flatMap((entry) => entry.plan.basis);
  return {
    ...first.plan,
    version: Math.max(...input.plans.map((entry) => entry.plan.version)),
    createdAt: input.now ?? new Date().toISOString(),
    scope: input.scope ?? first.plan.scope,
    directions: directions.length >= 4 ? directions.slice(0, 6) : first.plan.directions,
    basis: dedupe(evidence.map((item) => item.label)).map((label) => ({ kind: "model" as const, label })),
    basisKind: input.plans.every((entry) => entry.plan.basisKind === "model-only") ? "model-only" : "mixed",
    keep: dedupe(input.plans.flatMap((entry) => entry.plan.keep)).slice(0, 8),
    avoid: dedupe(input.plans.flatMap((entry) => entry.plan.avoid)).slice(0, 8),
    rules: dedupe(input.plans.flatMap((entry) => entry.plan.rules)).slice(0, 10),
    notes: dedupe([...input.plans.flatMap((entry) => entry.plan.notes), ...conflicts, "混合参考按维度拆分：不同维度可能来自不同对象，冲突处保留两种方向而非百分比混合。"]),
  };
}

// ------------------------------------------------- rule text written to style

// This text is what an adopted candidate writes into assets.style, so every
// writing entry reads the same compact rules instead of raw reference material.
export function stylePlanToRuleText(plan: StylePlan): string {
  const target = plan.entity.name
    ? `${plan.entity.name}（${ENTITY_KIND_LABELS[plan.entity.kind]}·${MEDIUM_LABELS[plan.entity.medium]}）`
    : "自定义表达要求（未指定借鉴对象）";
  const basis = plan.basis.map((item) => (item.evidenceId ? `${item.label} [${item.evidenceId}]` : item.label)).join("；");
  const lines = [
    `【借鉴对象】${target}`,
    `【借鉴范围】${plan.entity.name && plan.entity.kind === "work" ? "具体作品的结构与表达" : "作者整体的表达倾向"}${plan.ambiguous ? "（识别结果仍需确认）" : ""}`,
    `【方案依据】${basis}`,
    `【依据等级】${plan.basisKind === "verified" ? "有文本样段支撑" : plan.basisKind === "metadata-only" ? "仅百科/元数据，未含原文" : plan.basisKind === "mixed" ? "多个对象，依据等级不一，按维度分开计算" : "仅模型已有知识，未联网核验"}`,
    "",
    "【表达方向】",
    ...plan.directions.map((direction) => `- ${direction.label}：${direction.guidance}`),
    "",
    "【保留】",
    ...(plan.keep.length ? plan.keep.map((item) => `- ${item}`) : ["- 人物、设定与已发生情节保持本书原样"]),
    "【不借鉴】",
    ...(plan.avoid.length ? plan.avoid.map((item) => `- ${item}`) : ["- 不复刻原作原文、专有名词与情节桥段"]),
    "",
    "【可执行规则】",
    ...plan.rules.map((rule, index) => `${index + 1}. ${rule}`),
  ];
  if (plan.gaps.length) lines.push("", "【仍需确认】", ...plan.gaps.map((item) => `- ${item}`));
  if (plan.sample) lines.push("", "【试写示范（AI 原创，不是原作片段）】", plan.sample);
  return lines.join("\n");
}

export const STYLE_RULE_PREFIX = "【借鉴对象】";

export function isStylePlanText(text: string): boolean { return text.trimStart().startsWith(STYLE_RULE_PREFIX); }

// ------------------------------------------------------- persisted work state

// One draft per module scope, saved with the book so switching modules, closing
// and reopening, cancelling or a late response never lose the author's input.
export type AssistMessage = { role: "ai" | "user"; text: string; at: string };
// A finished or interrupted fidelity run. It fixes the profile version and the
// excerpt manifest the candidate was made from, so a later configuration change
// cannot rewrite what the author reviewed.
export type AssistRun = {
  stage: "idle" | "generating" | "reviewing" | "revising" | "done" | "interrupted" | "failed";
  note: string;
  profileId: string;
  profileVersion: number;
  sampleManifest: Array<{ id: string; contentHash: string }>;
  revisions: number;
  requests: number;
  reviewed: boolean;
  at: string;
};
export type AssistDraft = {
  scope: string;
  requestId: string;
  input: string;
  plan: StylePlan | null;
  evidence: ReferenceEvidence[];
  sample: string;
  thread: AssistMessage[];
  applied: { at: string; version: number } | null;
  run: AssistRun | null;
  updatedAt: string;
};

const EVIDENCE_KINDS: EvidenceKind[] = ["encyclopedia", "metadata", "analysis", "prose", "model"];
const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS) as ReferenceDimension[];

function strings(input: unknown, limit: number, max = 400): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.slice(0, max)).slice(0, limit);
}

function normalizeEvidence(input: unknown): ReferenceEvidence[] {
  if (!Array.isArray(input)) return [];
  const result: ReferenceEvidence[] = [];
  for (const value of input) {
    const item = value as Partial<ReferenceEvidence> | undefined;
    // An unknown kind is dropped, never coerced: old encyclopedia entries must
    // not become "text samples" through a migration default.
    if (!item || typeof item.evidenceId !== "string" || !EVIDENCE_KINDS.includes(item.kind as EvidenceKind)) continue;
    result.push({
      evidenceId: item.evidenceId.slice(0, 160),
      kind: item.kind as EvidenceKind,
      source: typeof item.source === "string" ? item.source.slice(0, 160) : "",
      ...(typeof item.url === "string" && /^https?:\/\//i.test(item.url) ? { url: item.url.slice(0, 1200) } : {}),
      retrievedAt: typeof item.retrievedAt === "string" ? item.retrievedAt.slice(0, 60) : "",
      retrieved: item.retrieved === true,
      ...(typeof item.chars === "number" && Number.isFinite(item.chars) && item.chars >= 0 ? { chars: Math.min(item.chars, 20_000_000) } : {}),
      ...(typeof item.note === "string" && item.note ? { note: item.note.slice(0, 600) } : {}),
    });
  }
  return result.slice(0, 40);
}

export function normalizeStylePlan(input: unknown): StylePlan | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<StylePlan>;
  if (typeof value.id !== "string" || !Array.isArray(value.directions) || !Array.isArray(value.rules)) return null;
  const entity = (value.entity ?? {}) as Partial<StylePlan["entity"]>;
  const directions: StyleDirection[] = value.directions.flatMap((direction, index): StyleDirection[] => {
    const item = direction as Partial<StyleDirection> | undefined;
    if (!item || typeof item.label !== "string" || typeof item.guidance !== "string") return [];
    const dimension = DIMENSION_KEYS.includes(item.dimension as ReferenceDimension) ? item.dimension as ReferenceDimension : "prose";
    return [{ id: typeof item.id === "string" ? item.id.slice(0, 80) : `direction-${index + 1}`, dimension, label: item.label.slice(0, 60), guidance: item.guidance.slice(0, 600) }];
  }).slice(0, 6);
  const basis: StylePlanBasis[] = (Array.isArray(value.basis) ? value.basis : []).flatMap((entry): StylePlanBasis[] => {
    const item = entry as Partial<StylePlanBasis> | undefined;
    if (!item || !EVIDENCE_KINDS.includes(item.kind as EvidenceKind) || typeof item.label !== "string") return [];
    return [{ kind: item.kind as EvidenceKind, label: item.label.slice(0, 200), ...(typeof item.evidenceId === "string" ? { evidenceId: item.evidenceId.slice(0, 160) } : {}), ...(typeof item.source === "string" ? { source: item.source.slice(0, 160) } : {}) }];
  }).slice(0, 40);
  const basisKind: StylePlan["basisKind"] = value.basisKind === "verified" || value.basisKind === "metadata-only" || value.basisKind === "mixed" ? value.basisKind : "model-only";
  const candidates: ReferenceCandidate[] = (Array.isArray(value.candidates) ? value.candidates : []).flatMap((entry): ReferenceCandidate[] => {
    const item = entry as Partial<ReferenceCandidate> | undefined;
    if (!item || typeof item.label !== "string") return [];
    const kind: ReferenceEntityKind = (["author", "work", "character", "genre", "world", "unknown"] as ReferenceEntityKind[]).includes(item.kind as ReferenceEntityKind) ? item.kind as ReferenceEntityKind : "unknown";
    const medium: ReferenceMedium = (["original", "adaptation", "unknown"] as ReferenceMedium[]).includes(item.medium as ReferenceMedium) ? item.medium as ReferenceMedium : "unknown";
    return [{ kind, medium, label: item.label.slice(0, 120) }];
  }).slice(0, 8);
  return {
    id: value.id.slice(0, 160),
    version: typeof value.version === "number" && Number.isFinite(value.version) && value.version > 0 ? Math.min(Math.round(value.version), 9999) : 1,
    ...(typeof value.requestId === "string" ? { requestId: value.requestId.slice(0, 80) } : {}),
    scope: typeof value.scope === "string" ? value.scope.slice(0, 40) : "style",
    createdAt: typeof value.createdAt === "string" ? value.createdAt.slice(0, 60) : new Date().toISOString(),
    entity: {
      name: typeof entity.name === "string" ? entity.name.slice(0, 200) : "",
      kind: (["author", "work", "character", "genre", "world", "unknown"] as ReferenceEntityKind[]).includes(entity.kind as ReferenceEntityKind) ? entity.kind as ReferenceEntityKind : "unknown",
      medium: (["original", "adaptation", "unknown"] as ReferenceMedium[]).includes(entity.medium as ReferenceMedium) ? entity.medium as ReferenceMedium : "unknown",
    },
    identified: value.identified === true,
    ambiguous: value.ambiguous === true,
    candidates,
    basisKind,
    basis,
    gaps: strings(value.gaps, 8, 400),
    directions,
    keep: strings(value.keep, 8),
    avoid: strings(value.avoid, 8),
    rules: strings(value.rules, 10, 600),
    notes: strings(value.notes, 12, 400),
    ...(typeof value.sample === "string" && value.sample ? { sample: value.sample.slice(0, 8000) } : {}),
  };
}

export function normalizeAssistDrafts(input: unknown): Record<string, AssistDraft> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, AssistDraft> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const value = raw as Partial<AssistDraft> | undefined;
    if (!value || typeof value !== "object") continue;
    const scope = typeof value.scope === "string" && value.scope ? value.scope.slice(0, 40) : key.slice(0, 40);
    if (!scope) continue;
    const thread = (Array.isArray(value.thread) ? value.thread : []).flatMap((message): AssistMessage[] => {
      const item = message as Partial<AssistMessage> | undefined;
      if (!item || (item.role !== "user" && item.role !== "ai") || typeof item.text !== "string" || !item.text) return [];
      return [{ role: item.role, text: item.text.slice(0, 20000), at: typeof item.at === "string" ? item.at.slice(0, 60) : "" }];
    }).slice(-200);
    const input = typeof value.input === "string" ? value.input.slice(0, 600) : "";
    const plan = normalizeStylePlan(value.plan);
    const evidence = normalizeEvidence(value.evidence);
    if (!input && !plan && !thread.length && !evidence.length) continue;
    result[scope] = {
      scope,
      requestId: typeof value.requestId === "string" ? value.requestId.slice(0, 80) : "",
      input,
      plan,
      evidence,
      sample: typeof value.sample === "string" ? value.sample.slice(0, 8000) : "",
      thread,
      applied: value.applied && typeof value.applied === "object" && typeof (value.applied as { at?: unknown }).at === "string"
        ? { at: (value.applied as { at: string }).at.slice(0, 60), version: typeof (value.applied as { version?: unknown }).version === "number" ? Math.max(1, Math.round((value.applied as { version: number }).version)) : 1 }
        : null,
      run: normalizeAssistRun(value.run),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt.slice(0, 60) : "",
    };
  }
  return result;
}

const RUN_STAGES: AssistRun["stage"][] = ["idle", "generating", "reviewing", "revising", "done", "interrupted", "failed"];

export function normalizeAssistRun(input: unknown): AssistRun | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<AssistRun>;
  if (!RUN_STAGES.includes(value.stage as AssistRun["stage"])) return null;
  return {
    stage: value.stage as AssistRun["stage"],
    note: typeof value.note === "string" ? value.note.slice(0, 400) : "",
    profileId: typeof value.profileId === "string" ? value.profileId.slice(0, 160) : "",
    profileVersion: typeof value.profileVersion === "number" && value.profileVersion > 0 ? Math.round(value.profileVersion) : 0,
    sampleManifest: (Array.isArray(value.sampleManifest) ? value.sampleManifest : []).flatMap((entry) => {
      const item = entry as Partial<{ id: string; contentHash: string }> | undefined;
      return item && typeof item.id === "string" ? [{ id: item.id.slice(0, 160), contentHash: typeof item.contentHash === "string" ? item.contentHash.slice(0, 64) : "" }] : [];
    }).slice(0, 400),
    revisions: typeof value.revisions === "number" && value.revisions >= 0 ? Math.min(9, Math.round(value.revisions)) : 0,
    requests: typeof value.requests === "number" && value.requests >= 0 ? Math.min(99, Math.round(value.requests)) : 0,
    reviewed: value.reviewed === true,
    at: typeof value.at === "string" ? value.at.slice(0, 60) : "",
  };
}

export function emptyAssistDraft(scope: string, updatedAt = new Date().toISOString()): AssistDraft {
  return { scope, requestId: "", input: "", plan: null, evidence: [], sample: "", thread: [], applied: null, run: null, updatedAt };
}

// The packet sent to the writing model. It is compact on purpose: the object, the
// identification, the author's own requirements, the evidence actually obtained
// and the current skeleton — never the whole manuscript or a pile of summaries.
export function styleReferencePrompt(brief: ReferenceBrief, plan: StylePlan, evidence: ReferenceEvidence[]): { prompt: string; context: string } {
  const lines = citationsFor(evidence).map((item) => `- ${EVIDENCE_LABELS[item.kind]}｜${item.source}${item.url ? `｜${item.url}` : ""}｜${item.chars ?? 0} 字${item.note ? `｜${item.note}` : ""}`);
  const context = [
    `【借鉴对象】${brief.entity.name || "（未指定对象：这是自定义表达要求）"}`,
    `【识别结果】类别=${ENTITY_KIND_LABELS[brief.entity.kind]}；媒介=${MEDIUM_LABELS[brief.entity.medium]}；${brief.ambiguous ? "仍有歧义，需作者确认" : "已初步确认"}`,
    `【作者要求】目的=${brief.borrowPurpose}；要保留=${brief.keep.join("；") || "未特别说明"}；要避免=${brief.avoid.join("；") || "未特别说明"}`,
    `【已取得的资料证据】${lines.length ? `\n${lines.join("\n")}` : "无。本次未取得资料，也没有联网核验。"}`,
    `【初步方案（待你完善）】\n${stylePlanToRuleText(plan)}`,
  ].join("\n");
  const prompt = [
    "请完善以上这份文风借鉴方案，只输出 JSON 对象，不要输出任何解释：",
    '{"directions":[{"label":"表达方向名","guidance":"可执行的具体做法"}],"keep":["要保留什么"],"avoid":["明确不借鉴什么"],"rules":["可直接执行的第 1 条写作规则"],"gaps":["仍需作者确认的信息"]}',
    "directions 给 4–6 条，rules 给 5–10 条。每条规则必须具体到句式节奏、修饰密度、情绪呈现、对话写法、叙述距离或场景推进中的某一项，不要写“语言优美、情节紧凑”这类空话。",
    "你没有联网能力：不得声称已联网核验或读过原作；资料不含原文时不得编造具体句式与节奏，只能给出结构与题材层面的建议。",
    "不得编造作者生平、作品目录、剧情或角色；不得输出相似度、置信度或任何百分比；不得把你自创的例句标成原作引文。",
    "对象身份尚未确认时，只根据作者提出的方向与限制给方案，不要假称该对象具备某种特征。",
  ].join("\n");
  return { prompt, context };
}
