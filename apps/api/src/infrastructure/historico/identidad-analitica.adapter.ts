import { SeudonimizadorHistorico } from '../../domain/historico/seudonimizacion-historico';
import { IdentidadAnaliticaPort } from '../../domain/ports/out/analitica-unificada.port';

/**
 * Identidad analítica del estudiante actual: HMAC del documento (mismo propósito `student` y misma normalización que el
 * histórico) calculado SOLO en memoria del backend analítico. Diseñado para varias versiones de clave (v1, v2…): cada
 * versión disponible es un seudonimizador; sin ninguna, la identidad entre fuentes no es comparable (ALL informa una
 * cota superior). No hay clave de respaldo.
 */
export class IdentidadAnaliticaHmac implements IdentidadAnaliticaPort {
  private readonly porVersion: ReadonlyMap<string, SeudonimizadorHistorico>;

  constructor(seudonimizadores: readonly SeudonimizadorHistorico[]) {
    this.porVersion = new Map(seudonimizadores.filter((s) => !s.efimera).map((s) => [s.versionClave, s]));
  }

  /** Desde el entorno: `HISTORICO_HMAC_KEY` + `HISTORICO_HMAC_KEY_VERSION`. Sin secreto, sin identidad (no falla). */
  static desdeEntorno(entorno: NodeJS.ProcessEnv): IdentidadAnaliticaHmac {
    if (!(entorno.HISTORICO_HMAC_KEY ?? '').trim()) return new IdentidadAnaliticaHmac([]);
    return new IdentidadAnaliticaHmac([SeudonimizadorHistorico.desdeSecreto(entorno.HISTORICO_HMAC_KEY, entorno.HISTORICO_HMAC_KEY_VERSION)]);
  }

  versiones(): readonly string[] {
    return [...this.porVersion.keys()];
  }

  claveEstudiante(version: string, documentoNormalizado: string | null): string | null {
    return this.porVersion.get(version)?.clave('student', documentoNormalizado) ?? null;
  }
}
