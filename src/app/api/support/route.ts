import { NextResponse } from "next/server";
import { loadConfig } from "@/server/config";
import { createServices } from "@/server/composition";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
export async function GET() {
  try {
    const config = await loadConfig();
    if (!config.SERVICES_ENABLED)
      return NextResponse.json(
        { audience: "public", mode: "faq" },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const s = await createServices();
    let context;
    try {
      context = await s.auth.requireUser();
    } catch (error) {
      if (!(error instanceof AppError && error.status === 401)) throw error;
    }
    return NextResponse.json(
      {
        audience: context?.profile.role === "client" ? "client" : "public",
        mode: config.AI_PROVIDER === "disabled" ? "faq" : "ai",
        viewerKey:
          context?.profile.role === "client" ? context.profile.id : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
