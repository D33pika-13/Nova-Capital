import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const services = await createServices();
    return NextResponse.json(
      await services.withdrawals.record(await readJsonBody(request, 16384)),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
