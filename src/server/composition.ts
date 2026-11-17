import "server-only";
import { EducationService } from "./modules/education/education-service";
import { PostgresEducationRepository } from "./providers/postgres-education";
import { siteConfig } from "@/lib/site-config";
import { DatabaseConnectionSettings } from "./database-settings";
import { PostgresPoolFactory } from "./providers/postgres-pool";
import { loadTelemetry } from "./telemetry-factory";
import { StorageFactory } from "./providers/storage-factory";
import { ChatService } from "./modules/support/chat-service";
import { PostgresChatRepository } from "./providers/postgres-chat";
import { SupportService } from "./modules/support/support-service";
import { FaqResponder } from "./modules/support/faq-responder";
import { PostgresSupportFacts } from "./providers/postgres-support-facts";
import { SupportPlannerFactory } from "./providers/support-planner-factory";
import { ContactService } from "./modules/support/contact-service";
import { PostgresContactRepository } from "./providers/postgres-contact";
import { OfferImageService } from "./modules/offers/offer-image-service";
import { PostgresOfferImageRepository } from "./providers/postgres-offer-images";
import { WorkerImageProcessor } from "./providers/image-processor";
import { MaintenanceService } from "./modules/offers/maintenance-service";
import { PostgresMaintenanceRepository } from "./providers/postgres-maintenance";
import { AnnouncementService } from "./modules/offers/announcement-service";
import { PostgresAnnouncementRepository } from "./providers/postgres-announcements";
import { OfferService } from "./modules/offers/offer-service";
import { PostgresOfferRepository } from "./providers/postgres-offers";
import { createClient } from "@supabase/supabase-js";
import { ClientService } from "./modules/clients/client-service";
import { InvitationService } from "./modules/clients/invitation-service";
import { PostgresClientRepository } from "./providers/postgres-clients";
import { PostgresInvitationRepository } from "./providers/postgres-invitations";
import { SmtpEmailProvider } from "./providers/smtp-email";
import { WithdrawalService } from "./modules/portfolio/withdrawal-service";
import { PostgresWithdrawalRepository } from "./providers/postgres-withdrawals";
import { MutationStore } from "./mutation-store";
import { PortfolioService } from "./modules/portfolio/portfolio-service";
import { FinancialCalculator } from "./modules/portfolio/financial-calculator";
import { PostgresPortfolioRepository } from "./providers/postgres-portfolio";
import { ReportService } from "./modules/reports/report-service";
import { PostgresReportRepository } from "./providers/postgres-reports";
import { ClamAvScanner } from "./providers/clamav-scanner";
import { WorkerPdfValidator } from "./providers/pdf-validator";
import type { Pool } from "pg";
import { loadConfig } from "./config";
import { AppError } from "./errors";
import {
  PostgresDatabase,
  PostgresProfileRepository,
  PostgresRateLimiter,
} from "./providers/postgres-database";
import { headers } from "next/headers";
import { AuthenticationFactory } from "./authentication-factory";
import type { ServerConfig } from "./config";
// Pool carries connections only; verified identity always stays request-scoped.
const globalPool = globalThis as typeof globalThis & {
  novaPool?: Pool;
  novaShutdownStarted?: boolean;
  novaAuthentication?: AuthenticationFactory;
  novaAuthenticationConfig?: Readonly<ServerConfig>;
};
export async function createServices() {
  if (globalPool.novaShutdownStarted)
    throw new AppError(
      "SERVICES_DRAINING",
      "The server is shutting down.",
      503,
    );
  const config = await loadConfig();
  if (!config.SERVICES_ENABLED)
    throw new AppError(
      "SERVICES_UNAVAILABLE",
      "This environment has not been connected to client services.",
      503,
    );
  const telemetry = loadTelemetry(config);
  const pool =
    globalPool.novaPool ??
    new PostgresPoolFactory(
      new DatabaseConnectionSettings({
        url: config.DATABASE_URL!,
        environment: config.APP_ENV,
        tlsMode: config.DATABASE_TLS_MODE,
        caCertificate: config.DATABASE_CA_CERT,
      }),
      telemetry,
    ).create();
  globalPool.novaPool = pool;
  const database = new PostgresDatabase(pool);
  const profiles = new PostgresProfileRepository(database);
  const limits = new PostgresRateLimiter(database);
  const adminClient =
    config.AUTH_PROVIDER === "supabase" ||
    config.STORAGE_PROVIDER === "supabase"
      ? createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) =>
              fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
          },
        })
      : undefined;
  if (
    !globalPool.novaAuthentication ||
    globalPool.novaAuthenticationConfig !== config
  ) {
    globalPool.novaAuthentication = new AuthenticationFactory(
      config,
      database,
      adminClient,
      telemetry,
    );
    globalPool.novaAuthenticationConfig = config;
  }
  const authentication = await globalPool.novaAuthentication.create({
    headers: new Headers(Array.from((await headers()).entries())),
  });
  const { identity, auth } = authentication;
  const email = new SmtpEmailProvider(config);
  const storage = new StorageFactory(config, adminClient).create();
  const faq = new FaqResponder();
  const support = new SupportService(
    auth,
    new PostgresSupportFacts(database),
    new SupportPlannerFactory(config).create(),
    limits,
    new FinancialCalculator(),
    faq,
    config.SUPPORT_AI_DAILY_REQUEST_LIMIT,
  );
  return {
    config,
    authCallback: authentication.authCallback,
    entra: authentication.entra,
    identity,
    database,
    profiles,
    auth,
    limits,
    email,
    maintenance: new MaintenanceService(
      auth,
      new PostgresMaintenanceRepository(database),
      {
        provider: config.SCHEDULER_PROVIDER,
        environment: config.APP_ENV,
        secret: config.CRON_SECRET,
        staleAfterSeconds: config.MAINTENANCE_STALE_AFTER_SECONDS,
      },
      telemetry,
    ),
    announcements: new AnnouncementService(
      auth,
      new PostgresAnnouncementRepository(database),
    ),
    offerImages: new OfferImageService(
      auth,
      new PostgresOfferImageRepository(database, storage.imageLocation),
      storage.images,
      new ClamAvScanner(
        config.CLAMAV_HOST!,
        config.CLAMAV_PORT,
        config.SCAN_TIMEOUT_MS,
      ),
      new WorkerImageProcessor(config.IMAGE_PROCESSING_TIMEOUT_MS),
      limits,
      {
        bucket: config.OFFER_IMAGE_BUCKET,
        provider: config.STORAGE_PROVIDER,
        maxBytes: config.OFFER_IMAGE_MAX_BYTES,
        namespace: storage.namespace,
      },
    ),
    offers: new OfferService(auth, new PostgresOfferRepository(database)),
    support,
    chat: new ChatService(
      auth,
      new PostgresChatRepository(database),
      support,
      limits,
      faq,
    ),
    education: new EducationService(
      new PostgresEducationRepository(database),
      auth,
      limits,
      { enabled: config.EDUCATION_ENABLED, secret: config.CONTACT_HASH_SECRET },
    ),
    contact: new ContactService(
      new PostgresContactRepository(database),
      email,
      limits,
      {
        enabled: config.CONTACT_ENABLED,
        recipient: config.SUPPORT_EMAIL,
        secret: config.CONTACT_HASH_SECRET,
      },
    ),
    clients: new ClientService(auth, new PostgresClientRepository(database)),
    invitations: new InvitationService(
      auth,
      new PostgresInvitationRepository(database),
      authentication.accounts,
      email,
      limits,
      siteConfig.name,
    ),
    withdrawals: new WithdrawalService(
      auth,
      new PostgresWithdrawalRepository(database, new MutationStore(database)),
    ),
    portfolio: new PortfolioService(
      auth,
      new PostgresPortfolioRepository(database),
      new FinancialCalculator(),
    ),
    reports: new ReportService(
      auth,
      new PostgresReportRepository(database, storage.reportLocation),
      storage.reports,
      new ClamAvScanner(
        config.CLAMAV_HOST!,
        config.CLAMAV_PORT,
        config.SCAN_TIMEOUT_MS,
      ),
      new WorkerPdfValidator(
        config.MAX_REPORT_PAGES,
        config.PDF_VALIDATION_TIMEOUT_MS,
      ),
      limits,
      {
        bucket: config.REPORT_BUCKET,
        provider: config.STORAGE_PROVIDER,
        maxBytes: config.UPLOAD_MAX_BYTES,
        downloadTtl: config.DOWNLOAD_TTL_SECONDS,
        reportTimeZone: config.REPORT_TIME_ZONE,
        namespace: storage.namespace,
      },
    ),
    mfa: authentication.mfa,
  };
}
