# Contact workflow

## Configuration

Apply migration `20261111000500_contact_requests.sql`. The contact workflow uses the existing database, shared PostgreSQL rate limiter and configured email adapter. It is explicitly disabled by default, including when other services are connected. Enable only in the intended integrated environment:

```dotenv
SERVICES_ENABLED=true
CONTACT_ENABLED=true
CONTACT_HASH_SECRET=
CONTACT_CLIENT_IP_HEADER=none
SUPPORT_EMAIL=
EMAIL_FROM=
```

Supply a separate random server-only CONTACT_HASH_SECRET of 32–256 characters. Keep it out of source/browser configuration. SUPPORT_EMAIL is the fixed destination; EMAIL_FROM is the verified sending identity. Configure SMTP and the rest of the integrated profile using `.env.example`. Public company email/phone/address in `src/lib/site-config.ts` are independently reviewed display settings; no company facts are invented.

Development/test may use CONTACT_CLIENT_IP_HEADER=none. This deliberately shares one five-submissions/hour network bucket across visitors; it does not trust arbitrary forwarded headers. Staging/production require CONTACT_CLIENT_IP_HEADER=x-real-ip. The trusted reverse proxy must replace incoming X-Real-IP with its verified client address, and the application origin must reject direct traffic bypassing that proxy. An arbitrary request header is not identity proof. Missing, malformed or multi-address values fail closed. Do not enable header trust before verifying ingress behavior. The temporary owned Mac/tunnel profile now uses the verified loopback Caddy configuration in `infra/ingress`; a managed-host production ingress remains unverified.

## Submission and delivery states

Visitors send name, reply email, topic, 10–5000-character message and explicit permission to forward those details. A hidden website field is a bot trap. The API accepts no caller-selected recipient, sender, subject header or identity. Origin must exactly match APP_URL. The raw JSON body is capped at 24,000 bytes and the schema rejects unknown fields and invalid/header-injection values.

The server sends plain-text mail only to SUPPORT_EMAIL, using a fixed topic-based subject and EMAIL_FROM. The visitor's syntactically validated email appears as Reply-To and is explicitly identified in the message as unverified. There is no automatic email to the visitor, so this endpoint cannot send arbitrary acknowledgment messages to third parties. No portfolio records, admin notes, chat history or provider credentials are attached.

Each logical submission carries a browser-generated UUID. The private ledger stores only that reference, an HMAC digest, timestamps and processing/accepted/unknown status. It retains no name, email, body or raw network address. Status changes have status-only audit events with no invented human actor. The runtime role cannot read or write the table directly; narrow fixed-path functions enforce hash matching, state transitions and atomic claims.

- `processing`: the request has an exclusive committed send claim. A repeated request does not send again.
- `accepted`: the configured email adapter confirmed SMTP/service acceptance. Inbox delivery, human reading and a response remain unconfirmed.
- `unknown`: acceptance could not be established, or an old processing claim exceeded ten minutes. A repeated request does not send again automatically.

Successful acceptance returns HTTP 200; processing/unknown returns HTTP 202 with an explicit message and the same reference. Invalid input is 422, reused keys with changed content are 409, limits are 429, and disabled/misconfigured dependencies return safe 503 errors. No provider exception text or personal data is logged by the contact service.

The browser preserves the same payload/key for retries and locks the submitted fields until acceptance or a definite validation rejection. A network/45-second browser timeout does not prove a send failed. Retrying an unclaimed submission may perform its first send; retrying a claimed submission checks status without another send. An uncertain/processing response offers status checking. A new enquiry button appears only after acceptance. Reloading/closing the page loses this in-memory retry context; creating a fresh request can send another message. Keep the reference for human follow-up. No personal message is saved to localStorage or query strings.

## Shared limits and failure safety

A server-secret HMAC protects network/email rate keys before the shared limiter hashes them again. Limits are 30 attempts per network per minute, five new submissions per network/hour, three per reply email/hour and fifty globally/hour. Validation precedes database/send work. Existing submission status can be retrieved after new-send quota is exhausted, subject to the attempt limit. A limiter/database outage fails closed before a new claim/send.

A single durable claim precedes external mail. If a request crashes after claiming, it becomes uncertain rather than automatically reclaiming and sending again. If SMTP acceptance was committed but its database acknowledgment is lost, a subsequent outcome write cannot downgrade that accepted state. If outcome storage is unavailable, the persisted processing claim still prevents duplicate sends. Pending/unknown records require operator inspection of the configured support inbox/provider logs, with the submission reference, before any fresh enquiry. No automated resend or fabricated delivery confirmation is provided.

Secret rotation or changing the destination changes the payload HMAC; a pending old browser retry may return 409 instead of being sent under a new profile. Reconcile existing uncertain references before rotating/retrying. The ledger currently retains deduplication metadata; there is no invented business retention period or automatic deletion that would make an old key send again. Approve retention and operational cleanup before production release. Ensure ingress/application observability never records request bodies, Reply-To values, secrets or raw contact details.

## Local verification and remaining gates

Tests execute fresh PostgreSQL migrations and the narrow ledger functions, exercise real shared limits, capture a synthetic message on a real loopback SMTP server, and verify expected recipient/fields/Reply-To. They cover duplicate active send claims, changed payloads, uncertain mail, lost outcome acknowledgments, stale processing, private ledger access, non-null hash checks, header injection, consent, traps, proxy-header handling and safe unavailable modes. UI presentation checks cover labels, native validation and disabled state. A real browser also verified the unconfigured page at desktop/390-pixel mobile widths, no horizontal overflow, disabled controls, keyboard menu/privacy navigation and no observed console warnings/errors.

On 14 November 2026, the enabled staging browser submitted one synthetic enquiry through the public HTTPS URL. Its exact reference, text/plain content, fixed sender/recipient and Reply-To were observed in Mailtrap Sandbox. Sequential/concurrent replays left one captured message, one private ledger row and two status-only audits. Fourteen live API/database result groups cover replay/conflict, consent/trap/recipient/header-injection denial, same-origin/JSON/body bounds, ledger isolation and spoofed forwarded-header replacement. The 390-pixel browser has no horizontal overflow and an empty submission focuses the required name field. The existing MFA-admin session survives the proxy/package restart. Evidence is in `verification/contact-live-result-2026-11-14.json` and the contact browser/mobile/mailbox screenshots. Twenty-eight separate real native Caddy checks verify the loopback proxy; the live test did not exhaust send quotas or inject outages.

Only the synthetic recipient `contact-capture@nova-staging.example.test` is configured, captured by the existing Mailtrap Sandbox SMTP service. The non-production page explicitly requests synthetic details. This verifies test-mailbox receipt, not external delivery to a company inbox or a verified production sending domain. Actual company identity, jurisdiction, recipient/sender approval, privacy/legal content, managed-host ingress and broader release checks remain pending. No real person received a contact message.
