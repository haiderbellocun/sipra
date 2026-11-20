import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import ExcelJS from 'exceljs';
import { Celda } from '../../domain/historico/fechas-sgp.parser';
import { COLUMNAS_LEIDAS, COLUMNAS_SGP, ColumnaSgp, FilaFuente, FilaSgp, idRegistroSgp } from '../../domain/historico/registro-historico';
import { EstadisticasLectura, FuenteSgp, MetadatosArchivo } from '../../domain/ports/out/historico-repositorio.port';

export class ArchivoSgpInvalidoError extends Error {
  constructor(motivo: string) {
    super(`Archivo SGP no válido: ${motivo}`);
    this.name = 'ArchivoSgpInvalidoError';
  }
}

/** SHA-256 por flujo: nunca carga el archivo completo en memoria. */
export async function sha256DeArchivo(ruta: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolver, rechazar) => {
    createReadStream(ruta, { highWaterMark: 1 << 20 })
      .on('data', (b) => hash.update(b))
      .on('end', () => resolver())
      .on('error', rechazar);
  });
  return hash.digest('hex');
}

/** Valor de celda de exceljs → valor plano. Fórmulas: su resultado; errores de Excel: vacío. */
function plano(valor: unknown): Celda {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean' || valor instanceof Date) return valor;
  if (typeof valor === 'object') {
    const o = valor as { richText?: { text: string }[]; result?: unknown; text?: unknown; error?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if ('result' in o) return plano(o.result);
    if ('error' in o) return null;
    if (typeof o.text === 'string') return o.text;
  }
  return null;
}

const vacia = (c: Celda): boolean => c === null || (typeof c === 'string' && c.trim() === '');

/**
 * Lector en flujo del Excel del SGP (`exceljs`, ya dependencia del proyecto: no se agrega ninguna).
 *
 *  - Lee solo la primera hoja.
 *  - Exige la cabecera completa de 38 columnas con su nombre exacto (Unicode NFC).
 *  - Descarta ANTES de construir nada las filas sin `#` (las ~902.533 filas fantasma del relleno accidental de
 *    `Nombre Asignatura`): la única condición es `#` no vacío; no hay `dropna` genérico.
 *  - Solo extrae las columnas permitidas por la minimización: nombre, correo y teléfono del estudiante, nombre del
 *    docente, datos del jefe y funciones NUNCA salen de la hoja.
 */
export class LectorXlsxSgp implements FuenteSgp {
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
    try {
      yield* this.leer(alProgreso);
    } catch (e) {
      if (e instanceof ArchivoSgpInvalidoError) throw e;
      // Los errores de exceljs describen la estructura del libro (nunca valores de celdas).
      throw new ArchivoSgpInvalidoError(`el libro no se pudo leer en flujo (${(e as Error).message})`);
    }
  }

  private async *leer(alProgreso?: (e: EstadisticasLectura) => void): AsyncIterable<FilaFuente> {
    this.stats = { filasFisicas: 0, filasReales: 0, filasDescartadas: 0, ultimaFilaConDatos: 0 };
    const lector = new ExcelJS.stream.xlsx.WorkbookReader(this.ruta, {
      worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', entries: 'ignore',
    });
    let hojas = 0;
    for await (const hoja of lector) {
      hojas += 1;
      if (hojas > 1) {
        // Solo la primera hoja es la exportación; las demás se consumen sin leerse.
        const resto = hoja[Symbol.asyncIterator]();
        while (!(await resto.next()).done) { /* drenar */ }
        continue;
      }
      let indices: Map<ColumnaSgp, number> | null = null;
      let columnaId = 0;
      for await (const fila of hoja) {
        const valores = fila.values as unknown[];
        if (!indices) {
          indices = this.cabecera(valores);
          columnaId = indices.get('#')!;
          continue;
        }
        let conDatos = false;
        for (let i = 1; i < valores.length; i += 1) if (!vacia(plano(valores[i]))) { conDatos = true; break; }
        if (!conDatos) continue;
        this.stats.filasFisicas += 1;
        this.stats.ultimaFilaConDatos = fila.number;
        if (this.stats.filasFisicas % 5000 === 0) alProgreso?.(this.estadisticas());
        if (idRegistroSgp(plano(valores[columnaId])) === null) { this.stats.filasDescartadas += 1; continue; }
        this.stats.filasReales += 1;
        const celdas: FilaSgp = {};
        for (const col of COLUMNAS_LEIDAS) celdas[col] = plano(valores[indices.get(col)!]);
        yield { filaOrigen: fila.number, celdas };
      }
    }
    if (hojas === 0) throw new ArchivoSgpInvalidoError('el libro no tiene hojas');
    alProgreso?.(this.estadisticas());
  }

  private cabecera(valores: unknown[]): Map<ColumnaSgp, number> {
    const porNombre = new Map<string, number>();
    for (let i = 1; i < valores.length; i += 1) {
      const v = plano(valores[i]);
      if (typeof v === 'string' && v.trim()) porNombre.set(v.normalize('NFC').trim(), i);
    }
    const faltan = COLUMNAS_SGP.filter((c) => !porNombre.has(c));
    if (faltan.length) throw new ArchivoSgpInvalidoError(`faltan columnas de la exportación del SGP: ${faltan.join(', ')}`);
    return new Map(COLUMNAS_SGP.map((c) => [c, porNombre.get(c)!]));
  }
}
