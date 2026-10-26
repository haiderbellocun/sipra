import { DatosEvidenciaEps, EvidenciaEps } from '../../entities/evidencia-validacion-eps.entity';
import { DatosValidacionEps, ValidacionEps } from '../../entities/validacion-eps.entity';

export interface ValidacionEpsRepositoryPort {
  buscarPorId(id: string): Promise<ValidacionEps | null>;
  buscarPorDocumento(documentoId: string): Promise<ValidacionEps | null>;
  /**
   * Crea la validación del documento si aún no existe (`ON CONFLICT DO NOTHING`
   * sobre `documento_id`): dos procesos simultáneos terminan con UNA sola fila.
   */
  crearSiNoExiste(datos: DatosValidacionEps): Promise<{ validacion: ValidacionEps; creada: boolean }>;
  /**
   * Compare-and-set por versión: actualiza solo si la fila sigue en
   * `versionEsperada` y la incrementa. `false` = otro proceso la modificó antes.
   */
  guardarSiVersion(datos: DatosValidacionEps, versionEsperada: number): Promise<boolean>;
  /**
   * Reserva atómica: una sola sentencia condicional que tiene éxito si el caso
   * no está decidido y no tiene reserva vigente de otro. `false` = ya lo tiene otro.
   */
  reservar(id: string, actorId: string, ahora: Date, hasta: Date): Promise<boolean>;
  /** Libera la reserva propia (o cualquiera si es supervisor, o una vencida). */
  liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean): Promise<boolean>;
  /** Solo inserta: las evidencias son append-only. */
  agregarEvidencia(datos: DatosEvidenciaEps): Promise<EvidenciaEps>;
  listarEvidencias(validacionEpsId: string): Promise<EvidenciaEps[]>;
  /** ¿Ya existe evidencia ADRES con este hash (en cualquier validación)? Evita adjuntar el mismo archivo dos veces. */
  buscarEvidenciaAdresPorHash(hash: string): Promise<{ validacionEpsId: string } | null>;
  /** Casos con contraste ADRES abierto, los más antiguos primero. */
  listarParaAdres(limite: number): Promise<ValidacionEps[]>;
}
export const VALIDACION_EPS_REPOSITORY = Symbol('VALIDACION_EPS_REPOSITORY');
