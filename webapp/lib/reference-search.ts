// Reference search: provider adapters, explicit per-source states, query routing
// and a bounded orchestration loop. Pure of React and of storage; the only side
// effect is outbound HTTP to fixed, official provider endpoints.
//
// Design rules kept here on purpose:
// - every provider reports its own state, and HTTP 200 is never treated as success;
// - a verification/captcha page that returns 200 is reported as blocked;
// - partial results survive an unreachable source; all failures are explicit;
// - the author's whole sentence never becomes an exact phrase search;
// - Google Books and Open Library are queried through their own field endpoints;
// - the writing model key is never sent to a search provider: the optional
//   official search adapter uses its own key;
// - result URLs are never fetched, so there is no server-side request forgery
//   surface from search output, and no paywall/DRM circumvention.

import {
  buildSearchQueries, evidenceIdFor, normalizeReferenceText, parseReferenceBrief,
  type EvidenceKind, type ReferenceBrief, type ReferenceEntityKind, type SearchQuery,
} from "./reference-assist";

export type SearchSourceState = "ok" | "empty" | "timeout" | "blocked" | "rate_limited" | "invalid_response" | "not_configured" | "error";

export const SOURCE_STATE_LABELS: Record<SearchSourceState, string> = {
  ok: "可用", empty: "没有匹配", timeout: "超时", blocked: "被拦截或要求验证",
  rate_limited: "请求过于频繁", invalid_response: "返回内容无法解析",
  not_configured: "未配置", error: "连接失败",
};

export type ReferenceSearchResult = {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  kind: string;
  tier: number;
  evidenceKind: EvidenceKind;
  evidenceId: string;
  entity: string;
  query: string;
  note?: string;
};

export type SourceReport = { name: string; state: SearchSourceState; count: number; ms: number; detail?: string };

export type SearchOutcome = {
  results: ReferenceSearchResult[];
  sources: SourceReport[];
  note: string;
  entity: string;
  entityKind: ReferenceEntityKind;
  queries: SearchQuery[];
  degraded: boolean;
};

export type ProviderMode = "web" | "full";

export type SearchOptions = {
  kind?: string;
  mode?: ProviderMode;
  queries?: SearchQuery[];
  signal?: AbortSignal;
  budgetMs?: number;
  retry?: boolean;
  cache?: boolean;
  entity?: string;
  entityKind?: ReferenceEntityKind;
  // A search credential supplied by the caller (settings UI / desktop). It is
  // separate from the writing model credential on purpose.
  searchCredential?: SearchCredential | null;
};

const USER_AGENT = "Mozilla/5.0 (compatible; MomaiNovelStudio/1.0)";
const MAX_BODY = 2_000_000;
const DEFAULT_BUDGET = 9000;
const PER_SOURCE_TIMEOUT = 6000;
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_LIMIT = 60;

// Reading-app aggregators and dictionary pages crowd out real reference material
// and carry no citable content.
const LOW_VALUE_HOSTS = ["mopbook.com", "101xs.org", "qidiy.com", "uukan.org", "yjbys.com", "hgcha.com", "hanyuguoxue.com", "shidianguji.com", "zdic.net"];
// A 200 response that is really an anti-bot page must not be read as "no matches".
const VERIFICATION_MARKERS = ["请输入验证码", "安全验证", "人机验证", "滑动验证", "verify you are human", "captcha", "访问验证", "异常流量"];

function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function xmlText(value: string) {
  return stripMarkup(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'"));
}

function tag(item: string, name: string) {
  return xmlText(item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "");
}

export function hostOf(url: string) { return url.match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase() ?? ""; }

export function looksLikeVerificationPage(text: string): boolean {
  const sample = text.slice(0, 4000).toLowerCase();
  if (!/<html|<!doctype|<body|<script/i.test(sample)) return false;
  return VERIFICATION_MARKERS.some((marker) => sample.includes(marker.toLowerCase()));
}

// CJK queries arrive without spaces, so the whole query is one token. Indexing
// the 2-grams as well lets「群像仙侠」match a page that only spells out「仙侠」.
export function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const raw of query.toLocaleLowerCase().split(/[\s,，、。·/]+/)) {
    const token = raw.trim();
    if (!token) continue;
    terms.add(token);
    for (const run of token.match(/[\u4e00-\u9fff]+/g) ?? []) {
      if (run.length >= 3) for (let index = 0; index + 2 <= run.length; index += 1) terms.add(run.slice(index, index + 2));
    }
  }
  return [...terms];
}

// Entity match, then category/usage match. A page is never kept merely because it
// contains a request word such as「文风」.
export function relevance(item: { title: string; summary: string }, terms: string[], entity: string): number {
  const title = item.title.toLocaleLowerCase();
  const summary = item.summary.toLocaleLowerCase();
  const name = entity.toLocaleLowerCase();
  let score = 0;
  if (name && (title.includes(name) || summary.includes(name))) score += 10;
  const bestTitle = terms.reduce((best, term) => (title.includes(term) ? Math.max(best, term.length) : best), 0);
  if (bestTitle) score += 3 + bestTitle;
  else {
    const bestSummary = terms.reduce((best, term) => (summary.includes(term) ? Math.max(best, term.length) : best), 0);
    if (bestSummary) score += 1 + bestSummary;
  }
  return score;
}

function stateForStatus(status: number): SearchSourceState {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "blocked";
  return "error";
}

type BodyResult = { state: SearchSourceState; text: string; detail?: string };

async function readBody(url: string, signal: AbortSignal, init?: RequestInit): Promise<BodyResult> {
  const response = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, Accept: "application/json,application/xml,text/xml,text/html,*/*", ...(init?.headers ?? {}) }, signal });
  if (!response.ok) return { state: stateForStatus(response.status), text: "", detail: `HTTP ${response.status}` };
  let text = await response.text();
  if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY);
  if (looksLikeVerificationPage(text)) return { state: "blocked", text: "", detail: "返回了验证页面，未取得内容" };
  return { state: "ok", text };
}

function classifyThrown(error: unknown): SearchSourceState {
  const name = (error as { name?: string } | undefined)?.name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "error";
}

async function withRetry<T extends { state: SearchSourceState }>(run: () => Promise<T>, signal: AbortSignal, retry: boolean): Promise<T> {
  const first = await run().catch((error) => ({ state: classifyThrown(error) } as T));
  if (!retry || (first.state !== "error" && first.state !== "timeout") || signal.aborted) return first;
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (signal.aborted) return first;
  return run().catch((error) => ({ state: classifyThrown(error) } as T));
}

type RawItem = { id: string; title: string; summary: string; source: string; url: string; tier: number; evidenceKind: EvidenceKind; note?: string };

// ------------------------------------------------------------- provider: Baike

// Baidu Baike lemma API: authoritative for exact entries. Structured card plus an
// abstract — never the original prose.
async function readBaike(query: string, signal: AbortSignal): Promise<{ state: SearchSourceState; items: RawItem[]; detail?: string }> {
  const name = "百度百科";
  try {
    const url = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_length=1000&bk_key=${encodeURIComponent(query)}`;
    const body = await readBody(url, signal);
    if (body.state !== "ok") return { state: body.state, items: [], detail: body.detail };
    let data: { title?: string; desc?: string; abstract?: string; url?: string; card?: Array<{ name?: string; value?: unknown }> };
    try { data = JSON.parse(body.text); } catch { return { state: "invalid_response", items: [], detail: "不是有效 JSON" }; }
    if (!data || typeof data !== "object" || (data.title !== undefined && typeof data.title !== "string")) return { state: "invalid_response", items: [] };
    if (!data.title) return { state: "empty", items: [] };
    const card = (data.card ?? []).map((entry) => {
      const value = Array.isArray(entry.value) ? entry.value.map((item) => stripMarkup(String(item))).filter(Boolean).join("；") : stripMarkup(String(entry.value ?? ""));
      return entry.name && value ? `${entry.name}：${value}` : "";
    }).filter(Boolean).slice(0, 12).join(" | ");
    const detail = [stripMarkup(data.desc ?? ""), stripMarkup(data.abstract ?? ""), card].filter(Boolean).join("\n");
    const resolvedUrl = typeof data.url === "string" && /^https?:\/\//i.test(data.url) ? data.url : `https://baike.baidu.com/item/${encodeURIComponent(data.title)}`;
    return {
      state: "ok",
      items: [{ id: `baike-${data.title}`, title: data.title, summary: detail || "百科暂无摘要。", source: name, url: resolvedUrl, tier: 0, evidenceKind: "encyclopedia", note: "百科摘要只用于确认对象与背景，不含原文。" }],
    };
  } catch (error) { return { state: classifyThrown(error), items: [] }; }
}

// ----------------------------------------------------------- provider: Moegirl

// Moegirlpedia runs MediaWiki and is reachable where Wikipedia is not.
async function readMoegirl(query: string, signal: AbortSignal): Promise<{ state: SearchSourceState; items: RawItem[]; detail?: string }> {
  const name = "萌娘百科";
  try {
    const url = `https://mzh.moegirl.org.cn/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=3&prop=extracts|info&exintro=1&explaintext=1&inprop=url&format=json&origin=*`;
    const body = await readBody(url, signal);
    if (body.state !== "ok") return { state: body.state, items: [], detail: body.detail };
    let data: { query?: { pages?: Record<string, { pageid: number; title: string; extract?: string; fullurl?: string }> } };
    try { data = JSON.parse(body.text); } catch { return { state: "invalid_response", items: [], detail: "不是有效 JSON" }; }
    const pages = Object.values(data?.query?.pages ?? {});
    if (!pages.length) return { state: "empty", items: [] };
    return {
      state: "ok",
      items: pages.map((page) => ({
        id: `moegirl-${page.pageid}`, title: String(page.title ?? ""), summary: stripMarkup(String(page.extract ?? "")) || "暂无公开摘要。",
        source: name, url: page.fullurl || `https://mzh.moegirl.org.cn/${encodeURIComponent(page.title)}`, tier: 1, evidenceKind: "encyclopedia" as EvidenceKind,
      })).filter((item) => item.title),
    };
  } catch (error) { return { state: classifyThrown(error), items: [] }; }
}

// ---------------------------------------------------------------- provider: Bing

// Bing's RSS endpoint degrades badly for CJK when the query carries extra
// keywords: 「汪曾祺 作家」 collapses to single-character matches for「汪」. The bare
// entity query is intentional — type words such as「小说 简介」are never appended.
async function readBing(query: string, signal: AbortSignal): Promise<{ state: SearchSourceState; items: RawItem[]; detail?: string }> {
  const name = "网页搜索";
  try {
    const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setlang=zh-hans&mkt=zh-CN`;
    const body = await readBody(url, signal);
    if (body.state !== "ok") return { state: body.state, items: [], detail: body.detail };
    const matches = Array.from(body.text.matchAll(/<item>([\s\S]*?)<\/item>/gi));
    if (!matches.length) return { state: body.text.includes("<rss") ? "empty" : "invalid_response", items: [] };
    const items = matches.flatMap((match, index): RawItem[] => {
      const item = match[1];
      const title = tag(item, "title");
      const link = tag(item, "link");
      if (!title || !/^https?:\/\//i.test(link)) return [];
      return [{ id: `web-${index}-${title}`, title, summary: tag(item, "description") || "打开来源查看公开内容。", source: name, url: link, tier: 2, evidenceKind: "analysis" as EvidenceKind, note: "网页摘要不等于已读取正文。" }];
    });
    return items.length ? { state: "ok", items } : { state: "empty", items: [] };
  } catch (error) { return { state: classifyThrown(error), items: [] }; }
}

// -------------------------------------------------- metadata: Google Books / OL

export function metadataFieldFor(entityKind: ReferenceEntityKind): "author" | "title" | "any" {
  if (entityKind === "author") return "author";
  if (entityKind === "work") return "title";
  return "any";
}

// Google Books is queried through its own field syntax instead of a shared q.
async function readGoogleBooks(query: string, signal: AbortSignal, entityKind: ReferenceEntityKind): Promise<{ state: SearchSourceState; items: RawItem[]; detail?: string }> {
  const name = "Google Books";
  const field = metadataFieldFor(entityKind);
  const q = field === "author" ? `inauthor:"${query}"` : field === "title" ? `intitle:"${query}"` : query;
  try {
    const body = await readBody(`https://www.googleapis.com/books/v1/volumes?maxResults=4&q=${encodeURIComponent(q)}`, signal);
    if (body.state !== "ok") return { state: body.state, items: [], detail: body.detail };
    let data: { totalItems?: number; items?: Array<{ volumeInfo?: { title?: string; authors?: string[]; description?: string; publishedDate?: string; categories?: string[]; infoLink?: string; previewLink?: string } }> };
    try { data = JSON.parse(body.text); } catch { return { state: "invalid_response", items: [], detail: "不是有效 JSON" }; }
    if (!Array.isArray(data?.items) || !data.items.length) return { state: "empty", items: [] };
    const items = data.items.flatMap((entry, index): RawItem[] => {
      const info = entry.volumeInfo;
      if (!info?.title) return [];
      const link = info.infoLink ?? info.previewLink ?? "";
      if (!/^https?:\/\//i.test(link)) return [];
      const summary = [info.authors?.join("、"), info.publishedDate, info.categories?.join("、"), info.description].filter(Boolean).join(" · ");
      return [{ id: `gbooks-${index}-${info.title}`, title: info.title, summary: stripMarkup(String(summary || "图书元数据")), source: name, url: link, tier: 0, evidenceKind: "metadata" as EvidenceKind, note: "Google Books 只有书目元数据，不代表可以获取全文。" }];
    });
    return items.length ? { state: "ok", items } : { state: "empty", items: [] };
  } catch (error) { return { state: classifyThrown(error), items: [] }; }
}

// Open Library is queried by author/title field and its own endpoint.
async function readOpenLibrary(query: string, signal: AbortSignal, entityKind: ReferenceEntityKind): Promise<{ state: SearchSourceState; items: RawItem[]; detail?: string }> {
  const name = "Open Library";
  const field = metadataFieldFor(entityKind);
  const params = field === "author" ? `author=${encodeURIComponent(query)}` : field === "title" ? `title=${encodeURIComponent(query)}` : `q=${encodeURIComponent(query)}`;
  try {
    const body = await readBody(`https://openlibrary.org/search.json?${params}&limit=4&fields=title,author_name,first_publish_year,key`, signal);
    if (body.state !== "ok") return { state: body.state, items: [], detail: body.detail };
    let data: { docs?: Array<{ title?: string; author_name?: string[]; first_publish_year?: number; key?: string }> };
    try { data = JSON.parse(body.text); } catch { return { state: "invalid_response", items: [], detail: "不是有效 JSON" }; }
    if (!Array.isArray(data?.docs) || !data.docs.length) return { state: "empty", items: [] };
    const items = data.docs.flatMap((doc, index): RawItem[] => {
      if (!doc.title || !doc.key) return [];
      const summary = [doc.author_name?.join("、"), doc.first_publish_year].filter(Boolean).join(" · ");
      return [{ id: `openlib-${index}-${doc.title}`, title: doc.title, summary: summary || "图书元数据", source: name, url: `https://openlibrary.org${doc.key}`, tier: 0, evidenceKind: "metadata" as EvidenceKind, note: "Open Library 只有书目元数据，不含正文。" }];
    });
    return items.length ? { state: "ok", items } : { state: "empty", items: [] };
  } catch (error) { return { state: classifyThrown(error), items: [] }; }
}

// ------------------------------------------------- official search (optional)

// A configurable official search API. It uses its own search credential — the
// writing model key is never reused here — and stays not_configured until the
// author or administrator provides one. The endpoint is overridable so a provider
// change only needs configuration, not a code change.
export type SearchProviderConfig = { provider: string; key: string; endpoint: string };
export type SearchCredential = { provider: string; key: string };

export const DEFAULT_SEARCH_PROVIDER = "zhipu";
// Adapters are added here; the settings UI and the routes read the same list.
export const SEARCH_PROVIDERS: Array<{ id: string; label: string; keyLabel: string; docsUrl: string }> = [
  { id: "zhipu", label: "智谱 Web Search", keyLabel: "智谱搜索 API Key", docsUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
];

const SEARCH_ENDPOINTS: Record<string, string> = { zhipu: "https://open.bigmodel.cn/api/paas/v4/web_search" };

export function officialSearchConfig(env: Record<string, string | undefined> | undefined = typeof process === "undefined" ? undefined : process.env, override: SearchCredential | null = null): SearchProviderConfig | null {
  const source = env ?? {};
  const overrideKey = override?.key?.trim() ?? "";
  const envKey = (source.MOMAI_SEARCH_KEY ?? source.ZHIPU_SEARCH_API_KEY ?? "").trim();
  const key = overrideKey || envKey;
  const provider = (override?.provider ?? source.MOMAI_SEARCH_PROVIDER ?? (key ? DEFAULT_SEARCH_PROVIDER : "")).trim().toLowerCase();
  if (!provider || !key) return null;
  const endpoint = (source.MOMAI_SEARCH_ENDPOINT ?? "").trim() || SEARCH_ENDPOINTS[provider] || "";
  if (!endpoint) return null;
  return { provider, key, endpoint };
}

// The client sends its search credential in its own header, never the writing
// key, and only to our own route. A malformed key is ignored rather than used.
export function searchCredentialFromHeaders(headers: Headers): SearchCredential | null {
  const key = headers.get("X-Momai-Search-Key")?.trim() ?? "";
  if (!/^[\x21-\x7e]{10,256}$/.test(key)) return null;
  const provider = headers.get("X-Momai-Search-Provider")?.trim() || DEFAULT_SEARCH_PROVIDER;
  return { provider, key };
}

async function readOfficialSearch(query: string, signal: AbortSignal, config: SearchProviderConfig | null): Promise<{ state: SearchSourceState; items: RawItem[]; detail?: string }> {
  const name = config ? `联网检索（${config.provider}）` : "正式搜索接口";
  if (!config) return { state: "not_configured", items: [], detail: "未配置搜索密钥（MOMAI_SEARCH_KEY），本次未联网核验。" };
  try {
    const body = await readBody(config.endpoint, signal, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ search_engine: "search_std", search_query: query }),
    });
    if (body.state !== "ok") return { state: body.state, items: [], detail: body.detail };
    let data: { search_result?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
    try { data = JSON.parse(body.text); } catch { return { state: "invalid_response", items: [], detail: "不是有效 JSON" }; }
    const rows = Array.isArray(data?.search_result) ? data.search_result : Array.isArray(data?.data) ? data.data : [];
    if (!rows.length) return { state: "empty", items: [] };
    const items = rows.flatMap((row, index): RawItem[] => {
      const title = typeof row.title === "string" ? stripMarkup(row.title) : "";
      const link = typeof row.link === "string" ? row.link : typeof row.url === "string" ? row.url : "";
      const snippet = typeof row.content === "string" ? stripMarkup(row.content) : typeof row.snippet === "string" ? stripMarkup(row.snippet) : "";
      if (!title || !/^https?:\/\//i.test(link)) return [];
      return [{ id: `official-${index}-${title}`, title, summary: snippet || "该来源提供了摘要，正文未读取。", source: name, url: link, tier: 1, evidenceKind: "analysis" as EvidenceKind, note: "搜索摘要不等于已读取正文，引用前请核对原页。" }];
    });
    return items.length ? { state: "ok", items } : { state: "empty", items: [] };
  } catch (error) { return { state: classifyThrown(error), items: [] }; }
}

// ---------------------------------------------------------------- orchestration

export function entityKindFromKind(kind: string | undefined): ReferenceEntityKind {
  if (kind === "author" || kind === "work" || kind === "character" || kind === "genre") return kind;
  if (kind === "novel") return "work";
  return "unknown";
}

const cache = new Map<string, { at: number; outcome: SearchOutcome }>();

export function clearSearchCache() { cache.clear(); }

export function cachedSearchCount() { return cache.size; }

function remember(key: string, outcome: SearchOutcome) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { at: Date.now(), outcome });
}

function primaryQueryOf(input: string, brief: ReferenceBrief) {
  if (brief.entity.name) return brief.entity.name;
  const normalized = normalizeReferenceText(input);
  // A short typed query is the author's own search text; a full requirement
  // sentence is not, so it falls back to the generated attribute queries.
  const looksLikeSentence = normalized.length > 16 || /[，,]/.test(normalized) || brief.avoid.length > 0 || brief.keep.length > 0;
  return looksLikeSentence ? "" : normalized.slice(0, 60);
}

// Runs the provider set with a total budget, per-source timeout, bounded retry,
// cancellation and caching, then ranks, de-duplicates by URL and aggregates.
export async function searchReferences(input: string, options: SearchOptions = {}): Promise<SearchOutcome> {
  const kind = options.kind ?? "novel";
  // The route's explicit category wins over the weaker inference for field
  // routing; "novel" carries no field information, so the brief decides.
  const routeKind = entityKindFromKind(kind);
  const kindHint = routeKind !== "unknown" ? routeKind : undefined;
  const brief = parseReferenceBrief(input, { scope: scopeFromKind(kind), ...(kindHint ? { kindHint } : {}) });
  const entity = options.entity ?? brief.entity.name;
  const entityKind = options.entityKind ?? (routeKind !== "unknown" && routeKind !== "work" ? routeKind : brief.entity.kind !== "unknown" ? brief.entity.kind : routeKind);
  const primary = primaryQueryOf(input, brief);
  const derived = buildSearchQueries({ ...brief, entity: { ...brief.entity, name: entity || brief.entity.name, kind: entityKind } });
  const primaryQuery: SearchQuery = { id: "q0", query: primary, purpose: "entity", role: "primary" };
  const queries: SearchQuery[] = options.queries?.length
    ? options.queries
    : primary
      ? [primaryQuery, ...derived.filter((item) => item.query !== primary).map((item, index): SearchQuery => ({ ...item, id: `q${index + 1}` }))].slice(0, 4)
      : derived;
  const mode: ProviderMode = options.mode ?? "web";
  // Caching is opt-in: a manual search press should always re-check the sources,
  // while repeat assist runs may reuse a recent identical lookup. The cache key
  // includes the exact query list, so an explicit query set stays deterministic.
  const cacheable = options.cache === true;
  const key = `${mode}|${kind}|${entityKind}|${entity}|${queries.map((item) => item.query).join("|")}`;
  if (cacheable) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.outcome;
  }
  const outcome = await runProviders({ queries, kind, entity, entityKind, mode, signal: options.signal, budgetMs: options.budgetMs, retry: options.retry !== false, searchCredential: options.searchCredential ?? null });
  if (cacheable) remember(key, outcome);
  return outcome;
}

function scopeFromKind(kind: string): string {
  if (kind === "author" || kind === "work") return "style";
  if (kind === "character") return "character";
  if (kind === "genre") return "style";
  return "plot";
}

async function runProviders(input: {
  queries: SearchQuery[]; kind: string; entity: string; entityKind: ReferenceEntityKind;
  mode: ProviderMode; signal?: AbortSignal; budgetMs?: number; retry: boolean;
  searchCredential?: SearchCredential | null;
}): Promise<SearchOutcome> {
  const budget = input.budgetMs ?? DEFAULT_BUDGET;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  const primary = input.queries[0]?.query ?? "";
  const official = officialSearchConfig(undefined, input.searchCredential ?? null);
  const tasks: Array<{ name: string; run: () => Promise<{ state: SearchSourceState; items: RawItem[]; detail?: string }> }> = [
    { name: "百度百科", run: () => readBaike(primary, signal) },
    { name: "萌娘百科", run: () => readMoegirl(primary, signal) },
  ];
  if (input.mode === "full") {
    tasks.push({ name: "Google Books", run: () => readGoogleBooks(primary, signal, input.entityKind) });
    tasks.push({ name: "Open Library", run: () => readOpenLibrary(primary, signal, input.entityKind) });
  }
  tasks.push({ name: "网页搜索", run: () => readBing(primary, signal) });
  if (input.mode === "full") tasks.push({ name: official ? `联网检索（${official.provider}）` : "正式搜索接口", run: () => readOfficialSearch(primary, signal, official) });

  const settled = await Promise.all(tasks.map(async (task) => {
    const started = Date.now();
    const perSource = AbortSignal.any([signal, AbortSignal.timeout(PER_SOURCE_TIMEOUT)]);
    const result = await withRetry(() => task.run(), perSource, input.retry);
    return { name: task.name, ms: Date.now() - started, ...result };
  }));
  clearTimeout(timer);

  const terms = queryTerms(primary || input.queries.map((item) => item.query).join(" "));
  const sources: SourceReport[] = settled.map((item) => ({ name: item.name, state: item.state, count: item.items.length, ms: item.ms, ...(item.detail ? { detail: item.detail } : {}) }));
  const collected = settled.flatMap((item) => item.items.map((raw) => ({ raw, report: item })));
  const usable = collected.filter(({ raw }) => {
    if (typeof raw.title !== "string" || typeof raw.summary !== "string" || !/^https?:\/\//i.test(raw.url)) return false;
    if (LOW_VALUE_HOSTS.some((host) => hostOf(raw.url).endsWith(host))) return false;
    return raw.tier === 0 || relevance(raw, terms, input.entity) > 0;
  });
  const results: ReferenceSearchResult[] = Array.from(new Map(usable.map(({ raw }) => [raw.url, raw])).values())
    .sort((a, b) => a.tier - b.tier || relevance(b, terms, input.entity) - relevance(a, terms, input.entity) || a.title.localeCompare(b.title))
    .slice(0, 12)
    .map((raw) => ({
      id: raw.id, title: raw.title, summary: raw.summary, source: raw.source, url: raw.url, kind: input.kind,
      tier: raw.tier, evidenceKind: raw.evidenceKind, evidenceId: evidenceIdFor({ url: raw.url, source: raw.source, title: raw.title }),
      entity: input.entity, query: primary, ...(raw.note ? { note: raw.note } : {}),
    }));
  const degraded = sources.filter((source) => source.state !== "ok" && source.state !== "empty");
  const unreachable = degraded.map((source) => `${source.name}（${SOURCE_STATE_LABELS[source.state]}）`);
  const emptySources = sources.filter((source) => source.state === "empty").map((source) => source.name);
  const note = [
    unreachable.length ? `这些来源本次不可用：${unreachable.join("、")}。已保留其余来源的结果。` : "",
    emptySources.length ? `${emptySources.join("、")} 没有匹配结果。` : "",
    !unreachable.length && !emptySources.length ? "结果来自百科、图书元数据与公开网页；加入后由模型提取高层结构特征。" : "",
    sources.some((source) => source.state === "not_configured") ? "未配置搜索密钥时不会联网核验，仍可生成 AI 初步方案。" : "",
  ].filter(Boolean).join(" ");
  return { results, sources, note, entity: input.entity, entityKind: input.entityKind, queries: input.queries, degraded: degraded.length > 0 };
}

// The AI-assist flow never sends the author's sentence to a provider: it uses the
// bounded, entity/attribute-separated queries from the brief.
export async function searchReferenceBrief(brief: ReferenceBrief, options: Omit<SearchOptions, "queries"> = {}): Promise<SearchOutcome> {
  const queries = buildSearchQueries(brief);
  return searchReferences(brief.input || brief.entity.name, { ...options, mode: options.mode ?? "full", queries, entity: brief.entity.name, entityKind: brief.entity.kind });
}
