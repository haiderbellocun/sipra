import { createHash } from 'node:crypto';

/**
 * Hash y duplicados. El SHA-256 identifica el archivo; un duplicado es el mismo archivo, en la misma práctica y el
 * mismo tipo documental. NADA se borra ni se descarta: se detecta y se reporta.
 */

export function calcularSha256(contenido: Buffer | Uint8Array): string {
  return createHash('sha256').update(contenido).digest('hex');
}

export function esSha256(valor: unknown): valor is string {
  return typeof valor === 'string' && /^[0-9a-f]{64}$/.test(valor);
}

export interface HuellaDocumento {
  documentoId: string;
  practicaId: string;
  /** Tipo documental elegido al cargar (`rut_natural`, `camara_comercio`…). */
  tipo: string;
  hash: string;
  version?: number;
}

export interface ResultadoDuplicado {
  esDuplicado: boolean;
  /** Documentos ya existentes con el mismo archivo, práctica y tipo (el propio candidato no cuenta). */
  coincidencias: HuellaDocumento[];
}

export function detectarDuplicados(candidato: HuellaDocumento, existentes: readonly HuellaDocumento[]): ResultadoDuplicado {
  const coincidencias = existentes.filter(
    (e) => e.documentoId !== candidato.documentoId && e.practicaId === candidato.practicaId && e.tipo === candidato.tipo && e.hash === candidato.hash,
  );
  return { esDuplicado: coincidencias.length > 0, coincidencias };
}
