import { NextRequest, NextResponse } from "next/server";
import { search, mapListRow } from "@/lib/eudamed";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const cndCode = sp.get("cndCode") ?? undefined;
  const page = Number(sp.get("page") ?? "0");
  // The exporter pages through results 100 at a time.
  const pageSize = Math.min(Math.max(Number(sp.get("pageSize") ?? "25"), 1), 100);
  const status =
    sp.get("status") ?? "refdata.device-model-status.on-the-market";

  try {
    const res = await search({
      cndCode,
      deviceStatusCode: status === "all" ? undefined : status,
      page,
      pageSize,
    });
    // Fast: no per-row detail calls here. The client enriches visible rows.
    const rows = (res.content ?? []).map(mapListRow);
    return NextResponse.json({
      rows,
      totalElements: res.totalElements,
      totalPages: res.totalPages,
      page: res.number,
      pageSize: res.size,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Upstream request failed" },
      { status: 502 },
    );
  }
}
