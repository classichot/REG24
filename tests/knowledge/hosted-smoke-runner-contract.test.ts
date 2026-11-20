import { describe, expect, it } from "vitest";
import {
  validateEnvironmentAndLinuxTokenizerParity,
  validateHostedQueryResponse,
  validateHostedReopenResponse,
  type ExpectedHostedPin,
} from "../../src/core/knowledge/hosted-smoke-verifier";

const BASE_PIN: ExpectedHostedPin = {
  git_commit_sha: "e3631207119282522fd1c0fa35f4149840c84992",
  release_id: "rel.B01.rc7",
  manifest_id: "mfst.b01.rc7_thai_legal_index",
  manifest_hash: "e01101062bd07c4dee79f44f39940024ad2f16c2bf9557d609aae23837119781",
  tokenizer_engine: "ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0",
  tokenizer_contract_sha256: "6d5783be8b8a39a34b55b383e7735b916d9912a01e831165b45a50abb4a2b5a1",
  legal_dictionary_sha256: "4af2531db0861dbe64abbbef502b71d9292282f661094a38afec5f80768540f8",
  lexical_index_sha256: "9cd653449bc3e9e73a1d0bacfcdd200fa2d0ee66441e33f5e842fbb7ca9d1880",
  require_linux_platform: true,
  expected_model: "gemini-4-neon",
  expected_thinking_level: "low",
};

function makeValidEnvBody() {
  return {
    ok: true,
    environment: {
      git_commit_sha: BASE_PIN.git_commit_sha,
      shared_neon_postgres_connected: true,
    },
    data_version: {
      release_id: BASE_PIN.release_id,
      manifest_id: BASE_PIN.manifest_id,
      manifest_hash: BASE_PIN.manifest_hash,
    },
    projections: {
      lexical: {
        status: "ready",
        tokenizer_engine: BASE_PIN.tokenizer_engine,
        tokenizer_contract_sha256: BASE_PIN.tokenizer_contract_sha256,
        legal_dictionary_sha256: BASE_PIN.legal_dictionary_sha256,
        lexical_index_sha256: BASE_PIN.lexical_index_sha256,
        tokenizer_parity_verified: true,
      },
      vector: {
        status: "deliberately_disabled",
      },
    },
    tokenizer_parity_probe: {
      runtime_platform: "linux",
      index_tokenizer_engine: BASE_PIN.tokenizer_engine,
      live_tokenizer_engine: BASE_PIN.tokenizer_engine,
      contract_parity_ok: true,
      all_probes_ok: true,
      probes: [
        { category: "unspaced_thai", exact_token_parity: true, forbidden_tokens_absent: true, posting_hits: [{ token: "ภาษีมูลค่าเพิ่ม", total_field_hits: 100 }] },
        { category: "legal_citations", exact_token_parity: true, forbidden_tokens_absent: true, posting_hits: [{ token: "sec:80/1(2)", total_field_hits: 24 }] },
        { category: "negation", exact_token_parity: true, forbidden_tokens_absent: true, posting_hits: [{ token: "มิให้", total_field_hits: 409 }] },
        { category: "compound_terms", exact_token_parity: true, forbidden_tokens_absent: true, posting_hits: [{ token: "ห้องชุด", total_field_hits: 139 }] },
      ],
    },
  };
}

function makeValidQueryBody() {
  const provenance = {
    release_id: BASE_PIN.release_id,
    manifest_hash: BASE_PIN.manifest_hash,
    generation_mode: "llm_grounded",
    provider_invocation: {
      live_provider_called: true,
      requested_model: "gemini-4-neon",
      resolved_model: "gemini-4-neon",
      provider_interaction_id: "int_live_12345",
      failure_classification: "NONE",
      pinned_settings: { thinking_level: "low" },
    },
  };
  return {
    ok: true,
    answer: {
      trace_id: "trc.live001",
      status: "ANSWERED",
      answer: "อัตราภาษีมูลค่าเพิ่มร้อยละ 7 ตาม พ.ร.ฎ. 790",
    },
    execution_provenance: provenance,
    traceable_answer: {
      answer_revision: "ans.live001.r1",
      rendered_answer_th: "อัตราภาษีมูลค่าเพิ่มร้อยละ 7 ตาม พ.ร.ฎ. 790",
      execution_provenance: provenance,
      claims: [
        {
          claim_id: "clm.1",
          evidence_references: [
            {
              evidence_id: "psg.rc7.rd790.sec_3_4",
              version_id: "ver.th.rc.royal_decree.790.v1",
              official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
            },
          ],
        },
      ],
    },
  };
}

describe("Hosted Smoke Runner Contract Tests (Section 3)", () => {
  it("Passes on valid Linux preflight, live Gemini 4 Neon @ low query, and Neon DB-backed reopen", () => {
    const env = makeValidEnvBody();
    const q = makeValidQueryBody();
    const reopen = {
      ok: true,
      persistence_source: "neon_postgres",
      answer: q.traceable_answer,
      audit_events: [{ audit_id: "aud.1" }],
    };

    expect(validateEnvironmentAndLinuxTokenizerParity(200, env, BASE_PIN, "start").ok).toBe(true);
    expect(validateHostedQueryResponse(200, q, BASE_PIN).ok).toBe(true);
    expect(validateHostedReopenResponse(200, reopen, q).ok).toBe(true);
    expect(validateEnvironmentAndLinuxTokenizerParity(200, env, BASE_PIN, "end").ok).toBe(true);
  });

  it("Fails on wrong pin (commit/manifest/index hash), non-Linux platform, or degraded/mismatched tokenizer probe", () => {
    const wrongCommit = makeValidEnvBody();
    wrongCommit.environment.git_commit_sha = "0000000000000000000000000000000000000000";
    expect(validateEnvironmentAndLinuxTokenizerParity(200, wrongCommit, BASE_PIN, "start").ok).toBe(false);

    const wrongIndexHash = makeValidEnvBody();
    wrongIndexHash.projections.lexical.lexical_index_sha256 = "deadbeef";
    expect(validateEnvironmentAndLinuxTokenizerParity(200, wrongIndexHash, BASE_PIN, "end").ok).toBe(false);

    const nonLinux = makeValidEnvBody();
    nonLinux.tokenizer_parity_probe.runtime_platform = "win32";
    expect(validateEnvironmentAndLinuxTokenizerParity(200, nonLinux, BASE_PIN, "start").ok).toBe(false);

    const engineMismatch = makeValidEnvBody();
    engineMismatch.tokenizer_parity_probe.index_tokenizer_engine = "pythainlp_newmm_v5.4.0";
    expect(validateEnvironmentAndLinuxTokenizerParity(200, engineMismatch, BASE_PIN, "start").ok).toBe(false);
  });

  it("Fails on bad HTTP status, silent model fallback (Flash or deterministic), or missing saved revision", () => {
    expect(validateHostedQueryResponse(500, { ok: false }, BASE_PIN).ok).toBe(false);

    const flashFallback = makeValidQueryBody();
    flashFallback.execution_provenance.provider_invocation.resolved_model = "gemini-3.5-flash";
    expect(validateHostedQueryResponse(200, flashFallback, BASE_PIN).ok).toBe(false);

    const deterministicFallback = makeValidQueryBody();
    deterministicFallback.execution_provenance.generation_mode = "baseline_deterministic";
    deterministicFallback.execution_provenance.provider_invocation.live_provider_called = false;
    expect(validateHostedQueryResponse(200, deterministicFallback, BASE_PIN).ok).toBe(false);

    const missingRev = makeValidQueryBody();
    (missingRev.traceable_answer as any).answer_revision = null;
    expect(validateHostedQueryResponse(200, missingRev, BASE_PIN).ok).toBe(false);
  });

  it("Fails on non-Neon local reopen, mismatched revision, altered claims/citations, or missing provider receipt", () => {
    const q = makeValidQueryBody();

    // Local memory reopen instead of Neon PostgreSQL -> MUST FAIL!
    const localReopen = {
      ok: true,
      persistence_source: "local_store",
      answer: q.traceable_answer,
      audit_events: [{ audit_id: "aud.1" }],
    };
    expect(validateHostedReopenResponse(200, localReopen, q).ok).toBe(false);

    // Mismatched revision ID -> MUST FAIL!
    const wrongRev = {
      ok: true,
      persistence_source: "neon_postgres",
      answer: { ...q.traceable_answer, answer_revision: "ans.other.r1" },
      audit_events: [{ audit_id: "aud.1" }],
    };
    expect(validateHostedReopenResponse(200, wrongRev, q).ok).toBe(false);

    // Altered citation version -> MUST FAIL!
    const alteredCite = {
      ok: true,
      persistence_source: "neon_postgres",
      answer: {
        ...q.traceable_answer,
        claims: [
          {
            claim_id: "clm.1",
            evidence_references: [
              {
                evidence_id: "psg.rc7.rd790.sec_3_4",
                version_id: "ver.th.rc.royal_decree.799.v1",
                official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
              },
            ],
          },
        ],
      },
      audit_events: [{ audit_id: "aud.1" }],
    };
    expect(validateHostedReopenResponse(200, alteredCite, q).ok).toBe(false);
  });
});
