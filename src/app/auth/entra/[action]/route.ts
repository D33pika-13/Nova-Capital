import { createServices } from "@/server/composition";
import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
async function selected() {
  if ((await loadConfig()).AUTH_PROVIDER !== "entra")
    throw new AppError("NOT_FOUND", "Unknown operation.", 404);
  const services = await createServices();
  if (!services.entra)
    throw new AppError(
      "IDENTITY_UNAVAILABLE",
      "Sign-in is temporarily unavailable.",
      503,
    );
  return services.entra.authHttp;
}
function failure(error: unknown) {
  const response = errorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
export async function GET(request: Request, { params }: Context) {
  try {
    if ((await params).action !== "callback")
      throw new AppError("NOT_FOUND", "Unknown operation.", 404);
    return await (await selected()).callback(request);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { action } = await params;
    if (!["start", "recover", "logout"].includes(action))
      throw new AppError("NOT_FOUND", "Unknown operation.", 404);
    const http = await selected();
    return action === "start"
      ? await http.start(request)
      : action === "recover"
        ? await http.recover(request)
        : await http.logoutBrowser(request);
  } catch (error) {
    return failure(error);
  }
}
