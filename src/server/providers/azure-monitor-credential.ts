import "server-only";
import type {
  TokenCredential,
  GetTokenOptions,
  AccessToken,
} from "@azure/identity";
import { AppError, ConfigurationError } from "../errors";

// Exact scope used by the pinned public-Azure Monitor exporter; no caller audiences.
export const monitorTokenScope = "https://monitor.azure.com//.default";
/** A single bounded acquisition; never retries or forwards tenant/claims overrides. */
export class AzureMonitorCredential implements TokenCredential {
  constructor(
    private readonly credential: TokenCredential,
    private readonly timeoutMs = 3000,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3000)
      throw new ConfigurationError(["AZURE_MONITOR_CREDENTIAL_TIMEOUT"]);
  }
  async getToken(
    scopes: string | string[],
    options?: GetTokenOptions,
  ): Promise<AccessToken> {
    const requested = typeof scopes === "string" ? [scopes] : scopes;
    const unavailable = () =>
      new AppError(
        "MONITOR_CREDENTIAL_UNAVAILABLE",
        "Telemetry authentication is unavailable.",
        503,
      );
    if (
      !Array.isArray(requested) ||
      requested.length !== 1 ||
      requested[0] !== monitorTokenScope ||
      options?.claims ||
      options?.tenantId ||
      options?.abortSignal?.aborted
    )
      throw unavailable();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectDeadline: (reason: Error) => void = () => {};
    const abort = () => {
      controller.abort();
      rejectDeadline(unavailable());
    };
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
        timer = setTimeout(abort, this.timeoutMs);
      });
      options?.abortSignal?.addEventListener("abort", abort);
      if (options?.abortSignal?.aborted) abort();
      const token = await Promise.race([
        deadline,
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw unavailable();
          return this.credential.getToken(monitorTokenScope, {
            abortSignal: controller.signal,
          });
        }),
      ]);
      if (
        controller.signal.aborted ||
        !token ||
        typeof token.token !== "string" ||
        !/^[\x21-\x7e]{16,16384}$/.test(token.token) ||
        !Number.isFinite(token.expiresOnTimestamp) ||
        token.expiresOnTimestamp <= Date.now() + 30000
      )
        throw unavailable();
      // Drop other credential metadata; the token is kept only in the SDK's memory.
      return {
        token: token.token,
        expiresOnTimestamp: token.expiresOnTimestamp,
      };
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      options?.abortSignal?.removeEventListener("abort", abort);
    }
  }
}
