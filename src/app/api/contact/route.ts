import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { contactClientAddress } from "@/server/contact-context";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const config = await loadConfig();
    if (!config.CONTACT_ENABLED)
      throw new AppError(
        "CONTACT_UNAVAILABLE",
        "The contact service is not connected in this environment.",
        503,
      );
    const address = contactClientAddress(
      request.headers,
      config.CONTACT_CLIENT_IP_HEADER,
    );
    const s = await createServices();
    const result = await s.contact.submit(
      await readJsonBody(request, 24000),
      address,
    );
    return NextResponse.json(result, {
      status: result.status === "accepted" ? 200 : 202,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
