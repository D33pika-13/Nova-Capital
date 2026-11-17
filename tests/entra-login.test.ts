import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { EntraLoginService } from "@/server/modules/identity/entra-login-service";
import type {
  OidcMetadata,
  OidcCodeExchange,
} from "@/server/modules/identity/oidc-login-contracts";
import type { RateLimiter, VerifiedIdentity } from "@/server/contracts";
import { PostgresLoginTransactions } from "@/server/providers/postgres-login-transactions";
import { PostgresMaintenanceRepository } from "@/server/providers/postgres-maintenance";
import { TestDatabase } from "./fixtures/database";
const db = new TestDatabase();
beforeAll(() => db.initialize(), 20000);
afterAll(() => db.close());
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const metadata: OidcMetadata = Object.freeze({
  issuer:
    "https://synthetic.ciamlogin.com/10000000-0000-4000-8000-000000000001/v2.0",
  clientId: "20000000-0000-4000-8000-000000000002",
  authorizationEndpoint:
    "https://synthetic.ciamlogin.com/10000000-0000-4000-8000-000000000001/oauth2/v2.0/authorize",
  tokenEndpoint:
    "https://synthetic.ciamlogin.com/10000000-0000-4000-8000-000000000001/oauth2/v2.0/token",
  jwksUri: "https://synthetic.ciamlogin.com/common/discovery/v2.0/keys",
  logoutEndpoint:
    "https://synthetic.ciamlogin.com/10000000-0000-4000-8000-000000000001/oauth2/v2.0/logout",
  tokenAuthenticationMethod: "client_secret_post",
});
const identity: VerifiedIdentity = {
  provider: "entra",
  subject: "synthetic-verified-object",
  assurance: "aal1",
};
function setup() {
  const discovery = { load: vi.fn(async () => metadata) };
  const exchange = {
    exchange: vi.fn<OidcCodeExchange["exchange"]>(async () => identity),
  };
  const limits = { consume: vi.fn<RateLimiter["consume"]>(async () => true) };
  const repository = new PostgresLoginTransactions(db);
  const service = new EntraLoginService(
    discovery,
    repository,
    exchange,
    limits,
    "https://app.example.test/auth/entra/callback",
  );
  return { service, repository, exchange, discovery, limits };
}
function callback(start: { authorizationUrl: string }) {
  return new URLSearchParams({
    state: new URL(start.authorizationUrl).searchParams.get("state")!,
    code: "synthetic-code",
  });
}

describe("Entra browser-bound login transaction", () => {
  it("generates independent unpredictable secrets, persists only hashed proofs, and uses PKCE S256 with minimal scopes", async () => {
    const { service, limits } = setup();
    const start = await service.start();
    const url = new URL(start.authorizationUrl);
    const query = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe(metadata.authorizationEndpoint);
    expect(query.get("scope")).toBe("openid profile");
    expect(query.get("response_type")).toBe("code");
    expect(query.get("response_mode")).toBe("query");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("redirect_uri")).toBe(
      "https://app.example.test/auth/entra/callback",
    );
    const state = query.get("state")!;
    const row = (
      await db.engine.query<{
        state_hash: string;
        binding_hash: string;
        nonce: string;
        code_verifier: string;
        lifetime: number;
      }>(
        "select *,extract(epoch from expires_at-created_at)::int lifetime from private.entra_login_transactions where state_hash=$1",
        [hash(state)],
      )
    ).rows[0];
    expect(row.lifetime).toBe(600);
    expect(row.binding_hash).toBe(hash(start.browserBinding));
    expect(row.nonce).toBe(query.get("nonce"));
    expect(query.get("code_challenge")).toBe(
      createHash("sha256").update(row.code_verifier).digest("base64url"),
    );
    expect(
      new Set([state, start.browserBinding, row.nonce, row.code_verifier]).size,
    ).toBe(4);
    expect(JSON.stringify(row)).not.toContain(start.browserBinding);
    expect(JSON.stringify(row)).not.toContain(state);
    expect(start.authorizationUrl).not.toContain(start.browserBinding);
    expect(start.authorizationUrl).not.toContain(row.code_verifier);
    expect(JSON.stringify(limits.consume.mock.calls)).not.toContain(
      start.browserBinding,
    );
  });
  it("commits one-time consumption before code redemption and rejects replay", async () => {
    const { service, exchange } = setup();
    const start = await service.start();
    exchange.exchange.mockImplementation(async () => {
      const remaining = (
        await db.engine.query<{ count: number }>(
          "select count(*)::int count from private.entra_login_transactions where state_hash=$1",
          [hash(callback(start).get("state")!)],
        )
      ).rows[0].count;
      expect(remaining).toBe(0);
      return identity;
    });
    expect(
      await service.completeFlow(callback(start), start.browserBinding),
    ).toEqual({ identity, purpose: "login" });
    expect(exchange.exchange).toHaveBeenCalledOnce();
    const input = exchange.exchange.mock.calls[0][0];
    expect(input.expectedNonce).toBe(
      new URL(start.authorizationUrl).searchParams.get("nonce"),
    );
    expect(input.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(exchange.exchange).toHaveBeenCalledOnce();
  });
  it("keeps the original transaction when another browser supplies the state", async () => {
    const { service, exchange } = setup();
    const start = await service.start();
    await expect(
      service.completeFlow(
        callback(start),
        randomBytes(32).toString("base64url"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(exchange.exchange).not.toHaveBeenCalled();
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).resolves.toEqual({ identity, purpose: "login" });
  });
  it("does not redeem a transaction under changed identity configuration", async () => {
    const { service, discovery, exchange } = setup();
    const start = await service.start();
    discovery.load.mockResolvedValue({
      ...metadata,
      clientId: "30000000-0000-4000-8000-000000000003",
    });
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(exchange.exchange).not.toHaveBeenCalled();
    discovery.load.mockResolvedValue(metadata);
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).resolves.toEqual({ identity, purpose: "login" });
  });
  it("expires transactions using database time, rather than a caller-supplied expiry", async () => {
    const { service, exchange } = setup();
    const start = await service.start();
    await db.engine.query(
      "update private.entra_login_transactions set created_at=statement_timestamp()-interval '11 minutes',expires_at=statement_timestamp()-interval '1 minute' where state_hash=$1",
      [hash(callback(start).get("state")!)],
    );
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(exchange.exchange).not.toHaveBeenCalled();
  });
  it("allows parallel flows in one browser without sharing state, nonce or verifier", async () => {
    const { service } = setup();
    const first = await service.start();
    const second = await service.start(first.browserBinding);
    expect(second.browserBinding).toBe(first.browserBinding);
    expect(new URL(second.authorizationUrl).searchParams.get("state")).not.toBe(
      new URL(first.authorizationUrl).searchParams.get("state"),
    );
    await expect(
      service.completeFlow(callback(second), second.browserBinding),
    ).resolves.toEqual({ identity, purpose: "login" });
    await expect(
      service.completeFlow(callback(first), first.browserBinding),
    ).resolves.toEqual({ identity, purpose: "login" });
  });
  it("never restores or retries a transaction after an uncertain provider redemption", async () => {
    const { service, exchange } = setup();
    const start = await service.start();
    exchange.exchange.mockRejectedValue(
      Error("synthetic-private-provider-error"),
    );
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({
      message:
        "This sign-in request is invalid or expired. Start sign-in again.",
    });
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(exchange.exchange).toHaveBeenCalledOnce();
  });
  it("consumes a browser-bound provider refusal without echoing its details", async () => {
    const { service, exchange } = setup();
    const start = await service.start();
    const input = callback(start);
    input.delete("code");
    input.set("error", "access_denied");
    input.set("error_description", "synthetic-private-provider-error");
    await expect(
      service.completeFlow(input, start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(exchange.exchange).not.toHaveBeenCalled();
  });
  it("denies global/per-browser throttling without saving a login transaction", async () => {
    const { service, limits, discovery } = setup();
    limits.consume.mockResolvedValue(false);
    await expect(service.start()).rejects.toMatchObject({ status: 429 });
    expect(discovery.load).not.toHaveBeenCalled();
  });
  it("does not consume a valid flow while its callback is throttled", async () => {
    const { service, limits, exchange } = setup();
    const start = await service.start();
    limits.consume.mockResolvedValue(false);
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({ status: 429 });
    expect(exchange.exchange).not.toHaveBeenCalled();
    limits.consume.mockResolvedValue(true);
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).resolves.toEqual({ identity, purpose: "login" });
  });
  it.each([
    "http://app.example.test/auth/entra/callback",
    "https://app.example.test/other",
    "https://user:secret@app.example.test/auth/entra/callback",
    "https://app.example.test/auth/entra/callback?next=evil",
    "https://app.example.test/auth/entra/callback#fragment",
  ])("rejects unsafe callback configuration (%#)", (redirect) => {
    const { repository, discovery, exchange, limits } = setup();
    expect(
      () =>
        new EntraLoginService(
          discovery,
          repository,
          exchange,
          limits,
          redirect,
        ),
    ).toThrow("ENTRA_REDIRECT_URI");
  });
  it.each([
    "",
    "code=x",
    "state=x&code=y",
    "state=STATE&code=x&code=y",
    "state=STATE&code=x&error=access_denied",
    "state=STATE&code=x&nonce=forged",
    "state=STATE&code=x&next=https://evil.example.test",
    "state=STATE&code=a%0Ab",
    "state=STATE&error_description=private",
    `state=STATE&code=${"x".repeat(4097)}`,
  ])(
    "rejects malformed callback parameters before consuming a flow (%#)",
    async (value) => {
      const { service, exchange } = setup();
      const start = await service.start();
      const query = value.replaceAll("STATE", callback(start).get("state")!);
      await expect(
        service.completeFlow(new URLSearchParams(query), start.browserBinding),
      ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
      expect(exchange.exchange).not.toHaveBeenCalled();
      await expect(
        service.completeFlow(callback(start), start.browserBinding),
      ).resolves.toEqual({ identity, purpose: "login" });
    },
  );
});

describe("Entra private transaction SQL capability", () => {
  it("prevents direct anonymous/runtime reads or writes of private protocol secrets", async () => {
    for (const statement of [
      "select * from private.entra_login_transactions",
      "delete from private.entra_login_transactions",
    ])
      await expect(
        db.withIdentity(null, (sql) => sql.query(statement)),
      ).rejects.toMatchObject({ code: "42501" });
  });
  it("caps each browser at five outstanding requests even without the service limiter", async () => {
    const { service } = setup();
    const start = await service.start();
    for (let n = 0; n < 4; n++) await service.start(start.browserBinding);
    await expect(service.start(start.browserBinding)).rejects.toMatchObject({
      status: 429,
    });
    await service.completeFlow(callback(start), start.browserBinding);
    await expect(service.start(start.browserBinding)).resolves.toMatchObject({
      browserBinding: start.browserBinding,
    });
  });
  it("prunes only expired protocol records during existing scheduled maintenance", async () => {
    const { service } = setup();
    const expired = await service.start();
    const active = await service.start();
    await db.engine.query(
      "update private.entra_login_transactions set created_at=statement_timestamp()-interval '11 minutes',expires_at=statement_timestamp()-interval '1 minute' where state_hash=$1",
      [hash(callback(expired).get("state")!)],
    );
    await new PostgresMaintenanceRepository(db).expireOffers(null);
    const rows = (
      await db.engine.query<{ state_hash: string }>(
        "select state_hash from private.entra_login_transactions where state_hash=any($1::text[])",
        [
          [
            hash(callback(expired).get("state")!),
            hash(callback(active).get("state")!),
          ],
        ],
      )
    ).rows;
    expect(rows).toEqual([
      { state_hash: hash(callback(active).get("state")!) },
    ]);
  });
  it("persists recovery intent, requests fresh provider sign-in and returns only the stored purpose", async () => {
    const { service } = setup(),
      start = await service.start(undefined, "recovery");
    expect(new URL(start.authorizationUrl).searchParams.get("prompt")).toBe(
      "login",
    );
    const row = (
      await db.engine.query<{
        purpose: string;
        state_hash: string;
        binding_hash: string;
        configuration_hash: string;
      }>("select * from private.entra_login_transactions where state_hash=$1", [
        hash(callback(start).get("state")!),
      ])
    ).rows[0];
    expect(row.purpose).toBe("recovery");
    const legacy = await db.withIdentity(null, (sql) =>
      sql.query("select * from private.take_entra_transaction($1,$2,$3)", [
        row.state_hash,
        row.binding_hash,
        row.configuration_hash,
      ]),
    );
    expect(legacy.rows).toHaveLength(0);
    const tampered = callback(start);
    tampered.set("purpose", "login");
    await expect(
      service.completeFlow(tampered, start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(
      await service.completeFlow(callback(start), start.browserBinding),
    ).toEqual({ identity, purpose: "recovery" });
    await expect(
      service.completeFlow(callback(start), start.browserBinding),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
  });
  it("rejects invalid purpose before protocol I/O and shares browser capacity across login and recovery", async () => {
    const { service, discovery } = setup();
    await expect(
      service.start(undefined, "forged" as never),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(discovery.load).not.toHaveBeenCalled();
    const first = await service.start();
    for (let index = 0; index < 4; index++)
      await service.start(
        first.browserBinding,
        index % 2 ? "login" : "recovery",
      );
    await expect(
      service.start(first.browserBinding, "recovery"),
    ).rejects.toMatchObject({ status: 429 });
  });
});
