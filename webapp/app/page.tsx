"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Aperture, BookMarked, BookOpen, Box, Check, ChevronDown, CircleUserRound, Clock3, Cpu,
  Feather, GitBranch, LayoutDashboard, Library, LoaderCircle, MessageCircleMore,
  MoreHorizontal, Network, PanelRightClose, Plus, Search, Settings2,
  Sparkles, WandSparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PlotWorkbench } from "@/components/novel/plot-workbench";
import { ReferenceLibraryDialog, type ReferenceItem, type ReferenceScope } from "@/components/novel/reference-library-dialog";

const navGroups = [
  { label: "故事设计", items: [
    { id: "overview", label: "故事蓝图", icon: LayoutDashboard, badge: "" },
    { id: "world", label: "世界观", icon: Box, badge: "1" },
    { id: "characters", label: "人物角色", icon: CircleUserRound, badge: "6" },
    { id: "timeline", label: "世界线", icon: Network, badge: "" },
    { id: "plot", label: "主线与支线", icon: GitBranch, badge: "4" },
    { id: "style", label: "文笔文风", icon: Feather, badge: "" },
    { id: "references", label: "借鉴库", icon: BookMarked, badge: "" },
  ]},
  { label: "开始写作", items: [
    { id: "outline", label: "卷章大纲", icon: Library, badge: "36" },
    { id: "chapters", label: "章节正文", icon: BookOpen, badge: "12" },
  ]},
];

const chapterSteps = [
  { no: "01", title: "雨夜归乡", note: "异象出现 · 主角受命返乡", status: "已完成" },
  { no: "02", title: "井下有声", note: "发现旧井与失踪案相关", status: "已完成" },
  { no: "03", title: "无名来客", note: "沈青霜首次登场", status: "进行中" },
  { no: "04", title: "禁山灯火", note: "支线与主线第一次交汇", status: "待设计" },
];

const firstMessages = [
  { role: "ai", text: "我已经读过当前蓝图。世界规则很有辨识度，但主角为什么非要回到雾隐镇，还缺一个更私人的理由。" },
  { role: "ai", text: "可以把母亲留下的残卷改成一封会随月相改变内容的信。这样既连到主线，也能持续制造章节钩子。要我把这个变化同步到世界观、人物动机和前三章吗？" },
];

export default function Home() {
  const [active, setActive] = useState("overview");
  const [idea, setIdea] = useState("一个能听见旧物记忆的落魄修复师，回到被大雾封锁的故乡，发现所有人都在忘记同一天。");
  const [messages, setMessages] = useState(firstMessages);
  const [chat, setChat] = useState("");
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");
  const [rightOpen, setRightOpen] = useState(true);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceScope, setReferenceScope] = useState<ReferenceScope>("plot");
  const [aiError, setAiError] = useState("");
  const currentLabel = useMemo(() => navGroups.flatMap((group) => group.items).find((item) => item.id === active)?.label, [active]);

  useEffect(() => {
    const modelContext = (document as Document & {
      modelContext?: {
        registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(modelContext.registerTool({
      name: "update_story_seed",
      title: "更新故事种子",
      description: "替作者更新当前小说的一句话故事构想，并同步到页面中的故事蓝图输入框。",
      inputSchema: {
        type: "object",
        properties: { idea: { type: "string", minLength: 2, description: "新的故事构想" } },
        required: ["idea"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input: unknown) {
        const nextIdea = (input as { idea?: unknown })?.idea;
        if (typeof nextIdea !== "string" || nextIdea.trim().length < 2) {
          throw new Error("故事构想至少需要两个字");
        }
        setIdea(nextIdea.trim());
        return { status: "updated", idea: nextIdea.trim() };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("momai-references");
      if (saved) setReferences(JSON.parse(saved) as ReferenceItem[]);
    } catch { /* local reference cache is optional */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("momai-references", JSON.stringify(references));
  }, [references]);

  function openReferences(scope: ReferenceScope) {
    setReferenceScope(scope);
    setReferenceOpen(true);
  }

  function addReference(reference: ReferenceItem) {
    setReferences((items) => items.some((item) => item.id === reference.id && item.scope === reference.scope) ? items : [...items, reference]);
    notify(`已加入借鉴：${reference.title}`);
  }

  async function askAI(prompt: string, task = "chat") {
    setAiError("");
    const scope: ReferenceScope = task === "plot_update" ? "plot" : active === "characters" ? "character" : active === "style" ? "style" : active === "world" ? "world" : "plot";
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        prompt,
        model,
        context: `书名：灵脉残卷\n核心设想：${idea}\n当前页面：${currentLabel}`,
        references: references.filter((item) => item.scope === scope),
      }),
    });
    const data = await response.json() as { content?: string; error?: string };
    if (!response.ok || !data.content) {
      const message = data.error ?? "生成失败，请稍后再试。";
      setAiError(message);
      throw new Error(message);
    }
    return data.content;
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function enrichIdea() {
    setGenerating(true);
    try {
      const content = await askAI(idea, "story_seed");
      setIdea(content);
      setMessages((value) => [...value, { role: "ai", text: "故事种子已经按当前设定和借鉴资料重新完善。你可以继续指出要保留或删掉的部分。" }]);
      notify("故事种子已完善，并标记了 3 处可同步更新");
    } catch { /* error is shown beside the composer */ } finally { setGenerating(false); }
  }

  async function sendMessage() {
    const value = chat.trim();
    if (!value) return;
    setMessages((items) => [...items, { role: "user", text: value }]);
    setChat("");
    setGenerating(true);
    try {
      const task = active === "plot" ? "plot_update" : active === "characters" ? "character_design" : active === "style" ? "style_fingerprint" : "chat";
      const content = await askAI(value, task);
      setMessages((items) => [...items, { role: "ai", text: content }]);
    } catch { /* surfaced in the UI */ } finally { setGenerating(false); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span>墨</span></div>
        <div className="brand-name">墨脉 <em>AI 小说工作台</em></div>
        <button className="book-switcher" onClick={() => notify("书籍切换器已打开")}>
          <span className="book-dot">灵</span><span><strong>灵脉残卷</strong><small>玄幻悬疑 · 创作中</small></span><ChevronDown size={16} />
        </button>
        <div className="top-actions">
          <div className="model-picker"><Cpu size={15} /><NativeSelect value={model} onChange={(event) => setModel(event.target.value)} size="sm" aria-label="生成模型">
            <NativeSelectOption value="deepseek-v4-flash">DeepSeek V4 Flash</NativeSelectOption>
            <NativeSelectOption value="deepseek-v4-pro">DeepSeek V4 Pro</NativeSelectOption>
          </NativeSelect></div>
          <button className="icon-button" aria-label="搜索"><Search size={18} /></button>
          <button className="icon-button" aria-label="设置"><Settings2 size={18} /></button>
          <div className="save-state"><Check size={14} /> 已保存</div><button className="avatar">砚</button>
        </div>
      </header>

      <div className={`workspace ${rightOpen ? "" : "right-closed"}`}>
        <aside className="leftbar">
          <div className="progress-block">
            <div className="progress-label"><span>创作准备度</span><strong>72%</strong></div><div className="progress-track"><span /></div>
            <p>再完善人物关系，就可以稳定生成正文</p>
          </div>
          <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => item.id === "references" ? openReferences("plot") : setActive(item.id)}>
              <Icon size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}
            </button>; })}
          </div>)}</nav>
          <div className="memory-card"><div><Aperture size={16} /><strong>故事记忆</strong><span>健康</span></div><p>已记住 28 条设定、17 个伏笔与 12 章剧情。</p></div>
        </aside>

        <section className="canvas"><div className={active === "plot" ? "canvas-inner plot-canvas-inner" : "canvas-inner"}>
          {active === "plot" ? <PlotWorkbench references={references} onOpenReferences={() => openReferences("plot")} onGenerate={askAI} /> : <>
          <div className="page-heading">
            <div><div className="eyebrow">灵脉残卷 / {currentLabel}</div><h1>故事蓝图</h1><p>先把故事想清楚，再让每一章稳定地长出来。</p></div>
            <div className="heading-actions">
              <Button variant="outline" className="soft-button" onClick={() => notify("已生成当前蓝图的版本快照")}><Clock3 />版本记录</Button>
              <Button className="ink-button" onClick={() => notify("开始生成第一卷大纲")}><WandSparkles />生成卷章大纲</Button>
            </div>
          </div>

          <section className="idea-card">
            <div className="idea-title"><Sparkles size={17} /><span>从一句话开始</span><em>AI 会补全冲突、代价与成长空间</em></div>
            <Textarea aria-label="故事创意" value={idea} onChange={(event) => setIdea(event.target.value)} className="idea-input" />
            <div className="idea-footer"><div className="chips"><button>玄幻悬疑 <X size={12} /></button><button>克制感情线 <X size={12} /></button><button className="add-chip"><Plus size={13} /> 添加偏好</button></div>
              <Button className="magic-button" onClick={enrichIdea} disabled={generating}><Sparkles />{generating ? "正在推演…" : "让 AI 完善"}</Button>
            </div>
          </section>

          <div className="section-heading"><div><h2>你的故事骨架</h2><p>所有内容都可直接编辑，也可以让 AI 提出方案。</p></div><button className="quiet-link" onClick={() => notify("已检查：发现 2 个可增强项")}>检查完整度</button></div>

          <div className="blueprint-grid">
            <article className="blueprint-card world-card">
              <div className="card-kicker"><Box size={16} />世界内核<button className="reference-chip" onClick={() => openReferences("world")}><BookMarked />添加借鉴</button></div><h3>记忆是一种会被消耗的实体</h3>
              <p>雾隐镇以“遗忘”向山神换取平静。每件旧物都封存着被献祭的记忆，而顾沉舟是唯一能听见它们的人。</p>
              <div className="rule-list"><span><i>01</i>读取越深，遗忘越重要</span><span><i>02</i>同一段记忆不能被听见两次</span><span><i>03</i>大雾之外的人会逐渐忘记小镇</span></div>
              <button className="card-action" onClick={() => setActive("world")}>展开世界观 <span>→</span></button>
            </article>
            <article className="blueprint-card character-card">
              <div className="card-kicker"><CircleUserRound size={16} />核心人物<button className="reference-chip" onClick={() => openReferences("character")}><BookMarked />人物借鉴</button></div>
              <div className="character-main"><div className="portrait portrait-one">顾</div><div><h3>顾沉舟</h3><small>主角 · 旧物修复师</small></div><button aria-label="更多人物操作"><MoreHorizontal size={18} /></button></div>
              <div className="motive"><small>想要</small><p>找回母亲失踪的真相</p></div><div className="motive"><small>害怕</small><p>真相证明自己才是灾难源头</p></div>
              <div className="portraits"><div className="portrait portrait-two">沈</div><div className="portrait portrait-three">祁</div><div className="portrait portrait-four">闻</div><div className="portrait portrait-five">+</div></div>
              <button className="card-action" onClick={() => setActive("characters")}>查看关系与弧光 <span>→</span></button>
            </article>
            <article className="blueprint-card timeline-card">
              <div className="card-kicker"><GitBranch size={16} />主线推进<button className="reference-chip" onClick={() => openReferences("plot")}><BookMarked />剧情借鉴</button></div>
              <div className="timeline-line">{chapterSteps.map((step, index) => <div className="timeline-step" key={step.no}><div className={`step-node ${index < 2 ? "complete" : index === 2 ? "current" : ""}`}>{index < 2 ? <Check size={13} /> : step.no}</div><div><h4>{step.title}</h4><p>{step.note}</p></div><small>{step.status}</small></div>)}</div>
              <button className="card-action" onClick={() => setActive("plot")}>打开情节编排板 <span>→</span></button>
            </article>
            <article className="blueprint-card style-card">
              <div className="card-kicker"><Feather size={16} />文风指纹<button className="reference-chip" onClick={() => openReferences("style")}><BookMarked />文风借鉴</button></div>
              <blockquote>“雨落在铜铃上，没有响。顾沉舟却听见了七年前，那扇门合拢的声音。”</blockquote>
              <div className="style-tags"><span>短句推进</span><span>冷色意象</span><span>有限视角</span><span>留白悬念</span></div>
              <div className="style-source"><span>参考方向</span><strong>中式志怪的幽微感 × 现代悬疑的紧迫感</strong></div>
              <button className="card-action" onClick={() => setActive("style")}>调校文风 <span>→</span></button>
            </article>
          </div>
          </>}
        </div></section>

        <aside className="copilot">
          <div className="copilot-head"><div><span className="ai-orb"><Sparkles size={16} /></span><strong>共创助手</strong><i>在线</i></div><button aria-label="收起助手" onClick={() => setRightOpen(false)}><PanelRightClose size={18} /></button></div>
          <div className="context-strip"><span>正在讨论</span><strong>{currentLabel}</strong><em>{model === "deepseek-v4-flash" ? "V4 Flash" : "V4 Pro"}</em><button onClick={() => setMessages([])}>清空</button></div>
          <div className="messages"><div className="day-divider"><span>今天</span></div>
            {messages.length === 0 && <div className="empty-chat">从一句模糊的想法开始就好。<br />我会帮你把它变成可写的故事。</div>}
            {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.text}-${index}`}>{message.role === "ai" && <div className="mini-orb"><Sparkles size={13} /></div>}<div className="message-bubble">{message.text}</div></div>)}
            {generating && <div className="message ai"><div className="mini-orb"><Sparkles size={13} /></div><div className="message-bubble thinking"><LoaderCircle className="spin" />正在结合设定与借鉴资料推演……</div></div>}
            {messages.length > 0 && messages[messages.length - 1].role === "ai" && <div className="suggestion-actions"><button onClick={() => notify("已同步到相关设定，并创建新版本")}><Check size={14} />采纳并同步</button><button onClick={() => setChat("再给我一个更有网文爽感、但不俗套的方案")}>换个方案</button></div>}
          </div>
          <div className="quick-prompts"><button onClick={() => setChat("检查当前设定有没有逻辑漏洞")}>检查逻辑漏洞</button><button onClick={() => setChat("帮我强化第一卷的章尾钩子")}>强化剧情钩子</button><button onClick={() => setChat("和我一起梳理主角的成长弧光")}>一起头脑风暴</button></div>
          {aiError && <div className="ai-error">{aiError}</div>}
          <div className="composer"><Textarea value={chat} onChange={(event) => setChat(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="说说你的想法，哪怕只有一两句……" aria-label="给共创助手发送消息" />
            <div><span>Enter 发送 · Shift + Enter 换行</span><Button size="icon-sm" onClick={sendMessage} aria-label="发送"><Feather /></Button></div>
          </div>
        </aside>
        {!rightOpen && <button className="reopen-copilot" onClick={() => setRightOpen(true)}><MessageCircleMore size={19} /><span>共创助手</span></button>}
      </div>
      <ReferenceLibraryDialog open={referenceOpen} onOpenChange={setReferenceOpen} scope={referenceScope} selected={references} onAdd={addReference} />
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </main>
  );
}
