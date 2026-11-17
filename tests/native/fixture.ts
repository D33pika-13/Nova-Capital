import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { Database } from "@/server/database";
import { DatabaseConnectionSettings } from "@/server/database-settings";
import { PostgresDatabase } from "@/server/providers/postgres-database";
import assert from "node:assert/strict";
export class NativeFixture {
  owner!: Pool;
  pool!: Pool;
  database!: Database;
  ca = "";
  port = 0;
  password = "";
  async initialize() {
    const file = process.env.NOVA_NATIVE_TEST_FIXTURE;
    assert.ok(
      file && path.basename(path.dirname(file)).startsWith("nova-native-db-"),
      "Use the owned native runner",
    );
    const fixture = JSON.parse(await readFile(file, "utf8"));
    assert.match(fixture.marker, /^nova_native_[a-f0-9]{24}$/);
    assert.ok(
      Number.isInteger(fixture.port) &&
        fixture.port > 0 &&
        fixture.port <= 65535,
    );
    assert.match(fixture.ownerPassword, /^[a-f0-9]{48}$/);
    assert.match(fixture.runtimePassword, /^[a-f0-9]{48}$/);
    assert.equal(
      path.resolve(fixture.caFile),
      path.join(path.dirname(path.resolve(file)), "ca.crt"),
    );
    this.ca = await readFile(fixture.caFile, "utf8");
    this.port = fixture.port;
    this.password = fixture.runtimePassword;
    this.owner = new Pool(
      this.settings("nova_test_owner", fixture.ownerPassword),
    );
    assert.equal(
      (await this.owner.query("select current_setting('cluster_name') marker"))
        .rows[0].marker,
      fixture.marker,
      "Refusing an unowned database",
    );
    assert.equal(
      await realpath(
        (
          await this.owner.query(
            "select current_setting('data_directory') directory",
          )
        ).rows[0].directory,
      ),
      await realpath(path.join(path.dirname(file), "data")),
      "Refusing an unowned data directory",
    );
    for (const file of (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await this.owner.query(
        await readFile(`supabase/migrations/${file}`, "utf8"),
      );
    await this.owner.query(await readFile("supabase/seed.sql", "utf8"));
    assert.match(this.password, /^[a-f0-9]{48}$/);
    await this.owner.query(
      `alter role nova_app login password '${this.password}'`,
    );
    this.pool = new Pool({
      ...this.settings("nova_app", this.password),
      max: 1,
    });
    this.database = new PostgresDatabase(this.pool);
  }
  settings(
    user = "nova_app",
    password = this.password,
    host = "localhost",
    ca: string | undefined = this.ca,
  ) {
    return new DatabaseConnectionSettings({
      url: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${this.port}/postgres`,
      environment: "test",
      tlsMode: "verify_full",
      caCertificate: ca,
    }).poolConfig();
  }
  async close() {
    await this.pool?.end();
    await this.owner?.end();
  }
}
