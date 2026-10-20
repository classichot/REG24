import { NextRequest, NextResponse } from "next/server";
import {
  searchLegalResourceMaster,
  getLegalResourceMasterById,
  RESOURCE_MASTER_COLLECTIONS,
  MASTER_AUTHORITY_FOLDERS,
  MASTER_DRIVE_FOLDER_URL,
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
        source: "REG24 Google Drive — Legal Database Resource Master",
        record,
      });
    }

    const query = searchParams.get("q") || searchParams.get("query") || "";
    const collection = (searchParams.get("collection") || "ALL") as
      | ResourceMasterCollectionId
      | "ALL";
    const authorityCode =
      searchParams.get("authority") || searchParams.get("authority_code") || "";
    const regulator = searchParams.get("regulator") || "";
    const yearBeParam = searchParams.get("year_be");
    const limitParam = searchParams.get("limit");
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
    const { query, collection, authority_code, authority, regulator, year_be, limit, offset } =
      body || {};
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
        error: "Failed to execute Resource Master search",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
