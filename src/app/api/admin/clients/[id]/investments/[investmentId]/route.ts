import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; investmentId: string }> },
) {
  try {
    await assertSameOrigin(request);
    const s = await createServices();
    const { id: clientId, investmentId: id } = await params;
    return NextResponse.json(
      await s.portfolio.editInvestment(
        clientId,
        id,
        await readJsonBody(request, 16384),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
