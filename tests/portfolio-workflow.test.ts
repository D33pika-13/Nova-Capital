import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { PortfolioService } from "@/server/modules/portfolio/portfolio-service";
import { PostgresPortfolioRepository } from "@/server/providers/postgres-portfolio";
import { FinancialCalculator } from "@/server/modules/portfolio/financial-calculator";
let db: TestDatabase;
let service: PortfolioService;
const date = "2026-01-10T12:00:00.000Z";
const holding = () => ({
  requestId: randomUUID(),
  clientId: ids.a,
  assetClass: "stocks",
  description: "Synthetic holding",
  currency: "INR",
  investedAmount: "100.1001",
  reportedValue: "110.2002",
  reportedAt: date,
});
const snap = () => ({
  requestId: randomUUID(),
  clientId: ids.a,
  currency: "INR",
  adjustedBasis: "100.1001",
  reportedValue: "110.2002",
  basisExplanation: "Synthetic adjusted basis, no other cash flows",
  reportedAt: date,
});
beforeAll(async () => {
  db = new TestDatabase();
  await db.initialize();
  service = new PortfolioService(
    testAuth(db),
    new PostgresPortfolioRepository(db),
    new FinancialCalculator(),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("financial writes and client reporting", () => {
  it("stores exact decimals and deduplicates repeated submissions", async () => {
    const input = holding();
    const first = await service.createInvestment(input);
    expect(first.investedAmount).toBe("100.1001");
    expect(await service.createInvestment(input)).toEqual(first);
    const rows = await db.engine.query(
      "select * from investments where id=$1",
      [first.id],
    );
    expect(rows.rows).toHaveLength(1);
  });
  it("preserves revisions and prevents stale edits and wrong-client edits", async () => {
    const first = await service.createInvestment(holding());
    const input = {
      requestId: randomUUID(),
      expectedVersion: first.version,
      assetClass: "stocks",
      description: "Corrected synthetic holding",
      investedAmount: "100.1001",
      reportedValue: "120.3003",
      reportedAt: date,
      correctionReason: "Corrected reported valuation",
    };
    const second = await service.editInvestment(ids.a, first.id, input);
    expect(second.version).toBe(2);
    expect(await service.editInvestment(ids.a, first.id, input)).toEqual(
      second,
    );
    await expect(
      service.editInvestment(ids.a, first.id, {
        ...input,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.editInvestment(ids.b, first.id, {
        ...input,
        requestId: randomUUID(),
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const revisions = (
      await db.engine.query(
        "select * from investment_revisions where investment_id=$1 order by version",
        [first.id],
      )
    ).rows;
    expect(revisions).toHaveLength(2);
  });
  it("archives without deleting financial history", async () => {
    const first = await service.createInvestment(holding());
    const archived = await service.archiveInvestment(ids.a, first.id, {
      requestId: randomUUID(),
      expectedVersion: 1,
      reason: "Closed synthetic position",
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(
      (
        await db.engine.query(
          "select * from investment_revisions where investment_id=$1",
          [first.id],
        )
      ).rows,
    ).toHaveLength(2);
    await expect(
      service.editInvestment(ids.a, first.id, {
        requestId: randomUUID(),
        expectedVersion: 2,
        assetClass: "stocks",
        description: "Not allowed",
        investedAmount: "1",
        reportedValue: "1",
        reportedAt: date,
        correctionReason: "Try archived edit",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("appends a snapshot, preserves its correction chain and rejects duplicate original dates", async () => {
    const input = snap();
    const original = await service.appendSnapshot(input);
    expect(await service.appendSnapshot(input)).toEqual(original);
    await expect(
      service.appendSnapshot({ ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const correction = await service.appendSnapshot({
      ...input,
      requestId: randomUUID(),
      reportedValue: "130.3003",
      correctionOf: original.id,
      correctionReason: "Corrected source valuation",
    });
    expect(correction.correctionOf).toBe(original.id);
    const overview = await service.adminOverview(ids.a);
    expect(
      overview.snapshots.find((s) => s.id === original.id)?.superseded,
    ).toBe(true);
    expect(overview.summaries[0].reportedValue).toBe("130.3003");
    expect(overview.summaries[0].profitLoss).toBe("30.2002");
  });
  it("rejects cross-client corrections and changed correction dates", async () => {
    const overview = await service.adminOverview(ids.a);
    const current = overview.snapshots.find((s) => !s.superseded)!;
    await expect(
      service.appendSnapshot({
        ...snap(),
        clientId: ids.b,
        correctionOf: current.id,
        correctionReason: "Wrong client",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.appendSnapshot({
        ...snap(),
        reportedAt: "2026-01-11T12:00:00.000Z",
        correctionOf: current.id,
        correctionReason: "Changed date",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("never combines currencies or invents a basis", async () => {
    await service.createInvestment({
      ...holding(),
      currency: "USD",
      investedAmount: "5",
      reportedValue: "6",
    });
    await service.appendSnapshot({
      ...snap(),
      currency: "USD",
      adjustedBasis: null,
      reportedValue: "6",
    });
    const view = await service.adminOverview(ids.a);
    expect(view.holdingTotals.map((t) => t.currency).sort()).toEqual([
      "INR",
      "USD",
    ]);
    expect(view.summaries.find((s) => s.currency === "USD")).toMatchObject({
      profitLoss: null,
      returnPercent: null,
      adjustedBasis: null,
    });
  });
  it("client sees only their records with no admin-only data", async () => {
    const own = new PortfolioService(
      testAuth(db, "a"),
      new PostgresPortfolioRepository(db),
      new FinancialCalculator(),
    );
    const other = new PortfolioService(
      testAuth(db, "b"),
      new PostgresPortfolioRepository(db),
      new FinancialCalculator(),
    );
    const aView = await own.clientOverview();
    expect(aView.investments.length).toBeGreaterThan(0);
    expect((await other.clientOverview()).investments).toEqual([]);
    await expect(own.adminOverview(ids.b)).rejects.toMatchObject({
      status: 403,
    });
    await expect(own.createInvestment(holding())).rejects.toMatchObject({
      status: 403,
    });
    expect(JSON.stringify(aView)).not.toContain("admin_notes");
  });
  it("rejects excessive precision, numbers, future dates, invalid currency and client identity spoofing", async () => {
    for (const invalid of [
      { investedAmount: 1 },
      { investedAmount: "0.00001" },
      { investedAmount: "-1" },
      { currency: "ZZZ" },
      { reportedAt: "2099-01-01T00:00:00Z" },
      { createdBy: ids.b },
    ])
      await expect(
        service.createInvestment({ ...holding(), ...invalid }),
      ).rejects.toMatchObject({ status: 422 });
  });
  it("rejects writes associated with an administrator instead of a client", async () => {
    await expect(
      service.createInvestment({ ...holding(), clientId: ids.admin }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("creates audit/history atomically and rolls back the submission marker on failure", async () => {
    const requestId = randomUUID();
    await expect(
      service.createInvestment({
        ...holding(),
        requestId,
        clientId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await db.engine.query(
          "select * from write_requests where request_id=$1",
          [requestId],
        )
      ).rows,
    ).toHaveLength(0);
    const row = await service.createInvestment({ ...holding(), requestId });
    expect(
      (
        await db.engine.query(
          "select * from audit_logs where entity_id=$1 and actor_id=$2",
          [row.id, ids.admin],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
describe("additional supported asset classes", () => {
  it.each(["commodities", "crypto"] as const)(
    "records %s through the service and PostgreSQL policies",
    async (assetClass) => {
      const row = await service.createInvestment({ ...holding(), assetClass });
      expect(row.assetClass).toBe(assetClass);
      expect(
        (await service.adminOverview(ids.a)).allocation.some(
          (group) => group.assetClass === assetClass,
        ),
      ).toBe(true);
    },
  );
});

describe("exact financial calculations", () => {
  it("handles fractional cents, zero basis and large precise amounts", () => {
    const c = new FinancialCalculator();
    expect(c.returns("0", "100")).toEqual({
      profitLoss: "-100.0000",
      returnPercent: "-100.0000",
    });
    expect(c.returns("0.3003", "0.1001")).toEqual({
      profitLoss: "0.2002",
      returnPercent: "200.0000",
    });
    expect(c.returns("1", "0")).toEqual({
      profitLoss: "1.0000",
      returnPercent: null,
    });
    expect(
      c.returns("9999999999999999.9999", "9999999999999999.9998").profitLoss,
    ).toBe("0.0001");
  });
});
