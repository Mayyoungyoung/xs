"use client";

import { useEffect, useRef, useState } from "react";
import { BookMarked, Check, FileText, Globe2, LoaderCircle, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export type ReferenceScope = "plot" | "character" | "style" | "world";
export type ReferenceItem = {
  id: string;
  title: string;
  kind: string;
  summary: string;
  source: string;
  url?: string;
  scope: ReferenceScope;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ReferenceScope;
  selected: ReferenceItem[];
  onAdd: (reference: ReferenceItem) => void;
};

const scopeNames: Record<ReferenceScope, string> = { plot: "剧情结构", character: "人物设定", style: "文风指纹", world: "世界观" };

export function ReferenceLibraryDialog({ open, onOpenChange, scope, selected, onAdd }: Props) {
  const [mode, setMode] = useState<"search" | "local">("search");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(scope === "character" ? "character" : scope === "style" ? "author" : "novel");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ReferenceItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setKind(scope === "character" ? "character" : scope === "style" ? "author" : "novel");
    setResults([]);
  }, [scope]);

  async function searchReferences() {
    if (!query.trim()) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/references/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, kind }) });
      const data = await response.json() as { results?: Omit<ReferenceItem, "scope">[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "检索失败");
      setResults((data.results ?? []).map((item) => ({ ...item, scope })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法检索");
    } finally { setLoading(false); }
  }

  async function loadFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    for (const file of Array.from(files)) {
      if (!/\.(txt|md|json)$/i.test(file.name)) { setError("目前支持 TXT、Markdown 与 JSON 文本资料。"); continue; }
      const text = (await file.text()).slice(0, 60000);
      const reference: ReferenceItem = { id: `local-${file.name}-${file.lastModified}`, title: file.name.replace(/\.[^.]+$/, ""), kind: "local", summary: text, source: "本地文件", scope };
      onAdd(reference);
      setResults((items) => [reference, ...items.filter((item) => item.id !== reference.id)]);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="reference-dialog sm:max-w-[760px]">
      <DialogHeader>
        <DialogTitle>添加{scopeNames[scope]}借鉴</DialogTitle>
        <DialogDescription>检索公开简介，或加载你自己的文本。模型只提取结构与可描述特征，不复制原文。</DialogDescription>
      </DialogHeader>
      <div className="reference-mode-tabs">
        <button className={mode === "search" ? "active" : ""} onClick={() => setMode("search")}><Globe2 size={16} />自己检索</button>
        <button className={mode === "local" ? "active" : ""} onClick={() => setMode("local")}><Upload size={16} />本地加载</button>
      </div>
      {mode === "search" ? <>
        <div className="reference-search-row">
          <NativeSelect value={kind} onChange={(event) => setKind(event.target.value)} aria-label="借鉴类型">
            <NativeSelectOption value="novel">指定小说</NativeSelectOption><NativeSelectOption value="genre">小说类型</NativeSelectOption>
            <NativeSelectOption value="character">指定人物</NativeSelectOption><NativeSelectOption value="author">作家</NativeSelectOption><NativeSelectOption value="work">作品风格</NativeSelectOption>
          </NativeSelect>
          <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchReferences()} placeholder="例如：诡秘之主、群像仙侠、王熙凤、汪曾祺……" /></label>
          <Button onClick={searchReferences} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />}检索</Button>
        </div>
        {error && <div className="reference-error">{error}</div>}
        <div className="reference-results">
          {results.length === 0 && !loading && <div className="reference-empty"><BookMarked /><strong>建立自己的借鉴库</strong><p>搜索作品、类型、人物或作家，结果会作为生成时的结构参考。</p></div>}
          {results.map((result) => { const added = selected.some((item) => item.id === result.id); return <article key={result.id}>
            <div className="reference-result-icon">{result.source === "本地文件" ? <FileText /> : <BookMarked />}</div>
            <div><div className="reference-result-title"><strong>{result.title}</strong><span>{result.source}</span></div><p>{result.summary.slice(0, 190) || "暂无摘要"}</p></div>
            <Button variant={added ? "secondary" : "outline"} size="sm" disabled={added} onClick={() => onAdd(result)}>{added ? <><Check />已加入</> : "加入借鉴"}</Button>
          </article>; })}
        </div>
      </> : <div className="local-upload" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void loadFiles(event.dataTransfer.files); }}>
        <input ref={fileInput} type="file" accept=".txt,.md,.json" multiple onChange={(event) => loadFiles(event.target.files)} />
        <div className="upload-orb"><Upload /></div><strong>选择或拖入你的资料</strong><p>支持 TXT、Markdown、JSON；内容只在你主动生成时发送给所选模型。</p><Button variant="outline">选择文件</Button>
        {error && <div className="reference-error">{error}</div>}
      </div>}
      <div className="reference-dialog-foot"><span>已选 {selected.filter((item) => item.scope === scope).length} 项 · 建议每次使用 1–3 项</span><Button onClick={() => onOpenChange(false)}>完成</Button></div>
    </DialogContent>
  </Dialog>;
}
