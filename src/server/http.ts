import "server-only";
import { NextResponse } from "next/server";
import { AppError } from "./errors";
import { loadConfig } from "./config";
export async function assertSameOrigin(request: Request) {
  const expected = new URL((await loadConfig()).APP_URL).origin;
  if (request.headers.get("origin") !== expected)
    throw new AppError("ORIGIN_DENIED", "Request origin is not allowed.", 403);
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  return NextResponse.json(
    { error: "The service is temporarily unavailable.", code: "UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
export { readBinaryBody, readJsonBody } from "./request-body";
