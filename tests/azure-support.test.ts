import { it, expect, vi } from "vitest";
import type { TokenCredential } from "@azure/identity";
import {
  AzureSupportPlanner,
  type AzureSupportOptions,
} from "@/server/providers/azure-support";
import { ConfigurationService } from "@/server/config";
import { SupportPlannerFactory } from "@/server/providers/support-planner-factory";
const options: AzureSupportOptions = {
  endpoint: "https://synthetic-nova.openai.azure.com/",
  deployment: "explicit-test-deployment",
  apiVersion: "v1",
  tokenScope: "https://cognitiveservices.azure.com/.default",
  timeoutMs: 1000,
  maximumTokens: 256,
};
const output = () =>
  Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ topics: ["reports"], currency: null }),
          },
        ],
      },
    ],
  });
const credential: TokenCredential = {
  getToken: async () => ({
    token: "synthetic-azure-token",
    expiresOnTimestamp: Date.now() + 60000,
  }),
};
it("requests only the configured Azure audience and uses the exact deployment with bearer auth", async () => {
  for (const scope of [
    "https://cognitiveservices.azure.com/.default",
    "https://ai.azure.com/.default",
  ] as const) {
    const getToken = vi.fn(credential.getToken);
    const request = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(
        "https://synthetic-nova.openai.azure.com/openai/v1/responses",
      );
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer synthetic-azure-token",
      );
      expect(new Headers(init?.headers).has("api-key")).toBe(false);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: options.deployment,
        store: false,
      });
      expect(String(init?.body)).not.toMatch(
        /synthetic-azure-token|clientId|previous_response_id/,
      );
      return output();
    });
    expect(
      await new AzureSupportPlanner(
        { ...options, tokenScope: scope },
        { getToken },
        request,
      ).plan("Where are my reports?", []),
    ).toEqual({ topics: ["reports"], currency: null });
    expect(getToken).toHaveBeenCalledExactlyOnceWith(scope, {
      abortSignal: expect.any(AbortSignal),
    });
    expect(request).toHaveBeenCalledTimes(1);
  }
});
it("rejects credential failures before sending a request and never exposes credential details", async () => {
  for (const getToken of [
    async () => null,
    async () => ({ token: "synthetic", expiresOnTimestamp: Date.now() - 1 }),
    async () => ({ token: "synthetic", expiresOnTimestamp: NaN }),
    async () => {
      throw Error("synthetic private credential detail");
    },
  ]) {
    const request = vi.fn<typeof fetch>();
    await expect(
      new AzureSupportPlanner(options, { getToken }, request).plan(
        "Question",
        [],
      ),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      message: "AI support is temporarily unavailable.",
    });
    expect(request).not.toHaveBeenCalled();
  }
});
it("bounds token acquisition and prevents a late credential from starting inference", async () => {
  let resolveToken:
    | ((token: Awaited<ReturnType<TokenCredential["getToken"]>>) => void)
    | undefined;
  let signal: AbortSignal | undefined;
  const getToken: TokenCredential["getToken"] = async (_scope, input) => {
    signal = input?.abortSignal as AbortSignal;
    return new Promise((resolve) => {
      resolveToken = resolve;
    });
  };
  const request = vi.fn<typeof fetch>();
  await expect(
    new AzureSupportPlanner(
      { ...options, timeoutMs: 5 },
      { getToken },
      request,
    ).plan("Question", []),
  ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  expect(signal?.aborted).toBe(true);
  resolveToken!({
    token: "late-synthetic-token",
    expiresOnTimestamp: Date.now() + 60000,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(request).not.toHaveBeenCalled();
});
it("bounds response reading even if a synthetic transport ignores abort and does not retry", async () => {
  const cancel = vi.fn();
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream({
          cancel,
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"status":'));
          },
        }),
      ),
  );
  await expect(
    new AzureSupportPlanner(
      { ...options, timeoutMs: 5 },
      credential,
      request,
    ).plan("Question", []),
  ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("rejects noncanonical endpoints, arbitrary token audiences and unsupported API versions", () => {
  for (const endpoint of [
    "http://synthetic.openai.azure.com",
    "https://synthetic.openai.azure.com.attacker.test",
    "https://user:secret@synthetic.openai.azure.com",
    "https://synthetic.openai.azure.com:444",
    "https://synthetic.openai.azure.com/openai/v1",
    "https://synthetic.openai.azure.com?target=private",
    "https://127.0.0.1",
    "https://synthetic.openai.azure.com/#fragment",
  ]) {
    expect(
      () => new AzureSupportPlanner({ ...options, endpoint }, credential),
    ).toThrow(/configuration/);
    expect(
      () => new ConfigurationService({ AZURE_OPENAI_ENDPOINT: endpoint }),
    ).toThrow(/AZURE_OPENAI_ENDPOINT/);
  }
  expect(() => new ConfigurationService({ AI_PROVIDER: "azure" })).toThrow(
    /AZURE_OPENAI_DEPLOYMENT/,
  );
  expect(
    () =>
      new ConfigurationService({
        AZURE_OPENAI_DEPLOYMENT: "../not-a-deployment",
      }),
  ).toThrow(/AZURE_OPENAI_DEPLOYMENT/);
  expect(
    () =>
      new ConfigurationService({
        AZURE_OPENAI_TOKEN_SCOPE: "https://attacker.test/.default",
      }),
  ).toThrow(/AZURE_OPENAI_TOKEN_SCOPE/);
  expect(
    () => new ConfigurationService({ AZURE_OPENAI_API_VERSION: "preview" }),
  ).toThrow(/AZURE_OPENAI_API_VERSION/);
});
it("selects the configured planner without provider contact and forbids hosted CLI credentials for AI independently of Blob", () => {
  const settings = {
    APP_ENV: "test",
    AI_PROVIDER: "azure",
    AZURE_OPENAI_ENDPOINT: options.endpoint,
    AZURE_OPENAI_DEPLOYMENT: options.deployment,
  };
  const config = new ConfigurationService(settings).get();
  expect(config.STORAGE_PROVIDER).toBe("supabase");
  expect(config.OPENAI_API_KEY).toBeUndefined();
  expect(config.AZURE_STORAGE_ACCOUNT_NAME).toBeUndefined();
  expect(new SupportPlannerFactory(config).create()).toBeInstanceOf(
    AzureSupportPlanner,
  );
  expect(
    new SupportPlannerFactory(new ConfigurationService({}).get()).create()
      .enabled,
  ).toBe(false);
  expect(
    new SupportPlannerFactory(
      new ConfigurationService({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic",
        OPENAI_MODEL: "explicit-test",
      }).get(),
    ).create().enabled,
  ).toBe(true);
  expect(
    () =>
      new ConfigurationService({
        ...settings,
        APP_ENV: "staging",
        APP_URL: "https://staging.example.test",
        AZURE_CREDENTIAL_MODE: "azure_cli",
      }),
  ).toThrow(/AZURE_CREDENTIAL_MODE/);
});
