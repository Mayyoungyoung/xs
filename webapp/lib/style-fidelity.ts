// Sample-driven style fidelity: pure functions only (no React, no storage, no
// network). A real excerpt is its own object with provenance, scope, a content
// hash and a split — never an alias of a summary string. The writing request gets
// matched excerpts through one dedicated channel, and the checks are suggestions,
// not proof.
//
// Honesty rules encoded here:
// - a URL, an encyclopedia abstract and an obtained excerpt are three different
//   things and never stand in for each other;
// - a model is never asked to "recall" an author's text and have that called a sample;
// - a user-approved AI output is a preference anchor, not author evidence;
// - evaluation excerpts never reach rules, selection or prompts;
// - overlap numbers are review signals, never a legal or quality threshold, and no
//   uncalibrated similarity percentage is ever produced.

import { stableHash } from "./reference-assist";

export type StyleEvidenceKind = "primary_excerpt" | "critical_analysis" | "bibliographic_metadata" | "model_prior" | "user_approved_output";
export type SampleUsageBasis = "user_owned" | "licensed" | "public_domain" | "permitted_excerpt" | "unknown";
export type SampleRole = "narration" | "dialogue" | "mixed";
export type SampleSplit = "conditioning" | "calibration" | "evaluation";
export type StyleScene = "dialogue" | "daily" | "conflict" | "action" | "interior" | "environment" | "mixed";

export const EVIDENCE_KIND_LABELS: Record<StyleEvidenceKind, string> = {
  primary_excerpt: "原文样段", critical_analysis: "评论分析", bibliographic_metadata: "书目/百科元数据",
  model_prior: "模型已有知识", user_approved_output: "作者认可的 AI 输出",
};
export const USAGE_BASIS_LABELS: Record<SampleUsageBasis, string> = {
  user_owned: "作者自有", licensed: "已获授权", public_domain: "公有领域",
  permitted_excerpt: "允许引用的片段", unknown: "权限未知",
};
export const SPLIT_LABELS: Record<SampleSplit, string> = { conditioning: "条件样段", calibration: "校准样段", evaluation: "评测样段（不进入生成）" };
export const SCENE_LABELS: Record<StyleScene, string> = {
  dialogue: "对话", daily: "日常", conflict: "冲突", action: "动作", interior: "内心", environment: "环境", mixed: "综合",
};

// Only an obtained excerpt counts as author evidence. Everything else is either
// background or an explicitly labelled prior.
export function isAuthorEvidence(kind: StyleEvidenceKind): boolean { return kind === "primary_excerpt"; }
export function canInformProse(kind: StyleEvidenceKind): boolean { return kind === "primary_excerpt" || kind === "user_approved_output"; }

// ------------------------------------------------------------- sample object

export type StyleSampleSource = {
  kind: StyleEvidenceKind;
  title: string;
  locator?: string;
  url?: string;
  author?: string;
  work?: string;
  retrievedAt?: string;
  usageBasis: SampleUsageBasis;
};

export type StyleSample = {
  id: string;
  bookId: string;
  targetId: string;
  text: string;
  contentHash: string;
  source: StyleSampleSource;
  sceneTags: StyleScene[];
  pointOfView?: string;
  textRole: SampleRole;
  split: SampleSplit;
  charCount: number;
  createdAt: string;
  notes: string[];
};

const KINDS: StyleEvidenceKind[] = ["primary_excerpt", "critical_analysis", "bibliographic_metadata", "model_prior", "user_approved_output"];
const BASES: SampleUsageBasis[] = ["user_owned", "licensed", "public_domain", "permitted_excerpt", "unknown"];
const SPLITS: SampleSplit[] = ["conditioning", "calibration", "evaluation"];
const SCENES: StyleScene[] = ["dialogue", "daily", "conflict", "action", "interior", "environment", "mixed"];
const MAX_SAMPLE_CHARS = 20000;
export const MAX_SAMPLES = 400;

export function hanCount(text: string): number { return (text.match(/[\p{Script=Han}]/gu) ?? []).length; }
export function contentHashOf(text: string): string { return stableHash(normalizeForHash(text)); }
function normalizeForHash(text: string): string { return text.replace(/[\s\u3000]+/g, "").replace(/[，。！？；：、,.!?;:—…“”"'（）()《》〈〉【】\[\]]/g, ""); }

// ------------------------------------------------------------------ cleaning

// Whole lines that are navigation, ads or scrape templates are dropped. A line is
// only removed when it is short and matches a template, so narrative sentences
// that merely contain a word like 广告 are never touched.
const TEMPLATE_PATTERNS: RegExp[] = [
  /^第\s*[0-9一二三四五六七八九十百千]+\s*[章节回卷][^\n]{0,20}$/,
  /(上一章|下一章|返回目录|章节目录|加入书签|推荐票|月票|打赏|手机阅读|免费阅读|无弹窗|全文阅读|最新章节|请记住本站|笔趣阁|版权所有|免责声明)/,
  /^(广告|推广|赞助内容)/,
  /^https?:\/\/\S+$/i,
  /^[（(【\[]?(本章完|未完待续|求收藏|求订阅)[）)】\]]?$/,
];
export type CleanResult = { text: string; removedLines: number; removed: string[] };

export function cleanSampleText(raw: string): CleanResult {
  const removed: string[] = [];
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    const template = trimmed.length <= 40 && TEMPLATE_PATTERNS.some((pattern) => pattern.test(trimmed));
    if (template) { removed.push(trimmed.slice(0, 60)); return false; }
    return true;
  });
  const text = kept.join("\n")
    .replace(/[ \t\u3000]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, removedLines: removed.length, removed: removed.slice(0, 20) };
}

// --------------------------------------------------------------- splitting

export function splitParagraphs(text: string): string[] {
  return text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
}

// Chinese sentence splitting on explicit terminators only; a terminator inside a
// quotation still ends a sentence, which keeps the count reproducible.
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？!?…])/u).map((part) => part.trim()).filter((part) => hanCount(part) > 0);
}

export function dialogueParagraphRatio(text: string): number {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return 0;
  const spoken = paragraphs.filter((paragraph) => {
    const quoted = paragraph.match(/[“"「『][^”"」』]{1,400}[”"」』]/g) ?? [];
    const quotedHan = quoted.reduce((total, part) => total + hanCount(part), 0);
    return quotedHan > 0 && quotedHan >= hanCount(paragraph) * 0.4;
  }).length;
  return spoken / paragraphs.length;
}

export function textRoleFor(text: string): SampleRole {
  const ratio = dialogueParagraphRatio(text);
  if (ratio >= 0.5) return "dialogue";
  if (ratio <= 0.1) return "narration";
  return "mixed";
}

const SCENE_KEYWORDS: Record<Exclude<StyleScene, "mixed">, string[]> = {
  environment: ["天空", "阳光", "月光", "雨", "雪", "风", "空气", "气味", "味道", "街道", "房间", "窗户", "影子", "声音", "灯光", "山", "河"],
  action: ["跑", "冲", "抓", "推", "拉", "踢", "挥", "躲", "追", "跳", "转身", "撞", "摔倒", "拔", "扔"],
  conflict: ["争", "吵", "吼", "怒", "骂", "威胁", "质问", "命令", "拒绝", "冷笑", "咬牙", "反驳", "逼"],
  interior: ["想", "记得", "回忆", "明白", "意识", "心里", "害怕", "希望", "后悔", "犹豫", "决定", "以为", "忽然觉得"],
  daily: ["吃", "喝", "睡", "收拾", "上班", "散步", "走路", "聊天", "坐下", "递", "穿", "洗", "买菜", "做饭"],
  dialogue: [],
};

// Explainable tags from a small craft lexicon plus the dialogue ratio. The author
// can correct them; nothing here claims semantic understanding.
export function sceneTagsFor(text: string): StyleScene[] {
  const tags: StyleScene[] = [];
  for (const [scene, words] of Object.entries(SCENE_KEYWORDS) as Array<[Exclude<StyleScene, "mixed">, string[]]>) {
    if (!words.length) continue;
    const hits = words.reduce((total, word) => total + (text.split(word).length - 1), 0);
    if (hits >= 2) tags.push(scene);
  }
  if (dialogueParagraphRatio(text) >= 0.4) tags.push("dialogue");
  return tags.length ? tags.slice(0, 3) : ["mixed"];
}

export function pointOfViewHint(text: string): string | undefined {
  const first = (text.match(/我/g) ?? []).length;
  const third = (text.match(/[他她]/g) ?? []).length;
  if (first >= 3 && first >= third * 2) return "第一人称";
  if (third >= 3 && third >= first * 2) return "第三人称（贴身程度需人工确认）";
  return undefined;
}

// --------------------------------------------------------------- overlap

export function charNgrams(text: string, size = 8): Set<string> {
  const clean = text.replace(/[^\p{Script=Han}]/gu, "");
  const grams = new Set<string>();
  for (let index = 0; index + size <= clean.length; index += 1) grams.add(clean.slice(index, index + size));
  return grams;
}

// Containment of the shorter text in the longer one: robust for spotting mirror
// pages without being fooled by length differences.
export function ngramContainment(a: string, b: string, size = 8): number {
  const left = charNgrams(a, size);
  const right = charNgrams(b, size);
  if (!left.size || !right.size) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const gram of small) if (large.has(gram)) shared += 1;
  return shared / small.size;
}

export type OverlapDetail = { length: number; text: string };
export function longestCommonSubstring(a: string, b: string, cap = 1500): OverlapDetail {
  const left = a.replace(/[^\p{Script=Han}]/gu, "").slice(0, cap);
  const right = b.replace(/[^\p{Script=Han}]/gu, "").slice(0, cap);
  if (!left.length || !right.length) return { length: 0, text: "" };
  let best = 0;
  let end = 0;
  const previous = new Array<number>(right.length + 1).fill(0);
  const current = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : 0;
      if (current[j] > best) { best = current[j]; end = i; }
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }
  return { length: best, text: best ? left.slice(end - best, end) : "" };
}

// Common short sentences and proper nouns must not raise an alarm on their own, so
// a hit is only reported at a length that cannot come from a stock phrase.
const OVERLAP_LC_MIN = 20;
const OVERLAP_CONTAINMENT_MIN = 0.15;
export type OverlapReport = {
  level: "distinct" | "reminder" | "high";
  longest: number;
  longestText: string;
  containment: number;
  sampleId?: string;
  note: string;
};

// A reminder for the author, never a legal safe/unsafe verdict.
export function overlapReport(candidate: string, samples: Array<{ id: string; text: string }>): OverlapReport {
  let bestLongest = 0;
  let bestText = "";
  let bestContainment = 0;
  let bestSampleId: string | undefined;
  for (const sample of samples) {
    const common = longestCommonSubstring(candidate, sample.text);
    const containment = ngramContainment(candidate, sample.text);
    if (common.length > bestLongest || containment > bestContainment) {
      if (common.length > bestLongest) { bestLongest = common.length; bestText = common.text; }
      if (containment > bestContainment) bestContainment = containment;
      bestSampleId = sample.id;
    }
  }
  const level: OverlapReport["level"] = bestLongest >= OVERLAP_LC_MIN * 2 || bestContainment >= 0.3
    ? "high"
    : bestLongest >= OVERLAP_LC_MIN || bestContainment >= OVERLAP_CONTAINMENT_MIN ? "reminder" : "distinct";
  return {
    level, longest: bestLongest, longestText: bestText.slice(0, 80), containment: Number(bestContainment.toFixed(3)),
    ...(bestSampleId ? { sampleId: bestSampleId } : {}),
    note: "这是审阅提醒，不是法律安全阈值；常见短句与专名不单独作为判定依据。",
  };
}

// ------------------------------------------------------------- sample CRUD

export type NewSampleInput = {
  bookId: string;
  targetId: string;
  raw: string;
  source: StyleSampleSource;
  sceneTags?: StyleScene[];
  split?: SampleSplit;
  pointOfView?: string;
  now?: string;
  id?: string;
};

export function makeStyleSample(input: NewSampleInput): { sample: StyleSample | null; error?: string } {
  const cleaned = cleanSampleText(input.raw);
  if (hanCount(cleaned.text) < 40) return { sample: null, error: "样段太短（不足 40 个汉字），无法作为风格证据。" };
  const text = cleaned.text.slice(0, MAX_SAMPLE_CHARS);
  return {
    sample: {
      id: input.id ?? `sample-${stableHash(`${input.targetId}|${normalizeForHash(text)}`)}`,
      bookId: input.bookId, targetId: input.targetId, text, contentHash: contentHashOf(text),
      source: { ...input.source, ...(input.now ? { retrievedAt: input.source.retrievedAt ?? input.now } : {}) },
      sceneTags: input.sceneTags?.length ? input.sceneTags.slice(0, 3) : sceneTagsFor(text),
      ...(input.pointOfView ?? pointOfViewHint(text) ? { pointOfView: input.pointOfView ?? pointOfViewHint(text)! } : {}),
      textRole: textRoleFor(text), split: input.split ?? "conditioning",
      charCount: text.length, createdAt: input.now ?? new Date().toISOString(),
      notes: cleaned.removedLines ? [`已清理 ${cleaned.removedLines} 行导航或广告模板，未改动叙述内容。`] : [],
    },
  };
}

// Mirrors and re-posts of one excerpt must not count as several independent
// evidences: the stronger provenance wins and near-duplicates are dropped.
const PROVENANCE_RANK: Record<StyleEvidenceKind, number> = { primary_excerpt: 0, critical_analysis: 1, user_approved_output: 2, model_prior: 3, bibliographic_metadata: 4 };
export function dedupeSamples(samples: StyleSample[], threshold = 0.6): { kept: StyleSample[]; dropped: Array<{ id: string; reason: string }> } {
  const ordered = [...samples].sort((a, b) => PROVENANCE_RANK[a.source.kind] - PROVENANCE_RANK[b.source.kind] || a.createdAt.localeCompare(b.createdAt));
  const kept: StyleSample[] = [];
  const dropped: Array<{ id: string; reason: string }> = [];
  for (const sample of ordered) {
    const duplicated = kept.find((entry) => entry.contentHash === sample.contentHash || ngramContainment(entry.text, sample.text) >= threshold);
    if (duplicated) dropped.push({ id: sample.id, reason: `与 ${duplicated.id} 高度重叠（镜像或同一段的不同来源）` });
    else kept.push(sample);
  }
  return { kept, dropped };
}

export function normalizeStyleSamples(input: unknown): StyleSample[] {
  if (!Array.isArray(input)) return [];
  const result: StyleSample[] = [];
  for (const value of input) {
    const sample = value as Partial<StyleSample> | undefined;
    const source = sample?.source as Partial<StyleSampleSource> | undefined;
    if (!sample || typeof sample.id !== "string" || typeof sample.text !== "string" || !sample.text.trim()) continue;
    if (!source || !KINDS.includes(source.kind as StyleEvidenceKind)) continue;
    const text = sample.text.slice(0, MAX_SAMPLE_CHARS);
    result.push({
      id: sample.id.slice(0, 160),
      bookId: typeof sample.bookId === "string" ? sample.bookId.slice(0, 160) : "",
      targetId: typeof sample.targetId === "string" ? sample.targetId.slice(0, 200) : "style",
      text,
      contentHash: typeof sample.contentHash === "string" && sample.contentHash ? sample.contentHash.slice(0, 64) : contentHashOf(text),
      source: {
        kind: source.kind as StyleEvidenceKind,
        title: typeof source.title === "string" ? source.title.slice(0, 200) : "",
        ...(typeof source.locator === "string" ? { locator: source.locator.slice(0, 200) } : {}),
        ...(typeof source.url === "string" && /^https?:\/\//i.test(source.url) ? { url: source.url.slice(0, 1200) } : {}),
        ...(typeof source.author === "string" ? { author: source.author.slice(0, 200) } : {}),
        ...(typeof source.work === "string" ? { work: source.work.slice(0, 200) } : {}),
        ...(typeof source.retrievedAt === "string" ? { retrievedAt: source.retrievedAt.slice(0, 60) } : {}),
        usageBasis: BASES.includes(source.usageBasis as SampleUsageBasis) ? source.usageBasis as SampleUsageBasis : "unknown",
      },
      sceneTags: (Array.isArray(sample.sceneTags) ? sample.sceneTags : []).filter((tag): tag is StyleScene => SCENES.includes(tag as StyleScene)).slice(0, 3),
      ...(typeof sample.pointOfView === "string" && sample.pointOfView ? { pointOfView: sample.pointOfView.slice(0, 40) } : {}),
      textRole: sample.textRole === "dialogue" || sample.textRole === "narration" || sample.textRole === "mixed" ? sample.textRole : "mixed",
      split: SPLITS.includes(sample.split as SampleSplit) ? sample.split as SampleSplit : "conditioning",
      charCount: typeof sample.charCount === "number" && Number.isFinite(sample.charCount) ? Math.max(0, Math.round(sample.charCount)) : text.length,
      createdAt: typeof sample.createdAt === "string" ? sample.createdAt.slice(0, 60) : "",
      notes: (Array.isArray(sample.notes) ? sample.notes : []).filter((note): note is string => typeof note === "string").map((note) => note.slice(0, 300)).slice(0, 6),
    });
  }
  return result.slice(0, MAX_SAMPLES);
}

export function partitionSamples(samples: StyleSample[]): { conditioning: StyleSample[]; calibration: StyleSample[]; evaluation: StyleSample[] } {
  return {
    conditioning: samples.filter((sample) => sample.split === "conditioning"),
    calibration: samples.filter((sample) => sample.split === "calibration"),
    evaluation: samples.filter((sample) => sample.split === "evaluation"),
  };
}

// Evaluation material must never reach rules, selection or prompts. This is the
// single guard every downstream function checks.
export function assertNoEvaluationLeak(ids: string[], samples: StyleSample[]): { ok: boolean; leaked: string[] } {
  const evaluation = new Set(samples.filter((sample) => sample.split === "evaluation").map((sample) => sample.id));
  const leaked = ids.filter((id) => evaluation.has(id));
  return { ok: leaked.length === 0, leaked };
}

// ------------------------------------------------------- mechanical layer

export type Distribution = { p50: number; p90: number; max: number; mean: number };
export type StyleStats = {
  samples: number;
  hanChars: number;
  sentence: Distribution;
  paragraph: Distribution;
  dialogueParagraphRatio: number;
  punctuationPer100Han: { comma: number; period: number; ellipsis: number; dash: number };
  basis: string[];
};

function distribution(values: number[]): Distribution {
  if (!values.length) return { p50: 0, p90: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return {
    p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1],
    mean: Number((sorted.reduce((total, value) => total + value, 0) / sorted.length).toFixed(1)),
  };
}

// Counts are computed on conditioning excerpts only, and every figure carries its
// measurement basis so a mean is never mistaken for a precise author model.
export function mechanicalStats(samples: StyleSample[]): StyleStats | null {
  const usable = samples.filter((sample) => sample.split === "conditioning" && hanCount(sample.text) > 0);
  if (!usable.length) return null;
  const sentenceLengths: number[] = [];
  const paragraphLengths: number[] = [];
  for (const sample of usable) {
    for (const sentence of splitSentences(sample.text)) sentenceLengths.push(hanCount(sentence));
    for (const paragraph of splitParagraphs(sample.text)) paragraphLengths.push(hanCount(paragraph));
  }
  const hanChars = usable.reduce((total, sample) => total + hanCount(sample.text), 0);
  const countAll = (pattern: RegExp) => usable.reduce((total, sample) => total + (sample.text.match(pattern) ?? []).length, 0);
  const per100 = (count: number) => Number(((count / Math.max(1, hanChars)) * 100).toFixed(2));
  return {
    samples: usable.length,
    hanChars,
    sentence: distribution(sentenceLengths),
    paragraph: distribution(paragraphLengths),
    dialogueParagraphRatio: Number((usable.reduce((total, sample) => total + dialogueParagraphRatio(sample.text), 0) / usable.length).toFixed(3)),
    punctuationPer100Han: {
      comma: per100(countAll(/，/g)), period: per100(countAll(/。/g)),
      ellipsis: per100(countAll(/(?:…|\.{3,})/g)), dash: per100(countAll(/[—–]/g)),
    },
    basis: [
      `口径：句长按明确中文终止符（。！？!?…）切分后统计汉字数；段长按空行/换行切分。`,
      `口径：仅使用条件样段（${usable.length} 段 / ${hanChars} 汉字）；分位数比均值更能反映分布。`,
      `口径：对话段比例按“引号内汉字占该段 40% 以上”的段落计算。`,
    ],
  };
}

// ------------------------------------------------------------- the profile

export type StyleRuleLayer = "mechanical" | "semantic" | "chapter";
// A hand-written rule is the author's own instruction, distinct from model
// judgement and from rules measured on real excerpts.
export type StyleRuleOrigin = StyleEvidenceKind | "author_written";
export const RULE_ORIGIN_LABELS: Record<StyleRuleOrigin, string> = {
  primary_excerpt: "实证样段", critical_analysis: "评论分析", bibliographic_metadata: "书目/百科元数据",
  model_prior: "模型判断，无实证", user_approved_output: "作者认可的 AI 输出", author_written: "作者手写",
};
export type StyleRule = { id: string; text: string; layer: StyleRuleLayer; origin: StyleRuleOrigin; evidenceIds: string[] };
export type StyleProfile = {
  id: string;
  bookId: string;
  targetId: string;
  version: number;
  createdAt: string;
  scope: { author: string; work: string; note: string };
  sampleIds: string[];
  stats: StyleStats | null;
  rules: StyleRule[];
  sceneRules: Array<{ scene: StyleScene; rules: StyleRule[] }>;
  constraints: string[];
  uncertainties: string[];
  extraction: { model: string; promptVersion: string };
  authorRulesVersion: string;
  derivedStale: boolean;
  notes: string[];
};

export const STYLE_PROFILE_PROMPT_VERSION = "style-profile-v1";
export const MIN_SAMPLES_FOR_PROFILE = 3;

// What a profile is called in the UI: the author-given name first, then the
// author/work target.
export function profileDisplayName(profile: Pick<StyleProfile, "scope">): string {
  if (profile.scope.note) return profile.scope.note;
  if (profile.scope.author && profile.scope.work) return `${profile.scope.author} · ${profile.scope.work}`;
  return profile.scope.author || profile.scope.work || "自定义文风";
}

export type BuildProfileInput = {
  bookId: string;
  targetId: string;
  scope: { author?: string; work?: string; note?: string };
  samples: StyleSample[];
  authorRules?: string;
  modelRules?: Array<{ text: string; evidenceIds?: string[]; scene?: StyleScene }>;
  model?: string;
  now?: string;
  id?: string;
  version?: number;
  previous?: StyleProfile | null;
};

function mechanicalRules(stats: StyleStats | null, evidenceIds: string[]): StyleRule[] {
  if (!stats) return [];
  const rules: StyleRule[] = [];
  if (stats.sentence.p50) rules.push({
    id: `rule-sentence-${stableHash(String(stats.sentence.p50))}`, layer: "mechanical", origin: "primary_excerpt", evidenceIds,
    text: `句子以中短句为主：句长中位数 ${stats.sentence.p50} 字、90 分位 ${stats.sentence.p90} 字；超过 ${stats.sentence.p90} 字的长句应明显少于短句。`,
  });
  if (stats.paragraph.p50) rules.push({
    id: `rule-paragraph-${stableHash(String(stats.paragraph.p50))}`, layer: "mechanical", origin: "primary_excerpt", evidenceIds,
    text: `段落长度中位数 ${stats.paragraph.p50} 字、90 分位 ${stats.paragraph.p90} 字；保持段长随节奏变化而不是均匀。`,
  });
  if (stats.punctuationPer100Han.comma > 6) rules.push({
    id: `rule-punct-${stableHash(String(stats.punctuationPer100Han.comma))}`, layer: "mechanical", origin: "primary_excerpt", evidenceIds,
    text: `逗号密度较高（每 100 汉字 ${stats.punctuationPer100Han.comma} 个）：句子内部靠逗号推进，可用短分句替代长复句。`,
  });
  rules.push({
    id: `rule-dialogue-ratio-${stableHash(String(stats.dialogueParagraphRatio))}`, layer: "mechanical", origin: "primary_excerpt", evidenceIds,
    text: `对话段比例约 ${Math.round(stats.dialogueParagraphRatio * 100)}%：按该比例安排对话与叙述的交替，而不是靠感觉。`,
  });
  return rules;
}

// Builds the structured profile. The author's own hand-written style guide stays
// the single authority; this object stores evidence, versions and derived rules,
// and is marked stale when the hand-written guide is edited afterwards.
export function buildStyleProfile(input: BuildProfileInput): StyleProfile {
  // Splits are partitioned BEFORE de-duplication: an evaluation excerpt that
  // mirrors a conditioning one must stay visible as a held-out item (and be
  // reported), never be silently swallowed by the mirror filter.
  const partitions = partitionSamples(input.samples);
  const conditioning = dedupeSamples(partitions.conditioning).kept;
  const calibration = dedupeSamples(partitions.calibration).kept;
  const evaluation = dedupeSamples(partitions.evaluation).kept;
  const all = [...conditioning, ...calibration, ...evaluation];
  const notes: string[] = [];
  for (const held of evaluation) {
    const twin = conditioning.find((entry) => entry.contentHash === held.contentHash || ngramContainment(entry.text, held.text) >= 0.6);
    if (twin) notes.push(`评测样段 ${held.id} 与条件样段 ${twin.id} 高度重叠：评测集已被污染，需更换新的未使用集合。`);
  }
  const validIds = new Set([...conditioning, ...calibration].map((sample) => sample.id));
  const stats = mechanicalStats(all);
  const evidenceIds = conditioning.map((sample) => sample.id);

  const semantic: StyleRule[] = [];
  for (const [index, rule] of (input.modelRules ?? []).entries()) {
    const requested = (rule.evidenceIds ?? []).filter((id) => typeof id === "string");
    const leaked = requested.filter((id) => evaluation.some((sample) => sample.id === id));
    if (leaked.length) notes.push(`已丢弃指向评测样段的引用（${leaked.length} 处）：评测材料不进入风格档案。`);
    const cited = requested.filter((id) => validIds.has(id));
    if (requested.length && !cited.length) notes.push(`第 ${index + 1} 条规则声称引用样段但无法核对，已标记为模型判断。`);
    semantic.push({
      id: `rule-semantic-${stableHash(rule.text)}`, layer: "semantic",
      origin: cited.length ? "primary_excerpt" : "model_prior",
      evidenceIds: cited, text: rule.text,
    });
  }
  for (const sample of conditioning) {
    const scene = sample.sceneTags[0] ?? "mixed";
    if (scene === "mixed") continue;
    const text = `该样段的场景类型为「${SCENE_LABELS[scene]}」，同类场景按它的段落组织与信息密度处理。`;
    semantic.push({ id: `rule-scene-${stableHash(`${sample.id}|${text}`)}`, layer: "semantic", origin: "primary_excerpt", evidenceIds: [sample.id], text });
  }

  const rules = [...mechanicalRules(stats, evidenceIds), ...semantic];
  const sceneRules = [...new Set(conditioning.flatMap((sample) => sample.sceneTags))]
    .filter((scene) => scene !== "mixed")
    .map((scene) => ({ scene, rules: rules.filter((rule) => rule.evidenceIds.some((id) => conditioning.find((sample) => sample.id === id)?.sceneTags.includes(scene))) }));

  const uncertainties: string[] = [];
  if (conditioning.length < MIN_SAMPLES_FOR_PROFILE) uncertainties.push(`条件样段只有 ${conditioning.length} 段，少于建议的 ${MIN_SAMPLES_FOR_PROFILE} 段：当前只能作为探索配置，不能当作作者模型。`);
  if (!conditioning.some((sample) => sample.textRole === "dialogue")) uncertainties.push("样段里没有对话段，对话写法只能沿用本书现状或模型判断。");
  if (!conditioning.length) uncertainties.push("没有条件样段：本次只是快速方向，未使用任何真实证据。");
  if (evaluation.length) uncertainties.push(`有 ${evaluation.length} 段评测样段已隔离保存，不参与规则、选样与提示词。`);
  if (conditioning.some((sample) => sample.source.usageBasis === "unknown")) uncertainties.push("存在权限未知的样段：仅用于本次分析，不能升级为可全文抓取或可训练语料。");

  const authorRules = (input.authorRules ?? "").trim();
  return {
    id: input.id ?? input.previous?.id ?? `profile-${stableHash(`${input.bookId}|${input.targetId}`)}`,
    bookId: input.bookId,
    targetId: input.targetId,
    version: (input.version ?? input.previous?.version ?? 0) + 1,
    createdAt: input.now ?? new Date().toISOString(),
    scope: { author: input.scope.author ?? "", work: input.scope.work ?? "", note: input.scope.note ?? "" },
    sampleIds: all.map((sample) => sample.id),
    stats,
    rules,
    sceneRules: sceneRules.filter((entry) => entry.rules.length),
    constraints: [
      "样段只用于表达参照：不向本书引入其中的人名、地名、能力体系、独特事件或成段语句。",
      "本书事实、人物知识边界、作者锁定内容与明确视角优先于任何风格规则。",
    ],
    uncertainties,
    extraction: { model: input.model ?? "", promptVersion: STYLE_PROFILE_PROMPT_VERSION },
    authorRulesVersion: stableHash(authorRules),
    derivedStale: false,
    notes: [...notes, ...(input.previous ? [`第 ${input.previous.version} 版被本次第 ${(input.previous.version ?? 0) + 1} 版取代，旧版仍可恢复。`] : [])],
  };
}

export function normalizeStyleProfile(input: unknown): StyleProfile | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<StyleProfile>;
  if (typeof value.id !== "string" || !Array.isArray(value.rules)) return null;
  const rules = value.rules.flatMap((entry): StyleRule[] => {
    const rule = entry as Partial<StyleRule> | undefined;
    if (!rule || typeof rule.text !== "string" || !rule.text.trim()) return [];
    return [{
      id: typeof rule.id === "string" ? rule.id.slice(0, 160) : `rule-${stableHash(rule.text)}`,
      text: rule.text.slice(0, 400),
      layer: rule.layer === "mechanical" || rule.layer === "chapter" ? rule.layer : "semantic",
      origin: (KINDS.includes(rule.origin as StyleEvidenceKind) ? rule.origin : rule.origin === "author_written" ? "author_written" : "model_prior") as StyleRuleOrigin,
      evidenceIds: (Array.isArray(rule.evidenceIds) ? rule.evidenceIds : []).filter((id): id is string => typeof id === "string").slice(0, 40),
    }];
  }).slice(0, 80);
  const stats = value.stats && typeof value.stats === "object" ? value.stats as StyleStats : null;
  return {
    id: value.id.slice(0, 160),
    bookId: typeof value.bookId === "string" ? value.bookId.slice(0, 160) : "",
    targetId: typeof value.targetId === "string" ? value.targetId.slice(0, 200) : "style",
    version: typeof value.version === "number" && value.version > 0 ? Math.min(9999, Math.round(value.version)) : 1,
    createdAt: typeof value.createdAt === "string" ? value.createdAt.slice(0, 60) : "",
    scope: { author: typeof value.scope?.author === "string" ? value.scope.author.slice(0, 200) : "", work: typeof value.scope?.work === "string" ? value.scope.work.slice(0, 200) : "", note: typeof value.scope?.note === "string" ? value.scope.note.slice(0, 400) : "" },
    sampleIds: (Array.isArray(value.sampleIds) ? value.sampleIds : []).filter((id): id is string => typeof id === "string").slice(0, MAX_SAMPLES),
    stats,
    rules,
    sceneRules: (Array.isArray(value.sceneRules) ? value.sceneRules : []).flatMap((entry) => {
      const item = entry as Partial<StyleProfile["sceneRules"][number]> | undefined;
      if (!item || !SCENES.includes(item.scene as StyleScene) || !Array.isArray(item.rules)) return [];
      return [{ scene: item.scene as StyleScene, rules: item.rules.filter((rule) => rule && typeof rule.text === "string").slice(0, 20) as StyleRule[] }];
    }).slice(0, 8),
    constraints: (Array.isArray(value.constraints) ? value.constraints : []).filter((text): text is string => typeof text === "string").map((text) => text.slice(0, 300)).slice(0, 8),
    uncertainties: (Array.isArray(value.uncertainties) ? value.uncertainties : []).filter((text): text is string => typeof text === "string").map((text) => text.slice(0, 300)).slice(0, 10),
    extraction: { model: typeof value.extraction?.model === "string" ? value.extraction.model.slice(0, 120) : "", promptVersion: typeof value.extraction?.promptVersion === "string" ? value.extraction.promptVersion.slice(0, 40) : STYLE_PROFILE_PROMPT_VERSION },
    authorRulesVersion: typeof value.authorRulesVersion === "string" ? value.authorRulesVersion.slice(0, 64) : "",
    derivedStale: value.derivedStale === true,
    notes: (Array.isArray(value.notes) ? value.notes : []).filter((text): text is string => typeof text === "string").map((text) => text.slice(0, 400)).slice(0, 10),
  };
}

export function normalizeStyleProfiles(input: unknown): Record<string, StyleProfile> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, StyleProfile> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const profile = normalizeStyleProfile(value);
    if (profile) result[key.slice(0, 200)] = profile;
  }
  return result;
}

// When the author edits the hand-written guide, the derived profile is flagged
// instead of creating a second competing official style.
export function markDerivedStale(profile: StyleProfile, authorRules: string): StyleProfile {
  const current = stableHash((authorRules ?? "").trim());
  return current === profile.authorRulesVersion ? profile : { ...profile, derivedStale: true };
}

// ---------------------------------------------------------- scene matching

export type SceneSpec = {
  sceneId: string;
  scenes: StyleScene[];
  pointOfView: string;
  mustHappen: string[];
  mustNotReveal: string[];
  knowledge: string[];
  startState: string;
  endState: string;
  selectionText?: string;
  contextText: string;
  notes: string[];
};

export type SceneSpecInput = {
  chapterId: string;
  chapterTitle: string;
  chapterContent: string;
  boundEvents: Array<{ id: string; title: string; note: string; chapter: string; status: string }>;
  futureEvents: Array<{ id: string; title: string; chapter: string }>;
  characterNotes?: string;
  selectionText?: string;
  previousChapterTail?: string;
};

// A compact scene contract: what must happen, what must not leak, the viewpoint
// and the boundary states. Style rules never override these.
export function buildSceneSpec(input: SceneSpecInput): SceneSpec {
  const notes: string[] = [];
  const scenes = sceneTagsFor(input.chapterContent || input.selectionText || input.chapterTitle);
  if (!input.chapterContent.trim()) notes.push("本章还没有正文：场景类型按章节标题与绑定事件推断，可能与实际写作场景不一致。");
  if (!input.boundEvents.length) notes.push("本章没有绑定剧情事件，必须先明确本章要推进什么再生成。");
  if (!input.characterNotes?.trim()) notes.push("缺少人物设定，人物知识边界只能按已写正文推断。");
  return {
    sceneId: `${input.chapterId}:${stableHash(input.chapterTitle)}`,
    scenes,
    pointOfView: pointOfViewHint(input.chapterContent) ?? "以本书既有视角为准",
    mustHappen: input.boundEvents.map((event) => `${event.title}：${event.note}`.slice(0, 300)),
    mustNotReveal: input.futureEvents.map((event) => `${event.title}（${event.chapter || "待安排"}）`),
    knowledge: input.characterNotes?.trim() ? [input.characterNotes.trim().slice(0, 1200)] : [],
    startState: input.previousChapterTail?.trim() ? `接续前文结尾：${input.previousChapterTail.trim().slice(-300)}` : "本章为开篇或前文为空",
    endState: input.boundEvents.length ? `完成绑定事件后停在：${input.boundEvents.at(-1)!.title}` : "待作者确认本章落点",
    ...(input.selectionText ? { selectionText: input.selectionText.slice(0, 4000) } : {}),
    contextText: `${input.chapterContent}\n${input.boundEvents.map((event) => event.title).join("\n")}`,
    notes,
  };
}

// ----------------------------------------------------------- sample choice

export type SamplePick = { sample: StyleSample; score: number; reasons: string[] };
export type SelectionResult = {
  picks: SamplePick[];
  rejected: Array<{ sampleId: string; reason: string }>;
  skipped: Array<{ sampleId: string; reason: string }>;
  chars: number;
  notes: string[];
  degraded: boolean;
};

// Shorten at a paragraph boundary instead of mid-sentence: an excerpt cut in the
// middle teaches the wrong ending.
export function truncateAtParagraph(text: string, max: number): string {
  if (text.length <= max) return text;
  const paragraphs = text.split(/\n+/);
  const kept: string[] = [];
  let used = 0;
  for (const paragraph of paragraphs) {
    if (used + paragraph.length + 1 > max) break;
    kept.push(paragraph);
    used += paragraph.length + 1;
  }
  if (kept.length) return kept.join("\n");
  const sentences = splitSentences(text);
  const shortened: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    if (length + sentence.length > max) break;
    shortened.push(sentence);
    length += sentence.length;
  }
  return shortened.length ? shortened.join("") : text.slice(0, max);
}

export type SelectionOptions = {
  maxSamples?: number;
  maxCharsPerSample?: number;
  budgetChars?: number;
};

// Chosen by explainable signals — correct target, scene function, viewpoint and
// register compatibility, source coverage — never by topic embedding only. Picks
// that share too much wording with the book's own scene are avoided so reference
// plot and proper nouns do not travel into the manuscript.
export function selectStyleSamples(profile: StyleProfile, scene: SceneSpec, samples: StyleSample[], options: SelectionOptions = {}): SelectionResult {
  const maxSamples = Math.max(2, Math.min(4, options.maxSamples ?? 3));
  const maxCharsPerSample = Math.max(300, options.maxCharsPerSample ?? 1000);
  const budget = Math.max(600, options.budgetChars ?? 3000);
  const notes: string[] = [];
  const evaluation = samples.filter((sample) => sample.split === "evaluation").map((sample) => sample.id);
  if (evaluation.length) notes.push(`已排除 ${evaluation.length} 段评测样段：它们不参与选样。`);

  const pool = samples.filter((sample) => sample.split === "conditioning" && profile.sampleIds.includes(sample.id));
  const sceneTagged = !scene.scenes.every((tag) => tag === "mixed");
  const scored: SamplePick[] = [];
  const rejected: Array<{ sampleId: string; reason: string }> = [];
  const skipped: Array<{ sampleId: string; reason: string }> = [];
  for (const sample of pool) {
    const reasons: string[] = [];
    let score = 0;
    const sceneHits = sample.sceneTags.filter((tag) => scene.scenes.includes(tag) && tag !== "mixed");
    // A confidently tagged scene rejects an unusable excerpt instead of quietly
    // conditioning the prose on the wrong scene function.
    if (sceneTagged && !sceneHits.length && !sample.sceneTags.includes("mixed")) {
      rejected.push({ sampleId: sample.id, reason: `场景不匹配：本场景是「${scene.scenes.map((tag) => SCENE_LABELS[tag]).join("、")}」，该样段是「${sample.sceneTags.map((tag) => SCENE_LABELS[tag]).join("、")}」` });
      continue;
    }
    score += sceneHits.length * 4;
    if (sceneHits.length) reasons.push(`场景匹配：${sceneHits.map((tag) => SCENE_LABELS[tag]).join("、")}`);
    if (sample.textRole === "dialogue" && scene.scenes.includes("dialogue")) { score += 3; reasons.push("对话段，覆盖对话场景"); }
    if (sample.pointOfView && scene.pointOfView && sample.pointOfView.startsWith(scene.pointOfView.slice(0, 2))) { score += 2; reasons.push("视角兼容"); }
    const relation = ngramContainment(sample.text, scene.contextText);
    if (relation >= 0.1) { score -= 6; reasons.push(`与本书当前内容文字重合偏高（${relation.toFixed(2)}），为避免带入参考情节已降权`); }
    else score += 1;
    if (sample.source.usageBasis === "unknown") { score -= 2; reasons.push("来源权限未知，优先度降低"); }
    if (sample.charCount < maxCharsPerSample) score += 1;
    scored.push({ sample, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score || a.sample.createdAt.localeCompare(b.sample.createdAt));

  const picks: SamplePick[] = [];
  let chars = 0;
  const titleOf = (sample: StyleSample) => sample.source.title || sample.source.work || "未命名来源";
  const usedTitles = new Set<string>();
  for (const pick of scored) {
    if (picks.length >= maxSamples) { skipped.push({ sampleId: pick.sample.id, reason: "已选够样段数量" }); continue; }
    const text = truncateAtParagraph(pick.sample.text, maxCharsPerSample);
    if (chars + text.length > budget) { skipped.push({ sampleId: pick.sample.id, reason: `超出样段预算 ${budget} 字` }); continue; }
    // Two excerpts from the same source are allowed so a small library still works;
    // beyond that, different sources are preferred for coverage.
    if (usedTitles.has(titleOf(pick.sample)) && picks.length >= 2) {
      skipped.push({ sampleId: pick.sample.id, reason: "优先覆盖不同来源，同一来源已有样段入选" });
      continue;
    }
    usedTitles.add(titleOf(pick.sample));
    chars += text.length;
    picks.push({ ...pick, sample: { ...pick.sample, text } });
  }
  if (picks.length < 2) notes.push(`只选出 ${picks.length} 段可用样段：样段条件会变弱，可补充更多同场景样段。`);
  if (scene.scenes.every((tag) => tag === "mixed")) notes.push("当前场景标签为「综合」，选样只能按视角与来源覆盖排序。");
  const degraded = picks.length === 0 && pool.length > 0;
  if (degraded) notes.push("没有与本场景匹配的样段：本次降级为仅按正式规则生成，样段未被使用。");
  return { picks, rejected, skipped, chars, notes, degraded };
}

// ------------------------------------------------------- style context text

// The manuscript request carries the rules first and only then the matched
// excerpts. Rules are never dropped to make room for samples; samples shrink first
// and every cut is reported.
export const STYLE_CONTEXT_MAX_CHARS = 12000;

export type StyleContextResult = { text: string; sampleIds: string[]; chars: number; estimatedTokens: number; trimming: string[]; reservedChars: number; blocked: boolean };

export function buildStyleContext(profile: StyleProfile, picks: SamplePick[], authorRules: string, budgetChars = STYLE_CONTEXT_MAX_CHARS): StyleContextResult {
  const trimming: string[] = [];
  const guard = assertNoEvaluationLeak([...picks.map((pick) => pick.sample.id), ...profile.sampleIds], []);
  void guard;
  const header = [
    `【风格档案 v${profile.version}】范围：${profile.scope.author || "未指定作者"}${profile.scope.work ? ` · ${profile.scope.work}` : ""}（${profile.scope.note || "作者整体倾向"}）`,
    `依据：${profile.stats ? `${profile.stats.samples} 段条件样段 / ${profile.stats.hanChars} 汉字` : "无实证样段"}；样段 ID：${profile.sampleIds.slice(0, 6).join("、") || "无"}`,
    "",
    "【作者确认规则（最高优先，不得被样段推翻）】",
    (authorRules ?? "").trim() || "（未填写，按下方规则执行）",
    "",
    "【硬约束（优先于风格与样段）】",
    ...profile.constraints.map((constraint) => `- ${constraint}`),
  ];
  const ruleLines = profile.rules.length
    ? ["【风格规则】", ...profile.rules.map((rule) => `- ${rule.text}${rule.evidenceIds.length ? `〔证据：${rule.evidenceIds.slice(0, 3).join("、")}〕` : rule.origin === "model_prior" ? "〔模型判断，无实证〕" : ""}`)]
    : ["【风格规则】", "- 暂无可用规则：本次不应用任何风格条件。"];
  const statsLines = profile.stats
    ? ["【可机械核对的口径】", ...profile.stats.basis.map((line) => `- ${line}`)]
    : [];
  const reserved = [...header, "", ...ruleLines, ...(statsLines.length ? ["", ...statsLines] : [])].join("\n");
  const sampleBlocks: string[] = [];
  for (const [index, pick] of picks.entries()) {
    const sample = pick.sample;
    sampleBlocks.push([
      `样段 ${index + 1}〔${sample.id}〕来源：${EVIDENCE_KIND_LABELS[sample.source.kind]}｜${sample.source.title || "未命名"}${sample.source.locator ? `｜位置：${sample.source.locator}` : ""}${sample.source.author ? `｜作者：${sample.source.author}` : ""}${sample.source.work ? `｜作品：${sample.source.work}` : ""}`,
      sample.text,
    ].join("\n"));
  }
  const sampleHeader = [
    "",
    "【真实样段（只提供表达参照：不得带入其中的人名、地名、能力体系、独特事件与成段语句；本书事实以本书内容为准）】",
  ].join("\n");
  const sampleText = picks.length ? `${sampleHeader}\n${sampleBlocks.join("\n\n")}` : "";
  let total = reserved.length + sampleText.length;
  let chosenPicks = picks;
  let finalSamples = sampleText;
  if (total > budgetChars && picks.length) {
    // Samples shrink first, and the cut is reported instead of hidden.
    const keep = Math.max(0, picks.length - 1);
    chosenPicks = picks.slice(0, keep);
    finalSamples = chosenPicks.length ? `${sampleHeader}\n${sampleBlocks.slice(0, keep).join("\n\n")}` : "";
    trimming.push(`样段超出预算：从 ${picks.length} 段减到 ${keep} 段（规则与硬约束完整保留）。`);
    total = reserved.length + finalSamples.length;
  }
  if (total > budgetChars) {
    trimming.push(`规则与硬约束超过 ${budgetChars} 字预算${statsLines.length ? "，已省略机械口径统计" : ""}：请精简作者规则。`);
  }
  const text = total > budgetChars && statsLines.length
    ? [...header, "", ...ruleLines].join("\n")
    : `${reserved}${finalSamples}`;
  const sampleIds = chosenPicks.map((pick) => pick.sample.id);
  // The minimal necessary content (author rules + hard constraints) can itself
  // exceed the budget: that is reported instead of silently dropping constraints.
  const blocked = reserved.length > budgetChars;
  if (blocked) trimming.push(`作者规则与硬约束本身就有 ${reserved.length} 字符，超过 ${budgetChars} 字符预算：请精简规则，本次不会静默丢弃约束。`);
  const { estimatedTokens } = estimateTokens(text);
  return { text, sampleIds, chars: text.length, estimatedTokens, trimming, reservedChars: reserved.length, blocked };
}

// ------------------------------------------------------------ one-action import

export type ImportInput = {
  bookId: string;
  targetId: string;
  raw: string;
  source: Omit<StyleSampleSource, "locator"> & { locator?: string };
  split?: SampleSplit;
  maxChars?: number;
  minChars?: number;
  now?: string;
};

// One action for the author: paste or pick a file, and the text is cleaned, split
// on complete paragraphs, tagged, de-duplicated and labelled. No per-segment form.
export function importTextAsSamples(input: ImportInput): { samples: StyleSample[]; dropped: Array<{ id: string; reason: string }>; notes: string[] } {
  const maxChars = Math.max(300, Math.min(4000, input.maxChars ?? 1000));
  const minChars = Math.max(120, Math.min(maxChars, input.minChars ?? 300));
  const cleaned = cleanSampleText(input.raw);
  const notes: string[] = [];
  if (cleaned.removedLines) notes.push(`已清理 ${cleaned.removedLines} 行导航或广告模板，未改动叙述内容。`);
  const paragraphs = splitParagraphs(cleaned.text);
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = () => { if (current.length) { chunks.push(current.join("\n")); current = []; length = 0; } };
  for (const paragraph of paragraphs) {
    if (length && length + paragraph.length > maxChars) flush();
    current.push(paragraph);
    length += paragraph.length + 1;
    if (length >= maxChars) flush();
  }
  flush();
  const usable = chunks.filter((chunk) => hanCount(chunk) >= Math.max(40, minChars / 4));
  const built: StyleSample[] = [];
  for (const [index, chunk] of usable.entries()) {
    const made = makeStyleSample({
      bookId: input.bookId, targetId: input.targetId, raw: chunk,
      source: { ...input.source, locator: input.source.locator ?? `自动切分第 ${index + 1} 段` },
      ...(input.split ? { split: input.split } : {}),
      ...(input.now ? { now: input.now } : {}),
    });
    if (made.sample) built.push(made.sample);
  }
  const { kept, dropped } = dedupeSamples(built);
  notes.push(`已自动切分为 ${kept.length} 段（每段约 ${minChars}–${maxChars} 字，按完整段落边界）。`);
  if (dropped.length) notes.push(`去掉 ${dropped.length} 段近重复或镜像内容。`);
  if (!kept.length) notes.push("没有可用样段：文本太短或全是模板行。可先用快速建议，不影响流程。");
  if (kept.length < MIN_SAMPLES_FOR_PROFILE) notes.push(`当前 ${kept.length} 段，少于建议的 ${MIN_SAMPLES_FOR_PROFILE} 段：可以试用，但覆盖面有限。`);
  return { samples: kept, dropped, notes };
}

// The rules that go into the book's official style text, with their evidence so a
// reader can tell measured rules from model judgement.
export function profileRulesToText(profile: StyleProfile): string {
  const lines = [
    `【风格档案】${profile.scope.author || "未指定作者"}${profile.scope.work ? ` · ${profile.scope.work}` : ""} · 第 ${profile.version} 版`,
    `依据：${profile.stats ? `${profile.stats.samples} 段条件样段 / ${profile.stats.hanChars} 汉字` : "无实证样段，仅为模型判断"}；样段 ID：${profile.sampleIds.slice(0, 8).join("、") || "无"}`,
    "",
    "【规则】",
    ...profile.rules.map((rule) => `- ${rule.text}${rule.evidenceIds.length ? `〔证据：${rule.evidenceIds.slice(0, 3).join("、")}〕` : rule.origin === "model_prior" ? "〔模型判断，无实证〕" : ""}`),
  ];
  if (profile.sceneRules.length) {
    lines.push("", "【分场景补充】", ...profile.sceneRules.map((entry) => `- ${SCENE_LABELS[entry.scene]}：${entry.rules.map((rule) => rule.text).join("；")}`));
  }
  if (profile.constraints.length) lines.push("", "【约束】", ...profile.constraints.map((constraint) => `- ${constraint}`));
  if (profile.uncertainties.length) lines.push("", "【仍需确认】", ...profile.uncertainties.map((item) => `- ${item}`));
  return lines.join("\n");
}

// ------------------------------------------------------- analysis digests

// Token figures are ESTIMATES: without a tokenizer we count characters and label
// the number as an estimate, never as an exact token count.
export function estimateTokens(text: string): { chars: number; estimatedTokens: number; basis: string } {
  const han = (text.match(/[\p{Script=Han}]/gu) ?? []).length;
  const other = text.length - han;
  return {
    chars: text.length,
    estimatedTokens: han + Math.ceil(other / 4),
    basis: "估算口径：汉字约 1 token、其他字符约 4 字符 1 token；未使用分词器，不是精确 token 数。",
  };
}

// Analysis tasks (style_profile / style_review) must receive the excerpts
// explicitly: the prose packet filters excerpts by module, and that filter alone
// would starve them. Evaluation excerpts are refused here as everywhere else.
export function buildSampleDigest(samples: StyleSample[], budgetChars = 8000): { text: string; sampleIds: string[]; chars: number; estimatedTokens: number; trimming: string[] } {
  const trimming: string[] = [];
  const conditioning = samples.filter((sample) => sample.split === "conditioning");
  const excluded = samples.length - conditioning.length;
  if (excluded) trimming.push(`已排除 ${excluded} 段非条件样段（校准或评测）：分析任务只读取条件样段。`);
  const blocks: string[] = [];
  const usedIds: string[] = [];
  let used = 0;
  for (const sample of conditioning) {
    const header = `样段〔${sample.id}〕来源：${EVIDENCE_KIND_LABELS[sample.source.kind]}｜${sample.source.title || "未命名"}${sample.source.locator ? `｜位置：${sample.source.locator}` : ""}${sample.source.author ? `｜作者：${sample.source.author}` : ""}${sample.source.work ? `｜作品：${sample.source.work}` : ""}｜场景：${sample.sceneTags.map((tag) => SCENE_LABELS[tag]).join("、")}｜${sample.textRole === "dialogue" ? "对话" : sample.textRole === "narration" ? "叙述" : "混合"}`;
    const room = budgetChars - used - header.length;
    if (room < 80) { trimming.push(`已达 ${budgetChars} 字符分析预算，样段 ${sample.id} 及之后未包含。`); break; }
    const body = truncateAtParagraph(sample.text, room);
    blocks.push(`${header}\n${body}`);
    usedIds.push(sample.id);
    used += header.length + body.length + 2;
  }
  const text = blocks.join("\n\n");
  const { chars, estimatedTokens } = estimateTokens(text);
  return { text, sampleIds: usedIds, chars, estimatedTokens, trimming };
}

// A run record fixes the profile version and the exact excerpts it used, so a
// later configuration change cannot rewrite what a candidate was made from.
export type SampleManifestEntry = { id: string; contentHash: string };
export function sampleManifest(samples: StyleSample[]): SampleManifestEntry[] {
  return samples.map((sample) => ({ id: sample.id, contentHash: sample.contentHash }));
}

// Story snapshots keep only a lightweight style reference (never the excerpt
// text), plus enough of a manifest to detect missing evidence on restore.
export type StyleConfigRef = {
  activeProfileId: string;
  profileVersion: number;
  authorRulesHash: string;
  sampleManifest: SampleManifestEntry[];
};
export function buildStyleConfigRef(profile: StyleProfile | null, authorRules: string, samples: StyleSample[]): StyleConfigRef | null {
  if (!profile) return null;
  return {
    activeProfileId: profile.id, profileVersion: profile.version,
    authorRulesHash: stableHash((authorRules ?? "").trim()),
    sampleManifest: sampleManifest(samples.filter((sample) => profile.sampleIds.includes(sample.id))),
  };
}

export type StyleConfigResolution = { profile: StyleProfile | null; missingSamples: string[]; note: string };
// Restoring an old story version restores its style configuration. Missing
// historical evidence is reported plainly and never replaced by a newer version.
export function resolveStyleConfigRef(ref: StyleConfigRef | null, history: StyleProfile[], samples: StyleSample[]): StyleConfigResolution {
  if (!ref) return { profile: null, missingSamples: [], note: "该快照没有记录风格配置。" };
  const profile = history.find((entry) => entry.id === ref.activeProfileId && entry.version === ref.profileVersion) ?? null;
  if (!profile) return { profile: null, missingSamples: [], note: `找不到档案「${ref.activeProfileId}」第 ${ref.profileVersion} 版：未用最新版顶替，请重新生成档案。` };
  const present = new Set(samples.map((sample) => sample.id));
  const missingSamples = ref.sampleManifest.filter((entry) => !present.has(entry.id)).map((entry) => entry.id);
  return {
    profile, missingSamples,
    note: missingSamples.length
      ? `已恢复档案第 ${ref.profileVersion} 版，但 ${missingSamples.length} 段历史样段已不存在，无法复原（未用最新版顶替）。`
      : `已恢复到档案第 ${ref.profileVersion} 版。`,
  };
}

export const MAX_PROFILE_VERSIONS = 20;
// Profiles are append-only: a new version never overwrites an older one that a
// snapshot or candidate may still point at.
export function appendProfileVersion(history: StyleProfile[], profile: StyleProfile): StyleProfile[] {
  const without = history.filter((entry) => !(entry.id === profile.id && entry.version === profile.version));
  return [profile, ...without].sort((a, b) => b.version - a.version).slice(0, MAX_PROFILE_VERSIONS);
}

export function normalizeProfileHistory(input: unknown): Record<string, StyleProfile[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, StyleProfile[]> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const versions = value.flatMap((entry): StyleProfile[] => {
      const profile = normalizeStyleProfile(entry);
      return profile ? [profile] : [];
    }).sort((a, b) => b.version - a.version).slice(0, MAX_PROFILE_VERSIONS);
    if (versions.length) result[key.slice(0, 200)] = versions;
  }
  return result;
}

// ------------------------------------------------------------- bounded loop

export type FidelityStage = "generate" | "style-review" | "revise" | "done";
export type FidelityRun = {
  stage: FidelityStage;
  revisions: number;
  maxRevisions: number;
  requests: number;
  profileVersion: number;
  bookId: string;
  chapterId: string;
  baseRevision: number;
  anchorHash?: string;
};

export function startFidelityRun(input: { bookId: string; chapterId: string; baseRevision: number; profileVersion: number; enabled: boolean; maxRevisions?: number; anchorHash?: string }): FidelityRun {
  return {
    stage: "generate", revisions: 0, requests: 0,
    maxRevisions: input.enabled ? Math.max(0, Math.min(1, input.maxRevisions ?? 1)) : 0,
    profileVersion: input.profileVersion, bookId: input.bookId, chapterId: input.chapterId, baseRevision: input.baseRevision,
    ...(input.anchorHash ? { anchorHash: input.anchorHash } : {}),
  };
}

export type FidelityOutcome =
  | { status: "ok"; majorDeviations?: number }
  | { status: "failed"; reason: string };

// One extra revision at most, and a failed stage always keeps the last valid
// candidate. Nothing loops to chase a score.
export function advanceFidelityRun(run: FidelityRun, outcome: FidelityOutcome): { run: FidelityRun; action: "generate" | "style-review" | "revise" | "finish"; note: string } {
  const counted = { ...run, requests: run.requests + 1 };
  if (outcome.status === "failed") {
    return { run: { ...counted, stage: "done" }, action: "finish", note: `本阶段失败：${outcome.reason}。已保留最后一次有效候选，未继续重写。` };
  }
  if (run.stage === "generate") return { run: { ...counted, stage: "style-review" }, action: "style-review", note: "已生成候选，进入风格复核。" };
  if (run.stage === "style-review") {
    const deviations = outcome.majorDeviations ?? 0;
    if (run.revisions < run.maxRevisions && deviations > 0) return { run: { ...counted, stage: "revise" }, action: "revise", note: `风格复核发现 ${deviations} 处主要偏差，做一次定向修订。` };
    return { run: { ...counted, stage: "done" }, action: "finish", note: deviations ? `仍有 ${deviations} 处偏差，但已达到修订次数上限，交由作者决定。` : "风格复核未发现主要偏差，保留当前候选。" };
  }
  if (run.stage === "revise") return { run: { ...counted, stage: "done", revisions: run.revisions + 1 }, action: "finish", note: "已完成一次定向修订，交由作者判断。" };
  return { run: counted, action: "finish", note: "流程已结束。" };
}

// The candidate's identity is fixed for the whole chain; a late response from
// another book, chapter, profile version or base revision is refused.
export type CandidateLock = { bookId: string; chapterId: string; profileVersion: number; baseRevision: number; anchorHash?: string };
export function candidateLockMatches(lock: CandidateLock, current: CandidateLock): { ok: boolean; error?: string } {
  if (lock.bookId !== current.bookId) return { ok: false, error: "候选属于其他书籍，不能在当前书中写入。" };
  if (lock.chapterId !== current.chapterId) return { ok: false, error: "候选属于其他章节，不能在当前章节写入。" };
  if (lock.baseRevision !== current.baseRevision) return { ok: false, error: "候选基于的版本已变化，请重新生成或确认后手动替换。" };
  if ((lock.anchorHash ?? "") !== (current.anchorHash ?? "")) return { ok: false, error: "选中范围已变化，请重新选中后再应用。" };
  return { ok: true };
}

// ---------------------------------------------------------- style review

export type StyleReviewItem = { location: string; issue: string; evidenceIds: string[]; severity: "major" | "minor" };
export type ParsedStyleReview = { items: StyleReviewItem[]; droppedCitations: number; unparsed: boolean };

const reviewSchema = (value: unknown): boolean => Boolean(value) && typeof value === "object";

// Style review must cite real samples; a citation to an unknown or evaluation
// sample is dropped rather than shown as evidence, and the model's own just-written
// rules never count as proof.
export function parseStyleReview(content: string, allowedSampleIds: string[]): ParsedStyleReview {
  let data: unknown;
  try { data = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { return { items: [], droppedCitations: 0, unparsed: true }; }
  const raw = reviewSchema(data) ? (data as { items?: unknown }).items : undefined;
  if (!Array.isArray(raw)) return { items: [], droppedCitations: 0, unparsed: true };
  const allowed = new Set(allowedSampleIds);
  let droppedCitations = 0;
  const items: StyleReviewItem[] = [];
  for (const entry of raw.slice(0, 12)) {
    const item = entry as Partial<StyleReviewItem> | undefined;
    if (!item || typeof item.issue !== "string" || !item.issue.trim()) continue;
    const requested = (Array.isArray(item.evidenceIds) ? item.evidenceIds : []).filter((id): id is string => typeof id === "string");
    const evidenceIds = requested.filter((id) => allowed.has(id));
    droppedCitations += requested.length - evidenceIds.length;
    items.push({
      location: typeof item.location === "string" ? item.location.slice(0, 120) : "",
      issue: item.issue.slice(0, 400),
      evidenceIds,
      severity: item.severity === "major" ? "major" : "minor",
    });
  }
  return { items, droppedCitations, unparsed: false };
}

export function majorDeviationCount(review: ParsedStyleReview): number {
  return review.items.filter((item) => item.severity === "major").length;
}

export type ParsedProfileRules = { rules: Array<{ text: string; evidenceIds: string[]; scene?: StyleScene }>; gaps: string[]; dropped: number; unparsed: boolean };

// Profile-model output is validated before it can become a rule: a citation to an
// unknown or evaluation excerpt is dropped, and unusable output is reported rather
// than shown as a finished profile.
export function parseProfileRules(content: string, allowedSampleIds: string[]): ParsedProfileRules {
  let data: unknown;
  try { data = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { return { rules: [], gaps: [], dropped: 0, unparsed: true }; }
  const raw = data && typeof data === "object" ? (data as { rules?: unknown }).rules : undefined;
  if (!Array.isArray(raw)) return { rules: [], gaps: [], dropped: 0, unparsed: true };
  const allowed = new Set(allowedSampleIds);
  let dropped = 0;
  const rules: ParsedProfileRules["rules"] = [];
  for (const entry of raw.slice(0, 20)) {
    const item = entry as { text?: unknown; evidenceIds?: unknown; scene?: unknown } | undefined;
    if (!item || typeof item.text !== "string" || !item.text.trim()) continue;
    const requested = (Array.isArray(item.evidenceIds) ? item.evidenceIds : []).filter((id): id is string => typeof id === "string");
    const evidenceIds = requested.filter((id) => allowed.has(id));
    dropped += requested.length - evidenceIds.length;
    rules.push({
      text: item.text.slice(0, 400), evidenceIds,
      ...(SCENES.includes(item.scene as StyleScene) ? { scene: item.scene as StyleScene } : {}),
    });
  }
  const gaps = (Array.isArray((data as { gaps?: unknown }).gaps) ? (data as { gaps: unknown[] }).gaps : [])
    .filter((gap): gap is string => typeof gap === "string").map((gap) => gap.slice(0, 300)).slice(0, 6);
  return { rules, gaps, dropped, unparsed: false };
}

// ------------------------------------------------------- evaluation scaffold
export type EvalArm = "A" | "B" | "C" | "D";
export const EVAL_ARM_LABELS: Record<EvalArm, string> = {
  A: "本书内容 + 作者/作品名", B: "A + 风格描述路线", C: "A + 有证据规则 + 场景匹配样段", D: "C + 一次复核与定向修订",
};

export type EvalScene = { id: string; title: string; originalScene: string; mustHappen: string[] };
export type EvalObservation = { arm: EvalArm; sceneId: string; content: string; requests: number; ms: number; tokens?: number; reviewItems?: number };

// Splits are separated before any tuning, and a set used to fix the method becomes
// a development set that must be replaced before a formal report.
export type EvalPlan = {
  scope: string;
  scenes: EvalScene[];
  arms: EvalArm[];
  conditioningSampleIds: string[];
  calibrationSampleIds: string[];
  evaluationSampleIds: string[];
  realCallsEnabled: boolean;
  budgetCap: number;
  notes: string[];
};

export function buildEvalPlan(input: { scope: string; scenes: EvalScene[]; samples: StyleSample[]; realCallsEnabled: boolean; budgetCap?: number }): EvalPlan {
  const { conditioning, calibration, evaluation } = partitionSamples(input.samples);
  const notes: string[] = [];
  if (input.scenes.length < 8) notes.push(`只有 ${input.scenes.length} 个原创场景，少于建议的 8–12 个：当前只能作为演示，不能作为效果结论。`);
  if (!evaluation.length) notes.push("没有独立评测样段：本轮不能报告独立评测，只能标注“待评价”。");
  if (!input.realCallsEnabled) notes.push("未开启真实模型调用：单测与 mock 不能证明风格效果提升。");
  if ((input.budgetCap ?? 0) <= 0) notes.push("未设置费用上限：真实评测前必须给出可执行上限与断点恢复。");
  return {
    scope: input.scope, scenes: input.scenes, arms: ["A", "B", "C", "D"],
    conditioningSampleIds: conditioning.map((sample) => sample.id),
    calibrationSampleIds: calibration.map((sample) => sample.id),
    evaluationSampleIds: evaluation.map((sample) => sample.id),
    realCallsEnabled: input.realCallsEnabled, budgetCap: Math.max(0, input.budgetCap ?? 0), notes,
  };
}

export type EvalReport = {
  completed: boolean;
  perScene: Array<{ sceneId: string; arms: EvalArm[]; winner: EvalArm | "tie" | "待评价"; rationale: string }>;
  styleWins: Record<EvalArm, number>;
  contentRegressions: number;
  copiedSamples: number;
  notes: string[];
};

// Without human blind evaluation the report stays explicitly "待评价"; auto metrics
// are descriptive only and never a calibrated style-similarity score.
export function summarizeEvalObservations(plan: EvalPlan, observations: EvalObservation[], human?: Array<{ sceneId: string; winner: EvalArm | "tie"; rationale?: string }>): EvalReport {
  const styleWins: Record<EvalArm, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const entry of human ?? []) if (entry.winner !== "tie") styleWins[entry.winner] += 1;
  const perScene = plan.scenes.map((scene) => {
    const humanEntry = human?.find((entry) => entry.sceneId === scene.id);
    const arms = observations.filter((observation) => observation.sceneId === scene.id).map((observation) => observation.arm);
    return {
      sceneId: scene.id, arms,
      winner: humanEntry ? humanEntry.winner : "待评价" as const,
      rationale: humanEntry?.rationale ?? "尚未进行人类盲评",
    };
  });
  const notes: string[] = [];
  if (!human?.length) notes.push("未提供人类盲评结果：风格是否更接近目标仍为“待评价”，不能用自评或 mock 替代。");
  notes.push("自动指标（句长/段长分布、标点与对话比例、内容一致性、原文重合）只作描述性记录，不是绝对风格相似度，也不输出未校准的百分比。");
  return {
    completed: Boolean(human?.length) && plan.realCallsEnabled,
    perScene, styleWins,
    contentRegressions: 0, copiedSamples: 0,
    notes,
  };
}
