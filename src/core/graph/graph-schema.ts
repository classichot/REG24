/**
 * REG24 — Neo4j Legal Knowledge Graph Canonical Ontology & Schema
 * Requirement ID: REG24-INFRA-NEO4J-001 (REG-NEO-004, REG-NEO-005, REG-NEO-006, REG-NEO-019)
 */

export const NEO4J_SCHEMA_VERSION = "reg24.neo4j.schema.v2.1.0";

/**
 * REG-NEO-004 — Canonical Legal Node Labels
 */
export const ALLOWED_NODE_LABELS = [
  "LegalInstrument",
  "Provision",
  "ProvisionVersion",
  "CourtDecision",
  "TaxRuling",
  "SubRegulation",
  "Regulator",
  "LegalConcept",
  "Obligation",
  "Rule",
  "IndustryModule",
  "SourceDocument",
  "LegalEntity",
] as const;

export type CanonicalNodeLabel = (typeof ALLOWED_NODE_LABELS)[number];

/**
 * REG-NEO-005 — Validated Relationship Types
 * Strict whitelist prevents dynamic relationship injection from untrusted input.
 */
export const ALLOWED_RELATIONSHIP_TYPES = [
  "CONTAINS",
  "HAS_VERSION",
  "ISSUED_UNDER",
  "AMENDS",
  "REFERS_TO",
  "INTERPRETS",
  "CITES",
  "DERIVED_FROM",
  "RELATED_TO",
  "USES",
  "SUPPORTS",
  // Preserved REG24 3R GraphRAG relationship types (REG-NEO-010)
  "EXCEPTION_TO",
  "GOVERNED_BY",
  "PENALTY_UNDER",
  "PROMOTED_BY",
  "SUPERSEDES",
] as const;

export type CanonicalRelationshipType = (typeof ALLOWED_RELATIONSHIP_TYPES)[number];

export type LegalAuthorityTier =
  | "PRIMARY_STATUTE"
  | "SUBORDINATE_REGULATION"
  | "SUPREME_COURT_PRECEDENT"
  | "ADMINISTRATIVE_TAX_RULING"
  | "REGULATORY_GUIDANCE"
  | "DERIVED_COMPLIANCE_OBLIGATION"
  | "EXECUTABLE_DETERMINISTIC_RULE"
  | "CONSULTATION_DRAFT";

/**
 * REG-NEO-006 & REG-NEO-019 — Bi-Temporal & Provenance Metadata Contract
 */
export interface GraphProvenanceMetadata {
  canonical_id: string;
  source_document_id: string;
  official_source_url: string;
  source_content_hash: string;
  verification_status: "verified" | "pending_review" | "quarantined" | "deprecated";
  verified_at: string;
  /** valid_time start (ISO-8601 date YYYY-MM-DD) */
  effective_from: string;
  /** valid_time end (ISO-8601 date YYYY-MM-DD or null if currently in force) */
  effective_to: string | null;
  /** system_time when REG24 ingested/recorded the item */
  ingested_at: string;
  module_id: string;
  tenant_id: string; // "PUBLIC" for canonical Thai laws, or specific tenant ID for private tenant data
  legal_authority_tier: LegalAuthorityTier;
  is_binding_law: boolean;
}

export interface CanonicalGraphNode extends GraphProvenanceMetadata {
  label: CanonicalNodeLabel;
  title_en: string;
  title_th: string;
  citation_label: string;
  summary_Text: string;
  properties: Record<string, string | number | boolean | string[] | null>;
}

export interface CanonicalGraphRelationship {
  canonical_id: string;
  relationship_type: CanonicalRelationshipType;
  from_canonical_id: string;
  from_label: CanonicalNodeLabel;
  to_canonical_id: string;
  to_label: CanonicalNodeLabel;
  source_document_id: string;
  official_source_url: string;
  source_content_hash: string;
  verification_status: "verified" | "ai_inferred_quarantined" | "rejected";
  verified_at: string;
  effective_from: string;
  effective_to: string | null;
  ingested_at: string;
  module_id: string;
  tenant_id: string;
  citation_note: string;
}

/**
 * Validates that a node label is in the strict canonical ontology whitelist.
 */
export function isValidNodeLabel(label: string): label is CanonicalNodeLabel {
  return (ALLOWED_NODE_LABELS as readonly string[]).includes(label);
}

/**
 * Validates that a relationship type is in the strict canonical ontology whitelist.
 * Prevents Cypher injection via relationship type interpolation (REG-NEO-005, REG-NEO-016).
 */
export function isValidRelationshipType(relType: string): relType is CanonicalRelationshipType {
  return (ALLOWED_RELATIONSHIP_TYPES as readonly string[]).includes(relType);
}

/**
 * Cypher DDL statements for Neo4j AuraDB constraints and indexes (REG-NEO-004, REG-NEO-009).
 */
export const NEO4J_SCHEMA_CONSTRAINTS_CYPHER: string[] = [
  ...ALLOWED_NODE_LABELS.map(
    (label) =>
      `CREATE CONSTRAINT uniq_${label.toLowerCase()}_canonical_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.canonical_id IS UNIQUE`
  ),
  `CREATE INDEX idx_provision_effective_dates IF NOT EXISTS FOR (p:Provision) ON (p.effective_from, p.effective_to)`,
  `CREATE INDEX idx_provision_version_temporal IF NOT EXISTS FOR (pv:ProvisionVersion) ON (pv.effective_from, pv.effective_to, pv.ingested_at)`,
  `CREATE INDEX idx_provision_module IF NOT EXISTS FOR (p:Provision) ON (p.module_id)`,
  `CREATE INDEX idx_node_tenant_isolation IF NOT EXISTS FOR (p:Provision) ON (p.tenant_id)`,
  `CREATE FULLTEXT INDEX ft_legal_provisions IF NOT EXISTS FOR (n:Provision|ProvisionVersion|CourtDecision|TaxRuling|SubRegulation|LegalInstrument) ON EACH [n.title_en, n.title_th, n.citation_label, n.summary_Text]`,
];
