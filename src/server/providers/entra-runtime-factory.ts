import "server-only";
import type { Database } from "../database";
import type { Telemetry } from "../contracts";
import { ConfigurationError } from "../errors";
import { EntraHttp } from "../entra-http";
import { EntraMfaHttp } from "../entra-mfa-http";
import { AuthorizationService } from "../modules/identity/authorization-service";
import { EntraLoginService } from "../modules/identity/entra-login-service";
import { EntraSessionService } from "../modules/identity/entra-session-service";
import { EntraMfaService } from "../modules/identity/entra-mfa-service";
import { EntraAuthority, type EntraAuthorityOptions } from "./entra-authority";
import { EntraCodeExchange } from "./entra-code-exchange";
import { EntraDiscoveryProvider } from "./entra-discovery";
import { EntraCookies } from "./entra-cookies";
import { EntraIdentityProvider } from "./entra-identity";
import { EntraLogoutDestination } from "./entra-logout-destination";
import {
  EntraDirectoryCredential,
  type EntraDirectoryCredentialBuilder,
} from "./entra-directory-credential";
import { EntraDirectoryUsers } from "./entra-directory";
import { EntraProvisioningService } from "../modules/clients/entra-provisioning-service";
import { PostgresEntraProvisioning } from "./postgres-entra-provisioning";
import { EntraAccountInvitationProvider } from "./entra-accounts";
import {
  PostgresProfileRepository,
  PostgresRateLimiter,
} from "./postgres-database";
import { PostgresLoginTransactions } from "./postgres-login-transactions";
import { PostgresEntraSessions } from "./postgres-entra-sessions";
import { PostgresEntraMfa } from "./postgres-entra-mfa";
import {
  MfaAuthenticator,
  MfaRecoveryCodes,
  MfaSecretProtector,
} from "./mfa-crypto";

export interface EntraRuntimeOptions extends EntraAuthorityOptions {
  applicationOrigin: string;
  clientSecret: string;
  mfaIssuer: string;
  mfaActiveKeyId: string;
  mfaEncryptionKeys: Readonly<Record<string, string>>;
  discoveryTimeoutMs?: number;
  exchangeTimeoutMs?: number;
  directory?: {
    clientId: string;
    clientSecret: string;
    recoveryMode: "hosted_sspr";
    timeoutMs?: number;
  };
}

/** Shared provider composition; request identity is constructed separately for each call. */
export class EntraRuntimeFactory {
  private readonly sessions: EntraSessionService;
  private readonly cookies = new EntraCookies();
  private readonly profiles: PostgresProfileRepository;
  private readonly authHttp: EntraHttp;
  private readonly mfaHttp: EntraMfaHttp;
  private readonly accounts: EntraAccountInvitationProvider | null;
  private readonly capabilities = Object.freeze({
    browserSignIn: true,
    applicationLogout: true,
    passwordSignIn: false,
    accountLifecycle: false,
    accountInvitations: false as boolean,
    remoteLogout: false,
    providerLogoutInitiation: true,
  } as const);
  constructor(
    options: EntraRuntimeOptions,
    database: Database,
    telemetry: Telemetry,
    request: typeof fetch = fetch,
    buildDirectoryCredential?: EntraDirectoryCredentialBuilder,
  ) {
    const authority = new EntraAuthority(options);
    if (
      options.directory !== undefined &&
      (options.directory === null ||
        typeof options.directory !== "object" ||
        Array.isArray(options.directory))
    )
      throw new ConfigurationError(["ENTRA_DIRECTORY_CONFIGURATION"]);
    if (!options.directory && buildDirectoryCredential)
      throw new ConfigurationError(["ENTRA_DIRECTORY_CONFIGURATION"]);
    if (typeof options.mfaIssuer !== "string")
      throw new ConfigurationError(["MFA_ISSUER"]);
    let applicationOrigin: string;
    try {
      const url = new URL(options.applicationOrigin);
      if (url.protocol !== "https:" || url.origin !== options.applicationOrigin)
        throw Error("origin");
      applicationOrigin = url.origin;
    } catch {
      throw new ConfigurationError(["ENTRA_HTTP_ORIGIN"]);
    }
    const redirectUri = new URL("/auth/entra/callback", applicationOrigin).href;
    const discovery = new EntraDiscoveryProvider(
      { ...options, timeoutMs: options.discoveryTimeoutMs },
      request,
    );
    const exchange = new EntraCodeExchange(
      { ...options, redirectUri, timeoutMs: options.exchangeTimeoutMs },
      request,
    );
    const login = new EntraLoginService(
      discovery,
      new PostgresLoginTransactions(database),
      exchange,
      new PostgresRateLimiter(database),
      redirectUri,
    );
    this.sessions = new EntraSessionService(
      new PostgresEntraSessions(database),
      {
        tenantId: authority.tenantId,
        clientId: authority.clientId,
        issuer: authority.issuer,
        applicationOrigin,
      },
    );
    this.profiles = new PostgresProfileRepository(database);
    const mfa = new EntraMfaService(
      new PostgresEntraMfa(database),
      {
        protector: new MfaSecretProtector(
          options.mfaActiveKeyId,
          options.mfaEncryptionKeys,
        ),
        authenticator: new MfaAuthenticator(options.mfaIssuer),
        recovery: new MfaRecoveryCodes(),
      },
      this.sessions.realmHash,
    );
    this.authHttp = new EntraHttp(
      login,
      this.sessions,
      this.profiles,
      this.cookies,
      telemetry,
      { applicationOrigin, authorityOrigin: authority.origin },
      new EntraLogoutDestination(discovery, {
        tenantId: authority.tenantId,
        clientId: authority.clientId,
        tenantSubdomain: options.tenantSubdomain,
        applicationOrigin,
      }),
    );
    this.mfaHttp = new EntraMfaHttp(
      mfa,
      this.sessions,
      this.cookies,
      telemetry,
      applicationOrigin,
    );
    this.accounts = options.directory
      ? new EntraAccountInvitationProvider(
          new EntraProvisioningService(
            new PostgresEntraProvisioning(database),
            new EntraDirectoryUsers(
              {
                tenantId: authority.tenantId,
                tenantSubdomain: options.tenantSubdomain,
                timeoutMs: options.directory.timeoutMs,
              },
              new EntraDirectoryCredential(
                {
                  tenantId: authority.tenantId,
                  clientId: options.directory.clientId,
                  clientSecret: options.directory.clientSecret,
                },
                buildDirectoryCredential,
              ),
              request,
            ),
            {
              tenantId: authority.tenantId,
              tenantSubdomain: options.tenantSubdomain,
            },
          ),
          {
            applicationOrigin: options.applicationOrigin,
            recoveryMode: options.directory.recoveryMode,
          },
        )
      : null;
    this.capabilities = Object.freeze({
      ...this.capabilities,
      accountInvitations: this.accounts !== null,
    });
  }
  create(request: Pick<Request, "headers">) {
    const identity = new EntraIdentityProvider(
      request,
      this.sessions,
      this.cookies,
    );
    return Object.freeze({
      identity,
      accounts: this.accounts,
      auth: new AuthorizationService(identity, this.profiles),
      authHttp: this.authHttp,
      mfaHttp: this.mfaHttp,
      capabilities: this.capabilities,
    });
  }
}
