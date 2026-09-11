import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildSearchQueries, buildStylePlan, identificationStatus, parseReferenceBrief, statusBadges,
  styleReferencePrompt, type ReferenceDimension, type ReferenceEntityKind, type ReferenceEvidence, type ReferenceMedium,
} from "@/lib/reference-assist";
import { searchReferenceBrief, searchCredentialFromHeaders, type SearchOutcome } from "@/lib/reference-search";

// One line in, an editable borrow plan out. This route never fails because search
// is unavailable: without a search key or when every source fails it still returns
// the parsed identification and the deterministic first draft, clearly labelled as
// unverified. The model is called separately by the client through /api/generate,
// so there is exactly one credential path for the writing key.

const evidenceSchema = z.object({
  evidenceId: z.string().min(1).max(160),
  kind: z.enum(["encyclopedia", "metadata", "analysis", "prose", "model"]),
  source: z.string().max(160),
  url: z.string().max(1200).optional(),
  retrievedAt: z.string().max(60),
  retrieved: z.boolean(),
  chars: z.number().nonnegative().max(20_000_000).optional(),
  note: z.string().max(600).optional(),
});

const schema = z.object({
  input: z.string().trim().min(1).max(600),
  scope: z.enum(["plot", "character", "style", "world"]).default("style"),
  bookId: z.string().max(160).optional(),
  requestId: z.string().max(80).optional(),
  entityKind: z.enum(["author", "work", "character", "genre", "world", "unknown"]).optional(),
  medium: z.enum(["original", "adaptation", "unknown"]).optional(),
  dimensions: z.array(z.enum(["prose", "imagery", "emotion", "dialogue", "rhythm", "narration", "plot", "character", "world"])).max(9).optional(),
  evidence: z.array(evidenceSchema).max(40).default([]),
  search: z.boolean().default(true),
});

function toEvidence(outcome: SearchOutcome): ReferenceEvidence[] {
  return outcome.results.map((item) => ({
    evidenceId: item.evidenceId,
    kind: item.evidenceKind,
    source: item.source,
    ...(item.url ? { url: item.url } : {}),
    retrievedAt: new Date().toISOString(),
    retrieved: true,
    chars: item.summary.length,
    ...(item.note ? { note: item.note } : {}),
  }));
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 60000) return NextResponse.json({ error: "请求过大。" }, { status: 413 });
    raw = JSON.parse(text);
  } catch { return NextResponse.json({ error: "无效请求。" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请输入 1–600 字的借鉴要求，并选择有效模块。" }, { status: 400 });
  const body = parsed.data;

  const brief = parseReferenceBrief(body.input, {
    scope: body.scope,
    ...(body.entityKind && body.entityKind !== "unknown" ? { kindHint: body.entityKind as ReferenceEntityKind } : {}),
  });
  // The author's confirmed identification overrides the weak inference.
  if (body.entityKind) brief.entity = { ...brief.entity, kind: body.entityKind as ReferenceEntityKind };
  if (body.medium) brief.entity = { ...brief.entity, medium: body.medium as ReferenceMedium };
  if (body.dimensions?.length) {
    brief.dimensions = body.dimensions as ReferenceDimension[];
    brief.proseFocus = brief.dimensions.filter((dimension) => ["prose", "imagery", "emotion", "dialogue", "narration"].includes(dimension));
    brief.structureFocus = brief.dimensions.filter((dimension) => ["rhythm", "plot", "character", "world"].includes(dimension));
  }

  let evidence: ReferenceEvidence[] = [...body.evidence];
  let search: { attempted: boolean; degraded: boolean; note: string; sources: SearchOutcome["sources"]; queries: SearchOutcome["queries"] } | null = null;
  if (body.search) {
    try {
      const outcome = await searchReferenceBrief(brief, { signal: request.signal, cache: true, searchCredential: searchCredentialFromHeaders(request.headers) });
      evidence = [...evidence, ...toEvidence(outcome)];
      search = { attempted: true, degraded: outcome.degraded, note: outcome.note, sources: outcome.sources, queries: outcome.queries };
    } catch {
      // Search is an enhancement: a thrown search never blocks the first draft.
      search = { attempted: true, degraded: true, note: "本次联网检索未完成，已先给出未联网核验的初步方案。", sources: [], queries: buildSearchQueries(brief) };
    }
  }

  const plan = buildStylePlan({ brief, evidence, scope: body.scope, ...(body.requestId ? { requestId: body.requestId } : {}) });
  const identification = identificationStatus(brief, evidence);
  const modelRequest = styleReferencePrompt(brief, plan, evidence);

  return NextResponse.json({
    requestId: body.requestId ?? plan.id,
    scope: body.scope,
    brief,
    identification,
    badges: statusBadges(brief, evidence),
    queries: buildSearchQueries(brief),
    evidence,
    plan,
    search,
    model: { task: "style_reference", ...modelRequest },
  });
}
