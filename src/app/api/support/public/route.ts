import { NextResponse } from "next/server";
import { loadConfig } from "@/server/config";
import { createServices } from "@/server/composition";
import { FaqResponder } from "@/server/modules/support/faq-responder";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const config = await loadConfig();
    const input = await readJsonBody(request, 10000);
    const reply = config.SERVICES_ENABLED
      ? await (await createServices()).support.publicAnswer(input)
      : new FaqResponder().respond(input);
    return NextResponse.json(reply, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
