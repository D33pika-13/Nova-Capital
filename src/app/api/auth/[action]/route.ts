import { NextResponse } from "next/server";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/server/http";
import { createServices } from "@/server/composition";
import { AuthService } from "@/server/modules/identity/auth-service";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    await assertSameOrigin(request);
    const services = await createServices();
    const { action } = await params;
    if (services.entra) {
      if (action === "logout") return services.entra.authHttp.logout(request);
      throw new AppError(
        "BROWSER_AUTH_REQUIRED",
        "Continue through the secure sign-in page.",
        400,
      );
    }
    const auth = new AuthService(
      services.identity,
      services.auth,
      services.limits,
    );
    if (action === "logout") {
      await services.identity.signOut();
      return NextResponse.json(
        { redirect: "/login" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const data = await readJsonBody(request);
    if (action === "login")
      return NextResponse.json(await auth.login(data), {
        headers: { "Cache-Control": "no-store" },
      });
    if (action === "reset")
      return NextResponse.json(await auth.reset(data), {
        headers: { "Cache-Control": "no-store" },
      });
    if (action === "change-password")
      return NextResponse.json(await auth.changePassword(data), {
        headers: { "Cache-Control": "no-store" },
      });
    if (action === "password")
      return NextResponse.json(await auth.setPassword(data), {
        headers: { "Cache-Control": "no-store" },
      });
    throw new AppError("NOT_FOUND", "Unknown operation.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
