#!/usr/bin/env bash
# PC SIPRA (PC A) · después de la corrida externa. Desde la raíz del repositorio (Git Bash):
#
#   bash performance/herramientas/pc-sipra-cerrar.sh <corrida>
#
# Requiere haber COPIADO desde el PC generador a performance/out/: <corrida>.k6.log (marcas DOC201/UPLOAD_FALLIDO),
# <corrida>.summary.json y, si se usó el monitor, <corrida>.generador.jsonl / .generador-resumen.json.
# Detiene el muestreo y ejecuta el verificador de integridad (código 1 = INTEGRIDAD FALLÓ).
#   INTEGRIDAD_ESPERADOS=<n> bash performance/herramientas/pc-sipra-cerrar.sh <corrida>   → exige n 201 y pasa la compuerta
set -u
CORRIDA="$1"
. performance/herramientas/entorno.sh
export NODE_PATH="$(pwd)/apps/api/node_modules:$(pwd)/node_modules"
OUT=performance/out
touch "$OUT/$CORRIDA.stop"
for _ in $(seq 1 30); do [ -s "$OUT/$CORRIDA.muestras-resumen.json" ] && break; sleep 1; done
rm -f "$OUT/$CORRIDA.muestreo.pid"
[ -s "$OUT/$CORRIDA.k6.log" ] || { echo "Falta $OUT/$CORRIDA.k6.log (cópielo desde el PC generador)"; exit 1; }
node performance/herramientas/integridad.cjs "$CORRIDA" "$OUT/$CORRIDA.k6.log" 180
INTEGRIDAD=$?
echo "integridad código $INTEGRIDAD"
# Escalones (P10): con INTEGRIDAD_ESPERADOS, además la COMPUERTA (integridad, API viva sin reinicio, PostgreSQL estable,
# errores HTTP, iteraciones perdidas y generador no saturado). Código distinto de 0 = STOP de la campaña.
if [ -n "${INTEGRIDAD_ESPERADOS:-}" ]; then
  node performance/herramientas/compuerta.cjs "$CORRIDA" "$INTEGRIDAD_ESPERADOS"
  COMPUERTA=$?
  echo "compuerta código $COMPUERTA"
  [ "$INTEGRIDAD" -eq 0 ] && [ "$COMPUERTA" -eq 0 ] || exit 1
fi
exit "$INTEGRIDAD"
