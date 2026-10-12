import { NextRequest, NextResponse } from "next/server";
import { detail } from "@/lib/eudamed";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  // Only real EUDAMED ids go into the upstream URL.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  }
  try {
    const data = await detail(uuid);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Upstream request failed" },
      { status: 502 },
    );
  }
}
