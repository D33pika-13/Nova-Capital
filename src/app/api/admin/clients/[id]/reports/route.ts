import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readBinaryBody } from "@/server/http";
import { AppError } from "@/server/errors";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await createServices();
    return NextResponse.json(await s.reports.adminList((await params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    await s.auth.requireAdmin();
    const header = request.headers.get("x-report-metadata");
    if (!header || header.length > 8192)
      throw new AppError(
        "INVALID_REPORT",
        "Valid report metadata is required.",
        422,
      );
    let metadata: unknown;
    try {
      metadata = JSON.parse(decodeURIComponent(header));
    } catch {
      throw new AppError("INVALID_REPORT", "Invalid report metadata.", 422);
    }
    const bytes = await readBinaryBody(request, s.config.UPLOAD_MAX_BYTES);
    const report = await s.reports.upload((await params).id, metadata, {
      mime: (request.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase(),
      bytes,
    });
    return NextResponse.json(report, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
