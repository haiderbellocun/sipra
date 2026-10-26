import {
  Consentimiento, DatosConsentimiento, DatosPolitica, PoliticaConsentimiento, TipoConsentimiento,
} from '../../entities/consentimiento.entity';

export interface PoliticaConsentimientoRepositoryPort {
  buscarPorId(id: string): Promise<PoliticaConsentimiento | null>;
  buscarPorTipoYVersion(tipo: TipoConsentimiento, version: number): Promise<PoliticaConsentimiento | null>;
  /** La política marcada activa del tipo (como máximo una). */
  buscarActiva(tipo: TipoConsentimiento): Promise<PoliticaConsentimiento | null>;
  /** Mayor versión publicada del tipo, o 0 si no hay ninguna. */
  ultimaVersion(tipo: TipoConsentimiento): Promise<number>;
  /**
   * Publica una versión nueva y, en la MISMA transacción, retira la activa del
   * tipo: nunca hay dos activas ni un instante sin política entre una y otra.
   */
  publicar(nueva: DatosPolitica): Promise<PoliticaConsentimiento>;
}
export const POLITICA_CONSENTIMIENTO_REPOSITORY = Symbol('POLITICA_CONSENTIMIENTO_REPOSITORY');

export interface ConsentimientoRepositoryPort {
  /** Solo inserta: el historial no se actualiza ni se borra. */
  agregar(datos: DatosConsentimiento): Promise<Consentimiento>;
  /** Último evento de la persona para el tipo y el alcance EXACTO (una práctica, o ninguna). */
  ultimo(usuarioId: string, tipo: TipoConsentimiento, practicaId: string | null): Promise<Consentimiento | null>;
  /** Último evento que aplica a la práctica: el específico de ella o el general. */
  ultimoAplicable(usuarioId: string, tipo: TipoConsentimiento, practicaId: string): Promise<Consentimiento | null>;
  /** Historial de la persona, del más reciente al más antiguo. */
  listarPorUsuario(usuarioId: string, limite: number): Promise<Consentimiento[]>;
}
export const CONSENTIMIENTO_REPOSITORY = Symbol('CONSENTIMIENTO_REPOSITORY');
