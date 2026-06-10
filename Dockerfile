# Multi-stage build. ONE image runs either the API or the email worker (CMD overridden in compose).
# Stage 1: install ALL deps (incl. dev) for the build.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: compile TS -> dist, then drop dev deps so the runner stays slim.
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# Stage 3: minimal non-root runtime.
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./
USER app
EXPOSE 3000
# Node 24 ships a global fetch — no extra deps needed for the probe.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Default role = API; compose overrides `command` for the worker.
CMD ["node", "dist/server.js"]
