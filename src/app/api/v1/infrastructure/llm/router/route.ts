import { NextRequest, NextResponse } from "next/server";
import {
  model24Engine,
  SimulatorJobPreset,
} from "@/core/llm/model24-engine";

/**
 * REG24 — Model24 Intelligent LLM Integration & Model Routing API
 * GET & POST /api/v1/infrastructure/llm/router
 */
export async function GET() {
  return NextResponse.json(model24Engine.getDashboardSnapshot());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "simulate_routing";
    const actorRole =
      req.headers.get("x-reg24-role") || body.role || "Platform Administrator";

    if (action === "simulate_routing") {
      const preset = (body.preset || "complex_tax_restructuring") as SimulatorJobPreset;
      const simulation = model24Engine.simulateTaskRouting(preset);
      return NextResponse.json({
        status: "ok",
        action,
        simulation,
        snapshot: model24Engine.getDashboardSnapshot(),
      });
    }

    if (action === "update_policy") {
      const updatedPolicy = model24Engine.updateControlPolicy(
        body.policy_patch || {},
        actorRole
      );
      return NextResponse.json({
        status: "ok",
        action,
        control_policy: updatedPolicy,
        snapshot: model24Engine.getDashboardSnapshot(),
      });
    }

    if (action === "execute_task") {
      const result = model24Engine.executeLegalLLMTaskSync({
        query: body.query || "Analyze tax neutrality for a company merger under CCC Sec. 1238 and Revenue Code Sec. 74.",
        task_type: body.task_type,
        tenant_id: body.tenant_id || "tenant.law24.prod",
        legal_module_id: body.legal_module_id || "reg24.tax.th",
        data_sensitivity: body.data_sensitivity || "PRIVILEGED_LEGAL_OPINION",
        as_of_date: body.as_of_date || "2026-10-20",
        candidate_citations_to_verify: body.candidate_citations_to_verify,
        simulated_outage_providers: body.simulated_outage_providers,
        required_context_tokens: body.required_context_tokens,
      });
      return NextResponse.json({
        status: "ok",
        action,
        execution: result,
        snapshot: model24Engine.getDashboardSnapshot(),
      });
    }

    if (action === "register_model") {
      if (actorRole !== "Platform Administrator") {
        return NextResponse.json(
          { status: "forbidden", message: "Only Platform Administrator can register models." },
          { status: 403 }
        );
      }
      const entry = model24Engine.registerModel(body.model);
      return NextResponse.json({
        status: "ok",
        action,
        registered_model: entry,
        snapshot: model24Engine.getDashboardSnapshot(),
      });
    }

    return NextResponse.json(
      { status: "error", message: `Unsupported action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("SECURITY_VIOLATION_RBAC") ? 403 : 400;
    return NextResponse.json({ status: "error", message }, { status });
  }
}
