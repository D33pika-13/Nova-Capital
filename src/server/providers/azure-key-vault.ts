import "server-only";
import type { TokenCredential } from "@azure/identity";
import type { SecretProvider } from "../contracts";
import type { SecretKey } from "../secret-settings";
import { isKeyVaultEndpoint, parseSecretReferences } from "../secret-settings";
import { AppError } from "../errors";
import { readBinaryBody } from "../request-body";
export class AzureKeyVaultSecrets implements SecretProvider {
  private readonly origin: string;
  private readonly references: Readonly<Partial<Record<SecretKey, string>>>;
  constructor(
    options: { endpoint: string; references: string; timeoutMs: number },
    private readonly credential: TokenCredential,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !isKeyVaultEndpoint(options.endpoint) ||
      !Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > 20000
    )
      throw new AppError(
        "VAULT_CONFIGURATION",
        "Invalid secrets configuration.",
        503,
      );
    this.origin = new URL(options.endpoint).origin;
    this.references = parseSecretReferences(options.references);
    this.timeoutMs = options.timeoutMs;
  }
  private readonly timeoutMs: number;
  async resolve(): Promise<Readonly<Record<string, string>>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.read(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("deadline"));
          }, this.timeoutMs);
        }),
      ]);
    } catch {
      throw new AppError(
        "SECRETS_UNAVAILABLE",
        "Server secrets could not be verified.",
        503,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  private async read(signal: AbortSignal) {
    const token = await this.credential.getToken(
      "https://vault.azure.net/.default",
      { abortSignal: signal },
    );
    signal.throwIfAborted();
    if (
      !token?.token ||
      !Number.isFinite(token.expiresOnTimestamp) ||
      token.expiresOnTimestamp <= this.now()
    )
      throw Error("credentials");
    const values: Record<string, string> = {};
    // All values are returned atomically; a failed read never publishes a partial profile.
    for (const [key, reference] of Object.entries(this.references)) {
      signal.throwIfAborted();
      const expected = `${this.origin}/secrets/${reference}`;
      const response = await this.request(
        `${expected}?api-version=2025-07-01`,
        {
          headers: { Authorization: `Bearer ${token.token}` },
          redirect: "error",
          signal,
        },
      );
      if (signal.aborted || response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        throw Error("read");
      }
      const bundle = JSON.parse(
        new TextDecoder().decode(await readBinaryBody(response, 65536, signal)),
      );
      const attributes = bundle.attributes;
      if (
        typeof bundle.id !== "string" ||
        bundle.id.toLowerCase() !== expected.toLowerCase() ||
        typeof bundle.value !== "string" ||
        bundle.value.length === 0 ||
        Buffer.byteLength(bundle.value, "utf8") > 16384 ||
        bundle.value.includes("\0") ||
        attributes?.enabled !== true ||
        (attributes.exp !== undefined &&
          (!Number.isFinite(attributes.exp) ||
            attributes.exp * 1000 <= this.now())) ||
        (attributes.nbf !== undefined &&
          (!Number.isFinite(attributes.nbf) ||
            attributes.nbf * 1000 > this.now()))
      )
        throw Error("invalid");
      values[key] = bundle.value;
    }
    return Object.freeze(values);
  }
}
