import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { NativeFixture } from "../native/fixture";
import { ids, testAuth } from "../fixtures/database";
import {
  PostgresDatabase,
  PostgresRateLimiter,
} from "@/server/providers/postgres-database";
import { PostgresPortfolioRepository } from "@/server/providers/postgres-portfolio";
import { PortfolioService } from "@/server/modules/portfolio/portfolio-service";
import { FinancialCalculator } from "@/server/modules/portfolio/financial-calculator";
const fixture = new NativeFixture();
beforeAll(() => fixture.initialize());
afterAll(() => fixture.close());
it("retains isolation, exact writes, audits and shared limits under bounded pooled contention", async () => {
  const pool = new Pool({ ...fixture.settings(), max: 4 });
  const database = new PostgresDatabase(pool);
  const repository = new PostgresPortfolioRepository(database);
  const calculator = new FinancialCalculator();
  const admin = new PortfolioService(
    testAuth(database),
    repository,
    calculator,
  );
  const clients = {
    a: new PortfolioService(testAuth(database, "a"), repository, calculator),
    b: new PortfolioService(testAuth(database, "b"), repository, calculator),
  };
  const limits = new PostgresRateLimiter(database);
  const samples: Record<string, number[]> = {
    duplicateWrite: [],
    snapshot: [],
    isolatedRead: [],
    sharedLimit: [],
  };
  const decisions: boolean[] = [];
  let peakConnections = 0,
    peakWaiting = 0;
  const observe = () => {
    peakConnections = Math.max(peakConnections, pool.totalCount);
    peakWaiting = Math.max(peakWaiting, pool.waitingCount);
  };
  const measure = async (kind: string, work: () => Promise<void>) => {
    const start = performance.now();
    try {
      const pending = work();
      observe();
      await pending;
    } finally {
      observe();
      samples[kind].push(performance.now() - start);
    }
  };
  const started = performance.now();
  const observation = setInterval(observe, 5);
  try {
    // Eight workers deliberately exceed the four-connection pool. All work is
    // generated here; neither targets nor load size come from environment input.
    const workers = await Promise.allSettled(
      Array.from({ length: 8 }, async (_, worker) => {
        const who = worker % 2 === 0 ? "a" : "b";
        for (let step = 0; step < 12; step++) {
          const kind = (worker + step) % 4;
          const input = {
            requestId: randomUUID(),
            clientId: ids[who],
            currency: "INR",
            reportedAt: new Date(
              Date.UTC(2025, 0, 1) + (worker * 12 + step) * 1000,
            ).toISOString(),
            reportedValue: "110.2002",
          };
          if (kind === 0)
            await measure("duplicateWrite", async () => {
              const value = {
                ...input,
                investedAmount: "100.1001",
                assetClass: "stocks",
                description: "SYNTHETIC bounded load holding",
              };
              const [first, replay] = await Promise.all([
                admin.createInvestment(value),
                admin.createInvestment(value),
              ]);
              expect(replay).toEqual(first);
            });
          if (kind === 1)
            await measure("snapshot", async () => {
              await admin.appendSnapshot({
                ...input,
                adjustedBasis: "100.1001",
                basisExplanation: "SYNTHETIC bounded load; no other cash flows",
              });
            });
          if (kind === 2)
            await measure("isolatedRead", async () => {
              const view = await clients[who].clientOverview();
              expect(
                [
                  ...view.investments,
                  ...view.snapshots,
                  ...view.revisions,
                ].every((row) => row.clientId === ids[who]),
              ).toBe(true);
              const other = who === "a" ? "b" : "a";
              const denied = await database.withIdentity(
                {
                  provider: "supabase",
                  subject: `synthetic-${who}`,
                  assurance: "aal1",
                },
                (sql) =>
                  sql.query(
                    "select id from investments where client_id=$1 union all select id from portfolio_snapshots where client_id=$1",
                    [ids[other]],
                  ),
              );
              expect(denied.rows).toEqual([]);
            });
          if (kind === 3)
            await measure("sharedLimit", async () => {
              decisions.push(
                await limits.consume("synthetic-owned-mixed-load", 7, 600),
              );
            });
        }
      }),
    );
    // Settle every worker before assertions/cleanup, even if one failed.
    expect(
      workers.every((worker) => worker.status === "fulfilled"),
      "Owned mixed workload worker failed",
    ).toBe(true);
    for (const values of Object.values(samples))
      expect(values).toHaveLength(24);
    expect(decisions.filter(Boolean)).toHaveLength(7);
    expect(decisions.filter((value) => !value)).toHaveLength(17);
    expect(peakConnections).toBe(4);
    expect(peakWaiting).toBeGreaterThan(0);
    for (const who of ["a", "b"] as const) {
      const view = await clients[who].clientOverview();
      expect(view.investments).toHaveLength(12);
      expect(view.snapshots).toHaveLength(12);
      expect(view.revisions).toHaveLength(12);
      expect(view.holdingTotals).toEqual([
        {
          currency: "INR",
          investedAmount: "1201.2012",
          reportedValue: "1322.4024",
        },
      ]);
      expect(view.summaries).toEqual([
        expect.objectContaining({
          currency: "INR",
          adjustedBasis: "100.1001",
          reportedValue: "110.2002",
          profitLoss: "10.1001",
        }),
      ]);
    }
    const audit = await fixture.owner.query(
      "select entity,entity_id,count(*)::int count from audit_logs where entity in ('investments','portfolio_snapshots') group by entity,entity_id",
    );
    expect(audit.rows).toHaveLength(48);
    expect(audit.rows.every((row) => row.count === 1)).toBe(true);
    expect(
      (
        await fixture.owner.query(
          "select count(*)::int count from write_requests where result is not null",
        )
      ).rows[0].count,
    ).toBe(48);
    expect(
      (
        await fixture.owner.query(
          "select count(*)::int count from write_requests where result is null",
        )
      ).rows[0].count,
    ).toBe(0);
    const acquired = await Promise.allSettled(
      Array.from({ length: 4 }, () => pool.connect()),
    );
    const connections = acquired.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    try {
      expect(connections).toHaveLength(4);
      const completed = await Promise.allSettled(
        connections.map((client) =>
          client.query(
            "select pg_backend_pid() pid,current_user role,current_setting('app.subject',true) subject,current_setting('app.assurance',true) assurance",
          ),
        ),
      );
      expect(completed.every((result) => result.status === "fulfilled")).toBe(
        true,
      );
      const states = completed.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.rows[0]] : [],
      );
      expect(new Set(states.map((row) => row.pid)).size).toBe(4);
      for (const row of states) {
        expect(row.role).toBe("nova_app");
        expect(row.subject ?? "").toBe("");
        expect(row.assurance ?? "").toBe("");
      }
    } finally {
      connections.forEach((client) => client.release());
    }
    const latency = Object.fromEntries(
      Object.entries(samples).map(([kind, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const percentile = (p: number) =>
          Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(2));
        return [
          kind,
          {
            count: values.length,
            p50Ms: percentile(0.5),
            p95Ms: percentile(0.95),
            maxMs: percentile(1),
          },
        ];
      }),
    );
    console.info(
      JSON.stringify({
        event: "native.load_result",
        workers: 8,
        operations: 96,
        poolMax: 4,
        peakConnections,
        peakWaiting,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
        latency,
        expectedLimitDenials: 17,
      }),
    );
  } finally {
    clearInterval(observation);
    await pool.end();
  }
});
