import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function GET() {
  try {
    const s = await createServices();
    return NextResponse.json(await s.offers.manage(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    await s.auth.requireAdmin();
    return NextResponse.json(
      await s.offers.save(await readJsonBody(request, 90_000)),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
