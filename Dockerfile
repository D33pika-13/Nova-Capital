# syntax=docker/dockerfile:1
# Verified OCI index; update this pin through a reviewed dependency/image refresh.
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN mkdir -p public
# Build without runtime credentials or cloud access. Only synthetic scan canaries.
RUN APP_ENV=test SERVICES_ENABLED=false SECRETS_PROVIDER=env \
    SUPABASE_SERVICE_ROLE_KEY=container-canary-not-a-real-service-key \
    CONTACT_HASH_SECRET=container-contact-canary-not-a-real-secret \
    OPENAI_API_KEY=container-openai-canary-not-a-real-key \
    ENTRA_CLIENT_SECRET=container-entra-canary-not-a-real-secret \
    AZURE_MONITOR_CONNECTION_STRING=synthetic-monitor-canary-not-a-real-connection \
    ENTRA_DIRECTORY_CLIENT_SECRET=container-directory-canary-not-a-real-secret \
    ENTRA_MFA_ENCRYPTION_KEYS='{"canary":"Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M"}' \
    pnpm check

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /app/.next/cache && chown node:node /app/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/standalone-entry.mjs"]
