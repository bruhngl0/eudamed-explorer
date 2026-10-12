import { NextRequest, NextResponse } from "next/server";
import { detail } from "@/lib/eudamed";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
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
