#!/usr/bin/env bash
# Variante LOCAL con Docker Desktop (P1–P8). Para las mediciones nuevas, el generador va en OTRO equipo: ver
# pc-sipra-iniciar.sh / pc-sipra-cerrar.sh y generador/ (README).
# Orquesta UNA corrida desde la raíz del repositorio (Git Bash en Windows):
#   muestreo (PG + API + máquina) + docker stats del contenedor k6 → k6 en Docker → integridad.
#
#   bash performance/herramientas/correr.sh <escenario> <corrida> <vus> <offset> [archivo=medio]
#   ej.: bash performance/herramientas/correr.sh 03-upload 03-upload-100 100 1 medio
#
# Requisitos: API de performance en :3100 (entorno.sh), tokens preparados (preparar-tokens.cjs), archivos generados.
set -u
ESC="$1"; CORRIDA="$2"; VUS="$3"; OFFSET="$4"; ARCHIVO="${5:-medio}"
RAIZ="$(pwd)"
OUT="$RAIZ/performance/out"
. performance/herramientas/entorno.sh
export PERF_API_PID="$(powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3100 -State Listen).OwningProcess" | tr -d '\r')"
export NODE_PATH="$RAIZ/apps/api/node_modules:$RAIZ/node_modules"

node performance/herramientas/muestrear.cjs "$CORRIDA" 1800 > "$OUT/$CORRIDA.muestreo.log" 2>&1 &
MUESTREO=$!
sleep 3

# CPU/RAM/red del generador: docker stats del contenedor k6 mientras exista.
( visto=0; for _ in $(seq 1 1500); do
    if docker stats --no-stream --format '{{json .}}' "k6-$CORRIDA" 2>/dev/null >> "$OUT/$CORRIDA.docker-stats.jsonl"; then visto=1
    elif [ "$visto" = 1 ]; then break; else sleep 0.3; fi
  done ) &
STATS=$!

MSYS_NO_PATHCONV=1 docker run --rm --name "k6-$CORRIDA" \
  -v "$(pwd -W)/performance:/performance" \
  -e BASE=http://host.docker.internal:3100/api/v1 -e VUS="$VUS" -e OFFSET="$OFFSET" -e ARCHIVO="$ARCHIVO" -e CORRIDA="$CORRIDA" \
  grafana/k6 run --quiet "scenarios/$ESC.js" > "$OUT/$CORRIDA.k6.log" 2>&1
K6=$?

sleep 3
touch "$OUT/$CORRIDA.stop"
wait "$MUESTREO" 2>/dev/null
kill "$STATS" 2>/dev/null; wait "$STATS" 2>/dev/null
echo "k6 terminó con código $K6"
grep -v "DOC201\|UPLOAD_FALLIDO" "$OUT/$CORRIDA.k6.log" | tail -12

node performance/herramientas/integridad.cjs "$CORRIDA" "$OUT/$CORRIDA.k6.log" 180
echo "integridad código $?"
