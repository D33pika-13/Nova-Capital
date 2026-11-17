import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { PostgresReportRepository } from "@/server/providers/postgres-reports";
import { PostgresOfferImageRepository } from "@/server/providers/postgres-offer-images";
import { PostgresOfferRepository } from "@/server/providers/postgres-offers";
import { OfferService } from "@/server/modules/offers/offer-service";
const db = new TestDatabase();
const location = {
  provider: "azure" as const,
  account: "syntheticnova",
  maximumBytes: 5242880,
};
const reports = new PostgresReportRepository(db, location);
const images = new PostgresOfferImageRepository(db, location);
const auth = testAuth(db);
beforeAll(async () => {
  await db.initialize();
}, 30000);
afterAll(() => db.close());
it("requires owner registration of the exact account, purpose, container and capacity", async () => {
  const context = await auth.requireAdmin();
  expect(await reports.storageReady(context, "client-reports")).toBe(false);
  await db.engine.query("select private.register_azure_storage($1,$2,$3,$4)", [
    location.account,
    "client-reports",
    "reports",
    5242880,
  ]);
  expect(await reports.storageReady(context, "client-reports")).toBe(true);
  expect(await images.storageReady(context, "client-reports")).toBe(false);
  expect(
    await new PostgresReportRepository(db, {
      ...location,
      account: "otheraccount",
    }).storageReady(context, "client-reports"),
  ).toBe(false);
  expect(
    await new PostgresReportRepository(db, {
      ...location,
      maximumBytes: 10485760,
    }).storageReady(context, "client-reports"),
  ).toBe(false);
  await expect(
    db.withIdentity(context.identity, (sql) =>
      sql.query("select private.register_azure_storage($1,$2,$3,$4)", [
        location.account,
        "offer-images",
        "offer_images",
        5242880,
      ]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    db.withIdentity(context.identity, (sql) =>
      sql.query("select * from private.azure_storage_locations"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("retains immutable report account ownership and rejects cross-account request replay", async () => {
  const context = await auth.requireAdmin();
  const metadata = {
    requestId: randomUUID(),
    title: "SYNTHETIC Azure report",
    fileName: "fixture.pdf",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    reportDate: "2026-02-01",
  };
  const reserve = (repo: PostgresReportRepository) =>
    repo.reserve(
      context,
      ids.a,
      metadata,
      "a".repeat(64),
      1024,
      1,
      "client-reports",
      "azure",
    );
  const report = await reserve(reports);
  expect(report.storageNamespace).toBe(location.account);
  expect((await reserve(reports)).id).toBe(report.id);
  await expect(
    reserve(
      new PostgresReportRepository(db, {
        ...location,
        account: "otheraccount",
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db.engine.query(
      "update client_reports set storage_namespace=$2 where id=$1",
      [report.id, "otheraccount"],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  expect(
    await reports.find(await testAuth(db, "b").requireUser(), report.id),
  ).toBeNull();
  expect(JSON.stringify(await reports.list(context, ids.a))).not.toContain(
    location.account,
  );
});
it("retains immutable offer image account ownership without exposing it in public metadata", async () => {
  const context = await auth.requireAdmin();
  const offer = await new OfferService(
    auth,
    new PostgresOfferRepository(db),
  ).save({
    requestId: randomUUID(),
    title: "SYNTHETIC Azure image",
    description: "Fixture",
    category: "member",
    eligibility: "Fixture",
    terms: "Fixture",
    status: "draft",
    startsAt: "2020-01-01T00:00:00Z",
    endsAt: "2090-01-01T00:00:00Z",
  });
  const input = {
    requestId: randomUUID(),
    expectedVersion: offer.version,
    alt: "Fixture",
  };
  const reserve = (repo: PostgresOfferImageRepository) =>
    repo.reserve(
      context,
      offer.id,
      input,
      "a".repeat(64),
      "b".repeat(64),
      { bytes: new Uint8Array(1024), width: 16, height: 8 },
      "offer-images",
      "azure",
    );
  const image = await reserve(images);
  expect(image.storageNamespace).toBe(location.account);
  expect((await reserve(images)).id).toBe(image.id);
  await expect(
    reserve(
      new PostgresOfferImageRepository(db, {
        ...location,
        account: "otheraccount",
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db.engine.query(
      "update offer_images set storage_namespace=$2 where id=$1",
      [image.id, "otheraccount"],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  const published = await images.activate(context, image.id);
  expect(JSON.stringify(published)).not.toContain(location.account);
});
