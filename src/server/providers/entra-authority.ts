import "server-only";
import { z } from "zod";
import { ConfigurationError } from "../errors";

export interface EntraAuthorityOptions {
  tenantId: string;
  clientId: string;
  tenantSubdomain: string;
}

export class EntraAuthority {
  readonly tenantId: string;
  readonly clientId: string;
  readonly origin: string;
  readonly issuer: string;
  readonly discoveryUrl: string;
  private readonly domainTenant: string;
  constructor(options: EntraAuthorityOptions) {
    if (
      !z.uuid().safeParse(options.tenantId).success ||
      !z.uuid().safeParse(options.clientId).success ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(options.tenantSubdomain)
    )
      throw new ConfigurationError(["ENTRA_AUTHORITY"]);
    this.tenantId = options.tenantId.toLowerCase();
    this.clientId = options.clientId.toLowerCase();
    this.origin = `https://${options.tenantSubdomain}.ciamlogin.com`;
    this.domainTenant = `${options.tenantSubdomain}.onmicrosoft.com`;
    this.issuer = `${this.origin}/${this.tenantId}/v2.0`;
    this.discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    Object.freeze(this);
  }
  endpoint(
    kind: "jwks" | "authorize" | "token" | "logout",
    value: unknown,
  ): string {
    const field =
      kind === "jwks" ? "ENTRA_JWKS_URI" : "ENTRA_DISCOVERY_ENDPOINT";
    let url: URL;
    try {
      if (typeof value !== "string" || value.length > 2048) throw Error("url");
      url = new URL(value);
    } catch {
      throw new ConfigurationError([field]);
    }
    const paths =
      kind === "jwks"
        ? [
            `/${this.tenantId}/discovery/v2.0/keys`,
            "/common/discovery/v2.0/keys",
          ]
        : [this.tenantId, this.domainTenant].map(
            (tenant) => `/${tenant}/oauth2/v2.0/${kind}`,
          );
    if (
      url.origin !== this.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.href !== value ||
      !paths.includes(url.pathname)
    )
      throw new ConfigurationError([field]);
    return url.href;
  }
}
