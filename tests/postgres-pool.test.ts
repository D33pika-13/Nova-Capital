import { it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { DatabaseConnectionSettings } from "@/server/database-settings";
import { PostgresPoolFactory } from "@/server/providers/postgres-pool";
import { PostgresDatabase } from "@/server/providers/postgres-database";
const identity = {
  provider: "supabase",
  subject: "synthetic-a",
  assurance: "aal1",
} as const;
function fixture(failAt?: string, unsafe = false) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql === failAt) throw new Error("synthetic transport failure");
    return {
      rows: sql.startsWith("select rolname")
        ? [
            {
              rolname: unsafe ? "postgres" : "nova_app",
              rolsuper: unsafe,
              rolbypassrls: unsafe,
            },
          ]
        : [],
    };
  });
  const db = new PostgresDatabase({
    connect: async () => ({ query, release }),
  } as unknown as Pool);
  return { db, query, release };
}
it("evicts a connection whose rollback fails while preserving the original application error", async () => {
  const f = fixture("rollback");
  const original = new Error("synthetic application failure");
  await expect(
    f.db.withIdentity(identity, async () => {
      throw original;
    }),
  ).rejects.toBe(original);
  expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
});
it("evicts unsafe-role, begin-failure and uncertain-commit connections", async () => {
  for (const f of [
    fixture(undefined, true),
    fixture("begin"),
    fixture("commit"),
  ]) {
    await expect(
      f.db.withIdentity(identity, async () => "value"),
    ).rejects.toThrow();
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  }
});
it("reuses a connection only after confirmed commit or successful rollback", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    const result = f.db.withIdentity(identity, async () => {
      if (fail) throw new Error("synthetic abort");
      return "value";
    });
    if (fail) await expect(result).rejects.toThrow("synthetic abort");
    else expect(await result).toBe("value");
    expect(f.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.query).toHaveBeenLastCalledWith(fail ? "rollback" : "commit");
  }
});
it("handles idle pool errors using fixed telemetry fields without forwarding provider payloads", async () => {
  const event = vi.fn();
  const pool = new PostgresPoolFactory(
    new DatabaseConnectionSettings({
      url: "postgresql://nova_app:synthetic-secret@localhost/postgres",
      environment: "test",
      tlsMode: "verify_full",
    }),
    { event },
  ).create();
  try {
    pool.emit("error", new Error("synthetic private provider detail"));
    expect(event).toHaveBeenCalledExactlyOnceWith("database.pool_error", {
      provider: "postgres",
      status: "unavailable",
    });
  } finally {
    await pool.end();
  }
});
