import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { createServer } from "node:net";
import { ClamAvScanner } from "@/server/providers/clamav-scanner";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import type { PrivateStorage } from "@/server/contracts";
import { PostgresReportRepository } from "@/server/providers/postgres-reports";
import { ReportService } from "@/server/modules/reports/report-service";
import { WorkerPdfValidator } from "@/server/providers/pdf-validator";
let db: TestDatabase;
let pdf: Uint8Array;
class TestPrivateStorage implements PrivateStorage {
  readonly objects = new Map<string, Uint8Array>();
  verifyConfiguration = vi.fn(async () => {});
  putIfAbsent = vi.fn(async (path: string, bytes: Uint8Array) => {
    if (!this.objects.has(path)) this.objects.set(path, Uint8Array.from(bytes));
  });
  checksum = vi.fn(async (path: string) => {
    const bytes = this.objects.get(path);
    if (!bytes) throw new Error("Missing synthetic object");
    return createHash("sha256").update(bytes).digest("hex");
  });
  downloadUrl = vi.fn(
    async (path: string, seconds: number) =>
      `https://storage.example.test/${path}?expires=${seconds}`,
  );
  remove = vi.fn(async (path: string) => {
    this.objects.delete(path);
  });
}
const metadata = () => ({
  requestId: randomUUID(),
  title: "SYNTHETIC monthly report",
  fileName: "synthetic-report.pdf",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  reportDate: "2026-02-01",
});
const file = () => ({ mime: "application/pdf", bytes: pdf });
function fixture(
  who: "admin" | "a" | "b" = "admin",
  storage = new TestPrivateStorage(),
  scanner = { scan: vi.fn(async () => {}) },
  limits = { consume: vi.fn(async () => true) },
) {
  const repo = new PostgresReportRepository(db);
  return {
    storage,
    scanner,
    limits,
    repo,
    service: new ReportService(
      testAuth(db, who),
      repo,
      storage,
      scanner,
      new WorkerPdfValidator(100, 3000),
      limits,
      {
        bucket: "client-reports",
        provider: "supabase",
        maxBytes: 5242880,
        downloadTtl: 60,
      },
    ),
  };
}
beforeAll(async () => {
  db = new TestDatabase();
  await db.initialize(true);
  const doc = await PDFDocument.create();
  doc.addPage();
  pdf = await doc.save();
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("private report lifecycle with real metadata RLS", () => {
  it("scans, validates, verifies original bytes and publishes exactly one immutable report", async () => {
    const s = fixture();
    const input = metadata();
    const before = Uint8Array.from(pdf);
    const report = await s.service.upload(ids.a, input, file());
    expect(report.status).toBe("available");
    expect(report.pageCount).toBe(1);
    expect(report.publishedAt).not.toBeNull();
    expect(pdf).toEqual(before);
    expect(JSON.stringify(report)).not.toContain("storagePath");
    expect(JSON.stringify(report)).not.toContain("fileSha256");
    expect(await s.service.upload(ids.a, input, file())).toEqual(report);
    expect(s.storage.objects.size).toBe(1);
    expect(
      (
        await db.engine.query("select * from client_reports where id=$1", [
          report.id,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.engine.query(
          "select * from audit_logs where entity_id=$1 and action='UPDATE'",
          [report.id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("does not store rejected files or publish when scanning is unavailable", async () => {
    const s = fixture();
    s.scanner.scan.mockRejectedValueOnce(new Error("Unavailable test scanner"));
    await expect(s.service.upload(ids.a, metadata(), file())).rejects.toThrow();
    expect(s.storage.putIfAbsent).not.toHaveBeenCalled();
    const before = (
      await db.engine.query("select count(*)::int as count from client_reports")
    ).rows[0];
    await expect(
      s.service.upload(
        ids.a,
        { ...metadata(), fileName: "../../fake.pdf" },
        file(),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.service.upload(ids.a, metadata(), { mime: "text/plain", bytes: pdf }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.service.upload(ids.a, metadata(), {
        mime: "application/pdf",
        bytes: Buffer.alloc(6),
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      (
        await db.engine.query(
          "select count(*)::int as count from client_reports",
        )
      ).rows[0],
    ).toEqual(before);
  });
  it("keeps uncertain uploads quarantined and safely resumes a lost storage acknowledgement", async () => {
    const s = fixture();
    const input = metadata();
    s.storage.putIfAbsent.mockImplementationOnce(async (path, bytes) => {
      s.storage.objects.set(path, Uint8Array.from(bytes));
      throw new Error("Lost acknowledgement");
    });
    await expect(s.service.upload(ids.a, input, file())).rejects.toThrow();
    const pending = (await s.service.adminList(ids.a)).find(
      (r) => r.title === input.title && r.status === "quarantined",
    )!;
    expect(pending.downloadable).toBe(false);
    expect(
      (await fixture("a", s.storage).service.clientList()).some(
        (r) => r.id === pending.id,
      ),
    ).toBe(false);
    const resumed = await s.service.upload(ids.a, input, file());
    expect(resumed.status).toBe("available");
    expect(s.storage.objects.size).toBe(1);
  });
  it("does not allow altered files or metadata to reuse a committed request ID", async () => {
    const s = fixture();
    const input = metadata();
    await s.service.upload(ids.a, input, file());
    await expect(
      s.service.upload(ids.a, { ...input, title: "Different title" }, file()),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("archives corrupt unpublished objects before cleanup and never issues a download", async () => {
    const s = fixture();
    s.storage.checksum.mockResolvedValueOnce("0".repeat(64));
    await expect(
      s.service.upload(ids.a, metadata(), file()),
    ).rejects.toMatchObject({ code: "FILE_INTEGRITY" });
    expect(s.storage.remove).toHaveBeenCalledTimes(1);
    expect(s.storage.objects.size).toBe(0);
    const failed = (await s.service.adminList(ids.a)).find(
      (r) => r.status === "archived" && r.publishedAt === null,
    )!;
    expect(failed.downloadable).toBe(false);
    await expect(s.service.download(failed.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("isolates clients and rechecks status before issuing short-lived download links", async () => {
    const s = fixture();
    const report = await s.service.upload(ids.a, metadata(), file());
    const own = fixture("a", s.storage).service;
    expect(await own.download(report.id)).toContain("expires=60");
    await expect(
      fixture("b", s.storage).service.download(report.id),
    ).rejects.toMatchObject({ status: 404 });
    const context = await testAuth(db).requireAdmin();
    await db.withIdentity(context.identity, (c) =>
      c.query("update profiles set status='suspended' where id=$1", [ids.a]),
    );
    try {
      await expect(own.download(report.id)).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await db.withIdentity(context.identity, (c) =>
        c.query("update profiles set status='active' where id=$1", [ids.a]),
      );
    }
    const listed = await own.clientList();
    expect(
      listed.every((r) => r.clientId === ids.a && r.status === "available"),
    ).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("storagePath");
  });
  it("archives without deleting original bytes and denies new client download links", async () => {
    const s = fixture();
    const report = await s.service.upload(ids.a, metadata(), file());
    const input = { requestId: randomUUID(), expectedStatus: "available" };
    expect((await s.service.archive(report.id, input)).status).toBe("archived");
    expect((await s.service.archive(report.id, input)).status).toBe("archived");
    expect(s.storage.objects.size).toBe(1);
    await expect(
      fixture("a", s.storage).service.download(report.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(await s.service.download(report.id)).toContain("expires=60");
  });
  it("fails closed if stored content changes or bucket policy is unsafe", async () => {
    const s = fixture();
    const report = await s.service.upload(ids.a, metadata(), file());
    s.storage.checksum.mockResolvedValueOnce("f".repeat(64));
    await expect(
      fixture("a", s.storage).service.download(report.id),
    ).rejects.toMatchObject({ code: "FILE_INTEGRITY" });
    await db.engine.exec(
      "update storage.buckets set public=true where id='client-reports'",
    );
    try {
      await expect(
        s.service.upload(ids.a, metadata(), file()),
      ).rejects.toMatchObject({ code: "STORAGE_POLICY" });
    } finally {
      await db.engine.exec(
        "update storage.buckets set public=false where id='client-reports'",
      );
    }
  });
  it("requires admin MFA, correct client ownership and valid dates", async () => {
    await expect(
      fixture("a").service.upload(ids.a, metadata(), file()),
    ).rejects.toMatchObject({ status: 403 });
    const s = fixture();
    await expect(
      s.service.upload(ids.admin, metadata(), file()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      s.service.upload(
        ids.a,
        { ...metadata(), periodEnd: "2026-02-20" },
        file(),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.service.upload(
        ids.a,
        { ...metadata(), reportDate: "2099-01-01" },
        file(),
      ),
    ).rejects.toMatchObject({ status: 422 });
    s.limits.consume.mockResolvedValueOnce(false);
    await expect(
      s.service.upload(ids.a, metadata(), file()),
    ).rejects.toMatchObject({ status: 429 });
  });
  it("enforces upload byte limits before scanning and object storage", async () => {
    const s = fixture();
    const bytes = Buffer.alloc(5242881);
    bytes.write("%PDF-1.7");
    await expect(
      s.service.upload(ids.a, metadata(), { mime: "application/pdf", bytes }),
    ).rejects.toMatchObject({ status: 413 });
    expect(s.scanner.scan).not.toHaveBeenCalled();
  });
  it("canonicalizes a valid uppercase client UUID before constructing its private object key", async () => {
    const id = "abcdefab-1234-4abc-8abc-abcdefabcdef";
    await db.engine.query(
      "insert into profiles(id,client_id,display_name,email) values($1,'INV-9090','SYNTHETIC uppercase UUID','uppercase@example.test')",
      [id],
    );
    const s = fixture();
    const report = await s.service.upload(id.toUpperCase(), metadata(), file());
    expect(report.clientId).toBe(id);
    expect([...s.storage.objects.keys()][0]).toMatch(new RegExp(`^${id}/`));
  });
});

it("does not store or publish a report after an ambiguous real TCP scanner result", async () => {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", () =>
      socket.end("stream: OK\0stream: Synthetic.Test FOUND\0"),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const storage = new TestPrivateStorage();
  const input = metadata();
  const service = new ReportService(
    testAuth(db),
    new PostgresReportRepository(db),
    storage,
    new ClamAvScanner(
      "127.0.0.1",
      (server.address() as { port: number }).port,
      1000,
    ),
    new WorkerPdfValidator(100, 3000),
    { consume: async () => true },
    {
      bucket: "client-reports",
      provider: "supabase",
      maxBytes: 5242880,
      downloadTtl: 60,
    },
  );
  const before = (
    await db.engine.query<{ count: number }>(
      "select count(*)::int count from client_reports",
    )
  ).rows[0].count;
  try {
    await expect(service.upload(ids.a, input, file())).rejects.toMatchObject({
      code: "SCANNER_UNAVAILABLE",
      status: 503,
    });
    expect(storage.putIfAbsent).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(0);
    expect(
      (
        await db.engine.query<{ count: number }>(
          "select count(*)::int count from client_reports",
        )
      ).rows[0].count,
    ).toBe(before);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
