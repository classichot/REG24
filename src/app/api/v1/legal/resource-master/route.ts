import { NextRequest, NextResponse } from "next/server";
import {
  searchLegalResourceMaster,
  getLegalResourceMasterById,
  RESOURCE_MASTER_COLLECTIONS,
  type ResourceMasterCollectionId,
} from "@/core/data/legal-resource-master-loader";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (id) {
      const record = getLegalResourceMasterById(id);
      if (!record) {
        return NextResponse.json(
          { error: `Resource Master regulation '${id}' not found.` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        status: "ok",
        source: "REG24 Google Drive & Legal Database Resource Master",
        record,
      });
    }

    const query = searchParams.get("q") || searchParams.get("query") || "";
    const collection = (searchParams.get("collection") || "ALL") as
      | ResourceMasterCollectionId
      | "ALL";
    const regulator = searchParams.get("regulator") || "";
    const yearBeParam = searchParams.get("year_be");
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    const response = searchLegalResourceMaster({
      query,
      collection,
      regulator,
      year_be: yearBeParam ? parseInt(yearBeParam, 10) : undefined,
      limit: limitParam ? parseInt(limitParam, 10) : 60,
      offset: offsetParam ? parseInt(offsetParam, 10) : 0,
    });

    return NextResponse.json({
      status: "ok",
      source: "REG24 Google Drive & Legal Database Resource Master (DriveFS 105088240612977611801 + Master Legal Folders)",
      drive_sync_metadata: {
        google_drive_account_id: "105088240612977611801",
        indexed_folders: [
          "Google Drive / My Drive / Company_Blackhorse Asia / Jinko _ COOP / Regulations / ERC Informations (stable_id: 4615 / 4695)",
          "Google Drive / My Drive / Company_Blackhorse Asia / Blackhorse Silk Legal / Additional ICO Portal / IT Systems & Regulations (stable_id: 5773)",
          "Google Drive / My Drive / Company_7L Advisory / Resources & PDPA (stable_id: 246 / 269 / 408)",
          "Google Drive / My Drive / SAT24 & AI Law Lab (stable_id: 2519 / 2561 / 2719)",
          "OneDrive & Downloads / Pillar2 Regs (prk2567.docx, moftopuptax1.docx, dgtopuptax1–8.docx)",
          "OneDrive / Legal Docs Database (57 Core Thai Law & Supreme Court Compendiums + PPP Law & Rulings)",
          "Downloads / Master_Contract_Taxonomy_Thailand_500.xlsx & ESG24_Source_Register.xlsx",
        ],
        total_regulations_incorporated: response.total_corpus_count,
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
    const { query, collection, regulator, year_be, limit, offset } = body || {};
    const response = searchLegalResourceMaster({
      query,
      collection: collection || "ALL",
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
        error: "Failed to execute Resource Master search",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
