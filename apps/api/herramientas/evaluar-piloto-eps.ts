/* eslint-disable no-console */
/**
 * Evaluación de calidad de la lectura LOCAL de certificados de EPS para el piloto (Fase 6).
 *
 * Mide, por campo y con un manifiesto SIN datos personales, cuántos valores salieron correctos, incorrectos,
 * no extraídos o ambiguos (no basta con «el documento se procesó»), la detección de QR y la carga operativa de
 * la lectura (OCR, ilegibles, tiempos). NO inventa resultados: sin corpus no hay cifras.
 *
 *   Corpus real o anonimizado (FUERA de Git):   pilot-data/documentos/<archivo>   +   pilot-data/manifiesto-evaluacion.csv
 *   npm run piloto:evaluar --workspace=@sipra/api                      → evalúa pilot-data/
 *   npm run piloto:evaluar --workspace=@sipra/api -- --json salida.json → además guarda el resumen agregado
 *   npm run piloto:evaluar --workspace=@sipra/api -- --sintetico        → autoprueba con un corpus sintético generado en memoria
 *   printf '1032456786' | npm run piloto:evaluar --workspace=@sipra/api -- --hash-documento   → hash para el manifiesto
 *   printf 'LAURA SOFIA RAMIREZ ORTIZ' | npm run piloto:evaluar --workspace=@sipra/api -- --hash-nombre
 *
 * El manifiesto guarda la identidad como SHA-256 de su forma normalizada (hash_documento, hash_nombre): quien
 * anota el corpus no escribe cédulas ni nombres en un archivo. Los demás esperados no identifican a nadie.
 * La herramienta no imprime valores extraídos: solo el id del caso y las clases de resultado.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import {
  claveEps, normalizarDocumento, normalizarEstadoReportado, normalizarRegimen, tokensDeNombre,
} from '../src/domain/services/normalizacion-identidad';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { imagenCertificado, pdfDigital, pdfEscaneado, pngQr } from '../test/soporte-lectura-local';

type Clase = 'correcto' | 'incorrecto' | 'no_extraido' | 'ambiguo' | 'sin_esperado';
const CAMPOS = ['documento', 'nombre', 'eps', 'regimen', 'estado', 'fecha_expedicion'] as const;
type Campo = (typeof CAMPOS)[number];

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
export const hashDocumento = (valor: string): string => sha(normalizarDocumento(valor).numero ?? '');
export const hashNombre = (valor: string): string => sha(tokensDeNombre(valor).sort().join(' '));

export const COLUMNAS = ['caso_id', 'archivo', 'formato', 'tipo_documento', 'tiene_qr', 'hash_documento', 'hash_nombre', 'eps_esperada', 'regimen_esperado', 'estado_esperado', 'fecha_expedicion_esperada', 'observaciones'] as const;

interface Caso { caso_id: string; archivo: string; formato: string; tipo_documento: string; tiene_qr: string; hash_documento: string; hash_nombre: string; eps_esperada: string; regimen_esperado: string; estado_esperado: string; fecha_expedicion_esperada: string; observaciones: string }

export function leerManifiesto(texto: string): Caso[] {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const cab = lineas[0].split(',').map((c) => c.trim());
  for (const c of COLUMNAS) if (!cab.includes(c)) throw new Error(`El manifiesto no tiene la columna «${c}»`);
  return lineas.slice(1).map((l) => {
    const v = l.split(',').map((x) => x.trim());
    return Object.fromEntries(cab.map((c, i) => [c, v[i] ?? ''])) as unknown as Caso;
  });
}

function clasificar(esperado: string, extraido: string | null, ambiguo: boolean): Clase {
  if (!esperado) return 'sin_esperado';
  if (extraido === null || extraido === '') return 'no_extraido';
  if (ambiguo) return 'ambiguo';
  return extraido === esperado ? 'correcto' : 'incorrecto';
}

async function evaluarCaso(servicio: LecturaLocalEpsService, c: Caso, contenido: Buffer) {
  const mime = c.formato === 'pdf' ? 'application/pdf' : c.formato === 'png' ? 'image/png' : 'image/jpeg';
  const r = await servicio.leer(contenido, mime);
  const valor = (k: string): string | null => r.campos[k]?.valor ?? null;
  const amb = (k: string): boolean => r.resumen.discrepanciasFuentes.some((d) => d.campo === k);
  const doc = normalizarDocumento(valor('documento_afiliado')).numero;
  const nom = valor('nombre_afiliado');
  const clases: Record<Campo, Clase> = {
    documento: clasificar(c.hash_documento, doc ? sha(doc) : null, amb('documento_afiliado')),
    nombre: clasificar(c.hash_nombre, nom ? sha(tokensDeNombre(nom).sort().join(' ')) : null, amb('nombre_afiliado')),
    eps: clasificar(c.eps_esperada ? (claveEps(c.eps_esperada) ?? '') : '', claveEps(valor('entidad_emisora')), amb('entidad_emisora')),
    // Esperado y extraído pasan por el MISMO normalizador del dominio: se compara el significado, no el texto.
    regimen: clasificar(normalizarRegimen(c.regimen_esperado).regimen ?? '', normalizarRegimen(valor('regimen')).regimen, amb('regimen')),
    estado: clasificar(normalizarEstadoReportado(c.estado_esperado) ?? '', normalizarEstadoReportado(valor('estado_afiliacion')), amb('estado_afiliacion')),
    fecha_expedicion: clasificar(c.fecha_expedicion_esperada, null, amb('fecha_expedicion')),
  };
  // La fecha se compara por su forma ISO si se leyó (el normalizador vive en el dominio).
  const f = valor('fecha_expedicion');
  if (c.fecha_expedicion_esperada) {
    const { fechaIsoDe } = await import('../src/domain/services/normalizacion-identidad');
    const iso = fechaIsoDe(f);
    clases.fecha_expedicion = clasificar(c.fecha_expedicion_esperada, iso, amb('fecha_expedicion'));
  }
  return {
    clases, ilegible: r.ilegible, ocr: r.resumen.ocr.ejecutado, ms: r.resumen.duracionMs,
    qr: r.resumen.qr.hallazgos.length, qrNoInterpretable: r.resumen.qr.hallazgos.filter((h) => h.tipo !== 'url').length, limites: r.resumen.limitesAplicados,
  };
}

const pct = (a: number, b: number): string => (b === 0 ? 'n/d' : `${Math.round((a / b) * 1000) / 10} %`);

export async function evaluar(casos: Caso[], leerArchivo: (c: Caso) => Buffer | null) {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalEpsService(lector);
  const matriz: Record<Campo, Record<Clase, number>> = Object.fromEntries(CAMPOS.map((k) => [k, { correcto: 0, incorrecto: 0, no_extraido: 0, ambiguo: 0, sin_esperado: 0 }])) as never;
  const qr = { tp: 0, fn: 0, fp: 0, tn: 0, noInterpretable: 0 };
  let ocr = 0, ilegibles = 0, sinArchivo = 0;
  const tiempos: number[] = [];
  const detalle: Array<{ caso: string; clases: Record<Campo, Clase>; ilegible: boolean; ocr: boolean }> = [];
  try {
    for (const c of casos) {
      const contenido = leerArchivo(c);
      if (!contenido) { sinArchivo += 1; continue; }
      const e = await evaluarCaso(servicio, c, contenido);
      for (const k of CAMPOS) matriz[k][e.clases[k]] += 1;
      if (e.ocr) ocr += 1;
      if (e.ilegible) ilegibles += 1;
      tiempos.push(e.ms);
      qr.noInterpretable += e.qrNoInterpretable;
      const espera = c.tiene_qr.toLowerCase() === 'si';
      if (c.tiene_qr) { if (espera && e.qr > 0) qr.tp += 1; else if (espera) qr.fn += 1; else if (e.qr > 0) qr.fp += 1; else qr.tn += 1; }
      detalle.push({ caso: c.caso_id, clases: e.clases, ilegible: e.ilegible, ocr: e.ocr });
    }
  } finally { await lector.onModuleDestroy(); }
  const n = detalle.length;
  tiempos.sort((a, b) => a - b);
  const resumen = {
    casos: n, sinArchivo,
    campos: Object.fromEntries(CAMPOS.map((k) => {
      const m = matriz[k];
      const evaluados = m.correcto + m.incorrecto + m.no_extraido + m.ambiguo;
      const extraidos = m.correcto + m.incorrecto + m.ambiguo;
      return [k, { ...m, evaluados, precision: pct(m.correcto, m.correcto + m.incorrecto), cobertura: pct(extraidos, evaluados), exactitud: pct(m.correcto, evaluados) }];
    })),
    qr: { ...qr, deteccion: pct(qr.tp, qr.tp + qr.fn), falsosPositivos: qr.fp, noInterpretable: qr.noInterpretable },
    operacion: { requierenOcr: pct(ocr, n), ilegibles: pct(ilegibles, n), msMedio: n ? Math.round(tiempos.reduce((a, b) => a + b, 0) / n) : 0, msP95: n ? tiempos[Math.min(n - 1, Math.floor(n * 0.95))] : 0 },
  };
  return { resumen, detalle };
}

function imprimir(resumen: Awaited<ReturnType<typeof evaluar>>['resumen']): void {
  console.log(`\nCasos evaluados: ${resumen.casos}${resumen.sinArchivo ? ` (${resumen.sinArchivo} sin archivo)` : ''}`);
  console.log('\nMATRIZ POR CAMPO (correcto / incorrecto / no_extraído / ambiguo)');
  console.table(Object.fromEntries(Object.entries(resumen.campos).map(([k, v]) => [k, {
    correcto: v.correcto, incorrecto: v.incorrecto, no_extraido: v.no_extraido, ambiguo: v.ambiguo, 'precisión': v.precision, cobertura: v.cobertura, exactitud: v.exactitud,
  }])));
  console.log('QR', JSON.stringify(resumen.qr));
  console.log('OPERACIÓN DE LA LECTURA', JSON.stringify(resumen.operacion));
}

// ── Corpus sintético (autoprueba) ───────────────────────────────────────────
const lineas = (eps: string, nombre: string, doc: string, regimen: string, estado: string): string[] => [
  `Entidad Promotora de Salud ${eps}`, 'CERTIFICADO DE AFILIACION', `Nombre: ${nombre}`, `Documento: CC ${doc}`, `Régimen: ${regimen}`, `Estado: ${estado}`, 'Fecha de expedición: 20/10/2026',
];

async function corpusSintetico(dir: string): Promise<string> {
  const qr = await pngQr('https://eps.example/validar?id=1');
  const piezas: Array<{ id: string; ext: string; contenido: Buffer; qr: boolean; eps: string; reg: string; est: string; nombre: string; doc: string }> = [];
  const personas = [['LAURA SOFIA RAMIREZ ORTIZ', '1032456786'], ['ANDRES FELIPE MORA CASTANO', '1019887659'], ['VALENTINA OCHOA RUIZ', '1023445561']];
  const epss = [['NUEVA EPS S.A.', 'Contributivo', 'ACTIVO'], ['SANITAS S.A.S.', 'Subsidiado', 'ACTIVO'], ['COMPENSAR EPS', 'Contributivo', 'INACTIVO']];
  let i = 0;
  for (const [n, d] of personas) {
    for (const [e, r, s] of epss) {
      i += 1;
      const l = lineas(e, n, d, r, s);
      const modo = i % 4;
      const contenido = modo === 0 ? await pdfEscaneado([await imagenCertificado(l)]) : modo === 1 ? await pdfDigital(l, { qrs: [qr] }) : modo === 2 ? await imagenCertificado(l) : await pdfDigital(l);
      piezas.push({ id: `S${String(i).padStart(3, '0')}`, ext: modo === 2 ? 'png' : 'pdf', contenido, qr: modo === 1, eps: e, reg: r.toLowerCase(), est: s.toLowerCase(), nombre: n, doc: d });
    }
  }
  // Un PDF truncado: debe quedar «no_extraído», no inventar valores.
  const roto = await pdfDigital(lineas('NUEVA EPS S.A.', personas[0][0], personas[0][1], 'Contributivo', 'ACTIVO'));
  piezas.push({ id: 'S999', ext: 'pdf', contenido: roto.subarray(0, Math.floor(roto.length / 3)), qr: false, eps: 'NUEVA EPS S.A.', reg: 'contributivo', est: 'activo', nombre: personas[0][0], doc: personas[0][1] });
  const filas = [COLUMNAS.join(',')];
  for (const p of piezas) {
    writeFileSync(join(dir, `${p.id}.${p.ext}`), p.contenido);
    filas.push([p.id, `${p.id}.${p.ext}`, p.ext, p.ext === 'png' ? 'imagen' : p.contenido.length > 0 && p.id !== 'S999' && p.qr ? 'pdf_digital' : 'pdf_o_escaneado', p.qr ? 'si' : 'no',
      hashDocumento(p.doc), hashNombre(p.nombre), p.eps, p.reg, p.est, '2026-10-20', 'sintetico'].join(','));
  }
  return filas.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--hash-documento') || args.includes('--hash-nombre')) {
    const entrada = readFileSync(0, 'utf8').trim();
    console.log(args.includes('--hash-documento') ? hashDocumento(entrada) : hashNombre(entrada));
    return;
  }
  const sintetico = args.includes('--sintetico');
  const salida = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  let raiz = process.env.PILOT_DIR ?? join(__dirname, '..', '..', '..', 'pilot-data');
  let limpiar: string | null = null;
  if (sintetico) {
    raiz = mkdtempSync(join(tmpdir(), 'sipra-piloto-sintetico-'));
    limpiar = raiz;
    writeFileSync(join(raiz, 'manifiesto-evaluacion.csv'), await corpusSintetico(raiz));
    console.log('Modo SINTÉTICO: corpus generado en memoria; las cifras NO describen documentos reales.');
  }
  try {
    const manifiesto = join(raiz, 'manifiesto-evaluacion.csv');
    if (!existsSync(manifiesto)) {
      console.log(`No hay corpus: falta ${manifiesto}.\nSin documentos autorizados o anonimizados no se calcula ninguna cifra (no se inventan). Ver «ESTADO PILOTO EPS» en el documento técnico.`);
      process.exitCode = 0;
      return;
    }
    const casos = leerManifiesto(readFileSync(manifiesto, 'utf8'));
    const carpeta = sintetico ? raiz : join(raiz, 'documentos');
    const { resumen, detalle } = await evaluar(casos, (c) => { const p = join(carpeta, c.archivo); return existsSync(p) ? readFileSync(p) : null; });
    imprimir(resumen);
    if (salida) writeFileSync(salida, JSON.stringify({ resumen, detalle }, null, 2));
  } finally {
    if (limpiar) rmSync(limpiar, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
