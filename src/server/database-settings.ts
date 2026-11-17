import "server-only";
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import type { PoolConfig } from "pg";
import { ConfigurationError } from "./errors";
export interface DatabaseConnectionInput {
  url: string;
  environment: "development" | "test" | "staging" | "production";
  tlsMode: "verify_full" | "disable";
  caCertificate?: string;
}
export class DatabaseConnectionSettings {
  private readonly options: PoolConfig;
  constructor(input: DatabaseConnectionInput) {
    try {
      if (input.url.length > 16384) throw Error("size");
      const url = new URL(input.url);
      const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const user = decodeURIComponent(url.username);
      const password = decodeURIComponent(url.password);
      const database = decodeURIComponent(url.pathname.slice(1));
      const port = url.port ? Number(url.port) : 5432;
      const local =
        ["development", "test"].includes(input.environment) &&
        [
          "localhost",
          "127.0.0.1",
          "::1",
          "host.docker.internal",
          "database",
        ].includes(host);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !host ||
        (!isIP(host) &&
          !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host)) ||
        !user ||
        !password ||
        /[\u0000-\u001f\u007f]/.test(user + password) ||
        !/^[A-Za-z0-9_.-]{1,63}$/.test(database) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        url.hash
      )
        throw Error("url");
      const entries = [...url.searchParams];
      if (
        entries.length > 1 ||
        entries.some(
          ([key, value]) =>
            key !== "sslmode" ||
            value !==
              (input.tlsMode === "verify_full" ? "verify-full" : "disable"),
        )
      )
        throw Error("override");
      if (input.tlsMode === "disable" && (!local || input.caCertificate))
        throw Error("local");
      if (input.caCertificate) {
        const certificates = input.caCertificate.match(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
        );
        if (
          !certificates?.length ||
          Buffer.byteLength(input.caCertificate) > 65536 ||
          input.caCertificate
            .replace(
              /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
              "",
            )
            .trim() ||
          certificates.some((value) => !new X509Certificate(value).ca)
        )
          throw Error("ca");
      }
      this.options = {
        host,
        port,
        user,
        password,
        database,
        ssl:
          input.tlsMode === "disable"
            ? false
            : {
                rejectUnauthorized: true,
                minVersion: "TLSv1.2",
                ...(input.caCertificate ? { ca: input.caCertificate } : {}),
              },
        sslnegotiation: "postgres",
        enableChannelBinding: true,
        application_name: "nova-capital",
        options: "-c search_path=public",
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 10000,
      };
    } catch {
      throw new ConfigurationError([
        "DATABASE_URL / DATABASE_TLS_MODE / DATABASE_CA_CERT",
      ]);
    }
  }
  poolConfig(): PoolConfig {
    return {
      ...this.options,
      ssl:
        typeof this.options.ssl === "object"
          ? { ...this.options.ssl }
          : this.options.ssl,
    };
  }
}
