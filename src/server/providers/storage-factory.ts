import "server-only";
import { ConfigurationError } from "../errors";
import { AzureCredentialFactory } from "./azure-credentials";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../config";
import { AzureAccountPolicy } from "./azure-storage-policy";
import {
  AzureBlobObjects,
  AzurePrivateStorage,
  AzureOfferImageStorage,
} from "./azure-storage";
import { SupabasePrivateStorage } from "./supabase-storage";
import { SupabaseOfferImageStorage } from "./supabase-offer-images";
import type { StorageLocation } from "./storage-location";
export class StorageFactory {
  constructor(
    private readonly config: Readonly<ServerConfig>,
    private readonly supabase?: SupabaseClient,
  ) {}
  create() {
    const c = this.config;
    if (c.STORAGE_PROVIDER === "supabase") {
      if (!this.supabase)
        throw new ConfigurationError(["SUPABASE_SERVICE_ROLE_KEY"]);
      return {
        reports: new SupabasePrivateStorage(
          this.supabase,
          c.REPORT_BUCKET,
          c.SUPABASE_URL!,
          c.UPLOAD_MAX_BYTES,
        ),
        images: new SupabaseOfferImageStorage(
          this.supabase,
          c.OFFER_IMAGE_BUCKET,
          5242880,
        ),
        reportLocation: undefined,
        imageLocation: undefined,
        namespace: undefined,
      };
    }
    const credential = new AzureCredentialFactory(c).create(
      c.AZURE_STORAGE_TIMEOUT_MS,
    );
    const policy = new AzureAccountPolicy(
      credential,
      c.AZURE_STORAGE_ACCOUNT_NAME!,
      c.AZURE_STORAGE_ACCOUNT_RESOURCE_ID!,
      c.AZURE_STORAGE_TIMEOUT_MS,
    );
    const shared = {
      account: c.AZURE_STORAGE_ACCOUNT_NAME!,
      timeoutMs: c.AZURE_STORAGE_TIMEOUT_MS,
    };
    return {
      reports: new AzurePrivateStorage(
        new AzureBlobObjects(
          {
            ...shared,
            container: c.REPORT_BUCKET,
            purpose: "reports",
            maximumBytes: c.UPLOAD_MAX_BYTES,
          },
          credential,
          policy,
        ),
      ),
      images: new AzureOfferImageStorage(
        new AzureBlobObjects(
          {
            ...shared,
            container: c.OFFER_IMAGE_BUCKET,
            purpose: "offer_images",
            maximumBytes: 5242880,
          },
          credential,
          policy,
        ),
      ),
      reportLocation: {
        provider: "azure",
        account: shared.account,
        maximumBytes: c.UPLOAD_MAX_BYTES,
      } as StorageLocation,
      imageLocation: {
        provider: "azure",
        account: shared.account,
        maximumBytes: 5242880,
      } as StorageLocation,
      namespace: shared.account,
    };
  }
}
