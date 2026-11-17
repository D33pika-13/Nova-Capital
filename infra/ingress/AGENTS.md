# Temporary staging ingress

- This profile runs only on loopback behind the owned Cloudflare Tunnel. Preserve the public URL and keep the Next.js origin inaccessible from off-machine clients.
- Trust only the tunnel's single Cloudflare connecting-IP value from loopback peers. Replace forwarded identity/host/protocol headers; never pass caller-supplied X-Real-IP through to contact rate limiting.
- Disable the proxy administration listener, automatic TLS provisioning and request/access logging. No request bodies, cookies, tokens or visitor addresses in logs/artifacts.
- Validate with the pinned real Caddy binary and real loopback HTTP tests before enabling staging contact. Prove header replacement, malformed/missing context denial, cookies/redirects/body streaming and unavailable upstream behavior.
- A trusted-host/tunnel boundary is required; this is not a public standalone proxy or a production deployment profile. Keep company/email capture and actual external delivery verification distinct.
