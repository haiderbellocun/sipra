// Configuración común de los escenarios k6. Funciona igual con k6 NATIVO (recomendado: generador en otro equipo) y con
// Docker. Se ejecuta SIEMPRE desde la carpeta `performance/` (los resultados van a ./out/).
//
//   k6 run -e BASE=http://<IP_PC_SIPRA>:3100/api/v1 -e VUS=100 -e OFFSET=0 -e CORRIDA=<id> scenarios/03-upload.js
//
// BASE es OBLIGATORIA: no hay dirección por defecto (ni IP ni host.docker.internal).
export const BASE = __ENV.BASE;
if (!BASE) throw new Error('Defina BASE, por ejemplo -e BASE=http://<IP_PC_SIPRA>:3100/api/v1');
export const VUS = Number(__ENV.VUS || 1);
/** Índice del primer token del archivo de tokens (0 = primera fila). Cada corrida usa estudiantes DISTINTOS. */
export const OFFSET = Number(__ENV.OFFSET || 0);
export const ARCHIVO = __ENV.ARCHIVO || 'medio';
/** Tipo documental sin OCR ni lectura local (modo «configurado» con IA simulada): aísla el upload. */
export const TIPO = __ENV.TIPO || 'carta_aceptacion';
export const CORRIDA = __ENV.CORRIDA || `corrida-${Date.now()}`;
/** Carpeta de resultados relativa al directorio desde el que se ejecuta k6 (performance/). */
export const OUT = __ENV.OUT || 'out';

const RUTAS = { pequeno: 'pequeno.pdf', medio: 'medio.pdf', 'medio-jpg': 'medio.jpg', limite: 'limite.pdf', negativo: 'negativo.pdf' };
export const NOMBRE_ARCHIVO = RUTAS[ARCHIVO];
if (!NOMBRE_ARCHIVO) throw new Error(`ARCHIVO desconocido: ${ARCHIVO}`);
export const MIME = NOMBRE_ARCHIVO.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf';
/** Rutas relativas a la carpeta scenarios/ (donde se llama a open()). */
export const RUTA_BINARIO = `../archivos/${NOMBRE_ARCHIVO}`;
export const RUTA_TOKENS = __ENV.TOKENS || '../out/tokens.json';

export function sesionDe(tokens) {
  const t = tokens[OFFSET + __VU - 1];
  if (!t) throw new Error(`No hay token para el VU ${__VU} con OFFSET ${OFFSET}`);
  return t;
}

export const cabeceras = (token) => ({ Authorization: `Bearer ${token}` });
