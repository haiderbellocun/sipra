/**
 * Generador PURO de reportes_seed_1000 (sin base de datos ni efectos al importar): lo usan la herramienta
 * `seed-reportes-1000.ts` y las pruebas de invariantes `test/seed-reportes-1000.spec.ts`. Cada llamada a `generar()`
 * reinicia el generador con la semilla fija: misma entrada, mismo dataset.
 */
import { definicionModalidad, documentosExigidos, ModalidadPractica } from '../src/domain/entities/modalidad.entity';

export const SEED = 'reportes_seed_1000';
export const SEMILLA = 20261111;
export const REFERENCIA = Date.parse('2026-11-11T15:00:00.000Z');
const HORA = 3_600_000;
const DIA = 24 * HORA;
export const PREFIJO = '5eed1000-';
export const TOTAL = 1000;
/**
 * Versión del generador. Va dentro de cada ID: si cambia la lógica, los IDs cambian y la auditoría inmutable de una versión
 * anterior queda huérfana (apunta a documentos que ya no existen) en vez de contaminar documentos nuevos. Súbala en cada cambio.
 */
export const VERSION = 4;


// ── Generador reproducible ─────────────────────────────────────────────────────────────────────────────────────────────
function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let azar = mulberry32(SEMILLA);
const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
const uno = <T>(l: readonly T[]): T => l[Math.floor(azar() * l.length)];
function barajar<T>(l: T[]): T[] {
  for (let i = l.length - 1; i > 0; i -= 1) { const j = Math.floor(azar() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
}
/** Tamaños pseudoaleatorios en [min, max] que suman exactamente `total`. */
function tamanos(n: number, min: number, max: number, total: number): number[] {
  const t = Array.from({ length: n }, () => entero(min, max));
  let dif = total - t.reduce((a, b) => a + b, 0);
  while (dif !== 0) {
    const i = Math.floor(azar() * n);
    if (dif > 0 && t[i] < max) { t[i] += 1; dif -= 1; } else if (dif < 0 && t[i] > min) { t[i] -= 1; dif += 1; }
  }
  return t;
}
const expandir = <T>(valores: readonly T[], cantidades: readonly number[]): T[] => valores.flatMap((v, i) => Array<T>(cantidades[i]).fill(v));
const id = (tipo: number, n: number) => `${PREFIJO}${tipo}${String(VERSION).padStart(3, '0')}-4000-8000-${String(n).padStart(12, '0')}`;
const p2 = (n: number) => String(n).padStart(2, '0');
const p4 = (n: number) => String(n).padStart(4, '0');

// ── Matriz académica (sintética) ───────────────────────────────────────────────────────────────────────────────────────
export const ESCUELAS = [
  { codigo: 'SYN-ESC-ING', nombre: 'Escuela de Ingeniería' },
  { codigo: 'SYN-ESC-DYC', nombre: 'Escuela de Diseño y Comunicación' },
  { codigo: 'SYN-ESC-SJG', nombre: 'Escuela de Ciencias Sociales, Jurídicas y Gobierno' },
  { codigo: 'SYN-ESC-TEM', nombre: 'Escuela de Transformación Empresarial' },
];
export const PROGRAMAS: { codigo: string; nombre: string; escuela: string }[] = [
  ['SYN-ING-ELE', 'Ingeniería Electrónica', 'SYN-ESC-ING'], ['SYN-ING-SIS', 'Ingeniería de Sistemas', 'SYN-ESC-ING'],
  ['SYN-ING-IND', 'Ingeniería Industrial', 'SYN-ESC-ING'], ['SYN-ING-SOF', 'Ingeniería de Software', 'SYN-ESC-ING'],
  ['SYN-DYC-MOD', 'Diseño de Modas', 'SYN-ESC-DYC'], ['SYN-DYC-GRA', 'Diseño Gráfico', 'SYN-ESC-DYC'],
  ['SYN-DYC-AUD', 'Dirección y Producción de Medios Audiovisuales', 'SYN-ESC-DYC'], ['SYN-DYC-COM', 'Comunicación Social', 'SYN-ESC-DYC'],
  ['SYN-DYC-PUB', 'Publicidad y Mercadeo', 'SYN-ESC-DYC'], ['SYN-DYC-EXI', 'Diseño de Experiencias Interactivas', 'SYN-ESC-DYC'],
  ['SYN-SJG-ADP', 'Administración Pública', 'SYN-ESC-SJG'],
  ['SYN-TEM-ADE', 'Administración de Empresas', 'SYN-ESC-TEM'], ['SYN-TEM-ADD', 'Administración Deportiva', 'SYN-ESC-TEM'],
  ['SYN-TEM-ASS', 'Administración de la Seguridad Social', 'SYN-ESC-TEM'], ['SYN-TEM-ASA', 'Administración de Servicios de Salud', 'SYN-ESC-TEM'],
  ['SYN-TEM-AEA', 'Administración de Empresas Agroindustriales', 'SYN-ESC-TEM'], ['SYN-TEM-CON', 'Contaduría Pública', 'SYN-ESC-TEM'],
].map(([codigo, nombre, escuela]) => ({ codigo, nombre, escuela }));
/**
 * Periodos confirmados en `periodos_academicos` (presencial 2026A–B, virtual 26V04–06, calendario 335: 26P05–06). No se crean
 * filas en el catálogo; si alguno falta, `crear` aborta.
 */
export const PERIODOS = ['2026A', '2026B', '26V04', '26V05', '26V06', '26P05', '26P06'];
const SEMESTRES = [4, 5, 6, 7, 8, 9];
const CICLO_SINTETICO = (s: number) => (s === 4 ? 'tecnico' : s <= 6 ? 'tecnologo' : 'profesional');
/**
 * Las 14 modalidades reales con cantidades exactas. Las 7 articuladas (internas CUN según el dominio) suman 120; las 7
 * externas, 880. Si cambia la regla `articulada` del dominio, `crear` aborta (se verifica abajo).
 */
export const MODALIDADES: [ModalidadPractica, number][] = [
  [ModalidadPractica.MONITORIA, 22], [ModalidadPractica.SOCIAL, 20], [ModalidadPractica.INVESTIGACION, 18],
  [ModalidadPractica.PRACTICA_TECNICA_INVESTIGACION, 16], [ModalidadPractica.PASANTIA_INVESTIGATIVA, 16],
  [ModalidadPractica.CUNBRE_NACIENTE, 14], [ModalidadPractica.CUNBRE_CONSOLIDADO, 14],
  [ModalidadPractica.PASANTIA, 300], [ModalidadPractica.CONTRATO_APRENDIZAJE, 150], [ModalidadPractica.VALIDACION_EXPERIENCIA, 120],
  [ModalidadPractica.COMBINACION_FUNCIONES, 100], [ModalidadPractica.ESTADO_JOVEN, 80], [ModalidadPractica.ASESORIA_ASISTENCIA_TECNICA, 70],
  [ModalidadPractica.PASANTIA_INTERNACIONAL, 60],
];
export const INTERNAS = 120;
export const articulada = (m: string): boolean => definicionModalidad(m as ModalidadPractica).articulada;

/** Sección CIIU → clases de `cat_ciiu` disponibles para las empresas sintéticas (verificadas contra el catálogo al crear). */
export const CLASES_CIIU: Record<string, string[]> = {
  A: ['0111', '0122', '0123', '0141'], C: ['1011', '1081', '1311', '1410', '2211'], G: ['4511', '4631', '4645', '4652', '4711', '4741', '4771'],
  J: ['6201', '6202', '6209', '6311', '5911', '6010', '6110'], K: ['6412', '6424', '6492', '6511'], M: ['6910', '6920', '7010', '7020', '7110', '7310', '7410'],
  N: ['7810', '7830', '8010', '8211', '8220', '8299'], O: ['8411', '8412'], Q: ['8610', '8621', '8899'], R: ['9001', '9319'],
};
const SECCIONES_EXTERNAS = Object.keys(CLASES_CIIU);
export const CIIU_CUN = '8544'; // Educación de instituciones universitarias (sección P).
/** Municipios DIVIPOLA (catálogo real) con el peso de estudiantes externos nacionales. Bogotá también recibe a la CUN interna. */
export const CIUDADES: [string, number][] = [
  ['11001', 22], ['05001', 13], ['76001', 11], ['08001', 9], ['68001', 7], ['13001', 6],
  ['66001', 5], ['17001', 4], ['73001', 4], ['50001', 4], ['54001', 4], ['47001', 3],
];
export const CIUDAD_CUN = '11001'; // Un solo registro sintético CUN en Bogotá: no se inventan sedes.
/** Pesos del generador (NO reglas de negocio): afinidad de cada escuela/programa con cada sección CIIU. */
function afinidad(programa: { codigo: string; escuela: string }, seccion: string): number {
  const especial: Record<string, Record<string, number>> = {
    'SYN-TEM-ASA': { Q: 6, O: 2 }, 'SYN-TEM-ASS': { Q: 4, O: 4, K: 2 }, 'SYN-TEM-AEA': { A: 6, C: 2 }, 'SYN-TEM-ADD': { R: 6 },
    'SYN-TEM-CON': { K: 5, M: 4 }, 'SYN-DYC-MOD': { C: 4, G: 4 }, 'SYN-DYC-AUD': { J: 5, R: 3 },
  };
  const porEscuela: Record<string, Record<string, number>> = {
    'SYN-ESC-ING': { J: 5, C: 4, N: 2, M: 2 }, 'SYN-ESC-DYC': { M: 5, J: 4, G: 3, R: 2 },
    'SYN-ESC-SJG': { O: 6, N: 2, Q: 2 }, 'SYN-ESC-TEM': { K: 3, N: 3, G: 3, O: 2, M: 2 },
  };
  return especial[programa.codigo]?.[seccion] ?? porEscuela[programa.escuela]?.[seccion] ?? 1;
}
type Situacion = 'completo' | 'en_curso' | 'requiere_correccion' | 'sin_iniciar';
/** Situación objetivo (la deriva el dominio de los documentos) y los estados reales de práctica coherentes con ella. */
const SITUACIONES: [Situacion, number, [string, number][]][] = [
  ['completo', 225, [['certificada', 80], ['finalizada', 75], ['activa', 70]]],
  ['en_curso', 425, [['activa', 130], ['en_validacion', 130], ['documentacion', 120], ['suspendida', 45]]],
  ['requiere_correccion', 275, [['documentacion', 95], ['en_validacion', 85], ['activa', 50], ['suspendida', 25], ['cancelada', 20]]],
  ['sin_iniciar', 75, [['inscrita', 55], ['documentacion', 10], ['cancelada', 10]]],
];
/** Estado final de una obligación según la situación objetivo (null = sin cargar). */
function estadoFinal(situacion: Situacion): string | null {
  const r = azar();
  if (situacion === 'completo') return r < 0.95 ? 'aprobado' : 'auto_aprobado';
  if (situacion === 'en_curso') {
    return r < 0.22 ? null : r < 0.62 ? 'aprobado' : r < 0.64 ? 'auto_aprobado' : r < 0.86 ? 'en_revision' : r < 0.93 ? 'recibido' : 'analizando';
  }
  return r < 0.20 ? null : r < 0.50 ? 'aprobado' : r < 0.68 ? 'en_revision' : r < 0.73 ? 'recibido' : r < 0.77 ? 'analizando'
    : r < 0.92 ? 'devuelto' : r < 0.96 ? 'ilegible' : 'rechazado';
}
const CORRECCION = new Set(['devuelto', 'ilegible', 'rechazado']);
const CON_INICIO = new Set(['activa', 'suspendida', 'finalizada', 'certificada']);

export interface Version { id: string; practica: string; tipo: string; version: number; estado: string; cargado: number; decision: 'aprobar' | 'devolver' | 'rechazar' | null; decidido: number | null; docente: string }

/** `ambito` es del FIXTURE: SIPRA no guarda país; «internacional» solo se expone en Reportes con el modo sintético de dev. */
export type Ambito = 'cun' | 'nacional' | 'internacional';
export interface Organizacion { id: string; razon: string; nit: string; dv: number; ciiu: string; seccion: string; divipola: string | null; ambito: Ambito; tamano: number; libre: number }

export function generar() {
  azar = mulberry32(SEMILLA);
  const programas = barajar(expandir(PROGRAMAS, tamanos(PROGRAMAS.length, 45, 75, TOTAL)));
  const semestres = barajar(expandir(SEMESTRES, tamanos(SEMESTRES.length, 150, 185, TOTAL)));
  const periodos = barajar(expandir(PERIODOS, tamanos(PERIODOS.length, 125, 160, TOTAL)));
  const modalidades = barajar(expandir(MODALIDADES.map((m) => m[0]), MODALIDADES.map((m) => m[1])));
  const situaciones = barajar(expandir(SITUACIONES.map((x) => x[0]), SITUACIONES.map((x) => x[1])));
  const estadosPor = new Map(SITUACIONES.map(([sit, , est]) => [sit, barajar(expandir(est.map((e) => e[0]), est.map((e) => e[1])))]));

  const docentes = ESCUELAS.flatMap((e, ie) => Array.from({ length: [4, 5, 2, 4][ie] }, (_, k) => ({ escuela: e.codigo, n: 0, k })))
    .map((d, i) => ({ ...d, n: i + 1, id: id(5, i + 1), nombre: `Docente Reportes ${p2(i + 1)}`, correo: `docente.reportes.${p2(i + 1)}@cun.edu.co` }));
  // ── Organizaciones receptoras ─────────────────────────────────────────────────────────────────────────────────
  const cun: Organizacion = { id: id(4, 1), razon: 'CUN · Práctica interna (registro sintético de prueba)', nit: '999100001', dv: 1, ciiu: CIIU_CUN, seccion: 'P', divipola: CIUDAD_CUN, ambito: 'cun', tamano: INTERNAS, libre: INTERNAS };
  const internacionales = MODALIDADES.find((m) => m[0] === ModalidadPractica.PASANTIA_INTERNACIONAL)![1];
  const nacionales = TOTAL - INTERNAS - internacionales;
  // Tamaños: grandes (20–30), medianas (8–15) y pequeñas (3–8); nadie concentra una proporción absurda.
  const tamNac = [...tamanos(9, 20, 30, 225), ...tamanos(28, 8, 15, 322), ...tamanos(48, 3, 8, nacionales - 225 - 322)];
  const nombres = ['Andina', 'Horizonte', 'Nova', 'Cumbre', 'Faro', 'Ceiba', 'Delta', 'Prisma', 'Sierra', 'Vértice', 'Aurora', 'Brújula'];
  let nOrg = 1;
  const nuevaOrg = (tamano: number, seccion: string, divipola: string | null, ambito: Ambito, sufijo = ''): Organizacion => {
    nOrg += 1;
    const n = nOrg - 1;
    return { id: id(4, nOrg), razon: `Empresa Sintética ${nombres[n % nombres.length]} ${String(n).padStart(3, '0')}${sufijo} S.A.S.`, nit: `9992${String(n).padStart(5, '0')}`, dv: (n * 7) % 10,
      ciiu: uno(CLASES_CIIU[seccion]), seccion, divipola, ambito, tamano, libre: tamano };
  };
  // Sector por empresa: rotación sobre las 10 secciones en orden barajado (cada sección recibe empresas de todos los tamaños).
  const secciones = barajar([...SECCIONES_EXTERNAS]);
  const orgsNac = barajar(tamNac.map((t, i) => ({ t, i }))).map((x, k) => nuevaOrg(x.t, secciones[k % secciones.length], null, 'nacional'));
  // Ciudad por empresa: de mayor a menor, la ciudad con más déficit frente a su peso (una ciudad principal por empresa).
  const pesoTotal = CIUDADES.reduce((n, c) => n + c[1], 0);
  const asignado = new Map(CIUDADES.map(([c]) => [c, 0]));
  for (const o of [...orgsNac].sort((a, b) => b.tamano - a.tamano)) {
    const [ciudad] = CIUDADES.map(([c, w]) => [c, (w / pesoTotal) * nacionales - (asignado.get(c) ?? 0)] as const).sort((a, b) => b[1] - a[1])[0];
    o.divipola = ciudad;
    asignado.set(ciudad, (asignado.get(ciudad) ?? 0) + o.tamano);
  }
  // Pasantía internacional: receptoras en el exterior (sin municipio DIVIPOLA, que solo cubre Colombia).
  const orgsInt = tamanos(4, 12, 18, internacionales).map((t, k) => nuevaOrg(t, ['J', 'M', 'N', 'C'][k], null, 'internacional', ' (exterior)'));
  const organizaciones = [cun, ...orgsNac, ...orgsInt];
  /** Elige receptora con capacidad libre, ponderada por afinidad × capacidad (las cuotas por empresa se cumplen exactas). */
  const elegirOrg = (lista: Organizacion[], programa: { codigo: string; escuela: string }): Organizacion => {
    const libres = lista.filter((o) => o.libre > 0);
    const pesos = libres.map((o) => afinidad(programa, o.seccion) * o.libre);
    let x = azar() * pesos.reduce((a, b) => a + b, 0);
    for (let k = 0; k < libres.length; k += 1) { x -= pesos[k]; if (x <= 0) return libres[k]; }
    return libres[libres.length - 1];
  };

  const estudiantes: { id: string; nombre: string; correo: string; documento: string; programa: string }[] = [];
  const practicas: Record<string, unknown>[] = [];
  const semestreDe: { practica: string; semestre: number }[] = [];
  const versiones: Version[] = [];
  let nDoc = 0;

  for (let i = 0; i < TOTAL; i += 1) {
    const n = i + 1;
    const programa = programas[i];
    const semestre = semestres[i];
    const modalidad = modalidades[i];
    const situacion = situaciones[i];
    const estado = estadosPor.get(situacion)!.pop() as string;
    const periodo = periodos[i];
    const est = { id: id(1, n), nombre: `Estudiante Reportes ${p4(n)}`, correo: `reportes.${p4(n)}@estudiante.cun.edu.co`, documento: `99${String(n).padStart(8, '0')}`, programa: programa.codigo };
    estudiantes.push(est);
    const docentesEscuela = docentes.filter((d) => d.escuela === programa.escuela);
    const docente = uno(docentesEscuela);
    const empresa = articulada(modalidad) ? cun : modalidad === ModalidadPractica.PASANTIA_INTERNACIONAL ? elegirOrg(orgsInt, programa) : elegirOrg(orgsNac, programa);
    empresa.libre -= 1;
    const inicio = REFERENCIA - entero(40, 150) * DIA;
    const practica = id(2, n);
    practicas.push({
      id: practica, estudiante: est.id, programa: programa.codigo, escuela: programa.escuela, ciclo: CICLO_SINTETICO(semestre), periodo, modalidad, estado,
      fur: 910_000_000 + n, tutor: docente.id, empresaId: empresa?.id ?? null, empresaRazon: empresa?.razon ?? null,
      fechaInicio: CON_INICIO.has(estado) ? new Date(inicio) : null, arl: CON_INICIO.has(estado), arlFecha: CON_INICIO.has(estado) ? new Date(inicio - 5 * DIA) : null,
      fechaFin: ['finalizada', 'certificada'].includes(estado) ? new Date(REFERENCIA - entero(2, 30) * DIA) : null,
      nota: estado === 'certificada' ? Math.round((3.5 + azar() * 1.5) * 10) / 10 : null,
      cerrada: estado === 'certificada' ? new Date(REFERENCIA - entero(1, 20) * DIA) : null,
    });
    semestreDe.push({ practica, semestre });

    // Estados finales por obligación, ajustados para que el dominio derive exactamente la situación objetivo.
    const tipos = documentosExigidos(modalidad);
    const finales: (string | null)[] = situacion === 'sin_iniciar' ? tipos.map(() => null) : tipos.map(() => estadoFinal(situacion));
    if (situacion === 'en_curso') {
      if (finales.every((f): boolean => f === null)) finales[Math.floor(azar() * finales.length)] = 'en_revision';
      if (finales.every((f): boolean => f === 'aprobado' || f === 'auto_aprobado')) finales[Math.floor(azar() * finales.length)] = 'en_revision';
    }
    if (situacion === 'requiere_correccion' && !finales.some((f) => f !== null && CORRECCION.has(f))) {
      finales[Math.floor(azar() * finales.length)] = 'devuelto';
    }
    tipos.forEach((tipo, it) => {
      const final = finales[it];
      if (final === null) return; // obligación sin cargar
      const k = azar();
      const previas = final === 'rechazado' || final === 'auto_aprobado' ? 0
        : final === 'devuelto' || final === 'ilegible' ? (k < 0.75 ? 0 : k < 0.95 ? 1 : 2)
          : k < 0.70 ? 0 : k < 0.90 ? 1 : k < 0.97 ? 2 : 3;
      const cadena = [...Array<string>(previas).fill('devuelto'), final];
      let t = REFERENCIA - entero(4, 112) * DIA - entero(0, 23) * HORA;
      cadena.forEach((estadoV, v) => {
        nDoc += 1;
        const decision = estadoV === 'aprobado' ? 'aprobar' : estadoV === 'devuelto' ? 'devolver' : estadoV === 'rechazado' ? 'rechazar' : null;
        // Carga → decisión: cola larga (mediana ~1,5 días, p90 ~5–6 días); nunca antes de la carga ni después de la referencia.
        let decidido: number | null = null;
        if (decision) {
          const horas = Math.min(400, Math.max(0.5, Math.exp(Math.log(30) + 0.95 * gauss())));
          decidido = Math.min(t + horas * HORA, REFERENCIA - HORA);
          if (decidido <= t) decidido = t + 0.5 * HORA;
        }
        versiones.push({ id: id(3, nDoc), practica, tipo, version: v + 1, estado: estadoV, cargado: t, decision, decidido, docente: docente.id });
        if (decidido !== null) t = Math.min(decidido + (0.3 + azar() * 5) * DIA, REFERENCIA - 2 * HORA);
      });
    });
  }
  if (organizaciones.some((o) => o.libre !== 0)) throw new Error('Cuotas de organizaciones sin cerrar: revise los tamaños.');
  return { docentes, organizaciones, estudiantes, practicas, semestreDe, versiones };
}
function gauss(): number {
  const u = Math.max(azar(), 1e-9), v = azar();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

