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
