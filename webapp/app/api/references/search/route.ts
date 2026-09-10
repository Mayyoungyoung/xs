import { NextResponse } from "next/server";

type SearchResult = { id: string; title: string; summary: string; source: string; url: string; kind: string };

function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

export async function POST(request: Request) {
  let body: { query?: string; kind?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "无效请求。" }, { status: 400 }); }
  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "请输入作品、作家、人物或题材。" }, { status: 400 });
  const kind = body.kind ?? "novel";

  const wikiUrl = `https://zh.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=extracts|info&exintro=1&explaintext=1&inprop=url&format=json&origin=*`;
  const booksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5&printType=books&langRestrict=zh`;
  const [wikiResponse, booksResponse] = await Promise.allSettled([
    fetch(wikiUrl, { headers: { "User-Agent": "MomaiNovelStudio/1.0" } }),
    fetch(booksUrl),
  ]);
  const results: SearchResult[] = [];

  if (wikiResponse.status === "fulfilled" && wikiResponse.value.ok) {
    const data = await wikiResponse.value.json() as { query?: { pages?: Record<string, { pageid: number; title: string; extract?: string; fullurl?: string }> } };
    for (const page of Object.values(data.query?.pages ?? {})) {
      results.push({ id: `wiki-${page.pageid}`, title: page.title, summary: stripMarkup(page.extract ?? "暂无公开摘要。"), source: "维基百科", url: page.fullurl ?? "", kind });
    }
  }
  if (booksResponse.status === "fulfilled" && booksResponse.value.ok) {
    const data = await booksResponse.value.json() as { items?: Array<{ id: string; volumeInfo?: { title?: string; authors?: string[]; description?: string; infoLink?: string; categories?: string[] } }> };
    for (const item of data.items ?? []) {
      const info = item.volumeInfo ?? {};
      const detail = [info.authors?.join(" / "), info.categories?.join(" / "), info.description].filter(Boolean).join("。 ");
      results.push({ id: `books-${item.id}`, title: info.title ?? query, summary: stripMarkup(detail || "暂无公开摘要。"), source: "Google Books", url: info.infoLink ?? "", kind });
    }
  }

  const unique = Array.from(new Map(results.map((item) => [item.title, item])).values()).slice(0, 8);
  return NextResponse.json({ results: unique, note: "结果来自公开百科与图书元数据；加入后由模型提取高层结构特征。" });
}
