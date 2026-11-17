import "server-only";
import type { TokenCredential } from "@azure/identity";
import type { SupportTopic } from "@/lib/support-inputs";
import type { SupportPlanner } from "../modules/support/support-contracts";
import {
  ResponsesSupportPlanner,
  type SupportResponsesTransport,
} from "./responses-support";
import { AppError } from "../errors";

import {
  isAzureOpenAiEndpoint,
  azureOpenAiTokenScopes,
  type AzureOpenAiTokenScope,
} from "../azure-settings";
export interface AzureSupportOptions {
  endpoint: string;
  deployment: string;
  apiVersion: "v1";
  tokenScope: AzureOpenAiTokenScope;
  timeoutMs: number;
  maximumTokens: number;
}
class AzureResponsesTransport implements SupportResponsesTransport {
  private readonly url: string;
  constructor(
    private readonly options: AzureSupportOptions,
    private readonly credential: TokenCredential,
    private readonly request: typeof fetch,
  ) {
    if (
      !isAzureOpenAiEndpoint(options.endpoint) ||
      options.apiVersion !== "v1" ||
      !azureOpenAiTokenScopes.includes(options.tokenScope) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.deployment)
    )
      throw new AppError(
        "AZURE_AI_CONFIGURATION",
        "Invalid Azure AI configuration.",
        503,
      );
    this.url = `${new URL(options.endpoint).origin}/openai/v1/responses`;
  }
  async send(body: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const token = await this.credential.getToken(this.options.tokenScope, {
      abortSignal: signal,
    });
    signal.throwIfAborted();
    if (
      !token?.token ||
      !Number.isFinite(token.expiresOnTimestamp) ||
      token.expiresOnTimestamp <= Date.now()
    )
      throw new Error("credentials");
    return this.request(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body,
      signal,
      redirect: "error",
    });
  }
}
export class AzureSupportPlanner implements SupportPlanner {
  readonly enabled = true;
  private readonly planner: ResponsesSupportPlanner;
  constructor(
    options: AzureSupportOptions,
    credential: TokenCredential,
    request: typeof fetch = fetch,
  ) {
    this.planner = new ResponsesSupportPlanner(
      {
        model: options.deployment,
        timeoutMs: options.timeoutMs,
        maximumTokens: options.maximumTokens,
      },
      new AzureResponsesTransport(options, credential, request),
    );
  }
  plan(message: string, previousTopics: SupportTopic[]) {
    return this.planner.plan(message, previousTopics);
  }
}
