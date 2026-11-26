#!/usr/bin/env bash
# PC SIPRA (PC A) · antes de una corrida con generador EXTERNO. Desde la raíz del repositorio (Git Bash):
#
#   GENERADOR_IP=<IP PC B> [RED_INTERFAZ=<alias>] bash performance/herramientas/pc-sipra-iniciar.sh <corrida> <desde> <cantidad> [tokens-remotos]
#   ej.: GENERADOR_IP=192.168.78.191 RED_INTERFAZ=Wi-Fi bash performance/herramientas/pc-sipra-iniciar.sh external-6000-001 6453 6000 tokens-remotos
#   con 4.º argumento `tokens-remotos`: NO prepara tokens aquí (los prepara el PC B con generador/preparar-tokens.ps1).
#   Se niega (sin escribir nada) ante: nombre usado, API caída o no en 0.0.0.0, PostgreSQL fuera de localhost, muestreos
#   vivos, red inválida hacia el generador, suspensión en CA ≠ 0, rango usado, disco o RAM insuficientes.
#
# 1) comprueba que la API de performance responde en :3100 (escucha en 0.0.0.0, la arranca entorno.sh + dist/main.js);
# 2) comprueba que el rango de estudiantes está SIN USAR y prepara sus tokens (fuera de la ventana medida);
# 3) arranca el muestreo de la máquina SIPRA (API, PostgreSQL, CPU, RAM, red) en segundo plano.
# Luego: copiar performance/out/tokens.json al PC generador y ejecutar k6 allá. Al terminar: pc-sipra-cerrar.sh.
set -eu
CORRIDA="${1:?Falta <corrida>}"; DESDE="${2:?Falta <desde>}"; CANTIDAD="${3:?Falta <cantidad>}"; MODO_TOKENS="${4:-locales}"
OUT=performance/out

# NOMBRE DE CORRIDA ÚNICO (P11): si ya hay CUALQUIER artefacto con este nombre (muestras, pid, precheck, k6, resumen,
# integridad, compuerta, generador, resultados…), se niega ANTES de escribir nada. Nunca sobrescribe una corrida anterior.
[[ "$CORRIDA" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "Nombre de corrida inválido: '$CORRIDA' (solo letras, dígitos, . _ -)"; exit 1; }
shopt -s nullglob
EXISTENTES=("$OUT/$CORRIDA".*)
shopt -u nullglob
if [ "${#EXISTENTES[@]}" -gt 0 ]; then
  echo "SE NIEGA: la corrida '$CORRIDA' ya tiene ${#EXISTENTES[@]} artefacto(s) en $OUT/:"
  for f in "${EXISTENTES[@]}"; do echo "  - ${f#$OUT/}"; done
  echo "No se sobrescribe una corrida anterior. Use un nombre NUEVO (p. ej. el siguiente número)."
  exit 1
fi

. performance/herramientas/entorno.sh
export NODE_PATH="$(pwd)/apps/api/node_modules:$(pwd)/node_modules"

[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/v1/salud)" = 200 ] || { echo 'La API de performance no responde en :3100'; exit 1; }
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3100 -State Listen | Select-Object -ExpandProperty LocalAddress" | tr -d '\r' | grep -qx '0.0.0.0' || { echo 'La API no escucha en 0.0.0.0'; exit 1; }
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5433 -State Listen | Select-Object -ExpandProperty LocalAddress" | tr -d '\r' | grep -qvE '^(127\.0\.0\.1|::1)$' && { echo 'PostgreSQL escucha fuera de localhost (5433): se niega'; exit 1; }
# Sin muestreos previos vivos (dos muestreos se pisarían el /metrics: el máximo del event loop se reinicia en cada lectura).
MUESTREOS="$(powershell -NoProfile -Command "@(Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'muestrear\.cjs' }).Count" | tr -d '\r')"
[ "$MUESTREOS" = 0 ] || { echo "Hay $MUESTREOS muestreo(s) activo(s) (muestrear.cjs): ciérrelos con pc-sipra-cerrar.sh de su corrida antes de iniciar otra"; exit 1; }
# RED (P11): NO se asume Ethernet. En este entorno el Ethernet de PC A y PC B negocia 100 Mbps (cuello a 8 uploads/s ≈
# 141 Mbps) y external-3000-003 pasó por Wi‑Fi a 1 Gbps. red-generador.ps1 usa la interfaz de la RUTA REAL hacia el
# generador y exige: ruta, generador alcanzable (ARP), API accesible por esa IP y, en Ethernet, enlace ≥ RED_MIN_MBPS.
#   GENERADOR_IP=<IP del PC B> (obligatoria) · RED_INTERFAZ=<alias esperado, p. ej. Wi-Fi> (opcional pero recomendada:
#   si la ruta usa otra interfaz, se niega) · RED_MIN_MBPS (200 por defecto).
: "${GENERADOR_IP:?Defina GENERADOR_IP=<IP del PC B> (p. ej. GENERADOR_IP=192.168.78.191 RED_INTERFAZ=Wi-Fi bash ...)}"
RED_ARGS=(-Generador "$GENERADOR_IP" -MinMbps "${RED_MIN_MBPS:-200}")
[ -z "${RED_INTERFAZ:-}" ] || RED_ARGS+=(-Interfaz "$RED_INTERFAZ")
RED_JSON="$(powershell -NoProfile -ExecutionPolicy Bypass -File performance/herramientas/red-generador.ps1 "${RED_ARGS[@]}" | tr -d '\r')" && RED_OK=1 || RED_OK=0
echo "RED: $RED_JSON"
[ "$RED_OK" = 1 ] || { echo 'Precheck de RED fallido (ver "fallas" arriba)'; exit 1; }
IP="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).ipSipra)" "$RED_JSON")"
RED_INTERFAZ_USADA="$(node -e "const r=JSON.parse(process.argv[1]);process.stdout.write(r.interfaz+' ('+r.tipo+')')" "$RED_JSON")"
echo "Interfaz usada hacia el generador: $RED_INTERFAZ_USADA · IP PC SIPRA $IP · generador $GENERADOR_IP"
# Suspensión (requisito): el calentamiento del muestreo descartó 6.300.717 ms de event loop (API pausada ~105 min).
SUSPENSION_CA="$(powershell -NoProfile -Command "((powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -match '0x' | Select-Object -Last 2 | Select-Object -First 1) -replace '.*: *',''" | tr -d '\r ')"
[ "$SUSPENSION_CA" = 0x00000000 ] || { echo "La suspensión en CA está en $SUSPENSION_CA s (≠ 0): ejecute powercfg /change standby-timeout-ac 0 y vuelva a intentar"; exit 1; }
node performance/herramientas/verificar-rango.cjs "$DESDE" "$CANTIDAD"
# Pre-check de disco y RAM (P11): consumo MEDIDO en external-3000-003 = 6.241 MB / 3.000 ≈ 2,1 MB por upload (archivo +
# PostgreSQL/WAL). Exige libre ≥ 1,5 × CANTIDAD × 2,1 MB + 5 GB (registros, métricas, sistema de archivos). Queda en
# <corrida>.precheck.json.
read -r DISCO_LIBRE_MB RAM_LIBRE_MB <<< "$(powershell -NoProfile -Command "\$d=(Get-Item 'apps/api/.almacen-performance').PSDrive; \$o=Get-CimInstance Win32_OperatingSystem; '{0} {1}' -f [math]::Floor(\$d.Free/1MB), [math]::Floor(\$o.FreePhysicalMemory/1KB)" | tr -d '\r')"
DISCO_NECESARIO_MB=$(( CANTIDAD * 21 * 3 / 20 + 5120 ))
PRECHECK="{\"corrida\":\"$CORRIDA\",\"discoLibreMb\":$DISCO_LIBRE_MB,\"discoNecesarioMb\":$DISCO_NECESARIO_MB,\"ramLibreMb\":$RAM_LIBRE_MB,\"suspensionCa\":\"$SUSPENSION_CA\",\"red\":$RED_JSON}"
echo "$PRECHECK"
# Se escribe SOLO si pasa: un pre-check fallido no deja artefactos que bloqueen reintentar con el mismo nombre.
[ "$DISCO_LIBRE_MB" -ge "$DISCO_NECESARIO_MB" ] || { echo "Disco insuficiente: $DISCO_LIBRE_MB MB libres < $DISCO_NECESARIO_MB MB necesarios"; exit 1; }
[ "$RAM_LIBRE_MB" -ge 1024 ] || { echo "RAM libre insuficiente: $RAM_LIBRE_MB MB (< 1 GB). Cierre aplicaciones antes de la corrida."; exit 1; }
echo "$PRECHECK" > "$OUT/$CORRIDA.precheck.json"
[ "$MODO_TOKENS" = tokens-remotos ] || node performance/herramientas/preparar-tokens.cjs "$DESDE" "$CANTIDAD"

export PERF_API_PID="$(powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3100 -State Listen).OwningProcess" | tr -d '\r' | head -1)"
echo "$PERF_API_PID" > "$OUT/$CORRIDA.api.pid"   # la compuerta lo compara al cerrar (reinicio de la API = STOP)
nohup node performance/herramientas/muestrear.cjs "$CORRIDA" 3600 > "$OUT/$CORRIDA.muestreo.log" 2>&1 &
echo $! > "$OUT/$CORRIDA.muestreo.pid"
if [ "$MODO_TOKENS" = tokens-remotos ]; then echo "Muestreo en curso (corrida $CORRIDA). Tokens: los prepara el PC B (estudiantes $DESDE–$((DESDE + CANTIDAD - 1)))."; else echo "Muestreo en curso (corrida $CORRIDA). Tokens: $OUT/tokens.json (estudiantes $DESDE–$((DESDE + CANTIDAD - 1)))."; fi
echo "En el PC generador: BASE=http://$IP:3100/api/v1  OFFSET=0  VUS=$CANTIDAD  CORRIDA=$CORRIDA"
