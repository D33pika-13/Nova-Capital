import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeAll, afterAll, it, expect } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { OfferService } from "@/server/modules/offers/offer-service";
import { PostgresOfferRepository } from "@/server/providers/postgres-offers";
import { PostgresOfferImageRepository } from "@/server/providers/postgres-offer-images";
import { OfferImageService } from "@/server/modules/offers/offer-image-service";
import { WorkerImageProcessor } from "@/server/providers/image-processor";
import type { OfferImageStorage } from "@/server/modules/offers/image-contracts";
import { AppError } from "@/server/errors";
const db = new TestDatabase();
const auth = testAuth(db);
const repo = new PostgresOfferImageRepository(db);
const offers = new OfferService(auth, new PostgresOfferRepository(db));
let png: Uint8Array;
class MemoryStorage implements OfferImageStorage {
  objects = new Map<string, Uint8Array>();
  deletions: string[] = [];
  puts = 0;
  corrupt = false;
  loseAck = false;
  onPut?: () => Promise<void>;
  onRead?: () => Promise<void>;
  async verifyConfiguration() {}
  async putIfAbsent(path: string, bytes: Uint8Array) {
    this.puts++;
    if (!this.objects.has(path)) {
      const copy = Uint8Array.from(bytes);
      if (this.corrupt) copy[copy.length - 1] ^= 255;
      this.objects.set(path, copy);
    }
    await this.onPut?.();
    if (this.loseAck) {
      this.loseAck = false;
      throw new AppError(
        "UNKNOWN",
        "Synthetic lost storage acknowledgment",
        503,
      );
    }
  }
  async read(path: string, maxBytes: number) {
    await this.onRead?.();
    const bytes = this.objects.get(path);
    if (!bytes || bytes.length > maxBytes)
      throw new AppError("STORAGE_READ", "Synthetic object missing", 503);
    return Uint8Array.from(bytes);
  }
  async remove(path: string) {
    this.deletions.push(path);
    this.objects.delete(path);
  }
}
function fixture(
  who: "admin" | "a" = "admin",
  assurance: "aal1" | "aal2" = "aal2",
) {
  const storage = new MemoryStorage();
  let infected = false;
  const service = new OfferImageService(
    testAuth(db, who, assurance),
    repo,
    storage,
    {
      scan: async () => {
        if (infected)
          throw new AppError(
            "MALWARE_DETECTED",
            "Synthetic scanner denial",
            422,
          );
      },
    },
    new WorkerImageProcessor(5000),
    { consume: async () => true },
    { bucket: "offer-images", provider: "supabase", maxBytes: 5242880 },
  );
  return {
    service,
    storage,
    infect: () => {
      infected = true;
    },
  };
}
const offerInput = () => ({
  requestId: randomUUID(),
  title: "SYNTHETIC image offer",
  description: "Fixture only",
  category: "member",
  eligibility: "Fixture members",
  terms: "Fixture terms",
  status: "published",
  startsAt: "2020-01-01T00:00:00Z",
  endsAt: "2090-01-01T00:00:00Z",
});
const metadata = (version = 1) => ({
  requestId: randomUUID(),
  expectedVersion: version,
  alt: "Synthetic blue offer illustration",
});
beforeAll(async () => {
  await db.initialize(true);
  png = await sharp({
    create: {
      width: 16,
      height: 8,
      channels: 4,
      background: { r: 20, g: 90, b: 120, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
}, 20000);
afterAll(() => db.close());
it("scans and normalizes an image, hides draft bytes, publishes with validity and removes public access when unpublished", async () => {
  const f = fixture();
  const data = { ...offerInput(), status: "draft" };
  const offer = await offers.save(data);
  const result = await f.service.upload(offer.id, metadata(), png, "image/png");
  expect(result.current).toBe(true);
  expect(result.offer).toMatchObject({
    version: 2,
    image: { alt: "Synthetic blue offer illustration", width: 16, height: 8 },
  });
  await expect(f.service.read(offer.id)).rejects.toMatchObject({ status: 404 });
  const bytes = await f.service.read(offer.id, true);
  expect((await sharp(bytes).metadata()).format).toBe("webp");
  expect(Buffer.from(bytes)).not.toEqual(Buffer.from(png));
  const published = await offers.save(
    {
      ...data,
      requestId: randomUUID(),
      expectedVersion: 2,
      status: "published",
    },
    offer.id,
  );
  expect(published.version).toBe(3);
  expect(await f.service.read(offer.id)).toEqual(bytes);
  await offers.save(
    { ...data, requestId: randomUUID(), expectedVersion: 3, status: "draft" },
    offer.id,
  );
  await expect(f.service.read(offer.id)).rejects.toMatchObject({ status: 404 });
  expect(await f.service.read(offer.id, true)).toEqual(bytes);
});
it("replays the same upload without duplicate objects, preserves history after removal and does not resurrect an old image", async () => {
  const f = fixture();
  const offer = await offers.save(offerInput());
  const input = metadata();
  const first = await f.service.upload(offer.id, input, png, "image/png");
  const replay = await f.service.upload(offer.id, input, png, "image/png");
  expect(replay).toEqual(first);
  expect(f.storage.objects.size).toBe(1);
  expect(f.storage.puts).toBe(1);
  const removed = await f.service.remove(offer.id, {
    requestId: randomUUID(),
    expectedVersion: 2,
  });
  expect(removed).toMatchObject({ version: 3, image: null });
  await expect(f.service.read(offer.id)).rejects.toMatchObject({ status: 404 });
  const afterRemoval = await f.service.upload(
    offer.id,
    input,
    png,
    "image/png",
  );
  expect(afterRemoval.current).toBe(false);
  expect(afterRemoval.offer.image).toBeNull();
  expect(f.storage.objects.size).toBe(1);
  expect(f.storage.puts).toBe(1);
  await expect(
    f.service.upload(
      offer.id,
      { ...input, alt: "Changed alt" },
      png,
      "image/png",
    ),
  ).rejects.toMatchObject({ status: 409 });
  const count = (
    await db.engine.query<{ count: number }>(
      "select count(*)::int count from offer_images where offer_id=$1",
      [offer.id],
    )
  ).rows[0].count;
  expect(count).toBe(1);
});
it("resumes a lost upload acknowledgment through the same quarantined reservation", async () => {
  const f = fixture();
  const offer = await offers.save(offerInput());
  const input = metadata();
  f.storage.loseAck = true;
  await expect(
    f.service.upload(offer.id, input, png, "image/png"),
  ).rejects.toMatchObject({ status: 503 });
  await expect(f.service.read(offer.id)).rejects.toMatchObject({ status: 404 });
  const result = await f.service.upload(offer.id, input, png, "image/png");
  expect(result.current).toBe(true);
  expect(f.storage.objects.size).toBe(1);
  expect(f.storage.deletions).toEqual([]);
});
it("aborts corrupt unpublished objects before cleanup and never recreates an aborted upload on replay", async () => {
  const f = fixture();
  const offer = await offers.save(offerInput());
  const input = metadata();
  f.storage.corrupt = true;
  await expect(
    f.service.upload(offer.id, input, png, "image/png"),
  ).rejects.toMatchObject({ code: "IMAGE_CHECKSUM" });
  expect(f.storage.objects.size).toBe(0);
  expect(f.storage.deletions).toHaveLength(1);
  const row = (
    await db.engine.query<{ status: string }>(
      "select status from offer_images where offer_id=$1",
      [offer.id],
    )
  ).rows[0];
  expect(row.status).toBe("aborted");
  f.storage.corrupt = false;
  await expect(
    f.service.upload(offer.id, input, png, "image/png"),
  ).rejects.toMatchObject({ code: "UPLOAD_ABORTED" });
  expect(f.storage.puts).toBe(1);
  expect(f.storage.objects.size).toBe(0);
  const fresh = await f.service.upload(offer.id, metadata(), png, "image/png");
  expect(fresh.current).toBe(true);
  expect(f.storage.objects.size).toBe(1);
});
it("does not overwrite a concurrent text edit and safely abandons its private object", async () => {
  const f = fixture();
  const data = offerInput();
  const offer = await offers.save(data);
  f.storage.onPut = async () => {
    f.storage.onPut = undefined;
    await offers.save(
      {
        ...data,
        requestId: randomUUID(),
        expectedVersion: 1,
        title: "Concurrent edit",
      },
      offer.id,
    );
  };
  await expect(
    f.service.upload(offer.id, metadata(), png, "image/png"),
  ).rejects.toMatchObject({ code: "STALE_RECORD" });
  expect(f.storage.objects.size).toBe(0);
  const latest = (await offers.manage()).find((o) => o.id === offer.id)!;
  expect(latest).toMatchObject({
    title: "Concurrent edit",
    version: 2,
    image: null,
  });
});
it("rejects malware, MIME spoofing, invalid paths, clients and low-assurance administrators", async () => {
  const offer = await offers.save(offerInput());
  const f = fixture();
  f.infect();
  await expect(
    f.service.upload(offer.id, metadata(), png, "image/png"),
  ).rejects.toMatchObject({ code: "MALWARE_DETECTED" });
  expect(f.storage.objects.size).toBe(0);
  await expect(
    f.service.upload(offer.id, metadata(), png, "image/jpeg"),
  ).rejects.toMatchObject({ status: 422 });
  await expect(f.service.read("../secret")).rejects.toMatchObject({
    status: 404,
  });
  for (const denied of [fixture("a"), fixture("admin", "aal1")]) {
    await expect(
      denied.service.upload(offer.id, metadata(), png, "image/png"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      denied.service.remove(offer.id, {
        requestId: randomUUID(),
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
});
it("checks publication again after fetching bytes and rejects post-publication corruption", async () => {
  const f = fixture();
  const data = offerInput();
  const offer = await offers.save(data);
  await f.service.upload(offer.id, metadata(), png, "image/png");
  const path = [...f.storage.objects.keys()][0];
  const bytes = f.storage.objects.get(path)!;
  const tampered = Uint8Array.from(bytes);
  tampered[tampered.length - 1] ^= 255;
  f.storage.objects.set(path, tampered);
  await expect(f.service.read(offer.id)).rejects.toMatchObject({
    code: "IMAGE_CHECKSUM",
  });
  expect(f.storage.deletions).toHaveLength(0);
  f.storage.objects.set(path, bytes);
  f.storage.onRead = async () => {
    f.storage.onRead = undefined;
    await offers.save(
      { ...data, requestId: randomUUID(), expectedVersion: 2, status: "draft" },
      offer.id,
    );
  };
  await expect(f.service.read(offer.id)).rejects.toMatchObject({ status: 404 });
});
it("keeps pending copies private if admin access is revoked while uploading and cannot delete a ready object through abort", async () => {
  const f = fixture();
  const offer = await offers.save(offerInput());
  f.storage.onPut = async () => {
    await db.engine.query(
      "update profiles set status='suspended' where id=$1",
      [ids.admin],
    );
  };
  try {
    await expect(
      f.service.upload(offer.id, metadata(), png, "image/png"),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.storage.deletions).toHaveLength(0);
    expect(
      (
        await db.engine.query<{ image_id: null }>(
          "select image_id from offers where id=$1",
          [offer.id],
        )
      ).rows[0].image_id,
    ).toBeNull();
  } finally {
    await db.engine.query("update profiles set status='active' where id=$1", [
      ids.admin,
    ]);
  }
  f.storage.onPut = undefined;
  const other = await offers.save(offerInput());
  const ready = await f.service.upload(other.id, metadata(), png, "image/png");
  expect(
    await repo.abort(await auth.requireAdmin(), ready.offer.image!.id),
  ).toBe(false);
  expect(await f.service.read(other.id)).toBeDefined();
});
it("enforces immutable image metadata and association in SQL and private bucket policy despite broad browser grants", async () => {
  const f = fixture();
  const offer = await offers.save(offerInput());
  const result = await f.service.upload(offer.id, metadata(), png, "image/png");
  const other = await offers.save(offerInput());
  const adminIdentity = {
    provider: "supabase" as const,
    subject: "synthetic-admin",
    assurance: "aal2" as const,
  };
  await expect(
    db.withIdentity(adminIdentity, (sql) =>
      sql.query("update offers set image_id=$1 where id=$2", [
        result.offer.image!.id,
        other.id,
      ]),
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.withIdentity(adminIdentity, (sql) =>
      sql.query("update offer_images set file_sha256=$1 where id=$2", [
        "a".repeat(64),
        result.offer.image!.id,
      ]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await db.engine.query(
    "insert into storage.objects(bucket_id,name) values('offer-images','fixture.webp')",
  );
  await db.engine.exec("begin;set local role anon");
  try {
    expect(
      (
        await db.engine.query(
          "select id from storage.objects where bucket_id='offer-images'",
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await db.engine.exec("rollback");
  }
  expect(await repo.storageReady(null, "offer-images")).toBe(true);
  await db.engine.query(
    "update storage.buckets set public=true where id='offer-images'",
  );
  try {
    expect(await repo.storageReady(null, "offer-images")).toBe(false);
  } finally {
    await db.engine.query(
      "update storage.buckets set public=false where id='offer-images'",
    );
  }
});

it("replaces images without exposing the superseded image ID and hides expired attachments", async () => {
  const f = fixture();
  const data = offerInput();
  const offer = await offers.save(data);
  const first = await f.service.upload(offer.id, metadata(), png, "image/png");
  const second = await f.service.upload(
    offer.id,
    { ...metadata(2), alt: "Replacement fixture" },
    png,
    "image/png",
  );
  expect(second.offer.image!.id).not.toBe(first.offer.image!.id);
  expect(second.offer.version).toBe(3);
  expect(f.storage.objects.size).toBe(2);
  await expect(
    f.service.read(offer.id, false, first.offer.image!.id),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    await f.service.read(offer.id, false, second.offer.image!.id),
  ).toBeDefined();
  await offers.save(
    { ...data, requestId: randomUUID(), expectedVersion: 3, status: "expired" },
    offer.id,
  );
  await expect(f.service.read(offer.id)).rejects.toMatchObject({ status: 404 });
  expect(f.storage.deletions).toEqual([]);
});
