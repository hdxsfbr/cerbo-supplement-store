# Production image: build the SPA, build the API, ship ONE runtime image where Fastify serves
# /api/* and the static SPA (with history fallback). Migrations (schema, invariants, seeds)
# run on boot. See docs/ARCHITECTURE.md → Deployment.
#
#   docker build -t cerbo-store .
#   docker run -p 3000:3000 -e DATABASE_URL=postgres://… cerbo-store

# ── deps ───────────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

# ── build ──────────────────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY server/ server/
COPY web/ web/
RUN npm run build --workspace web && npm run build --workspace server

# ── runtime ────────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# Production deps for the server workspace only (web is already built to static files).
RUN npm ci --no-audit --no-fund --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/dist/index.js"]
