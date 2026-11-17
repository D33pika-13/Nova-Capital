import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { errorResponse } from "@/server/http";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await createServices();
    const url = await s.reports.download((await params).id);
    return NextResponse.redirect(url, {
      status: 303,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
