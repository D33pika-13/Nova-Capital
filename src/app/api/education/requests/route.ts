import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { contactClientAddress } from "@/server/contact-context";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const services = await createServices();
    const address = contactClientAddress(
      request.headers,
      services.config.CONTACT_CLIENT_IP_HEADER,
    );
    return NextResponse.json(
      await services.education.submit(
        await readJsonBody(request, 18000),
        address,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
