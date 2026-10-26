#!/usr/bin/env bash
# Procesos por lote: Cloud Scheduler dispara Cloud Run Jobs.
# El planificador interno de la aplicación cubre solo dev y local.
set -euo pipefail

AMBIENTE="${1:?Uso: $0 <dev|qa|pre|prod> <id-proyecto>}"
PROYECTO="${2:?Falta el id del proyecto}"
REGION="${REGION:-us-central1}"
CUENTA="sipra-api-$AMBIENTE@$PROYECTO.iam.gserviceaccount.com"

programar() {
  local nombre="$1" cron="$2" descripcion="$3"
  gcloud scheduler jobs create http "sipra-$nombre-$AMBIENTE" \
    --location="$REGION" \
    --schedule="$cron" \
    --time-zone="America/Bogota" \
    --description="$descripcion" \
    --uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROYECTO/jobs/sipra-$nombre-$AMBIENTE:run" \
    --http-method=POST \
    --oauth-service-account-email="$CUENTA" 2>/dev/null || \
  gcloud scheduler jobs update http "sipra-$nombre-$AMBIENTE" \
    --location="$REGION" --schedule="$cron" --time-zone="America/Bogota"
}

# Motor de obligaciones: una obligación vence sin que nadie cargue nada.
programar obligaciones "0 1 * * *" "Marca vencidas las obligaciones normativas"

# Minimización de datos: las imágenes de cédula se purgan a los 30 días.
programar purga "0 2 * * *" "Purga de documentos por política de retención"

# Vigencia máxima de seis meses de las vacantes publicadas.
programar vacantes "0 3 * * *" "Vencimiento de vacantes publicadas"

# Reporte diario a la Unidad del SPE (solo vacantes en marco laboral).
programar reporte-spe "0 6 * * *" "Archivo diario de vacantes para la Unidad del SPE"

# Sincronización de matrícula desde SINU (solo lectura).
programar sinu "0 4 * * *" "Sincronización de matrícula de práctica desde SINU"

echo "▸ Tareas programadas del ambiente $AMBIENTE creadas en zona horaria America/Bogota."
