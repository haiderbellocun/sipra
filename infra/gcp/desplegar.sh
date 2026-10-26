#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SIPRA PRÁCTICAS — construir y desplegar en Cloud Run
#
# Se ejecuta desde Cloud Shell, dentro de la carpeta del proyecto.
#
# Si la cuenta tiene permiso para asignar roles, usa las cuentas de servicio de
# mínimo privilegio. Si no lo tiene —el caso habitual de una cuenta que crea
# recursos pero no reparte permisos— recurre a la cuenta de cómputo por defecto
# y lo dice en voz alta: esa cuenta tiene permisos amplios sobre todo el
# proyecto, lo cual es tolerable en un ambiente de desarrollo con datos
# sintéticos y no lo es en producción.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROYECTO="${1:-cun-it-fab-contenido-practicas}"
REGION="${2:-us-central1}"
AMBIENTE="${3:-dev}"

azul() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
aviso(){ printf '  \033[1;33m!\033[0m %s\n' "$1"; }

gcloud config set project "$PROYECTO" >/dev/null
NUMERO="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')"
CONEXION="$PROYECTO:$REGION:sipra-$AMBIENTE"
REGISTRO="$REGION-docker.pkg.dev/$PROYECTO/sipra"
BUCKET="$PROYECTO-sipra-$AMBIENTE-docs"
# Con SIPRA_ETIQUETA=<etiqueta> se reutilizan imágenes ya construidas y se
# salta la construcción: útil cuando falló un paso posterior y el código no
# cambió, porque construir las dos imágenes toma varios minutos.
ETIQUETA="${SIPRA_ETIQUETA:-$(date +%Y%m%d-%H%M%S)}"
# Con SIPRA_ETIQUETA_API=<etiqueta> se reutiliza solo la imagen de la API y se
# construye únicamente el frontend: el caso de un cambio visual sin tocar el
# servidor. Las migraciones vuelven a correr; son idempotentes.
ETIQUETA_API="${SIPRA_ETIQUETA_API:-$ETIQUETA}"
# ── Lectura documental asistida ────────────────────────────────────────────
# IA_DRIVER=openai activa la validación automática con OpenAI. Exige el
# secreto sipra-$AMBIENTE-openai en Secret Manager (la llave nunca va en el
# repositorio ni en la línea de comandos). Sin esa variable el ambiente sigue
# con el lector simulado, que no genera costo.
IA_DRIVER="${IA_DRIVER:-simulado}"
OPENAI_MODELO="${OPENAI_MODELO:-gpt-6-luna}"
OPENAI_ESFUERZO="${OPENAI_ESFUERZO:-low}"
SECRETO_OPENAI="sipra-$AMBIENTE-openai"

azul "Proyecto $PROYECTO · región $REGION · ambiente $AMBIENTE · IA: $IA_DRIVER"

# Se valida todo ANTES de construir imágenes: un error aquí cuesta segundos;
# descubrirlo al arrancar la API cuesta los minutos de la construcción.
IA_ENV="IA_DRIVER=$IA_DRIVER"
IA_SECRETS=""
case "$IA_DRIVER" in
  simulado) ;;
  openai)
    case "$OPENAI_ESFUERZO" in none|minimal|low|medium|high|xhigh|max) ;; *)
      printf '  \033[0;31m✗\033[0m OPENAI_ESFUERZO=%s no es válido (none, minimal, low, medium, high, xhigh, max).\n' "$OPENAI_ESFUERZO"; exit 1 ;;
    esac
    if ! gcloud secrets describe "$SECRETO_OPENAI" >/dev/null 2>&1; then
      printf '  \033[0;31m✗\033[0m Falta el secreto %s con la llave de OpenAI. Créelo así (pegue la llave y termine con Ctrl+D):\n' "$SECRETO_OPENAI"
      printf '      gcloud secrets create %s --replication-policy=automatic --data-file=-\n' "$SECRETO_OPENAI"
      printf '    y vuelva a ejecutar con IA_DRIVER=openai. Para rotarla: gcloud secrets versions add %s --data-file=-\n' "$SECRETO_OPENAI"
      exit 1
    fi
    if gcloud secrets versions access latest --secret="$SECRETO_OPENAI" 2>/dev/null | grep -q '^sk-SU-LLAVE'; then
      printf '  \033[0;31m✗\033[0m El secreto %s contiene el texto de ejemplo, no una llave. Agregue la real:\n' "$SECRETO_OPENAI"
      printf "      printf '%%s' 'sk-…' | gcloud secrets versions add %s --data-file=-\n" "$SECRETO_OPENAI"
      exit 1
    fi
    IA_ENV="IA_DRIVER=openai,OPENAI_MODELO=$OPENAI_MODELO,OPENAI_ESFUERZO=$OPENAI_ESFUERZO"
    IA_SECRETS=",OPENAI_API_KEY=$SECRETO_OPENAI:latest"
    ok "lectura asistida con OpenAI · modelo $OPENAI_MODELO · esfuerzo $OPENAI_ESFUERZO"
    ;;
  anthropic)
    if ! gcloud secrets describe "sipra-$AMBIENTE-anthropic" >/dev/null 2>&1; then
      printf '  \033[0;31m✗\033[0m Falta el secreto sipra-%s-anthropic.\n' "$AMBIENTE"; exit 1
    fi
    IA_ENV="IA_DRIVER=anthropic"
    IA_SECRETS=",ANTHROPIC_API_KEY=sipra-$AMBIENTE-anthropic:latest"
    ;;
  *)
    printf '  \033[0;31m✗\033[0m IA_DRIVER=%s no es válido. Use simulado, openai o anthropic (en minúsculas).\n' "$IA_DRIVER"; exit 1 ;;
esac

# ── Cómo se llega a la base: IP privada o conector ─────────────────────────
# Si la instancia tiene IP privada (infra/gcp/red-privada.sh), la aplicación
# conecta por la VPC: sin conector de Cloud SQL y, por tanto, sin exigir
# roles/cloudsql.client, que solo se concede a nivel de proyecto.
IP_PRIVADA="$(gcloud sql instances describe "sipra-$AMBIENTE" --format=json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(next((i["ipAddress"] for i in d.get("ipAddresses", []) if i["type"] == "PRIVATE"), ""))')"

if [ -n "$IP_PRIVADA" ]; then
  RED_ARGS=(--network=sipra-red --subnet="sipra-subred-$REGION" --vpc-egress=private-ranges-only)
  DB_ENV="DB_HOST=$IP_PRIVADA,DB_PORT=5432,DB_SSL=true"
  ok "base por IP privada $IP_PRIVADA (red sipra-red)"
else
  RED_ARGS=(--set-cloudsql-instances="$CONEXION")
  DB_ENV="DB_SOCKET_PATH=/cloudsql/$CONEXION"
  aviso "La instancia no tiene IP privada: se usa el conector de Cloud SQL, que"
  aviso "exige roles/cloudsql.client. Si falla, ejecute infra/gcp/red-privada.sh."
fi

# ── Bucket privado de documentos ───────────────────────────────────────────
# Sin él, cada carga de documento falla con un error 500. Se crea una sola
# vez, privado (sin acceso público) y con acceso uniforme a nivel de bucket.
if gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  ok "bucket gs://$BUCKET"
else
  gcloud storage buckets create "gs://$BUCKET" --project="$PROYECTO" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention --quiet
  ok "bucket gs://$BUCKET creado"
fi

# ── Qué identidad puede usar la aplicación ─────────────────────────────────
# Se prefiere siempre la cuenta de mínimo privilegio. permisos.sh le concede
# lo que se da sobre el recurso (secretos, bucket) e intenta lo de proyecto.
SA_MINIMO="sipra-app-$AMBIENTE@$PROYECTO.iam.gserviceaccount.com"
SA_DEFECTO="$NUMERO-compute@developer.gserviceaccount.com"

tiene_cloudsql() {
  gcloud projects get-iam-policy "$PROYECTO" --flatten="bindings[].members" \
    --filter="bindings.members:$1 AND bindings.role=roles/cloudsql.client" \
    --format='value(bindings.role)' 2>/dev/null | grep -q cloudsql
}

if gcloud iam service-accounts describe "$SA_MINIMO" >/dev/null 2>&1; then
  SA="$SA_MINIMO"
  bash infra/gcp/permisos.sh "$PROYECTO" "$REGION" "$AMBIENTE" "$SA"
  if [ -z "$IP_PRIVADA" ] && ! tiene_cloudsql "$SA"; then
    SA="$SA_DEFECTO"
    aviso "Sin IP privada y sin roles/cloudsql.client en $SA_MINIMO: se cae a la"
    aviso "cuenta de cómputo por defecto."
    bash infra/gcp/permisos.sh "$PROYECTO" "$REGION" "$AMBIENTE" "$SA"
  fi
else
  SA="$SA_DEFECTO"
  aviso "No existe $SA_MINIMO: se usa la cuenta de cómputo por defecto."
  bash infra/gcp/permisos.sh "$PROYECTO" "$REGION" "$AMBIENTE" "$SA"
fi
ok "identidad de la aplicación: $SA"

# ── Imágenes ───────────────────────────────────────────────────────────────
# `--tag` no sirve: asume un único Dockerfile en la raíz del contexto y aquí
# hay dos, cada uno necesitando el monorepo entero como contexto. Se construye
# con un archivo de configuración que invoca `docker build -f`.
#
# Cloud Build corre con una identidad propia. En proyectos nuevos es la cuenta
# de cómputo por defecto; en proyectos con la política de concesiones
# automáticas desactivada esa cuenta no tiene ningún rol y la construcción ni
# siquiera arranca. Si eso pasa se reintenta con la cuenta heredada de Cloud
# Build, que sí trae sus roles de fábrica.
SA_BUILD_HEREDADA="$NUMERO@cloudbuild.gserviceaccount.com"
construir() {
  local dockerfile="$1" imagen="$2"
  local sustituciones="_DOCKERFILE=$dockerfile,_IMAGEN=$imagen"
  if gcloud builds submit --config infra/gcp/nube-imagen.yaml \
       --substitutions="$sustituciones" --quiet; then
    return 0
  fi
  aviso "La construcción falló con la identidad por defecto de Cloud Build."
  if ! gcloud iam service-accounts describe "$SA_BUILD_HEREDADA" >/dev/null 2>&1; then
    aviso "No existe $SA_BUILD_HEREDADA: no hay identidad alterna que probar."
    return 1
  fi
  aviso "Reintentando con $SA_BUILD_HEREDADA."
  gcloud builds submit --config infra/gcp/nube-imagen.yaml \
    --substitutions="$sustituciones" \
    --service-account="projects/$PROYECTO/serviceAccounts/$SA_BUILD_HEREDADA" --quiet
}

if [ -n "${SIPRA_ETIQUETA:-}" ]; then
  azul "Reutilizando las imágenes ya construidas con la etiqueta $ETIQUETA"
  for imagen in "$REGISTRO/api:$ETIQUETA_API" "$REGISTRO/web:$ETIQUETA"; do
    gcloud artifacts docker images describe "$imagen" >/dev/null 2>&1 \
      || { aviso "No existe $imagen en el registro."; exit 1; }
    ok "$imagen"
  done
else
  if [ -n "${SIPRA_ETIQUETA_API:-}" ]; then
    gcloud artifacts docker images describe "$REGISTRO/api:$ETIQUETA_API" >/dev/null 2>&1 \
      || { aviso "No existe $REGISTRO/api:$ETIQUETA_API en el registro."; exit 1; }
    ok "API reutilizada: $REGISTRO/api:$ETIQUETA_API"
  else
    azul "Construyendo la imagen de la API (unos minutos)"
    construir apps/api/Dockerfile "$REGISTRO/api:$ETIQUETA"
    ok "$REGISTRO/api:$ETIQUETA"
  fi

  azul "Construyendo la imagen del frontend"
  construir apps/web/Dockerfile "$REGISTRO/web:$ETIQUETA"
  ok "$REGISTRO/web:$ETIQUETA"
fi

# ── Esquema: paso propio, antes de publicar nada ───────────────────────────
azul "Preparando el esquema (migraciones, catálogos y datos sintéticos)"
gcloud run jobs deploy "sipra-migraciones-$AMBIENTE" \
  --region="$REGION" --image="$REGISTRO/api:$ETIQUETA_API" \
  --command=node --args=dist/migrar.js \
  "${RED_ARGS[@]}" --service-account="$SA" \
  --set-env-vars="NODE_ENV=production,SIPRA_AMBIENTE=$AMBIENTE,$DB_ENV,DB_USER=sipra,DB_NAME=sipra_$AMBIENTE,AUTH_MODO=abierto,STORAGE_DRIVER=local,IA_DRIVER=simulado,SINU_DRIVER=simulado,CORREO_DRIVER=consola" \
  --set-secrets="DB_PASSWORD=sipra-$AMBIENTE-db-pass:latest,JWT_SECRETO=sipra-$AMBIENTE-jwt:latest" \
  --max-retries=0 --task-timeout=15m --quiet
gcloud run jobs execute "sipra-migraciones-$AMBIENTE" --region="$REGION" --wait --quiet
ok "esquema listo"

# ── API ────────────────────────────────────────────────────────────────────
# `--no-cpu-throttling`: con la cola en proceso (COLA_DRIVER=en_proceso) la
# lectura del documento corre DESPUÉS de responder la petición; sin CPU
# asignada fuera de la petición, Cloud Run la congela y el documento se queda
# en «recibido». En pre y prod la cola es Cloud Tasks y esto no hace falta.
azul "Desplegando la API"
gcloud run deploy "sipra-api-$AMBIENTE" \
  --image="$REGISTRO/api:$ETIQUETA_API" --region="$REGION" --service-account="$SA" \
  "${RED_ARGS[@]}" \
  --set-env-vars="NODE_ENV=production,SIPRA_AMBIENTE=$AMBIENTE,AUTH_MODO=abierto,API_PREFIJO=api,API_VERSION=1,COLA_DRIVER=en_proceso,STORAGE_DRIVER=gcs,GCS_BUCKET=$BUCKET,$IA_ENV,SINU_DRIVER=simulado,CORREO_DRIVER=consola,LOG_NIVEL=info,$DB_ENV,DB_USER=sipra,DB_NAME=sipra_$AMBIENTE,GCP_PROYECTO=$PROYECTO,GCP_REGION=$REGION" \
  --set-secrets="JWT_SECRETO=sipra-$AMBIENTE-jwt:latest,DB_PASSWORD=sipra-$AMBIENTE-db-pass:latest$IA_SECRETS" \
  --allow-unauthenticated --port=8080 --memory=1Gi --cpu=1 --no-cpu-throttling \
  --min-instances=0 --max-instances=4 --timeout=120 --quiet
URL_API="$(gcloud run services describe "sipra-api-$AMBIENTE" --region="$REGION" --format='value(status.url)')"
ok "$URL_API"

# ── Frontend ───────────────────────────────────────────────────────────────
azul "Desplegando el frontend"
gcloud run deploy "sipra-web-$AMBIENTE" \
  --image="$REGISTRO/web:$ETIQUETA" --region="$REGION" \
  --set-env-vars="API_URL=$URL_API" \
  --allow-unauthenticated --port=8080 --memory=256Mi --cpu=1 \
  --min-instances=0 --max-instances=4 --quiet
URL_WEB="$(gcloud run services describe "sipra-web-$AMBIENTE" --region="$REGION" --format='value(status.url)')"
ok "$URL_WEB"

# ── Comprobación ───────────────────────────────────────────────────────────
azul "Comprobando el almacenamiento de documentos (diagnóstico de administración)"
TOKEN="$(curl -s -X POST "$URL_API/api/v1/auth/ingresar" -H 'content-type: application/json' \
  -d '{"rol":"administrador"}' | python3 -c 'import json,sys; print(json.load(sys.stdin).get("accessToken",""))' 2>/dev/null || true)"
if [ -n "$TOKEN" ]; then
  DIAG="$(curl -s "$URL_API/api/v1/administracion/diagnostico" -H "authorization: Bearer $TOKEN")"
  if echo "$DIAG" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["almacenamiento"]["ok"] else 1)' 2>/dev/null; then
    ok "almacenamiento: $(echo "$DIAG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["almacenamiento"]["detalle"])')"
  else
    aviso "ALMACENAMIENTO SIN SERVICIO: $(echo "$DIAG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["almacenamiento"]["detalle"])' 2>/dev/null || echo "$DIAG")"
    aviso "Sin esto no se pueden cargar documentos. Suele faltar el bucket o roles/storage.objectAdmin para $SA:"
    aviso "  gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin"
  fi
  if ! echo "$DIAG" | python3 -c 'import json,sys; sys.exit(0 if "ia" in json.load(sys.stdin) else 1)' 2>/dev/null; then
    aviso "La imagen de la API no expone el diagnóstico de lectura asistida (es anterior a esa función)."
  elif echo "$DIAG" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ia",{}).get("ok") else 1)' 2>/dev/null; then
    ok "lectura asistida: $(echo "$DIAG" | python3 -c 'import json,sys; d=json.load(sys.stdin)["ia"]; print(d["detalle"] + (" · " + d["modelo"] if d.get("modelo") else ""))')"
  else
    aviso "LECTURA ASISTIDA SIN SERVICIO: $(echo "$DIAG" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ia"]["detalle"])' 2>/dev/null || echo "$DIAG")"
    aviso "Los documentos seguirán entrando, pero irán todos a revisión humana hasta corregir la llave o el modelo."
  fi
else
  aviso "No se pudo obtener un token de administración para el diagnóstico (¿AUTH_MODO distinto de abierto?)."
fi

azul "Comprobando que la plataforma responde"
falla=0
for ruta in /api/v1/salud /api/v1/auth/modo /api/v1/auth/perfiles; do
  codigo="$(curl -sS -o /tmp/r -w '%{http_code}' --max-time 90 "$URL_WEB$ruta" || echo fallo)"
  if [ "$codigo" = "200" ]; then ok "GET $ruta → 200"; else
    printf '  \033[0;31m✗\033[0m GET %s → %s\n' "$ruta" "$codigo"; head -c 300 /tmp/r; echo; falla=1
  fi
done

cat <<FIN

════════════════════════════════════════════════════════════════════════════
  SIPRA PRÁCTICAS · $AMBIENTE

  Plataforma:  $URL_WEB
  API:         $URL_API
  Swagger:     $URL_WEB/docs/dev-only/swagger

  Identidad en ejecución: $SA
════════════════════════════════════════════════════════════════════════════
FIN
exit $falla
