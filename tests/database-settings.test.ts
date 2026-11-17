import { it, expect, vi } from "vitest";
import { Client } from "pg";
import { DatabaseConnectionSettings } from "@/server/database-settings";
const input = {
  url: "postgresql://nova_app:synthetic-password@db.example.test/postgres",
  environment: "staging" as const,
  tlsMode: "verify_full" as const,
};
it("constructs explicit verified driver options unaffected by PG environment SSL overrides", () => {
  vi.stubEnv("PGSSLMODE", "no-verify");
  vi.stubEnv("PGOPTIONS", "-c role=postgres");
  try {
    const options = new DatabaseConnectionSettings({
      ...input,
      url: input.url + "?sslmode=verify-full",
    }).poolConfig();
    expect(options).not.toHaveProperty("connectionString");
    expect(options.ssl).toMatchObject({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    const client = new Client(options) as Client & {
      connectionParameters: { ssl: object; options: string };
    };
    expect(client.connectionParameters.ssl).toMatchObject({
      rejectUnauthorized: true,
    });
    expect(client.connectionParameters.options).toBe("-c search_path=public");
    expect(options.enableChannelBinding).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});
it("rejects URL driver overrides, arbitrary protocols and malformed endpoints without exposing credentials", () => {
  for (const suffix of [
    "?sslmode=disable",
    "?sslmode=require",
    "?sslmode=verify-ca",
    "?ssl=no-verify",
    "?sslrootcert=/private/file",
    "?host=other.example.test",
    "?user=postgres",
    "?options=-c%20role=postgres",
    "?sslmode=verify-full&sslmode=disable",
    "#fragment",
  ])
    expect(
      () =>
        new DatabaseConnectionSettings({ ...input, url: input.url + suffix }),
    ).toThrow(/DATABASE_URL/);
  for (const url of [
    "https://nova_app:secret@db.example.test/postgres",
    "postgresql://nova_app@db.example.test/postgres",
    "postgresql://nova_app:secret@db.example.test/",
    "postgresql://nova_app:secret@%2Fvar%2Frun/postgres",
    "postgresql://nova_app:secret@localhost:0/postgres",
  ])
    expect(() => new DatabaseConnectionSettings({ ...input, url })).toThrow(
      /DATABASE_URL/,
    );
  try {
    new DatabaseConnectionSettings({
      ...input,
      url: input.url + "?ssl=no-verify",
    });
  } catch (error) {
    expect(String(error)).not.toContain("synthetic-password");
  }
});
it("permits plaintext only for explicit local development/test hosts", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "[::1]",
    "database",
    "host.docker.internal",
  ])
    expect(
      new DatabaseConnectionSettings({
        ...input,
        environment: "test",
        tlsMode: "disable",
        url: `postgresql://nova_app:synthetic@${host}/postgres?sslmode=disable`,
      }).poolConfig().ssl,
    ).toBe(false);
  for (const environment of ["staging", "production"] as const)
    expect(
      () =>
        new DatabaseConnectionSettings({
          ...input,
          environment,
          tlsMode: "disable",
        }),
    ).toThrow(/DATABASE_TLS_MODE/);
  expect(
    () =>
      new DatabaseConnectionSettings({
        ...input,
        environment: "development",
        tlsMode: "disable",
      }),
  ).toThrow(/DATABASE_TLS_MODE/);
  expect(
    () =>
      new DatabaseConnectionSettings({
        ...input,
        caCertificate: "not a certificate",
      }),
  ).toThrow(/DATABASE_CA_CERT/);
});
