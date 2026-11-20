import { createHmac, randomBytes } from 'node:crypto';

/**
 * Claves seudónimas determinísticas del histórico (§25.7 y §26).
 *
 *   clave = HMAC-SHA256(secreto, `<propósito>:<valor normalizado>`)
 *
 * El prefijo de propósito separa los dominios: el mismo número como estudiante, como docente o como organización da
 * tres claves sin relación entre sí. Es SEUDONIMIZACIÓN, no anonimización: una cédula tiene poca entropía y, si el
 * secreto se filtra, se puede revertir por fuerza bruta. Por eso el secreto vive fuera de la base y del repositorio
 * (Secret Manager) y cada registro guarda la VERSIÓN de clave con que se calculó, para poder rotarla después.
 */
export type PropositoClave = 'student' | 'teacher' | 'organization' | 'organization-alias';

export class ClaveHistoricoAusenteError extends Error {
  constructor(motivo: string) {
    super(`Clave HMAC del histórico no disponible: ${motivo}`);
    this.name = 'ClaveHistoricoAusenteError';
  }
}

const LONGITUD_MINIMA = 32;
const VERSION_VALIDA = /^v\d{1,4}$/;

export class SeudonimizadorHistorico {
  private constructor(
    private readonly secreto: Buffer,
    public readonly versionClave: string,
    /** Clave en memoria generada para un simulacro: sus resultados NO son comparables con la base. */
    public readonly efimera: boolean,
  ) {}

  /**
   * Fail-closed: sin secreto, con un marcador de plantilla o con un secreto corto, no hay seudonimizador. No existe
   * clave de respaldo ni de desarrollo.
   */
  static desdeSecreto(secreto: string | undefined, version: string | undefined): SeudonimizadorHistorico {
    const s = (secreto ?? '').trim();
    if (!s) throw new ClaveHistoricoAusenteError('HISTORICO_HMAC_KEY no está definida');
    if (/[<>]/.test(s) || /(cambiar|placeholder|secret-required|ejemplo)/i.test(s)) {
      throw new ClaveHistoricoAusenteError('HISTORICO_HMAC_KEY contiene un marcador de plantilla, no un secreto');
    }
    if (s.length < LONGITUD_MINIMA) throw new ClaveHistoricoAusenteError(`HISTORICO_HMAC_KEY debe tener al menos ${LONGITUD_MINIMA} caracteres`);
    const v = (version ?? '').trim();
    if (!VERSION_VALIDA.test(v)) throw new ClaveHistoricoAusenteError('HISTORICO_HMAC_KEY_VERSION debe tener la forma v1, v2…');
    return new SeudonimizadorHistorico(Buffer.from(s, 'utf8'), v, false);
  }

  /** Solo para simulacros (cero escrituras): claves válidas dentro de la corrida, inútiles fuera de ella. */
  static efimero(): SeudonimizadorHistorico {
    return new SeudonimizadorHistorico(randomBytes(32), 'efimera', true);
  }

  clave(proposito: PropositoClave, valorNormalizado: string | null): string | null {
    if (!valorNormalizado) return null;
    return createHmac('sha256', this.secreto).update(`${proposito}:${valorNormalizado}`, 'utf8').digest('hex');
  }
}
