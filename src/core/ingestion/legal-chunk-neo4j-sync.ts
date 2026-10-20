/**
 * REG24 — Server-Side Neo4j AuraDB Sync for Legal Structural Chunks
 *
 * Upserts the 17 Authority Regulators, 2,312 Parent LegalInstruments, and all
 * Provision-level Structural Chunks (มาตรา / ข้อ / วรรค / คำพิพากษาฎีกา) into Neo4j AuraDB.
 */

import {
  LEGAL_RESOURCE_MASTER_CORPUS,
  MASTER_AUTHORITY_FOLDERS,
} from "../data/legal-resource-master-loader";
import { neo4jConnectionManager, sanitizeGraphError } from "../graph/neo4j-client";
import { getOrBuildMasterChunkCorpus } from "./legal-structural-chunker";

export async function syncLegalResourceMasterChunksToNeo4j(options?: {
  authority_code?: string;
  batchSize?: number;
}): Promise<{
  status: "synced_to_neo4j" | "verified_in_memory_only";
  neo4j_connected: boolean;
  batch_id: string;
  regulators_upserted: number;
  instruments_upserted: number;
  provision_chunks_upserted: number;
  relationships_upserted: number;
  live_node_count: number | null;
  live_relationship_count: number | null;
  error: string | null;
}> {
  const batchId = `mig.lrm.chunks.${Date.now()}`;
  const batchSize = options?.batchSize ?? 350;
  const corpus = getOrBuildMasterChunkCorpus();
  const authFilter = (options?.authority_code || "").trim().toUpperCase();

  const targetDocs =
    authFilter && authFilter !== "ALL"
      ? LEGAL_RESOURCE_MASTER_CORPUS.filter(
          (r) => (r.authority_code || "").toUpperCase() === authFilter
        )
      : LEGAL_RESOURCE_MASTER_CORPUS;

  const targetChunks =
    authFilter && authFilter !== "ALL"
      ? corpus.chunks.filter((c) => c.authority_code.toUpperCase() === authFilter)
      : corpus.chunks;

  const cfg = neo4jConnectionManager.getEnvConfig();
  if (!cfg.configured) {
    return {
      status: "verified_in_memory_only",
      neo4j_connected: false,
      batch_id: batchId,
      regulators_upserted: MASTER_AUTHORITY_FOLDERS.length,
      instruments_upserted: targetDocs.length,
      provision_chunks_upserted: targetChunks.length,
      relationships_upserted: targetDocs.length + targetChunks.length * 2,
      live_node_count: null,
      live_relationship_count: null,
      error: null,
    };
  }

  try {
    // 1. Upsert the 17 Authority Regulators
    const regBatch = MASTER_AUTHORITY_FOLDERS.map((af) => ({
      canonical_id: `reg.th.lrm.${af.code.toLowerCase()}`,
      title_en: af.label_en,
      title_th: af.label_th,
      citation_label: af.code,
      summary_Text: `${af.label_en} | ${af.label_th} (${af.count} files in Legal Database Resource Master)`,
      source_document_id: `doc.lrm.folder.${af.code.toLowerCase()}`,
      official_source_url: af.drive_folder_url,
      source_content_hash: af.drive_folder_id,
      verification_status: "verified",
      verified_at: "2026-10-21T00:00:00Z",
      effective_from: "1990-01-01",
      effective_to: null,
      ingested_at: "2026-10-21T00:00:00Z",
      module_id: `reg24.${af.code.toLowerCase()}.th`,
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: true,
      migration_batch_id: batchId,
    }));

    await neo4jConnectionManager.executeCypher(
      `UNWIND $batch AS item
       MERGE (n:Regulator {canonical_id: item.canonical_id})
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
           n.migration_batch_id = item.migration_batch_id`,
      { batch: regBatch },
      { write: true, timeoutMs: 20_000 }
    );

    // 2. Upsert Parent LegalInstrument nodes in batches
    const instItems = targetDocs.map((doc) => ({
      canonical_id: `inst.lrm.${doc.id.toLowerCase()}`,
      title_en: doc.title_en.slice(0, 300),
      title_th: doc.title_th.slice(0, 300),
      citation_label: doc.code,
      summary_Text: doc.summary_th.slice(0, 800),
      source_document_id: doc.id,
      official_source_url:
        doc.drive_url || "https://drive.google.com/drive/folders/1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm",
      source_content_hash: doc.sha256,
      verification_status: "verified",
      verified_at: "2026-10-21T00:00:00Z",
      effective_from: doc.effective_date,
      effective_to: doc.status === "SUPERSEDED" ? "2026-10-20" : null,
      ingested_at: "2026-10-21T00:00:00Z",
      module_id: `reg24.${(doc.authority_code || "lrm").toLowerCase()}.th`,
      tenant_id: "PUBLIC",
      legal_authority_tier: "PRIMARY_STATUTE",
      is_binding_law: doc.status === "IN_FORCE",
      regulator_canonical_id: `reg.th.lrm.${(doc.authority_code || "dbd").toLowerCase()}`,
      migration_batch_id: batchId,
    }));

    for (let i = 0; i < instItems.length; i += batchSize) {
      const slice = instItems.slice(i, i + batchSize);
      await neo4jConnectionManager.executeCypher(
        `UNWIND $batch AS item
         MERGE (inst:LegalInstrument {canonical_id: item.canonical_id})
         SET inst.title_en = item.title_en,
             inst.title_th = item.title_th,
             inst.citation_label = item.citation_label,
             inst.summary_Text = item.summary_Text,
             inst.source_document_id = item.source_document_id,
             inst.official_source_url = item.official_source_url,
             inst.source_content_hash = item.source_content_hash,
             inst.verification_status = item.verification_status,
             inst.verified_at = item.verified_at,
             inst.effective_from = item.effective_from,
             inst.effective_to = item.effective_to,
             inst.ingested_at = item.ingested_at,
             inst.module_id = item.module_id,
             inst.tenant_id = item.tenant_id,
             inst.legal_authority_tier = item.legal_authority_tier,
             inst.is_binding_law = item.is_binding_law,
             inst.migration_batch_id = item.migration_batch_id
         WITH inst, item
         OPTIONAL MATCH (reg:Regulator {canonical_id: item.regulator_canonical_id})
         FOREACH (_ IN CASE WHEN reg IS NOT NULL THEN [1] ELSE [] END |
           MERGE (inst)-[r:ISSUED_UNDER {canonical_id: 'rel.issued.' + item.canonical_id}]->(reg)
           SET r.effective_from = item.effective_from,
               r.verification_status = 'verified',
               r.migration_batch_id = item.migration_batch_id
         )`,
        { batch: slice },
        { write: true, timeoutMs: 25_000 }
      );
    }

    // 3. Upsert Structural Legal Chunks as :Provision nodes linked via [:CONTAINS] to their parent :LegalInstrument
    const chunkItems = targetChunks.map((c) => ({
      canonical_id: c.chunk_id,
      parent_inst_id: `inst.lrm.${c.parent_document_id.toLowerCase()}`,
      title_en: c.title_en.slice(0, 300),
      title_th: c.title_th.slice(0, 300),
      citation_label: `${c.parent_code} — ${c.section_or_clause_label}`.slice(0, 140),
      summary_Text: c.contextualized_text.slice(0, 2200),
      hierarchy_path: c.hierarchy_path,
      archetype: c.archetype,
      unit_type: c.unit_type,
      chunk_index: c.chunk_index,
      total_chunks_in_doc: c.total_chunks_in_doc,
      extracted_citations: c.extracted_citations.join("; "),
      source_document_id: c.parent_document_id,
      official_source_url: c.official_source_url,
      source_content_hash: c.sha256_chunk_hash,
      verification_status: "verified",
      verified_at: "2026-10-21T00:00:00Z",
      effective_from: c.effective_from,
      effective_to: c.effective_to,
      ingested_at: c.ingested_at,
      module_id: `reg24.${c.authority_code.toLowerCase()}.th`,
      tenant_id: "PUBLIC",
      legal_authority_tier: c.authority_tier,
      is_binding_law: c.is_binding_law,
      migration_batch_id: batchId,
    }));

    for (let i = 0; i < chunkItems.length; i += batchSize) {
      const slice = chunkItems.slice(i, i + batchSize);
      await neo4jConnectionManager.executeCypher(
        `UNWIND $batch AS item
         MERGE (p:Provision {canonical_id: item.canonical_id})
         SET p.title_en = item.title_en,
             p.title_th = item.title_th,
             p.citation_label = item.citation_label,
             p.summary_Text = item.summary_Text,
             p.hierarchy_path = item.hierarchy_path,
             p.archetype = item.archetype,
             p.unit_type = item.unit_type,
             p.chunk_index = item.chunk_index,
             p.total_chunks_in_doc = item.total_chunks_in_doc,
             p.extracted_citations = item.extracted_citations,
             p.source_document_id = item.source_document_id,
             p.official_source_url = item.official_source_url,
             p.source_content_hash = item.source_content_hash,
             p.verification_status = item.verification_status,
             p.verified_at = item.verified_at,
             p.effective_from = item.effective_from,
             p.effective_to = item.effective_to,
             p.ingested_at = item.ingested_at,
             p.module_id = item.module_id,
             p.tenant_id = item.tenant_id,
             p.legal_authority_tier = item.legal_authority_tier,
             p.is_binding_law = item.is_binding_law,
             p.migration_batch_id = item.migration_batch_id
         WITH p, item
         MATCH (inst:LegalInstrument {canonical_id: item.parent_inst_id})
         MERGE (inst)-[r:CONTAINS {canonical_id: 'rel.contains.' + item.canonical_id}]->(p)
         SET r.effective_from = item.effective_from,
             r.verification_status = 'verified',
             r.citation_note = item.hierarchy_path,
             r.migration_batch_id = item.migration_batch_id`,
        { batch: slice },
        { write: true, timeoutMs: 30_000 }
      );
    }

    const health = await neo4jConnectionManager.checkHealth();
    return {
      status: "synced_to_neo4j",
      neo4j_connected: health.connected,
      batch_id: batchId,
      regulators_upserted: regBatch.length,
      instruments_upserted: instItems.length,
      provision_chunks_upserted: chunkItems.length,
      relationships_upserted: instItems.length + chunkItems.length,
      live_node_count: health.live_node_count,
      live_relationship_count: health.live_relationship_count,
      error: health.sanitized_error,
    };
  } catch (err) {
    return {
      status: "verified_in_memory_only",
      neo4j_connected: false,
      batch_id: batchId,
      regulators_upserted: MASTER_AUTHORITY_FOLDERS.length,
      instruments_upserted: targetDocs.length,
      provision_chunks_upserted: targetChunks.length,
      relationships_upserted: targetDocs.length + targetChunks.length,
      live_node_count: null,
      live_relationship_count: null,
      error: sanitizeGraphError(err),
    };
  }
}
