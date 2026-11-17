import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { it, expect } from "vitest";
import { SupabasePrivateStorage } from "@/server/providers/supabase-storage";
const origin = "https://storage.example.test";
function fixture() {
  let isPublic = false;
  const objects = new Map<string, Uint8Array>();
  const calls: { method: string; path: string; headers: Headers }[] = [];
  const client = createClient(origin, "synthetic-service-key-not-real", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        const method = init?.method ?? "GET";
        calls.push({
          method,
          path: url.pathname,
          headers: new Headers(init?.headers),
        });
        if (url.pathname.includes("/bucket/"))
          return Response.json({
            id: "client-reports",
            name: "client-reports",
            public: isPublic,
            file_size_limit: 10485760,
            allowed_mime_types: ["application/pdf"],
          });
        const path = url.pathname.split("client-reports/")[1];
        if (method === "POST" && url.pathname.includes("/object/sign/"))
          return Response.json({
            signedURL: `/object/sign/client-reports/${path}?token=synthetic-test-only`,
          });
        if (method === "POST") {
          if (objects.has(path))
            return Response.json(
              {
                statusCode: "409",
                error: "Duplicate",
                message: "The resource already exists",
              },
              { status: 409 },
            );
          objects.set(
            path,
            new Uint8Array(await new Response(init?.body).arrayBuffer()),
          );
          return Response.json({
            Id: randomUUID(),
            Key: `client-reports/${path}`,
          });
        }
        if (method === "GET") {
          const bytes = objects.get(path);
          return bytes
            ? new Response(Uint8Array.from(bytes), {
                headers: { "Content-Type": "application/pdf" },
              })
            : Response.json({ message: "Not found" }, { status: 404 });
        }
        if (method === "DELETE") {
          const body = JSON.parse(String(init?.body));
          for (const key of body.prefixes) objects.delete(key);
          return Response.json([]);
        }
        return Response.json(
          { message: "Unexpected test request" },
          { status: 400 },
        );
      },
    },
  });
  return {
    adapter: new SupabasePrivateStorage(
      client,
      "client-reports",
      origin,
      5242880,
    ),
    objects,
    calls,
    makePublic: () => {
      isPublic = true;
    },
  };
}
it("uses the installed Supabase SDK to preserve immutable bytes and create short attachment links", async () => {
  const s = fixture();
  await s.adapter.verifyConfiguration();
  const path = `${randomUUID()}/${randomUUID()}.pdf`;
  const bytes = Buffer.from("Synthetic SDK contract bytes");
  await s.adapter.putIfAbsent(path, bytes, "application/pdf");
  await s.adapter.putIfAbsent(path, bytes, "application/pdf");
  expect(s.objects.size).toBe(1);
  expect(await s.adapter.checksum(path, bytes.length)).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  const url = new URL(
    await s.adapter.downloadUrl(path, 60, "original report.pdf"),
  );
  expect(url.origin).toBe(origin);
  expect(url.searchParams.get("download")).toBe("original report.pdf");
  expect(
    s.calls.every(
      (c) =>
        c.headers.get("authorization") ===
        "Bearer synthetic-service-key-not-real",
    ),
  ).toBe(true);
  await s.adapter.remove(path);
  expect(s.objects.size).toBe(0);
});
it("rejects public buckets, traversal and invalid download parameters", async () => {
  const s = fixture();
  s.makePublic();
  await expect(s.adapter.verifyConfiguration()).rejects.toMatchObject({
    code: "STORAGE_CONFIGURATION",
  });
  await expect(
    s.adapter.putIfAbsent(
      "../../other.pdf",
      Buffer.from("x"),
      "application/pdf",
    ),
  ).rejects.toMatchObject({ status: 422 });
  const path = `${randomUUID()}/${randomUUID()}.pdf`;
  await expect(
    s.adapter.downloadUrl(path, 3600, "report.pdf"),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    s.adapter.downloadUrl(path, 60, "report.pdf\r\nInjected: true"),
  ).rejects.toMatchObject({ status: 422 });
});
it("preserves Unicode and punctuation in the original download filename", async () => {
  const s = fixture();
  const path = `${randomUUID()}/${randomUUID()}.pdf`;
  const fileName = "मासिक विवरण + 100%.pdf";
  const url = new URL(await s.adapter.downloadUrl(path, 60, fileName));
  expect(url.searchParams.get("download")).toBe(fileName);
});
