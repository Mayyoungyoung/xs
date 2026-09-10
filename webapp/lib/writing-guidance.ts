import type { BookProject } from "@/components/novel/bookshelf";
import type { BookWorkspace } from "@/components/novel/book-workspace";
import { chapterPlan, getRoadmap } from "./story-roadmap";

const excerpt = (value?: string, length = 100) => value?.replace(/\s+/g, " ").trim().slice(0, length) ?? "";
export function writingGuidance(type: string, book: Pick<BookProject, "title" | "genre" | "premise">, workspace?: BookWorkspace) {
  const idea = excerpt(workspace?.idea || book.premise);
  const genre = book.genre || "当前题材";
  const setting = /科幻|星际|太空|末日/.test(genre) ? "科技能做到什么、资源与能源如何分配、航行或通讯有什么限制" : /古风|历史|权谋|宫廷/.test(genre) ? "朝廷与地方的权力关系、官制与礼法、消息和证据如何流转" : /仙侠|玄幻|奇幻|修真/.test(genre) ? "力量来源、修炼或魔法的限制、使用能力的代价与势力秩序" : /悬疑|推理|犯罪/.test(genre) ? "案件发生地、调查权限、证据规则和人物能接触的信息" : /言情|都市|现实|青春/.test(genre) ? "生活环境、职业与家庭、社会关系和现实压力" : `${genre}所需的环境、社会规则、资源与限制`;
  const roadmap = workspace ? getRoadmap(workspace.plot) : undefined;
  const lines = roadmap?.lines.map((line) => `${line.title}${line.goal ? `：${excerpt(line.goal, 60)}` : ""}`).slice(0, 3).join("；");
  const plan = workspace ? chapterPlan(workspace) : undefined;
  const targets = plan?.events.map((event) => `${event.title}${event.note ? `（${excerpt(event.note, 70)}）` : ""}`).join("；");
  const chapterTitle = plan?.chapter.title || "当前章";
  const bookAnchor = `《${book.title}》${idea ? `，已有构想：${idea}` : `，题材：${genre}`}`;
  const world = excerpt(workspace?.assets.world, 80);
  const style = excerpt(workspace?.assets.style, 80);
  const values: Record<string, { placeholder: string; request: string }> = {
    world: { placeholder: `为《${book.title}》建立可遵循的世界规则。\n\n请写清：${setting}。\n${idea ? `围绕本书构想「${idea}」，哪些规则会真正影响事件发生？` : "先写会影响故事的规则，再补充背景细节。"}\n\n地点与势力：\n关键规则：\n限制与例外：\n人物必须承担的代价：`, request: `补全${bookAnchor}的世界观，重点梳理${setting}。只补充与故事有关的规则，保留已确认设定，未知处标为待定。` },
    characters: { placeholder: `为《${book.title}》建立人物档案。${idea ? `\n本书构想：${idea}` : ""}\n\n姓名与身份：\n最在意的人或事：\n隐瞒的秘密与不愿跨过的底线：\n与其他人物的关系：\n经历事件后会如何改变：\n\n${lines ? `这些人物将参与：${lines}` : idea ? `从「${idea}」中先确定主角，再补关键配角。` : "先从最推动故事的一个人物开始。"}${world ? `\n人物需遵守已有规则：${world}` : ""}`, request: `为${bookAnchor}完善人物档案，重点写身份、欲望、秘密、底线、关系与成长。${lines ? `让人物行动参与这些故事线：${lines}。` : "先明确主角和关键配角的作用。"}不要改写世界观或直接写章节正文。` },
    style: { placeholder: `确定《${book.title}》的叙述方式。\n\n叙事视角：谁在讲述，读者能知道多少？\n语言节奏：短句与长句、叙述与对话如何搭配？\n${/悬疑|推理/.test(genre) ? "悬念尺度：哪些信息延后揭露，哪些线索让读者先看到？" : /言情|青春/.test(genre) ? "情感表达：用直接对话还是动作与细节传递感情？" : "情绪与氛围：希望读者如何感受关键场景？"}\n常用与禁用表达：\n希望保留的句子示例：\n\n这是一部${genre}小说${idea ? `，语言需要服务于「${idea}」的阅读体验` : ""}；请写可重复执行的语言习惯，不要在这里填写剧情大纲。`, request: `为${bookAnchor}制定文风指南：视角、节奏、对话、意象、信息揭露尺度和禁用表达。结合本书已有正文与文风借鉴，给可执行的规则，不复刻参考原文。` },
    outline: { placeholder: `安排《${book.title}》的卷章大纲。\n\n${lines ? `已有故事线：${lines}` : "先确定本卷要推进哪些故事线，可在世界线里安排事件。"}\n\n本卷的开始与结束状态：\n每章推进的具体事件：\n出场人物、场景与选择：\n哪些支线在本章衍生或交汇：\n章尾留下什么未解决的问题：`, request: `把${bookAnchor}的世界线落实成卷章大纲。${lines ? `沿着${lines}推进。` : "未确定的主线与结局请标为待讨论。"}逐章列出事件、人物选择、支线交汇和章尾悬念，不一次写完整正文。` },
    chapters: { placeholder: `开始写《${book.title}》· ${chapterTitle}。\n\n${targets ? `本章安排：${targets}\n\n从其中一个具体场景展开，让人物通过行动推进事件。后续事件先保留。` : "从人物正在做的一件事、一次对话或一个具体场景开始。可先在上方选择本章要推进的事件。"}${style ? `\n\n沿用文风：${style}` : "\n\n在这里填写小说正文，不必重复故事设定表。"}`, request: `续写《${book.title}》的${chapterTitle}。${targets ? `本章只推进：${targets}。` : "遵循本章大纲与作者要求，不擅自完成整条故事线。"}${style ? `沿用文风：${style}。` : "保持与前文一致的视角和节奏。"}承接已有正文，不重复已发生的情节，只输出新增正文。` },
    timeline: { placeholder: lines ? `《${book.title}》已有故事线：${lines}。\n想让哪条线继续推进，在哪里交汇，或从哪个事件衍生新支线？` : `一起为《${book.title}》设计故事路线。${idea ? `\n当前构想：${idea}` : `\n题材：${genre}`}\n希望有几条主线？哪些人物或秘密值得单独展开？`, request: `讨论${bookAnchor}的主线、衍生支线和交汇事件。${lines ? `以现有路线为基础：${lines}。` : "先给出适合本书的主线方向供作者选择。"}` },
  };
  return values[type] ?? { placeholder: `补充《${book.title}》当前模块的内容。`, request: `结合${bookAnchor}完善当前模块，保留已有事实。` };
}
