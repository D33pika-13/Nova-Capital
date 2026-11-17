import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { errorResponse } from "@/server/http";
export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await (
        await createServices()
      ).chat.sessions(Object.fromEntries(new URL(request.url).searchParams)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
