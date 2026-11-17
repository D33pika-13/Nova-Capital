import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { TestDatabase, ids, testAuth } from "./fixtures/database";
import { PostgresWithdrawalRepository } from "@/server/providers/postgres-withdrawals";
import { WithdrawalService } from "@/server/modules/portfolio/withdrawal-service";
import { MutationStore } from "@/server/mutation-store";
let db: TestDatabase;
let repository: PostgresWithdrawalRepository;
let admin: WithdrawalService;
const input = () => ({
  requestId: randomUUID(),
  clientId: ids.a,
  currency: "USD",
  amount: "1234.5678",
  withdrawnAt: "2026-01-10T17:30:00+05:30",
  reference: "Synthetic broker withdrawal",
});
beforeAll(async () => {
  db = new TestDatabase();
  await db.initialize();
  repository = new PostgresWithdrawalRepository(db, new MutationStore(db));
  admin = new WithdrawalService(testAuth(db), repository);
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("records exact amounts and UTC dates, deduplicates retries and audits atomically", async () => {
  const data = input();
  const record = await admin.record(data);
  expect(record.amount).toBe("1234.5678");
  expect(record.withdrawnAt).toBe("2026-01-10T12:00:00.000Z");
  expect(await admin.record(data)).toEqual(record);
  const audit = await db.engine.query(
    "select actor_id from audit_logs where entity='withdrawals' and entity_id=$1",
    [record.id],
  );
  expect(audit.rows).toEqual([{ actor_id: ids.admin }]);
  await expect(admin.record({ ...data, amount: "2" })).rejects.toMatchObject({
    status: 409,
  });
});
it("isolates A/B reads and denies client, low-assurance admin, anonymous and suspended access", async () => {
  const record = await admin.record(input());
  const a = new WithdrawalService(testAuth(db, "a"), repository);
  const b = new WithdrawalService(testAuth(db, "b"), repository);
  expect((await a.clientList()).some((r) => r.id === record.id)).toBe(true);
  expect(await b.clientList()).toEqual([]);
  await expect(a.record(input())).rejects.toMatchObject({ status: 403 });
  await expect(
    new WithdrawalService(testAuth(db, "admin", "aal1"), repository).record(
      input(),
    ),
  ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  expect(
    await db.withIdentity(
      null,
      async (c) => (await c.query("select * from withdrawals")).rows,
    ),
  ).toEqual([]);
  await db.engine.query("update profiles set status='suspended' where id=$1", [
    ids.a,
  ]);
  await expect(a.clientList()).rejects.toMatchObject({ status: 403 });
  await db.engine.query("update profiles set status='active' where id=$1", [
    ids.a,
  ]);
});
it("retains correction history and forbids wrong-client/currency, duplicate and stale corrections", async () => {
  const original = await admin.record(input());
  await expect(
    admin.record({
      ...input(),
      clientId: ids.b,
      correctionOf: original.id,
      correctionReason: "Wrong owner",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    admin.record({
      ...input(),
      currency: "EUR",
      correctionOf: original.id,
      correctionReason: "Wrong currency",
    }),
  ).rejects.toMatchObject({ status: 409 });
  const corrected = await admin.record({
    ...input(),
    amount: "1500.0101",
    correctionOf: original.id,
    correctionReason: "Corrected broker amount",
  });
  const rows = await admin.adminList(ids.a);
  expect(rows.find((r) => r.id === original.id)?.superseded).toBe(true);
  expect(rows.find((r) => r.id === corrected.id)?.amount).toBe("1500.0101");
  await expect(
    admin.record({
      ...input(),
      correctionOf: original.id,
      correctionReason: "Stale",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db.withIdentity((await testAuth(db).requireAdmin()).identity, (c) =>
      c.query("delete from withdrawals where id=$1", [original.id]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("validates positive amounts, currencies, dates, identity spoofing and correction reasons", async () => {
  for (const invalid of [
    { amount: "0" },
    { amount: "-1" },
    { amount: "NaN" },
    { currency: "XXX" },
    { withdrawnAt: "2099-01-01T00:00:00Z" },
    { withdrawnAt: "2026-01-10T12:00:00.123456Z" },
    { correctionOf: randomUUID() },
    { role: "admin" },
  ]) {
    await expect(
      admin.record({ ...input(), ...invalid }),
    ).rejects.toMatchObject({ status: 422 });
  }
});
it("supports international amounts without adding different currencies", async () => {
  for (const currency of ["EUR", "AED", "JPY", "NZD", "SAR", "ZAR"])
    await admin.record({ ...input(), currency });
  const rows = await admin.adminList(ids.a);
  expect(new Set(rows.map((r) => r.currency))).toEqual(
    new Set(["USD", "EUR", "AED", "JPY", "NZD", "SAR", "ZAR"]),
  );
});
it("rolls back the withdrawal and retry ledger when audit recording fails", async () => {
  const data = input();
  await db.engine
    .exec(`create function private.test_withdrawal_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$;
    create trigger test_withdrawal_audit_failure before insert on public.audit_logs for each row when (new.entity='withdrawals') execute function private.test_withdrawal_audit_failure();`);
  try {
    await expect(admin.record(data)).rejects.toThrow("synthetic audit failure");
    expect(
      (
        await db.engine.query(
          "select * from write_requests where request_id=$1",
          [data.requestId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await db.engine.exec(
      "drop trigger test_withdrawal_audit_failure on public.audit_logs; drop function private.test_withdrawal_audit_failure();",
    );
  }
  expect((await admin.record(data)).amount).toBe("1234.5678");
});
