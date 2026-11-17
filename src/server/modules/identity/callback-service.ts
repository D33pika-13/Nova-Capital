import "server-only";
import { createHash } from "node:crypto";
import type { RateLimiter } from "@/server/contracts";
import { AppError } from "@/server/errors";

export interface AuthCallbackProvider {
  exchangeCode(code: string, flowId?: string): Promise<void>;
  verifyLink(token: string, purpose: "invite" | "recovery"): Promise<void>;
}

export class AuthCallbackService {
  constructor(
    private readonly provider: AuthCallbackProvider,
    private readonly limits: RateLimiter,
  ) {}
  async complete(parameters: URLSearchParams) {
    const invalid = () =>
      new AppError(
        "INVALID_AUTH_LINK",
        "This secure link is invalid or expired.",
        400,
      );
    const allowed = new Set([
      "code",
      "token_hash",
      "type",
      "next",
      "sb_flow_id",
    ]);
    if (parameters.toString().length > 4096) throw invalid();
    for (const key of parameters.keys())
      if (!allowed.has(key) || parameters.getAll(key).length !== 1)
        throw invalid();
    const code = parameters.get("code");
    const token = parameters.get("token_hash");
    const purpose = parameters.get("type");
    const next = parameters.get("next");
    const flowId = parameters.get("sb_flow_id");
    if (
      flowId !== null &&
      (!/^[a-zA-Z0-9_-]{8,64}$/.test(flowId) || code === null)
    )
      throw invalid();
    if (next !== null && next !== "/password" && next !== "/portal")
      throw invalid();
    const isCode = code !== null && token === null && purpose === null;
    const isLink =
      token !== null &&
      code === null &&
      (purpose === "invite" || purpose === "recovery");
    const credential = isCode ? code : isLink ? token : null;
    if (!credential || !/^[A-Za-z0-9._~=-]{1,2048}$/.test(credential))
      throw invalid();
    // Persist a one-way fingerprint, never the callback credential or URL.
    const fingerprint = createHash("sha256").update(credential).digest("hex");
    if (
      !(await this.limits.consume("auth:callback:global", 100, 60)) ||
      !(await this.limits.consume(`auth:callback:${fingerprint}`, 5, 900))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many attempts. Please try again later.",
        429,
      );
    try {
      if (isCode) {
        if (flowId) await this.provider.exchangeCode(credential, flowId);
        else await this.provider.exchangeCode(credential);
      } else
        await this.provider.verifyLink(
          credential,
          purpose as "invite" | "recovery",
        );
    } catch {
      // Never forward provider payloads or credentials to callers/logging.
      throw invalid();
    }
    return {
      redirect:
        !isCode || next === "/password"
          ? ("/password" as const)
          : ("/portal" as const),
    };
  }
}
