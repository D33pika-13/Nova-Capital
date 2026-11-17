import "server-only";
import type { OidcDiscovery } from "../modules/identity/oidc-login-contracts";
import { EntraAuthority, type EntraAuthorityOptions } from "./entra-authority";
import { ConfigurationError, AppError } from "../errors";

/** Builds a browser end-session request, never a claim of provider completion. */
export class EntraLogoutDestination {
  private readonly authority: EntraAuthority;
  private readonly returnUri: string;
  constructor(
    private readonly discovery: OidcDiscovery,
    options: EntraAuthorityOptions & { applicationOrigin: string },
  ) {
    this.authority = new EntraAuthority(options);
    try {
      const origin = new URL(options.applicationOrigin);
      if (
        origin.protocol !== "https:" ||
        origin.origin !== options.applicationOrigin
      )
        throw Error("origin");
      this.returnUri = new URL("/login", origin).href;
    } catch {
      throw new ConfigurationError(["ENTRA_LOGOUT_RETURN_URI"]);
    }
  }
  async load() {
    try {
      const metadata = await this.discovery.load();
      if (
        metadata.issuer !== this.authority.issuer ||
        metadata.clientId !== this.authority.clientId
      )
        throw Error("scope");
      const destination = new URL(
        this.authority.endpoint("logout", metadata.logoutEndpoint),
      );
      destination.search = new URLSearchParams({
        post_logout_redirect_uri: this.returnUri,
      }).toString();
      return destination.href;
    } catch {
      throw new AppError(
        "PROVIDER_LOGOUT_UNAVAILABLE",
        "Provider sign-out could not be started.",
        503,
      );
    }
  }
}
