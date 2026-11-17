import "server-only";
import type { VerifiedIdentity } from "@/server/contracts";

export interface OidcMetadata {
  readonly issuer: string;
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly logoutEndpoint: string;
  readonly tokenAuthenticationMethod: "client_secret_post";
}
export interface OidcDiscovery {
  load(): Promise<Readonly<OidcMetadata>>;
}
export type EntraLoginPurpose = "login" | "recovery";
export interface LoginTransaction {
  purpose?: EntraLoginPurpose;
  stateHash: string;
  bindingHash: string;
  configurationHash: string;
  nonce: string;
  codeVerifier: string;
}
export interface LoginTransactionRepository {
  create(value: LoginTransaction): Promise<void>;
  take(
    stateHash: string,
    bindingHash: string,
    configurationHash: string,
  ): Promise<{
    nonce: string;
    codeVerifier: string;
    purpose: EntraLoginPurpose;
  } | null>;
}
export interface OidcCodeExchange {
  exchange(input: {
    code: string;
    /** Already matched to the atomically consumed browser-bound transaction. */
    validatedState: string;
    codeVerifier: string;
    expectedNonce: string;
    redirectUri: string;
    metadata: Readonly<OidcMetadata>;
  }): Promise<Readonly<VerifiedIdentity>>;
}
