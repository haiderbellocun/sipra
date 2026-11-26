# Entorno EXCLUSIVO de performance. Uso: `. performance/herramientas/entorno.sh` desde la raíz del repositorio.
# Toma credenciales y secretos del .env principal (sin modificarlo ni copiarlo) y fuerza los valores de performance.
# .env se LEE como datos (CLAVE=VALOR literal), no se ejecuta: un valor sin comillas con espacios (p. ej. una expresión
# cron) haría que `. ./.env` ejecutara una palabra como comando (código 127) y abortara a quien use `set -e`.
if [ -f ./.env ]; then
  while IFS= read -r _linea || [ -n "$_linea" ]; do
    _linea="${_linea%$'\r'}"
    case "$_linea" in ''|'#'*) continue ;; esac
    _clave="${_linea%%=*}"
    [[ "$_clave" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && [ "$_clave" != "$_linea" ] || continue
    _valor="${_linea#*=}"
    case "$_valor" in \"*\") _valor="${_valor:1:${#_valor}-2}" ;; \'*\') _valor="${_valor:1:${#_valor}-2}" ;; esac
    export "$_clave=$_valor"
  done < ./.env
  unset _linea _clave _valor
fi
unset DB_URL DB_SOCKET_PATH HISTORICO_HMAC_KEY HISTORICO_HMAC_KEY_VERSION HISTORICO_IMPORT_APPLY
export DB_HOST=127.0.0.1
export DB_NAME=sipra_performance
export PORT=3100
export STORAGE_DRIVER=local
export STORAGE_RUTA_LOCAL=./.almacen-performance
export LOG_NIVEL=info
export COLA_DRIVER=en_proceso
export SIPRA_AMBIENTE=dev
export AUTH_MODO=abierto
export AUTH_ABIERTO_CONFIRMADO=true
# Sin salidas externas durante la carga: IA simulada y correo por consola.
export IA_DRIVER=simulado
export CORREO_DRIVER=consola
# Métricas de Prometheus de la instancia de performance: token EFÍMERO local (performance/out/, ignorado por Git).
mkdir -p performance/out
[ -s performance/out/.metricas-token ] || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > performance/out/.metricas-token
export METRICAS_HABILITADAS=true
METRICAS_TOKEN="$(cat performance/out/.metricas-token)"
export METRICAS_TOKEN
