import { SMTPServer } from "smtp-server";
import { describe, it, expect } from "vitest";
import { ConfigurationService } from "@/server/config";
import { SmtpEmailProvider } from "@/server/providers/smtp-email";
describe("SMTP adapter against a local test server", () => {
  it("never attempts authenticated SMTP on an unencrypted local capture server", async () => {
    let authenticated = false;
    const server = new SMTPServer({
      disabledCommands: ["STARTTLS"],
      onAuth(_auth, _session, callback) {
        authenticated = true;
        callback(null, { user: "synthetic" });
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (server.server.address() as { port: number }).port;
      const config = new ConfigurationService({
        APP_ENV: "test",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(port),
        SMTP_USER: "synthetic-user",
        SMTP_PASSWORD: "synthetic-password",
        EMAIL_FROM: "sender@example.test",
      }).get();
      await expect(
        new SmtpEmailProvider(config).send({
          to: "synthetic@example.test",
          subject: "Synthetic TLS boundary",
          text: "Fixture only",
        }),
      ).rejects.toMatchObject({ code: "EMAIL_UNCERTAIN" });
      expect(authenticated).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });
  it("sends a plain-text synthetic invitation and observes server acceptance", async () => {
    let received = "";
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, _session, callback) {
        stream.on("data", (chunk) => {
          received += chunk.toString();
        });
        stream.on("end", () => callback());
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (server.server.address() as { port: number }).port;
      const config = new ConfigurationService({
        APP_ENV: "test",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(port),
        EMAIL_FROM: "sender@example.test",
      }).get();
      const email = new SmtpEmailProvider(config);
      await email.send({
        to: "synthetic@example.test",
        subject: "Synthetic invitation",
        text: "Local integration fixture only.",
      });
      expect(received).toContain("To: synthetic@example.test");
      expect(received).toContain("Local integration fixture only.");
      await expect(
        email.send({
          to: "synthetic@example.test",
          subject: "Injected\r\nBcc: other@example.test",
          text: "x",
        }),
      ).rejects.toMatchObject({ status: 422 });
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  }, 10000);
  it("fails safely when the SMTP server rejects the message", async () => {
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onRcptTo(_address, _session, callback) {
        callback(new Error("Synthetic rejection"));
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (server.server.address() as { port: number }).port;
      const config = new ConfigurationService({
        APP_ENV: "test",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(port),
        EMAIL_FROM: "sender@example.test",
      }).get();
      await expect(
        new SmtpEmailProvider(config).send({
          to: "synthetic@example.test",
          subject: "Synthetic",
          text: "Rejected fixture",
        }),
      ).rejects.toMatchObject({ code: "EMAIL_UNCERTAIN" });
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  }, 10000);
});
