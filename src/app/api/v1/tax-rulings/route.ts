import { NextRequest, NextResponse } from "next/server";
import { searchThaiTaxRulings } from "@/core/data/thai-tax-rulings-loader";

/**
 * REG24 — Official Thai Tax Rulings Corpus API (3,643 Revenue Department Rulings, B.E. 2543–2569)
 * GET /api/v1/tax-rulings?q=...&tax_type=...&year_be=...&limit=50&offset=0
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";
  const primary_tax_type = searchParams.get("tax_type") || "ALL";
  const yearParam = searchParams.get("year_be");
  const limit = Number(searchParams.get("limit") || 50);
  const offset = Number(searchParams.get("offset") || 0);

  const response = searchThaiTaxRulings({
    query,
    primary_tax_type,
    year_be: yearParam ? Number(yearParam) : undefined,
    limit,
    offset,
  });

  return NextResponse.json(response);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    tax_type?: string;
    year_be?: number;
    limit?: number;
    offset?: number;
  };

  const response = searchThaiTaxRulings({
    query: body.query || "",
    primary_tax_type: body.tax_type || "ALL",
    year_be: typeof body.year_be === "number" ? body.year_be : undefined,
    limit: Number(body.limit || 20),
    offset: Number(body.offset || 0),
  });

  const enriched = response.rulings.map((r) => ({
    ...r,
    summary_th: r.ruling,
    holding_th: r.ruling,
    title_th: r.subject,
    summary_en: `${r.ruling_no} (${r.primary_tax_type}): ${r.subject}`,
    section: r.legal_provisions,
  }));

  return NextResponse.json({
    ok: true,
    rulings: enriched,
    result: {
      rulings: enriched,
      total: response.matched_count,
    },
  });
}
