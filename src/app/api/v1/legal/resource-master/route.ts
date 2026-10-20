import { NextRequest, NextResponse } from "next/server";
import {
  searchLegalResourceMaster,
  getLegalResourceMasterById,
  RESOURCE_MASTER_COLLECTIONS,
  MASTER_AUTHORITY_FOLDERS,
  MASTER_DRIVE_FOLDER_URL,
  type ResourceMasterCollectionId,
} from "@/core/data/legal-resource-master-loader";
import {
  chunkLegalDocumentRecord,
  searchLegalStructuralChunks,
  type LegalDocumentArchetype,
  type LegalStructuralUnitType,
} from "@/core/ingestion/legal-structural-chunker";
import { syncLegalResourceMasterChunksToNeo4j } from "@/core/ingestion/legal-chunk-neo4j-sync";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") || "";
    const id = searchParams.get("id");

    if (id) {
      const record = getLegalResourceMasterById(id);
      if (!record) {
        return NextResponse.json(
          { error: `Resource Master regulation '${id}' not found.` },
          { status: 404 }
        );
      }
      const structuralChunks = chunkLegalDocumentRecord(record);
      return NextResponse.json({
        status: "ok",
        source: "REG24 Google Drive — Legal Database Resource Master",
        record,
        structural_chunking: {
          method: "REG24 4-Archetype Legal Structural & Contextual Chunking (REG-AI-01 & REG-AI-03)",
          total_chunks: structuralChunks.length,
          chunks: structuralChunks,
        },
      });
    }

    const query = searchParams.get("q") || searchParams.get("query") || "";
    const authorityCode =
      searchParams.get("authority") || searchParams.get("authority_code") || "";
    const limitParam = searchParams.get("limit");

    if (mode === "chunks") {
      const archetype = (searchParams.get("archetype") || "ALL") as
        | LegalDocumentArchetype
        | "ALL";
      const unitType = (searchParams.get("unit_type") || "ALL") as
        | LegalStructuralUnitType
        | "ALL";
      const parentDocId = searchParams.get("doc_id") || "";

      const chunkResult = searchLegalStructuralChunks({
        query,
        authority_code: authorityCode,
        archetype,
        unit_type: unitType,
        parent_document_id: parentDocId,
        limit: limitParam ? parseInt(limitParam, 10) : 50,
      });

      return NextResponse.json({
        status: "ok",
        chunking_methodology: {
          engine: "REG24 Legal Structural & Contextual Chunker v2.0 (REG-AI-01 & REG-AI-03)",
          principles: [
            "1. Archetype A (Statutes/Royal Decrees): Split by Section (มาตรา) and Paragraph (วรรค) while preserving the governing Chapeau (วรรคหนึ่ง) on sub-clauses",
            "2. Archetype B (Notifications/Exchange Rules): Split by Enabling Preamble (อาศัยอำนาจตามความใน...), Clause (ข้อ), Transitional (บทเฉพาะกาล), and Schedule/Annex (บัญชีท้ายประกาศ)",
            "3. Archetype C (Judicial Decisions / Deka): 4-Part IRAC split into Case Header & Cited Statutes, Material Facts & Issues, Judicial Reasoning, and Final Holding",
            "4. Archetype D (Administrative Rulings): Split into Facts, Applicable Law, and Non-Binding Ruling (explicitly tagged is_binding_law = false per REG-AI-06)",
            "5. Thai Royal Gazette Normalization: Resolves split Sara-Am (ำ) ligatures and Thai numerals (๐-๙ -> 0-9) before indexing",
            "6. Contextual Header Injection: Prepends Authority, Instrument, Hierarchy Path, Temporal Validity, and Authority Tier to every chunk",
          ],
        },
        ...chunkResult,
      });
    }

    const collection = (searchParams.get("collection") || "ALL") as
      | ResourceMasterCollectionId
      | "ALL";
    const regulator = searchParams.get("regulator") || "";
    const yearBeParam = searchParams.get("year_be");
    const offsetParam = searchParams.get("offset");

    const response = searchLegalResourceMaster({
      query,
      collection,
      authority_code: authorityCode,
      regulator,
      year_be: yearBeParam ? parseInt(yearBeParam, 10) : undefined,
      limit: limitParam ? parseInt(limitParam, 10) : 60,
      offset: offsetParam ? parseInt(offsetParam, 10) : 0,
    });

    const chunkSummary = searchLegalStructuralChunks({
      authority_code: authorityCode,
      limit: 1,
    });

    return NextResponse.json({
      status: "ok",
      source:
        "REG24 Google Drive — Legal Database Resource Master (1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm — All 17 Authority Folders)",
      drive_sync_metadata: {
        google_drive_account_id: "105088240612977611801",
        master_drive_folder_id: "1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm",
        master_drive_folder_url: MASTER_DRIVE_FOLDER_URL,
        authority_folders_count: MASTER_AUTHORITY_FOLDERS.length,
        authority_folders: MASTER_AUTHORITY_FOLDERS.map((af) => ({
          code: af.code,
          folder_name: af.folder_name,
          drive_folder_id: af.drive_folder_id,
          drive_folder_url: af.drive_folder_url,
          subfolders: af.subfolders,
          file_count: af.count,
        })),
        total_regulations_incorporated: response.total_corpus_count,
        structural_chunking_summary: {
          total_documents_chunked: chunkSummary.total_documents_chunked,
          total_structural_chunks: chunkSummary.total_structural_chunks,
          archetype_breakdown: chunkSummary.archetype_breakdown,
          unit_type_breakdown: chunkSummary.unit_type_breakdown,
          authority_chunk_counts: chunkSummary.authority_chunk_counts,
        },
      },
      ...response,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to query Legal Database Resource Master",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      action,
      query,
      collection,
      authority_code,
      authority,
      regulator,
      year_be,
      limit,
      offset,
    } = body || {};

    if (action === "sync_chunks_to_neo4j") {
      const syncReport = await syncLegalResourceMasterChunksToNeo4j({
        authority_code: authority_code || authority || "ALL",
      });
      return NextResponse.json({
        status: "ok",
        action: "sync_chunks_to_neo4j",
        neo4j_sync_report: syncReport,
      });
    }

    if (action === "search_chunks") {
      const chunkRes = searchLegalStructuralChunks({
        query,
        authority_code: authority_code || authority || "",
        limit: limit ?? 50,
      });
      return NextResponse.json({
        status: "ok",
        action: "search_chunks",
        ...chunkRes,
      });
    }

    const response = searchLegalResourceMaster({
      query,
      collection: collection || "ALL",
      authority_code: authority_code || authority || "",
      regulator,
      year_be,
      limit: limit ?? 60,
      offset: offset ?? 0,
    });

    return NextResponse.json({
      status: "ok",
      collections_catalog: RESOURCE_MASTER_COLLECTIONS,
      ...response,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to execute Resource Master operation",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
