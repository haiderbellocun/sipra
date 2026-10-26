#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SIPRA PRÁCTICAS — arranque en Google Cloud, de una sola pasada
#
# Se ejecuta UNA vez desde Cloud Shell, que ya viene autenticado. Deja el
# proyecto con todo lo que la plataforma necesita y, sobre todo, deja a GitHub
# Actions autorizado para desplegar sin ninguna clave descargable: la confianza
# se establece por federación de identidades, de modo que no existe un archivo
# de credenciales que se pueda filtrar, rotar mal ni olvidar.
#
# Es idempotente: volver a ejecutarlo no rompe nada ni duplica recursos.
#
#   bash arranque-unico.sh [id-proyecto] [region] [ambiente]
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROYECTO="${1:-cun-it-fab-contenido-practicas}"
REGION="${2:-us-central1}"
AMBIENTE="${3:-dev}"
REPO_GITHUB="${REPO_GITHUB:-ironfuentes-netizen/sipra-practicas}"

INSTANCIA="sipra-$AMBIENTE"
BASE="sipra_$AMBIENTE"
USUARIO_BD="sipra"
SA_APP="sipra-app-$AMBIENTE"
SA_CI="sipra-despliegue"
POOL="github"
PROVEEDOR="github"

azul() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }

gcloud config set project "$PROYECTO" >/dev/null
NUMERO="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')"
azul "Proyecto $PROYECTO ($NUMERO) · región $REGION · ambiente $AMBIENTE"

# ── APIs ───────────────────────────────────────────────────────────────────
azul "Habilitando servicios"
gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com sql-component.googleapis.com \
  storage.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com \
  cloudtasks.googleapis.com monitoring.googleapis.com logging.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com \
  --quiet
ok "servicios habilitados"

# ── Registro de imágenes ───────────────────────────────────────────────────
azul "Registro de imágenes"
gcloud artifacts repositories describe sipra --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create sipra --repository-format=docker \
    --location="$REGION" --description="Imágenes de SIPRA PRÁCTICAS" --quiet
ok "artifacts/sipra"

# ── Secretos ───────────────────────────────────────────────────────────────
azul "Secretos"
crear_secreto() {
  local nombre="$1" valor="$2"
  if ! gcloud secrets describe "$nombre" >/dev/null 2>&1; then
    printf '%s' "$valor" | gcloud secrets create "$nombre" --data-file=- --quiet
    ok "$nombre creado"
  else
    ok "$nombre ya existía (se conserva)"
  fi
}
crear_secreto "sipra-$AMBIENTE-jwt"    "$(openssl rand -base64 48 | tr -d '\n=' | tr '+/' '-_')"
crear_secreto "sipra-$AMBIENTE-db-pass" "$(openssl rand -base64 32 | tr -d '\n=+/')"
CLAVE_BD="$(gcloud secrets versions access latest --secret="sipra-$AMBIENTE-db-pass")"

# ── Cloud SQL ──────────────────────────────────────────────────────────────
azul "Cloud SQL for PostgreSQL (tarda unos minutos la primera vez)"
if ! gcloud sql instances describe "$INSTANCIA" >/dev/null 2>&1; then
  # La edición se declara explícitamente: donde el proyecto tiene Enterprise Plus
  # por defecto, los niveles compartidos como db-g1-small no existen y la
  # creación falla. Para un ambiente de desarrollo, Enterprise sobra y cuesta
  # una fracción.
  gcloud sql instances create "$INSTANCIA" \
    --database-version=POSTGRES_17 --edition=ENTERPRISE --tier=db-g1-small --region="$REGION" \
    --storage-auto-increase --availability-type=ZONAL \
    --backup-start-time=07:00 --ssl-mode=ENCRYPTED_ONLY --quiet
  # ENCRYPTED_ONLY y no --require-ssl: en Cloud SQL, --require-ssl exige
  # certificado de cliente (TLS mutuo), no solo cifrado. La aplicación conecta
  # cifrada por IP privada y no presenta certificado; con --require-ssl la base
  # la rechaza con "connection requires a valid client certificate".
  ok "instancia $INSTANCIA creada"
else
  ok "instancia $INSTANCIA ya existía"
fi
# Sin redes autorizadas: nadie llega por internet. Cloud Run entra por el
# conector de Cloud SQL, que habla por socket, no por IP pública.
gcloud sql instances patch "$INSTANCIA" --clear-authorized-networks --quiet >/dev/null 2>&1 || true
gcloud sql databases describe "$BASE" --instance="$INSTANCIA" >/dev/null 2>&1 || \
  gcloud sql databases create "$BASE" --instance="$INSTANCIA" --quiet
gcloud sql users describe "$USUARIO_BD" --instance="$INSTANCIA" >/dev/null 2>&1 \
  && gcloud sql users set-password "$USUARIO_BD" --instance="$INSTANCIA" --password="$CLAVE_BD" --quiet \
  || gcloud sql users create "$USUARIO_BD" --instance="$INSTANCIA" --password="$CLAVE_BD" --quiet
CONEXION="$(gcloud sql instances describe "$INSTANCIA" --format='value(connectionName)')"
ok "base $BASE · conexión $CONEXION"

# ── Almacenamiento de documentos ───────────────────────────────────────────
azul "Bucket de documentos"
BUCKET="$PROYECTO-sipra-$AMBIENTE-docs"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention --quiet
ok "gs://$BUCKET (privado, sin acceso público posible)"

# ── Cuenta de servicio de la aplicación (mínimo privilegio) ────────────────
azul "Identidad de la aplicación"
gcloud iam service-accounts describe "$SA_APP@$PROYECTO.iam.gserviceaccount.com" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_APP" --display-name="SIPRA · aplicación ($AMBIENTE)" --quiet
for rol in roles/cloudsql.client roles/secretmanager.secretAccessor roles/cloudtasks.enqueuer; do
  gcloud projects add-iam-policy-binding "$PROYECTO" \
    --member="serviceAccount:$SA_APP@$PROYECTO.iam.gserviceaccount.com" \
    --role="$rol" --condition=None --quiet >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_APP@$PROYECTO.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin --quiet >/dev/null
ok "$SA_APP · solo Cloud SQL, sus secretos, su bucket y su cola"

# ── Cola de trabajo ────────────────────────────────────────────────────────
azul "Colas de trabajo"
# Convención ÚNICA (la que consume apps/api/src/infrastructure/adapters/cola/cola.adapter.ts):
#   sipra-documentos-<ambiente>  prioridad interactiva (el cargue en curso)
#   sipra-lote-<ambiente>        prioridad de lote (procesamiento diferido)
for cola in "sipra-documentos-$AMBIENTE" "sipra-lote-$AMBIENTE"; do
  gcloud tasks queues describe "$cola" --location="$REGION" >/dev/null 2>&1 || \
    gcloud tasks queues create "$cola" --location="$REGION" --quiet
done
ok "sipra-documentos-$AMBIENTE y sipra-lote-$AMBIENTE"

# ── Identidad de despliegue: GitHub sin claves descargables ────────────────
azul "Autorizando a GitHub Actions por federación de identidades"
gcloud iam service-accounts describe "$SA_CI@$PROYECTO.iam.gserviceaccount.com" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_CI" --display-name="SIPRA · despliegue desde GitHub" --quiet
for rol in roles/run.admin roles/artifactregistry.writer roles/cloudbuild.builds.editor \
           roles/storage.admin roles/cloudsql.client roles/secretmanager.secretAccessor \
           roles/iam.serviceAccountUser roles/logging.viewer; do
  gcloud projects add-iam-policy-binding "$PROYECTO" \
    --member="serviceAccount:$SA_CI@$PROYECTO.iam.gserviceaccount.com" \
    --role="$rol" --condition=None --quiet >/dev/null
done

gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub" --quiet
if ! gcloud iam workload-identity-pools providers describe "$PROVEEDOR" \
      --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  # La condición ata la confianza a ESTE repositorio: ningún otro repositorio
  # de GitHub, propio o ajeno, puede pedir credenciales de este proyecto.
  gcloud iam workload-identity-pools providers create-oidc "$PROVEEDOR" \
    --location=global --workload-identity-pool="$POOL" \
    --display-name="GitHub Actions" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$REPO_GITHUB'" --quiet
else
  # Si el proveedor ya existe (por ejemplo, creado cuando el código vivía en
  # otro repositorio), se vuelve a atar al repositorio configurado.
  gcloud iam workload-identity-pools providers update-oidc "$PROVEEDOR" \
    --location=global --workload-identity-pool="$POOL" \
    --attribute-condition="assertion.repository=='$REPO_GITHUB'" --quiet
fi
gcloud iam service-accounts add-iam-policy-binding "$SA_CI@$PROYECTO.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/$POOL/attributeName/attribute.repository/$REPO_GITHUB" \
  --quiet >/dev/null 2>&1 || \
gcloud iam service-accounts add-iam-policy-binding "$SA_CI@$PROYECTO.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO_GITHUB" \
  --quiet >/dev/null
ok "solo $REPO_GITHUB puede desplegar, y sin descargar ninguna clave"

# ── Lo único que hay que devolver ──────────────────────────────────────────
cat <<FIN

════════════════════════════════════════════════════════════════════════════
  Listo. Copie ESTA sola línea y péguela en el chat:

SIPRA_GCP proyecto=$PROYECTO numero=$NUMERO region=$REGION ambiente=$AMBIENTE conexion=$CONEXION bucket=$BUCKET
════════════════════════════════════════════════════════════════════════════
FIN
