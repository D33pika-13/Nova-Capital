# Functional Requirements and Technical Specification

## Summary

Saved requirements and specification plan for the website, client portal, admin dashboard and connected services. The functional and technical documents listed below are present. They describe the application contract; saving them does not establish implementation or deployment completion.

Saved on 11 November 2026 at the user's request. This document consolidates the requested service architecture, configurable connections, sequential feature development, security, local versus deployment testing, class-driven coding, scoped AGENTS.md guidance, functional requirements and technical specification.

## Agreed decisions

- Start with one frontend and one modular backend, initially hosted in one Next.js application. Identity, clients, portfolio, reports, offers and support are backend modules; separate microservices are not required initially.
- Connect authentication/login, PostgreSQL, private file storage, email, optional AI, shared rate limits, monitoring, scheduling and secrets through validated server-side configuration and provider interfaces.
- Define an initial low-cost profile and Azure adapter targets, including hybrid combinations. Verify current provider pricing and limits before choosing a hosted plan; do not assume a service is permanently free. Unsupported adapters must fail safely.
- Develop one numbered phase at a time and satisfy its test gate before advancing: foundation/configuration → database/isolation → authentication → client management → investments/snapshots → client dashboard → private reports → offers/announcements → public website/contact → support assistant → Azure profile → release verification.
- Include security with every feature: server-side authorization, client isolation, admin MFA, input validation, private storage, upload scanning, audit history, rate limits and secret protection.
- Keep local, staging and production tests and their evidence separate. Local success does not prove deployed connectivity, isolation or production readiness.
- Use classes and constructor injection for backend services, repositories and provider adapters. Use idiomatic React function components for UI. Maintain root and scoped AGENTS.md guidance, including each new feature module or independently maintained package.
- Maintain numbered functional requirements, technical specifications, acceptance criteria and traceability. Track actual verification separately.

## Saved references

- [Project brief and twelve-phase sequence](../investment_firm_website_coding_instructions.md), sections 15–18.
- [Functional requirements](functional-requirements.md).
- [Technical specification](technical-specification.md) and [API specification](api-specification.md).
- [Environment profiles](../infra/profiles.md).
- [Root coding instructions](../AGENTS.md) and scoped AGENTS.md files.
- [Implementation and verification evidence](implementation-status.md).

## Functional requirements

Maintain `functional-requirements.md` with uniquely numbered requirements grouped by feature:

- Public website: pages, navigation, editable branding, contact and legal content.
- Identity: login/logout, invitations, password reset, admin MFA, roles and account status.
- Client management: creation, unique IDs, search, editing and activation/suspension/deactivation.
- Investments: manual financial entry, validation, archival, historical snapshots and auditable corrections.
- Client portal: recorded values, allocation, charts, update history and honest empty states.
- Reports: uploads, reporting periods and authorized private downloads.
- Offers and announcements: eligibility, publication, validity and recipient visibility.
- Support: public FAQs, authenticated read-only financial answers, isolated history and human escalation.

Each requirement specifies its actor, prerequisites, expected behavior, permissions, failure behavior, acceptance criteria and phase. Required capabilities are separate from optional future enhancements.

## Technical specification

Maintain `technical-specification.md` defining:

- One frontend and one modular backend, with class-based services, repositories and provider adapters; React function components for UI.
- Module responsibilities, dependency boundaries and constructor injection through a configuration-driven composition root.
- Provider-neutral interfaces for identity, persistence, private storage, email, AI, rate limiting and telemetry.
- API operations and authentication, authorization, validation and safe-error contracts.
- Entities, ownership, financial precision, currency handling, snapshots and audits.
- Security: client isolation, admin MFA, sessions, secrets, private files, upload scanning and chatbot restrictions.
- Local, staging and production profiles with provider configuration, migration, backup/restore and rollback.

Define the initial profile separately from Azure adapters. Label planned integrations clearly so documentation does not imply implemented support.

## Verification and traceability

Connect every requirement to its module, phase and acceptance tests:

- Local: calculations, validation, class behavior, migrations, permissions and synthetic journeys.
- Staging: provider connectivity, email/auth callbacks, hosted database isolation, private downloads, shared limits and AI failure handling.
- Release: full admin/client journeys, security regression, restore and safe production smoke checks.

Update project instructions and applicable AGENTS.md references and resolve conflicting requirements. Record actual implementation evidence separately.

## Defaults and boundaries

Preserve the agreed feature scope and twelve-phase sequence. Keep funds with client brokers; exclude collection, automated trading and live integrations. Client financial records are read-only to clients and the chatbot. Use synthetic tests and manually reported values. Record unresolved business/legal policies rather than invent company facts; resolve implementation-critical policies before the relevant phase.
