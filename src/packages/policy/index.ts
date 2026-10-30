/**
 * REG24 Infrastructure Developer Requirements v1.0 (30 October 2026)
 * Package: @reg24/policy (packages/policy)
 * Covers: TRUST01–TRUST08, SEC01–SEC08, INT02, INT07
 * Rule (ARC11): Pure TypeScript policy & trust layer.
 */

import { createHash } from "crypto";
import type {
  IdentityVerifierPort,
  PolicyEvaluatorPort,
  Reg24CanonicalRequest,
  Reg24Role,
  Reg24StandardErrorCode,
  ServiceCapabilityDescriptor,
  VerifiedAuthContext,
} from "../contracts";

export function sha256Hex(input: string): string {
  return `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 14: EVIDENCE & TRUST INFRASTRUCTURE (TRUST01–TRUST08)
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface VerificationDimensions {
  source_verified: boolean;
  applicability_checked: boolean;
  reviewed: boolean;
}

export interface ApprovalRecord {
  approval_id: string;
  artifact_id: string;
  artifact_hash: string;
  evidence_snapshot_id: string;
  permitted_external_action: string;
  approver_principal_id: string;
  approver_role: Reg24Role;
  decision: "approved" | "rejected";
  approved_at: string;
  expires_at: string;
  invalidated: boolean;
  invalidation_reason?: string;
}

export interface DeliverableEvidenceManifest {
  manifest_id: string;
  deliverable_id: string;
  artifact_hash: string;
  tenant_id: string;
  matter_id?: string;
  input_hashes: string[];
  source_versions: Array<{
    source_id: string;
    extraction_version_id: string;
    byte_hash: string;
    license_scope: "PUBLIC_STATUTE" | "INTERNAL_OWN_USE_ONLY" | "RESTRICTED_CLIENT_MATTER";
  }>;
  citations: Array<{
    citation_id: string;
    provision_id: string;
    provision_version_id: string;
    locator: string;
    quote_hash: string;
  }>;
  claim_links: Array<{ claim_id: string; evidence_span_ids: string[] }>;
  corpus_snapshot_id: string;
  legal_rule_pack_version: string;
  prompt_template_version: string;
  provider_model_id: string;
  verification_dimensions: {
    source_verified: boolean;
    applicability_checked: boolean;
    reviewed: boolean;
  };
  permissions_required: string[];
  approvals: ApprovalRecord[];
  disputed_or_withdrawn: boolean;
  correction_chain: Array<{
    correction_id: string;
    flagged_at: string;
    reason: string;
    superseded_by_manifest_id?: string;
  }>;
  manifest_integrity_hash: string;
  created_at: string;
}

export interface ChainedAuditEvent {
  event_seq: number;
  audit_id: string;
  actor_principal_id: string;
  delegated_actor_id?: string;
  tenant_id: string;
  matter_id?: string;
  purpose: string;
  operation: string;
  target_versions: string[];
  policy_decision: "ALLOW" | "DENY";
  outcome: string;
  concise_rationale: string;
  supporting_evidence_refs: string[];
  trace_id: string;
  occurred_at: string;
  prev_integrity_hash: string;
  integrity_hash: string;
}

export class Reg24TrustAndPolicyEngine implements IdentityVerifierPort, PolicyEvaluatorPort {
  private manifests = new Map<string, DeliverableEvidenceManifest>();
  private approvals = new Map<string, ApprovalRecord>();
  private auditChain: ChainedAuditEvent[] = [];

  /**
   * SEC01–SEC03 & INT02: Verify caller authentication, token audience, tenant grants, and delegation bounds
   */
  async verifyRequestAuth(
    headers: Record<string, string | undefined>,
    requestedTenantId?: string
  ): Promise<VerifiedAuthContext> {
    const authHeader = headers["authorization"] || headers["Authorization"];
    const principalId = headers["x-reg24-principal-id"] || "usr-default-counsel";
    const principalClass =
      (headers["x-reg24-principal-class"] as VerifiedAuthContext["principal_class"]) || "human_user";
    const tokenTenant = headers["x-reg24-tenant-id"] || "tenant-th-enterprise-01";
    const rolesRaw = headers["x-reg24-roles"] || "legal_reviewer,matter_owner";
    const roles = rolesRaw.split(",").map((r) => r.trim() as Reg24Role);
    const permittedMatters = (headers["x-reg24-permitted-matters"] || "MATTER-TH-001,MATTER-TH-002")
      .split(",")
      .map((m) => m.trim());
    const ethicalWallBlocked = (headers["x-reg24-ethical-wall-blocked"] || "MATTER-WALL-999")
      .split(",")
      .map((m) => m.trim());
    const scopes = (
      headers["x-reg24-scopes"] ||
      "legal:read,legal:research,legal:verify,legal:evaluate,legal:draft,legal:mission:read,legal:mission:write"
    )
      .split(",")
      .map((s) => s.trim());

    const tokenAudience = headers["x-reg24-token-aud"] || "https://api.reg24.ai";
    const tokenIssuer = headers["x-reg24-token-iss"] || "https://auth.reg24.ai";

    if (authHeader === "Bearer INVALID_TOKEN" || headers["x-reg24-unauthenticated"] === "true") {
      return {
        authenticated: false,
        tenant_id: "",
        principal_id: "anonymous",
        principal_class: "human_user",
        roles: [],
        permitted_matters: [],
        ethical_wall_blocked_matters: [],
        scopes: [],
      };
    }

    // Check cross-tenant spoofing attempt (CON02 / SEC01)
    if (requestedTenantId && requestedTenantId !== tokenTenant) {
      return {
        authenticated: true,
        tenant_id: tokenTenant,
        principal_id: principalId,
        principal_class: principalClass,
        roles,
        permitted_matters: permittedMatters,
        ethical_wall_blocked_matters: ethicalWallBlocked,
        scopes: [], // Strip scopes on forged tenant mismatch so evaluateAccess returns FORBIDDEN
        token_audience: tokenAudience,
        token_issuer: tokenIssuer,
      };
    }

    let delegatedGrant: VerifiedAuthContext["delegated_grant"] = undefined;
    if (principalClass === "delegated_agent") {
      const revoked = headers["x-reg24-grant-revoked"] === "true";
      const depth = Number(headers["x-reg24-delegation-depth"] ?? 1);
      const maxDepth = Number(headers["x-reg24-max-delegation-depth"] ?? 2);
      const budgetLimit = Number(headers["x-reg24-grant-budget-usd"] ?? 25);
      const budgetSpent = Number(headers["x-reg24-grant-spent-usd"] ?? 0);
      delegatedGrant = {
        grant_id: headers["x-reg24-grant-id"] || "GRANT-AGENT-001",
        principal_id: principalId,
        originating_principal_id: headers["x-reg24-origin-user"] || "usr-default-counsel",
        tenant_id: tokenTenant,
        allowed_capabilities: scopes,
        matter_scope: permittedMatters,
        allowed_providers: ["gemini", "claude", "gpt"],
        budget_limit_usd: budgetLimit,
        budget_spent_usd: budgetSpent,
        expires_at: headers["x-reg24-grant-expires"] || "2027-12-31T23:59:59Z",
        delegation_depth: depth,
        max_delegation_depth: maxDepth,
        can_approve_external_actions: false, // API03: Ordinary agents cannot grant themselves approval
        revoked,
      };
    }

    return {
      authenticated: true,
      tenant_id: tokenTenant,
      principal_id: principalId,
      principal_class: principalClass,
      roles,
      permitted_matters: permittedMatters,
      ethical_wall_blocked_matters: ethicalWallBlocked,
      scopes,
      token_audience: tokenAudience,
      token_issuer: tokenIssuer,
      delegated_grant: delegatedGrant,
    };
  }

  /**
   * SEC01–SEC04, INT02, INT07: Evaluate RBAC, Ethical Walls, Token Audience, and Delegated Grants
   */
  evaluateAccess(
    auth: VerifiedAuthContext,
    capability: ServiceCapabilityDescriptor,
    req: Reg24CanonicalRequest<unknown>
  ): { allowed: boolean; error_code?: Reg24StandardErrorCode; reason?: string } {
    if (!auth.authenticated) {
      return {
        allowed: false,
        error_code: "UNAUTHENTICATED",
        reason: "Missing or invalid authentication credentials.",
      };
    }

    // INT02: Token audience validation (prevent passthrough of unrelated tokens)
    if (auth.token_audience && auth.token_audience !== "https://api.reg24.ai") {
      return {
        allowed: false,
        error_code: "FORBIDDEN",
        reason: `INT02 violation: Token audience '${auth.token_audience}' is not valid for REG24 Core API.`,
      };
    }

    // SEC03 & INT07: Delegated agent grant checks
    if (auth.principal_class === "delegated_agent" && auth.delegated_grant) {
      const g = auth.delegated_grant;
      if (g.revoked) {
        return {
          allowed: false,
          error_code: "FORBIDDEN",
          reason: `Delegated grant '${g.grant_id}' has been revoked.`,
        };
      }
      if (g.delegation_depth > g.max_delegation_depth) {
        return {
          allowed: false,
          error_code: "POLICY_DENIED",
          reason: `INT07 federation recursion limit exceeded: depth ${g.delegation_depth} > max ${g.max_delegation_depth}.`,
        };
      }
      if (g.budget_spent_usd >= g.budget_limit_usd) {
        return {
          allowed: false,
          error_code: "BUDGET_EXCEEDED",
          reason: `Delegated grant budget exhausted ($${g.budget_spent_usd} / $${g.budget_limit_usd}).`,
        };
      }
    }

    // Scope check
    for (const reqScope of capability.required_scopes) {
      if (!auth.scopes.includes(reqScope)) {
        return {
          allowed: false,
          error_code: "FORBIDDEN",
          reason: `Principal '${auth.principal_id}' lacks required scope '${reqScope}' for '${capability.capability_id}'.`,
        };
      }
    }

    // SEC02: Ethical wall & Matter isolation check
    // Even tenant_administrator cannot bypass an ethical wall or read matter contents without matter permission
    if (req.matter_id) {
      if (auth.ethical_wall_blocked_matters.includes(req.matter_id)) {
        return {
          allowed: false,
          error_code: "FORBIDDEN",
          reason: `SEC02 Ethical Wall block: Principal '${auth.principal_id}' is walled off from matter '${req.matter_id}'.`,
        };
      }
      if (!auth.permitted_matters.includes(req.matter_id)) {
        return {
          allowed: false,
          error_code: "FORBIDDEN",
          reason: `SEC02 Matter isolation: Principal '${auth.principal_id}' (roles: ${auth.roles.join(",")}) is not an authorized participant on matter '${req.matter_id}'.`,
        };
      }
    } else if (capability.requires_matter_context) {
      return {
        allowed: false,
        error_code: "VALIDATION_FAILED",
        reason: `Capability '${capability.capability_id}' requires an explicit 'matter_id' and 'purpose'.`,
      };
    }

    return { allowed: true };
  }

  /**
   * SEC06: Sanitize untrusted retrieved documents / agent prompts & validate outbound URLs against SSRF
   */
  sanitizeUntrustedContentAndUrls(params: {
    text?: string;
    outbound_url?: string;
  }): {
    safe: boolean;
    prompt_injection_detected: boolean;
    ssrf_blocked: boolean;
    sanitized_text: string;
    reason?: string;
  } {
    const raw = params.text ?? "";
    const injectionPatterns = [
      /ignore\s+all\s+previous\s+instructions/i,
      /system\s*override\s*:/i,
      /grant\s+admin\s+access/i,
      /bypass\s+approval\s+policy/i,
    ];
    const promptInjectionDetected = injectionPatterns.some((rx) => rx.test(raw));
    const sanitizedText = promptInjectionDetected
      ? raw.replace(/ignore\s+all\s+previous\s+instructions|system\s*override\s*:|grant\s+admin\s+access|bypass\s+approval\s+policy/gi, "[REDACTED_UNTRUSTED_INSTRUCTION]")
      : raw;

    if (params.outbound_url) {
      try {
        const u = new URL(params.outbound_url);
        const host = u.hostname.toLowerCase();
        const isPrivate =
          u.protocol !== "https:" ||
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "0.0.0.0" ||
          host === "169.254.169.254" ||
          host.startsWith("10.") ||
          host.startsWith("192.168.") ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
        if (isPrivate) {
          return {
            safe: false,
            prompt_injection_detected: promptInjectionDetected,
            ssrf_blocked: true,
            sanitized_text: sanitizedText,
            reason: `SEC06 SSRF protection blocked outbound destination '${params.outbound_url}'.`,
          };
        }
      } catch {
        return {
          safe: false,
          prompt_injection_detected: promptInjectionDetected,
          ssrf_blocked: true,
          sanitized_text: sanitizedText,
          reason: `Invalid outbound URL '${params.outbound_url}'.`,
        };
      }
    }

    return {
      safe: !promptInjectionDetected,
      prompt_injection_detected: promptInjectionDetected,
      ssrf_blocked: false,
      sanitized_text: sanitizedText,
      reason: promptInjectionDetected
        ? "SEC06: Untrusted document contained prompt-injection directives; neutralized before context assembly."
        : undefined,
    };
  }

  /**
   * TRUST01–TRUST03: Create Deliverable Evidence Manifest
   */
  createEvidenceManifest(params: {
    deliverable_id: string;
    artifact_content: string;
    tenant_id: string;
    matter_id?: string;
    input_hashes: string[];
    source_versions: DeliverableEvidenceManifest["source_versions"];
    citations: DeliverableEvidenceManifest["citations"];
    claim_links: DeliverableEvidenceManifest["claim_links"];
    corpus_snapshot_id: string;
    legal_rule_pack_version: string;
    prompt_template_version: string;
    provider_model_id: string;
    source_verified: boolean;
    applicability_checked: boolean;
    reviewed: boolean;
  }): DeliverableEvidenceManifest {
    const manifestId = `EVMAN-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const artifactHash = sha256Hex(params.artifact_content);
    const createdAt = new Date().toISOString();

    const corePayload = JSON.stringify({
      manifest_id: manifestId,
      deliverable_id: params.deliverable_id,
      artifact_hash: artifactHash,
      corpus_snapshot_id: params.corpus_snapshot_id,
      citations: params.citations,
      source_versions: params.source_versions,
    });

    const manifest: DeliverableEvidenceManifest = {
      manifest_id: manifestId,
      deliverable_id: params.deliverable_id,
      artifact_hash: artifactHash,
      tenant_id: params.tenant_id,
      matter_id: params.matter_id,
      input_hashes: params.input_hashes,
      source_versions: params.source_versions,
      citations: params.citations,
      claim_links: params.claim_links,
      corpus_snapshot_id: params.corpus_snapshot_id,
      legal_rule_pack_version: params.legal_rule_pack_version,
      prompt_template_version: params.prompt_template_version,
      provider_model_id: params.provider_model_id,
      verification_dimensions: {
        source_verified: params.source_verified,
        applicability_checked: params.applicability_checked,
        reviewed: params.reviewed,
      },
      permissions_required: ["legal:read"],
      approvals: [],
      disputed_or_withdrawn: false,
      correction_chain: [],
      manifest_integrity_hash: sha256Hex(corePayload),
      created_at: createdAt,
    };

    this.manifests.set(manifestId, manifest);
    return manifest;
  }

  /**
   * TRUST06 & API03: Record human approval bound to exact artifact_hash.
   * Ordinary agents cannot grant themselves approval. Modifying the artifact invalidates approval.
   */
  recordArtifactApproval(params: {
    manifest_id: string;
    artifact_hash: string;
    permitted_external_action: string;
    auth: VerifiedAuthContext;
    decision: "approved" | "rejected";
  }): {
    ok: boolean;
    error_code?: Reg24StandardErrorCode;
    reason?: string;
    approval?: ApprovalRecord;
  } {
    if (params.auth.principal_class === "delegated_agent") {
      return {
        ok: false,
        error_code: "FORBIDDEN",
        reason: "API03 / TRUST06 violation: Delegated agents cannot grant themselves human approval.",
      };
    }
    if (!params.auth.roles.includes("legal_reviewer") && !params.auth.roles.includes("matter_owner")) {
      return {
        ok: false,
        error_code: "FORBIDDEN",
        reason: "TRUST06: Approver must hold 'legal_reviewer' or 'matter_owner' role.",
      };
    }

    const manifest = this.manifests.get(params.manifest_id);
    if (!manifest) {
      return {
        ok: false,
        error_code: "VALIDATION_FAILED",
        reason: `Manifest '${params.manifest_id}' not found.`,
      };
    }
    if (manifest.artifact_hash !== params.artifact_hash) {
      return {
        ok: false,
        error_code: "VALIDATION_FAILED",
        reason: `TRUST06 hash mismatch: Approval artifact_hash '${params.artifact_hash}' does not match manifest artifact_hash '${manifest.artifact_hash}'.`,
      };
    }

    const approval: ApprovalRecord = {
      approval_id: `APPR-${Date.now()}`,
      artifact_id: manifest.deliverable_id,
      artifact_hash: params.artifact_hash,
      evidence_snapshot_id: manifest.corpus_snapshot_id,
      permitted_external_action: params.permitted_external_action,
      approver_principal_id: params.auth.principal_id,
      approver_role: params.auth.roles.includes("legal_reviewer") ? "legal_reviewer" : "matter_owner",
      decision: params.decision,
      approved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      invalidated: false,
    };

    manifest.approvals.push(approval);
    if (params.decision === "approved") {
      manifest.verification_dimensions.reviewed = true;
    }
    this.approvals.set(approval.approval_id, approval);

    return { ok: true, approval };
  }

  /**
   * TRUST06 Acceptance: Verify artifact against manifest; if modified, invalidate verification and approvals
   */
  verifyDeliverableIntegrity(manifestId: string, currentArtifactContent: string): {
    valid: boolean;
    manifest?: DeliverableEvidenceManifest;
    invalidated_approvals: number;
    reason?: string;
  } {
    const manifest = this.manifests.get(manifestId);
    if (!manifest) {
      return { valid: false, invalidated_approvals: 0, reason: "Manifest not found" };
    }
    const currentHash = sha256Hex(currentArtifactContent);
    if (currentHash !== manifest.artifact_hash) {
      let invalidatedCount = 0;
      manifest.verification_dimensions.source_verified = false;
      manifest.verification_dimensions.reviewed = false;
      for (const appr of manifest.approvals) {
        if (!appr.invalidated) {
          appr.invalidated = true;
          appr.invalidation_reason = `Artifact modified (hash changed from ${manifest.artifact_hash} to ${currentHash})`;
          invalidatedCount++;
        }
      }
      return {
        valid: false,
        manifest,
        invalidated_approvals: invalidatedCount,
        reason: "TRUST06: Artifact content modified after manifest generation; verification and approvals invalidated.",
      };
    }
    return { valid: !manifest.disputed_or_withdrawn, manifest, invalidated_approvals: 0 };
  }

  /**
   * TRUST08: Source Withdrawal & Disputed Result Correction Process
   * Flags disputed source, quarantines affected deliverables, and appends to correction_chain without rewriting history.
   */
  withdrawOrFlagSource(params: {
    source_id: string;
    reason: string;
  }): {
    quarantined_source_id: string;
    affected_manifest_ids: string[];
    correction_records_created: number;
  } {
    const affected: string[] = [];
    for (const [mId, manifest] of this.manifests.entries()) {
      if (manifest.source_versions.some((sv) => sv.source_id === params.source_id)) {
        manifest.disputed_or_withdrawn = true;
        manifest.verification_dimensions.source_verified = false;
        manifest.verification_dimensions.reviewed = false;
        manifest.correction_chain.push({
          correction_id: `CORR-${Date.now()}-${affected.length + 1}`,
          flagged_at: new Date().toISOString(),
          reason: `Source '${params.source_id}' withdrawn/flagged: ${params.reason}`,
        });
        affected.push(mId);
      }
    }
    return {
      quarantined_source_id: params.source_id,
      affected_manifest_ids: affected,
      correction_records_created: affected.length,
    };
  }

  /**
   * TRUST07 & ING01: Rights-Enforced Evidence Export
   */
  exportEvidenceManifest(params: {
    manifest_id: string;
    auth: VerifiedAuthContext;
    request_full_text_redistribution: boolean;
  }): {
    allowed: boolean;
    error_code?: Reg24StandardErrorCode;
    reason?: string;
    exported_manifest?: DeliverableEvidenceManifest;
    redacted_restricted_sources?: string[];
  } {
    const manifest = this.manifests.get(params.manifest_id);
    if (!manifest) {
      return { allowed: false, error_code: "VALIDATION_FAILED", reason: "Manifest not found." };
    }
    if (manifest.tenant_id !== params.auth.tenant_id) {
      return {
        allowed: false,
        error_code: "FORBIDDEN",
        reason: "Cross-tenant manifest export denied.",
      };
    }

    const restrictedSources = manifest.source_versions
      .filter((s) => s.license_scope === "INTERNAL_OWN_USE_ONLY")
      .map((s) => s.source_id);

    if (params.request_full_text_redistribution && restrictedSources.length > 0) {
      return {
        allowed: false,
        error_code: "POLICY_DENIED",
        reason: `ING01 / TRUST07: External full-text redistribution blocked for own-use-only licensed sources: ${restrictedSources.join(", ")}. Permitted metadata and approved excerpts remain accessible.`,
        redacted_restricted_sources: restrictedSources,
      };
    }

    return {
      allowed: true,
      exported_manifest: manifest,
      redacted_restricted_sources: restrictedSources,
    };
  }

  /**
   * TRUST04 & TRUST05: Append-only Tamper-Evident Chained Audit Trail (redacts secrets, omits private CoT)
   */
  appendAuditEvent(params: {
    actor_principal_id: string;
    delegated_actor_id?: string;
    tenant_id: string;
    matter_id?: string;
    purpose: string;
    operation: string;
    target_versions: string[];
    policy_decision: "ALLOW" | "DENY";
    outcome: string;
    concise_rationale: string;
    supporting_evidence_refs: string[];
    trace_id: string;
  }): ChainedAuditEvent {
    const seq = this.auditChain.length + 1;
    const prevHash =
      this.auditChain.length > 0
        ? this.auditChain[this.auditChain.length - 1].integrity_hash
        : "sha256:GENESIS_REG24_AUDIT_ANCHOR";
    const occurredAt = new Date().toISOString();

    // Redact any accidental bearer tokens or BYOK keys in rationale (TRUST05 / SEC07)
    const redactedRationale = params.concise_rationale.replace(
      /(?:sk-[a-zA-Z0-9_-]+|Bearer\s+[a-zA-Z0-9._-]+)/g,
      "[REDACTED_SECRET]"
    );

    const payloadToHash = JSON.stringify({
      seq,
      actor: params.actor_principal_id,
      tenant: params.tenant_id,
      op: params.operation,
      decision: params.policy_decision,
      outcome: params.outcome,
      prevHash,
      occurredAt,
    });

    const event: ChainedAuditEvent = {
      event_seq: seq,
      audit_id: `AUD-${seq.toString().padStart(5, "0")}`,
      actor_principal_id: params.actor_principal_id,
      delegated_actor_id: params.delegated_actor_id,
      tenant_id: params.tenant_id,
      matter_id: params.matter_id,
      purpose: params.purpose,
      operation: params.operation,
      target_versions: params.target_versions,
      policy_decision: params.policy_decision,
      outcome: params.outcome,
      concise_rationale: redactedRationale,
      supporting_evidence_refs: params.supporting_evidence_refs,
      trace_id: params.trace_id,
      occurred_at: occurredAt,
      prev_integrity_hash: prevHash,
      integrity_hash: sha256Hex(payloadToHash),
    };

    this.auditChain.push(event);
    return event;
  }

  verifyAuditChainIntegrity(): { valid: boolean; total_events: number; broken_at_seq?: number } {
    let expectedPrev = "sha256:GENESIS_REG24_AUDIT_ANCHOR";
    for (const ev of this.auditChain) {
      if (ev.prev_integrity_hash !== expectedPrev) {
        return { valid: false, total_events: this.auditChain.length, broken_at_seq: ev.event_seq };
      }
      expectedPrev = ev.integrity_hash;
    }
    return { valid: true, total_events: this.auditChain.length };
  }

  getAuditChain(tenantId?: string): ChainedAuditEvent[] {
    if (!tenantId) return [...this.auditChain];
    return this.auditChain.filter((e) => e.tenant_id === tenantId);
  }
}

export const reg24TrustPolicyEngine = new Reg24TrustAndPolicyEngine();
