# Project instructions

Read `investment_firm_website_coding_instructions.md` before implementing features. Its latest requirement sections govern the architecture and development sequence. Read scoped AGENTS.md files for each area you change.

## Architecture
- Use TypeScript classes for backend application services, repositories, provider adapters, and financial domain behavior. Program against interfaces and inject dependencies through constructors.
- Prefer composition and small classes with one responsibility. Avoid global mutable state, static service locators, and unnecessary inheritance.
- Keep Next.js route handlers and server actions thin: validate input, obtain verified session context, invoke a service, and serialize a safe response.
- Use idiomatic React function components and hooks in the frontend. Class-driven business logic does not require React class components. Pure helpers, schemas, configuration objects, and framework entrypoints may remain functions/data.
- Keep credentials and provider SDKs server-side. Resolve validated provider configuration in a backend composition root. Do not instantiate dependencies inside domain services.

## Delivery and security
- Follow the numbered development phases and satisfy each phase's test gate before advancing.
- Build authorization, input validation, audit trails, client isolation, admin MFA, and safe errors alongside each feature. Never trust caller-supplied roles or client identity.
- Keep local, staging, and production configuration and data separate. Use synthetic test clients.
- Verify locally, then in deployed staging. Report local-tested, staging-verified, and production-deployed states separately. Never claim an unrun check passed.
- Run available lint/type/build checks and relevant behavioral tests. Document missing external configuration and blocked checks precisely.
- Do not provision paid resources, send external communications, or deploy to production without applicable user authorization.

## Scoped guidance
- `src/app/`: Next.js pages, layouts, route handlers and server actions.
- `src/components/`: shared React UI.
- `src/server/`: backend services and module-specific guidance.
- `supabase/`: PostgreSQL migrations, RLS and seed data.
- `infra/`: deployment profiles and infrastructure.
- `tests/`: unit, integration, security and end-to-end verification.
- Every new feature module or independently maintained package must include a concise AGENTS.md describing its responsibility, boundaries and required tests. Do not add one to every leaf directory. Keep shared rules here rather than duplicating them.

## Requirement references
Read `docs/functional-requirements.md` and `docs/technical-specification.md` alongside the project instructions. Record actual verification in `docs/implementation-status.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
