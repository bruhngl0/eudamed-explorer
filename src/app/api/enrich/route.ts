import { NextRequest, NextResponse } from "next/server";
import { enrichItems } from "@/lib/eudamed";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Fills the detail-only fields (device name/model, criterion, AR country,
// additional description, market distribution) for a small batch of devices. The page and the
// exporter call this a few rows at a time so results arrive progressively and
// no request comes near App Runner's 120s limit.
// Body: { items: [{ uuid, basicUdi }] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const items = (Array.isArray(body?.items) ? body.items : [])
    .filter((it: any) => typeof it?.uuid === "string" && it.uuid)
    .slice(0, 10)
    .map((it: any) => ({
      uuid: it.uuid as string,
      basicUdi: typeof it.basicUdi === "string" ? it.basicUdi : null,
    }));
  if (items.length === 0) return NextResponse.json({ data: {} });
  return NextResponse.json({ data: await enrichItems(items) });
}
