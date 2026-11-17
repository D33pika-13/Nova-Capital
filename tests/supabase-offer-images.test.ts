import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { it, expect } from "vitest";
import { SupabaseOfferImageStorage } from "@/server/providers/supabase-offer-images";
it("uses the actual SDK for a private immutable WebP bucket, readback and cleanup without creating public/signed URLs", async () => {
  const objects = new Map<string, Uint8Array>();
  const calls: { method: string; path: string; headers: Headers }[] = [];
  let isPublic = false;
  const client = createClient(
    "https://storage.example.test",
    "synthetic-service-role-test-value",
    {
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
              id: "offer-images",
              public: isPublic,
              file_size_limit: 5242880,
              allowed_mime_types: ["image/webp"],
            });
          const key = url.pathname.split("offer-images/")[1];
          if (method === "POST") {
            if (objects.has(key))
              return Response.json(
                {
                  statusCode: "409",
                  error: "Duplicate",
                  message: "The resource already exists",
                },
                { status: 409 },
              );
            objects.set(
              key,
              new Uint8Array(await new Response(init?.body).arrayBuffer()),
            );
            return Response.json({
              Id: randomUUID(),
              Key: `offer-images/${key}`,
            });
          }
          if (method === "GET") {
            const bytes = objects.get(key);
            return bytes
              ? new Response(Uint8Array.from(bytes), {
                  headers: { "Content-Type": "image/webp" },
                })
              : Response.json({ message: "Not found" }, { status: 404 });
          }
          if (method === "DELETE") {
            for (const path of JSON.parse(String(init?.body)).prefixes)
              objects.delete(path);
            return Response.json([]);
          }
          return Response.json(
            { message: "Unexpected request" },
            { status: 400 },
          );
        },
      },
    },
  );
  const adapter = new SupabaseOfferImageStorage(
    client,
    "offer-images",
    5242880,
  );
  const path = `${randomUUID()}/${randomUUID()}.webp`;
  const bytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "navy" },
  })
    .webp()
    .toBuffer();
  await adapter.verifyConfiguration();
  await adapter.putIfAbsent(path, bytes);
  await adapter.putIfAbsent(path, bytes);
  expect(objects.size).toBe(1);
  expect(await adapter.read(path, bytes.length)).toEqual(new Uint8Array(bytes));
  expect(
    calls.some((c) => c.path.includes("/sign/") || c.path.includes("/public/")),
  ).toBe(false);
  expect(calls.find((c) => c.method === "POST")?.headers.get("x-upsert")).toBe(
    "false",
  );
  await expect(
    adapter.putIfAbsent("../escape.webp", bytes),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    adapter.putIfAbsent(path, new Uint8Array([1, 2, 3])),
  ).rejects.toMatchObject({ status: 422 });
  await expect(adapter.read(path, 1)).rejects.toMatchObject({ status: 503 });
  isPublic = true;
  await expect(adapter.verifyConfiguration()).rejects.toMatchObject({
    status: 503,
  });
  await adapter.remove(path);
  expect(objects.size).toBe(0);
});
