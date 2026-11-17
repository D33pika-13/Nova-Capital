import { NextResponse } from "next/server";
import { createServices } from "@/server/composition";
import { loadConfig } from "@/server/config";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = (await loadConfig()).APP_URL;
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, base), {
      status: 303,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  try {
    const { authCallback } = await createServices();
    if (!authCallback) return redirect("/login?error=link");
    return redirect((await authCallback.complete(url.searchParams)).redirect);
  } catch {
    /* Return only a safe error state. */
  }
  return redirect("/login?error=link");
}
