#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SIPRA PRÁCTICAS — conceder a una cuenta de servicio lo mínimo que necesita
#
#   bash infra/gcp/permisos.sh <proyecto> <region> <ambiente> <cuenta>
#
# Algunos permisos se conceden sobre el recurso (un secreto, un bucket) y
# otros solo existen a nivel de proyecto (Cloud SQL, registros, métricas).
# Los primeros los puede dar quien creó el recurso; los segundos exigen
# administrar el IAM del proyecto. Por eso el guion intenta todo, verifica
# después qué quedó realmente concedido y, si algo falta, imprime la orden
# exacta que tiene que ejecutar alguien con ese permiso. No aborta: el
# despliegue posterior dirá con precisión qué se rompió.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

PROYECTO="$1"; REGION="$2"; AMBIENTE="$3"; SA="$4"
BUCKET="$PROYECTO-sipra-$AMBIENTE-docs"
SECRETOS=("sipra-$AMBIENTE-jwt" "sipra-$AMBIENTE-db-pass")
# La llave de OpenAI solo existe cuando se activó la lectura asistida.
if gcloud secrets describe "sipra-$AMBIENTE-openai" --project="$PROYECTO" >/dev/null 2>&1; then
  SECRETOS+=("sipra-$AMBIENTE-openai")
fi
ROLES_PROYECTO=(roles/cloudsql.client roles/logging.logWriter roles/monitoring.metricWriter)
ERR="$(mktemp)"
FALTAN=()

ok()    { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
malo()  { printf '  \033[0;31m✗\033[0m %s\n' "$1"; }
aviso() { printf '  \033[1;33m!\033[0m %s\n' "$1"; }

printf '\n\033[1;34m▸ Permisos de %s\033[0m\n' "$SA"

intentar() { # <etiqueta> <orden...>
  local etiqueta="$1"; shift
  if "$@" >/dev/null 2>"$ERR"; then ok "$etiqueta"; return 0; fi
  malo "$etiqueta"
  grep -m2 -E 'ERROR|denied|PERMISSION' "$ERR" | sed 's/^/      /'
  return 1
}

# ── Sobre el recurso: lo puede conceder quien creó el recurso ──────────────
# Desplegar en Cloud Run con una cuenta de servicio exige poder "actuar como"
# ella. Es un permiso sobre la propia cuenta, y lo concede quien la administra.
QUIEN="$(gcloud config get-value account 2>/dev/null)"
intentar "cuenta $SA → serviceAccountUser para $QUIEN" \
  gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROYECTO" \
    --member="user:$QUIEN" --role=roles/iam.serviceAccountUser --quiet \
  || FALTAN+=("gcloud iam service-accounts add-iam-policy-binding $SA --member=user:$QUIEN --role=roles/iam.serviceAccountUser")

for secreto in "${SECRETOS[@]}"; do
  intentar "secreto $secreto → secretAccessor" \
    gcloud secrets add-iam-policy-binding "$secreto" --project="$PROYECTO" \
      --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet \
    || FALTAN+=("gcloud secrets add-iam-policy-binding $secreto --project=$PROYECTO --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor")
done

if gcloud storage buckets describe "gs://$BUCKET" --project="$PROYECTO" >/dev/null 2>&1; then
  intentar "bucket $BUCKET → storage.objectAdmin" \
    gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --project="$PROYECTO" \
      --member="serviceAccount:$SA" --role=roles/storage.objectAdmin --quiet \
    || FALTAN+=("gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin")
else
  aviso "El bucket gs://$BUCKET no existe todavía."
fi

# ── Solo a nivel de proyecto: exigen administrar el IAM del proyecto ───────
for rol in "${ROLES_PROYECTO[@]}"; do
  intentar "proyecto → $rol" \
    gcloud projects add-iam-policy-binding "$PROYECTO" \
      --member="serviceAccount:$SA" --role="$rol" --condition=None --quiet \
    || FALTAN+=("gcloud projects add-iam-policy-binding $PROYECTO --member=serviceAccount:$SA --role=$rol --condition=None")
done

rm -f "$ERR"

if [ ${#FALTAN[@]} -gt 0 ]; then
  cat <<AVISO

  ─────────────────────────────────────────────────────────────────────────
  Faltan permisos que esta cuenta no puede conceder. Alguien con
  roles/resourcemanager.projectIamAdmin (o el propietario del proyecto)
  debe ejecutar, una sola vez:

AVISO
  for orden in "${FALTAN[@]}"; do printf '    %s\n' "$orden"; done
  printf '  ─────────────────────────────────────────────────────────────────────────\n\n'
fi
exit 0
