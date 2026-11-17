import { it, expect, describe } from "vitest";
import { OpenAiSupportPlanner } from "@/server/providers/openai-support";
import { AzureSupportPlanner } from "@/server/providers/azure-support";
const options = {
  apiKey: "synthetic-openai-key-not-real",
  model: "explicit-test-model",
  timeoutMs: 1000,
  maximumTokens: 256,
};
const output = (value: unknown) => ({
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    },
  ],
});
describe.each(["openai", "azure"] as const)(
  "%s support Responses contract",
  (provider) => {
    const endpoint =
      provider === "openai"
        ? "https://api.openai.com/v1/responses"
        : "https://synthetic-nova.openai.azure.com/openai/v1/responses";
    const createPlanner = (settings: typeof options, request: typeof fetch) =>
      provider === "openai"
        ? new OpenAiSupportPlanner(settings, request)
        : new AzureSupportPlanner(
            {
              endpoint: "https://synthetic-nova.openai.azure.com",
              deployment: settings.model,
              apiVersion: "v1",
              tokenScope: "https://cognitiveservices.azure.com/.default",
              timeoutMs: settings.timeoutMs,
              maximumTokens: settings.maximumTokens,
            },
            {
              getToken: async () => ({
                token: settings.apiKey,
                expiresOnTimestamp: Date.now() + 60000,
              }),
            },
            request,
          );
    it("uses the documented Responses structure, a fixed HTTPS endpoint, no remote state and an enum-only output", async () => {
      let captured: Record<string, unknown> | undefined;
      const fetcher: typeof fetch = async (url, init) => {
        expect(url).toBe(endpoint);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${options.apiKey}`,
        );
        expect(init?.redirect).toBe("error");
        captured = JSON.parse(String(init?.body));
        return Response.json(output({ topics: ["pnl"], currency: "INR" }));
      };
      const planner = createPlanner(options, fetcher);
      expect(await planner.plan("And my profit?", ["portfolio"])).toEqual({
        topics: ["pnl"],
        currency: "INR",
      });
      expect(captured).toMatchObject({
        model: options.model,
        store: false,
        max_output_tokens: 256,
        text: {
          format: {
            type: "json_schema",
            strict: true,
            schema: { additionalProperties: false },
          },
        },
      });
      expect(captured).not.toHaveProperty("tools");
      expect(captured).not.toHaveProperty("previous_response_id");
      const body = JSON.stringify(captured);
      expect(body).toContain("And my profit?");
      expect(body).toContain("previousTopics");
      expect(body).not.toContain(options.apiKey);
      expect(body).not.toContain("clientId");
    });
    it("rejects refusals, incomplete/tool outputs, invented prose and schema/ownership injection", async () => {
      const invalid = [
        {
          ...output({ topics: ["portfolio"], currency: null }),
          status: "incomplete",
        },
        {
          status: "completed",
          output: [{ type: "function_call", name: "delete_investments" }],
        },
        output({ topics: ["portfolio"], currency: null, clientId: "client-b" }),
        output({
          topics: ["portfolio"],
          currency: null,
          answer: "Your balance is 9999",
        }),
        output({ topics: ["admin_notes"], currency: null }),
        output({
          topics: ["portfolio", "updates", "pnl", "allocation"],
          currency: null,
        }),
        output({ topics: ["pnl"], currency: "../../etc/passwd" }),
        {
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "refusal", refusal: "no" }],
            },
          ],
        },
      ];
      for (const response of invalid) {
        const planner = createPlanner(options, async () =>
          Response.json(response),
        );
        await expect(planner.plan("Question", [])).rejects.toMatchObject({
          code: "AI_UNAVAILABLE",
          status: 503,
        });
      }
    });
    it("bounds response bytes, handles transport errors safely and rejects credential-like inputs before transmission", async () => {
      for (const fetcher of [
        async () => new Response("provider secret detail", { status: 429 }),
        async () => new Response("x".repeat(33000)),
        async () => {
          throw new Error("provider key detail");
        },
      ] as (typeof fetch)[]) {
        const planner = createPlanner(options, fetcher);
        await expect(
          planner.plan("What is available?", []),
        ).rejects.toMatchObject({
          message: "AI support is temporarily unavailable.",
        });
      }
      let called = false;
      const planner = createPlanner(options, async () => {
        called = true;
        return Response.json(output({ topics: ["access"], currency: null }));
      });
      await expect(
        planner.plan("password: synthetic-not-a-real-password", []),
      ).rejects.toMatchObject({ status: 422 });
      expect(called).toBe(false);
    });
    it("applies an abort deadline without retrying the provider request", async () => {
      let calls = 0;
      const fetcher: typeof fetch = async (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("deadline")),
          ),
        );
      };
      const planner = createPlanner({ ...options, timeoutMs: 5 }, fetcher);
      await expect(
        planner.plan("Where are reports?", []),
      ).rejects.toMatchObject({
        code: "AI_UNAVAILABLE",
      });
      expect(calls).toBe(1);
    });
  },
);
