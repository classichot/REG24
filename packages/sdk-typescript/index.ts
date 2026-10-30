/**
 * REG24 Official TypeScript SDK (API04 / Gate G3)
 * Generated from OpenAPI 3.1 & MCP Tool Schema Catalogue (Section 10 & Section 11)
 */

import type {
  Reg24CanonicalRequest,
  Reg24CanonicalResult,
  Reg24CanonicalErrorEnvelope,
  ServiceCapabilityDescriptor,
} from "../../src/packages/contracts";

export interface Reg24SdkConfig {
  baseUrl: string;
  apiKey?: string;
  tenantId: string;
  workspaceId?: string;
  matterId?: string;
  jurisdictionCode?: "TH" | "SG" | string;
}

export class Reg24Client {
  private readonly config: Required<Omit<Reg24SdkConfig, "apiKey" | "matterId">> & {
    apiKey?: string;
    matterId?: string;
  };

  constructor(config: Reg24SdkConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ""),
      apiKey: config.apiKey,
      tenantId: config.tenantId,
      workspaceId: config.workspaceId ?? "workspace.law24.default",
      matterId: config.matterId,
      jurisdictionCode: config.jurisdictionCode ?? "TH",
    };
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "X-REG24-Tenant": this.config.tenantId,
      "X-REG24-Workspace": this.config.workspaceId,
    };
    if (this.config.matterId) h["X-REG24-Matter"] = this.config.matterId;
    if (this.config.apiKey) h["Authorization"] = `Bearer ${this.config.apiKey}`;
    if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
    return h;
  }

  public async getCapabilities(): Promise<{ capabilities: ServiceCapabilityDescriptor[] }> {
    const res = await fetch(`${this.config.baseUrl}/api/v1/capabilities`, {
      method: "GET",
      headers: this.headers(),
    });
    return res.json();
  }

  public async legalSearch(params: {
    query: string;
    legalAsOf: string;
    knownAsOf?: string;
  }): Promise<Reg24CanonicalResult | Reg24CanonicalErrorEnvelope> {
    const res = await fetch(`${this.config.baseUrl}/api/v1/legal/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        tenant_id: this.config.tenantId,
        workspace_id: this.config.workspaceId,
        matter_id: this.config.matterId ?? null,
        jurisdiction_code: this.config.jurisdictionCode,
        legal_as_of: params.legalAsOf,
        known_as_of: params.knownAsOf ?? params.legalAsOf,
        query: params.query,
      }),
    });
    return res.json();
  }

  public async getProvision(params: {
    provisionId: string;
    legalAsOf: string;
    knownAsOf?: string;
  }): Promise<Reg24CanonicalResult | Reg24CanonicalErrorEnvelope> {
    const qs = new URLSearchParams({
      legal_as_of: params.legalAsOf,
      known_as_of: params.knownAsOf ?? params.legalAsOf,
    });
    const res = await fetch(
      `${this.config.baseUrl}/api/v1/legal/provisions/${encodeURIComponent(params.provisionId)}?${qs.toString()}`,
      {
        method: "GET",
        headers: this.headers(),
      }
    );
    return res.json();
  }

  public async getProvisionHistory(params: {
    provisionId: string;
    legalAsOf?: string;
    knownAsOf?: string;
  }): Promise<Reg24CanonicalResult | Reg24CanonicalErrorEnvelope> {
    const qs = new URLSearchParams({
      legal_as_of: params.legalAsOf ?? "2026-10-30",
      known_as_of: params.knownAsOf ?? "2026-10-30",
    });
    const res = await fetch(
      `${this.config.baseUrl}/api/v1/legal/provisions/${encodeURIComponent(params.provisionId)}/history?${qs.toString()}`,
      {
        method: "GET",
        headers: this.headers(),
      }
    );
    return res.json();
  }

  public async legalResearch(params: {
    question: string;
    legalAsOf: string;
    knownAsOf?: string;
  }): Promise<Reg24CanonicalResult | Reg24CanonicalErrorEnvelope> {
    const res = await fetch(`${this.config.baseUrl}/api/v1/legal/research`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        tenant_id: this.config.tenantId,
        workspace_id: this.config.workspaceId,
        matter_id: this.config.matterId ?? null,
        jurisdiction_code: this.config.jurisdictionCode,
        legal_as_of: params.legalAsOf,
        known_as_of: params.knownAsOf ?? params.legalAsOf,
        question: params.question,
      }),
    });
    return res.json();
  }

  public async createMission(params: {
    objective: string;
    legalAsOf: string;
    beastMode?: "Introvert" | "Extrovert" | "Hyper";
    idempotencyKey: string;
  }): Promise<Reg24CanonicalResult | Reg24CanonicalErrorEnvelope> {
    const res = await fetch(`${this.config.baseUrl}/api/v1/missions`, {
      method: "POST",
      headers: this.headers(params.idempotencyKey),
      body: JSON.stringify({
        tenant_id: this.config.tenantId,
        workspace_id: this.config.workspaceId,
        matter_id: this.config.matterId ?? "matter.law24.ma.2026.01",
        jurisdiction_code: this.config.jurisdictionCode,
        legal_as_of: params.legalAsOf,
        known_as_of: params.legalAsOf,
        idempotency_key: params.idempotencyKey,
        objective: params.objective,
        beast_mode: params.beastMode ?? "Introvert",
      }),
    });
    return res.json();
  }
}

export type {
  Reg24CanonicalRequest,
  Reg24CanonicalResult,
  Reg24CanonicalErrorEnvelope,
  ServiceCapabilityDescriptor,
};
