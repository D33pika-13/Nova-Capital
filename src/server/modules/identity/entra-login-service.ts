import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { RateLimiter } from "@/server/contracts";
import { AppError, ConfigurationError } from "@/server/errors";
import type {
  LoginTransactionRepository,
  EntraLoginPurpose,
  OidcCodeExchange,
  OidcDiscovery,
  OidcMetadata,
} from "./oidc-login-contracts";

const opaque = /^[A-Za-z0-9_-]{43}$/;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Server-only browser-bound protocol coordinator. */
export class EntraLoginService {
  private readonly redirectUri: string;
  constructor(
    private readonly discovery: OidcDiscovery,
    private readonly transactions: LoginTransactionRepository,
    private readonly exchange: OidcCodeExchange,
    private readonly limits: RateLimiter,
    redirectUri: string,
  ) {
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new ConfigurationError(["ENTRA_REDIRECT_URI"]);
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/auth/entra/callback" ||
      parsed.href !== redirectUri
    )
      throw new ConfigurationError(["ENTRA_REDIRECT_URI"]);
    this.redirectUri = redirectUri;
  }
  private scope(metadata: Readonly<OidcMetadata>) {
    return digest(
      JSON.stringify([
        metadata.issuer,
        metadata.clientId,
        metadata.authorizationEndpoint,
        metadata.tokenEndpoint,
        metadata.jwksUri,
        metadata.logoutEndpoint,
        metadata.tokenAuthenticationMethod,
        this.redirectUri,
      ]),
    );
  }
  private invalid() {
    return new AppError(
      "INVALID_AUTH_LINK",
      "This sign-in request is invalid or expired. Start sign-in again.",
      400,
    );
  }
  private async limit(action: "start" | "callback", bindingHash: string) {
    if (
      !(await this.limits.consume(`auth:entra:${action}:global`, 100, 60)) ||
      !(await this.limits.consume(
        `auth:entra:${action}:${bindingHash}`,
        action === "start" ? 5 : 20,
        900,
      ))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many attempts. Please try again later.",
        429,
      );
  }
  async start(existingBinding?: string, purpose: EntraLoginPurpose = "login") {
    if (!["login", "recovery"].includes(purpose)) throw this.invalid();
    if (existingBinding !== undefined && !opaque.test(existingBinding))
      throw this.invalid();
    const browserBinding =
      existingBinding ?? randomBytes(32).toString("base64url");
    const bindingHash = digest(browserBinding);
    await this.limit("start", bindingHash);
    const metadata = await this.discovery.load();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    await this.transactions.create({
      stateHash: digest(state),
      bindingHash,
      configurationHash: this.scope(metadata),
      nonce,
      codeVerifier,
      purpose,
    });
    const destination = new URL(metadata.authorizationEndpoint);
    destination.search = new URLSearchParams({
      client_id: metadata.clientId,
      response_type: "code",
      response_mode: "query",
      redirect_uri: this.redirectUri,
      scope: "openid profile",
      ...(purpose === "recovery" ? { prompt: "login" } : {}),
      state,
      nonce,
      code_challenge: createHash("sha256")
        .update(codeVerifier)
        .digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    // The route must place browserBinding only in a Secure/HttpOnly/SameSite cookie.
    // It is not a frontend JSON response or an OAuth URL parameter.
    return {
      authorizationUrl: destination.href,
      browserBinding,
      maxAgeSeconds: 600 as const,
    };
  }
  async completeFlow(parameters: URLSearchParams, browserBinding: string) {
    if (!opaque.test(browserBinding) || parameters.toString().length > 16384)
      throw this.invalid();
    const allowed = new Set([
      "code",
      "state",
      "session_state",
      "error",
      "error_description",
      "error_uri",
    ]);
    for (const key of parameters.keys())
      if (!allowed.has(key) || parameters.getAll(key).length !== 1)
        throw this.invalid();
    const state = parameters.get("state");
    const code = parameters.get("code");
    const error = parameters.get("error");
    if (
      !state ||
      !opaque.test(state) ||
      (code === null) === (error === null) ||
      (code !== null && !/^[\x21-\x7e]{1,4096}$/.test(code)) ||
      (error !== null && !/^[A-Za-z0-9_]{1,100}$/.test(error)) ||
      (error === null &&
        (parameters.has("error_description") || parameters.has("error_uri")))
    )
      throw this.invalid();
    const bindingHash = digest(browserBinding);
    await this.limit("callback", bindingHash);
    const metadata = await this.discovery.load();
    const transaction = await this.transactions.take(
      digest(state),
      bindingHash,
      this.scope(metadata),
    );
    if (
      !transaction ||
      error !== null ||
      !["login", "recovery"].includes(transaction.purpose)
    )
      throw this.invalid();
    // Take commits before code redemption. Uncertain/failed redemptions are never replayed.
    try {
      const identity = await this.exchange.exchange({
        code: code!,
        validatedState: state,
        codeVerifier: transaction.codeVerifier,
        expectedNonce: transaction.nonce,
        redirectUri: this.redirectUri,
        metadata,
      });
      if (identity.provider !== "entra" || identity.assurance !== "aal1")
        throw this.invalid();
      return Object.freeze({ identity, purpose: transaction.purpose });
    } catch {
      throw this.invalid();
    }
  }
}
