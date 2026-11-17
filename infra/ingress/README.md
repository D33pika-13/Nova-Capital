# Temporary staging ingress

This Caddy profile belongs behind the owned Cloudflare Tunnel on the trusted Mac. Both listeners bind only to 127.0.0.1. It is not a standalone public proxy or a production deployment. The tunnel remains on port 3036, Caddy replaces network headers there, and the isolated Next.js package listens on port 3038. Keeping the tunnel alive preserves the current public hostname and Auth callbacks.

The proxy accepts only the configured public host, an HTTPS edge context and a single parseable Cloudflare connecting address. It replaces X-Real-IP, X-Forwarded-For, Host and protocol; removes Forwarded and X-Forwarded-Host; and disables administration, automatic TLS and request logging. The trusted boundary includes this Mac and its owned cloudflared process. A hostile local process is outside this profile's protection. No Cloudflare Worker is configured for this temporary hostname; a future Worker/proxy topology requires a new trust review.

Use the official Caddy **2.11.9** release. The verified mac_arm64 archive SHA-256 is `d075afc620376679a77b453399bf7ada264cab3280b2833e4ed1372abc0c1c13`; its extracted binary SHA-256 is `151fe2febcc0e7baf8a88d2e206953b813975aca3b0e35dd5573d826972caecd`. Other platforms need their own official digest verification. No global installation is needed.

Before enabling contact, run the real proxy checks:

```sh
CADDY_BIN=/path/to/verified/caddy pnpm check:ingress
INGRESS_LISTEN_PORT=3036 INGRESS_UPSTREAM_PORT=3038 \
INGRESS_PUBLIC_HOST=your-current-tunnel-host.example \
  /path/to/verified/caddy validate --config infra/ingress/Caddyfile --adapter caddyfile
```

The check uses owned random loopback ports and a temporary upstream, not the staging listeners. It verifies identity replacement, malformed/missing/multiple context denial, host/protocol enforcement, IPv6, cookies, redirects, body forwarding, log redaction and unavailable upstream behavior. It does not establish hosted ingress or mailbox delivery.

The current per-user launchd definitions live in the private staging session directory documented in `docs/deployment.md`. The app runs from a copied standalone package in the private cache, with copied static/public assets and a private runtime environment file. This avoids launchd reading the Desktop checkout. The Caddy config is also copied to that directory. Source edits alone do not update either deployed copy. Rebuild/check, stage a fresh package/config, validate, then restart only the owned app/proxy jobs. Do not restart cloudflared merely to update the app. Check HTTPS health/contact, protected session continuity and actual mailbox capture afterward. Do not start duplicate listeners or grant broader macOS file permissions to work around a failed start.

Before rollback, disable contact in both private environment copies and restart the app so no send can use unverified ingress. Then restore a known-good app/proxy package and verify health; retain the contact HMAC secret and ledger for replay reconciliation. If returning to a direct app listener on 3036, stop the owned proxy first, move the app back to that port and keep contact disabled. Never rotate the secret or retry an uncertain send as part of an automatic rollback.

References: [official release](https://github.com/caddyserver/caddy/releases/tag/v2.11.9), [Caddy proxy trust](https://caddyserver.com/docs/caddyfile/options), [reverse proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
