import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { Celda } from '../../domain/historico/fechas-sgp.parser';
import { COLUMNAS_LEIDAS, COLUMNAS_SGP, ColumnaSgp, FilaFuente, FilaSgp, idRegistroSgp } from '../../domain/historico/registro-historico';
import { EstadisticasLectura, FuenteSgp, MetadatosArchivo } from '../../domain/ports/out/historico-repositorio.port';
import { ArchivoSgpInvalidoError, sha256DeArchivo } from './lector-xlsx-sgp';

/**
 * Lector XLSX en flujo propio para el Excel del SGP (H3, §27.8). Solo usa `fs` y `zlib` de Node.
 *
 * Por qué no `exceljs` para la carga real:
 *  - el archivo del SGP trae `sheet1.xml` (285 MB) ANTES de `sharedStrings.xml`; `exceljs` copia entonces la hoja
 *    completa a un archivo temporal del sistema (con documentos y teléfonos numéricos) hasta llegar a las cadenas, y
 *    si el proceso muere ese temporal puede quedar en disco;
 *  - `exceljs` retiene TODAS las cadenas compartidas, incluidos nombres, correos y funciones que la minimización
 *    nunca usa: ~840 MB de RSS solo en lectura.
 *
 * Este lector abre el zip con acceso aleatorio (sin temporales) y hace:
 *  1. la cabecera (primera fila) y solo las cadenas compartidas que necesita;
 *  2. UNA pasada por la hoja: descarta cada fila sin `#` antes de guardar nada (las 902.533 filas fantasma) y, de
 *     las reales, guarda solo las columnas permitidas, con las cadenas como índices;
 *  3. UNA pasada por `sharedStrings.xml` conservando únicamente los índices usados (los nombres, correos y teléfonos
 *     de las columnas excluidas nunca llegan a memoria);
 *  4. entrega las filas resueltas.
 * Fechas: estilos de `styles.xml` con formato de fecha (mismos criterios que `exceljs`), sistema 1900 o 1904.
 */

interface EntradaZip { nombre: string; metodo: number; tamanoComprimido: number; desplazamientoLocal: number }

async function directorioZip(ruta: string): Promise<Map<string, EntradaZip>> {
  const fh = await open(ruta, 'r');
  try {
    const { size } = await fh.stat();
    const cola = Math.min(size, 65_557);
    const buf = Buffer.alloc(cola);
    await fh.read(buf, 0, cola, size - cola);
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new ArchivoSgpInvalidoError('no es un archivo zip/xlsx');
    const total = buf.readUInt16LE(eocd + 10);
    const tamanoDir = buf.readUInt32LE(eocd + 12);
    const inicioDir = buf.readUInt32LE(eocd + 16);
    if (inicioDir === 0xffffffff || tamanoDir === 0xffffffff) throw new ArchivoSgpInvalidoError('zip64 no soportado por el lector en flujo');
    const dir = Buffer.alloc(tamanoDir);
    await fh.read(dir, 0, tamanoDir, inicioDir);
    const entradas = new Map<string, EntradaZip>();
    let p = 0;
    for (let i = 0; i < total; i += 1) {
      if (dir.readUInt32LE(p) !== 0x02014b50) throw new ArchivoSgpInvalidoError('directorio central del zip dañado');
      const metodo = dir.readUInt16LE(p + 10);
      const tamanoComprimido = dir.readUInt32LE(p + 20);
      const largoNombre = dir.readUInt16LE(p + 28);
      const largoExtra = dir.readUInt16LE(p + 30);
      const largoComentario = dir.readUInt16LE(p + 32);
      const desplazamientoLocal = dir.readUInt32LE(p + 42);
      const nombre = dir.toString('utf8', p + 46, p + 46 + largoNombre);
      entradas.set(nombre, { nombre, metodo, tamanoComprimido, desplazamientoLocal });
      p += 46 + largoNombre + largoExtra + largoComentario;
    }
    // El contenido empieza después de la cabecera local (su «extra» puede diferir del directorio central).
    for (const e of entradas.values()) {
      const cab = Buffer.alloc(30);
      await fh.read(cab, 0, 30, e.desplazamientoLocal);
      if (cab.readUInt32LE(0) !== 0x04034b50) throw new ArchivoSgpInvalidoError('cabecera local del zip dañada');
      e.desplazamientoLocal += 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
    }
    return entradas;
  } finally {
    await fh.close();
  }
}

function flujoEntrada(ruta: string, e: EntradaZip): Readable {
  const crudo = createReadStream(ruta, { start: e.desplazamientoLocal, end: e.desplazamientoLocal + e.tamanoComprimido - 1, highWaterMark: 1 << 20 });
  if (e.metodo === 0) return crudo;
  if (e.metodo !== 8) throw new ArchivoSgpInvalidoError(`método de compresión ${e.metodo} no soportado`);
  return crudo.pipe(createInflateRaw());
}

// ── Escáner XML mínimo (solo las etiquetas que usa SpreadsheetML) ───────────

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * Entidades XML. Los escapes OOXML `_xHHHH_` se dejan LITERALES, igual que `exceljs` (el lector de H2): así los dos
 * lectores producen exactamente las mismas filas (verificado sobre las 143.659 filas reales).
 */
export function decodificarXml(t: string): string {
  if (t.indexOf('&') < 0) return t;
  return t.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTIDADES[e]);
}

function atributo(etiqueta: string, nombre: string): string | null {
  const m = new RegExp(`\\s${nombre}="([^"]*)"`).exec(etiqueta);
  return m ? m[1] : null;
}

/** Recorre el XML entregando etiquetas y textos entre etiquetas, en flujo (sin cargar el documento). */
async function* recorrerXml(flujo: Readable): AsyncGenerator<{ etiqueta: string } | { texto: string }> {
  let resto = '';
  for await (const trozo of flujo) {
    let s = resto + (trozo as Buffer).toString('utf8');
    let i = 0;
    for (;;) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { resto = s.slice(i); break; }
      if (lt > i) yield { texto: s.slice(i, lt) };
      const gt = s.indexOf('>', lt);
      if (gt < 0) { resto = s.slice(lt); break; }
      yield { etiqueta: s.slice(lt, gt + 1) };
      i = gt + 1;
    }
    s = '';
  }
}

// ── Estilos: qué índices de estilo son fecha ────────────────────────────────

const FORMATOS_FECHA_INTEGRADOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function esFormatoFecha(codigo: string): boolean {
  const limpio = codigo.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(limpio) && !/^[#0.,%\s]*$/.test(limpio);
}

async function estilosDeFecha(ruta: string, e: EntradaZip | undefined): Promise<boolean[]> {
  if (!e) return [];
  const personalizados = new Map<number, string>();
  const xfs: boolean[] = [];
  let enCellXfs = false;
  for await (const n of recorrerXml(flujoEntrada(ruta, e))) {
    if (!('etiqueta' in n)) continue;
    const t = n.etiqueta;
    if (t.startsWith('<numFmt ')) personalizados.set(Number(atributo(t, 'numFmtId')), decodificarXml(atributo(t, 'formatCode') ?? ''));
    else if (t.startsWith('<cellXfs')) enCellXfs = !t.endsWith('/>');
    else if (t.startsWith('</cellXfs')) enCellXfs = false;
    else if (enCellXfs && t.startsWith('<xf ')) {
      const id = Number(atributo(t, 'numFmtId') ?? '0');
      xfs.push(FORMATOS_FECHA_INTEGRADOS.has(id) || (personalizados.has(id) && esFormatoFecha(personalizados.get(id)!)));
    }
  }
  return xfs;
}

// ── Celdas ─────────────────────────────────────────────────────────────────

/** Valor provisional de una celda: un índice de cadena compartida se resuelve al final. */
type Provisional = Celda | { cadena: number };

const columnaDe = (ref: string): number => {
  let n = 0;
  for (let k = 0; k < ref.length; k += 1) {
    const c = ref.charCodeAt(k);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
};

const MS_DIA = 86_400_000;
function fechaExcel(serial: number, sistema1904: boolean): Date {
  const base = sistema1904 ? 24107 : 25569; // días entre el origen de Excel y 1970-01-01
  return new Date(Math.round((serial - base) * MS_DIA));
}

/**
 * Recorre `sheet1.xml` y entrega cada fila como mapa columna → valor provisional. `soloColumnas` limita lo que se
 * guarda; `filtro` decide con la fila aún cruda (p. ej. «tiene `#`») antes de retenerla.
 */
async function* filasHoja(
  flujo: Readable, fechas: boolean[], sistema1904: boolean,
): AsyncGenerator<{ numero: number; celdas: Map<number, Provisional> }> {
  let fila: Map<number, Provisional> | null = null;
  let numero = 0;
  let col = 0;
  let tipo: string | null = null;
  let estilo = 0;
  let enV = false;
  let enT = false;
  let enIs = false;
  let texto = '';
  for await (const n of recorrerXml(flujo)) {
    if ('texto' in n) { if (enV || (enIs && enT)) texto += n.texto; continue; }
    const t = n.etiqueta;
    if (t.startsWith('<row')) {
      numero = Number(atributo(t, 'r') ?? numero + 1);
      fila = new Map();
      col = 0;
      if (t.endsWith('/>')) { yield { numero, celdas: fila }; fila = null; }
    } else if (t.startsWith('</row')) {
      if (fila) yield { numero, celdas: fila };
      fila = null;
    } else if (t.startsWith('<c ') || t === '<c>' || t.startsWith('<c>')) {
      const ref = atributo(t, 'r');
      col = ref ? columnaDe(ref) : col + 1;
      tipo = atributo(t, 't');
      estilo = Number(atributo(t, 's') ?? '0');
      texto = '';
      enIs = false;
      if (t.endsWith('/>')) tipo = null;
    } else if (t === '<v>' || t.startsWith('<v ')) { enV = true; texto = ''; }
    else if (t === '</v>') enV = false;
    else if (t === '<is>') enIs = true;
    else if (t.startsWith('<t') && (t[2] === '>' || t[2] === ' ')) enT = true;
    else if (t === '</t>') enT = false;
    else if (t === '</c>' && fila) {
      const v = texto;
      let valor: Provisional = null;
      if (tipo === 's') valor = v === '' ? null : { cadena: Number(v) };
      else if (tipo === 'inlineStr' || tipo === 'str') valor = decodificarXml(v);
      else if (tipo === 'b') valor = v === '1';
      else if (tipo === 'e') valor = null;
      else if (v !== '') {
        const num = Number(v);
        valor = Number.isFinite(num) ? (fechas[estilo] ? fechaExcel(num, sistema1904) : num) : decodificarXml(v);
      }
      if (valor !== null && valor !== '') fila.set(col, valor);
      texto = '';
    }
  }
}

/** Cadenas compartidas, conservando SOLO los índices pedidos (y deteniéndose en cuanto los tiene todos). */
async function cadenasCompartidas(ruta: string, e: EntradaZip | undefined, necesarias: Set<number>): Promise<Map<number, string>> {
  const salida = new Map<number, string>();
  if (!e || !necesarias.size) return salida;
  let maximo = -1;
  for (const n of necesarias) if (n > maximo) maximo = n;
  let indice = -1;
  let enT = false;
  let enRph = false;
  let texto = '';
  for await (const n of recorrerXml(flujoEntrada(ruta, e))) {
    if ('texto' in n) { if (enT && !enRph && necesarias.has(indice)) texto += n.texto; continue; }
    const t = n.etiqueta;
    if (t === '<si>' || t.startsWith('<si ')) { indice += 1; texto = ''; }
    else if (t === '</si>') {
      if (necesarias.has(indice)) salida.set(indice, decodificarXml(texto));
      if (indice >= maximo) break;
    } else if (t.startsWith('<rPh')) enRph = true;
    else if (t.startsWith('</rPh')) enRph = false;
    else if (t.startsWith('<t') && (t[2] === '>' || t[2] === ' ')) { enT = !t.endsWith('/>'); }
    else if (t === '</t>') enT = false;
  }
  return salida;
}

export class LectorXlsxFlujoSgp implements FuenteSgp {
  private stats: EstadisticasLectura = { filasFisicas: 0, filasReales: 0, filasDescartadas: 0, ultimaFilaConDatos: 0 };
  private meta: MetadatosArchivo | null = null;

  constructor(private readonly ruta: string) {}

  async metadatos(): Promise<MetadatosArchivo> {
    if (!this.meta) {
      const info = await stat(this.ruta).catch(() => null);
      if (!info?.isFile()) throw new ArchivoSgpInvalidoError('no existe o no es un archivo');
      this.meta = { nombre: basename(this.ruta), sha256: await sha256DeArchivo(this.ruta), tamanoBytes: info.size };
    }
    return this.meta;
  }

  estadisticas(): EstadisticasLectura {
    return { ...this.stats };
  }

  async *filasReales(alProgreso?: (e: EstadisticasLectura) => void): AsyncIterable<FilaFuente> {
    this.stats = { filasFisicas: 0, filasReales: 0, filasDescartadas: 0, ultimaFilaConDatos: 0 };
    const zip = await directorioZip(this.ruta);
    const hojaRuta = await this.primeraHoja(zip);
    const hoja = zip.get(hojaRuta);
    if (!hoja) throw new ArchivoSgpInvalidoError('el libro no tiene hojas');
    const libro = zip.get('xl/workbook.xml');
    let sistema1904 = false;
    if (libro) for await (const n of recorrerXml(flujoEntrada(this.ruta, libro))) if ('etiqueta' in n && n.etiqueta.startsWith('<workbookPr')) sistema1904 = /date1904="(1|true)"/.test(n.etiqueta);
    const fechas = await estilosDeFecha(this.ruta, zip.get('xl/styles.xml'));
    const compartidas = zip.get('xl/sharedStrings.xml');

    // 1. Cabecera: primera fila de la hoja y solo sus cadenas.
    let cabecera: Map<number, Provisional> | null = null;
    for await (const f of filasHoja(flujoEntrada(this.ruta, hoja), fechas, sistema1904)) { cabecera = f.celdas; break; }
    if (!cabecera) throw new ArchivoSgpInvalidoError('la hoja está vacía');
    const idxCab = new Set([...cabecera.values()].filter((v): v is { cadena: number } => typeof v === 'object' && v !== null && 'cadena' in v).map((v) => v.cadena));
    const textosCab = await cadenasCompartidas(this.ruta, compartidas, idxCab);
    const porNombre = new Map<string, number>();
    for (const [col, v] of cabecera) {
      const nombre = typeof v === 'object' && v !== null && 'cadena' in v ? textosCab.get(v.cadena) : typeof v === 'string' ? v : null;
      if (nombre?.trim()) porNombre.set(nombre.normalize('NFC').trim(), col);
    }
    const faltan = COLUMNAS_SGP.filter((c) => !porNombre.has(c));
    if (faltan.length) throw new ArchivoSgpInvalidoError(`faltan columnas de la exportación del SGP: ${faltan.join(', ')}`);
    const colId = porNombre.get('#')!;
    const leidas: [ColumnaSgp, number][] = COLUMNAS_LEIDAS.map((c) => [c, porNombre.get(c)!]);

    // 2. Una pasada por la hoja: filas reales con solo las columnas permitidas.
    const reales: { numero: number; valores: Provisional[] }[] = [];
    const necesarias = new Set<number>();
    let primera = true;
    for await (const f of filasHoja(flujoEntrada(this.ruta, hoja), fechas, sistema1904)) {
      if (primera) { primera = false; continue; }
      if (f.celdas.size === 0) continue;
      this.stats.filasFisicas += 1;
      this.stats.ultimaFilaConDatos = f.numero;
      if (this.stats.filasFisicas % 5000 === 0) alProgreso?.(this.estadisticas());
      // La ÚNICA condición de fila real es `#` no vacío; se evalúa antes de retener nada de la fila.
      const id = f.celdas.get(colId);
      const esIndice = typeof id === 'object' && id !== null && !(id instanceof Date);
      if (id === undefined || (!esIndice && idRegistroSgp(id) === null)) { this.stats.filasDescartadas += 1; continue; }
      const valores = leidas.map(([, col]) => {
        const v = f.celdas.get(col) ?? null;
        if (typeof v === 'object' && v !== null && 'cadena' in v) necesarias.add(v.cadena);
        return v;
      });
      reales.push({ numero: f.numero, valores });
    }

    // 3. Solo las cadenas usadas por las columnas permitidas.
    const textos = await cadenasCompartidas(this.ruta, compartidas, necesarias);
    necesarias.clear();

    // 4. Filas resueltas (un `#` que resulte vacío tras resolver la cadena también se descarta).
    for (let k = 0; k < reales.length; k += 1) {
      const { numero, valores } = reales[k];
      reales[k] = undefined as never;
      const celdas: FilaSgp = {};
      leidas.forEach(([c], j) => {
        const v = valores[j];
        celdas[c] = typeof v === 'object' && v !== null && 'cadena' in v ? (textos.get(v.cadena) ?? null) : v;
      });
      if (idRegistroSgp(celdas['#'] ?? null) === null) { this.stats.filasDescartadas += 1; continue; }
      this.stats.filasReales += 1;
      yield { filaOrigen: numero, celdas };
    }
    alProgreso?.(this.estadisticas());
  }

  /** Ruta de la primera hoja según `workbook.xml` y sus relaciones. */
  private async primeraHoja(zip: Map<string, EntradaZip>): Promise<string> {
    const libro = zip.get('xl/workbook.xml');
    const rels = zip.get('xl/_rels/workbook.xml.rels');
    if (!libro || !rels) return 'xl/worksheets/sheet1.xml';
    let rid: string | null = null;
    for await (const n of recorrerXml(flujoEntrada(this.ruta, libro))) {
      if ('etiqueta' in n && n.etiqueta.startsWith('<sheet ')) { rid = atributo(n.etiqueta, 'r:id'); break; }
    }
    for await (const n of recorrerXml(flujoEntrada(this.ruta, rels))) {
      if ('etiqueta' in n && n.etiqueta.startsWith('<Relationship ') && atributo(n.etiqueta, 'Id') === rid) {
        const destino = atributo(n.etiqueta, 'Target') ?? 'worksheets/sheet1.xml';
        return destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
      }
    }
    return 'xl/worksheets/sheet1.xml';
  }
}
