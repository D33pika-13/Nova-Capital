import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { errorResponse } from "@/server/http";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(
      await (await createServices()).chat.history((await params).id),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
