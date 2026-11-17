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
    await s.auth.requireUser();
    return NextResponse.json(
      await s.announcements.markRead(
        (await params).id,
        await readJsonBody(request, 1024),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
