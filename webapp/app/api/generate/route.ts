import { NextResponse } from "next/server";

const SUPPORTED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

const TASK_PROMPTS: Record<string, string> = {
  chat: "你是中文长篇网络小说的共创策划，和作者讨论后给出具体、可执行、尊重现有设定的建议。",
  story_seed: "把作者的简短灵感扩展成一句具有主角、目标、阻力、代价和长线悬念的故事种子。只输出完善后的故事种子。",
  plot_update: "你是情节架构师。根据作者指令重新规划主线与支线，明确每条支线从哪个主线节点生长、在哪个节点交汇或回收，并指出对人物和世界设定的影响。",
  character_design: "你是人物设计师。提炼可借鉴的人物功能、欲望、恐惧、误信念、关系张力和弧光，但必须创造新角色，避免复刻现有角色。",
  style_fingerprint: "你是文体分析师。把参考作家或作品转化为抽象的句式、节奏、视角、意象密度、对话比例和禁忌清单，不模仿标志性句子，不复刻原文。",
  reference_analysis: "只根据提供的公开简介、元数据或用户材料，提取可迁移的结构特征、人物功能或文风参数。不要补写不存在的作品内容。",
};

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置 DEEPSEEK_API_KEY。请在本地 .env.local 或部署环境中设置。" },
      { status: 503 },
    );
  }

  let body: {
    task?: string;
    prompt?: string;
    model?: string;
    context?: string;
    references?: Array<{ title?: string; kind?: string; summary?: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const model = body.model ?? "deepseek-v4-flash";
  const task = body.task ?? "chat";
  if (!prompt) return NextResponse.json({ error: "请输入创作要求。" }, { status: 400 });
  if (!SUPPORTED_MODELS.has(model)) return NextResponse.json({ error: "不支持的模型。" }, { status: 400 });

  const references = (body.references ?? []).slice(0, 12).map((item, index) =>
    `${index + 1}. [${item.kind ?? "参考"}] ${item.title ?? "未命名"}\n${(item.summary ?? "").slice(0, 12000)}`,
  ).join("\n\n");

  const system = [
    TASK_PROMPTS[task] ?? TASK_PROMPTS.chat,
    "你必须保留作者的最终决定权。参考具体作品、作家或人物时，只借鉴高层结构和可描述特征；不要续写、复刻标志性桥段或输出足以替代原作的文本。",
    "如果资料不足，明确指出推断，不要伪造检索事实。输出使用简洁中文。",
  ].join("\n");
  const user = [
    body.context ? `当前小说上下文：\n${body.context.slice(0, 60000)}` : "",
    references ? `已选借鉴资料：\n${references}` : "",
    `作者要求：\n${prompt.slice(0, 30000)}`,
  ].filter(Boolean).join("\n\n");

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: task === "plot_update" ? 0.75 : 0.82,
        max_tokens: 6000,
      }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) {
      return NextResponse.json({ error: data.error?.message ?? `DeepSeek 请求失败（${response.status}）` }, { status: 502 });
    }
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return NextResponse.json({ error: "模型没有返回内容。" }, { status: 502 });
    return NextResponse.json({ content, model });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "模型响应超时，请重试。" : "暂时无法连接 DeepSeek。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
