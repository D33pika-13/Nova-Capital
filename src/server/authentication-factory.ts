import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "./configuration-service";
import type { Database } from "./database";
import type { Telemetry } from "./contracts";
import { ConfigurationError } from "./errors";
import { parseEntraMfaKeys } from "./entra-settings";
import { EntraRuntimeFactory } from "./providers/entra-runtime-factory";
import type { EntraDirectoryCredentialBuilder } from "./providers/entra-directory-credential";
import {
  createSessionClient,
  SupabaseIdentityProvider,
} from "./providers/supabase-identity";
import { SupabaseAccountInvitationProvider } from "./providers/supabase-accounts";
import { SupabaseMfaProvider } from "./providers/supabase-mfa";
import { SupabaseCallbackProvider } from "./providers/supabase-callback";
import {
  PostgresProfileRepository,
  PostgresRateLimiter,
} from "./providers/postgres-database";
import { AuthorizationService } from "./modules/identity/authorization-service";
import { AuthCallbackService } from "./modules/identity/callback-service";
import { MfaService } from "./modules/identity/mfa-service";
/** Process dependencies only. create() always constructs request-owned identity. */
export class AuthenticationFactory {
  private readonly entra: EntraRuntimeFactory | null;
  constructor(
    private readonly config: Readonly<ServerConfig>,
    private readonly database: Database,
    private readonly supabase: SupabaseClient | undefined,
    telemetry: Telemetry,
    private readonly dependencies: {
      sessionClient?: typeof createSessionClient;
      request?: typeof fetch;
      directoryCredential?: EntraDirectoryCredentialBuilder;
    } = {},
  ) {
    if (!["supabase", "entra"].includes(config.AUTH_PROVIDER))
      throw new ConfigurationError(["AUTH_PROVIDER"]);
    this.entra =
      config.AUTH_PROVIDER === "entra"
        ? new EntraRuntimeFactory(
            {
              tenantId: config.ENTRA_TENANT_ID!,
              clientId: config.ENTRA_CLIENT_ID!,
              tenantSubdomain: config.ENTRA_TENANT_SUBDOMAIN!,
              applicationOrigin: config.APP_URL,
              clientSecret: config.ENTRA_CLIENT_SECRET!,
              mfaIssuer: config.ENTRA_MFA_ISSUER!,
              mfaActiveKeyId: config.ENTRA_MFA_ACTIVE_KEY_ID!,
              mfaEncryptionKeys: parseEntraMfaKeys(
                config.ENTRA_MFA_ENCRYPTION_KEYS!,
                config.ENTRA_MFA_ACTIVE_KEY_ID!,
              ),
              discoveryTimeoutMs: config.ENTRA_DISCOVERY_TIMEOUT_MS,
              exchangeTimeoutMs: config.ENTRA_EXCHANGE_TIMEOUT_MS,
              directory: {
                clientId: config.ENTRA_DIRECTORY_CLIENT_ID!,
                clientSecret: config.ENTRA_DIRECTORY_CLIENT_SECRET!,
                recoveryMode: config.ENTRA_RECOVERY_MODE!,
                timeoutMs: config.ENTRA_DIRECTORY_TIMEOUT_MS,
              },
            },
            database,
            telemetry,
            dependencies.request,
            dependencies.directoryCredential,
          )
        : null;
    if (config.AUTH_PROVIDER === "supabase" && !supabase)
      throw new ConfigurationError(["SUPABASE_SERVICE_ROLE_KEY"]);
  }
  async create(request: Pick<Request, "headers">) {
    if (this.entra) {
      const scope = this.entra.create(request);
      if (!scope.accounts)
        throw new ConfigurationError(["ENTRA_DIRECTORY_CLIENT_ID"]);
      return {
        identity: scope.identity,
        auth: scope.auth,
        accounts: scope.accounts,
        entra: scope,
        authCallback: null,
        mfa: null,
      };
    }
    const session = await (
      this.dependencies.sessionClient ?? createSessionClient
    )(this.config);
    const identity = new SupabaseIdentityProvider(session, this.config.APP_URL),
      auth = new AuthorizationService(
        identity,
        new PostgresProfileRepository(this.database),
      ),
      limits = new PostgresRateLimiter(this.database);
    return {
      identity,
      auth,
      accounts: new SupabaseAccountInvitationProvider(
        this.supabase!,
        this.config.APP_URL,
      ),
      entra: null,
      authCallback: new AuthCallbackService(
        new SupabaseCallbackProvider(session),
        limits,
      ),
      mfa: new MfaService(auth, new SupabaseMfaProvider(session), limits),
    };
  }
}
