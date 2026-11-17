import "server-only";
import type { SupportPlan, SupportTopic } from "@/lib/support-inputs";
import type { SupportPlanner } from "../modules/support/support-contracts";
import { AppError } from "../errors";
import {
  ResponsesSupportPlanner,
  type SupportResponsesTransport,
} from "./responses-support";
export class DisabledSupportPlanner implements SupportPlanner {
  readonly enabled = false;
  async plan(): Promise<SupportPlan> {
    throw new AppError(
      "AI_DISABLED",
      "Personalized AI support is disabled.",
      503,
    );
  }
}
class OpenAiResponsesTransport implements SupportResponsesTransport {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch,
  ) {}
  send(body: string, signal: AbortSignal) {
    return this.request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      signal,
      redirect: "error",
      body,
    });
  }
}
export class OpenAiSupportPlanner implements SupportPlanner {
  readonly enabled = true;
  private readonly planner: ResponsesSupportPlanner;
  constructor(
    options: {
      apiKey: string;
      model: string;
      timeoutMs: number;
      maximumTokens: number;
    },
    request: typeof fetch = fetch,
  ) {
    this.planner = new ResponsesSupportPlanner(
      options,
      new OpenAiResponsesTransport(options.apiKey, request),
    );
  }
  plan(message: string, previousTopics: SupportTopic[]) {
    return this.planner.plan(message, previousTopics);
  }
}
