"use client";

// The style-workspace half of the flow: the author names a target (an author,
// a work or a custom label), gets a profile card per target, switches which one
// the book writes with, and edits the selected profile through the fidelity
// panel. The active profile is read directly at generation time, so edits apply
// immediately — there is no "apply then resync" step.

import { useState } from "react";
import { Check, Feather, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appendProfileVersion, buildStyleProfile, profileDisplayName, type StyleProfile } from "@/lib/style-fidelity";
import { stableHash } from "@/lib/reference-assist";
import type { BookWorkspace } from "./book-workspace";
import { StyleFidelityPanel, type FidelityRunResult } from "./style-fidelity-panel";
import type { AssistRun } from "@/lib/reference-assist";

type Props = {
  bookId: string;
  workspace: BookWorkspace;
  onWorkspaceChange: (patch: Partial<BookWorkspace> | ((w: BookWorkspace) => BookWorkspace)) => void;
  onGenerateProfile: (prompt: string) => Promise<string>;
  onFidelityRun: (payload: { ruleText: string; profile: StyleProfile | null; sceneRange: "selection" | "chapter" }) => Promise<FidelityRunResult>;
  onNotify: (message: string) => void;
};

export function StyleProfileManager({ bookId, workspace, onWorkspaceChange, onGenerateProfile, onFidelityRun, onNotify }: Props) {
  const [author, setAuthor] = useState("");
  const [work, setWork] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const profiles = Object.values(workspace.styleProfiles).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeId = workspace.activeStyleProfileId;
  const selected = workspace.styleProfiles[selectedId || activeId] ?? profiles[0] ?? null;
  const run: AssistRun | null = workspace.referenceAssist.style?.run ?? null;

  function createProfile() {
    const scopeAuthor = author.trim();
    const scopeWork = work.trim();
    const scopeNote = note.trim();
    if (!scopeAuthor && !scopeWork && !scopeNote) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const id = `profile-${stableHash(`${bookId}|${scopeAuthor}|${scopeWork}|${scopeNote}`)}`;
      const profile = buildStyleProfile({
        bookId, targetId: id, samples: [],
        scope: { author: scopeAuthor, work: scopeWork, note: scopeNote },
        authorRules: workspace.assets.style ?? "",
        now,
      });
      onWorkspaceChange((w) => ({
        ...w,
        styleProfiles: { ...w.styleProfiles, [profile.id]: profile },
        styleProfileHistory: { ...w.styleProfileHistory, [profile.id]: appendProfileVersion(w.styleProfileHistory[profile.id] ?? [], profile) },
        activeStyleProfileId: w.activeStyleProfileId || profile.id,
      }));
      setSelectedId(profile.id);
      setAuthor(""); setWork(""); setNote("");
      onNotify(`已创建文风配置「${profileDisplayName(profile)}」，可粘贴原文或手写规则`);
    } finally { setBusy(false); }
  }

  function removeProfile(id: string) {
    const profile = workspace.styleProfiles[id];
    if (!profile || !window.confirm(`删除文风配置「${profileDisplayName(profile)}」？其样段会保留，不会影响正文。`)) return;
    onWorkspaceChange((w) => {
      const nextProfiles = { ...w.styleProfiles };
      delete nextProfiles[id];
      const remaining = Object.keys(nextProfiles);
      return {
        ...w,
        styleProfiles: nextProfiles,
        activeStyleProfileId: w.activeStyleProfileId === id ? (remaining.length === 1 ? remaining[0] : "") : w.activeStyleProfileId,
      };
    });
    if (selectedId === id) setSelectedId("");
  }

  return <section className="style-profile-manager" aria-label="文风配置">
    <header>
      <div><strong><Feather />文风配置</strong><small>按作者或作品建立可编辑的文风配置，生成正文时直接生效。</small></div>
      {activeId && workspace.styleProfiles[activeId] ? <span className="style-profile-active-tag"><Check />正在使用「{profileDisplayName(workspace.styleProfiles[activeId])}」</span> : <span className="style-profile-active-tag is-off">未启用任何文风配置</span>}
    </header>

    <div className="style-profile-create">
      <label><span>作者</span><input aria-label="目标作者" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={200} placeholder="例如：金庸" /></label>
      <label><span>作品（可选）</span><input aria-label="目标作品" value={work} onChange={(event) => setWork(event.target.value)} maxLength={200} placeholder="例如：天龙八部" /></label>
      <label><span>或自定义名称</span><input aria-label="自定义文风名称" value={note} onChange={(event) => setNote(event.target.value)} maxLength={400} placeholder="例如：冷硬侦探风" /></label>
      <Button disabled={busy || (!author.trim() && !work.trim() && !note.trim())} onClick={createProfile}>
        {busy ? <LoaderCircle className="spin" /> : <Plus />}新建文风配置
      </Button>
    </div>
    <p className="reference-source-note">没有样段也能用：新建后直接手写规则即可。想让文风更接近目标作者，建议粘贴 2–5 千字原文让系统自动提取。</p>

    {profiles.length > 0 && <div className="style-profile-list">
      {profiles.map((profile) => <div key={profile.id} className={`style-profile-card ${profile.id === activeId ? "is-active" : ""} ${profile.id === selected?.id ? "is-selected" : ""}`}>
        <button className="style-profile-card-main" onClick={() => setSelectedId(profile.id)}>
          <strong>{profileDisplayName(profile)}</strong>
          <small>第 {profile.version} 版 · {profile.sampleIds.length} 段样段 · {profile.rules.length} 条规则{profile.derivedStale ? " · 已手改" : ""}</small>
        </button>
        {profile.id === activeId
          ? <span className="style-profile-badge"><Check />生效中</span>
          : <Button variant="outline" size="sm" onClick={() => { onWorkspaceChange({ activeStyleProfileId: profile.id }); onNotify(`生成正文将使用「${profileDisplayName(profile)}」的文风`); }}><Sparkles />设为生效</Button>}
        <Button variant="ghost" size="icon" aria-label={`删除文风配置 ${profileDisplayName(profile)}`} onClick={() => removeProfile(profile.id)}><Trash2 /></Button>
      </div>)}
    </div>}

    {selected ? <StyleFidelityPanel
      bookId={bookId}
      profile={selected}
      authorRules={workspace.assets.style ?? ""}
      samples={workspace.styleSamples.filter((sample) => sample.targetId === selected.targetId)}
      run={run}
      onSamplesChange={(next) => onWorkspaceChange((w) => ({
        ...w,
        styleSamples: [...w.styleSamples.filter((sample) => sample.targetId !== selected.targetId), ...next],
      }))}
      onProfileChange={(profile) => onWorkspaceChange((w) => ({
        ...w,
        styleProfiles: { ...w.styleProfiles, [profile.id]: profile },
        styleProfileHistory: { ...w.styleProfileHistory, [profile.id]: appendProfileVersion(w.styleProfileHistory[profile.id] ?? [], profile) },
      }))}
      onGenerateProfile={onGenerateProfile}
      onRun={onFidelityRun}
    /> : <p className="reference-source-note">还没有文风配置。在上面输入作者或作品名新建一个，例如「金庸」。</p>}
  </section>;
}
