/**
 * REG24 — Bi-Temporal Legal Knowledge Graph & Stale-Ruling Detector API
 * PRD: REG24-TEMPORAL-GRAPH-001 (REG-DATA-002 / REG-GRAPH-001)
 *
 * GET  /api/v1/legal/graph/temporal?as_of_date=2023-02-07&known_at_date=2026-10-20&query=...
 * POST /api/v1/legal/graph/temporal { action: "reconstruct_at_date" | "detect_stale_rulings" | "compare_two_dates" }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  temporalGraphEngine,
  RulingTemporalReliabilityStatus,
} from "@/core/graph/temporal-graph-engine";

export async function GET(req: NextRequest) {
  const asOfDate = req.nextUrl.searchParams.get("as_of_date") || "2026-10-20";
  const knownAtDate = req.nextUrl.searchParams.get("known_at_date") || asOfDate;
  const query = req.nextUrl.searchParams.get("query") || "";
  const compareWithDate = req.nextUrl.searchParams.get("compare_with_date");

  const snapshot = temporalGraphEngine.reconstructGraphAtDate({
    as_of_date: asOfDate,
    known_at_date: knownAtDate,
    query,
  });

  const comparison = compareWithDate
    ? temporalGraphEngine.compareTwoDates(asOfDate, compareWithDate)
    : temporalGraphEngine.compareTwoDates("2021-06-15", asOfDate);

  return NextResponse.json({
    status: "ok",
    prd_id: "REG24-TEMPORAL-GRAPH-001",
    milestone_presets: temporalGraphEngine.getMilestonePresets(),
    point_in_time_snapshot: snapshot,
    date_comparison: comparison,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "reconstruct_at_date");

    if (action === "detect_stale_rulings") {
      const alerts = temporalGraphEngine.detectStaleAndImpactedRulings({
        query: body.query ? String(body.query) : undefined,
        as_of_date: body.as_of_date ? String(body.as_of_date) : "2026-10-20",
        status_filter: (body.status_filter || "ALL") as "ALL" | RulingTemporalReliabilityStatus,
        limit: Number(body.limit) || 12,
      });
      return NextResponse.json({
        status: "ok",
        action,
        total_returned: alerts.length,
        stale_ruling_alerts: alerts,
      });
    }

    if (action === "compare_two_dates") {
      const dateA = String(body.date_a || "2021-06-15");
      const dateB = String(body.date_b || "2026-10-20");
      const comparison = temporalGraphEngine.compareTwoDates(dateA, dateB);
      return NextResponse.json({
        status: "ok",
        action,
        date_comparison: comparison,
      });
    }

    const snapshot = temporalGraphEngine.reconstructGraphAtDate({
      as_of_date: body.as_of_date ? String(body.as_of_date) : "2026-10-20",
      known_at_date: body.known_at_date ? String(body.known_at_date) : undefined,
      query: body.query ? String(body.query) : undefined,
    });

    return NextResponse.json({
      status: "ok",
      action: "reconstruct_at_date",
      point_in_time_snapshot: snapshot,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Invalid temporal graph request",
      },
      { status: 400 }
    );
  }
}
