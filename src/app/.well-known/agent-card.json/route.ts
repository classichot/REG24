import { NextResponse } from "next/server";
import { reg24A2AEngine } from "@/core/a2a/reg24-a2a-engine";

/**
 * Section 3.2: Public A2A 1.0 Agent Card Discovery Endpoint (/.well-known/agent-card.json)
 */
export async function GET() {
  return NextResponse.json(reg24A2AEngine.getPublicAgentCard(), {
    headers: {
      "A2A-Version": "1.0",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
