#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SIPRA PRÁCTICAS — aprovisionamiento de un ambiente en Google Cloud
#
# Crea, para UN ambiente, todo lo que la aplicación necesita: proyecto, APIs,
# Cloud SQL, bucket privado, Secret Manager, cuenta de servicio de mínimo
# privilegio, Cloud Tasks y Cloud Scheduler.
#
# La solicitud a Tecnología es de CUATRO PROYECTOS separados —dev, qa, pre y
# prod—, no de cuatro carpetas ni cuatro buckets dentro del mismo proyecto:
# de otro modo se pierde el aislamiento de permisos, facturación y secretos.
#
#   ./aprovisionar-ambiente.sh dev cun-sipra-dev 000000-000000-000000
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

AMBIENTE="${1:?Uso: $0 <dev|qa|pre|prod> <id-proyecto> [cuenta-facturacion]}"
PROYECTO="${2:?Falta el id del proyecto de Google Cloud}"
FACTURACION="${3:-}"
REGION="${REGION:-us-central1}"

case "$AMBIENTE" in
  dev|qa|pre|prod) ;;
  *) echo "Ambiente no válido: $AMBIENTE (use dev, qa, pre o prod)" >&2; exit 1 ;;
esac

# Producción y preproducción se dimensionan distinto y jamás admiten el
# ingreso abierto por selección de perfil.
if [[ "$AMBIENTE" == "prod" ]]; then
  NIVEL_SQL="db-custom-4-15360"; RESPALDOS="--backup-start-time=07:00 --enable-point-in-time-recovery"
  ALTA_DISPONIBILIDAD="--availability-type=REGIONAL"; AUTH_MODO="oidc"
elif [[ "$AMBIENTE" == "pre" ]]; then
  NIVEL_SQL="db-custom-2-7680"; RESPALDOS="--backup-start-time=07:00"
  ALTA_DISPONIBILIDAD="--availability-type=ZONAL"; AUTH_MODO="oidc"
else
  NIVEL_SQL="db-g1-small"; RESPALDOS="--backup-start-time=07:00"
  ALTA_DISPONIBILIDAD="--availability-type=ZONAL"; AUTH_MODO="oidc"
fi

echo "▸ Ambiente $AMBIENTE · proyecto $PROYECTO · región $REGION · autenticación $AUTH_MODO"

# ── Proyecto y APIs ────────────────────────────────────────────────────────
gcloud projects describe "$PROYECTO" >/dev/null 2>&1 || gcloud projects create "$PROYECTO"
[[ -n "$FACTURACION" ]] && gcloud billing projects link "$PROYECTO" --billing-account="$FACTURACION"
gcloud config set project "$PROYECTO"

gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com storage.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com \
  cloudtasks.googleapis.com monitoring.googleapis.com logging.googleapis.com \
  redis.googleapis.com

# ── Registro de artefactos ─────────────────────────────────────────────────
gcloud artifacts repositories describe sipra --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create sipra --repository-format=docker --location="$REGION" \
    --description="Imágenes de SIPRA PRÁCTICAS"

# ── Cloud SQL for PostgreSQL ───────────────────────────────────────────────
if ! gcloud sql instances describe "sipra-$AMBIENTE" >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  gcloud sql instances create "sipra-$AMBIENTE" \
    --database-version=POSTGRES_16 \
    --tier="$NIVEL_SQL" \
    --region="$REGION" \
    $ALTA_DISPONIBILIDAD \
    $RESPALDOS \
    --retained-backups-count=30 \
    --require-ssl \
    --no-assign-ip \
    --database-flags=log_min_duration_statement=500,max_connections=200
fi
gcloud sql databases describe sipra --instance="sipra-$AMBIENTE" >/dev/null 2>&1 || \
  gcloud sql databases create sipra --instance="sipra-$AMBIENTE"

CLAVE_BD="$(openssl rand -base64 32)"
gcloud sql users create sipra --instance="sipra-$AMBIENTE" --password="$CLAVE_BD" 2>/dev/null || \
  gcloud sql users set-password sipra --instance="sipra-$AMBIENTE" --password="$CLAVE_BD"

# ── Buckets privados ───────────────────────────────────────────────────────
# Nunca públicos: se verifica explícitamente con el acceso público prevenido.
for bucket in "sipra-$AMBIENTE-documentos" "sipra-$AMBIENTE-web"; do
  gcloud storage buckets describe "gs://$bucket" >/dev/null 2>&1 || \
    gcloud storage buckets create "gs://$bucket" \
      --location="$REGION" --uniform-bucket-level-access \
      --public-access-prevention
done
# Versionado y retención sobre los documentos.
gcloud storage buckets update "gs://sipra-$AMBIENTE-documentos" --versioning

# ── Secretos ───────────────────────────────────────────────────────────────
# Las credenciales no viajan por correo ni viven en el código.
crear_secreto() {
  local nombre="$1" valor="$2"
  if gcloud secrets describe "$nombre" >/dev/null 2>&1; then
    printf '%s' "$valor" | gcloud secrets versions add "$nombre" --data-file=-
  else
    printf '%s' "$valor" | gcloud secrets create "$nombre" --data-file=- --replication-policy=automatic
  fi
}
crear_secreto "sipra-db-password-$AMBIENTE" "$CLAVE_BD"
crear_secreto "sipra-jwt-$AMBIENTE" "$(openssl rand -base64 48)"
# Estos quedan como marcador: Tecnología carga el valor real.
gcloud secrets describe "sipra-anthropic-$AMBIENTE" >/dev/null 2>&1 || \
  crear_secreto "sipra-anthropic-$AMBIENTE" "PENDIENTE-CARGAR-CLAVE-API"
gcloud secrets describe "sipra-oidc-secret-$AMBIENTE" >/dev/null 2>&1 || \
  crear_secreto "sipra-oidc-secret-$AMBIENTE" "PENDIENTE-CARGAR-CLIENTE-OIDC"

# ── Cuenta de servicio de mínimo privilegio ────────────────────────────────
CUENTA="sipra-api-$AMBIENTE@$PROYECTO.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$CUENTA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "sipra-api-$AMBIENTE" \
    --display-name="SIPRA PRÁCTICAS · API · $AMBIENTE"

# Solo lo estrictamente necesario para operar.
for rol in roles/cloudsql.client roles/secretmanager.secretAccessor \
           roles/logging.logWriter roles/monitoring.metricWriter \
           roles/cloudtrace.agent roles/cloudtasks.enqueuer; do
  gcloud projects add-iam-policy-binding "$PROYECTO" \
    --member="serviceAccount:$CUENTA" --role="$rol" --condition=None >/dev/null
done
# Acceso al bucket de documentos únicamente, no a todo Storage del proyecto.
gcloud storage buckets add-iam-policy-binding "gs://sipra-$AMBIENTE-documentos" \
  --member="serviceAccount:$CUENTA" --role=roles/storage.objectAdmin >/dev/null

# ── Cola de trabajo para el pico de cierre de periodo ──────────────────────
# Convención ÚNICA (la que consume apps/api/src/infrastructure/adapters/cola/cola.adapter.ts):
#   sipra-documentos-<ambiente>  prioridad interactiva (el cargue en curso)
#   sipra-lote-<ambiente>        prioridad de lote (procesamiento diferido)
# Son dos colas porque Cloud Tasks no ordena por prioridad dentro de una cola.
for cola in "sipra-documentos-$AMBIENTE" "sipra-lote-$AMBIENTE"; do
  gcloud tasks queues describe "$cola" --location="$REGION" >/dev/null 2>&1 || \
    gcloud tasks queues create "$cola" --location="$REGION" \
      --max-dispatches-per-second=50 --max-concurrent-dispatches=200 --max-attempts=5
done

echo
echo "▸ Ambiente $AMBIENTE aprovisionado."
echo "  Verificación obligatoria: los buckets NO son públicos."
gcloud storage buckets describe "gs://sipra-$AMBIENTE-documentos" \
  --format="value(iamConfiguration.publicAccessPrevention)"
echo
echo "  Pendiente para Tecnología:"
echo "   · cargar la clave real en el secreto sipra-anthropic-$AMBIENTE"
echo "   · cargar el cliente OIDC de Google Workspace en sipra-oidc-secret-$AMBIENTE"
echo "   · definir el método de lectura de SINU y sus credenciales"
