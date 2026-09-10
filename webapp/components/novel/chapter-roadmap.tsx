"use client";

import { Check, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chapterPlan, eventLines, eventStatus } from "@/lib/story-roadmap";
import { withSnapshot, type BookWorkspace } from "./book-workspace";

export function ChapterRoadmap({ workspace, busy, onChange }: { workspace: BookWorkspace; busy: boolean; onChange: (change: (current: BookWorkspace) => BookWorkspace) => void }) {
  const plan = chapterPlan(workspace);
  if (!plan.roadmap.lines.length) return <div className="chapter-route-empty"><GitBranch /><p>还没有世界线。先在「世界线」安排主支线，就可以让本章沿着指定事件推进。</p></div>;
  function bind(ids?: string[]) { onChange((current) => ({ ...current, chapters: current.chapters.map((chapter) => chapter.id === plan.chapter.id ? { ...chapter, plotEventIds: ids } : chapter) })); }
  function finish() {
    if (busy || !plan.chapter.content.trim() || !plan.events.length || plan.missing.length) return;
    onChange((current) => {
      const selected = chapterPlan(current);
      return { ...withSnapshot(current, "确认本章剧情已写完前"), chapters: current.chapters.map((chapter) => chapter.id === selected.chapter.id ? { ...chapter, plotEventIds: selected.ids } : chapter), plot: { ...current.plot, version: current.plot.version + 1, roadmap: { ...selected.roadmap, events: selected.roadmap.events.map((event) => selected.ids.includes(event.id) ? { ...event, status: "done" } : event) } } };
    });
  }
  return <section className="chapter-roadmap" aria-label="本章剧情安排"><header><div><GitBranch /><h2>本章推进哪些剧情</h2></div><span>{plan.manual ? "已指定事件" : "按世界线推荐，可调整"}</span></header>
    {plan.events.length ? <div className="chapter-route-targets">{plan.events.map((event) => <article key={event.id}><strong>{event.title}</strong><span>{eventLines(plan.roadmap, event.id).map((line) => line.title).join(" × ")} · {eventStatus[event.status]}</span><p>{event.note || "请在世界线中补充事件的选择与后果。"}</p></article>)}</div> : <p>尚未安排推进事件，可从下方选择。AI 不会自行写完整条世界线。</p>}
    {plan.missing.length > 0 && <p role="alert" className="ai-error">原来绑定的事件已被新版世界线替换，请重新选择本章事件后生成。</p>}
    {plan.earlier.length > 0 && <p className="chapter-route-warning">前置事件尚未标为已写完：{plan.earlier.map((event) => event.title).join("、")}。请确认前文已交代，或在生成要求中说明跳叙安排。</p>}
    <details className="chapter-route-picker"><summary>调整本章事件（可多选）</summary>{plan.roadmap.events.slice().sort((a, b) => a.order - b.order).map((event) => <label key={event.id}><input type="checkbox" disabled={busy} checked={plan.ids.includes(event.id)} onChange={(change) => bind(change.target.checked ? [...plan.ids.filter((id) => !plan.missing.includes(id)), event.id] : plan.ids.filter((id) => id !== event.id && !plan.missing.includes(id)))} /><span><strong>{event.title}</strong><small>{eventLines(plan.roadmap, event.id).map((line) => line.title).join(" / ")} · {event.chapter} · {eventStatus[event.status]}</small></span></label>)}<Button variant="outline" size="sm" disabled={busy} onClick={() => bind(undefined)}>恢复推荐安排</Button></details>
    <footer><span>生成只推进本章目标，后续事件作为计划保留。</span><Button variant="outline" disabled={busy || !plan.chapter.content.trim() || !plan.events.length || Boolean(plan.missing.length) || plan.events.every((event) => event.status === "done")} onClick={finish}><Check />确认本章事件已写完</Button></footer>
  </section>;
}
