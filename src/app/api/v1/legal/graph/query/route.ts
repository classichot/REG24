import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import {
  GraphUnavailableError,
  TenantQueryContext,
  unifiedGraphRepository,
} from "@/core/graph/graph-repository";
import { NEO4J_SCHEMA_VERSION } from "@/core/graph/graph-schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId =
      req.headers.get("x-reg24-tenant") || body.tenant_id || "tenant.law24.prod";
    const role = (req.headers.get("x-reg24-role") ||
      body.role ||
      "Enterprise User") as TenantQueryContext["role"];
    const requireLiveNeo4j = Boolean(body.require_live_neo4j);

    const ctx: TenantQueryContext = {
      tenant_id: tenantId,
      role,
      require_live_neo4j: requireLiveNeo4j,
    };

    const mode = body.mode || "3r_graphrag";
    const asOfDate = body.as_of_date || "2026-10-19";
    const knownAtDate = body.known_at_date || "2026-10-19";

    if (mode === "temporal_version") {
      const temporalRes = await unifiedGraphRepository.getProvisionAtTime(
        body.provision_id || "prov.th.rev.65ter",
        asOfDate,
        knownAtDate,
        ctx
      );
      return NextResponse.json(temporalRes);
    }

    if (mode === "multi_hop") {
      const multiHopRes = await unifiedGraphRepository.traverseMultiHop({
        startCanonicalId: body.start_canonical_id || "prov.th.rev.65ter",
        maxDepth: body.max_depth ?? 3,
        relationshipFilter: body.relationship_filter,
        validTime: asOfDate,
        limit: body.limit ?? 30,
        ctx,
      });
      return NextResponse.json(multiHopRes);
    }

    if (mode === "hybrid") {
      const hybridRes = await unifiedGraphRepository.hybridRetrieve({
        query: body.query || "Section 65 ter Revenue Code",
        labelFilter: body.label_filter,
        moduleIdFilter: body.module_id,
        validTime: asOfDate,
        limit: body.limit ?? 12,
        ctx,
      });
      return NextResponse.json(hybridRes);
    }

    // Default: 3R / 2R Hybrid GraphRAG compatibility mode (REG-NEO-010) backed by GraphRepository
    const queryText =
      body.query || "Can a company terminate an employee without severance pay?";

    const hybridEvidence = await unifiedGraphRepository.hybridRetrieve({
      query: queryText,
      validTime: asOfDate,
      limit: 6,
      ctx,
    });

    const primaryNodeId =
      hybridEvidence.results[0]?.node.canonical_id || "prov.th.lpa.118";
    const multiHop = await unifiedGraphRepository.traverseMultiHop({
      startCanonicalId: primaryNodeId,
      maxDepth: 2,
      validTime: asOfDate,
      limit: 15,
      ctx,
    });

    const threeRRes = reg24Core.execute3RGraphRAGQuery({
      query: queryText,
      as_of_date: asOfDate,
      known_at_date: knownAtDate,
    });

    return NextResponse.json({
      ...threeRRes,
      neo4j_graph_persistence: {
        requirement_id: "REG24-INFRA-NEO4J-001",
        schema_version: NEO4J_SCHEMA_VERSION,
        storage_backend: hybridEvidence.storage_backend,
        degraded_mode: hybridEvidence.degraded_mode,
        degraded_warning: hybridEvidence.degraded_warning,
        tenant_id: tenantId,
        supporting_graph_paths: multiHop.traversal_paths,
        path_explanations: multiHop.path_explanations,
        hybrid_candidates_count: hybridEvidence.results.length,
      },
    });
  } catch (err) {
    if (err instanceof GraphUnavailableError) {
      return NextResponse.json(
        {
          status: "service_unavailable",
          code: err.code,
          message: err.message,
          sanitized_reason: err.sanitizedReason,
          degraded_fallback_permitted: false,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query =
      searchParams.get("q") ||
      "Can a company terminate an employee without severance pay?";
    const asOfDate = searchParams.get("as_of_date") || "2026-10-19";
    const requireLiveNeo4j = searchParams.get("require_live_neo4j") === "true";
    const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";

    const ctx: TenantQueryContext = {
      tenant_id: tenantId,
      role: "Enterprise User",
      require_live_neo4j: requireLiveNeo4j,
    };

    const hybridEvidence = await unifiedGraphRepository.hybridRetrieve({
      query,
      validTime: asOfDate,
      limit: 6,
      ctx,
    });

    const threeRRes = reg24Core.execute3RGraphRAGQuery({
      query,
      as_of_date: asOfDate,
      known_at_date: "2026-10-19",
    });

    return NextResponse.json({
      ...threeRRes,
      neo4j_graph_persistence: {
        requirement_id: "REG24-INFRA-NEO4J-001",
        schema_version: NEO4J_SCHEMA_VERSION,
        storage_backend: hybridEvidence.storage_backend,
        degraded_mode: hybridEvidence.degraded_mode,
        degraded_warning: hybridEvidence.degraded_warning,
        tenant_id: tenantId,
      },
    });
  } catch (err) {
    if (err instanceof GraphUnavailableError) {
      return NextResponse.json(
        {
          status: "service_unavailable",
          code: err.code,
          message: err.message,
          sanitized_reason: err.sanitizedReason,
          degraded_fallback_permitted: false,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
