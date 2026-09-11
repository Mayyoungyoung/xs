import { NextResponse } from "next/server";
import { z } from "zod";
import { searchReferences, searchCredentialFromHeaders } from "@/lib/reference-search";

const schema = z.object({
  query: z.string().trim().min(1).max(300),
  kind: z.enum(["novel", "genre", "character", "author", "work"]).default("novel"),
  // Book metadata sources are opt-in for the manual search box; the AI-assist
  // flow enables them through its own route.
  includeBooks: z.boolean().optional(),
});

const reachable = (state: string) => state === "ok" || state === "empty";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 2000) return NextResponse.json({ error: "检索词过长。" }, { status: 400 });
    raw = JSON.parse(text);
  } catch { return NextResponse.json({ error: "无效请求。" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请输入 1–300 字的检索词及有效类型。" }, { status: 400 });
  const { query, kind, includeBooks } = parsed.data;

  const outcome = await searchReferences(query, { kind, mode: includeBooks ? "full" : "web", signal: request.signal, searchCredential: searchCredentialFromHeaders(request.headers) });
  if (!outcome.sources.some((source) => reachable(source.state))) {
    return NextResponse.json({ error: "公开检索源暂时无法连接，请稍后重试或导入本地资料。" }, { status: 502 });
  }
  return NextResponse.json({
    results: outcome.results,
    // Kept as the stable {name, ok} shape the existing UI and tests rely on.
    sources: outcome.sources.map((source) => ({ name: source.name, ok: reachable(source.state) })),
    states: outcome.sources,
    note: outcome.note,
    entity: outcome.entity,
    queries: outcome.queries,
  });
}
