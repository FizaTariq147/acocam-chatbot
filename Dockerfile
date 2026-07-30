# ACOCAM chatbot API — Node 20 (Render free, Docker Hub, Fly.io image deploy)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/engines/package.json packages/engines/
COPY packages/application/package.json packages/application/
COPY packages/sdk-js/package.json packages/sdk-js/

RUN npm ci

COPY apps ./apps
COPY packages ./packages
COPY tenants ./tenants
COPY tsconfig.json ./

RUN npm run build && npm run reindex

FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/engines/package.json packages/engines/
COPY packages/application/package.json packages/application/
COPY packages/sdk-js/package.json packages/sdk-js/

RUN npm ci --omit=dev

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/domain/dist ./packages/domain/dist
COPY --from=builder /app/packages/engines/dist ./packages/engines/dist
COPY --from=builder /app/packages/application/dist ./packages/application/dist
COPY --from=builder /app/packages/sdk-js/dist ./packages/sdk-js/dist
COPY --from=builder /app/data ./data
COPY tenants ./tenants

EXPOSE 8787

# Hugging Face Spaces: set PORT=7860 in Space variables (app_port: 7860 in README YAML).
# Render/Fly: default PORT 8787 or platform-injected PORT.
CMD ["node", "apps/api/dist/index.js"]
