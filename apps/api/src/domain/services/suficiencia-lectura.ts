import { camposDe } from '../entities/campos-extraccion';
import { TipoDocumento } from '../entities/documento.entity';
import { CampoExtraido, ResultadoExtraccion } from '../ports/out/servicios-externos.port';

/**
 * Suficiencia de una lectura (IA de rescate · subfase 1.1, dominio puro).
 *
 * Responde, para un tipo documental y una lectura ya hecha, qué campos del
 * esquema (`camposDe(tipo)`) no quedaron leídos con certeza y por qué. Es la
 * entrada de la política de rescate (`politica-rescate-ia.ts`); no decide nada
 * sobre el documento, no aprueba ni devuelve, y no conoce proveedores.
 *
 * «Suficiente» significa solo «no hace falta pedir más datos»: NO equivale a
 * apto para autoaprobación. Esa decisión sigue en el pipeline y en
 * `permiteAutoAprobacionDelPipeline`.
 */

/**
 * Confianza mínima de un campo para considerarlo leído.
 *
 * ORIGEN: es el mismo criterio que hoy usa el pipeline en `banderasPorConfianza`
 * (`application/use-cases/documentos/pipeline-validacion.use-case.ts`, `valor.confianza < 0.7`
 * → `C2_CONFIANZA_BAJA`). Allí sigue escrito en línea; cuando el rescate se integre al
 * pipeline (subfase 1.5) el pipeline debe importar ESTA constante para que haya un solo valor.
 * No es un umbral nuevo ni calibrado para el rescate.
 */
export const CONFIANZA_MINIMA_CAMPO = 0.7;

export type MotivoFaltante = 'nulo' | 'confianza_baja' | 'ocr_debil';

export interface CampoFaltante {
  campo: string;
  motivo: MotivoFaltante;
}

/**
 * `no_aplica`: el tipo no tiene campos de extracción (informes, entregables…). El mecanismo
 * de rescate no se usa y la lectura NO se interpreta como suficiente: esos tipos los decide
 * siempre una persona (`C2_REVISION_HUMANA_OBLIGATORIA`).
 */
export type EstadoSuficiencia = 'suficiente' | 'insuficiente' | 'no_aplica';

export interface SuficienciaLectura {
  estado: EstadoSuficiencia;
  /** true solo con `estado === 'suficiente'`; `no_aplica` es false a propósito. */
  suficiente: boolean;
  /** Cada campo del esquema aparece a lo sumo una vez, en el orden de `camposDe(tipo)`. */
  faltantes: CampoFaltante[];
}

/**
 * Señal OCR existente de la lectura local (`ResumenLecturaLocal.ocr.suficiencia`, calculada por
 * el lector según cuántos campos clave salieron del OCR). `debil` e `insuficiente` degradan
 * los campos cuya fuente es OCR, aunque cada uno declare confianza suficiente.
 */
function ocrDebil(lectura: ResultadoExtraccion): boolean {
  const ocr = lectura.lecturaLocal?.ocr;
  if (!ocr?.ejecutado) return false;
  return ocr.suficiencia === 'debil' || ocr.suficiencia === 'insuficiente';
}

function motivoDe(campo: CampoExtraido | undefined, ocrEsDebil: boolean): MotivoFaltante | null {
  if (!campo || campo.valor === null || campo.valor.trim() === '') return 'nulo';
  // Un dato leído del QR no se degrada por confianza: la confianza que declare la lectura
  // no aplica a un valor decodificado de forma determinística.
  if (campo.fuente === 'qr') return null;
  if (!Number.isFinite(campo.confianza) || campo.confianza < CONFIANZA_MINIMA_CAMPO) return 'confianza_baja';
  if (campo.fuente === 'ocr' && ocrEsDebil) return 'ocr_debil';
  return null;
}

/**
 * Evalúa la suficiencia de `lectura` para `tipo`. Una lectura `null` (no hubo lectura) deja
 * todos los campos del esquema como `nulo`. Los campos que la lectura traiga fuera del esquema
 * se ignoran: el rescate solo pide campos declarados.
 */
export function evaluarSuficienciaLectura(
  tipo: TipoDocumento,
  lectura: ResultadoExtraccion | null,
): SuficienciaLectura {
  const esquema = [...new Set(camposDe(tipo))];
  if (esquema.length === 0) return { estado: 'no_aplica', suficiente: false, faltantes: [] };

  const ocrEsDebil = lectura ? ocrDebil(lectura) : false;
  const faltantes: CampoFaltante[] = [];
  for (const campo of esquema) {
    const motivo = motivoDe(lectura?.campos[campo], ocrEsDebil);
    if (motivo) faltantes.push({ campo, motivo });
  }
  return faltantes.length === 0
    ? { estado: 'suficiente', suficiente: true, faltantes: [] }
    : { estado: 'insuficiente', suficiente: false, faltantes };
}
