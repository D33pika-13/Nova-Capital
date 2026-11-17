import "server-only";
import { isIP } from "node:net";
import { AppError } from "./errors";
export function contactClientAddress(
  headers: Headers,
  configuredHeader: "none" | "x-real-ip",
) {
  if (configuredHeader === "none") return null;
  const value = headers.get(configuredHeader)?.trim();
  if (!value || !isIP(value))
    throw new AppError(
      "CONTACT_UNAVAILABLE",
      "The contact network context could not be verified.",
      503,
    );
  return value;
}
