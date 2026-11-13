import { NextResponse } from "next/server";
import { reg24OcrV2Service } from "@/packages/ocr-v2";

export async function GET() {
  return NextResponse.json(reg24OcrV2Service.runGoldenFixtureBenchmark(), {
    status: 200,
  });
}
