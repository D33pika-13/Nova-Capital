import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const admin = "10000000-0000-4000-8000-000000000001";
const a = "10000000-0000-4000-8000-000000000002";
const b = "10000000-0000-4000-8000-000000000003";
let db: PGlite;
async function asUser<T>(
  subject: string,
  assurance: string,
  action: () => Promise<T>,
): Promise<T> {
  await db.exec("begin; set local role nova_app;");
  try {
    await db.query(
      "select set_config('app.provider','supabase',true),set_config('app.subject',$1,true),set_config('app.assurance',$2,true)",
      [subject, assurance],
    );
    return await action();
  } finally {
    await db.exec("rollback");
  }
}
beforeAll(async () => {
  db = new PGlite();
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  for (const id of [a, b])
    await db.query(
      "insert into investments(client_id,asset_class,description,currency,invested_amount,reported_value,reported_at,created_by) values($1,'stocks','DEMO fixture','INR',100,110,now(),$2)",
      [id, admin],
    );
  await db.query(
    "insert into admin_notes(client_id,note,created_by) values($1,'Private admin fixture',$2)",
    [a, admin],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("real local PostgreSQL schema and row security", () => {
  it("denies private data without an authenticated context", async () => {
    const result = await asUser("", "", () =>
      db.query("select * from investments"),
    );
    expect(result.rows).toHaveLength(0);
  });
  it("client A sees only A's records", async () => {
    const result = await asUser("synthetic-a", "aal1", () =>
      db.query<{ client_id: string }>("select client_id from investments"),
    );
    expect(result.rows).toEqual([{ client_id: a }]);
  });
  it("client B cannot select A by a forged record filter", async () => {
    const result = await asUser("synthetic-b", "aal1", () =>
      db.query("select * from investments where client_id=$1", [a]),
    );
    expect(result.rows).toHaveLength(0);
  });
  it("clients cannot write financial records", async () => {
    await expect(
      asUser("synthetic-a", "aal1", () =>
        db.query(
          "insert into investments(client_id,asset_class,description,currency,invested_amount,reported_value,reported_at,created_by) values($1,'stocks','Forged','INR',1,1,now(),$1)",
          [a],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("clients cannot promote themselves", async () => {
    await expect(
      asUser("synthetic-a", "aal1", () =>
        db.query("update profiles set role='admin' where id=$1 returning id", [
          a,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("MFA-less admins cannot view other client records", async () => {
    const result = await asUser("synthetic-admin", "aal1", () =>
      db.query("select * from investments"),
    );
    expect(result.rows).toHaveLength(0);
  });
  it("active MFA admins can view client records", async () => {
    const result = await asUser("synthetic-admin", "aal2", () =>
      db.query("select * from investments"),
    );
    expect(result.rows).toHaveLength(2);
  });
  it("admin notes are hidden from clients", async () => {
    const result = await asUser("synthetic-a", "aal1", () =>
      db.query("select * from admin_notes"),
    );
    expect(result.rows).toHaveLength(0);
  });
  it("suspension removes database access on subsequent requests", async () => {
    await db.query("update profiles set status='suspended' where id=$1", [a]);
    try {
      expect(
        (
          await asUser("synthetic-a", "aal1", () =>
            db.query("select * from investments"),
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await db.query("update profiles set status='active' where id=$1", [a]);
    }
  });
  it("financial inserts create audit evidence atomically", async () => {
    await asUser("synthetic-admin", "aal2", async () => {
      const record = await db.query<{ id: string }>(
        "insert into investments(client_id,asset_class,description,currency,invested_amount,reported_value,reported_at,created_by) values($1,'forex','DEMO audit fixture','USD',1.0001,2.0002,now(),$2) returning id",
        [a, admin],
      );
      const audit = await db.query<{ actor_id: string }>(
        "select actor_id from audit_logs where entity_id=$1 and action='INSERT'",
        [record.rows[0].id],
      );
      expect(audit.rows).toEqual([{ actor_id: admin }]);
    });
  });
  it("forbids destructive deletion of financial records", async () => {
    await expect(
      asUser("synthetic-admin", "aal2", () =>
        db.query("delete from investments"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects duplicate client IDs", async () => {
    await expect(
      db.query(
        "insert into profiles(client_id,display_name,email) values('INV-1001','Duplicate','duplicate@example.test')",
      ),
    ).rejects.toThrow(/unique/);
  });
  it("rejects negative money", async () => {
    await expect(
      db.query(
        "insert into investments(client_id,asset_class,description,currency,invested_amount,reported_value,reported_at,created_by) values($1,'stocks','Invalid','INR',-1,1,now(),$2)",
        [a, admin],
      ),
    ).rejects.toThrow(/check constraint/);
  });
  it("shared limiter enforces counts without exposing its table", async () => {
    await asUser("", "", async () => {
      const key = "a".repeat(64);
      for (let i = 0; i < 3; i++) {
        const result = await db.query<{ allowed: boolean }>(
          "select private.consume_rate_limit($1,2,60) as allowed",
          [key],
        );
        expect(result.rows[0].allowed).toBe(i < 2);
      }
      await expect(
        db.query("select * from private.rate_limits"),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("clients cannot attach messages to another client's session", async () => {
    const session = await db.query<{ id: string }>(
      "insert into chat_sessions(client_id) values($1) returning id",
      [b],
    );
    await expect(
      asUser("synthetic-a", "aal1", () =>
        db.query(
          "insert into chat_messages(session_id,client_id,role,content) values($1,$2,'user','Forged session')",
          [session.rows[0].id, a],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("rejects numeric NaN and non-finite/future reporting timestamps at the database boundary", async () => {
    for (const [value, date] of [
      ["NaN", "2026-01-01T00:00:00Z"],
      ["1", "-infinity"],
      ["1", "2099-01-01T00:00:00Z"],
    ])
      await expect(
        db.query(
          "insert into investments(client_id,asset_class,description,currency,invested_amount,reported_value,reported_at,created_by) values($1,'stocks','Invalid finite fixture','USD',1,$2,$3,$4)",
          [a, value, date, admin],
        ),
      ).rejects.toThrow(/check constraint/);
  });
  it("advances client concurrency tokens for rapid same-transaction updates", async () => {
    await asUser("synthetic-admin", "aal2", async () => {
      const first = (
        await db.query<{ updated_at: string }>(
          "update profiles set display_name='Rapid first' where id=$1 returning updated_at::text",
          [a],
        )
      ).rows[0].updated_at;
      const second = (
        await db.query<{ updated_at: string }>(
          "update profiles set display_name='Rapid second' where id=$1 returning updated_at::text",
          [a],
        )
      ).rows[0].updated_at;
      expect(second).not.toBe(first);
    });
  });
});
