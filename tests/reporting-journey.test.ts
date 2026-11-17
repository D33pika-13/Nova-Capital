import { randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { it, expect } from "vitest";
import {
  TestDatabase,
  testAuth,
  testAuthSubject,
  ids,
} from "./fixtures/database";
import { ClientService } from "@/server/modules/clients/client-service";
import { PostgresClientRepository } from "@/server/providers/postgres-clients";
import { InvitationService } from "@/server/modules/clients/invitation-service";
import { PostgresInvitationRepository } from "@/server/providers/postgres-invitations";
import { PostgresPortfolioRepository } from "@/server/providers/postgres-portfolio";
import { PortfolioService } from "@/server/modules/portfolio/portfolio-service";
import { FinancialCalculator } from "@/server/modules/portfolio/financial-calculator";
import { SmtpEmailProvider } from "@/server/providers/smtp-email";
import { ConfigurationService } from "@/server/config";
it("runs client creation -> local SMTP invitation -> manual reporting -> isolated client view -> suspension with synthetic identity verification", async () => {
  const db = new TestDatabase();
  let received = "";
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, done) {
      stream.on("data", (data) => {
        received += data.toString();
      });
      stream.on("end", () => done());
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  try {
    await db.initialize();
    const adminAuth = testAuth(db);
    const clients = new ClientService(
      adminAuth,
      new PostgresClientRepository(db),
    );
    const client = await clients.create({
      requestId: randomUUID(),
      displayName: "SYNTHETIC End-to-end Client",
      email: "journey@example.test",
    });
    const subject = randomUUID();
    const config = new ConfigurationService({
      APP_ENV: "test",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String((smtp.server.address() as { port: number }).port),
      EMAIL_FROM: "test@example.test",
    }).get();
    const invitations = new InvitationService(
      adminAuth,
      new PostgresInvitationRepository(db),
      {
        prepare: async () => ({
          subject,
          provider: "supabase",
          link: "https://example.test/auth/callback?token_hash=synthetic-journey-only&type=invite",
        }),
      },
      new SmtpEmailProvider(config),
      { consume: async () => true },
      "Synthetic Example Firm",
    );
    expect(
      (
        await invitations.send(client.id, {
          requestId: randomUUID(),
          purpose: "setup",
        })
      ).status,
    ).toBe("accepted");
    expect(received).toContain("journey@example.test");
    // This test deliberately verifies a synthetic identity, not live Supabase password/MFA flows.
    const clientAuth = testAuthSubject(db, subject);
    const reader = new PortfolioService(
      clientAuth,
      new PostgresPortfolioRepository(db),
      new FinancialCalculator(),
    );
    expect((await reader.clientOverview()).summaries).toEqual([]);
    const writer = new PortfolioService(
      adminAuth,
      new PostgresPortfolioRepository(db),
      new FinancialCalculator(),
    );
    const requestId = randomUUID();
    const input = {
      requestId,
      clientId: client.id,
      assetClass: "forex",
      description: "SYNTHETIC reporting fixture",
      currency: "USD",
      investedAmount: "1000.1234",
      reportedValue: "1025.5678",
      reportedAt: "2026-02-10T10:00:00.000Z",
    };
    await writer.createInvestment(input);
    await writer.createInvestment(input);
    await writer.appendSnapshot({
      requestId: randomUUID(),
      clientId: client.id,
      currency: "USD",
      adjustedBasis: "1000.1234",
      reportedValue: "1025.5678",
      basisExplanation: "Synthetic basis with no further cash flows",
      reportedAt: input.reportedAt,
    });
    const view = await reader.clientOverview();
    expect(view.investments).toHaveLength(1);
    expect(view.summaries[0].profitLoss).toBe("25.4444");
    expect(view.revisions).toHaveLength(1);
    expect(
      (
        await new PortfolioService(
          testAuth(db, "b"),
          new PostgresPortfolioRepository(db),
          new FinancialCalculator(),
        ).clientOverview()
      ).investments,
    ).toEqual([]);
    await expect(
      new ClientService(clientAuth, new PostgresClientRepository(db)).get(
        ids.a,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const current = await clients.get(client.id);
    await clients.update(client.id, {
      requestId: randomUUID(),
      displayName: current.displayName,
      status: "suspended",
      expectedUpdatedAt: current.updatedAt,
    });
    await expect(reader.clientOverview()).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    await db.close();
    await new Promise<void>((resolve) => smtp.close(resolve));
  }
}, 30000);
