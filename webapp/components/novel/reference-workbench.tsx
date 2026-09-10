"use client";

import { useState } from "react";
import { BookMarked, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReferenceItem, ReferenceScope } from "./reference-library-dialog";

const scopes: Array<{ id: ReferenceScope; label: string }> = [{ id: "plot", label: "剧情" }, { id: "world", label: "世界观" }, { id: "character", label: "人物" }, { id: "style", label: "文风" }];
export function ReferenceWorkbench({ title, references, onAdd, onRemove }: { title: string; references: ReferenceItem[]; onAdd: (scope: ReferenceScope) => void; onRemove: (item: ReferenceItem) => void }) {
  const [scope, setScope] = useState<ReferenceScope | "all">("all");
  const visible = references.filter((item) => scope === "all" || item.scope === scope);
  return <div className="reference-workbench"><div className="page-heading"><div><div className="eyebrow">{title} / 创作资料</div><h1>借鉴库</h1><p>管理本书使用的参考资料与可借鉴的创作方法。</p></div><Button onClick={() => onAdd(scope === "all" ? "plot" : scope)}><Plus />添加借鉴</Button></div><div className="reference-filters" aria-label="借鉴分类">{[{ id: "all" as const, label: "全部" }, ...scopes].map((item) => <Button key={item.id} variant={scope === item.id ? "default" : "outline"} aria-pressed={scope === item.id} onClick={() => setScope(item.id)}>{item.label}<span>{references.filter((reference) => item.id === "all" || item.id === reference.scope).length}</span></Button>)}</div>
    {visible.length ? <div className="reference-library-grid">{visible.map((item) => <article key={`${item.scope}-${item.id}`}><header><span>{scopes.find((entry) => entry.id === item.scope)?.label}</span><Button variant="ghost" size="icon" aria-label={`移除借鉴 ${item.title}`} onClick={() => onRemove(item)}><Trash2 /></Button></header><h2>{item.title}</h2><small>{item.kind} · {item.source}</small><p>{item.summary || "暂无借鉴笔记"}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</article>)}</div> : <div className="reference-library-empty"><BookMarked /><h2>还没有{scope === "all" ? "" : scopes.find((item) => item.id === scope)?.label}借鉴资料</h2><p>添加作品、搜索资料或导入本地摘记，作为本书的创作参考。</p><Button variant="outline" onClick={() => onAdd(scope === "all" ? "plot" : scope)}><Plus />选择参考资料</Button></div>}
  </div>;
}
