# Investment Firm Website & Client Portal — AI Coding Instructions

Use this prompt with **Codex**, **Claude Code**, or another coding agent in the project repository.

## 1. Project objective

Build a complete, professional investment-firm website with a secure client portal and an admin dashboard. This must be a functional application—not just a static landing page or UI mockup.

The firm works with clients' own broker accounts. Client funds remain with their brokers; the firm does not collect or custody client deposits through this website. The firm operates/trades on client accounts under its authorized arrangements and reports investment performance.

Supported asset classes:
- Stocks
- Forex
- Commodities
- Crypto

For the initial release, investment and performance information will be **entered manually by an administrator**. Do not build live broker integrations or automatic trading unless explicitly requested later.

## 2. Product and technology stack

Use the following stack unless the existing repository already has a suitable equivalent:
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase (PostgreSQL, Authentication, Row-Level Security, and Storage)
- Recharts for charts
- Lucide icons
- React Hook Form + Zod for validated forms

First inspect the repository and existing conventions. Preserve useful existing code and dependencies. If the repository is empty, initialize the application and implement the complete project.

Use a temporary brand name **NOVA CAPITAL**. Keep branding, contact details, and configuration easy to replace.

## 3. Public website

Create a polished, responsive public website with a premium financial-services visual style. Use a clean layout, strong typography, restrained colors, accessible contrast, and professional charts/illustrations where appropriate.

Include:

### Navigation
- Brand/logo
- Home
- About
- Services
- Markets
- Member Benefits / Offers
- Contact
- Client Login
- A clear primary call-to-action

### Homepage
- Hero headline: **“Your Investments. Your Growth.”**
- Short, accurate description of the firm's services
- CTA buttons: **Client Login** and **Explore Services**
- About the firm
- Supported markets: stocks, forex, commodities, and crypto
- Services and how the process works
- Explanation of client reporting and portfolio updates
- Member benefits, promotional offers, and travel offers
- FAQ section
- Contact section and footer

### Public content
- Provide editable content/configuration for company name, logo, contact details, social links, and legal links.
- Do not display fabricated performance statistics, client testimonials, awards, rankings, or claims.
- Clearly distinguish illustrative/demo content from real company information.

## 4. Authentication and client accounts

Implement secure authentication using Supabase Auth.

### Admin capabilities
- Admin can create client profiles and assign a unique client ID, such as `INV-1001`.
- Admin can invite clients through email or trigger a secure password setup/reset flow.
- Admin can activate, suspend, or deactivate client accounts.
- Admin can view and manage client records.

### Client capabilities
- Client can log in, log out, and reset their password.
- Client sees only their own account and investment information.
- Client ID is displayed in the dashboard.
- Client cannot edit financial records or administrative data.

### Security requirements
- Never store plaintext passwords.
- Never expose Supabase service-role keys in client-side code.
- Enforce authorization server-side and with Supabase Row-Level Security (RLS).
- Derive the authenticated user's identity from the verified session—not from a client-supplied ID.
- Deny access by default and validate all inputs.
- Protect admin routes and actions with explicit role checks.

## 5. Client dashboard

Build a responsive dashboard with a clear sidebar/navigation and the following sections.

### Overview
Display:
- Welcome message
- Client ID and account status
- Last portfolio update date
- Total invested amount (where recorded)
- Current reported portfolio value
- Net profit/loss
- Return percentage, with the calculation basis clearly defined

All financial values must come from database records. If data is unavailable, show an honest empty state—not invented numbers.

### Portfolio
- Asset allocation/breakdown by asset class
- Holdings or investment records entered by the admin
- Current reported values
- Profit/loss where sufficient data exists
- A performance chart based on actual portfolio snapshots

### History and reports
- Investment/update history
- Historical portfolio snapshots
- Downloadable client reports (PDF or other supported format)
- Report date and reporting period
- Notifications and announcements

### Offers
- View current member benefits, promotional offers, and travel offers
- Clearly show validity dates, eligibility, and terms where provided

## 6. Admin dashboard

Create a secure admin dashboard with role-based access.

### Admin overview
Show database-backed metrics such as:
- Total clients
- Active clients
- Total investment records
- Latest portfolio update activity
- Pending administrative tasks, if implemented

Do not hardcode dashboard metrics.

### Client management
- Create, edit, activate, suspend, and deactivate clients
- Assign and display unique client IDs
- Search and filter clients
- View a client's investment records and reporting history
- Use secure account invitation/reset flows

### Investment management
- Add, edit, and archive investment records
- Associate each record with the correct client
- Record asset class, description, amount invested, current reported value, dates, and notes as appropriate
- Validate amounts, dates, and ownership
- Avoid destructive deletion of financial history; prefer archival or correction records

### Portfolio updates
- Manually update a client's reported portfolio value and performance
- Create a dated portfolio snapshot for each update
- Maintain historical snapshots instead of overwriting the only record
- Record the admin who made each change
- Show the update/reporting date to clients

### Reports
- Upload or generate client reports
- Associate each report with the correct client and reporting period
- Ensure clients can access only their own reports
- Store reports in private Supabase Storage buckets and use authorized access/download URLs

### Offers and announcements
- Create, edit, publish, unpublish, and expire offers
- Add promotional, travel, and member-benefit content
- Manage announcements and notifications
- Support title, description, image, validity dates, terms, and publication status

## 7. Suggested database structure

Design a normalized PostgreSQL schema with migrations, foreign keys, indexes, constraints, and appropriate RLS policies. Suggested tables:

- `profiles` — user profile, role, client ID, account status
- `investments` — client investment records and asset class
- `portfolio_snapshots` — dated portfolio values and performance data
- `investment_snapshots` — optional per-investment historical values
- `client_reports` — report metadata and private storage path
- `offers` — promotional and member-benefit content
- `notifications` — client/admin notifications
- `audit_logs` — sensitive administrative and financial changes
- `chat_sessions` and `chat_messages` — chatbot history, if enabled

Use appropriate relationships, uniqueness constraints, and indexes. Include migrations and development seed data. Seed data must be clearly marked as demo data and must never be confused with actual client financial information.

## 8. Financial data integrity

- All financial figures must be sourced from database records.
- Never fabricate client balances, returns, profit/loss, historical performance, or investment activity.
- Clearly label figures as **manually reported** and show the **last updated/reporting date**.
- Define return calculations and their assumptions in the UI or documentation.
- Handle missing, incomplete, or inconsistent data transparently.
- Do not promise or imply guaranteed returns.
- Do not use fake charts or sample performance in production.
- Use demo/sample values only in an explicitly marked development/demo environment.

## 9. AI client support chatbot

Add a floating support chatbot on the public website and authenticated client dashboard.

### Chat interface
- Floating chat button in the bottom-right corner
- Expandable chat panel
- User and assistant message bubbles
- Timestamps
- Typing/loading indicator
- Suggested questions
- Clear chat / start new chat
- Responsive mobile layout
- Graceful error and retry states

Suggested welcome message:

> Hello! Welcome to NOVA CAPITAL Client Support. How can I assist you today?

Suggested questions:
- What is my current reported portfolio value?
- When was my portfolio last updated?
- What is my reported profit or loss?
- Can I view my investment breakdown?
- Where can I download my reports?
- What offers are currently available?
- How do I contact support?

### Chatbot capabilities
For authenticated clients, the chatbot may answer questions about:
- Their own reported portfolio value
- Their own latest update/reporting date
- Their own recorded profit/loss and asset breakdown
- Their own available reports
- Published offers and announcements
- Website/company FAQs
- Login, password reset, and support processes
- Contact details and escalation options

The chatbot must retrieve financial facts from controlled server-side database functions and explain those facts. It must not invent figures or infer missing financial data.

### AI implementation
- Use the OpenAI API from server-side code only.
- Store the API key in an environment variable such as `OPENAI_API_KEY`.
- Make the model configurable through environment variables.
- Support conversational context and streaming if practical.
- Add input validation, rate limiting, sensible token limits, and graceful handling of API failures.
- Keep API keys and privileged credentials out of the browser.

### Chatbot security and boundaries
- Authenticate dashboard users before providing personal financial information.
- Derive client identity from the verified session.
- Never trust a client ID supplied in a chat message or request body.
- Enforce RLS and server-side authorization.
- Provide the chatbot only the minimum data needed to answer the current question.
- Never expose other clients' information, admin notes, credentials, or internal secrets.
- Keep the chatbot read-only: it must not create or modify investments, change portfolio values, execute trades, or change allocations.
- It must not give personalized investment advice, trade recommendations, or guarantees. For such requests, explain the limitation and direct the client to an authorized human representative.
- Store chat history with client isolation and provide a clear/new-chat option.
- Admin support features may include reviewing conversations where permitted, identifying unanswered questions, managing FAQs and suggested questions, and escalating to human support.
- Provide a contact form, support email, or ticket escalation flow.

## 10. Security, privacy, and auditability

Implement:
- Supabase RLS policies for every client-owned table
- Server-side role checks for admin operations
- Private report/file storage
- Secure session handling
- Input validation and output encoding
- Protection against common web vulnerabilities
- Audit logs for sensitive admin and financial changes
- Safe error messages that do not expose secrets or internal details
- No broker passwords or trading credentials stored by this website

If broker integrations are considered later, use broker-approved APIs/OAuth and authorized access mechanisms. Do not collect or store clients' broker passwords.

## 11. Legal and responsible presentation

The firm operates on client broker accounts, which may involve regulated investment-management, advisory, securities, forex, commodity, or crypto activities depending on the jurisdiction and arrangement.

- Do not claim that the website itself establishes legal authorization or regulatory compliance.
- Do not publish guaranteed-return claims or misleading performance advertising.
- Include configurable links/pages for Terms and Conditions, Privacy Policy, Risk Disclosure, and relevant disclaimers.
- Clearly explain that portfolio information is manually reported and identify its reporting date.
- Flag regulatory and legal content for review by qualified counsel before production launch, especially for India-specific requirements.

## 12. Design and UX expectations

- Premium, trustworthy financial-services aesthetic
- Responsive across desktop, tablet, and mobile
- Consistent spacing, typography, colors, and component patterns
- Accessible navigation and forms
- Loading, empty, success, and error states
- Clear data labels and reporting dates
- No excessive animations or clutter
- Use realistic layouts and polished components, not generic placeholder blocks

Reference websites for design inspiration (do not copy their branding or claim affiliation):
- eToro — https://www.etoro.com/
- Interactive Brokers — https://www.interactivebrokers.com/
- Deriv — https://deriv.com/
- Axi — https://www.axi.com/
- Capital.com — https://capital.com/
- IG — https://www.ig.com/
- Pepperstone — https://pepperstone.com/
- Binance — https://www.binance.com/
- Coinbase — https://www.coinbase.com/
- Kraken — https://www.kraken.com/
- Bybit — https://www.bybit.com/
- MQL5 Signals — https://www.mql5.com/en/signals
- Myfxbook — https://www.myfxbook.com/
- Darwinex — https://www.darwinex.com/
- ZuluTrade — https://www.zulutrade.com/
- TradingView — https://www.tradingview.com/
- Collective2 — https://collective2.com/
- DupliTrade — https://www.duplitrade.com/
- FX Blue — https://www.fxblue.com/

These are visual/product references only. Adapt the design to this firm's actual operating model.

## 13. Development workflow and deliverables

Work in the repository and complete the application end-to-end.

1. Inspect the existing codebase, dependencies, and project conventions.
2. Briefly outline the implementation plan.
3. Implement the public website, authentication, client dashboard, admin dashboard, database schema, RLS, storage policies, and chatbot.
4. Build reusable components and maintain a clean folder structure.
5. Add migrations, seed/demo data, and environment configuration.
6. Add `.env.example` with required variables and safe placeholders.
7. Add a README covering setup, Supabase configuration, migrations, seed data, admin setup, local development, testing, and deployment.
8. Run available linting, type checks, and tests.
9. Fix errors and verify critical user flows.
10. Do not stop at a static mockup or leave core features as TODOs. If a feature cannot be completed, explain exactly what remains and why.

## 14. Acceptance criteria

The project is complete when:

- Public pages are responsive and polished.
- Client and admin authentication/authorization work.
- Admin can create and manage clients.
- Admin can add investment records and dated portfolio updates.
- Client can see only their own records and reports.
- Performance charts use real snapshot records.
- Offers and announcements can be managed and displayed.
- The chatbot answers FAQs and authenticated clients' data questions using authorized, database-backed information.
- RLS and private storage prevent cross-client data access.
- Sensitive changes are auditable.
- No financial figures or returns are fabricated.
- Setup instructions and environment configuration are documented.
- Lint/type checks and available tests pass.

**Start by inspecting the repository, then implement the complete application in a structured, production-conscious way.**

## 15. Configuration-driven service architecture (updated requirement)

This section supersedes earlier requirements that couple the application exclusively to Supabase or OpenAI. Keep one frontend and one modular backend initially; managed dependencies are not separate custom microservices.

### Provider independence

- Connect external services through typed backend interfaces and provider adapters. Business logic and UI components must not depend directly on provider SDKs.
- Select providers per environment through validated configuration. Support hybrid deployments, for example Azure hosting with Supabase authentication/database/storage.
- Keep application authorization, client IDs, account status, and role assignments under application control. Map verified provider identities to stable internal user IDs.
- Provider changes require an implemented adapter and any necessary data/identity/file migration. Configuration alone does not migrate accounts, passwords, database records, or objects.
- Keep PostgreSQL as the initial database engine for portability. Use portable schema migrations and explicit client-isolation policies. Do not assume Supabase auth.uid() exists on Azure PostgreSQL: implement the equivalent trusted identity context and RLS policies for that deployment, with isolation tests and least-privilege database roles.
- All personal-data and financial API requests pass through the backend. Return only safe public configuration to the frontend.

### Service plan

| Capability | Initial low-cost option | Azure option / adapter target |
|---|---|---|
| Frontend and backend hosting | Local Docker for development; hosting selected after commercial-use and runtime checks | Azure Container Apps for containerized Next.js/backend; Static Web Apps only for a compatible static frontend deployment |
| Login and account lifecycle | Supabase Auth | Microsoft Entra External ID; implement invitation/reset behavior using supported provider flows |
| Database | Supabase PostgreSQL | Azure Database for PostgreSQL |
| Private reports and images | Supabase Storage | Azure Blob Storage with private containers and short-lived authorized downloads |
| Transactional email | Configurable SMTP provider; local mail capture for development | Approved SMTP provider from Azure hosting; ACS Email is a legacy target subject to retirement/onboarding restrictions, not a new-deployment default |
| Support AI | OpenAI API; optional FAQ-only mode without AI credentials | Azure OpenAI deployment adapter |
| Rate limiting | Shared PostgreSQL-backed limiter initially | Shared PostgreSQL-backed limiter or managed Redis-compatible service |
| Monitoring | Structured logs and OpenTelemetry | Azure Monitor / Application Insights via OpenTelemetry |
| Scheduled work | Local scheduler in development; deployment scheduler in hosted environments | Azure Container Apps Jobs or Azure Functions timer triggers |
| Secrets | Ignored local environment files for development | Azure Key Vault with managed identity |

Free-tier availability, commercial-use terms, quotas, idle suspension, backups, and region availability must be checked before deployment. Do not describe the entire system as free: AI, email, domains, backups, and usage beyond included quotas may incur costs. Do not create paid resources or enable automatic paid fallback without explicit spend authorization.

Email lifecycle review (11 November 2026): Microsoft's [ACS retirement guidance](https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide) lists ACS Email for retirement on September 30, 2028, with onboarding/expansion restrictions beginning October 23, 2026. Retain the already permitted SMTP option for new Azure deployments; any existing ACS integration would require explicit eligibility and migration review. This does not remove invitation/contact/email verification requirements.

### Configuration contract

Provide `.env.example`, environment-specific deployment examples, and startup validation for at least:

```dotenv
APP_ENV=development
APP_URL=http://localhost:3000
AUTH_PROVIDER=supabase
DATABASE_PROVIDER=postgres
STORAGE_PROVIDER=supabase
EMAIL_PROVIDER=smtp
AI_PROVIDER=disabled
RATE_LIMIT_PROVIDER=postgres
OBSERVABILITY_PROVIDER=console
SCHEDULER_PROVIDER=local
SECRETS_PROVIDER=env
```

Document required provider-specific settings separately, including database connection strings, auth issuer/audience/callback settings, storage bucket/container names, SMTP settings, and AI endpoint/model or Azure deployment/API-version settings. Never commit real credentials. Use managed identity where supported on Azure. Keep privileged configuration and SDKs server-side.

### Adapter behavior and rollout

1. Define contracts for identity/session verification and account lifecycle, financial repositories, private storage, email, support AI, rate limiting, and telemetry.
2. Implement and verify the initial Supabase/PostgreSQL/SMTP configuration. FAQ-only mode must clearly disclose that personalized AI answers are unavailable.
3. Implement Azure adapters behind the same contracts before claiming Azure support. Document unimplemented adapters explicitly; fail startup when one is selected.
4. Keep security-critical dependencies fail-closed. Do not silently replace authentication, database, storage, or rate limiting with local or in-memory implementations in production. AI outages may fall back to approved FAQs and human support without invented portfolio answers.
5. Include timeouts, bounded retries only where safe, duplicate-send/write protection, redacted logs, and dependency health checks without public secrets.
6. Verify login/reset/invite flows, suspended-account enforcement, admin authorization, cross-client database and file isolation, report access expiry, audit trails, and shared rate limits for each supported deployment profile.
7. Document backup/restore and provider migration procedures, including identity mapping, password-reset needs, report-file transfer, cutover, and rollback.

Acceptance requires a working initial provider profile, validated configuration, documented deployment options, and verified adapters for every provider advertised as supported. An example environment file alone is not a completed provider integration.

## 16. Sequential feature development and test gates

Implement in the following order. Each phase delivers usable behavior with its required automated and manual verification. Fix failed gates before proceeding; do not defer all testing to the final phase. Run lint, type checks, and a production build as applicable throughout. Build security, validation, auditability, accessibility, and honest empty/error states into the feature that needs them.

| Phase | Development scope | Required verification / gate |
|---|---|---|
| 1. Foundation and configuration | Initialize Next.js/TypeScript, design tokens, page shells, backend module structure, provider interfaces, validated environment configuration, safe logging, local setup and CI. Define initial Supabase and future Azure deployment profiles. | Clean checkout installs and builds; missing/invalid provider configuration fails safely; secrets stay out of browser assets; local startup works. Future adapters are explicitly unavailable until implemented. |
| 2. Database and isolation | Create portable PostgreSQL migrations, stable internal identities/provider mappings, profiles/roles/status, client ID uniqueness, initial client-owned schema, audit infrastructure, least-privilege roles and RLS. Add remaining table migrations alongside their features. | Fresh database migrates successfully; constraints reject invalid relationships; anonymous access is denied; client A cannot read/write client B's records through database access; application role cannot bypass isolation. Use isolated test identities. |
| 3. Login and authorization | Implement login/logout, secure sessions, password reset, admin bootstrap, protected client/admin routes, server-side role checks, suspended/deactivated-account enforcement and shared rate limits. | Valid/invalid login; reset flow through test mailbox; logout invalidates access; expired sessions rejected; client cannot call admin APIs; role/client-ID spoofing fails; suspension blocks existing sessions on subsequent protected requests. |
| 4. Admin client management | Build client search/detail/edit, unique client IDs, invitations, status changes, notification email adapter and auditable administrative actions. | Create/invite/edit/suspend/reactivate/deactivate an isolated test client; invitation replay/expiry and duplicate requests handled safely; client cannot edit administrative data; audit records identify the acting admin. |
| 5. Investments and portfolio snapshots | Build admin investment entry/edit/archive and dated portfolio updates. Define currency, valuation and cash-flow rules before implementing P/L and return calculations. Preserve historical snapshots and correction trails. | Validate amount/date/currency/ownership; reject mismatched client associations; verify calculations with known fixtures, zero/missing basis and cash flows; corrections preserve history; retries do not duplicate writes; audit records are created atomically. |
| 6. Client portfolio dashboard | Show account status/ID, recorded values, allocation, snapshot charts and history from the authenticated client's records. Display manual-report labels, calculation basis, dates and empty states. | Compare client display against phase 5 records; client A cannot request B's data; charts reflect stored snapshots; mixed currencies are not summed without an explicit conversion basis; mobile/accessibility and missing-data behavior checked. |
| 7. Private reports | Implement admin upload/metadata/archive, file validation, private storage adapter and authorized client downloads. | Correct client can download; other clients and anonymous users cannot; validate file type/size; signed links expire and cannot be newly issued after suspension; prevent arbitrary object-path access; verify upload failure/retry cleanup. Document signed links' validity window. |
| 8. Offers and announcements | Implement admin draft/publish/unpublish/expire controls, validity/eligibility/terms, client announcements and notification read state. Add scheduler integration for maintenance. | Unpublished/expired offers stay hidden; validity boundaries use a documented timezone; only intended recipients see announcements; scheduler runs are repeatable without duplicate effects; admin-only writes enforced. |
| 9. Public website | Complete Home, About, Services, Markets, Benefits, FAQ, contact, legal-page structure and editable branding/configuration. Connect published offers and a validated, rate-limited contact workflow. | Check responsive layouts, keyboard navigation, links, form validation/delivery through test mailbox, basic SEO and content accuracy; no invented performance or unsupported claims; legal text marked for review. |
| 10. Support chatbot | Build public/client chat UI, controlled FAQ answers, configurable AI adapter, session-derived read-only financial tools, isolated history, minimum-data retrieval and human escalation. | Public users receive no personal data; client spoofing/prompt injection cannot cross accounts or modify records; tool answers match stored values; sensitive admin notes are excluded; test API outage/timeout, token limits, rate limits, history isolation and clear/new-chat behavior. |
| 11. Azure provider profile | Implement Azure identity, Blob Storage, PostgreSQL identity-context/RLS configuration, email and Azure OpenAI adapters as selected. Add deployment templates, managed identity/Key Vault and monitoring configuration. | Run the same auth, cross-client isolation, private-file, financial and chatbot contract/integration checks against Azure. Rehearse data/identity/file migration and rollback in staging. No paid provisioning without spend authorization. |
| 12. Release verification and deployment | Run integrated end-to-end regression, dependency/security checks, representative load checks, backup/restore rehearsal, migration rehearsal, operational alerts and deployment documentation. Review company/legal content and deployment costs. | In staging: admin invites client -> client sets password -> admin records investment/snapshot and uploads report -> client sees only their data -> chatbot answers accurately -> suspension blocks access. Verify restore works. After authorized production deployment, run a safe smoke check and verify live state. |

### Milestones

- After phase 3: secure application foundation with working login and access controls.
- After phase 6: core investment workflow works end-to-end, from admin entry to client dashboard.
- After phase 9: website and portal work with private reports, offers and contact support.
- After phase 10: the initial provider profile is feature-complete, pending release verification.
- After phase 11: Azure is a verified deployment option. If only the initial provider profile is needed for the first release, phase 12 may follow phase 10 and Azure work remains explicitly scheduled and unsupported until completed.
- After phase 12: release gates are satisfied for the selected profile; production readiness and actual deployment are reported separately.

### Test organization

- Unit tests: financial calculations, validation, configuration parsing and time/eligibility rules.
- Database/integration tests: migrations, RLS, role/status enforcement, audit atomicity, identity/storage/email adapters and shared limits.
- End-to-end tests: admin and client journeys, password/invitation flows, report access, chatbot permissions and negative access cases.
- Manual review: responsive/accessibility behavior, factual public copy, email/report presentation and production configuration.
- CI uses isolated fixtures and test services; never real client financial data or production credentials. Repeat provider contract tests for every advertised supported profile.


## 17. Class-driven implementation and scoped agent guidance

- Backend services, repositories, domain behavior and provider adapters must use focused TypeScript classes, interfaces and constructor injection. Prefer composition over inheritance.
- Keep framework entrypoints thin. Use standard React function components/hooks, pure helpers and declarative validation schemas where appropriate.
- A backend composition root creates the configured providers; domain code must not construct concrete cloud SDK clients or read environment variables directly.
- Maintain root AGENTS.md and scoped guidance for application routes, UI components, backend, provider adapters, database, infrastructure and tests. Each new feature module/package must include AGENTS.md with responsibilities, boundaries and test gates.
- Initial feature modules are identity, clients, portfolio, reports, offers and support. These are internal backend modules, not independently deployed microservices.
- Local tests and deployed staging tests are separate completion gates. Add mandatory admin MFA, upload malware scanning policy and an incident-response runbook to the relevant feature/release deliverables.
- Agent guidance files and folders establish conventions only; they do not mean application features or integrations are implemented.

## 18. Requirements and implementation evidence

The agreed documentation plan is saved in `docs/requirements-and-specification-plan.md`. Use `docs/functional-requirements.md` and `docs/technical-specification.md` as feature and architecture contracts, alongside this brief. Track actual local/staging/production evidence and outstanding work in `docs/implementation-status.md`; saved documentation and generated schemas are not proof of a completed application.

## 22. Deepika testing feedback (13 November 2026)

This section supersedes earlier UI badge and FAQ prompt requirements. Support international valuation currencies with separate currency totals and no implicit FX conversion. Remove the portfolio manual-update badge while retaining reporting dates and accurate legal disclosures. Record and display completed broker withdrawal amounts, currencies and dates; this is reporting, not money movement. Preserve originals on correction and audit writes atomically. Remove the public FAQ prompts “How is portfolio information updated?” and “Are returns guaranteed?” while retaining accurate risk/support guidance. Name the support assistant Maya. Private reports must remain in the client flow; an admin session at that URL must explain the account mismatch and offer sign-out rather than redirecting into admin. Clients must have password-change and authenticator-MFA setup/login options. Verified enrolled factors require AAL2 on protected requests. Verify all of this locally and on the current free Supabase staging profile with synthetic accounts.

## 23. Direct database scheduling profile

Add `SCHEDULER_PROVIDER=database` for an owner-installed, guarded pg_cron job on the selected PostgreSQL provider. Keep HTTP scheduler execution disabled in this mode and avoid shared HTTP credentials. Reuse the existing bounded maintenance capability and private terminal ledger. Owner setup must preserve provider grants, enforce explicit target/environment/operation intent, drop to the runtime role without inheriting it, and deny client Cron administration. Default to fifteen minutes; accelerated verification is restricted to test/staging. Bound operational-history retention and preserve business/audit records. Require actual Cron execution plus committed scheduler-origin business outcomes before claiming verification; keep hosted recovery/alerts and production authorization separate.

## 24. Deepika Education and follow-up feedback (14 November 2026)

Add a public Education page with separate Premium Webinars and Individual Mentorship Sessions cards. Each opens a request form with the service preselected. Collect full name, email, phone/WhatsApp, preferred service and optional message from guests and registered visitors; store consented submissions for MFA-admin review. Show “Thank you for your interest! Our team has received your request and will contact you shortly.” only after storage commits. Match the existing design and mobile behavior. Validate, limit abuse, preserve exact-request idempotency, deny public/client listing and keep personal fields out of audits/logs. No automatic outbound message, booking, payment or new paid resource is implied.

Remove the long return-calculation paragraph marked in Deepika’s screenshot; retain factual dates/basis fields and existing risk disclosure. Offer supported international currencies including USD/EUR/GBP in the chart; currencies with no recorded snapshots show an explicit empty state and never a fabricated balance/conversion.
