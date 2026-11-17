import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import type { TokenCredential } from "@azure/identity";
import type { PrivateStorage } from "../contracts";
import type { OfferImageStorage } from "../modules/offers/image-contracts";
import type { AzureStoragePolicy } from "./azure-storage-policy";
import { AzureBlobHttpClient, AzureDeadline } from "./azure-http";
import { AppError } from "../errors";
export interface AzureBlobOptions {
  account: string;
  container: string;
  purpose: "reports" | "offer_images";
  maximumBytes: number;
  timeoutMs: number;
}
export class AzureBlobObjects {
  private readonly service: BlobServiceClient;
  private readonly deadline: AzureDeadline;
  readonly origin: string;
  constructor(
    private readonly options: AzureBlobOptions,
    credential: TokenCredential,
    private readonly policy: AzureStoragePolicy,
    request: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      !/^[a-z0-9]{3,24}$/.test(options.account) ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(options.container) ||
      options.container.includes("--") ||
      options.maximumBytes < 1024 ||
      options.maximumBytes > this.cap
    )
      throw new AppError(
        "AZURE_CONFIGURATION",
        "Invalid Azure blob configuration.",
        503,
      );
    this.origin = `https://${options.account}.blob.core.windows.net`;
    this.deadline = new AzureDeadline(options.timeoutMs);
    this.service = new BlobServiceClient(this.origin, credential, {
      httpClient: new AzureBlobHttpClient(this.origin, request),
      retryOptions: { maxTries: 1 },
    });
  }
  private get cap() {
    return this.options.purpose === "reports" ? 10485760 : 5242880;
  }
  private get mime() {
    return this.options.purpose === "reports"
      ? "application/pdf"
      : "image/webp";
  }
  private path(path: string) {
    const parts = path.split("/");
    const suffix = this.options.purpose === "reports" ? ".pdf" : ".webp";
    if (
      parts.length !== 2 ||
      !z.uuid().safeParse(parts[0]).success ||
      !parts[1].endsWith(suffix) ||
      !z.uuid().safeParse(parts[1].slice(0, -suffix.length)).success
    )
      throw new AppError("INVALID_PATH", "Invalid private object path.", 422);
    return this.service
      .getContainerClient(this.options.container)
      .getBlockBlobClient(path);
  }
  async verifyConfiguration() {
    try {
      await this.deadline.run(async (signal) => {
        await this.policy.verify();
        const properties = await this.service
          .getContainerClient(this.options.container)
          .getProperties({ abortSignal: signal });
        if (
          properties.blobPublicAccess !== undefined ||
          !properties.etag ||
          !properties.lastModified ||
          !Number.isFinite(properties.lastModified.getTime())
        )
          throw new Error("public");
      });
    } catch {
      throw new AppError(
        "AZURE_STORAGE_POLICY",
        "Private Azure container could not be verified.",
        503,
      );
    }
  }
  async putIfAbsent(path: string, bytes: Uint8Array, contentType: string) {
    const blob = this.path(path);
    if (
      contentType !== this.mime ||
      bytes.byteLength === 0 ||
      bytes.byteLength > this.options.maximumBytes
    )
      throw new AppError(
        "INVALID_UPLOAD",
        "Invalid private object size or type.",
        422,
      );
    try {
      await this.deadline.run((signal) =>
        blob.uploadData(bytes, {
          abortSignal: signal,
          conditions: { ifNoneMatch: "*" },
          blobHTTPHeaders: {
            blobContentType: this.mime,
            blobCacheControl: "no-store",
          },
          maxSingleShotSize: 10485760,
          concurrency: 1,
        }),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["BlobAlreadyExists", "ConditionNotMet"].includes(String(error.code))
      )
        return;
      throw new AppError(
        "STORAGE_UPLOAD",
        "Azure upload could not be confirmed. Retry the same submission.",
        503,
      );
    }
  }
  async read(path: string, maxBytes: number) {
    const blob = this.path(path);
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > this.cap)
      throw new AppError("INVALID_UPLOAD", "Invalid private object size.", 422);
    try {
      return await this.deadline.run(async (signal) => {
        const response = await blob.download(0, undefined, {
          abortSignal: signal,
          maxRetryRequests: 0,
        });
        const stream = response.readableStreamBody;
        // The SDK starts its retriable stream eagerly. Rejected headers must
        // close it too, including any later transport/corruption error.
        stream?.on("error", () => {});
        if (
          response.contentType !== this.mime ||
          !Number.isInteger(response.contentLength) ||
          response.contentLength! < 1 ||
          response.contentLength! > maxBytes ||
          !stream
        ) {
          if (
            stream &&
            "destroy" in stream &&
            typeof stream.destroy === "function"
          )
            stream.destroy();
          throw new Error("size/type");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const value of stream) {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            size += chunk.length;
            if (size > maxBytes) throw new Error("oversize");
            chunks.push(chunk);
          }
          if (size !== response.contentLength) throw new Error("incomplete");
          return Uint8Array.from(Buffer.concat(chunks, size));
        } catch (error) {
          if ("destroy" in stream && typeof stream.destroy === "function")
            stream.destroy();
          throw error;
        }
      });
    } catch {
      throw new AppError(
        "STORAGE_READ",
        "Azure object could not be verified.",
        503,
      );
    }
  }
  async remove(path: string) {
    const blob = this.path(path);
    try {
      await this.deadline.run((signal) =>
        blob.deleteIfExists({ abortSignal: signal }),
      );
    } catch {
      throw new AppError(
        "STORAGE_CLEANUP",
        "Private Azure object cleanup could not be confirmed.",
        503,
      );
    }
  }
  async downloadUrl(path: string, expiresIn: number, fileName: string) {
    const blob = this.path(path);
    if (
      this.options.purpose !== "reports" ||
      !Number.isInteger(expiresIn) ||
      expiresIn < 10 ||
      expiresIn > 120 ||
      fileName.length > 200 ||
      !/^[^/\\\u0000-\u001f\u007f]+\.pdf$/i.test(fileName)
    )
      throw new AppError(
        "INVALID_EXPIRY",
        "Invalid report download lifetime or filename.",
        422,
      );
    const now = this.now();
    const expiresOn = new Date(now.getTime() + expiresIn * 1000);
    const startsOn = new Date(now.getTime() - 300000);
    try {
      return await this.deadline.run(async (signal) => {
        const key = await this.service.getUserDelegationKey(
          startsOn,
          expiresOn,
          { abortSignal: signal },
        );
        if (key.signedStartsOn > now || key.signedExpiresOn < expiresOn)
          throw new Error("delegation lifetime");
        const encoded = encodeURIComponent(fileName).replace(
          /['()*]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        const sas = generateBlobSASQueryParameters(
          {
            containerName: this.options.container,
            blobName: path,
            permissions: BlobSASPermissions.parse("r"),
            protocol: SASProtocol.Https,
            startsOn,
            expiresOn,
            contentType: "application/pdf",
            cacheControl: "no-store",
            contentDisposition: `attachment; filename="report.pdf"; filename*=UTF-8''${encoded}`,
          },
          key,
          this.options.account,
        ).toString();
        const url = new URL(`${blob.url}?${sas}`);
        if (
          url.origin !== this.origin ||
          url.searchParams.get("sp") !== "r" ||
          url.searchParams.get("sr") !== "b" ||
          url.searchParams.get("spr") !== "https"
        )
          throw new Error("sas");
        return url.href;
      });
    } catch {
      throw new AppError(
        "STORAGE_LINK",
        "Azure report download is temporarily unavailable.",
        503,
      );
    }
  }
}
export class AzurePrivateStorage implements PrivateStorage {
  constructor(private readonly objects: AzureBlobObjects) {}
  verifyConfiguration() {
    return this.objects.verifyConfiguration();
  }
  putIfAbsent(path: string, bytes: Uint8Array, type: string) {
    return this.objects.putIfAbsent(path, bytes, type);
  }
  async checksum(path: string, maxBytes: number) {
    return createHash("sha256")
      .update(await this.objects.read(path, maxBytes))
      .digest("hex");
  }
  downloadUrl(path: string, expires: number, fileName: string) {
    return this.objects.downloadUrl(path, expires, fileName);
  }
  remove(path: string) {
    return this.objects.remove(path);
  }
}
export class AzureOfferImageStorage implements OfferImageStorage {
  constructor(private readonly objects: AzureBlobObjects) {}
  verifyConfiguration() {
    return this.objects.verifyConfiguration();
  }
  async putIfAbsent(path: string, bytes: Uint8Array) {
    if (
      bytes.length < 12 ||
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF" ||
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP"
    )
      throw new AppError("INVALID_IMAGE", "Invalid normalized image.", 422);
    return this.objects.putIfAbsent(path, bytes, "image/webp");
  }
  read(path: string, maxBytes: number) {
    return this.objects.read(path, maxBytes);
  }
  remove(path: string) {
    return this.objects.remove(path);
  }
}
