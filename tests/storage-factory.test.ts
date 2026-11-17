import { it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ConfigurationService } from "@/server/config";
import { StorageFactory } from "@/server/providers/storage-factory";
import {
  AzurePrivateStorage,
  AzureOfferImageStorage,
} from "@/server/providers/azure-storage";
import { SupabasePrivateStorage } from "@/server/providers/supabase-storage";
import { SupabaseOfferImageStorage } from "@/server/providers/supabase-offer-images";

it("constructs only the selected storage adapters and preserves exact Azure locations without contacting providers", () => {
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
  try {
    const client = createClient(
      "https://synthetic.supabase.co",
      "synthetic-key",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const initial = new StorageFactory(
      new ConfigurationService({}).get(),
      client,
    ).create();
    expect(initial.reports).toBeInstanceOf(SupabasePrivateStorage);
    expect(initial.images).toBeInstanceOf(SupabaseOfferImageStorage);
    expect(initial.namespace).toBeUndefined();
    for (const mode of ["managed_identity", "azure_cli"]) {
      const config = new ConfigurationService({
        APP_ENV: "test",
        STORAGE_PROVIDER: "azure",
        AZURE_CREDENTIAL_MODE: mode,
        AZURE_STORAGE_ACCOUNT_NAME: "syntheticnova",
        AZURE_STORAGE_ACCOUNT_RESOURCE_ID:
          "/subscriptions/10000000-0000-4000-8000-000000000001/resourceGroups/rg-test/providers/Microsoft.Storage/storageAccounts/syntheticnova",
      }).get();
      const azure = new StorageFactory(config, client).create();
      expect(azure.reports).toBeInstanceOf(AzurePrivateStorage);
      expect(azure.images).toBeInstanceOf(AzureOfferImageStorage);
      expect(azure.namespace).toBe("syntheticnova");
      expect(azure.reportLocation).toEqual({
        provider: "azure",
        account: "syntheticnova",
        maximumBytes: config.UPLOAD_MAX_BYTES,
      });
      expect(azure.imageLocation).toEqual({
        provider: "azure",
        account: "syntheticnova",
        maximumBytes: 5242880,
      });
    }
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
