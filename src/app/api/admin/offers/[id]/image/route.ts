import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { AppError } from "@/server/errors";
import { assertSameOrigin, errorResponse, readBinaryBody } from "@/server/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await createServices();
    const bytes = await s.offerImages.read(
      (await params).id,
      true,
      new URL(request.url).searchParams.get("version") ?? undefined,
    );
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline; filename=offer-image.webp",
      },
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
    const header = request.headers.get("x-image-metadata");
    if (!header || header.length > 8192)
      throw new AppError("INVALID_INPUT", "Image metadata is required.", 422);
    let metadata: unknown;
    try {
      metadata = JSON.parse(decodeURIComponent(header));
    } catch {
      throw new AppError("INVALID_INPUT", "Invalid image metadata.", 422);
    }
    return NextResponse.json(
      await s.offerImages.upload(
        (await params).id,
        metadata,
        await readBinaryBody(request, s.config.OFFER_IMAGE_MAX_BYTES),
        request.headers.get("content-type") ?? "",
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
