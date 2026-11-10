/**
 * Campo de señal del login: geometría determinista y reacción al puntero.
 * Funciones PURAS (sin DOM ni Angular) para que sean verificables en pruebas.
 *
 * Las medidas salen del frame aprobado de Figma (F5/F6 · Login, 1440 × 1024, nodo 32:978), leído con
 * el MCP: documento en (430, 330) de 250 × 330 girado 7° en sentido horario desde su esquina superior
 * izquierda; 34 curvas que nacen en el borde izquierdo (y = 60 + 29·i) y convergen en x = 560; rail de
 * señal en y = 502 de x = 560 a 930 con cinco nodos de 16 px cada 76 px (el primero en x = 620); 90
 * partículas de 3 px repartidas SOBRE las curvas. Coordenadas en unidades del `viewBox`.
 */

export const ANCHO_VB = 1440;
export const ALTO_VB = 1024;
export const SEMILLA_CAMPO = 0x51a7a;

/** Documento (hoja): esquina superior izquierda ya girada (x, y), tamaño y giro horario en grados. */
export const DOC = { x: 430, y: 330, ancho: 250, alto: 330, giro: 7 } as const;
/** Rail de salida: cinco nodos (tres aprobados, dos pendientes), de 16 px de diámetro. */
export const RAIL = {
  y: 502, x0: 560, x1: 930, radio: 8,
  nodos: [
    { x: 620, aprobado: true }, { x: 696, aprobado: true }, { x: 772, aprobado: true },
    { x: 848, aprobado: false }, { x: 924, aprobado: false },
  ],
} as const;

export const NUM_CURVAS = 34;
/** Convergencia de las curvas (Figma: x = 560, y = 500 ± 4.2·k). */
export const CONVERGENCIA = { x: 560, y: 500 } as const;

export type CapaNodo = 0 | 1 | 2; // 0 lejos · 1 medio · 2 cerca

export interface NodoCampo {
  id: number; x: number; y: number; r: number; capa: CapaNodo;
  /** Amplitud de deriva (unidades) por eje. */
  dx: number; dy: number;
  /** Duración del ciclo (s) y retraso NEGATIVO (s): desfasa cada nodo. */
  dur: number; retraso: number;
  opacidad: number;
}
export interface CurvaCampo {
  id: number; d: string; ancho: number; dur: number; retraso: number; opacidad: number;
  /** El tramo medio del degradado es cian (i % 3 === 0) en lugar de teal. */
  cian: boolean;
  /** Curva «caliente»: más gruesa, más intensa y con halo. */
  caliente: boolean;
}
export interface CampoGenerado { nodos: NodoCampo[]; curvas: CurvaCampo[] }

/** mulberry32: PRNG determinista y barato. */
export function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

/** Perfil por capa: cantidad, radio, rango de deriva, de duración y de opacidad (30 + 30 + 30 = 90 partículas). */
export const CAPAS = [
  { n: 30, r: 1.2, deriva: [4, 6], dur: [18, 24], op: [0.4, 0.7] },
  { n: 30, r: 1.5, deriva: [7, 11], dur: [14, 20], op: [0.4, 0.8] },
  { n: 30, r: 1.9, deriva: [12, 16], dur: [10, 15], op: [0.45, 0.8] },
] as const;

/** Índices (0-based) de las curvas calientes del frame. */
export const CURVAS_CALIENTES: readonly number[] = [6, 17, 26];

/** Punto de la curva `i` en el parámetro `t` (aproximación usada para repartir las partículas sobre ellas). */
export function puntoEnCurva(i: number, t: number): { x: number; y: number } {
  const y0 = 60 + i * 29;
  const yFin = CONVERGENCIA.y + (i - NUM_CURVAS / 2) * 4.2;
  return {
    x: -20 + t * (CONVERGENCIA.x + 20),
    y: y0 + (yFin - y0) * Math.pow(t, 1.6) + Math.sin(t * 5 + i) * 18 * (1 - t),
  };
}

export function generarCampo(semilla: number = SEMILLA_CAMPO): CampoGenerado {
  const rnd = prng(semilla);
  const entre = (a: number, b: number): number => a + rnd() * (b - a);

  const curvas: CurvaCampo[] = [];
  for (let i = 0; i < NUM_CURVAS; i += 1) {
    const y0 = 60 + i * 29;
    const ola = Math.sin(i * 0.6) * 60;
    const k = i - NUM_CURVAS / 2;
    const caliente = CURVAS_CALIENTES.includes(i);
    curvas.push({
      id: i,
      d: `M-20 ${y0}C260 ${redondear(y0 + ola)} 330 ${redondear(CONVERGENCIA.y + k * 9)} ${CONVERGENCIA.x} ${redondear(CONVERGENCIA.y + k * 4.2)}`,
      ancho: caliente ? 1.6 : 1,
      dur: redondear(entre(12, 24)),
      retraso: -redondear(entre(0, 24)),
      opacidad: 1,
      cian: i % 3 === 0,
      caliente,
    });
  }

  const nodos: NodoCampo[] = [];
  let id = 0;
  CAPAS.forEach((capa, indiceCapa) => {
    for (let i = 0; i < capa.n; i += 1) {
      const p = puntoEnCurva(Math.floor(rnd() * NUM_CURVAS), 0.04 + rnd() * 0.96);
      const dur = entre(capa.dur[0], capa.dur[1]);
      nodos.push({
        id: id++, x: redondear(Math.max(1, p.x)), y: redondear(Math.min(ALTO_VB - 1, Math.max(1, p.y))), r: capa.r, capa: indiceCapa as CapaNodo,
        dx: redondear(entre(capa.deriva[0], capa.deriva[1]) * (rnd() < 0.5 ? -1 : 1)),
        dy: redondear(entre(capa.deriva[0], capa.deriva[1]) * (rnd() < 0.5 ? -1 : 1)),
        dur: redondear(dur),
        retraso: -redondear(entre(0, dur)),
        opacidad: redondear(entre(capa.op[0], capa.op[1])),
      });
    }
  });
  return { nodos, curvas };
}

// ── Reacción al puntero ──────────────────────────────────────────────────────

export interface OpcionesReaccion {
  /** Radio de influencia (unidades). */
  radio: number;
  /** Desplazamiento máximo (unidades); la capa cercana lo alcanza, las demás menos. */
  maxDesplazamiento: number;
  /** Conexiones temporales máximas. */
  maxConexiones: number;
  /** El puntero está sobre el panel, un control o texto: no hay efecto alguno. */
  zonaProtegida: boolean;
}
export interface ReaccionNodo { indice: number; dx: number; dy: number; brillo: number }
export interface Reaccion { nodos: ReaccionNodo[]; conexiones: Array<[number, number]> }

export const REACCION_VACIA: Reaccion = { nodos: [], conexiones: [] };
const FACTOR_CAPA = [0.35, 0.65, 1] as const;

export function calcularReaccion(
  nodos: ReadonlyArray<Pick<NodoCampo, 'x' | 'y' | 'capa'>>,
  puntero: { x: number; y: number } | null,
  o: OpcionesReaccion,
): Reaccion {
  if (!puntero || o.zonaProtegida || o.radio <= 0) return REACCION_VACIA;
  const cercanos: Array<ReaccionNodo & { dist: number }> = [];
  nodos.forEach((n, indice) => {
    const vx = puntero.x - n.x;
    const vy = puntero.y - n.y;
    const dist = Math.hypot(vx, vy);
    if (dist >= o.radio) return;
    const f = (1 - dist / o.radio) ** 2;
    const mag = Math.min(o.maxDesplazamiento, o.maxDesplazamiento * FACTOR_CAPA[n.capa] * f);
    const ux = dist > 0 ? vx / dist : 0;
    const uy = dist > 0 ? vy / dist : 0;
    cercanos.push({ indice, dx: ux * mag, dy: uy * mag, brillo: f, dist });
  });
  cercanos.sort((a, b) => a.dist - b.dist);
  const conexiones: Array<[number, number]> = [];
  for (let i = 0; i + 1 < cercanos.length && conexiones.length < o.maxConexiones; i += 1) {
    conexiones.push([cercanos[i].indice, cercanos[i + 1].indice]);
  }
  return { nodos: cercanos.map(({ indice, dx, dy, brillo }) => ({ indice, dx, dy, brillo })), conexiones };
}
