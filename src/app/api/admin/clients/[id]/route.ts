import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await createServices();
    return NextResponse.json(await s.clients.get((await params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    return NextResponse.json(
      await s.clients.update((await params).id, await readJsonBody(request)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
