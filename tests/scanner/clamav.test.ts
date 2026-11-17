import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import policy from "../../infra/scanner/policy.json";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { ClamAvScanner } from "@/server/providers/clamav-scanner";
import { WorkerPdfValidator } from "@/server/providers/pdf-validator";
import { PostgresReportRepository } from "@/server/providers/postgres-reports";
import { ReportService } from "@/server/modules/reports/report-service";
import type { PrivateStorage } from "@/server/contracts";
import { TestDatabase, testAuth, ids } from "../fixtures/database";
const db = new TestDatabase();
let scanner: ClamAvScanner,
  cleanPdf: Uint8Array,
  detectedPdf: Uint8Array,
  cleanPng: Uint8Array;
// The industry-standard harmless antivirus test string; never real malware.
const eicar = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "ascii",
);
beforeAll(async () => {
  const file = process.env.NOVA_SCANNER_TEST_FIXTURE;
  assert.ok(
    file &&
      path.basename(path.dirname(file)).startsWith("nova-native-scanner-"),
    "Use the owned scanner runner",
  );
  const fixture = JSON.parse(await readFile(file, "utf8"));
  assert.match(fixture.marker, /^[a-f0-9]{48}$/);
  assert.equal(
    await readFile(path.join(path.dirname(file), "marker"), "utf8"),
    fixture.marker,
  );
  assert.equal((await stat(path.dirname(file))).uid, process.getuid?.());
  assert.equal(fixture.host, "127.0.0.1");
  assert.ok(
    Number.isInteger(fixture.port) && fixture.port > 0 && fixture.port <= 65535,
  );
  assert.ok(Number.isInteger(fixture.pid) && fixture.pid > 0);
  process.kill(fixture.pid, 0);
  scanner = new ClamAvScanner(fixture.host, fixture.port, 30000);
  const document = await PDFDocument.create();
  document.addPage();
  cleanPdf = await document.save();
  const attached = await PDFDocument.create();
  attached.addPage();
  await attached.attach(eicar, "eicar-test.txt", { mimeType: "text/plain" });
  detectedPdf = await attached.save();
  cleanPng = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  await db.initialize(true);
});
afterAll(() => db.close());
it("accepts actual clean PDF and PNG streams with the real daemon response/EOF", async () => {
  await expect(scanner.scan(cleanPdf)).resolves.toBeUndefined();
  await expect(scanner.scan(cleanPng)).resolves.toBeUndefined();
});
it("detects harmless EICAR bytes and a PDF containing its attachment with safe errors", async () => {
  for (const bytes of [eicar, detectedPdf]) {
    await expect(scanner.scan(bytes)).rejects.toMatchObject({
      code: "MALWARE_DETECTED",
      status: 422,
      message: "The file failed malware scanning and was not published.",
    });
  }
});
it("rejects engine scan-size limits and transport stream-size limits instead of claiming clean", async () => {
  await expect(
    scanner.scan(
      Buffer.alloc(
        (Number.parseInt(policy.clamd.MaxFileSize, 10) + 1) * 1024 * 1024,
        65,
      ),
    ),
  ).rejects.toMatchObject({ code: "MALWARE_DETECTED", status: 422 });
  await expect(
    scanner.scan(
      Buffer.alloc(
        (Number.parseInt(policy.clamd.StreamMaxLength, 10) + 1) * 1024 * 1024,
        65,
      ),
    ),
  ).rejects.toMatchObject({ code: "SCANNER_UNAVAILABLE", status: 503 });
});
it("keeps concurrent clean and detected verdicts separate on dedicated stream connections", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      scanner.scan(index % 2 ? eicar : cleanPng),
    ),
  );
  for (const [index, result] of results.entries()) {
    if (index % 2)
      expect(result).toMatchObject({
        status: "rejected",
        reason: { code: "MALWARE_DETECTED", status: 422 },
      });
    else expect(result.status).toBe("fulfilled");
  }
});
class OwnedStorage implements PrivateStorage {
  readonly objects = new Map<string, Uint8Array>();
  verifyConfiguration = async () => {};
  putIfAbsent = vi.fn(async (key: string, bytes: Uint8Array) => {
    if (!this.objects.has(key)) this.objects.set(key, Uint8Array.from(bytes));
  });
  checksum = async (key: string) =>
    createHash("sha256").update(this.objects.get(key)!).digest("hex");
  downloadUrl = async () => {
    throw Error("No external download in scanner verification");
  };
  remove = async (key: string) => {
    this.objects.delete(key);
  };
}
it("publishes a scanned clean report and blocks a detected PDF before object or metadata creation", async () => {
  const storage = new OwnedStorage();
  const service = new ReportService(
    testAuth(db),
    new PostgresReportRepository(db),
    storage,
    scanner,
    new WorkerPdfValidator(100, 3000),
    { consume: async () => true },
    {
      bucket: "client-reports",
      provider: "supabase",
      maxBytes: 5242880,
      downloadTtl: 60,
    },
  );
  const metadata = () => ({
    requestId: randomUUID(),
    title: "SYNTHETIC engine test",
    fileName: "engine-test.pdf",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    reportDate: "2026-02-01",
  });
  const clean = await service.upload(ids.a, metadata(), {
    mime: "application/pdf",
    bytes: cleanPdf,
  });
  expect(clean.status).toBe("available");
  expect(storage.objects.size).toBe(1);
  expect(storage.putIfAbsent).toHaveBeenCalledOnce();
  const before = (
    await db.engine.query<{ count: number }>(
      "select count(*)::int count from client_reports",
    )
  ).rows[0].count;
  await expect(
    service.upload(ids.a, metadata(), {
      mime: "application/pdf",
      bytes: detectedPdf,
    }),
  ).rejects.toMatchObject({ code: "MALWARE_DETECTED", status: 422 });
  expect(storage.putIfAbsent).toHaveBeenCalledOnce();
  expect(
    (
      await db.engine.query<{ count: number }>(
        "select count(*)::int count from client_reports",
      )
    ).rows[0].count,
  ).toBe(before);
});
