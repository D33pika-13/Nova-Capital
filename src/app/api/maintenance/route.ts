import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { errorResponse } from "@/server/http";
export async function POST(request: Request) {
  try {
    const s = await createServices();
    return NextResponse.json(
      await s.maintenance.runScheduled(request.headers.get("authorization")),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
