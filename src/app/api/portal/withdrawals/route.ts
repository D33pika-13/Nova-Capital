import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { errorResponse } from "@/server/http";
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search)
      return NextResponse.json(
        {
          code: "INVALID_INPUT",
          error: "Client identity is determined by your session.",
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    const services = await createServices();
    return NextResponse.json(await services.withdrawals.clientList(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
