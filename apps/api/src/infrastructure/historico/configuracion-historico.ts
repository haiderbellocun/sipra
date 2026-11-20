import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EquivalenciasProgramas, validarEquivalenciasProgramas } from '../../domain/historico/programas-sgp';
import { FronterasPeriodo, POLITICAS_SOLAPAMIENTO, POLITICA_RECOMENDADA, PoliticaSolapamiento } from '../../domain/historico/solapamiento-historico';
import { parsearPeriodoSgp } from '../../domain/historico/periodo-sgp.parser';
import { SeudonimizadorHistorico } from '../../domain/historico/seudonimizacion-historico';

/**
 * Configuración del importador del histórico (CLI, fuera de la API HTTP).
 *
 *   HISTORICO_HMAC_KEY          secreto HMAC (Secret Manager). Sin valor por defecto, sin clave de desarrollo.
 *   HISTORICO_HMAC_KEY_VERSION  versión de la clave (v1, v2…), guardada en cada registro para rotarla después.
 *   HISTORICO_IMPORT_APPLY      compuerta de entorno: solo `true` habilita escribir (junto con `--apply`).
 *
 * APPLY sin clave real: fail-closed. Un simulacro sin clave usa una clave efímera en memoria (sus claves no son
 * comparables con la base y así se informa).
 */
export interface ConfiguracionHistorico {
  seudonimizador: SeudonimizadorHistorico;
  compuertaApply: boolean;
}

export function compuertaApplyHabilitada(entorno: NodeJS.ProcessEnv): boolean {
  return (entorno.HISTORICO_IMPORT_APPLY ?? '').trim().toLowerCase() === 'true';
}

export function configuracionHistorico(entorno: NodeJS.ProcessEnv, modo: 'dry-run' | 'apply'): ConfiguracionHistorico {
  const compuertaApply = compuertaApplyHabilitada(entorno);
  const hayClave = (entorno.HISTORICO_HMAC_KEY ?? '').trim() !== '';
  if (modo === 'apply' || hayClave) {
    // Con clave declarada (o en APPLY) se valida siempre: un marcador de plantilla o una clave corta no pasan.
    return { seudonimizador: SeudonimizadorHistorico.desdeSecreto(entorno.HISTORICO_HMAC_KEY, entorno.HISTORICO_HMAC_KEY_VERSION), compuertaApply };
  }
  return { seudonimizador: SeudonimizadorHistorico.efimero(), compuertaApply };
}

// ── Configuración versionable sin datos personales (H3) ─────────────────────


/** Carpeta de configuración del histórico dentro del paquete de la API. */
export const CARPETA_CONFIG_HISTORICO = join(__dirname, '..', '..', '..', 'config', 'historico');

export function cargarEquivalenciasProgramas(ruta = join(CARPETA_CONFIG_HISTORICO, 'programas-sgp.json')): EquivalenciasProgramas {
  return validarEquivalenciasProgramas(JSON.parse(readFileSync(ruta, 'utf8')));
}

export class ConfiguracionSolapamientoError extends Error {
  constructor(motivo: string) {
    super(`Configuración de solapamiento no válida: ${motivo}`);
    this.name = 'ConfiguracionSolapamientoError';
  }
}

/** `HISTORICO_OVERLAP_POLICY` (si existe) manda sobre el archivo; la recomendada es COMBINED. */
export function configuracionSolapamiento(
  entorno: NodeJS.ProcessEnv, ruta = join(CARPETA_CONFIG_HISTORICO, 'solapamiento.json'),
): { politica: PoliticaSolapamiento; fronteras: FronterasPeriodo } {
  const archivo = JSON.parse(readFileSync(ruta, 'utf8')) as { politica?: string; fronteras?: Record<string, string | null> };
  const politica = (entorno.HISTORICO_OVERLAP_POLICY?.trim() || archivo.politica || POLITICA_RECOMENDADA) as PoliticaSolapamiento;
  if (!POLITICAS_SOLAPAMIENTO.includes(politica)) throw new ConfiguracionSolapamientoError(`HISTORICO_OVERLAP_POLICY debe ser ${POLITICAS_SOLAPAMIENTO.join(', ')}`);
  const fronteras: FronterasPeriodo = {};
  for (const cal of ['presencial', 'virtual', '335'] as const) {
    const f = archivo.fronteras?.[cal] ?? null;
    if (f !== null) {
      const p = parsearPeriodoSgp(f);
      if (p.formato !== cal) throw new ConfiguracionSolapamientoError(`la frontera «${f}» no pertenece al calendario ${cal}`);
    }
    fronteras[cal] = f;
  }
  return { politica, fronteras };
}
