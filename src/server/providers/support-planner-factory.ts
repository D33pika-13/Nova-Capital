import "server-only";
import type { ServerConfig } from "../config";
import type { SupportPlanner } from "../modules/support/support-contracts";
import { OpenAiSupportPlanner, DisabledSupportPlanner } from "./openai-support";
import { AzureSupportPlanner } from "./azure-support";
import { AzureCredentialFactory } from "./azure-credentials";
export class SupportPlannerFactory {
  constructor(private readonly config: Readonly<ServerConfig>) {}
  create(): SupportPlanner {
    const c = this.config;
    if (c.AI_PROVIDER === "disabled") return new DisabledSupportPlanner();
    if (c.AI_PROVIDER === "openai")
      return new OpenAiSupportPlanner({
        apiKey: c.OPENAI_API_KEY!,
        model: c.OPENAI_MODEL!,
        timeoutMs: c.SUPPORT_AI_TIMEOUT_MS,
        maximumTokens: c.SUPPORT_AI_MAX_OUTPUT_TOKENS,
      });
    return new AzureSupportPlanner(
      {
        endpoint: c.AZURE_OPENAI_ENDPOINT!,
        deployment: c.AZURE_OPENAI_DEPLOYMENT!,
        apiVersion: c.AZURE_OPENAI_API_VERSION,
        tokenScope: c.AZURE_OPENAI_TOKEN_SCOPE,
        timeoutMs: c.SUPPORT_AI_TIMEOUT_MS,
        maximumTokens: c.SUPPORT_AI_MAX_OUTPUT_TOKENS,
      },
      new AzureCredentialFactory(c).create(c.SUPPORT_AI_TIMEOUT_MS),
    );
  }
}
