import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { SMTPServer } from "smtp-server";
import { TestDatabase } from "./fixtures/database";
import {
  ContactService,
  type ContactRepository,
} from "@/server/modules/support/contact-service";
import { PostgresContactRepository } from "@/server/providers/postgres-contact";
import { PostgresRateLimiter } from "@/server/providers/postgres-database";
import { SmtpEmailProvider } from "@/server/providers/smtp-email";
import { ConfigurationService } from "@/server/config";
import type { EmailMessage } from "@/server/contracts";
import { contactClientAddress } from "@/server/contact-context";
const db = new TestDatabase();
const repository = new PostgresContactRepository(db);
const options = {
  enabled: true,
  recipient: "support@example.test",
  secret: "synthetic-contact-hash-secret-for-test-only",
};
const input = () => ({
  requestId: randomUUID(),
  name: "SYNTHETIC Visitor",
  email: `${randomUUID()}@example.test`,
  topic: "reports",
  message: "Please help with this SYNTHETIC report fixture.",
  consent: true,
  website: "",
});
const allowed = { consume: async () => true };
beforeAll(() => db.initialize(), 20000);
afterAll(() => db.close());
it("delivers expected fields to one configured loopback SMTP recipient and reports acceptance without claiming delivery", async () => {
  let received = "";
  const recipients: string[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onRcptTo(address, _session, done) {
      recipients.push(address.address);
      done();
    },
    onData(stream, _session, done) {
      stream.on("data", (chunk) => {
        received += chunk.toString();
      });
      stream.on("end", () => done());
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  try {
    const config = new ConfigurationService({
      APP_ENV: "test",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String((smtp.server.address() as { port: number }).port),
      EMAIL_FROM: "sender@example.test",
    }).get();
    const service = new ContactService(
      repository,
      new SmtpEmailProvider(config),
      allowed,
      options,
    );
    const data = input();
    const result = await service.submit(data, "203.0.113.10");
    expect(result).toMatchObject({
      status: "accepted",
      reference: data.requestId,
    });
    expect(result.message).toContain(
      "Inbox delivery and a response are not confirmed",
    );
    expect(recipients).toEqual(["support@example.test"]);
    expect(received).toContain(`Reply-To: ${data.email}`);
    expect(received).toContain(data.name);
    expect(received).toContain(data.message);
    expect(received).toContain("Topic: Client reports");
    expect(received).toContain("Content-Type: text/plain");
    expect(await service.submit(data, "203.0.113.10")).toEqual(result);
    expect(recipients).toHaveLength(1);
    const ledger = JSON.stringify(
      (
        await db.engine.query(
          "select * from private.contact_requests where request_id=$1",
          [data.requestId],
        )
      ).rows,
    );
    const audit = JSON.stringify(
      (
        await db.engine.query(
          "select * from audit_logs where entity='contact_requests' and entity_id=$1",
          [data.requestId],
        )
      ).rows,
    );
    for (const secret of [
      data.name,
      data.email,
      data.message,
      "203.0.113.10",
      options.secret,
    ]) {
      expect(ledger).not.toContain(secret);
      expect(audit).not.toContain(secret);
    }
  } finally {
    await new Promise<void>((resolve) => smtp.close(resolve));
  }
}, 10000);
it("keeps a duplicate request processing while its single sender is active", async () => {
  let sending!: () => void;
  let release!: () => void;
  let calls = 0;
  const started = new Promise<void>((resolve) => {
    sending = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new ContactService(
    repository,
    {
      send: async () => {
        calls++;
        sending();
        await held;
      },
    },
    allowed,
    options,
  );
  const data = input();
  const first = service.submit(data, null);
  await started;
  try {
    expect((await service.submit(data, null)).status).toBe("processing");
    expect(calls).toBe(1);
  } finally {
    release();
  }
  expect((await first).status).toBe("accepted");
});
it("never automatically resends uncertain email acceptance and hides provider error details", async () => {
  let calls = 0;
  const service = new ContactService(
    repository,
    {
      send: async () => {
        calls++;
        throw new Error("sensitive provider failure detail");
      },
    },
    allowed,
    options,
  );
  const data = input();
  const first = await service.submit(data, null);
  expect(first.status).toBe("unknown");
  expect(first.message).not.toContain("sensitive");
  expect(await service.submit(data, null)).toEqual(first);
  expect(calls).toBe(1);
});
it("preserves committed acceptance after a lost database acknowledgment and never downgrades it", async () => {
  let lost = true;
  let sends = 0;
  const repo: ContactRepository = {
    status: repository.status.bind(repository),
    claim: repository.claim.bind(repository),
    finish: async (...args) => {
      const status = await repository.finish(...args);
      if (lost) {
        lost = false;
        throw new Error("Synthetic lost commit ack");
      }
      return status;
    },
  };
  const service = new ContactService(
    repo,
    {
      send: async () => {
        sends++;
      },
    },
    allowed,
    options,
  );
  const data = input();
  expect((await service.submit(data, null)).status).toBe("accepted");
  expect((await service.submit(data, null)).status).toBe("accepted");
  expect(sends).toBe(1);
});
it("retains a claim when outcome storage fails and converts stale processing to unknown without resending", async () => {
  let sends = 0;
  const repo: ContactRepository = {
    status: repository.status.bind(repository),
    claim: repository.claim.bind(repository),
    finish: async () => {
      throw new Error("Synthetic DB outage");
    },
  };
  const service = new ContactService(
    repo,
    {
      send: async () => {
        sends++;
      },
    },
    allowed,
    options,
  );
  const data = input();
  expect((await service.submit(data, null)).status).toBe("unknown");
  expect((await service.submit(data, null)).status).toBe("processing");
  await db.engine.query(
    "update private.contact_requests set created_at=now()-interval '11 minutes' where request_id=$1",
    [data.requestId],
  );
  expect((await service.submit(data, null)).status).toBe("unknown");
  expect(sends).toBe(1);
});
it("rejects reused keys with changed content, injection, unapproved fields and bot traps before another send", async () => {
  const sent: EmailMessage[] = [];
  const service = new ContactService(
    repository,
    {
      send: async (message) => {
        sent.push(message);
      },
    },
    allowed,
    options,
  );
  const data = input();
  await service.submit(data, null);
  await expect(
    service.submit({ ...data, message: "A changed synthetic message" }, null),
  ).rejects.toMatchObject({ status: 409 });
  for (const invalid of [
    { ...input(), name: "Visitor\r\nBcc: victim@example.test" },
    { ...input(), email: "visitor@example.test\r\nBcc: victim@example.test" },
    { ...input(), to: "victim@example.test" },
    { ...input(), website: "bot.example.test" },
    { ...input(), consent: false },
    { ...input(), message: "short" },
  ])
    await expect(service.submit(invalid, null)).rejects.toMatchObject({
      status: 422,
    });
  expect(sent).toHaveLength(1);
  const smtp = new SmtpEmailProvider(
    new ConfigurationService({
      APP_ENV: "test",
      SMTP_HOST: "127.0.0.1",
      EMAIL_FROM: "sender@example.test",
    }).get(),
  );
  await expect(
    smtp.send({
      to: "support@example.test",
      replyTo: "visitor@example.test\r\nBcc: victim@example.test",
      subject: "Test",
      text: "Synthetic only",
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it("enforces shared network/email limits while allowing safe status replay after send quota is exhausted", async () => {
  let sends = 0;
  const service = new ContactService(
    repository,
    {
      send: async () => {
        sends++;
      },
    },
    new PostgresRateLimiter(db),
    options,
  );
  const accepted = [];
  for (let i = 0; i < 5; i++) {
    const data = input();
    accepted.push(data);
    expect((await service.submit(data, "198.51.100.250")).status).toBe(
      "accepted",
    );
  }
  await expect(service.submit(input(), "198.51.100.250")).rejects.toMatchObject(
    { status: 429 },
  );
  expect((await service.submit(accepted[0], "198.51.100.250")).status).toBe(
    "accepted",
  );
  expect(sends).toBe(5);
  const email = `${randomUUID()}@example.test`;
  for (let i = 0; i < 3; i++)
    await service.submit({ ...input(), email }, `198.51.100.${i + 1}`);
  await expect(
    service.submit({ ...input(), email }, "198.51.100.10"),
  ).rejects.toMatchObject({ status: 429 });
  const rates = JSON.stringify(
    (await db.engine.query("select * from private.rate_limits")).rows,
  );
  expect(rates).not.toContain(email);
  expect(rates).not.toContain("198.51.100.250");
});
it("denies direct ledger reads and requires matching non-null hashes for narrow database functions", async () => {
  const data = input();
  const service = new ContactService(
    repository,
    { send: async () => {} },
    allowed,
    options,
  );
  await service.submit(data, null);
  await expect(
    db.withIdentity(null, (sql) =>
      sql.query("select * from private.contact_requests"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  for (const hash of [null, "a".repeat(64)]) {
    await expect(
      db.withIdentity(null, (sql) =>
        sql.query("select private.contact_status($1,$2)", [
          data.requestId,
          hash,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.withIdentity(null, (sql) =>
        sql.query("select private.finish_contact($1,$2,'accepted')", [
          data.requestId,
          hash,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  }
});
it("uses only explicitly configured proxy headers and fails closed for missing, multiple or invalid addresses", async () => {
  const headers = new Headers({
    "x-real-ip": "203.0.113.5",
    "x-forwarded-for": "198.51.100.1",
  });
  expect(contactClientAddress(headers, "none")).toBeNull();
  expect(contactClientAddress(headers, "x-real-ip")).toBe("203.0.113.5");
  for (const value of [null, "invalid", "203.0.113.5, 198.51.100.1"]) {
    const current = new Headers();
    if (value) current.set("x-real-ip", value);
    expect(() => contactClientAddress(current, "x-real-ip")).toThrow(
      /could not be verified/,
    );
  }
  const disabled = new ContactService(
    repository,
    {
      send: async () => {
        throw new Error("should not send");
      },
    },
    allowed,
    { ...options, enabled: false },
  );
  await expect(disabled.submit(input(), null)).rejects.toMatchObject({
    status: 503,
  });
});
