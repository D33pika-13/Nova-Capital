import { createServices } from "@/server/composition";
import { errorResponse } from "@/server/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await createServices();
    const bytes = await s.offerImages.read(
      (await params).id,
      false,
      new URL(request.url).searchParams.get("version") ?? undefined,
    );
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": "inline; filename=offer-image.webp",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
