"use client";

// The author-facing half of the sample-driven style flow. Everything here is
// already produced by lib/style-fidelity.ts pure functions: importing text is one
// action, the profile is derived from real excerpts, and the review/revise loop is
// bounded. Advanced detail (statistics, evaluation split) stays collapsed so the
// author is not asked to understand the internal data model first.

import { useMemo, useRef, useState } from "react";
import { BookMarked, ChevronDown, FileText, LoaderCircle, Sparkles, Trash2, Upload, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  EVIDENCE_KIND_LABELS, SCENE_LABELS, SPLIT_LABELS, USAGE_BASIS_LABELS, buildSampleDigest, buildStyleProfile,
  dedupeSamples, importTextAsSamples, parseProfileRules, partitionSamples, profileRulesToText,
  type SampleSplit, type StyleEvidenceKind, type StyleProfile, type StyleSample, type SampleUsageBasis,
} from "@/lib/style-fidelity";
import type { AssistRun } from "@/lib/reference-assist";
import type { ReferenceScope } from "./reference-library-dialog";

export type FidelityRunResult = { ok: boolean; note: string; error?: string };

type Props = {
  bookId: string;
  scope: ReferenceScope;
  targetId: string;
  authorRules: string;
  samples: StyleSample[];
  profile: StyleProfile | null;
  run: AssistRun | null;
  onSamplesChange: (next: StyleSample[]) => void;
  onProfileChange: (profile: StyleProfile) => void;
  onGenerateProfile: (prompt: string) => Promise<string>;
  onRun: (payload: { ruleText: string; profile: StyleProfile | null; sceneRange: "selection" | "chapter" }) => Promise<FidelityRunResult>;
};

const KINDS: StyleEvidenceKind[] = ["primary_excerpt", "critical_analysis", "user_approved_output"];
const BASES: SampleUsageBasis[] = ["user_owned", "licensed", "public_domain", "permitted_excerpt", "unknown"];
const SPLITS: SampleSplit[] = ["conditioning", "calibration", "evaluation"];
const MAX_IMPORT_CHARS = 200000;

export function StyleFidelityPanel({
  bookId, targetId, authorRules, samples, profile, run,
  onSamplesChange, onProfileChange, onGenerateProfile, onRun,
}: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  const [locator, setLocator] = useState("");
  const [kind, setKind] = useState<StyleEvidenceKind>("primary_excerpt");
  const [usageBasis, setUsageBasis] = useState<SampleUsageBasis>("unknown");
  const [split, setSplit] = useState<SampleSplit>("conditioning");
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<null | "import" | "profile" | "run">(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const partitions = useMemo(() => partitionSamples(samples), [samples]);
  const evidenceState = profile
    ? `样段增强 · 档案第 ${profile.version} 版 · ${profile.sampleIds.length} 段`
    : samples.length ? `样段增强准备中 · 已导入 ${samples.length} 段，尚未生成档案`
      : "快速建议 · 未使用任何原文样段";

  function applyImport(text: string, sourceTitle: string) {
    if (!text.trim()) { setError("请先粘贴或选择要整理的文本。"); return; }
    if (text.length > MAX_IMPORT_CHARS) { setError("文本超过 20 万字，请分段导入。"); return; }
    const result = importTextAsSamples({
      bookId, targetId, raw: text,
      source: { kind, title: sourceTitle || "未命名导入", locator: locator.trim() || undefined, usageBasis },
      split,
    });
    const merged = dedupeSamples([...samples, ...result.samples]);
    onSamplesChange(merged.kept);
    setNotes([...result.notes, ...(merged.dropped.length ? [`与已有样段重叠，未重复加入 ${merged.dropped.length} 段。`] : [])]);
    setError(result.samples.length ? "" : "没有整理出可用样段，可用快速建议继续。");
    setRaw(""); setTitle(""); setLocator("");
  }

  async function importFromFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(txt|md|json)$/i.test(file.name)) { setError("目前支持 TXT、Markdown 与 JSON。"); return; }
    if (file.size > 4 * 1024 * 1024) { setError("单份文件不能超过 4 MB。"); return; }
    setBusy("import"); setError("");
    try { applyImport(await file.text(), file.name.replace(/\.[^.]+$/, "")); }
    catch { setError(`无法读取 ${file.name}`); }
    finally { setBusy(null); }
  }

  // The profile is built from real excerpts only. Model output is validated: a
  // citation to an unknown or evaluation excerpt is dropped, and unusable output
  // never becomes a finished profile.
  async function generateProfile() {
    const conditioning = partitions.conditioning;
    if (!conditioning.length) { setError("先导入样段才能生成档案；也可以直接用上面的快速建议。"); return; }
    setBusy("profile"); setError(""); setNotes([]);
    try {
      const digest = buildSampleDigest(conditioning, 8000);
      const prompt = [
        "请根据下面这些真实样段，抽取能直接指导写作的表达规则。",
        '只输出 JSON 对象：{"rules":[{"text":"具体规则","evidenceIds":["样段 ID"],"scene":"dialogue|daily|conflict|action|interior|environment|mixed"}],"gaps":["仍无法确认的特点"]}',
        "",
        digest.text,
        "",
        `只能引用这些样段 ID：${digest.sampleIds.join("、")}`,
      ].join("\n");
      const answer = await onGenerateProfile(prompt);
      const parsed = parseProfileRules(answer, digest.sampleIds);
      if (parsed.unparsed) { setError("模型没有返回可解析的档案（JSON 无效或被截断），未生成档案；样段已保留。"); return; }
      const next = buildStyleProfile({
        bookId, targetId, samples,
        scope: { note: "作者整体倾向" },
        modelRules: parsed.rules,
        authorRules,
        previous: profile,
      });
      if (parsed.gaps.length) next.uncertainties.push(...parsed.gaps);
      onProfileChange(next);
      setNotes([
        `已生成档案第 ${next.version} 版：${next.rules.length} 条规则。`,
        parsed.dropped ? `已丢弃 ${parsed.dropped} 处无法核对的样段引用（按模型判断处理）。` : "",
        ...digest.trimming,
      ].filter(Boolean));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成档案失败，样段与分析结果已保留。");
    } finally { setBusy(null); }
  }

  async function runFidelity() {
    if (!profile) { setError("先生成风格档案，才能做复核与精修。快速建议可以直接试写。"); return; }
    setBusy("run"); setError(""); setNotes([]);
    try {
      const result = await onRun({ ruleText: profileRulesToText(profile), profile, sceneRange: "chapter" });
      if (!result.ok) setError(result.error ?? "本次复核未完成，最后一次有效候选已保留。");
      else setNotes([result.note]);
    } finally { setBusy(null); }
  }

  return <section className="assist-plan assist-fidelity-panel" aria-label="样段与风格档案">
    <header>
      <div><strong>证据与风格档案</strong><small>{evidenceState}</small></div>
      <div className="assist-badges">
        {profile ? <span>有证据规则</span> : <span>AI 初步归纳</span>}
        {partitions.evaluation.length ? <span>评测样段 {partitions.evaluation.length} 段已隔离</span> : null}
      </div>
    </header>

    <div className="assist-run">
      <span>默认只有快速建议：不导入样段也能继续，不会声称分析过原作。</span>
      <Button variant="outline" size="sm" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        <ChevronDown />{advanced ? "收起样段与档案" : "导入样段增强（可选）"}
      </Button>
    </div>

    {advanced && <>
      <label className="assist-input"><span>粘贴要参考的文本（会自动清理、按完整段落切分、去重并判断场景）</span>
        <textarea aria-label="样段文本" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="粘贴一段或多段原文，建议 2–5 千字；也可以直接选择文件。" />
      </label>
      <div className="assist-ident">
        <label><span>来源标题</span><input aria-label="样段来源标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如《活着》" /></label>
        <label><span>位置（可选）</span><input aria-label="样段位置" value={locator} onChange={(event) => setLocator(event.target.value)} placeholder="章节或页码" /></label>
        <label><span>来源类型</span><NativeSelect aria-label="样段来源类型" value={kind} onChange={(event) => setKind(event.target.value as StyleEvidenceKind)}>{KINDS.map((value) => <NativeSelectOption key={value} value={value}>{EVIDENCE_KIND_LABELS[value]}</NativeSelectOption>)}</NativeSelect></label>
        <label><span>使用依据</span><NativeSelect aria-label="样段使用依据" value={usageBasis} onChange={(event) => setUsageBasis(event.target.value as SampleUsageBasis)}>{BASES.map((value) => <NativeSelectOption key={value} value={value}>{USAGE_BASIS_LABELS[value]}</NativeSelectOption>)}</NativeSelect></label>
        <label><span>分组</span><NativeSelect aria-label="样段分组" value={split} onChange={(event) => setSplit(event.target.value as SampleSplit)}>{SPLITS.map((value) => <NativeSelectOption key={value} value={value}>{SPLIT_LABELS[value]}</NativeSelectOption>)}</NativeSelect></label>
      </div>
      <div className="assist-actions">
        <Button variant="outline" disabled={busy !== null || !raw.trim()} onClick={() => { setBusy("import"); try { applyImport(raw, title); } finally { setBusy(null); } }}>
          {busy === "import" ? <LoaderCircle className="spin" /> : <Upload />}整理并加入样段库
        </Button>
        <Button variant="ghost" onClick={() => fileInput.current?.click()}><FileText />选择文件</Button>
        <input ref={fileInput} type="file" accept=".txt,.md,.json" className="assist-file" onChange={(event) => { void importFromFile(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <p className="reference-source-note">来源类型与使用依据由你标注，不会被当作已核验的作者身份或版权证明；没有真正取得原文的内容不会算作 primary_excerpt。</p>

      {samples.length > 0 && <div className="assist-sample-list">
        <strong>样段库 · {samples.length} 段（条件 {partitions.conditioning.length} / 校准 {partitions.calibration.length} / 评测 {partitions.evaluation.length}）</strong>
        {samples.slice(0, 12).map((sample) => <div className="assist-sample-row" key={sample.id}>
          <span>{sample.source.title || "未命名"}<small>{sample.source.locator ? ` · ${sample.source.locator}` : ""} · {sample.sceneTags.map((tag) => SCENE_LABELS[tag]).join("、")} · {sample.charCount} 字</small></span>
          <NativeSelect aria-label={`样段分组 ${sample.id}`} value={sample.split} onChange={(event) => onSamplesChange(samples.map((entry) => entry.id === sample.id ? { ...entry, split: event.target.value as SampleSplit } : entry))}>
            {SPLITS.map((value) => <NativeSelectOption key={value} value={value}>{SPLIT_LABELS[value]}</NativeSelectOption>)}
          </NativeSelect>
          <Button variant="ghost" size="icon" aria-label={`删除样段 ${sample.id}`} onClick={() => onSamplesChange(samples.filter((entry) => entry.id !== sample.id))}><Trash2 /></Button>
        </div>)}
        {samples.length > 12 && <small>仅显示前 12 段，其余已保存。</small>}
        <small>整本书在同一份正文里时，评测分组只用于将来对照，不参与规则、选样与生成。</small>
      </div>}

      <div className="assist-actions">
        <Button disabled={busy !== null || !partitions.conditioning.length} onClick={() => void generateProfile()}>
          {busy === "profile" ? <LoaderCircle className="spin" /> : <Sparkles />}生成 / 更新风格档案
        </Button>
        <span className="assist-footnote">档案只从条件样段提取，引用会标出样段 ID。</span>
      </div>

      {profile && <div className="assist-rules">
        <strong>档案第 {profile.version} 版 · {profile.rules.length} 条规则（可编辑）</strong>
        <ol>{profile.rules.slice(0, 10).map((rule, index) => <li key={rule.id}>
          <textarea aria-label={`档案规则 ${index + 1}`} value={rule.text}
            onChange={(event) => onProfileChange({ ...profile, rules: profile.rules.map((entry) => entry.id === rule.id ? { ...entry, text: event.target.value } : entry), derivedStale: true })} />
          <small>{rule.evidenceIds.length ? `证据：${rule.evidenceIds.join("、")}` : rule.origin === "model_prior" ? "模型判断，无实证" : ""}</small>
        </li>)}</ol>
      </div>}

      {profile?.stats && <details className="assist-stats">
        <summary>机械统计与口径（{profile.stats.samples} 段 / {profile.stats.hanChars} 汉字）</summary>
        <ul>
          <li>句长：中位数 {profile.stats.sentence.p50} 字，90 分位 {profile.stats.sentence.p90} 字，最长 {profile.stats.sentence.max} 字</li>
          <li>段长：中位数 {profile.stats.paragraph.p50} 字，90 分位 {profile.stats.paragraph.p90} 字</li>
          <li>对话段比例：{Math.round(profile.stats.dialogueParagraphRatio * 100)}%</li>
          {profile.stats.basis.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </details>}

      {profile && profile.uncertainties.length > 0 && <ul className="assist-caveat" role="status">{profile.uncertainties.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>}
    </>}

    <div className="assist-actions">
      <Button variant="outline" disabled={busy !== null || !profile} onClick={() => void runFidelity()}>
        {busy === "run" ? <LoaderCircle className="spin" /> : <WandSparkles />}复核并精修一次
      </Button>
      <span className="assist-footnote">先复核；只在发现主要问题时修订一次，最多调用 3 次，不会自动改正文。</span>
    </div>

    {run && <div className="assist-stage" role="status">
      <strong>运行状态：{stageLabel(run.stage)}</strong>
      <small>{run.note}{run.profileVersion ? ` · 档案第 ${run.profileVersion} 版` : ""}{run.sampleManifest.length ? ` · 样段 ${run.sampleManifest.length} 段` : ""}{run.revisions ? ` · 已修订 ${run.revisions} 次` : ""}{run.reviewed ? " · 已复核" : " · 未完成复核"}</small>
    </div>}

    {notes.map((note) => <p className="reference-source-note" role="status" key={note}>{note}</p>)}
    {error && <p className="reference-error" role="alert">{error}</p>}
    <p className="assist-footnote"><BookMarked />收藏参考与应用为本书文风是两件事；档案是派生显示，正式文风仍以「文笔文风」的文本为准。</p>
  </section>;
}

function stageLabel(stage: AssistRun["stage"]): string {
  if (stage === "generating") return "正在生成候选";
  if (stage === "reviewing") return "正在复核";
  if (stage === "revising") return "正在做一次定向修订";
  if (stage === "done") return "已完成";
  if (stage === "interrupted") return "上次中断（未自动重试）";
  if (stage === "failed") return "未完成";
  return "待开始";
}
