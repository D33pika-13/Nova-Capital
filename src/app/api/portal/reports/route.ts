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
        "Reports use your signed-in account only.",
        422,
      );
    return NextResponse.json(await s.reports.clientList(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
