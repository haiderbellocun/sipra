# ── Etapa 1 — dependencias y compilación ────────────────────────────────────
FROM node:22-alpine AS constructor
WORKDIR /repo

# Se copian primero los manifiestos para aprovechar la caché de capas.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# La red de Cloud Build a veces corta descargas del registro (ECONNRESET):
# npm reintenta con esperas crecientes y menos conexiones simultáneas.
RUN npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 180000 \
 && npm config set fetch-timeout 600000 \
 && npm config set maxsockets 8
RUN npm ci --workspace=@sipra/api --include-workspace-root

COPY apps/api ./apps/api
RUN npm run build --workspace=@sipra/api

# Se poda a dependencias de producción para la imagen final.
RUN npm ci --workspace=@sipra/api --include-workspace-root --omit=dev

# ── Etapa 2 — imagen de ejecución ───────────────────────────────────────────
FROM node:22-alpine AS ejecucion
ENV NODE_ENV=production
WORKDIR /app

# Usuario sin privilegios: nada corre como root.
RUN addgroup -S sipra && adduser -S sipra -G sipra

COPY --from=constructor --chown=sipra:sipra /repo/node_modules ./node_modules
COPY --from=constructor --chown=sipra:sipra /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=constructor --chown=sipra:sipra /repo/apps/api/dist ./dist
COPY --from=constructor --chown=sipra:sipra /repo/apps/api/package.json ./package.json

USER sipra
# Cloud Run inyecta PORT; el valor local es solo un respaldo.
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
