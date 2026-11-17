import "server-only";
import type { TokenCredential } from "@azure/identity";
import { z } from "zod";
import { AzureDeadline } from "./azure-http";
import { readBinaryBody } from "../request-body";
import { AppError } from "../errors";
export interface AzureStoragePolicy {
  verify(): Promise<void>;
}
export class AzureAccountPolicy implements AzureStoragePolicy {
  private readonly deadline: AzureDeadline;
  constructor(
    private readonly credential: TokenCredential,
    private readonly account: string,
    private readonly resourceId: string,
    timeoutMs: number,
    private readonly request: typeof fetch = fetch,
  ) {
    this.deadline = new AzureDeadline(timeoutMs);
    const match = resourceId.match(
      /^\/subscriptions\/([^/]+)\/resourceGroups\/([A-Za-z0-9._()-]{1,90})\/providers\/Microsoft.Storage\/storageAccounts\/([a-z0-9]{3,24})$/i,
    );
    if (
      !match ||
      !z.uuid().safeParse(match[1]).success ||
      match[2].endsWith(".") ||
      match[3] !== account ||
      !/^[a-z0-9]{3,24}$/.test(account)
    )
      throw new AppError(
        "AZURE_CONFIGURATION",
        "Invalid Azure storage account resource.",
        503,
      );
  }
  async verify() {
    try {
      await this.deadline.run(async (signal) => {
        const token = await this.credential.getToken(
          "https://management.azure.com/.default",
          { abortSignal: signal },
        );
        if (!token || token.expiresOnTimestamp <= Date.now())
          throw new Error("credentials");
        const response = await this.request(
          `https://management.azure.com${this.resourceId}?api-version=2026-09-01`,
          {
            headers: { Authorization: `Bearer ${token.token}` },
            signal,
            redirect: "error",
          },
        );
        if (!response.ok) throw new Error("policy");
        const data = JSON.parse(
          new TextDecoder().decode(await readBinaryBody(response, 65536)),
        );
        const p = data.properties;
        if (
          data.id?.toLowerCase() !== this.resourceId.toLowerCase() ||
          data.name !== this.account ||
          data.kind !== "StorageV2" ||
          p?.allowBlobPublicAccess !== false ||
          p.allowSharedKeyAccess !== false ||
          p.supportsHttpsTrafficOnly !== true ||
          !["TLS1_2", "TLS1_3"].includes(p.minimumTlsVersion) ||
          p.encryption?.services?.blob?.enabled !== true ||
          p.primaryEndpoints?.blob !==
            `https://${this.account}.blob.core.windows.net/`
        )
          throw new Error("unsafe");
      });
    } catch {
      throw new AppError(
        "AZURE_STORAGE_POLICY",
        "Azure storage account policy could not be verified.",
        503,
      );
    }
  }
}
