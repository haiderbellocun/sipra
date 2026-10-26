#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SIPRA PRÁCTICAS — conectar Cloud SQL por IP privada
#
#   bash infra/gcp/red-privada.sh [proyecto] [region] [ambiente]
#
# Por qué existe. El conector de Cloud SQL exige `roles/cloudsql.client`, que
# Google Cloud solo permite conceder a nivel de proyecto: no hay política de
# IAM sobre una instancia. Una cuenta que administra recursos pero no el IAM
# del proyecto queda, entonces, sin forma de conectar la aplicación.
#
# La conexión por IP privada no pasa por IAM. Es red: una VPC del proyecto,
# un rango reservado para los servicios de Google, un emparejamiento con
# Service Networking y la instancia adherida a esa red. Todo eso lo crea quien
# crea recursos. Y es la configuración que Google recomienda para producción:
# la instancia deja de tener IP pública y solo es alcanzable desde la VPC.
#
# Idempotente: cada paso comprueba si ya está hecho.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROYECTO="${1:-cun-it-fab-contenido-practicas}"
REGION="${2:-us-central1}"
AMBIENTE="${3:-dev}"

RED="sipra-red"
SUBRED="sipra-subred-$REGION"
RANGO="sipra-rango-servicios"
INSTANCIA="sipra-$AMBIENTE"

azul() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }

gcloud config set project "$PROYECTO" >/dev/null

ip_privada() {
  gcloud sql instances describe "$INSTANCIA" --format=json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(next((i["ipAddress"] for i in d.get("ipAddresses", []) if i["type"] == "PRIVATE"), ""))'
}

azul "APIs de red"
gcloud services enable compute.googleapis.com servicenetworking.googleapis.com --quiet
ok "compute, servicenetworking"

azul "Red privada $RED"
if ! gcloud compute networks describe "$RED" >/dev/null 2>&1; then
  gcloud compute networks create "$RED" --subnet-mode=custom --quiet
fi
ok "red $RED"
if ! gcloud compute networks subnets describe "$SUBRED" --region="$REGION" >/dev/null 2>&1; then
  gcloud compute networks subnets create "$SUBRED" --network="$RED" --region="$REGION" \
    --range=10.10.0.0/24 --enable-private-ip-google-access --quiet
fi
ok "subred $SUBRED (10.10.0.0/24, $REGION)"

azul "Rango reservado para los servicios de Google"
if ! gcloud compute addresses describe "$RANGO" --global >/dev/null 2>&1; then
  gcloud compute addresses create "$RANGO" --global --purpose=VPC_PEERING \
    --prefix-length=20 --network="$RED" --quiet
fi
ok "rango $RANGO"

azul "Emparejamiento con Service Networking"
if gcloud services vpc-peerings list --network="$RED" --format='value(peering)' 2>/dev/null \
     | grep -q servicenetworking; then
  gcloud services vpc-peerings update --service=servicenetworking.googleapis.com \
    --ranges="$RANGO" --network="$RED" --force --quiet
elif ! gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
       --ranges="$RANGO" --network="$RED" --quiet 2>/tmp/sipra-peering.err; then
  # Es un rol propio, distinto del de administrador de red: una cuenta puede
  # crear redes, subredes y rangos y aun así no poder emparejar.
  if grep -q 'servicenetworking.services.addPeering' /tmp/sipra-peering.err; then
    cat <<AVISO >&2

  ✗ La cuenta no puede crear el emparejamiento con Service Networking.
    Falta el permiso servicenetworking.services.addPeering, que viene con
    roles/servicenetworking.networksAdmin. Alguien que administre el IAM del
    proyecto debe ejecutar, una sola vez:

      gcloud projects add-iam-policy-binding $PROYECTO \\
        --member=user:$(gcloud config get-value account 2>/dev/null) \\
        --role=roles/servicenetworking.networksAdmin --condition=None

    La red, la subred y el rango ya quedaron creados; al volver a ejecutar
    este guion continúa desde aquí.

AVISO
    exit 2
  fi
  cat /tmp/sipra-peering.err >&2
  exit 1
fi
ok "emparejamiento activo"

azul "Instancia $INSTANCIA adherida a la red privada"
IP="$(ip_privada)"
if [ -z "$IP" ]; then
  # La instancia se reinicia. Es un ambiente de desarrollo con datos sintéticos.
  gcloud sql instances patch "$INSTANCIA" \
    --network="projects/$PROYECTO/global/networks/$RED" --no-assign-ip --quiet
  IP="$(ip_privada)"
fi
[ -n "$IP" ] || { echo "No se obtuvo la IP privada de $INSTANCIA" >&2; exit 1; }
ok "IP privada: $IP (sin IP pública)"

# Cifrado obligatorio, sin certificado de cliente. `--require-ssl` (el modo
# TRUSTED_CLIENT_CERTIFICATE_REQUIRED) rechaza a la aplicación aunque conecte
# cifrada, porque no presenta certificado; dentro de la red privada no lo
# necesita.
MODO_SSL="$(gcloud sql instances describe "$INSTANCIA" --format='value(settings.ipConfiguration.sslMode)')"
if [ "$MODO_SSL" != "ENCRYPTED_ONLY" ]; then
  gcloud sql instances patch "$INSTANCIA" --ssl-mode=ENCRYPTED_ONLY --quiet
fi
ok "TLS obligatorio, sin certificado de cliente (ENCRYPTED_ONLY)"

cat <<FIN

  Cloud SQL queda alcanzable solo desde la red $RED.
  El despliegue detecta la IP privada y conecta por ella, sin conector ni
  roles/cloudsql.client. Siguiente paso:

    bash infra/gcp/desplegar.sh $PROYECTO $REGION $AMBIENTE

FIN
