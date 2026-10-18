import { NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

/**
 * REG-A2A-005: Standard A2A v1.0 Agent Card Discovery Endpoint (/.well-known/agent.json)
 */
export async function GET() {
  return NextResponse.json(reg24Core.getA2AAgentCard());
}
