import "server-only";
import { ManagedIdentityCredential, AzureCliCredential } from "@azure/identity";
import type { ServerConfig } from "../configuration-service";
export class AzureCredentialFactory {
  constructor(
    private readonly config: Readonly<
      Pick<ServerConfig, "AZURE_CREDENTIAL_MODE" | "AZURE_CLIENT_ID">
    >,
  ) {}
  create(timeoutMs: number) {
    const c = this.config;
    return c.AZURE_CREDENTIAL_MODE === "azure_cli"
      ? new AzureCliCredential({ processTimeoutInMs: timeoutMs })
      : new ManagedIdentityCredential({
          clientId: c.AZURE_CLIENT_ID,
          retryOptions: { maxRetries: 0 },
          loggingOptions: {
            allowLoggingAccountIdentifiers: false,
            enableUnsafeSupportLogging: false,
          },
        });
  }
}
