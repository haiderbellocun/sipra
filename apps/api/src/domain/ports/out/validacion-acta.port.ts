import { DatosEvidenciaActa, DatosValidacionActa, EvidenciaActa, ValidacionActa } from '../../entities/validacion-acta.entity';

export interface ValidacionActaRepositoryPort {
  buscarPorId(id: string): Promise<ValidacionActa | null>;
  /** Una validación por documento, y un documento por versión del acta: una versión nueva tiene la suya. */
  buscarPorDocumento(documentoId: string): Promise<ValidacionActa | null>;
  listarPorPractica(practicaId: string): Promise<ValidacionActa[]>;
  /**
   * Crea la validación del documento si aún no existe (`ON CONFLICT DO NOTHING` sobre `documento_id`): dos procesos
   * simultáneos terminan con UNA sola fila.
   */
  crearSiNoExiste(datos: DatosValidacionActa): Promise<{ validacion: ValidacionActa; creada: boolean }>;
  /**
   * Compare-and-set por versión: actualiza solo si la fila sigue en `versionEsperada` y la incrementa. `false` =
   * otro proceso la modificó antes.
   */
  guardarSiVersion(datos: DatosValidacionActa, versionEsperada: number): Promise<boolean>;
  /**
   * Solo inserta (las evidencias son append-only) y es idempotente por (validación, intento, tipo): `false` = esa
   * evidencia ya existía y no se duplicó.
   */
  agregarEvidencia(datos: DatosEvidenciaActa): Promise<boolean>;
  listarEvidencias(validacionActaId: string): Promise<EvidenciaActa[]>;
}
export const VALIDACION_ACTA_REPOSITORY = Symbol('VALIDACION_ACTA_REPOSITORY');
