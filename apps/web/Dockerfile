# El frontend se publica normalmente en Cloud Storage + CDN. Esta imagen existe
# para el ambiente local y para despliegues donde Tecnología prefiera Cloud Run.
FROM node:22-alpine AS constructor
WORKDIR /repo
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
RUN npm ci --workspace=@sipra/web --include-workspace-root
COPY apps/web ./apps/web
RUN npm run build --workspace=@sipra/web

FROM nginx:alpine AS ejecucion
COPY --from=constructor /repo/apps/web/dist/browser /usr/share/nginx/html
# Como plantilla, no como configuración final: nginx sustituye ${API_URL} al
# arrancar, así la misma imagen sirve para cualquier ambiente.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
ENV API_URL=http://127.0.0.1:3000
EXPOSE 8080
