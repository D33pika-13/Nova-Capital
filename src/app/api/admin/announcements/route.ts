import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function GET(request: Request) {
  try {
    const s = await createServices();
    return NextResponse.json(
      await s.announcements.manage(
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
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
      await s.announcements.save(await readJsonBody(request, 40000)),
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
