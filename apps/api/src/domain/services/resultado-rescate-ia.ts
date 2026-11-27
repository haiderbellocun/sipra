import { Bandera, SeveridadBandera } from '../entities/documento.entity';
import type { CampoExtraido, ResultadoExtraccion, UsoLecturaIa } from '../ports/out/servicios-externos.port';
import type { DiscrepanciaFusion, FuenteFinal, ResultadoFusion } from './fusion-lecturas';

/**
 * Qué pasa con la lectura tras un intento de IA de rescate (subfase 1.5, dominio puro).
 *
 * Reúne las decisiones que el pipeline NO debe repartir en condicionales sueltos: cómo se clasifica el resultado,
 * qué ocurre con una lectura local `ilegible`, cómo se funde el gasto y qué metadata y banderas quedan. Nada aquí
 * contiene valores de campos (nombres, documentos, NIT): solo nombres de campo, códigos y conteos.
 */

export type ResultadoRescate = 'recuperado' | 'parcial' | 'sin_datos' | 'error' | 'timeout' | 'presupuesto';

/** Metadata mínima persistida en `extraccion.rescateIa`. Los valores viven en `campos`, no aquí. */
export interface MetadatosRescateIa {
  /** true solo cuando la compuerta del proveedor pasó y se delegó al adaptador (una llamada real). */
  invocado: boolean;
  resultado: ResultadoRescate;
  modelo: string | null;
  proveedor: string | null;
  duracionMs: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokensCache: number;
  tokensRazonamiento: number;
  costoUsd: number;
  camposSolicitados: string[];
  camposRecuperados: string[];
  camposCorroborados: string[];
  camposDescartados: { campo: string; motivo: string }[];
  discrepancias: DiscrepanciaFusion[];
  /** Procedencia de cada campo: la fuente de verdad mientras `CampoExtraido.fuente` no admita `ia_rescate`. */
  fuentesFinales: Record<string, FuenteFinal>;
  requiereRevisionHumana: boolean;
  /** Lo que identificaba a la lectura base antes de sumarle el gasto del rescate. */
  modeloBase: string | null;
  proveedorBase: string | null;
}

export type UsoRescate = Pick<
  UsoLecturaIa,
  'modelo' | 'proveedor' | 'tokensEntrada' | 'tokensSalida' | 'tokensCache' | 'tokensRazonamiento' | 'costoUsd' | 'duracionMs'
>;

export function clasificarResultadoRescate(
  camposSolicitados: number,
  fusion: Pick<ResultadoFusion, 'camposRescatados' | 'camposCorroborados'>,
): 'recuperado' | 'parcial' | 'sin_datos' {
  const recuperados = fusion.camposRescatados.length;
  if (camposSolicitados > 0 && recuperados === camposSolicitados) return 'recuperado';
  if (recuperados > 0 || fusion.camposCorroborados.length > 0) return 'parcial';
  return 'sin_datos';
}

export type DecisionLegibilidad = 'sin_cambio' | 'continuar_con_revision' | 'mantener_ilegible';

/**
 * Qué hacer con una lectura local `ilegible` después del rescate.
 *
 *  · la lectura local no era ilegible → `sin_cambio`;
 *  · era ilegible y la IA recuperó al menos un campo válido → `continuar_con_revision`: el documento sigue por las
 *    capas con datos precargados y lo decide una persona (no se le pide al estudiante otra captura por haber
 *    fallado la lectura local);
 *  · era ilegible y no se recuperó ningún dato útil (sin intento, fallo, sin datos o todo descartado) →
 *    `mantener_ilegible`: se conserva `marcarIlegible` y la solicitud de nueva captura.
 */
export function decidirLegibilidadTrasRescate(ilegibleLocal: boolean, camposRecuperados: number): DecisionLegibilidad {
  if (!ilegibleLocal) return 'sin_cambio';
  return camposRecuperados > 0 ? 'continuar_con_revision' : 'mantener_ilegible';
}

export interface EntradaRescate {
  camposSolicitados: readonly string[];
  resultado: ResultadoRescate;
  invocado: boolean;
  /** Lo facturado (también por una respuesta inservible); null si no hubo respuesta (p. ej. tiempo agotado). */
  uso: UsoRescate | null;
  /** Solo con respuesta válida. */
  fusion: ResultadoFusion | null;
}

export interface LecturaConRescate {
  lectura: ResultadoExtraccion;
  metadatos: MetadatosRescateIa;
  legibilidad: DecisionLegibilidad;
}

const redondearUsd = (valor: number): number => Math.round(valor * 1e6) / 1e6;

/**
 * Funde el rescate en la lectura base sin perder nada de ella: la lectura local (`lecturaLocal`, acta, RUT, Cámara),
 * el tipo detectado, los hallazgos, el resumen y el gasto previo se conservan. Solo se sustituyen los campos que
 * estaban vacíos (los que la fusión marcó como rescatados); a esos NO se les escribe `fuente` (no existe
 * `ia_rescate` en `CampoExtraido.fuente`): su procedencia queda en `rescateIa.fuentesFinales`.
 */
export function incorporarRescate(base: ResultadoExtraccion, entrada: EntradaRescate): LecturaConRescate {
  const { fusion, uso } = entrada;
  const recuperados = fusion?.camposRescatados ?? [];

  const campos: Record<string, CampoExtraido> = { ...base.campos };
  for (const nombre of recuperados) {
    const rescatado = fusion?.campos[nombre];
    if (rescatado) campos[nombre] = { valor: rescatado.valor, confianza: rescatado.confianza, evidencia: rescatado.evidencia };
  }

  const legibilidad = decidirLegibilidadTrasRescate(base.ilegible, recuperados.length);
  const facturado = entrada.invocado && uso !== null;
  const discrepancias = fusion?.discrepancias ?? [];

  const metadatos: MetadatosRescateIa = {
    invocado: entrada.invocado,
    resultado: entrada.resultado,
    modelo: uso?.modelo ?? null,
    proveedor: uso?.proveedor ?? null,
    duracionMs: uso?.duracionMs ?? 0,
    tokensEntrada: uso?.tokensEntrada ?? 0,
    tokensSalida: uso?.tokensSalida ?? 0,
    tokensCache: uso?.tokensCache ?? 0,
    tokensRazonamiento: uso?.tokensRazonamiento ?? 0,
    costoUsd: uso?.costoUsd ?? 0,
    camposSolicitados: [...entrada.camposSolicitados],
    camposRecuperados: [...recuperados],
    camposCorroborados: [...(fusion?.camposCorroborados ?? [])],
    camposDescartados: (fusion?.descartes ?? []).map((d) => ({ campo: d.campo, motivo: d.motivo })),
    discrepancias: discrepancias.map((d) => ({ ...d })),
    fuentesFinales: { ...(fusion?.fuentesFinales ?? {}) },
    requiereRevisionHumana: discrepancias.length > 0 || recuperados.length > 0,
    modeloBase: base.modelo ?? null,
    proveedorBase: base.proveedor ?? null,
  };

  const lectura: ResultadoExtraccion = {
    ...base,
    campos,
    ilegible: legibilidad === 'continuar_con_revision' ? false : base.ilegible,
    ...(legibilidad === 'continuar_con_revision' ? { motivoIlegible: null } : {}),
    // El gasto se SUMA (una lectura base con costo previo no lo pierde) y se cuenta una sola vez.
    costoUsd: redondearUsd(base.costoUsd + (uso?.costoUsd ?? 0)),
    tokensEntrada: base.tokensEntrada + (uso?.tokensEntrada ?? 0),
    tokensSalida: base.tokensSalida + (uso?.tokensSalida ?? 0),
    tokensCache: (base.tokensCache ?? 0) + (uso?.tokensCache ?? 0),
    tokensRazonamiento: (base.tokensRazonamiento ?? 0) + (uso?.tokensRazonamiento ?? 0),
    duracionMs: (base.duracionMs ?? 0) + (uso?.duracionMs ?? 0),
    // Con gasto real, los reportes por modelo atribuyen el costo a quien lo facturó; la lectura base queda en `modeloBase`.
    ...(facturado && uso ? { modelo: uso.modelo, proveedor: uso.proveedor ?? base.proveedor } : {}),
    rescateIa: metadatos,
  };
  return { lectura, metadatos, legibilidad };
}

const nombres = (campos: readonly string[]): string => campos.join(', ');

/** Banderas del rescate. Sin valores en `mensaje`: solo nombres de campo y conteos. */
export function banderasDeRescate(meta: MetadatosRescateIa): Bandera[] {
  const banderas: Bandera[] = [];
  const noDisponible = meta.resultado === 'presupuesto' || meta.resultado === 'error' || meta.resultado === 'timeout';
  if (noDisponible) {
    banderas.push({
      codigo: 'C2_RESCATE_IA_NO_DISPONIBLE',
      capa: 2,
      severidad: SeveridadBandera.ALTA,
      mensaje: `La IA de rescate no pudo completar la lectura de ${meta.camposSolicitados.length} campo(s) (${meta.resultado}); el documento requiere revisión humana`,
      mensajeUsuario: 'Su documento quedó en revisión.',
    });
  }
  if (meta.camposRecuperados.length > 0) {
    banderas.push({
      codigo: 'C2_RESCATE_IA_APLICADO',
      capa: 2,
      severidad: SeveridadBandera.INFORMATIVA,
      mensaje:
        `Se recuperaron con IA de rescate ${meta.camposRecuperados.length} campo(s): ${nombres(meta.camposRecuperados)}. ` +
        'Es lectura, no verificación: la decide una persona',
    });
  }
  if (meta.invocado && meta.resultado === 'parcial') {
    banderas.push({
      codigo: 'C2_RESCATE_IA_PARCIAL',
      capa: 2,
      severidad: SeveridadBandera.INFORMATIVA,
      mensaje: `El rescate con IA recuperó ${meta.camposRecuperados.length} de ${meta.camposSolicitados.length} campo(s) pedidos`,
    });
  }
  if (meta.invocado && meta.resultado === 'sin_datos') {
    banderas.push({
      codigo: 'C2_RESCATE_IA_SIN_DATOS',
      capa: 2,
      severidad: SeveridadBandera.INFORMATIVA,
      mensaje: `El rescate con IA no recuperó ningún dato de los ${meta.camposSolicitados.length} campo(s) pedidos`,
    });
  }
  if (meta.discrepancias.length > 0) {
    banderas.push({
      codigo: 'C2_DISCREPANCIA_IA_LOCAL',
      capa: 2,
      severidad: SeveridadBandera.ALTA,
      mensaje:
        `La IA de rescate difiere de la lectura local en ${meta.discrepancias.length} campo(s): ` +
        `${nombres(meta.discrepancias.map((d) => d.campo))}; se conservó la lectura local y requiere revisión humana`,
      mensajeUsuario: 'Su documento quedó en revisión del docente.',
    });
  }
  return banderas;
}

/**
 * ¿Esta lectura persistida es IA REAL a efectos del límite por práctica? Proveedor externo, o un rescate cuya
 * invocación quedó registrada. Una lectura local o determinística (`local`, `pdf417`, `simulado`) no cuenta.
 * Es la definición que espeja `contarLecturasIaRealesDesde` en SQL.
 */
export function esLecturaIaReal(extraccion: { proveedor?: unknown; rescateIa?: { invocado?: unknown } | null } | null | undefined): boolean {
  if (!extraccion) return false;
  if (extraccion.proveedor === 'openai' || extraccion.proveedor === 'anthropic') return true;
  return extraccion.rescateIa?.invocado === true;
}
