/**
 * Qué no debe aparecer en los registros. Además de las cabeceras de sesión, la
 * URL de la petición: un enlace de descarga lleva su firma en la query y,
 * mientras no venza, equivale a una credencial.
 */
const PARAMETROS_SENSIBLES = ['sig', 'ruta', 'firma', 'token'];
const MARCA = '[Redacted]';

/** Conserva la URL para diagnóstico, pero enmascara el valor de los parámetros sensibles. */
export function redactarUrl(url: string): string {
  const corte = url.indexOf('?');
  if (corte < 0) return url;
  const parametros = new URLSearchParams(url.slice(corte + 1));
  for (const nombre of PARAMETROS_SENSIBLES) {
    if (parametros.has(nombre)) parametros.set(nombre, MARCA);
  }
  return `${url.slice(0, corte)}?${parametros.toString()}`;
}

/** Configuración `redact` de pino. */
export const REDACCION_LOGS = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.url',
    ...PARAMETROS_SENSIBLES.map((p) => `req.query.${p}`),
  ],
  censor: (valor: unknown, ruta: string[]): unknown =>
    ruta.join('.') === 'req.url' && typeof valor === 'string' ? redactarUrl(valor) : MARCA,
};
