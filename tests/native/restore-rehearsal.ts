import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { generate } from "otplib";
import { NativeFixture } from "./fixture";
import { testAuthSubject } from "../fixtures/database";
import { PostgresDatabase } from "@/server/providers/postgres-database";
import { PostgresPortfolioRepository } from "@/server/providers/postgres-portfolio";
import { PortfolioService } from "@/server/modules/portfolio/portfolio-service";
import { FinancialCalculator } from "@/server/modules/portfolio/financial-calculator";
import { EntraSessionService } from "@/server/modules/identity/entra-session-service";
import { PostgresEntraSessions } from "@/server/providers/postgres-entra-sessions";
import { PostgresLoginTransactions } from "@/server/providers/postgres-login-transactions";
import { EntraMfaService } from "@/server/modules/identity/entra-mfa-service";
import { PostgresEntraMfa } from "@/server/providers/postgres-entra-mfa";
import {
  MfaSecretProtector,
  MfaAuthenticator,
  MfaRecoveryCodes,
} from "@/server/providers/mfa-crypto";
const execute = promisify(execFile);
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
type Manifest = {
  tables: Record<string, { count: number; digest: string }>;
  security: Record<string, string>;
  relations: object[];
  constraints: object[];
  sequences: string;
};
/** Fresh isolated target only. Never accepts a source/destination database URL. */
export class NativeRestoreRehearsal {
  constructor(private readonly fixture: NativeFixture) {}
  private async manifest(sql: PoolClient): Promise<Manifest> {
    const tables: Manifest["tables"] = {};
    const relations = (
      await sql.query<{ schema: string; name: string }>(
        "select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p') order by 1,2",
      )
    ).rows;
    for (const { schema, name } of relations) {
      const rows = (
        await sql.query<{ row: string }>(
          `select to_jsonb(t)::text row from ${identifier(schema)}.${identifier(name)} t order by 1`,
        )
      ).rows.map((value) => value.row);
      tables[`${schema}.${name}`] = {
        count: rows.length,
        digest: digest(JSON.stringify(rows)),
      };
    }
    const policies = (
      await sql.query(
        "select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private') order by 1,2,3",
      )
    ).rows;
    const relationsSecurity = (
      await sql.query(
        "select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,(select jsonb_agg(to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable) from aclexplode(coalesce(c.relacl,case when c.relkind='S' then acldefault('S',c.relowner) when c.relkind in ('r','p','v','m','f') then acldefault('r',c.relowner) end)) a) permissions,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') order by 1,2",
      )
    ).rows;
    const functions = (
      await sql.query(
        "select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.prosecdef,(select jsonb_agg(to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) permissions,p.proconfig::text,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1,2,3",
      )
    ).rows;
    const indexes = (
      await sql.query(
        "select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','private') order by 1,2,3",
      )
    ).rows;
    const constraints = (
      await sql.query(
        "select n.nspname,t.relname table_name,c.conrelid::regclass::text relation,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,c.connoinherit,c.conislocal,c.coninhcount,pg_get_constraintdef(c.oid) definition,case when c.contype='c' then pg_get_expr(c.conbin,c.conrelid) end expression from pg_constraint c join pg_namespace n on n.oid=c.connamespace left join pg_class t on t.oid=c.conrelid where n.nspname in ('public','private') order by n.nspname,t.relname,c.conname",
      )
    ).rows;
    for (const constraint of constraints) {
      if (constraint.contype !== "c") continue;
      // Reparse/plan trusted CHECK expressions without executing them. PostgreSQL
      // flattens associative AND groups on dump/restore; regex removal of
      // parentheses would wrongly hide boolean-precedence or arithmetic changes.
      const plan = (
        await sql.query(
          `explain (verbose,format json,costs off) select ${constraint.expression} from ${identifier(constraint.nspname)}.${identifier(constraint.table_name)} limit 0`,
        )
      ).rows[0]["QUERY PLAN"][0].Plan;
      assert.ok(Array.isArray(plan.Output) && plan.Output.length > 0);
      constraint.definition = JSON.stringify(plan.Output);
      delete constraint.expression;
    }
    const columns = (
      await sql.query(
        "select n.nspname,c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,a.attgenerated,a.attcollation::regcollation::text collation,pg_get_expr(d.adbin,d.adrelid) default_expression from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname in ('public','private') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by 1,2,3",
      )
    ).rows;
    const schemas = (
      await sql.query(
        "select nspname,(select jsonb_agg(to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable) from aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a) permissions,pg_get_userbyid(nspowner) owner from pg_namespace where nspname in ('public','private') order by 1",
      )
    ).rows;
    const sequences = (
      await sql.query(
        "select schemaname,sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value from pg_sequences where schemaname in ('public','private') order by 1,2",
      )
    ).rows;
    return {
      tables,
      relations: relationsSecurity,
      constraints,
      security: Object.fromEntries(
        Object.entries({
          policies,
          relationsSecurity,
          functions,
          indexes,
          constraints,
          columns,
          schemas,
        }).map(([name, value]) => [name, digest(JSON.stringify(value))]),
      ),
      sequences: digest(JSON.stringify(sequences)),
    };
  }
  async run() {
    const file = process.env.NOVA_NATIVE_TEST_FIXTURE!;
    const metadata = JSON.parse(await readFile(file, "utf8"));
    const root = path.dirname(await realpath(file));
    assert.ok(path.basename(root).startsWith("nova-native-db-"));
    assert.match(metadata.ownerPassword, /^[a-f0-9]{48}$/);
    assert.equal(
      (
        await this.fixture.owner.query(
          "select current_setting('cluster_name') marker",
        )
      ).rows[0].marker,
      metadata.marker,
    );
    assert.equal(
      await realpath(
        (await this.fixture.owner.query("show data_directory")).rows[0]
          .data_directory,
      ),
      await realpath(path.join(root, "data")),
    );
    const target = `nova_restore_${randomBytes(8).toString("hex")}`;
    const archive = path.join(root, "rehearsal.dump"),
      pass = path.join(root, "restore.pgpass");
    const a = randomUUID(),
      b = randomUUID(),
      admin = randomUUID(),
      subject = `restore-${randomUUID()}`;
    const subjects = {
      a: `${subject}-a`,
      b: `${subject}-b`,
      admin: `${subject}-admin`,
    };
    for (const [id, who, role] of [
      [a, "a", "client"],
      [b, "b", "client"],
      [admin, "admin", "admin"],
    ] as const) {
      await this.fixture.owner.query(
        "insert into profiles(id,client_id,display_name,email,role) values($1,case when $2='client' then 'INV-'||nextval('private.client_number') else null end,$3,$4,$2)",
        [id, role, `SYNTHETIC restore ${who}`, `${subjects[who]}@example.test`],
      );
      await this.fixture.owner.query(
        "insert into provider_identities(profile_id,provider,subject) values($1,'supabase',$2)",
        [id, subjects[who]],
      );
    }
    const financial = new PortfolioService(
      testAuthSubject(this.fixture.database, subjects.admin, "aal2"),
      new PostgresPortfolioRepository(this.fixture.database),
      new FinancialCalculator(),
    );
    const investment = await financial.createInvestment({
      requestId: randomUUID(),
      clientId: a,
      assetClass: "stocks",
      description: "SYNTHETIC recovery precision",
      currency: "INR",
      investedAmount: "123456789012345.6789",
      reportedValue: "123456789012346.7890",
      reportedAt: "2026-01-01T00:00:00Z",
    });
    const tenantId = randomUUID(),
      clientId = randomUUID();
    const realm = {
      tenantId,
      clientId,
      issuer: `https://restore.ciamlogin.com/${tenantId}/v2.0`,
      applicationOrigin: "https://restore.example.test",
    };
    const verified = {
      provider: "entra",
      subject: `${tenantId}:${randomUUID()}`,
      assurance: "aal1" as const,
    };
    await this.fixture.owner.query(
      "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2)",
      [admin, verified.subject],
    );
    const sessions = new EntraSessionService(
      new PostgresEntraSessions(this.fixture.database),
      realm,
    );
    const crypto = {
      protector: new MfaSecretProtector("restore", {
        restore: randomBytes(32).toString("base64url"),
      }),
      authenticator: new MfaAuthenticator("Restore"),
      recovery: new MfaRecoveryCodes(),
    };
    const mfa = new EntraMfaService(
      new PostgresEntraMfa(this.fixture.database),
      crypto,
      sessions.realmHash,
    );
    const primary = await sessions.issue(verified),
      setup = await mfa.prepare(primary.token);
    assert.ok(!setup.enrolled);
    const secret = new URL(setup.provisioningUri).searchParams.get("secret")!;
    const elevated = await mfa.verify(
      primary.token,
      await generate({ secret }),
    );
    assert.ok(elevated.recoveryCodes?.length);
    const login = {
      stateHash: randomBytes(32).toString("hex"),
      bindingHash: randomBytes(32).toString("hex"),
      configurationHash: randomBytes(32).toString("hex"),
      nonce: randomBytes(32).toString("base64url"),
      codeVerifier: randomBytes(32).toString("base64url"),
    };
    await new PostgresLoginTransactions(this.fixture.database).create(login);
    await writeFile(
      pass,
      `localhost:${this.fixture.port}:*:nova_test_owner:${metadata.ownerPassword}\n`,
      { mode: 0o600, flag: "wx" },
    );
    const env = {
      NODE_ENV: "test" as const,
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      PGPASSFILE: pass,
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: metadata.caFile,
      PGHOSTADDR: "127.0.0.1",
      PGCONNECT_TIMEOUT: "5",
    };
    const args = [
      "--host=localhost",
      `--port=${this.fixture.port}`,
      "--username=nova_test_owner",
      "--no-password",
    ];
    let targetOwner: Pool | undefined, runtime: Pool | undefined;
    const snapshot = await this.fixture.owner.connect();
    try {
      await snapshot.query("begin isolation level repeatable read read only");
      const snapshotId = (
        await snapshot.query("select pg_export_snapshot() id")
      ).rows[0].id;
      const expected = await this.manifest(snapshot);
      // Consume/revoke after the cut point: the archive must retain its exact
      // snapshot, and quarantine must prevent these old proofs reviving.
      const recovered = await mfa.verify(
        elevated.token,
        elevated.recoveryCodes[0],
        true,
      );
      await sessions.revoke(recovered.token, true);
      const dumped = await execute(
        path.join(metadata.clientBinary, "pg_dump"),
        [
          ...args,
          "--format=custom",
          "--compress=0",
          "--lock-wait-timeout=5s",
          `--snapshot=${snapshotId}`,
          `--file=${archive}`,
          "--dbname=postgres",
        ],
        { env, timeout: 30000, maxBuffer: 131072 },
      );
      assert.equal(dumped.stderr, "");
      await snapshot.query("commit");
      const bytes = await readFile(archive);
      assert.equal(bytes.subarray(0, 5).toString(), "PGDMP");
      const checksum = digest(bytes);
      await this.fixture.owner.query(
        `create database ${identifier(target)} template template0`,
      );
      await this.fixture.owner.query(
        `revoke connect on database ${identifier(target)} from public,nova_app`,
      );
      targetOwner = new Pool({
        ...this.fixture.settings("nova_test_owner", metadata.ownerPassword),
        database: target,
        max: 1,
      });
      runtime = new Pool({
        ...this.fixture.settings(),
        database: target,
        max: 1,
      });
      await assert.rejects(runtime.query("select 1"), { code: "42501" });
      assert.equal(
        (
          await targetOwner.query(
            "select current_database() name,current_setting('cluster_name') marker",
          )
        ).rows[0].marker,
        metadata.marker,
      );
      assert.equal(digest(await readFile(archive)), checksum);
      const damagedArchive = path.join(root, "damaged.dump");
      await writeFile(damagedArchive, bytes.subarray(0, 32), {
        mode: 0o600,
        flag: "wx",
      });
      const restoreArgs = [
        ...args,
        "--exit-on-error",
        "--single-transaction",
        `--dbname=${target}`,
      ];
      await assert.rejects(
        execute(
          path.join(metadata.clientBinary, "pg_restore"),
          [...restoreArgs, damagedArchive],
          { env, timeout: 30000, maxBuffer: 131072 },
        ),
        { code: 1 },
      );
      assert.equal(
        (
          await targetOwner.query(
            "select to_regclass('public.profiles') relation",
          )
        ).rows[0].relation,
        null,
      );
      // A DDL conflict must roll back the entire restore and preserve its target.
      await targetOwner.query(
        "create table public.profiles(sentinel text);insert into public.profiles values('synthetic-owned-sentinel')",
      );
      await assert.rejects(
        execute(
          path.join(metadata.clientBinary, "pg_restore"),
          [...restoreArgs, archive],
          { env, timeout: 30000, maxBuffer: 131072 },
        ),
        { code: 1 },
      );
      assert.deepEqual(
        (await targetOwner.query("select sentinel from public.profiles")).rows,
        [{ sentinel: "synthetic-owned-sentinel" }],
      );
      assert.equal(
        (await targetOwner.query("select to_regnamespace('private') schema"))
          .rows[0].schema,
        null,
      );
      await targetOwner.query("drop table public.profiles");
      const restored = await execute(
        path.join(metadata.clientBinary, "pg_restore"),
        [
          ...args,
          "--exit-on-error",
          "--single-transaction",
          `--dbname=${target}`,
          archive,
        ],
        { env, timeout: 30000, maxBuffer: 131072 },
      );
      assert.equal(restored.stderr, "");
      const targetConnection = await targetOwner.connect();
      try {
        const observed = await this.manifest(targetConnection);
        for (const [table, value] of Object.entries(expected.tables))
          assert.deepEqual(
            observed.tables[table],
            value,
            `Restore differs for ${table}`,
          );
        assert.deepEqual(
          Object.keys(observed.tables),
          Object.keys(expected.tables),
        );
        assert.equal(
          observed.sequences,
          expected.sequences,
          "Restored sequence values differ",
        );
        for (let index = 0; index < expected.relations.length; index++)
          assert.deepEqual(
            observed.relations[index],
            expected.relations[index],
            "Restored relation security differs",
          );
        for (let index = 0; index < expected.constraints.length; index++)
          assert.deepEqual(
            observed.constraints[index],
            expected.constraints[index],
            "Restored constraint differs",
          );
        assert.deepEqual(
          observed.security,
          expected.security,
          "Restored security definitions differ",
        );
      } finally {
        targetConnection.release();
      }
      assert.equal(
        (
          await targetOwner.query(
            "select count(*)::int count from private.entra_mfa_recovery where factor_id=$1 and consumed_at is null",
            [setup.factorId],
          )
        ).rows[0].count,
        10,
        "The restored cut point must contain the later-consumed recovery proof",
      );
      assert.equal(
        (
          await targetOwner.query(
            "select revoked_at is null and expires_at>clock_timestamp() active from private.entra_sessions where token_hash=$1",
            [digest(elevated.token)],
          )
        ).rows[0].active,
        true,
        "The restored cut point must contain the later-revoked session",
      );
      const quarantine = await readFile(
        "supabase/operations/post-restore-quarantine.sql",
        "utf8",
      );
      await assert.rejects(
        targetOwner.query(quarantine),
        /Explicit restore target/,
      );
      await targetOwner.query("rollback");
      for (const guard of [
        {
          target: `${target}_wrong`,
          environment: "test",
          operation: randomUUID(),
          code: "P0001",
        },
        {
          target,
          environment: "unverified",
          operation: randomUUID(),
          code: "P0001",
        },
        {
          target,
          environment: "test",
          operation: "invalid-operation-id",
          code: "22P02",
        },
      ]) {
        await targetOwner.query(
          "select set_config('nova.restore_target',$1,false),set_config('nova.restore_environment',$2,false),set_config('nova.restore_operation',$3,false)",
          [guard.target, guard.environment, guard.operation],
        );
        await assert.rejects(targetOwner.query(quarantine), {
          code: guard.code,
        });
        await targetOwner.query("rollback");
      }
      const operation = randomUUID();
      await targetOwner.query(
        "select set_config('nova.restore_target',$1,false),set_config('nova.restore_operation',$2,false),set_config('nova.restore_environment','test',false)",
        [target, operation],
      );
      await targetOwner.query(quarantine);
      for (const [table, condition] of [
        ["entra_sessions", "revoked_at is null"],
        ["entra_login_transactions", "true"],
        ["entra_mfa_challenges", "true"],
        ["entra_mfa_recovery", "consumed_at is null"],
      ])
        assert.equal(
          (
            await targetOwner.query(
              `select count(*)::int count from private.${identifier(table)} where ${condition}`,
            )
          ).rows[0].count,
          0,
        );
      assert.equal(
        (
          await targetOwner.query(
            "select count(*)::int count from private.entra_mfa_factors where id=$1 and confirmed_at is not null",
            [setup.factorId],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await targetOwner.query(
            "select count(*)::int count from audit_logs where entity='restore' and action='AUTH_QUARANTINE' and entity_id=$1",
            [operation],
          )
        ).rows[0].count,
        1,
      );
      const quarantinedConnection = await targetOwner.connect();
      try {
        const quarantined = await this.manifest(quarantinedConnection);
        for (const [table, state] of Object.entries(expected.tables)) {
          if (table.startsWith("public.") && table !== "public.audit_logs")
            assert.deepEqual(
              quarantined.tables[table],
              state,
              `Quarantine changed business records in ${table}`,
            );
        }
        const oldAuditRows = (
          await quarantinedConnection.query<{ row: string }>(
            "select to_jsonb(t)::text row from public.audit_logs t where entity_id<>$1 order by 1",
            [operation],
          )
        ).rows.map((row) => row.row);
        assert.equal(
          digest(JSON.stringify(oldAuditRows)),
          expected.tables["public.audit_logs"].digest,
          "Quarantine changed prior audit history",
        );
      } finally {
        quarantinedConnection.release();
      }
      // Only this owned rehearsal target is reopened, after quarantine checks.
      await this.fixture.owner.query(
        `grant connect on database ${identifier(target)} to nova_app`,
      );
      const database = new PostgresDatabase(runtime);
      for (const [subject, expectedIds] of [
        [subjects.a, [a]],
        [subjects.b, [b]],
      ] as const) {
        const result = await database.withIdentity(
          { provider: "supabase", subject, assurance: "aal1" },
          (sql) => sql.query<{ id: string }>("select id from profiles"),
        );
        assert.deepEqual(
          result.rows.map((row) => row.id),
          expectedIds,
        );
        const holdings = await database.withIdentity(
          { provider: "supabase", subject, assurance: "aal1" },
          (sql) => sql.query<{ id: string }>("select id from investments"),
        );
        assert.deepEqual(
          holdings.rows.map((row) => row.id),
          subject === subjects.a ? [investment.id] : [],
        );
      }
      assert.deepEqual(
        (
          await database.withIdentity(null, (sql) =>
            sql.query("select id from profiles"),
          )
        ).rows,
        [],
      );
      const { MaintenanceService } =
        await import("@/server/modules/offers/maintenance-service");
      const { PostgresMaintenanceRepository } =
        await import("@/server/providers/postgres-maintenance");
      const maintenance = new MaintenanceService(
        testAuthSubject(database, subjects.admin, "aal2"),
        new PostgresMaintenanceRepository(database),
        { provider: "external", environment: "test" },
      );
      assert.equal(
        (await maintenance.status()).state,
        "never",
        "Restored scheduler history must not establish post-recovery freshness",
      );
      const values = await database.withIdentity(
        { provider: "supabase", subject: subjects.a, assurance: "aal1" },
        (sql) =>
          sql.query(
            "select invested_amount::text,reported_value::text from investments where id=$1",
            [investment.id],
          ),
      );
      assert.deepEqual(values.rows, [
        {
          invested_amount: "123456789012345.6789",
          reported_value: "123456789012346.7890",
        },
      ]);
      await assert.rejects(
        runtime.query("select * from private.entra_sessions"),
        { code: "42501" },
      );
      await assert.rejects(runtime.query("delete from audit_logs"), {
        code: "42501",
      });
      const restoredSessions = new EntraSessionService(
        new PostgresEntraSessions(database),
        realm,
      );
      assert.equal(await restoredSessions.verify(elevated.token), null);
      const fresh = await restoredSessions.issue(verified);
      const restoredMfa = new EntraMfaService(
        new PostgresEntraMfa(database),
        crypto,
        restoredSessions.realmHash,
      );
      await assert.rejects(
        restoredMfa.verify(fresh.token, elevated.recoveryCodes[0], true),
      );
      await runtime.query(
        "select set_config('nova.restore_target',$1,false),set_config('nova.restore_operation',$2,false),set_config('nova.restore_environment','test',false)",
        [target, randomUUID()],
      );
      await assert.rejects(runtime.query(quarantine), { code: "42501" });
      await runtime.query("rollback");
    } finally {
      await snapshot.query("rollback").catch(() => {});
      snapshot.release();
      await runtime?.end();
      await targetOwner?.end();
      await rm(pass, { force: true });
      // The runner removes this entire owned cluster, including the target/archive.
    }
  }
}
