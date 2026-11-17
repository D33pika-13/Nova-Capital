import { randomUUID, createHash } from "node:crypto";
import { it, expect } from "vitest";
import type { TokenCredential } from "@azure/identity";
import {
  AzureBlobObjects,
  AzurePrivateStorage,
  AzureOfferImageStorage,
} from "@/server/providers/azure-storage";
import { AzureAccountPolicy } from "@/server/providers/azure-storage-policy";
import {
  AzureBlobHttpClient,
  AzureDeadline,
} from "@/server/providers/azure-http";
const account = "syntheticnova";
const resourceId =
  "/subscriptions/10000000-0000-4000-8000-000000000001/resourceGroups/rg-nova-test/providers/Microsoft.Storage/storageAccounts/" +
  account;
const now = new Date("2026-01-01T12:00:00.000Z");
function fixture(purpose: "reports" | "offer_images" = "reports") {
  const container = purpose === "reports" ? "client-reports" : "offer-images";
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  const calls: { method: string; url: URL; headers: Headers }[] = [];
  const scopes: string[] = [];
  let publicContainer = false;
  let unsafeAccount = false;
  let delegationDenied = false;
  let oversized = false;
  let truncated = false;
  let inaccessible = false;
  const credential: TokenCredential = {
    getToken: async (scope) => {
      scopes.push(String(scope));
      return {
        token: "synthetic-managed-identity-token",
        expiresOnTimestamp: Date.now() + 3600000,
      };
    },
  };
  const xml = (code: string, status: number) =>
    new Response(
      `<Error><Code>${code}</Code><Message>Synthetic error detail must not reach clients</Message></Error>`,
      {
        status,
        headers: { "Content-Type": "application/xml", "x-ms-error-code": code },
      },
    );
  const request: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, headers });
    if (url.origin === "https://management.azure.com")
      return inaccessible
        ? new Response("Synthetic denial", { status: 403 })
        : Response.json({
            id: resourceId,
            name: account,
            kind: "StorageV2",
            properties: {
              allowBlobPublicAccess: !unsafeAccount ? false : true,
              allowSharedKeyAccess: false,
              supportsHttpsTrafficOnly: true,
              minimumTlsVersion: "TLS1_2",
              encryption: { services: { blob: { enabled: true } } },
              primaryEndpoints: {
                blob: `https://${account}.blob.core.windows.net/`,
              },
            },
          });
    if (url.searchParams.get("comp") === "userdelegationkey") {
      if (delegationDenied) return xml("AuthorizationPermissionMismatch", 403);
      return new Response(
        `<UserDelegationKey><SignedOid>10000000-0000-4000-8000-000000000002</SignedOid><SignedTid>10000000-0000-4000-8000-000000000003</SignedTid><SignedStart>2026-01-01T11:55:00Z</SignedStart><SignedExpiry>2026-01-01T12:02:00Z</SignedExpiry><SignedService>b</SignedService><SignedVersion>2025-11-05</SignedVersion><Value>${Buffer.alloc(32, 42).toString("base64")}</Value></UserDelegationKey>`,
        { headers: { "Content-Type": "application/xml" } },
      );
    }
    if (url.searchParams.get("restype") === "container")
      return new Response(null, {
        headers: {
          etag: '"synthetic-container-etag"',
          "Last-Modified": now.toUTCString(),
          ...(publicContainer ? { "x-ms-blob-public-access": "blob" } : {}),
        },
      });
    const path = url.pathname.slice(container.length + 2);
    if (method === "PUT") {
      if (objects.has(path)) return xml("BlobAlreadyExists", 409);
      objects.set(path, {
        bytes: new Uint8Array(await new Response(init?.body).arrayBuffer()),
        mime: headers.get("x-ms-blob-content-type") ?? "",
      });
      return new Response(null, {
        status: 201,
        headers: {
          etag: '"synthetic-object-etag"',
          "Last-Modified": now.toUTCString(),
        },
      });
    }
    if (method === "GET") {
      const object = objects.get(path);
      return object
        ? new Response(Uint8Array.from(object.bytes), {
            headers: {
              "Content-Type": object.mime,
              "Content-Length": String(
                oversized
                  ? 10485761
                  : object.bytes.length + (truncated ? 1 : 0),
              ),
              etag: '"synthetic-object-etag"',
              "Last-Modified": now.toUTCString(),
              "x-ms-blob-type": "BlockBlob",
            },
          })
        : xml("BlobNotFound", 404);
    }
    if (method === "DELETE") {
      objects.delete(path);
      return new Response(null, { status: 202 });
    }
    return xml("Unsupported", 400);
  };
  const policy = new AzureAccountPolicy(
    credential,
    account,
    resourceId,
    1000,
    request,
  );
  const objectStore = new AzureBlobObjects(
    {
      account,
      container,
      purpose,
      maximumBytes: purpose === "reports" ? 5242880 : 5242880,
      timeoutMs: 1000,
    },
    credential,
    policy,
    request,
    () => now,
  );
  return {
    reports: new AzurePrivateStorage(objectStore),
    images: new AzureOfferImageStorage(objectStore),
    objects,
    calls,
    scopes,
    makePublic: () => {
      publicContainer = true;
    },
    makeUnsafe: () => {
      unsafeAccount = true;
    },
    denyDelegation: () => {
      delegationDenied = true;
    },
    makeOversized: () => {
      oversized = true;
    },
    makeTruncated: () => {
      truncated = true;
    },
    denyPolicy: () => {
      inaccessible = true;
    },
  };
}
it("runs actual Azure SDK immutable upload/readback and read-only HTTPS delegation signing without an account key", async () => {
  const f = fixture();
  const path = `${randomUUID()}/${randomUUID()}.pdf`;
  const bytes = new TextEncoder().encode("%PDF-SYNTHETIC contract bytes only");
  await f.reports.verifyConfiguration();
  await f.reports.putIfAbsent(path, bytes, "application/pdf");
  await f.reports.putIfAbsent(
    path,
    new Uint8Array([1, 2, 3]),
    "application/pdf",
  );
  expect(f.objects.get(path)?.bytes).toEqual(bytes);
  expect(await f.reports.checksum(path, bytes.length)).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  const filename = 'हिंदी + 100% "copy".pdf';
  const url = new URL(await f.reports.downloadUrl(path, 60, filename));
  expect(url.origin).toBe(`https://${account}.blob.core.windows.net`);
  expect(url.searchParams.get("sp")).toBe("r");
  expect(url.searchParams.get("sr")).toBe("b");
  expect(url.searchParams.get("spr")).toBe("https");
  expect(url.searchParams.get("se")).toBe("2026-01-01T12:01:00Z");
  expect(url.searchParams.get("rscc")).toBe("no-store");
  expect(
    decodeURIComponent(url.searchParams.get("rscd")!.split("UTF-8''")[1]),
  ).toBe(filename);
  expect(url.searchParams.get("sig")).toBeTruthy();
  const upload = f.calls.find((c) => c.method === "PUT")!;
  expect(upload.headers.get("if-none-match")).toBe("*");
  expect(upload.headers.get("x-ms-blob-cache-control")).toBe("no-store");
  expect(f.scopes).toContain("https://management.azure.com/.default");
  expect(f.scopes).toContain("https://storage.azure.com/.default");
  expect(f.calls.some((c) => /listKeys|accountSas/i.test(c.url.href))).toBe(
    false,
  );
  await f.reports.remove(path);
  expect(f.objects.size).toBe(0);
});
it("uses the same private blob engine for normalized offer images without public or signed image URLs", async () => {
  const f = fixture("offer_images");
  const path = `${randomUUID()}/${randomUUID()}.webp`;
  const bytes = new TextEncoder().encode("RIFF0000WEBPsynthetic-fixture");
  await f.images.verifyConfiguration();
  await f.images.putIfAbsent(path, bytes);
  expect(await f.images.read(path, bytes.length)).toEqual(bytes);
  expect(
    f.calls.some((c) => c.url.searchParams.get("comp") === "userdelegationkey"),
  ).toBe(false);
  await expect(
    f.images.putIfAbsent(path, new Uint8Array([1, 2, 3])),
  ).rejects.toMatchObject({ status: 422 });
});
it("fails closed for public containers, unsafe/unreadable account policy and excessive blob sizes", async () => {
  for (const mutate of ["makePublic", "makeUnsafe", "denyPolicy"] as const) {
    const f = fixture();
    f[mutate]();
    await expect(f.reports.verifyConfiguration()).rejects.toMatchObject({
      status: 503,
    });
  }
  const f = fixture();
  const path = `${randomUUID()}/${randomUUID()}.pdf`;
  await f.reports.putIfAbsent(
    path,
    new TextEncoder().encode("%PDF-fixture"),
    "application/pdf",
  );
  f.makeOversized();
  await expect(f.reports.checksum(path, 100)).rejects.toMatchObject({
    code: "STORAGE_READ",
  });
});
it("rejects traversal, invalid lifetimes/names, missing delegation permission and unexpected destinations", async () => {
  const f = fixture();
  const path = `${randomUUID()}/${randomUUID()}.pdf`;
  await expect(
    f.reports.putIfAbsent(
      "../secret.pdf",
      new Uint8Array([1]),
      "application/pdf",
    ),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    f.reports.downloadUrl(path, 121, "safe.pdf"),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    f.reports.downloadUrl(path, 60, "bad\r\nheader.pdf"),
  ).rejects.toMatchObject({ status: 422 });
  f.denyDelegation();
  await expect(
    f.reports.downloadUrl(path, 60, "safe.pdf"),
  ).rejects.toMatchObject({
    message: "Azure report download is temporarily unavailable.",
  });
  let called = false;
  const transport = new AzureBlobHttpClient(
    `https://${account}.blob.core.windows.net`,
    async () => {
      called = true;
      return new Response(null);
    },
  );
  await expect(
    transport.sendRequest({
      url: "https://attacker.example.test",
      method: "GET",
    } as Parameters<typeof transport.sendRequest>[0]),
  ).rejects.toMatchObject({ code: "AZURE_DESTINATION" });
  expect(called).toBe(false);
});

it("rejects truncated SDK download streams without an unhandled corruption error", async () => {
  const f = fixture();
  const path = `${randomUUID()}/${randomUUID()}.pdf`;
  await f.reports.putIfAbsent(
    path,
    new TextEncoder().encode("%PDF-fixture"),
    "application/pdf",
  );
  f.makeTruncated();
  await expect(f.reports.checksum(path, 1024)).rejects.toMatchObject({
    code: "STORAGE_READ",
    status: 503,
  });
});

it("aborts a stalled Azure operation at its caller deadline", async () => {
  let signal: AbortSignal | undefined;
  await expect(
    new AzureDeadline(10).run(async (input) => {
      signal = input;
      return new Promise<void>(() => {});
    }),
  ).rejects.toMatchObject({ code: "AZURE_TIMEOUT", status: 503 });
  expect(signal?.aborted).toBe(true);
});
