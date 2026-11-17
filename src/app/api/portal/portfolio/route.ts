import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { errorResponse } from "@/server/http";
import { AppError } from "@/server/errors";
export async function GET(request: Request) {
  try {
    const s = await createServices();
    if (new URL(request.url).search)
      throw new AppError(
        "INVALID_INPUT",
        "This endpoint uses your signed-in account only.",
        422,
      );
    return NextResponse.json(await s.portfolio.clientOverview(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
