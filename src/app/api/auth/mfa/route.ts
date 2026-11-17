import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    if (s.entra) return s.entra.mfaHttp.execute(request);
    if (!s.mfa) throw Error("unavailable");
    return NextResponse.json(await s.mfa.execute(await readJsonBody(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
