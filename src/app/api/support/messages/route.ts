import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    await s.auth.requireUser();
    return NextResponse.json(
      await s.chat.send(await readJsonBody(request, 10000)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
