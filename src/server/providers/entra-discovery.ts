import "server-only";
import { AppError, ConfigurationError } from "../errors";
import { readBinaryBody } from "../request-body";
import { EntraAuthority, type EntraAuthorityOptions } from "./entra-authority";

import type { OidcMetadata as EntraOidcMetadata } from "../modules/identity/oidc-login-contracts";
export type { OidcMetadata as EntraOidcMetadata } from "../modules/identity/oidc-login-contracts";

export class EntraDiscoveryProvider {
  private readonly authority: EntraAuthority;
  private readonly timeoutMs: number;
  private cached?: { value: Readonly<EntraOidcMetadata>; expires: number };
  private pending?: Promise<Readonly<EntraOidcMetadata>>;
  private failedUntil = 0;
  constructor(
    options: EntraAuthorityOptions & { timeoutMs?: number },
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.authority = new EntraAuthority(options);
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 10000
    )
      throw new ConfigurationError(["ENTRA_DISCOVERY_TIMEOUT"]);
  }
  private unavailable() {
    return new AppError(
      "IDENTITY_DISCOVERY_UNAVAILABLE",
      "Identity configuration could not be verified.",
      503,
    );
  }
  load(): Promise<Readonly<EntraOidcMetadata>> {
    const current = this.now();
    if (!Number.isSafeInteger(current) || current <= 0)
      return Promise.reject(this.unavailable());
    if (this.cached && current < this.cached.expires)
      return Promise.resolve(this.cached.value);
    if (this.pending) return this.pending;
    if (current < this.failedUntil) return Promise.reject(this.unavailable());
    this.pending = this.fetchMetadata()
      .then((value) => {
        this.cached = { value, expires: this.now() + 300000 };
        return value;
      })
      .catch(() => {
        this.cached = undefined;
        this.failedUntil = this.now() + 30000;
        throw this.unavailable();
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async fetchMetadata(): Promise<Readonly<EntraOidcMetadata>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.request(this.authority.discoveryUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
            redirect: "error",
            signal: controller.signal,
          });
          if (
            controller.signal.aborted ||
            response.status !== 200 ||
            response.redirected
          ) {
            void response.body?.cancel().catch(() => {});
            throw Error("metadata");
          }
          const data = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              await readBinaryBody(response, 65536, controller.signal),
            ),
          );
          const supports = (key: string, expected: string) => {
            const values: unknown = data?.[key];
            return (
              Array.isArray(values) &&
              values.length > 0 &&
              values.length <= 128 &&
              values.every(
                (value) => typeof value === "string" && value.length <= 200,
              ) &&
              values.includes(expected)
            );
          };
          if (
            !data ||
            Array.isArray(data) ||
            data.issuer !== this.authority.issuer ||
            !supports("response_types_supported", "code") ||
            !supports("response_modes_supported", "query") ||
            !supports("id_token_signing_alg_values_supported", "RS256") ||
            !supports("subject_types_supported", "pairwise") ||
            !supports("scopes_supported", "openid") ||
            !supports("scopes_supported", "profile") ||
            !supports(
              "token_endpoint_auth_methods_supported",
              "client_secret_post",
            ) ||
            (data.grant_types_supported !== undefined &&
              !supports("grant_types_supported", "authorization_code")) ||
            (data.code_challenge_methods_supported !== undefined &&
              !supports("code_challenge_methods_supported", "S256"))
          )
            throw Error("metadata");
          const value: EntraOidcMetadata = {
            issuer: this.authority.issuer,
            clientId: this.authority.clientId,
            authorizationEndpoint: this.authority.endpoint(
              "authorize",
              data.authorization_endpoint,
            ),
            tokenEndpoint: this.authority.endpoint(
              "token",
              data.token_endpoint,
            ),
            jwksUri: this.authority.endpoint("jwks", data.jwks_uri),
            logoutEndpoint: this.authority.endpoint(
              "logout",
              data.end_session_endpoint,
            ),
            tokenAuthenticationMethod: "client_secret_post",
          };
          controller.signal.throwIfAborted();
          return Object.freeze(value);
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error("deadline"));
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
