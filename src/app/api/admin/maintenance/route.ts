import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse } from "@/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    return NextResponse.json(await s.maintenance.runAsAdmin(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const s = await createServices();
    return NextResponse.json(await s.maintenance.status(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
