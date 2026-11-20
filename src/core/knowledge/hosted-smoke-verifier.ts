/**
 * REG24 — Hosted Protected Preview Smoke & Linux Tokenizer Parity Contract Verifier
 *
 * Pure, testable verification logic shared by `scripts/run-hosted-rc10-smoke.ts` and
 * `tests/knowledge/hosted-smoke-runner-contract.test.ts`.
 *
 * Hard failure guarantees (nonzero exit on ANY failure):
 *   - Wrong pinned commit SHA, release ID, manifest hash, tokenizer contract hash, or lexical index hash
 *   - Start-vs-end build drift on preview
 *   - Missing, incompatible, or non-Linux tokenizer parity probe
 *   - Bad HTTP status or malformed response body
 *   - Silent model fallback (requires live `gemini-4-neon` at `low` with `live_provider_called: true`)
 *   - Missing saved revision ID
 *   - Reopen via `GET /api/v1/knowledge/answers/:id?require_db=1` failing `ok: true`, `persistence_source: "neon_postgres"`,
 *     or mismatching revision ID, rendered answer, claims, citations, or execution provenance
 */

export interface ExpectedHostedPin {
  git_commit_sha: string;
  release_id: string;
  manifest_id: string;
  manifest_hash: string;
  tokenizer_engine: string;
  tokenizer_contract_sha256: string;
  legal_dictionary_sha256: string;
  lexical_index_sha256: string;
  require_linux_platform?: boolean;
  expected_model?: string;
  expected_thinking_level?: "low" | "medium" | "high";
}

export interface HostedVerificationOutcome {
  ok: boolean;
  failures: string[];
  extracted?: Record<string, unknown>;
}

export function validateEnvironmentAndLinuxTokenizerParity(
  httpStatus: number,
  body: any,
  pin: ExpectedHostedPin,
  stageLabel: "start" | "end"
): HostedVerificationOutcome {
  const failures: string[] = [];
  if (httpStatus !== 200) {
    failures.push(`[${stageLabel}] HTTP status ${httpStatus} != 200`);
    return { ok: false, failures };
  }
  if (!body || body.ok !== true) {
    failures.push(`[${stageLabel}] environment payload missing ok=true`);
    return { ok: false, failures };
  }

  const env = body.environment || {};
  const dv = body.data_version || {};
  const lex = body.projections?.lexical || {};
  const vec = body.projections?.vector || {};

  if (env.git_commit_sha !== pin.git_commit_sha) {
    failures.push(`[${stageLabel}] commit SHA mismatch: got '${env.git_commit_sha}' != expected '${pin.git_commit_sha}'`);
  }
  if (dv.release_id !== pin.release_id) {
    failures.push(`[${stageLabel}] release_id mismatch: got '${dv.release_id}' != expected '${pin.release_id}'`);
  }
  if (dv.manifest_id !== pin.manifest_id) {
    failures.push(`[${stageLabel}] manifest_id mismatch: got '${dv.manifest_id}' != expected '${pin.manifest_id}'`);
  }
  if (dv.manifest_hash !== pin.manifest_hash) {
    failures.push(`[${stageLabel}] manifest_hash mismatch: got '${dv.manifest_hash}' != expected '${pin.manifest_hash}'`);
  }
  if (lex.status !== "ready") {
    failures.push(`[${stageLabel}] lexical projection not ready: status='${lex.status}' reason='${lex.reason}'`);
  }
  if (lex.tokenizer_engine !== pin.tokenizer_engine) {
    failures.push(`[${stageLabel}] tokenizer_engine mismatch: got '${lex.tokenizer_engine}' != expected '${pin.tokenizer_engine}'`);
  }
  if (lex.tokenizer_contract_sha256 !== pin.tokenizer_contract_sha256) {
    failures.push(`[${stageLabel}] tokenizer_contract_sha256 mismatch: got '${lex.tokenizer_contract_sha256}' != expected '${pin.tokenizer_contract_sha256}'`);
  }
  if (lex.legal_dictionary_sha256 !== pin.legal_dictionary_sha256) {
    failures.push(`[${stageLabel}] legal_dictionary_sha256 mismatch: got '${lex.legal_dictionary_sha256}' != expected '${pin.legal_dictionary_sha256}'`);
  }
  if (lex.lexical_index_sha256 !== pin.lexical_index_sha256) {
    failures.push(`[${stageLabel}] lexical_index_sha256 mismatch: got '${lex.lexical_index_sha256}' != expected '${pin.lexical_index_sha256}'`);
  }
  if (lex.tokenizer_parity_verified !== true) {
    failures.push(`[${stageLabel}] lexical tokenizer_parity_verified is not true`);
  }
  if (vec.status !== "deliberately_disabled") {
    failures.push(`[${stageLabel}] expected vector.status='deliberately_disabled', got '${vec.status}'`);
  }
  if (env.shared_neon_postgres_connected !== true) {
    failures.push(`[${stageLabel}] shared_neon_postgres_connected is not true`);
  }

  if (stageLabel === "start") {
    const probe = body.tokenizer_parity_probe;
    if (!probe) {
      failures.push(`[start] missing tokenizer_parity_probe payload (?probe_tokenizer=1)`);
    } else {
      if (pin.require_linux_platform !== false && probe.runtime_platform !== "linux") {
        failures.push(`[start] expected runtime_platform='linux' on hosted preview, got '${probe.runtime_platform}'`);
      }
      if (probe.contract_parity_ok !== true) {
        failures.push(`[start] tokenizer_parity_probe.contract_parity_ok is false`);
      }
      if (probe.all_probes_ok !== true) {
        failures.push(`[start] tokenizer_parity_probe.all_probes_ok is false`);
      }
      if (probe.index_tokenizer_engine !== probe.live_tokenizer_engine) {
        failures.push(
          `[start] index_tokenizer_engine ('${probe.index_tokenizer_engine}') != live_tokenizer_engine ('${probe.live_tokenizer_engine}')`
        );
      }
      const cats = new Set((probe.probes || []).map((p: any) => p.category));
      for (const reqCat of ["unspaced_thai", "legal_citations", "negation", "compound_terms"]) {
        if (!cats.has(reqCat)) {
          failures.push(`[start] tokenizer_parity_probe missing required category '${reqCat}'`);
        }
      }
      for (const p of probe.probes || []) {
        if (p.exact_token_parity !== true) {
          failures.push(`[start] probe '${p.category}' exact_token_parity is false`);
        }
        if (p.forbidden_tokens_absent !== true) {
          failures.push(`[start] probe '${p.category}' forbidden_tokens_absent is false`);
        }
        for (const hit of p.posting_hits || []) {
          if (!hit.total_field_hits || hit.total_field_hits <= 0) {
            failures.push(`[start] probe '${p.category}' token '${hit.token}' has 0 posting hits`);
          }
        }
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    extracted: {
      git_commit_sha: env.git_commit_sha,
      release_id: dv.release_id,
      manifest_hash: dv.manifest_hash,
      lexical_index_sha256: lex.lexical_index_sha256,
      runtime_platform: body.tokenizer_parity_probe?.runtime_platform ?? null,
    },
  };
}

export function validateHostedQueryResponse(
  httpStatus: number,
  body: any,
  pin: ExpectedHostedPin
): HostedVerificationOutcome {
  const failures: string[] = [];
  if (httpStatus !== 200) {
    failures.push(`[query] HTTP status ${httpStatus} != 200`);
    return { ok: false, failures };
  }
  if (!body || body.ok !== true || !body.answer) {
    failures.push(`[query] malformed response body (missing ok=true or answer object)`);
    return { ok: false, failures };
  }

  const answer = body.answer;
  const traceId = answer.trace_id;
  const answerStatus = answer.status;
  const prov = body.execution_provenance;
  const traceable = body.traceable_answer || answer.traceable_answer;
  const savedRevisionId = traceable?.answer_revision || null;

  if (!traceId || typeof traceId !== "string") {
    failures.push(`[query] missing answer.trace_id`);
  }
  if (answerStatus !== "ANSWERED" && answerStatus !== "CONDITIONAL") {
    failures.push(`[query] unexpected answer.status='${answerStatus}' (expected ANSWERED or CONDITIONAL)`);
  }
  if (!savedRevisionId || typeof savedRevisionId !== "string") {
    failures.push(`[query] missing saved revision ID in traceable_answer.answer_revision`);
  }
  if (!prov || typeof prov !== "object") {
    failures.push(`[query] missing top-level execution_provenance`);
  } else {
    const expectedModel = pin.expected_model || "gemini-4-neon";
    const expectedThinking = pin.expected_thinking_level || "low";
    if (prov.release_id !== pin.release_id) {
      failures.push(`[query] execution_provenance.release_id='${prov.release_id}' != '${pin.release_id}'`);
    }
    if (prov.manifest_hash !== pin.manifest_hash) {
      failures.push(`[query] execution_provenance.manifest_hash mismatch`);
    }
    if (prov.generation_mode !== "llm_grounded") {
      failures.push(`[query] silent fallback detected: generation_mode='${prov.generation_mode}' != 'llm_grounded'`);
    }
    const pi = prov.provider_invocation;
    if (!pi || pi.live_provider_called !== true) {
      failures.push(`[query] silent fallback detected: provider_invocation.live_provider_called is not true`);
    } else {
      const resolved = String(pi.resolved_model || pi.actual_model_invoked || "");
      if (!resolved.includes(expectedModel)) {
        failures.push(`[query] model fallback detected: resolved_model='${resolved}' does not match '${expectedModel}'`);
      }
      if (pi.pinned_settings?.thinking_level !== expectedThinking) {
        failures.push(
          `[query] thinking_level mismatch: got '${pi.pinned_settings?.thinking_level}' != '${expectedThinking}'`
        );
      }
      if (pi.failure_classification && pi.failure_classification !== "NONE") {
        failures.push(`[query] provider failure_classification='${pi.failure_classification}'`);
      }
      if (!pi.provider_interaction_id) {
        failures.push(`[query] missing provider_interaction_id receipt from live provider`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    extracted: {
      trace_id: traceId,
      answer_status: answerStatus,
      saved_revision_id: savedRevisionId,
      provider_interaction_id: prov?.provider_invocation?.provider_interaction_id || null,
      resolved_model: prov?.provider_invocation?.resolved_model || null,
      thinking_level: prov?.provider_invocation?.pinned_settings?.thinking_level || null,
      claim_count: traceable?.claims?.length ?? 0,
    },
  };
}

export function validateHostedReopenResponse(
  reopenHttpStatus: number,
  reopenBody: any,
  queryBody: any
): HostedVerificationOutcome {
  const failures: string[] = [];
  if (reopenHttpStatus !== 200) {
    failures.push(`[reopen] HTTP status ${reopenHttpStatus} != 200`);
    return { ok: false, failures };
  }
  if (!reopenBody || reopenBody.ok !== true || !reopenBody.answer) {
    failures.push(`[reopen] malformed reopen body (missing ok=true or answer)`);
    return { ok: false, failures };
  }
  if (reopenBody.persistence_source !== "neon_postgres") {
    failures.push(
      `[reopen] NOT a verified Neon PostgreSQL read: persistence_source='${reopenBody.persistence_source}' != 'neon_postgres'`
    );
  }

  const origTraceable = queryBody?.traceable_answer || queryBody?.answer?.traceable_answer;
  const origProv = queryBody?.execution_provenance;
  const reopened = reopenBody.answer;

  if (!origTraceable?.answer_revision || reopened.answer_revision !== origTraceable.answer_revision) {
    failures.push(
      `[reopen] revision mismatch: reopened='${reopened.answer_revision}' != saved='${origTraceable?.answer_revision}'`
    );
  }
  if (reopened.rendered_answer_th !== origTraceable?.rendered_answer_th) {
    failures.push(`[reopen] rendered_answer_th mismatch after DB reopen`);
  }
  const origClaimIds = (origTraceable?.claims || []).map((c: any) => c.claim_id);
  const reopenClaimIds = (reopened.claims || []).map((c: any) => c.claim_id);
  if (JSON.stringify(origClaimIds) !== JSON.stringify(reopenClaimIds)) {
    failures.push(`[reopen] claim_id sequence mismatch after DB reopen`);
  }
  const origEvIds = (origTraceable?.claims || []).flatMap((c: any) =>
    (c.evidence_references || []).map((r: any) => `${r.evidence_id}:${r.version_id}:${r.official_url}`)
  );
  const reopenEvIds = (reopened.claims || []).flatMap((c: any) =>
    (c.evidence_references || []).map((r: any) => `${r.evidence_id}:${r.version_id}:${r.official_url}`)
  );
  if (JSON.stringify(origEvIds) !== JSON.stringify(reopenEvIds)) {
    failures.push(`[reopen] citation evidence/version/URL mismatch after DB reopen`);
  }
  const reopenedProv = reopened.execution_provenance;
  if (!reopenedProv) {
    failures.push(`[reopen] missing execution_provenance on reopened revision`);
  } else {
    if (
      origProv?.provider_invocation?.provider_interaction_id &&
      reopenedProv?.provider_invocation?.provider_interaction_id !==
        origProv.provider_invocation.provider_interaction_id
    ) {
      failures.push(`[reopen] provider_interaction_id mismatch on reopened revision`);
    }
    if (origProv?.manifest_hash && reopenedProv.manifest_hash !== origProv.manifest_hash) {
      failures.push(`[reopen] execution_provenance.manifest_hash mismatch on reopened revision`);
    }
  }
  if (!Array.isArray(reopenBody.audit_events) || reopenBody.audit_events.length === 0) {
    failures.push(`[reopen] missing audit_events on reopened DB revision`);
  }

  return {
    ok: failures.length === 0,
    failures,
    extracted: {
      persistence_source: reopenBody.persistence_source,
      answer_revision: reopened.answer_revision,
      claim_count: reopenClaimIds.length,
      citation_count: reopenEvIds.length,
      audit_event_count: reopenBody.audit_events?.length ?? 0,
      provider_interaction_id: reopenedProv?.provider_invocation?.provider_interaction_id ?? null,
    },
  };
}
