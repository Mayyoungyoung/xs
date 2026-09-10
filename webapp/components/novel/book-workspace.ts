import type { BookProject } from "./bookshelf";
import type { ReferenceItem } from "./reference-library-dialog";

export type StoryMessage = { role: "ai" | "user"; text: string };

export type PlotBranch = {
  id: string;
  title: string;
  color: string;
  path: string;
  labels: Array<{ x: number; y: number; text: string }>;
};

export type PlotState = {
  instruction: string;
  branches: PlotBranch[];
  selected: string;
  selectedNode: string;
  zoom: number;
  version: number;
};

export type BlueprintVersion = {
  id: string;
  label: string;
  createdAt: string;
  idea: string;
};

export type BookWorkspace = {
  idea: string;
  messages: StoryMessage[];
  tags: string[];
  references: ReferenceItem[];
  assets: Record<string, string>;
  plot: PlotState;
  versions: BlueprintVersion[];
};

export function createBookWorkspace(book: BookProject): BookWorkspace {
  const idea = book.premise;
  return {
    idea,
    messages: [{ role: "ai", text: `《${book.title}》已经建立独立创作空间。先补全一句话故事、世界规则或人物动机，我会只参考这本书的设定与借鉴资料。` }],
    tags: [book.genre],
    references: [],
    assets: {},
    plot: {
      instruction: `为《${book.title}》设计一条围绕核心冲突展开的支线，在中段与主线交汇，并在结局前回收。`,
      branches: defaultPlotBranches(),
      selected: "clue",
      selectedNode: "",
      zoom: 1,
      version: 1,
    },
    versions: [{ id: "initial", label: "创建小说", createdAt: "初始版本", idea }],
  };
}

export function mergeBookWorkspace(book: BookProject, saved?: Partial<BookWorkspace>): BookWorkspace {
  const base = createBookWorkspace(book);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    assets: { ...base.assets, ...saved.assets },
    plot: { ...base.plot, ...saved.plot, branches: saved.plot?.branches ?? base.plot.branches },
    versions: saved.versions?.length ? saved.versions : base.versions,
  };
}

export function assetInitialContent(type: string, book: Pick<BookProject, "title" | "genre" | "premise">) {
  const seed = `《${book.title}》｜${book.genre}\n核心设想：${book.premise}`;
  const values: Record<string, string> = {
    world: `${seed}\n\n世界内核：这里的规则、力量与代价尚待建立。\n\n请从三个问题开始：\n1. 这个世界最不寻常的常识是什么？\n2. 主角为实现目标必须付出什么代价？\n3. 哪条规则一旦被打破，会让主线彻底失控？`,
    characters: `${seed}\n\n主角\n想要：\n害怕：\n秘密：\n会改变的信念：\n\n关键配角\n表层目标：\n隐藏目标：\n与主角的关系变化：`,
    timeline: `${seed}\n\n故事开始前｜写下改变主角命运的旧事。\n第一卷开端｜触发事件迫使主角行动。\n中段转折｜主线与支线第一次互相改变。\n结局前夜｜所有未解决的代价集中显现。`,
    style: `${seed}\n\n叙事视角：\n句式与节奏：\n核心意象：\n对话原则：\n每章钩子：\n避免使用：`,
    outline: `${seed}\n\n第一卷目标：\n\n第 1 章｜触发事件\n冲突：\n推进：\n章尾钩子：\n\n第 2 章｜第一次选择\n冲突：\n推进：\n章尾钩子：`,
    chapters: `# 《${book.title}》\n\n## 第 1 章\n\n${book.premise}\n\n（从这里开始写作，或在右侧告诉 AI 你希望这一章发生什么。）`,
  };
  return values[type] ?? values.world;
}

function defaultPlotBranches(): PlotBranch[] {
  return [
    { id: "relationship", title: "人物关系支线", color: "#b96357", path: "M315 244 C350 75 650 65 780 244", labels: [{ x: 420, y: 87, text: "关系转折" }, { x: 625, y: 87, text: "共同选择" }] },
    { id: "clue", title: "秘密线索支线", color: "#4f7185", path: "M95 244 C150 415 430 430 545 244", labels: [{ x: 225, y: 400, text: "发现线索" }, { x: 420, y: 400, text: "真相反转" }] },
    { id: "world", title: "世界变化支线", color: "#8a7650", path: "M545 244 C625 500 930 495 1010 244", labels: [{ x: 690, y: 466, text: "规则失效" }, { x: 885, y: 466, text: "代价爆发" }] },
  ];
}
