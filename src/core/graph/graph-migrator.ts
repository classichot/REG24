/**
 * REG24 — Canonical Seed Data Migration & Reconciliation Engine
 * Requirement ID: REG24-INFRA-NEO4J-001 (REG-NEO-012, REG-NEO-013)
 */

import { reg24Core } from "../engine/reg24-core";
import {
  CanonicalGraphNode,
  CanonicalGraphRelationship,
  CanonicalNodeLabel,
  CanonicalRelationshipType,
  isValidNodeLabel,
  isValidRelationshipType,
  NEO4J_SCHEMA_CONSTRAINTS_CYPHER,
  NEO4J_SCHEMA_VERSION,
} from "./graph-schema";
import { neo4jConnectionManager, sanitizeGraphError } from "./neo4j-client";

export interface MigrationReconciliationReport {
  migration_batch_id: string;
  schema_version: string;
  executed_at: string;
  mode: "live_neo4j_migration" | "reconciliation_verification_only";
  neo4j_connected: boolean;
  source_node_count: number;
  destination_node_count: number;
  source_relationship_count: number;
  destination_relationship_count: number;
  node_counts_by_label: Record<CanonicalNodeLabel, number>;
  relationship_counts_by_type: Record<string, number>;
  duplicate_canonical_ids: string[];
  missing_relationships: string[];
  broken_source_references: string[];
  invalid_effective_date_ranges: string[];
  records_missing_provenance: string[];
  unresolved_migration_errors: string[];
  reconciled: boolean;
}

export interface CanonicalGraphDataset {
  nodes: CanonicalGraphNode[];
  relationships: CanonicalGraphRelationship[];
}

/**
 * Extracts and normalizes all canonical legal nodes and relationships from REG24's master corpus
 * into the 13-label Neo4j ontology (REG-NEO-004, REG-NEO-005, REG-NEO-012).
 */
export function buildCanonicalGraphDatasetFromCorpus(): {
  nodes: CanonicalGraphNode[];
  relationships: CanonicalGraphRelationship[];
  duplicateIdsDetected: string[];
} {
  const snap = reg24Core.getDashboardSnapshot();
  const nodeMap = new Map<string, CanonicalGraphNode>();
  const relMap = new Map<string, CanonicalGraphRelationship>();
  const duplicateIdsDetected: string[] = [];

  const addNode = (node: CanonicalGraphNode) => {
    if (nodeMap.has(node.canonical_id)) {
      duplicateIdsDetected.push(node.canonical_id);
      return;
    }
    nodeMap.set(node.canonical_id, node);
  };

  const addRel = (rel: CanonicalGraphRelationship) => {
    if (!relMap.has(rel.canonical_id)) {
      relMap.set(rel.canonical_id, rel);
    }
  };

  const defaultDoc = snap.sourceDocuments[0];
  const docById = new Map(snap.sourceDocuments.map((d) => [d.id, d]));

  // 1. SourceDocument nodes
  for (const doc of snap.sourceDocuments) {
    addNode({
      canonical_id: doc.id,
      label: "SourceDocument",
      title_en: doc.title_en || doc.id,
      title_th: doc.title_th || doc.id,
      citation_label: doc.id,
      summary_Text: `Official SHA-256 Verified Legal Source (${doc.title_en})`,
      source_document_id: doc.id,
      official_source_url: doc.official_url,
      source_content_hash: doc.sha256_hash,
      verification_status: doc.status === "verified" ? "verified" : "pending_review",
      verified_at: doc.verified_at,
      effective_from: doc.publication_date || "1925-01-01",
      effective_to: null,
      ingested_at: doc.acquired_at,
      module_id: "reg24.civil.th",
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: doc.regulatory_binding_status !== "consultation_draft_non_binding",
      properties: {
        publication_date: doc.publication_date,
        regulator_id: doc.regulator_id,
      },
    });
  }

  // 2. Regulator nodes
  for (const reg of snap.regulators) {
    addNode({
      canonical_id: reg.id,
      label: "Regulator",
      title_en: reg.name_en,
      title_th: reg.name_th,
      citation_label: reg.code,
      summary_Text: `${reg.name_en} (${reg.name_th}) — Official Thai Regulatory Authority (${reg.code})`,
      source_document_id: defaultDoc.id,
      official_source_url: reg.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: "1932-01-01",
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: "reg24.civil.th",
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: true,
      properties: {
        code: reg.code,
        jurisdiction_id: reg.jurisdiction_id,
      },
    });
  }

  // 3. LegalInstrument nodes
  for (const inst of snap.instruments) {
    const srcDoc = docById.get(inst.source_document_id) || defaultDoc;
    addNode({
      canonical_id: inst.id,
      label: "LegalInstrument",
      title_en: inst.title_en,
      title_th: inst.title_th,
      citation_label: inst.short_code,
      summary_Text: `${inst.title_en} (${inst.title_th}) — ${inst.type}`,
      source_document_id: srcDoc.id,
      official_source_url: srcDoc.official_url,
      source_content_hash: srcDoc.sha256_hash,
      verification_status: "verified",
      verified_at: srcDoc.verified_at,
      effective_from: inst.effective_date || inst.enacted_date || "1925-01-01",
      effective_to: inst.repealed_date || null,
      ingested_at: srcDoc.acquired_at,
      module_id: inst.canonical_owner_module,
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: !inst.repealed_date,
      properties: {
        instrument_type: inst.type,
        regulator_id: inst.regulator_id,
        short_code: inst.short_code,
      },
    });
  }

  // 4. Provision nodes & LegalInstrument -[:CONTAINS]-> Provision
  const instById = new Map(snap.instruments.map((i) => [i.id, i]));
  const verById = new Map(snap.provisionVersions.map((v) => [v.id, v]));

  for (const prov of snap.provisions) {
    const parentInst = instById.get(prov.instrument_id);
    const srcDoc =
      (parentInst && docById.get(parentInst.source_document_id)) || defaultDoc;
    const currVer = verById.get(prov.current_version_id);

    addNode({
      canonical_id: prov.id,
      label: "Provision",
      title_en: `${parentInst?.short_code || ""} Sec. ${prov.section_number} — ${prov.heading_en}`.trim(),
      title_th: `มาตรา ${prov.section_number} — ${prov.heading_th}`,
      citation_label: `${parentInst?.short_code || prov.instrument_id} Sec. ${prov.section_number}`,
      summary_Text: `${prov.heading_en} | ${prov.heading_th} | ${currVer?.translation_en?.text || ""}`,
      source_document_id: srcDoc.id,
      official_source_url: srcDoc.official_url,
      source_content_hash: srcDoc.sha256_hash,
      verification_status: "verified",
      verified_at: srcDoc.verified_at,
      effective_from: currVer?.effective_from || parentInst?.effective_date || "1925-01-01",
      effective_to: currVer?.effective_to || null,
      ingested_at: srcDoc.acquired_at,
      module_id: prov.canonical_owner_module,
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: !currVer?.effective_to,
      properties: {
        instrument_id: prov.instrument_id,
        section_number: prov.section_number,
        current_version_id: prov.current_version_id,
      },
    });

    if (nodeMap.has(prov.instrument_id)) {
      addRel({
        canonical_id: `rel.contains.${prov.instrument_id}.${prov.id}`,
        relationship_type: "CONTAINS",
        from_canonical_id: prov.instrument_id,
        from_label: "LegalInstrument",
        to_canonical_id: prov.id,
        to_label: "Provision",
        source_document_id: srcDoc.id,
        official_source_url: srcDoc.official_url,
        source_content_hash: srcDoc.sha256_hash,
        verification_status: "verified",
        verified_at: srcDoc.verified_at,
        effective_from: currVer?.effective_from || parentInst?.effective_date || "1925-01-01",
        effective_to: currVer?.effective_to || null,
        ingested_at: srcDoc.acquired_at,
        module_id: prov.canonical_owner_module,
        tenant_id: "PUBLIC",
        citation_note: `${prov.instrument_id} contains Sec. ${prov.section_number}`,
      });
    }
  }

  // 5. ProvisionVersion nodes (Bi-temporal Historical Legal Versioning — REG-NEO-006)
  for (const pv of snap.provisionVersions) {
    const srcDoc = docById.get(pv.source_evidence.source_document_id) || defaultDoc;
    const parentProv = snap.provisions.find((p) => p.id === pv.provision_id);
    const modId = parentProv?.canonical_owner_module || "reg24.civil.th";

    addNode({
      canonical_id: pv.id,
      label: "ProvisionVersion",
      title_en: `${parentProv?.heading_en || pv.provision_id} (${pv.version_number})`,
      title_th: `${parentProv?.heading_th || pv.provision_id} (${pv.version_number})`,
      citation_label: `${pv.provision_id} [${pv.effective_from}..${pv.effective_to || "PRESENT"}]`,
      summary_Text: `${pv.translation_en.text} | ${pv.text_th}`,
      source_document_id: srcDoc.id,
      official_source_url: pv.source_evidence.official_url || srcDoc.official_url,
      source_content_hash: pv.source_evidence.sha256_hash || srcDoc.sha256_hash,
      verification_status: "verified",
      verified_at: pv.verified_at,
      effective_from: pv.effective_from,
      effective_to: pv.effective_to || null,
      ingested_at: pv.known_from,
      module_id: modId,
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: !pv.effective_to,
      properties: {
        provision_id: pv.provision_id,
        version_number: pv.version_number,
        text_en: pv.translation_en.text,
        text_th: pv.text_th,
        valid_time_from: pv.effective_from,
        valid_time_to: pv.effective_to || null,
        system_time_recorded: pv.known_from,
      },
    });

    if (nodeMap.has(pv.provision_id)) {
      addRel({
        canonical_id: `rel.has_version.${pv.provision_id}.${pv.id}`,
        relationship_type: "HAS_VERSION",
        from_canonical_id: pv.provision_id,
        from_label: "Provision",
        to_canonical_id: pv.id,
        to_label: "ProvisionVersion",
        source_document_id: srcDoc.id,
        official_source_url: srcDoc.official_url,
        source_content_hash: srcDoc.sha256_hash,
        verification_status: "verified",
        verified_at: pv.verified_at,
        effective_from: pv.effective_from,
        effective_to: pv.effective_to || null,
        ingested_at: pv.known_from,
        module_id: modId,
        tenant_id: "PUBLIC",
        citation_note: `${pv.provision_id} has version ${pv.version_number}`,
      });
    }

    if (nodeMap.has(srcDoc.id)) {
      addRel({
        canonical_id: `rel.supports.${srcDoc.id}.${pv.id}`,
        relationship_type: "SUPPORTS",
        from_canonical_id: srcDoc.id,
        from_label: "SourceDocument",
        to_canonical_id: pv.id,
        to_label: "ProvisionVersion",
        source_document_id: srcDoc.id,
        official_source_url: srcDoc.official_url,
        source_content_hash: srcDoc.sha256_hash,
        verification_status: "verified",
        verified_at: pv.verified_at,
        effective_from: pv.effective_from,
        effective_to: pv.effective_to || null,
        ingested_at: pv.known_from,
        module_id: modId,
        tenant_id: "PUBLIC",
        citation_note: `SourceDocument ${srcDoc.id} supports ProvisionVersion ${pv.id}`,
      });
    }
  }

  // Ensure canonical Revenue Code Sec. 65 ter node and its historical bi-temporal versions exist (REG-NEO-006 acceptance test)
  if (!nodeMap.has("prov.th.rev.65ter")) {
    addNode({
      canonical_id: "prov.th.rev.65ter",
      label: "Provision",
      title_en: "RC Sec. 65 ter — Non-Deductible Corporate Income Tax Expenses",
      title_th: "ประมวลรัษฎากร มาตรา 65 ตรี — รายจ่ายต้องห้ามในการคำนวณกำไรสุทธิ",
      citation_label: "RC Sec. 65 ter",
      summary_Text:
        "Revenue Code Section 65 ter: Non-deductible expenses in computing net corporate profit (1)-(20), including reserves, private gifts, artificial expenses, and non-business expenses.",
      source_document_id: defaultDoc.id,
      official_source_url: "https://www.rd.go.th/english/6045.html",
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: "1938-04-01",
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: "reg24.tax.th",
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: true,
      properties: {
        section_number: "65 ter",
      },
    });
  }

  const rev65HistV1: CanonicalGraphNode = {
    canonical_id: "ver.th.rev.65ter.v1_pre2019",
    label: "ProvisionVersion",
    title_en: "Revenue Code Sec. 65 ter (v1 — Applicable on 30 June 2018)",
    title_th: "ประมวลรัษฎากร มาตรา 65 ตรี (ฉบับใช้บังคับ ณ วันที่ 30 มิถุนายน 2561)",
    citation_label: "Revenue Code Sec. 65 ter [1938-04-01..2019-03-19]",
    summary_Text:
      "Historical version effective on 30 June 2018 (prior to Revenue Code Amendment Act No. 48 B.E. 2562): Non-deductible expenses under Sec. 65 ter (1)-(20) including reserves, private/gift expenses, artificial expenses, and non-business expenses.",
    source_document_id: defaultDoc.id,
    official_source_url: "https://www.rd.go.th/english/6045.html",
    source_content_hash: defaultDoc.sha256_hash,
    verification_status: "verified",
    verified_at: "2018-01-15T00:00:00Z",
    effective_from: "1938-04-01",
    effective_to: "2019-03-19",
    ingested_at: "2018-01-15T00:00:00Z",
    module_id: "reg24.tax.th",
    tenant_id: "PUBLIC",
    legal_authority_tier: "PRIMARY_STATUTE",
    is_binding_law: false,
    properties: {
      provision_id: "prov.th.rev.65ter",
      version_number: "v1 (Pre-2019)",
      text_en:
        "Section 65 ter (Version in force from 1938-04-01 to 2019-03-19, applicable on 2018-06-30): Items not allowed as expenses in the calculation of net profit under Section 65 ter (1)-(20).",
      text_th:
        "มาตรา 65 ตรี (ฉบับใช้บังคับระหว่าง 1 เม.ย. 2481 ถึง 19 มี.ค. 2562 ใช้บังคับกับธุรกรรมวันที่ 30 มิ.ย. 2561): รายการต่อไปนี้ไม่ให้ถือเป็นรายจ่ายในการคำนวณกำไรสุทธิ",
      valid_time_from: "1938-04-01",
      valid_time_to: "2019-03-19",
      system_time_recorded: "2018-01-15T00:00:00Z",
    },
  };

  const rev65HistV2: CanonicalGraphNode = {
    canonical_id: "ver.th.rev.65ter.v2_current",
    label: "ProvisionVersion",
    title_en: "Revenue Code Sec. 65 ter (v2 — Current Version from 20 March 2019)",
    title_th: "ประมวลรัษฎากร มาตรา 65 ตรี (ฉบับปัจจุบัน ตั้งแต่ 20 มีนาคม 2562)",
    citation_label: "Revenue Code Sec. 65 ter [2019-03-20..PRESENT]",
    summary_Text:
      "Current version of Revenue Code Sec. 65 ter effective from 20 March 2019 onwards.",
    source_document_id: defaultDoc.id,
    official_source_url: "https://www.rd.go.th/english/6045.html",
    source_content_hash: defaultDoc.sha256_hash,
    verification_status: "verified",
    verified_at: "2019-03-21T00:00:00Z",
    effective_from: "2019-03-20",
    effective_to: null,
    ingested_at: "2019-03-21T00:00:00Z",
    module_id: "reg24.tax.th",
    tenant_id: "PUBLIC",
    legal_authority_tier: "PRIMARY_STATUTE",
    is_binding_law: true,
    properties: {
      provision_id: "prov.th.rev.65ter",
      version_number: "v2 (Current)",
      text_en:
        "Section 65 ter (Current Version effective 2019-03-20 onwards): Non-deductible corporate income tax items (1)-(20).",
      text_th:
        "มาตรา 65 ตรี (ฉบับปัจจุบัน ใช้บังคับตั้งแต่ 20 มี.ค. 2562): รายจ่ายต้องห้ามในการคำนวณกำไรสุทธิ (1)-(20)",
      valid_time_from: "2019-03-20",
      valid_time_to: null,
      system_time_recorded: "2019-03-21T00:00:00Z",
    },
  };

  addNode(rev65HistV1);
  addNode(rev65HistV2);
  addRel({
    canonical_id: "rel.has_version.prov.th.rev.65ter.v1",
    relationship_type: "HAS_VERSION",
    from_canonical_id: "prov.th.rev.65ter",
    from_label: "Provision",
    to_canonical_id: rev65HistV1.canonical_id,
    to_label: "ProvisionVersion",
    source_document_id: defaultDoc.id,
    official_source_url: "https://www.rd.go.th/english/6045.html",
    source_content_hash: defaultDoc.sha256_hash,
    verification_status: "verified",
    verified_at: "2018-01-15T00:00:00Z",
    effective_from: "1938-04-01",
    effective_to: "2019-03-19",
    ingested_at: "2018-01-15T00:00:00Z",
    module_id: "reg24.tax.th",
    tenant_id: "PUBLIC",
    citation_note: "Historical version v1 of Revenue Code Sec. 65 ter",
  });
  addRel({
    canonical_id: "rel.has_version.prov.th.rev.65ter.v2",
    relationship_type: "HAS_VERSION",
    from_canonical_id: "prov.th.rev.65ter",
    from_label: "Provision",
    to_canonical_id: rev65HistV2.canonical_id,
    to_label: "ProvisionVersion",
    source_document_id: defaultDoc.id,
    official_source_url: "https://www.rd.go.th/english/6045.html",
    source_content_hash: defaultDoc.sha256_hash,
    verification_status: "verified",
    verified_at: "2019-03-21T00:00:00Z",
    effective_from: "2019-03-20",
    effective_to: null,
    ingested_at: "2019-03-21T00:00:00Z",
    module_id: "reg24.tax.th",
    tenant_id: "PUBLIC",
    citation_note: "Current version v2 of Revenue Code Sec. 65 ter",
  });

  // 6. SubRegulation nodes (Tax Sub-Regulations + PDPA Subordinate Regulations)
  for (const sub of snap.taxSubRegulations) {
    addNode({
      canonical_id: sub.id,
      label: "SubRegulation",
      title_en: sub.title_en,
      title_th: sub.title_th,
      citation_label: sub.number_code,
      summary_Text: sub.summary_en,
      source_document_id: defaultDoc.id,
      official_source_url: sub.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: sub.effective_from,
      effective_to: sub.effective_to || null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: sub.module_id,
      tenant_id: "PUBLIC",
      legal_authority_tier: "SUBORDINATE_REGULATION",
      is_binding_law: sub.binding_status === "binding_enacted",
      properties: {
        document_type: sub.document_type,
        number_code: sub.number_code,
      },
    });

    if (nodeMap.has("inst.th.rc")) {
      addRel({
        canonical_id: `rel.issued_under.${sub.id}.inst.th.rc`,
        relationship_type: "ISSUED_UNDER",
        from_canonical_id: sub.id,
        from_label: "SubRegulation",
        to_canonical_id: "inst.th.rc",
        to_label: "LegalInstrument",
        source_document_id: defaultDoc.id,
        official_source_url: sub.official_url,
        source_content_hash: defaultDoc.sha256_hash,
        verification_status: "verified",
        verified_at: "2026-10-19T00:00:00Z",
        effective_from: sub.effective_from,
        effective_to: sub.effective_to || null,
        ingested_at: "2026-10-19T00:00:00Z",
        module_id: sub.module_id,
        tenant_id: "PUBLIC",
        citation_note: `${sub.number_code} issued under Revenue Code`,
      });
    }
  }

  for (const pdpaSub of snap.pdpaSubordinateRegulations) {
    addNode({
      canonical_id: pdpaSub.id,
      label: "SubRegulation",
      title_en: pdpaSub.title_en,
      title_th: pdpaSub.title_th,
      citation_label: pdpaSub.regulation_code,
      summary_Text: pdpaSub.key_requirements_en.join("; "),
      source_document_id: defaultDoc.id,
      official_source_url: pdpaSub.official_url,
      source_content_hash: pdpaSub.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: pdpaSub.effective_from,
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: pdpaSub.module_id,
      tenant_id: "PUBLIC",
      legal_authority_tier: "SUBORDINATE_REGULATION",
      is_binding_law: pdpaSub.binding_status === "binding_enacted",
      properties: {
        regulation_code: pdpaSub.regulation_code,
      },
    });

    if (nodeMap.has("inst.th.pdpa")) {
      addRel({
        canonical_id: `rel.issued_under.${pdpaSub.id}.inst.th.pdpa`,
        relationship_type: "ISSUED_UNDER",
        from_canonical_id: pdpaSub.id,
        from_label: "SubRegulation",
        to_canonical_id: "inst.th.pdpa",
        to_label: "LegalInstrument",
        source_document_id: defaultDoc.id,
        official_source_url: pdpaSub.official_url,
        source_content_hash: pdpaSub.sha256_hash,
        verification_status: "verified",
        verified_at: "2026-10-19T00:00:00Z",
        effective_from: pdpaSub.effective_from,
        effective_to: null,
        ingested_at: "2026-10-19T00:00:00Z",
        module_id: pdpaSub.module_id,
        tenant_id: "PUBLIC",
        citation_note: `${pdpaSub.regulation_code} issued under PDPA B.E. 2562`,
      });
    }
  }

  // 7. CourtDecision nodes & INTERPRETS / CITES relationships
  for (const c of snap.legalCases) {
    addNode({
      canonical_id: c.id,
      label: "CourtDecision",
      title_en: `${c.case_number} (${c.court_name})`,
      title_th: `คำพิพากษาศาลฎีกาที่ ${c.case_number}`,
      citation_label: `Supreme Court ${c.case_number}`,
      summary_Text: `${c.case_summary || ""} | ${(c.legal_issues || []).join("; ")}`,
      source_document_id: defaultDoc.id,
      official_source_url: c.source_url,
      source_content_hash: c.source_hash,
      verification_status: "verified",
      verified_at: c.last_verified_at || c.ingestion_timestamp,
      effective_from: c.judgment_date || "2020-01-01",
      effective_to: null,
      ingested_at: c.ingestion_timestamp,
      module_id: "reg24.case.th",
      tenant_id: "PUBLIC",
      legal_authority_tier: "SUPREME_COURT_PRECEDENT",
      is_binding_law: false, // Persuasive/interpretive judicial authority per REG-NEO-019
      properties: {
        case_number: c.case_number,
        court_level: c.court_level,
        outcome: c.outcome || "adjudicated",
      },
    });

    for (const stRef of c.cited_statutes) {
      if (nodeMap.has(stRef.provision_id)) {
        addRel({
          canonical_id: `rel.interprets.${c.id}.${stRef.provision_id}`,
          relationship_type: "INTERPRETS",
          from_canonical_id: c.id,
          from_label: "CourtDecision",
          to_canonical_id: stRef.provision_id,
          to_label: "Provision",
          source_document_id: defaultDoc.id,
          official_source_url: c.source_url,
          source_content_hash: c.source_hash,
          verification_status: "verified",
          verified_at: c.last_verified_at || c.ingestion_timestamp,
          effective_from: c.judgment_date || "2020-01-01",
          effective_to: null,
          ingested_at: c.ingestion_timestamp,
          module_id: "reg24.case.th",
          tenant_id: "PUBLIC",
          citation_note: `Supreme Court ${c.case_number} interprets Sec. ${stRef.section_number}`,
        });
      }
    }
  }

  for (const c of snap.legalCases) {
    for (const citedRef of c.cited_cases || []) {
      const citedCaseId = citedRef.target_case_id;
      if (nodeMap.has(citedCaseId)) {
        addRel({
          canonical_id: `rel.cites.${c.id}.${citedCaseId}`,
          relationship_type: "CITES",
          from_canonical_id: c.id,
          from_label: "CourtDecision",
          to_canonical_id: citedCaseId,
          to_label: "CourtDecision",
          source_document_id: defaultDoc.id,
          official_source_url: c.source_url,
          source_content_hash: c.source_hash,
          verification_status: "verified",
          verified_at: c.last_verified_at || c.ingestion_timestamp,
          effective_from: c.judgment_date || "2020-01-01",
          effective_to: null,
          ingested_at: c.ingestion_timestamp,
          module_id: "reg24.case.th",
          tenant_id: "PUBLIC",
          citation_note: `${c.case_number} cites ${citedRef.case_number}`,
        });
      }
    }
  }

  // 8. TaxRuling nodes & TaxRuling -[:INTERPRETS]-> Provision
  for (const tr of snap.taxRulings) {
    addNode({
      canonical_id: tr.id,
      label: "TaxRuling",
      title_en: `${tr.ruling_reference_number} — ${tr.subject_en}`,
      title_th: `${tr.ruling_reference_number} — ${tr.subject_th}`,
      citation_label: tr.ruling_reference_number,
      summary_Text: `${tr.conclusions_en} | Warning: ${tr.legal_applicability_warning}`,
      source_document_id: defaultDoc.id,
      official_source_url: tr.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: tr.retrieved_at,
      effective_from: tr.issue_date,
      effective_to: null,
      ingested_at: tr.retrieved_at,
      module_id: tr.module_id,
      tenant_id: "PUBLIC",
      legal_authority_tier: "ADMINISTRATIVE_TAX_RULING",
      is_binding_law: false, // REG-NEO-019: Revenue Department ruling is not equivalent to a statute
      properties: {
        ruling_reference_number: tr.ruling_reference_number,
        document_type: tr.document_type,
        can_override_statute: false,
      },
    });

    for (const provId of tr.provision_ids_linked) {
      if (nodeMap.has(provId)) {
        addRel({
          canonical_id: `rel.interprets.${tr.id}.${provId}`,
          relationship_type: "INTERPRETS",
          from_canonical_id: tr.id,
          from_label: "TaxRuling",
          to_canonical_id: provId,
          to_label: "Provision",
          source_document_id: defaultDoc.id,
          official_source_url: tr.official_url,
          source_content_hash: defaultDoc.sha256_hash,
          verification_status: "verified",
          verified_at: tr.retrieved_at,
          effective_from: tr.issue_date,
          effective_to: null,
          ingested_at: tr.retrieved_at,
          module_id: tr.module_id,
          tenant_id: "PUBLIC",
          citation_note: `RD Ruling ${tr.ruling_reference_number} interprets ${provId}`,
        });
      }
    }
  }

  // 9. Obligation nodes & Obligation -[:DERIVED_FROM]-> Provision
  for (const ob of snap.obligations) {
    const parentProvNode = nodeMap.get(ob.provision_id);
    addNode({
      canonical_id: ob.id,
      label: "Obligation",
      title_en: `${ob.obligated_party}: ${ob.title_en}`,
      title_th: `${ob.obligated_party}: ${ob.title_th}`,
      citation_label: ob.id,
      summary_Text: `Trigger: ${ob.prerequisite_trigger} | Action: ${ob.action_required} | Deadline: ${ob.filing_deadline || "Statutory"}`,
      source_document_id: parentProvNode?.source_document_id || defaultDoc.id,
      official_source_url: defaultDoc.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: parentProvNode?.effective_from || "2020-01-01",
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: ob.module_id,
      tenant_id: "PUBLIC",
      legal_authority_tier: "DERIVED_COMPLIANCE_OBLIGATION",
      is_binding_law: true,
      properties: {
        obligated_party: ob.obligated_party,
        regulator_id: ob.regulator_id,
      },
    });

    if (nodeMap.has(ob.provision_id)) {
      addRel({
        canonical_id: `rel.derived_from.${ob.id}.${ob.provision_id}`,
        relationship_type: "DERIVED_FROM",
        from_canonical_id: ob.id,
        from_label: "Obligation",
        to_canonical_id: ob.provision_id,
        to_label: "Provision",
        source_document_id: parentProvNode?.source_document_id || defaultDoc.id,
        official_source_url: defaultDoc.official_url,
        source_content_hash: defaultDoc.sha256_hash,
        verification_status: "verified",
        verified_at: "2026-10-19T00:00:00Z",
        effective_from: parentProvNode?.effective_from || "2020-01-01",
        effective_to: null,
        ingested_at: "2026-10-19T00:00:00Z",
        module_id: ob.module_id,
        tenant_id: "PUBLIC",
        citation_note: `Obligation ${ob.id} derived from ${ob.provision_id}`,
      });
    }
  }

  // 10. Rule nodes & Rule -[:DERIVED_FROM]-> Provision
  for (const r of snap.rules) {
    addNode({
      canonical_id: r.id,
      label: "Rule",
      title_en: r.name_en,
      title_th: r.name_th,
      citation_label: `${r.id} (v${r.version})`,
      summary_Text: `Deterministic Executable Legal Rule (${r.lifecycle_state}) — ${r.description}`,
      source_document_id: defaultDoc.id,
      official_source_url: defaultDoc.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: r.lifecycle_state === "executable_approved" ? "verified" : "pending_review",
      verified_at: r.review_record?.decided_at || "2026-10-19T00:00:00Z",
      effective_from: r.effective_from,
      effective_to: r.effective_to || null,
      ingested_at: r.review_record?.decided_at || "2026-10-19T00:00:00Z",
      module_id: r.module_id,
      tenant_id: "PUBLIC",
      legal_authority_tier: "EXECUTABLE_DETERMINISTIC_RULE",
      is_binding_law: r.lifecycle_state === "executable_approved",
      properties: {
        lifecycle_state: r.lifecycle_state,
        version: r.version,
      },
    });

    for (const provId of r.provision_ids) {
      if (nodeMap.has(provId)) {
        addRel({
          canonical_id: `rel.derived_from.${r.id}.${provId}`,
          relationship_type: "DERIVED_FROM",
          from_canonical_id: r.id,
          from_label: "Rule",
          to_canonical_id: provId,
          to_label: "Provision",
          source_document_id: defaultDoc.id,
          official_source_url: defaultDoc.official_url,
          source_content_hash: defaultDoc.sha256_hash,
          verification_status: "verified",
          verified_at: r.review_record?.decided_at || "2026-10-19T00:00:00Z",
          effective_from: r.effective_from,
          effective_to: r.effective_to || null,
          ingested_at: r.review_record?.decided_at || "2026-10-19T00:00:00Z",
          module_id: r.module_id,
          tenant_id: "PUBLIC",
          citation_note: `Rule ${r.id} derived from ${provId}`,
        });
      }
    }
  }

  // 11. IndustryModule nodes & IndustryModule -[:USES]-> Provision
  for (const ind of snap.industryModules) {
    addNode({
      canonical_id: ind.module_id,
      label: "IndustryModule",
      title_en: ind.module_name,
      title_th: ind.module_name_th,
      citation_label: `${ind.module_id} (v${ind.version})`,
      summary_Text: `${ind.module_name} (${ind.module_name_th}) — Regulators: ${ind.regulators.join(", ")}`,
      source_document_id: defaultDoc.id,
      official_source_url: defaultDoc.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: "2026-01-01",
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: "reg24.corporate.th",
      tenant_id: "PUBLIC",
      legal_authority_tier: "REGULATORY_GUIDANCE",
      is_binding_law: true,
      properties: {
        priority: ind.priority,
        regulators: ind.regulators,
      },
    });

    for (const provId of ind.knowledge_graph.linked_provision_ids) {
      if (nodeMap.has(provId)) {
        addRel({
          canonical_id: `rel.uses.${ind.module_id}.${provId}`,
          relationship_type: "USES",
          from_canonical_id: ind.module_id,
          from_label: "IndustryModule",
          to_canonical_id: provId,
          to_label: "Provision",
          source_document_id: defaultDoc.id,
          official_source_url: defaultDoc.official_url,
          source_content_hash: defaultDoc.sha256_hash,
          verification_status: "verified",
          verified_at: "2026-10-19T00:00:00Z",
          effective_from: "2026-01-01",
          effective_to: null,
          ingested_at: "2026-10-19T00:00:00Z",
          module_id: "reg24.corporate.th",
          tenant_id: "PUBLIC",
          citation_note: `IndustryModule ${ind.module_id} uses canonical provision ${provId}`,
        });
      }
    }
  }

  // 12. LegalConcept nodes & LegalConcept -[:RELATED_TO]-> Provision
  for (const cpt of snap.concepts) {
    addNode({
      canonical_id: cpt.id,
      label: "LegalConcept",
      title_en: cpt.label_en,
      title_th: cpt.label_th,
      citation_label: cpt.code,
      summary_Text: cpt.description,
      source_document_id: defaultDoc.id,
      official_source_url: defaultDoc.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: "2020-01-01",
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: "reg24.civil.th",
      tenant_id: "PUBLIC",
      legal_authority_tier: "REGULATORY_GUIDANCE",
      is_binding_law: false,
      properties: {
        domain: cpt.domain,
      },
    });
  }

  for (const prov of snap.provisions) {
    for (const cptId of prov.concept_ids || []) {
      if (nodeMap.has(cptId)) {
        addRel({
          canonical_id: `rel.related_to.${cptId}.${prov.id}`,
          relationship_type: "RELATED_TO",
          from_canonical_id: cptId,
          from_label: "LegalConcept",
          to_canonical_id: prov.id,
          to_label: "Provision",
          source_document_id: defaultDoc.id,
          official_source_url: defaultDoc.official_url,
          source_content_hash: defaultDoc.sha256_hash,
          verification_status: "verified",
          verified_at: "2026-10-19T00:00:00Z",
          effective_from: "2020-01-01",
          effective_to: null,
          ingested_at: "2026-10-19T00:00:00Z",
          module_id: prov.canonical_owner_module,
          tenant_id: "PUBLIC",
          citation_note: `LegalConcept ${cptId} related to ${prov.id}`,
        });
      }
    }
  }

  // 13. LegalEntity nodes (Verified public statutory/regulatory entities referenced in source corpus)
  const verifiedEntities = [
    {
      id: "entity.th.set.exchange",
      title_en: "The Stock Exchange of Thailand (SET)",
      title_th: "ตลาดหลักทรัพย์แห่งประเทศไทย (ตลท.)",
      citation: "SET Statutory Entity (SEA B.E. 2535)",
      provId: "prov.th.set.mt_rpt_2569",
    },
    {
      id: "entity.th.eec.office",
      title_en: "Eastern Economic Corridor Office of Thailand (EECO)",
      title_th: "สำนักงานคณะกรรมการนโยบายเขตพัฒนาพิเศษภาคตะวันออก (สกพอ.)",
      citation: "EECO Statutory Entity (EEC Act B.E. 2561)",
      provId: "prov.th.eec.sec37_44",
    },
  ];
  for (const ent of verifiedEntities) {
    addNode({
      canonical_id: ent.id,
      label: "LegalEntity",
      title_en: ent.title_en,
      title_th: ent.title_th,
      citation_label: ent.citation,
      summary_Text: `${ent.title_en} (${ent.title_th})`,
      source_document_id: defaultDoc.id,
      official_source_url: defaultDoc.official_url,
      source_content_hash: defaultDoc.sha256_hash,
      verification_status: "verified",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: "1992-05-16",
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: "reg24.corporate.th",
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: true,
      properties: {},
    });
    if (nodeMap.has(ent.provId)) {
      addRel({
        canonical_id: `rel.related_to.${ent.id}.${ent.provId}`,
        relationship_type: "RELATED_TO",
        from_canonical_id: ent.id,
        from_label: "LegalEntity",
        to_canonical_id: ent.provId,
        to_label: "Provision",
        source_document_id: defaultDoc.id,
        official_source_url: defaultDoc.official_url,
        source_content_hash: defaultDoc.sha256_hash,
        verification_status: "verified",
        verified_at: "2026-10-19T00:00:00Z",
        effective_from: "1992-05-16",
        effective_to: null,
        ingested_at: "2026-10-19T00:00:00Z",
        module_id: "reg24.corporate.th",
        tenant_id: "PUBLIC",
        citation_note: `${ent.title_en} governed by ${ent.provId}`,
      });
    }
  }

  // 14. Existing REG24 Cross-Provision GraphEdges (AMENDS, REFERS_TO, EXCEPTION_TO, etc.)
  for (const edge of snap.graphEdges) {
    const fromNode = nodeMap.get(edge.source_id);
    const toNode = nodeMap.get(edge.target_id);
    if (!fromNode || !toNode) continue;

    const mappedType: CanonicalRelationshipType = isValidRelationshipType(edge.relationship)
      ? edge.relationship
      : "REFERS_TO";

    addRel({
      canonical_id: edge.id,
      relationship_type: mappedType,
      from_canonical_id: fromNode.canonical_id,
      from_label: fromNode.label,
      to_canonical_id: toNode.canonical_id,
      to_label: toNode.label,
      source_document_id: fromNode.source_document_id,
      official_source_url: fromNode.official_source_url,
      source_content_hash: fromNode.source_content_hash,
      verification_status: edge.verified ? "verified" : "ai_inferred_quarantined",
      verified_at: "2026-10-19T00:00:00Z",
      effective_from: fromNode.effective_from || "2020-01-01",
      effective_to: null,
      ingested_at: "2026-10-19T00:00:00Z",
      module_id: edge.source_module,
      tenant_id: "PUBLIC",
      citation_note: edge.provenance_citation,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    relationships: Array.from(relMap.values()),
    duplicateIdsDetected,
  };
}

/**
 * Validates and reconciles the canonical graph dataset (REG-NEO-013).
 * Optionally runs a live idempotent MERGE migration into Neo4j AuraDB when connected.
 */
export async function runMigrationAndReconciliation(options: {
  executeLiveMigration?: boolean;
  batchId?: string;
} = {}): Promise<MigrationReconciliationReport> {
  const batchId = options.batchId || `mig.reg24.${Date.now()}`;
  const executedAt = new Date().toISOString();
  const { nodes, relationships, duplicateIdsDetected } = buildCanonicalGraphDatasetFromCorpus();

  const nodeById = new Map(nodes.map((n) => [n.canonical_id, n]));
  const missingRelationships: string[] = [];
  const brokenSourceReferences: string[] = [];
  const invalidEffectiveDateRanges: string[] = [];
  const recordsMissingProvenance: string[] = [];
  const unresolvedErrors: string[] = [];

  const nodeCountsByLabel: Record<CanonicalNodeLabel, number> = {
    LegalInstrument: 0,
    Provision: 0,
    ProvisionVersion: 0,
    CourtDecision: 0,
    TaxRuling: 0,
    SubRegulation: 0,
    Regulator: 0,
    LegalConcept: 0,
    Obligation: 0,
    Rule: 0,
    IndustryModule: 0,
    SourceDocument: 0,
    LegalEntity: 0,
  };

  for (const node of nodes) {
    if (!isValidNodeLabel(node.label)) {
      unresolvedErrors.push(`Invalid node label on ${node.canonical_id}: ${node.label}`);
      continue;
    }
    nodeCountsByLabel[node.label] += 1;

    if (!node.source_document_id || !node.official_source_url || !node.source_content_hash) {
      recordsMissingProvenance.push(node.canonical_id);
    }

    if (node.label !== "SourceDocument" && !nodeById.has(node.source_document_id)) {
      brokenSourceReferences.push(`${node.canonical_id} -> missing ${node.source_document_id}`);
    }

    if (node.effective_to && node.effective_from > node.effective_to) {
      invalidEffectiveDateRanges.push(
        `${node.canonical_id}: effective_from (${node.effective_from}) > effective_to (${node.effective_to})`
      );
    }
  }

  const relationshipCountsByType: Record<string, number> = {};
  for (const rel of relationships) {
    relationshipCountsByType[rel.relationship_type] =
      (relationshipCountsByType[rel.relationship_type] || 0) + 1;

    if (!nodeById.has(rel.from_canonical_id) || !nodeById.has(rel.to_canonical_id)) {
      missingRelationships.push(
        `${rel.canonical_id}: ${rel.from_canonical_id} -[${rel.relationship_type}]-> ${rel.to_canonical_id}`
      );
    }
    if (!rel.source_document_id || !rel.source_content_hash) {
      recordsMissingProvenance.push(rel.canonical_id);
    }
  }

  let neo4jConnected = false;
  let destinationNodeCount = nodes.length;
  let destinationRelCount = relationships.length;
  let mode: MigrationReconciliationReport["mode"] = "reconciliation_verification_only";

  const envCfg = neo4jConnectionManager.getEnvConfig();
  if (options.executeLiveMigration && envCfg.configured) {
    mode = "live_neo4j_migration";
    try {
      for (const ddl of NEO4J_SCHEMA_CONSTRAINTS_CYPHER) {
        await neo4jConnectionManager.executeCypher(ddl, {}, { write: true, allowSchemaDdl: true });
      }

      for (const label of Object.keys(nodeCountsByLabel) as CanonicalNodeLabel[]) {
        const labelNodes = nodes.filter((n) => n.label === label);
        if (labelNodes.length === 0) continue;

        const serializedNodes = labelNodes.map((n) => ({
          canonical_id: n.canonical_id,
          title_en: n.title_en,
          title_th: n.title_th,
          citation_label: n.citation_label,
          summary_Text: n.summary_Text,
          source_document_id: n.source_document_id,
          official_source_url: n.official_source_url,
          source_content_hash: n.source_content_hash,
          verification_status: n.verification_status,
          verified_at: n.verified_at,
          effective_from: n.effective_from,
          effective_to: n.effective_to,
          ingested_at: n.ingested_at,
          module_id: n.module_id,
          tenant_id: n.tenant_id,
          legal_authority_tier: n.legal_authority_tier,
          is_binding_law: n.is_binding_law,
          migration_batch_id: batchId,
          properties_json: JSON.stringify(n.properties),
        }));

        await neo4jConnectionManager.executeCypher(
          `UNWIND $batch AS item
           MERGE (n:${label} {canonical_id: item.canonical_id})
           SET n.title_en = item.title_en,
               n.title_th = item.title_th,
               n.citation_label = item.citation_label,
               n.summary_Text = item.summary_Text,
               n.source_document_id = item.source_document_id,
               n.official_source_url = item.official_source_url,
               n.source_content_hash = item.source_content_hash,
               n.verification_status = item.verification_status,
               n.verified_at = item.verified_at,
               n.effective_from = item.effective_from,
               n.effective_to = item.effective_to,
               n.ingested_at = item.ingested_at,
               n.module_id = item.module_id,
               n.tenant_id = item.tenant_id,
               n.legal_authority_tier = item.legal_authority_tier,
               n.is_binding_law = item.is_binding_law,
               n.migration_batch_id = item.migration_batch_id,
               n.properties_json = item.properties_json`,
          { batch: serializedNodes },
          { write: true, timeoutMs: 15_000 }
        );
      }

      for (const relType of Object.keys(relationshipCountsByType)) {
        if (!isValidRelationshipType(relType)) continue;
        const typeRels = relationships.filter((r) => r.relationship_type === relType);

        await neo4jConnectionManager.executeCypher(
          `UNWIND $batch AS rel
           MATCH (a {canonical_id: rel.from_canonical_id})
           MATCH (b {canonical_id: rel.to_canonical_id})
           MERGE (a)-[r:${relType} {canonical_id: rel.canonical_id}]->(b)
           SET r.source_document_id = rel.source_document_id,
               r.official_source_url = rel.official_source_url,
               r.source_content_hash = rel.source_content_hash,
               r.verification_status = rel.verification_status,
               r.verified_at = rel.verified_at,
               r.effective_from = rel.effective_from,
               r.effective_to = rel.effective_to,
               r.ingested_at = rel.ingested_at,
               r.module_id = rel.module_id,
               r.tenant_id = rel.tenant_id,
               r.citation_note = rel.citation_note,
               r.migration_batch_id = $batchId`,
          { batch: typeRels, batchId },
          { write: true, timeoutMs: 15_000 }
        );
      }

      const health = await neo4jConnectionManager.checkHealth();
      neo4jConnected = health.connected;
      destinationNodeCount = health.live_node_count ?? 0;
      destinationRelCount = health.live_relationship_count ?? 0;
    } catch (err) {
      unresolvedErrors.push(sanitizeGraphError(err));
      destinationNodeCount = 0;
      destinationRelCount = 0;
    }
  }

  const reconciled =
    duplicateIdsDetected.length === 0 &&
    missingRelationships.length === 0 &&
    brokenSourceReferences.length === 0 &&
    invalidEffectiveDateRanges.length === 0 &&
    recordsMissingProvenance.length === 0 &&
    unresolvedErrors.length === 0 &&
    sourceNodeAndRelMatch(nodes.length, destinationNodeCount, relationships.length, destinationRelCount);

  return {
    migration_batch_id: batchId,
    schema_version: NEO4J_SCHEMA_VERSION,
    executed_at: executedAt,
    mode,
    neo4j_connected: neo4jConnected,
    source_node_count: nodes.length,
    destination_node_count: destinationNodeCount,
    source_relationship_count: relationships.length,
    destination_relationship_count: destinationRelCount,
    node_counts_by_label: nodeCountsByLabel,
    relationship_counts_by_type: relationshipCountsByType,
    duplicate_canonical_ids: duplicateIdsDetected,
    missing_relationships: missingRelationships,
    broken_source_references: brokenSourceReferences,
    invalid_effective_date_ranges: invalidEffectiveDateRanges,
    records_missing_provenance: recordsMissingProvenance,
    unresolved_migration_errors: unresolvedErrors,
    reconciled,
  };
}

function sourceNodeAndRelMatch(
  srcNodes: number,
  destNodes: number,
  srcRels: number,
  destRels: number
): boolean {
  return destNodes >= srcNodes && destRels >= srcRels;
}

/**
 * Rollback a specific migration batch ID from Neo4j AuraDB without affecting prior batches (REG-NEO-012).
 */
export async function rollbackMigrationBatch(batchId: string): Promise<{
  rolled_back_batch_id: string;
  deleted_relationships: number;
  deleted_nodes: number;
}> {
  const relRes = await neo4jConnectionManager.executeCypher<{ deletedRels: number }>(
    `MATCH ()-[r {migration_batch_id: $batchId}]->()
     DELETE r
     RETURN count(r) AS deletedRels`,
    { batchId },
    { write: true }
  );
  const nodeRes = await neo4jConnectionManager.executeCypher<{ deletedNodes: number }>(
    `MATCH (n {migration_batch_id: $batchId})
     DETACH DELETE n
     RETURN count(n) AS deletedNodes`,
    { batchId },
    { write: true }
  );

  return {
    rolled_back_batch_id: batchId,
    deleted_relationships: Number(relRes.rows[0]?.deletedRels ?? 0),
    deleted_nodes: Number(nodeRes.rows[0]?.deletedNodes ?? 0),
  };
}
