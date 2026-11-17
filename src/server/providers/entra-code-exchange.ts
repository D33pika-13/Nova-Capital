import "server-only";
import * as oauth from "oauth4webapi";
import type { OidcCodeExchange } from "../modules/identity/oidc-login-contracts";
import { EntraAuthority, type EntraAuthorityOptions } from "./entra-authority";
import { EntraTokenVerifier } from "./entra-token-verifier";
import { AppError, ConfigurationError } from "../errors";
import { readBinaryBody } from "../request-body";

type ExchangeInput = Parameters<OidcCodeExchange["exchange"]>[0];
export interface EntraExchangeOptions extends EntraAuthorityOptions {
  clientSecret: string;
  redirectUri: string;
  timeoutMs?: number;
}

export class EntraCodeExchange implements OidcCodeExchange {
  private readonly authority: EntraAuthority;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly timeoutMs: number;
  constructor(
    options: EntraExchangeOptions,
    private readonly request: typeof fetch = fetch,
  ) {
    this.authority = new EntraAuthority(options);
    this.timeoutMs = options.timeoutMs ?? 10000;
    let redirect: URL;
    try {
      redirect = new URL(options.redirectUri);
    } catch {
      throw new ConfigurationError(["ENTRA_REDIRECT_URI"]);
    }
    if (
      redirect.protocol !== "https:" ||
      redirect.username ||
      redirect.password ||
      redirect.search ||
      redirect.hash ||
      redirect.pathname !== "/auth/entra/callback" ||
      redirect.href !== options.redirectUri
    )
      throw new ConfigurationError(["ENTRA_REDIRECT_URI"]);
    if (
      typeof options.clientSecret !== "string" ||
      !/^[\x21-\x7e]{16,4096}$/.test(options.clientSecret)
    )
      throw new ConfigurationError(["ENTRA_CLIENT_SECRET"]);
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 20000
    )
      throw new ConfigurationError(["ENTRA_EXCHANGE_TIMEOUT"]);
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
  }
  async exchange(input: ExchangeInput) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (
        typeof input.code !== "string" ||
        !/^[\x21-\x7e]{1,4096}$/.test(input.code) ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.validatedState) ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.codeVerifier) ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.expectedNonce) ||
        input.redirectUri !== this.redirectUri ||
        input.metadata.issuer !== this.authority.issuer ||
        input.metadata.clientId !== this.authority.clientId ||
        input.metadata.tokenAuthenticationMethod !== "client_secret_post"
      )
        throw Error("context");
      const tokenEndpoint = this.authority.endpoint(
        "token",
        input.metadata.tokenEndpoint,
      );
      const jwksUri = this.authority.endpoint("jwks", input.metadata.jwksUri);
      this.authority.endpoint(
        "authorize",
        input.metadata.authorizationEndpoint,
      );
      this.authority.endpoint("logout", input.metadata.logoutEndpoint);
      const boundedFetch: typeof fetch = async (url, init) => {
        const destination = String(url);
        if (
          (destination !== tokenEndpoint && destination !== jwksUri) ||
          init?.method !== (destination === tokenEndpoint ? "POST" : "GET")
        )
          throw Error("destination");
        const signal = init.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal;
        signal.throwIfAborted();
        const response = await this.request(url, {
          ...init,
          redirect: "error",
          signal,
        });
        if (
          signal.aborted ||
          response.status !== 200 ||
          response.redirected ||
          !/^application\/(?:json|jwk-set\+json)(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        ) {
          void response.body?.cancel().catch(() => {});
          throw Error("transport");
        }
        const bytes = await readBinaryBody(
          response,
          destination === tokenEndpoint ? 65536 : 262144,
          signal,
        );
        signal.throwIfAborted();
        return new Response(bytes as BodyInit, {
          status: 200,
          headers: response.headers,
        });
      };
      const server: oauth.AuthorizationServer = {
        issuer: this.authority.issuer,
        token_endpoint: tokenEndpoint,
        authorization_endpoint: input.metadata.authorizationEndpoint,
        jwks_uri: jwksUri,
        id_token_signing_alg_values_supported: ["RS256"],
      };
      const client: oauth.Client = {
        client_id: this.authority.clientId,
        id_token_signed_response_alg: "RS256",
        [oauth.clockTolerance]: 30,
      };
      return await Promise.race([
        (async () => {
          // State/binding/configuration were matched and consumed by EntraLoginService.
          // Keep the proven state in the library's validated callback object as well.
          const callback = oauth.validateAuthResponse(
            server,
            client,
            new URLSearchParams({
              code: input.code,
              state: input.validatedState,
            }),
            input.validatedState,
          );
          const response = await oauth.authorizationCodeGrantRequest(
            server,
            client,
            oauth.ClientSecretPost(this.clientSecret),
            callback,
            this.redirectUri,
            input.codeVerifier,
            { signal: controller.signal, [oauth.customFetch]: boundedFetch },
          );
          const tokens = await oauth.processAuthorizationCodeResponse(
            server,
            client,
            response,
            { expectedNonce: input.expectedNonce, requireIdToken: true },
          );
          controller.signal.throwIfAborted();
          if (typeof tokens.id_token !== "string") throw Error("token");
          // OAuth response processing is not signature authority. Verify the ID JWT
          // independently; access/refresh tokens are neither retained nor returned.
          const verifier = new EntraTokenVerifier(
            {
              tenantId: this.authority.tenantId,
              clientId: this.authority.clientId,
              tenantSubdomain: new URL(this.authority.origin).hostname.split(
                ".",
              )[0],
              jwksUri,
              timeoutMs: Math.min(this.timeoutMs, 5000),
            },
            boundedFetch,
          );
          const identity = await verifier.verify(
            tokens.id_token,
            input.expectedNonce,
          );
          controller.signal.throwIfAborted();
          return identity;
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error("deadline"));
          }, this.timeoutMs);
        }),
      ]);
    } catch {
      throw new AppError(
        "IDENTITY_EXCHANGE_FAILED",
        "Sign-in could not be completed. Start sign-in again.",
        401,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
