import "server-only";
import {
  ClientSecretCredential,
  type ClientSecretCredentialOptions,
  type TokenCredential,
  type GetTokenOptions,
} from "@azure/identity";
import { z } from "zod";
import { AppError, ConfigurationError } from "../errors";
export interface EntraDirectoryCredentialOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}
export type EntraDirectoryCredentialBuilder = (
  tenant: string,
  client: string,
  secret: string,
  options: ClientSecretCredentialOptions,
) => TokenCredential;

/** A separate explicit application credential; never consult ambient Azure identities. */
export class EntraDirectoryCredential implements TokenCredential {
  private readonly tenantId: string;
  private readonly credential: TokenCredential;
  constructor(
    settings: EntraDirectoryCredentialOptions,
    build: EntraDirectoryCredentialBuilder = (
      tenant,
      client,
      secret,
      options,
    ) => new ClientSecretCredential(tenant, client, secret, options),
  ) {
    if (
      !z.uuid().safeParse(settings.tenantId).success ||
      !z.uuid().safeParse(settings.clientId).success ||
      typeof settings.clientSecret !== "string" ||
      !/^[\x21-\x7e]{16,4096}$/.test(settings.clientSecret)
    )
      throw new ConfigurationError(["ENTRA_DIRECTORY_CREDENTIAL"]);
    this.tenantId = settings.tenantId.toLowerCase();
    this.credential = build(
      this.tenantId,
      settings.clientId.toLowerCase(),
      settings.clientSecret,
      {
        authorityHost: "https://login.microsoftonline.com",
        additionallyAllowedTenants: [],
        retryOptions: { maxRetries: 0 },
        loggingOptions: {
          allowLoggingAccountIdentifiers: false,
          enableUnsafeSupportLogging: false,
        },
      },
    );
  }
  async getToken(scopes: string | string[], options?: GetTokenOptions) {
    if (
      (Array.isArray(scopes)
        ? scopes.length !== 1 ||
          scopes[0] !== "https://graph.microsoft.com/.default"
        : scopes !== "https://graph.microsoft.com/.default") ||
      (options?.tenantId !== undefined &&
        options.tenantId.toLowerCase() !== this.tenantId)
    )
      throw new AppError(
        "DIRECTORY_CREDENTIAL_SCOPE",
        "Directory credentials could not be verified.",
        503,
      );
    if (options?.abortSignal?.aborted)
      throw new AppError(
        "DIRECTORY_CREDENTIAL_SCOPE",
        "Directory credentials could not be verified.",
        503,
      );
    return this.credential.getToken("https://graph.microsoft.com/.default", {
      ...options,
      tenantId: this.tenantId,
    });
  }
}
