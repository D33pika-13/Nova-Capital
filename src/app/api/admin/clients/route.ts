import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const s = await createServices();
    const query = new URL(request.url).searchParams;
    return NextResponse.json(await s.clients.list(Object.fromEntries(query)), {
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
    return NextResponse.json(
      await s.clients.create(await readJsonBody(request)),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
