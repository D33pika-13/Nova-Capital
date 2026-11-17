import { NextResponse } from "next/server";
import { loadConfig } from "@/server/config";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json(
      {
        status: "ok",
        mode: config.SERVICES_ENABLED ? "configured" : "public-shell",
        dependenciesVerified: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
