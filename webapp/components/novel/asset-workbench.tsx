"use client";

import { useState } from "react";
import { BookMarked, BookOpen, Box, Check, CircleUserRound, Clock3, Feather, GitCommit, Library, LoaderCircle, Plus, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReferenceItem, ReferenceScope } from "./reference-library-dialog";

type Props = {
  bookTitle: string;
  type: string;
  references: ReferenceItem[];
  onOpenReferences: (scope: ReferenceScope) => void;
  onGenerate: (prompt: string, task: string) => Promise<string>;
  onNotify: (message: string) => void;
};

const configs: Record<string, { title: string; desc: string; icon: typeof Box; scope: ReferenceScope; task: string }> = {
  world: { title: "世界观", desc: "定义这个世界能发生什么、不能发生什么，以及一切力量的代价。", icon: Box, scope: "world", task: "chat" },
  characters: { title: "人物角色", desc: "让人物拥有独立欲望、恐惧、秘密与会发生变化的关系。", icon: CircleUserRound, scope: "character", task: "character_design" },
  timeline: { title: "世界线", desc: "固定历史事件与故事现在，避免时间、年龄和因果关系漂移。", icon: Clock3, scope: "world", task: "chat" },
  style: { title: "文风指纹", desc: "把抽象的“像某种作品”转化为可执行、可调节的写作参数。", icon: Feather, scope: "style", task: "style_fingerprint" },
  outline: { title: "卷章大纲", desc: "把主线和支线落实到每一卷、每一章的冲突、转折与钩子。", icon: Library, scope: "plot", task: "plot_update" },
  chapters: { title: "章节正文", desc: "在设定、人物、大纲和文风约束下写作，并保留每次修改。", icon: BookOpen, scope: "plot", task: "chat" },
};

export function AssetWorkbench({ bookTitle, type, references, onOpenReferences, onGenerate, onNotify }: Props) {
  const config = configs[type] ?? configs.world;
  const Icon = config.icon;
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState(() => initialContent(type));
  const [request, setRequest] = useState(placeholderFor(type));
  const scopedReferences = references.filter((item) => item.scope === config.scope);

  async function generate() {
    if (!request.trim()) return;
    setLoading(true);
    try { const result = await onGenerate(request, config.task); setContent(result); onNotify(`${config.title}已生成新版本`); } finally { setLoading(false); }
  }

  return <div className="asset-workbench">
    <div className="page-heading asset-heading"><div><div className="eyebrow">{bookTitle} / {config.title}</div><h1>{config.title}</h1><p>{config.desc}</p></div><div className="heading-actions"><Button variant="outline" onClick={() => onOpenReferences(config.scope)}><BookMarked />添加借鉴</Button><Button className="ink-button" onClick={generate} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Sparkles />}AI 生成新版</Button></div></div>
    <section className="asset-layout">
      <div className="asset-editor">
        <div className="asset-editor-head"><span><Icon />当前版本</span><div><em>自动保存</em><Button size="sm" variant="outline" onClick={() => onNotify("已保存当前版本")}><Save />保存</Button></div></div>
        <Textarea value={content} onChange={(event) => setContent(event.target.value)} aria-label={`${config.title}编辑器`} />
        <footer><span><Check />已通过基本完整性检查</span><span>{content.length.toLocaleString()} 字</span></footer>
      </div>
      <aside className="asset-side">
        <section className="asset-ai-card"><header><span><Sparkles /></span><div><strong>让 AI 修改</strong><p>用自然语言描述，不需要写提示词</p></div></header><Textarea value={request} onChange={(event) => setRequest(event.target.value)} /><Button onClick={generate} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Sparkles />}生成并替换编辑器</Button></section>
        <section className="asset-reference-card"><header><strong>本页借鉴</strong><button onClick={() => onOpenReferences(config.scope)}><Plus />添加</button></header>{scopedReferences.length === 0 ? <div className="asset-no-reference"><BookMarked /><p>尚未选择借鉴资料</p></div> : scopedReferences.map((item) => <div className="asset-reference-row" key={item.id}><span>{item.source === "网页搜索" ? "网" : item.source === "本地文件" ? "本" : "书"}</span><div><strong>{item.title}</strong><small>{item.source}</small></div></div>)}</section>
        <section className="asset-version-card"><strong>最近版本</strong><div><GitCommit /><span>当前编辑版本<small>刚刚</small></span></div><div><GitCommit /><span>AI 完善设定<small>昨天 22:14</small></span></div></section>
      </aside>
    </section>
  </div>;
}

function placeholderFor(type: string) {
  const values: Record<string, string> = {
    world: "补全雾隐镇的社会运行方式，并让“遗忘”真正影响普通人的生活。",
    characters: "借鉴已选人物的功能与弧光，重新设计一个立场会变化的关键配角。",
    timeline: "检查七年前祭典、母亲失踪与主角离乡之间的时间因果。",
    style: "保持冷色意象和克制叙述，但让动作场面更有速度感。",
    outline: "重做第一卷 12 章大纲，让每三章形成一次小高潮，并保留章尾钩子。",
    chapters: "续写当前场景，强化沈青霜发现铜铃异常时的动作与潜台词。",
  };
  return values[type] ?? values.world;
}

function initialContent(type: string) {
  const values: Record<string, string> = {
    world: "世界内核：记忆是一种可以被储存、交换和消耗的实体。\n\n雾隐镇以集体遗忘向山神换取平静。旧物会封存被献祭的记忆，只有顾沉舟能听见它们。\n\n核心规则\n1. 读取越深，读取者遗忘的内容越重要。\n2. 同一段记忆不能被同一个人听见两次。\n3. 大雾之外的人会逐渐忘记雾隐镇。\n\n力量的代价：能力无法凭空创造真相，只能听见物件曾经见证的片段。",
    characters: "顾沉舟｜主角，旧物修复师\n想要：查明母亲失踪的真相。\n害怕：自己才是七年前祭典的灾难源头。\n误信念：只要找回全部记忆，就能弥补一切。\n弧光：从执着于还原过去，到接受记忆不完整仍可做出选择。\n\n沈青霜｜守雾人后代\n表层目标：阻止顾沉舟继续调查。\n隐藏目标：证明家族并非祭典的元凶。\n关系变化：监视者 → 被迫同盟 → 共同承担秘密。",
    timeline: "七年前 · 春｜雾隐镇举行最后一次山祭。\n七年前 · 夏｜顾沉舟的母亲失踪，顾沉舟被送离小镇。\n三年前｜镇外所有地图开始失去“雾隐镇”地名。\n现在 · 第一天｜亡母的铜铃寄到修复铺。\n现在 · 第三天｜顾沉舟返乡，第一位镇民忘记自己的名字。\n现在 · 第七天｜月相变化，铜铃中出现第二段记忆。",
    style: "叙事视角：第三人称限知，紧贴顾沉舟感官。\n句式：动作与悬疑段落以短句为主；回忆段落允许舒展长句。\n意象：雨、铜锈、雾、旧木、冷灯。\n对话：少解释，多使用答非所问和动作停顿制造潜台词。\n节奏：每 800–1200 字出现一次信息增量。\n禁忌：避免堆砌形容词；避免直接说明人物已经通过动作表达的情绪。",
    outline: "第一卷：雾起（1–12 章）\n卷目标：顾沉舟确认母亲失踪与七年前山祭有关。\n\n第 1 章｜雨夜归乡\n冲突：顾沉舟必须在封路前进入雾隐镇。\n推进：铜铃第一次响起，出现亡母的声音。\n钩子：守门老人叫出了一个顾沉舟从未用过的名字。\n\n第 2 章｜井下有声\n冲突：旧井旁的记忆与镇志记载互相矛盾。\n推进：发现被涂去的祭典名单。\n钩子：名单最后一行是顾沉舟本人。",
    chapters: "雨落在铜铃上，没有响。\n\n顾沉舟却听见了七年前，那扇门合拢的声音。\n\n他停在雾隐镇的界碑前。石上的三个字只剩浅淡的凹痕，像有人耐心地、一笔一画地把这个地方从世上擦去。\n\n“你来晚了。”守门的老人说。\n\n顾沉舟抬起头。老人没有看他，只盯着他袖中那枚从未示人的铜铃。",
  };
  return values[type] ?? values.world;
}
