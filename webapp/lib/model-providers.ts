// Shared catalog of model providers. Client UI, the web API route and the
// desktop main process all validate against this single source.

export type ProviderStyle = "openai" | "anthropic" | "gemini";
export type ModelOption = { id: string; label: string };
export type ProviderSpec = {
  id: string;
  label: string;
  style: ProviderStyle;
  baseUrl: string;
  keyLabel: string;
  keyHint: string;
  docsUrl: string;
  envKey?: string;
  models: ModelOption[];
};

export const CUSTOM_PROVIDER_ID = "custom";
export const DEFAULT_PROVIDER_ID = "deepseek";
export const DEFAULT_MODEL_ID = "deepseek-v4-flash";

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: "deepseek", label: "DeepSeek", style: "openai", baseUrl: "https://api.deepseek.com",
    keyLabel: "DeepSeek API Key", keyHint: "sk-…", docsUrl: "https://platform.deepseek.com/api_keys", envKey: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash · 日常创作" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro · 深度构思" },
      { id: "deepseek-chat", label: "DeepSeek Chat" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner · 推理" },
    ],
  },
  {
    id: "moonshot", label: "Moonshot Kimi", style: "openai", baseUrl: "https://api.moonshot.cn/v1",
    keyLabel: "Moonshot API Key", keyHint: "sk-…", docsUrl: "https://platform.moonshot.cn/console/api-keys", envKey: "MOONSHOT_API_KEY",
    models: [
      { id: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo · 日常创作" },
      { id: "kimi-k2-0905-preview", label: "Kimi K2 · 深度构思" },
      { id: "moonshot-v1-128k", label: "Moonshot V1 128K · 长文" },
    ],
  },
  {
    id: "zhipu", label: "智谱 GLM", style: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    keyLabel: "智谱 API Key", keyHint: "…", docsUrl: "https://open.bigmodel.cn/usercenter/apikeys", envKey: "ZHIPU_API_KEY",
    models: [
      { id: "glm-4.6", label: "GLM-4.6 · 深度构思" },
      { id: "glm-4.5", label: "GLM-4.5 · 日常创作" },
      { id: "glm-4.5-air", label: "GLM-4.5 Air · 轻量" },
    ],
  },
  {
    id: "qwen", label: "阿里通义千问", style: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyLabel: "百炼 DashScope API Key", keyHint: "sk-…", docsUrl: "https://bailian.console.aliyun.com/", envKey: "DASHSCOPE_API_KEY",
    models: [
      { id: "qwen3-max", label: "Qwen3 Max · 深度构思" },
      { id: "qwen-plus", label: "Qwen Plus · 日常创作" },
      { id: "qwen-turbo", label: "Qwen Turbo · 轻量" },
    ],
  },
  {
    id: "openai", label: "OpenAI", style: "openai", baseUrl: "https://api.openai.com/v1",
    keyLabel: "OpenAI API Key", keyHint: "sk-…", docsUrl: "https://platform.openai.com/api-keys", envKey: "OPENAI_API_KEY",
    models: [
      { id: "gpt-5", label: "GPT-5 · 深度构思" },
      { id: "gpt-5-mini", label: "GPT-5 Mini · 日常创作" },
      { id: "gpt-4.1", label: "GPT-4.1 · 长文" },
    ],
  },
  {
    id: "anthropic", label: "Anthropic Claude", style: "anthropic", baseUrl: "https://api.anthropic.com",
    keyLabel: "Anthropic API Key", keyHint: "sk-ant-…", docsUrl: "https://console.anthropic.com/settings/keys", envKey: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 · 深度构思" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 · 日常创作" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1 · 长文" },
    ],
  },
  {
    id: "gemini", label: "Google Gemini", style: "gemini", baseUrl: "https://generativelanguage.googleapis.com",
    keyLabel: "Google AI Studio API Key", keyHint: "AIza…", docsUrl: "https://aistudio.google.com/apikey", envKey: "GEMINI_API_KEY",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro · 深度构思" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash · 日常创作" },
    ],
  },
  {
    id: "openrouter", label: "OpenRouter 聚合", style: "openai", baseUrl: "https://openrouter.ai/api/v1",
    keyLabel: "OpenRouter API Key", keyHint: "sk-or-…", docsUrl: "https://openrouter.ai/settings/keys", envKey: "OPENROUTER_API_KEY",
    models: [
      { id: "openrouter/auto", label: "Auto · 自动选择" },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
      { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
    ],
  },
  {
    id: CUSTOM_PROVIDER_ID, label: "自定义 OpenAI 兼容接口", style: "openai", baseUrl: "",
    keyLabel: "接口 API Key", keyHint: "按服务商提供的内容填写", docsUrl: "",
    models: [],
  },
];

export function providerById(id: string): ProviderSpec | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export function defaultModelOf(providerId: string): string {
  return providerById(providerId)?.models[0]?.id ?? DEFAULT_MODEL_ID;
}

// Covers vendor ids including OpenRouter's "vendor/model" form.
export function validModelName(model: string): boolean {
  return /^[A-Za-z0-9._:/-]{1,120}$/.test(model);
}

export function validProviderModel(providerId: string, model: string): boolean {
  // New vendor model ids appear constantly, so any well-formed name is allowed;
  // the catalog only drives the visible suggestions.
  return Boolean(providerById(providerId)) && validModelName(model);
}

export function shortModelLabel(providerId: string, model: string): string {
  const provider = providerById(providerId);
  const listed = provider?.models.find((entry) => entry.id === model);
  if (listed) return listed.label.split(" · ")[0];
  return model;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

// Accepts https endpoints anywhere, plain http only on the local machine, and
// refuses link-local/cloud-metadata addresses so the server cannot be used to
// probe internal networks.
export function normalizeBaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 300) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  const loopback = isLoopbackHost(host);
  if (url.protocol === "http:" && !loopback) return null;
  if (!loopback && (/^169\.254\./.test(host) || host.startsWith("fe80:") || host.startsWith("fd00:ec2:") || host === "metadata.google.internal")) return null;
  url.search = ""; url.hash = "";
  return url.toString().replace(/\/+$/, "");
}
