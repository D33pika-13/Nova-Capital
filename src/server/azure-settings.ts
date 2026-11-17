import "server-only";
export const azureOpenAiTokenScopes = [
  "https://cognitiveservices.azure.com/.default",
  "https://ai.azure.com/.default",
] as const;
export type AzureOpenAiTokenScope = (typeof azureOpenAiTokenScopes)[number];
// Only a resource origin is configurable, never a caller-provided URL or proxy.
export function isAzureOpenAiEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.openai\.azure\.com$/.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
