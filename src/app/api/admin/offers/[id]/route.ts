import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    await s.auth.requireAdmin();
    return NextResponse.json(
      await s.offers.save(
        await readJsonBody(request, 90_000),
        (await params).id,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
