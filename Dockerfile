# syntax=docker/dockerfile:1

# ---- dependencies ---------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci` runs the postinstall hook, which generates the Prisma client.
RUN npm ci

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A build-time DATABASE_URL is only needed to satisfy the schema parser; no
# connection is opened while building.
ENV DATABASE_URL="file:./build.db"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma's schema and generated client are needed at runtime.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

USER nextjs
EXPOSE 3000

# Apply any pending migrations, then serve.
CMD ["sh", "-c", "npx prisma migrate deploy || true; node server.js"]
