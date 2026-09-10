import { NextResponse } from "next/server";
import { z } from "zod";

type SearchResult = { id: string; title: string; summary: string; source: string; url: string; kind: string };

function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

function xmlText(value: string) {
  return stripMarkup(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'"));
}

function tag(item: string, name: string) {
  return xmlText(item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "");
}

export async function POST(request: Request) {
  const schema = z.object({ query: z.string().trim().min(1).max(300), kind: z.enum(["novel", "genre", "character", "author", "work"]).default("novel") });
  let raw: unknown;
  try { const text = await request.text(); if (text.length > 2000) return NextResponse.json({ error: "检索词过长。" }, { status: 400 }); raw = JSON.parse(text); }
  catch { return NextResponse.json({ error: "无效请求。" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请输入 1–300 字的检索词及有效类型。" }, { status: 400 });
  const { query, kind } = parsed.data;
  const suffix = { novel: "小说 简介", genre: "小说 题材", character: "人物 性格", author: "作家 文风", work: "作品 风格" }[kind];

  const wikiUrl = `https://zh.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=extracts|info&exintro=1&explaintext=1&inprop=url&format=json&origin=*`;
  const booksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5&printType=books&langRestrict=zh`;
  const openLibraryUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5&fields=key,title,author_name,first_publish_year,subject`;
  const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(`"${query}" ${suffix}`)}&format=rss&setlang=zh-hans&mkt=zh-CN`;
  async function readSource(url: string, format: "text" | "json") {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MomaiNovelStudio/1.0)" }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(9000)]) });
    if (!response.ok) throw new Error(`source ${response.status}`);
    const text = await response.text();
    if (format === "text") return { ok: true, text: async () => text, json: async () => ({}) };
    const data: unknown = JSON.parse(text);
    return { ok: true, text: async () => text, json: async () => data };
  }
  const [bingResponse, wikiResponse, booksResponse, openLibraryResponse] = await Promise.allSettled([
    readSource(bingUrl, "text"), readSource(wikiUrl, "json"), readSource(booksUrl, "json"), readSource(openLibraryUrl, "json"),
  ]);
  const results: SearchResult[] = [];

  try { if (bingResponse.status === "fulfilled" && bingResponse.value.ok) {
    const xml = await bingResponse.value.text();
    for (const [index, match] of Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).entries()) {
      const item = match[1];
      const title = tag(item, "title");
      const url = tag(item, "link");
      const summary = tag(item, "description");
      if (title && url) results.push({ id: `web-${index}-${title}`, title, summary: summary || "打开来源查看公开内容。", source: "网页搜索", url, kind });
    }
  }

  } catch { /* ignore a malformed source */ }
  try { if (wikiResponse.status === "fulfilled" && wikiResponse.value.ok) {
    const data = await wikiResponse.value.json() as { query?: { pages?: Record<string, { pageid: number; title: string; extract?: string; fullurl?: string }> } };
    for (const page of Object.values(data.query?.pages ?? {})) {
      results.push({ id: `wiki-${page.pageid}`, title: page.title, summary: stripMarkup(page.extract ?? "暂无公开摘要。"), source: "维基百科", url: page.fullurl ?? "", kind });
    }
  }
  } catch { /* ignore a malformed source */ }
  try { if (booksResponse.status === "fulfilled" && booksResponse.value.ok) {
    const data = await booksResponse.value.json() as { items?: Array<{ id: string; volumeInfo?: { title?: string; authors?: string[]; description?: string; infoLink?: string; categories?: string[] } }> };
    for (const item of data.items ?? []) {
      const info = item.volumeInfo ?? {};
      const detail = [info.authors?.join(" / "), info.categories?.join(" / "), info.description].filter(Boolean).join("。 ");
      results.push({ id: `books-${item.id}`, title: info.title ?? query, summary: stripMarkup(detail || "暂无公开摘要。"), source: "Google Books", url: info.infoLink ?? "", kind });
    }
  }
  } catch { /* ignore a malformed source */ }
  try { if (openLibraryResponse.status === "fulfilled" && openLibraryResponse.value.ok) {
    const data = await openLibraryResponse.value.json() as { docs?: Array<{ key?: string; title?: string; author_name?: string[]; first_publish_year?: number; subject?: string[] }> };
    for (const item of data.docs ?? []) {
      const detail = [item.author_name?.join(" / "), item.first_publish_year ? `首版 ${item.first_publish_year}` : "", item.subject?.slice(0, 6).join(" / ")].filter(Boolean).join("。 ");
      results.push({ id: `openlibrary-${item.key ?? item.title}`, title: item.title ?? query, summary: detail || "暂无公开摘要。", source: "Open Library", url: item.key ? `https://openlibrary.org${item.key}` : "", kind });
    }
  }

  } catch { /* ignore a malformed source */ }
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const relevance = (item: SearchResult) => terms.reduce((score, term) => score + (item.title.toLocaleLowerCase().includes(term) ? 3 : item.summary.toLocaleLowerCase().includes(term) ? 1 : 0), 0);
  const unique = Array.from(new Map(results.filter((item) => typeof item.title === "string" && typeof item.summary === "string" && /^https?:\/\//i.test(item.url) && relevance(item) > 0).map((item) => [item.url, item])).values()).sort((a, b) => relevance(b) - relevance(a)).slice(0, 8);
  const allFailed = [bingResponse, wikiResponse, booksResponse, openLibraryResponse].every((r) => r.status === "rejected");
  if (allFailed) return NextResponse.json({ error: "公开检索源暂时无法连接，请稍后重试或导入本地资料。" }, { status: 502 });
  return NextResponse.json({ results: unique, note: "结果来自公开网页、百科与图书元数据；加入后由模型提取高层结构特征。" });
}
