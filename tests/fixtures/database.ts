import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import type { Database, SqlClient } from "@/server/database";
import type {
  VerifiedIdentity,
  Profile,
  IdentityProvider,
} from "@/server/contracts";
import { AuthorizationService } from "@/server/modules/identity/authorization-service";
export const ids = {
  admin: "10000000-0000-4000-8000-000000000001",
  a: "10000000-0000-4000-8000-000000000002",
  b: "10000000-0000-4000-8000-000000000003",
};
export class TestDatabase implements Database {
  readonly engine = new PGlite();
  async initialize(storageFixture = false) {
    if (storageFixture)
      await this.engine.exec(
        await readFile("tests/fixtures/storage-schema.sql", "utf8"),
      );
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await this.engine.exec(
        await readFile(`supabase/migrations/${file}`, "utf8"),
      );
    await this.engine.exec(await readFile("supabase/seed.sql", "utf8"));
  }
  async withIdentity<T>(
    identity: VerifiedIdentity | null,
    work: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    await this.engine.exec("begin;set local role nova_app;");
    try {
      await this.engine.query(
        "select set_config('app.provider',$1,true),set_config('app.subject',$2,true),set_config('app.assurance',$3,true)",
        [
          identity?.provider ?? "",
          identity?.subject ?? "",
          identity?.assurance ?? "",
        ],
      );
      const sql: SqlClient = {
        query: async <T extends object>(text: string, values?: unknown[]) =>
          this.engine.query<T>(text, values),
      };
      const result = await work(sql);
      await this.engine.exec("commit");
      return result;
    } catch (error) {
      await this.engine.exec("rollback");
      throw error;
    }
  }
  async close() {
    await this.engine.close();
  }
}
export function testAuth(
  db: Database,
  who: "admin" | "a" | "b" = "admin",
  assurance: "aal1" | "aal2" = "aal2",
) {
  return testAuthSubject(db, `synthetic-${who}`, assurance);
}
export function testAuthSubject(
  db: Database,
  subject: string,
  assurance: "aal1" | "aal2" = "aal1",
) {
  const identity: IdentityProvider = {
    verify: async () => ({ provider: "supabase", subject, assurance }),
    signIn: async () => {},
    signOut: async () => {},
    requestReset: async () => {},
    setPassword: async () => {},
  };
  return new AuthorizationService(identity, {
    findByIdentity: async (verified) =>
      db.withIdentity(verified, async (client) => {
        const row = (
          await client.query<{
            id: string;
            client_id: string | null;
            display_name: string;
            role: "admin" | "client";
            status: "active" | "suspended" | "deactivated";
          }>(
            "select p.* from profiles p join provider_identities i on p.id=i.profile_id where i.subject=$1",
            [verified.subject],
          )
        ).rows[0];
        return row
          ? ({
              id: row.id,
              externalSubject: verified.subject,
              clientId: row.client_id,
              displayName: row.display_name,
              role: row.role,
              status: row.status,
            } satisfies Profile)
          : null;
      }),
  });
}
