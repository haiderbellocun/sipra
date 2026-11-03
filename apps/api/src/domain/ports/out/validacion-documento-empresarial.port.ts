import {
  DatosEvidenciaDocumentoEmpresarial, DatosValidacionDocumentoEmpresarial, EvidenciaDocumentoEmpresarial,
  ValidacionDocumentoEmpresarial,
} from '../../entities/validacion-documento-empresarial.entity';

export interface DocumentoConHuella {
  documentoId: string;
  validacionId: string;
  version: number;
  hashDocumento: string;
}

export interface ValidacionDocumentoEmpresarialRepositoryPort {
  buscarPorId(id: string): Promise<ValidacionDocumentoEmpresarial | null>;
  /** Una validación por documento (por versión): una versión nueva tiene la suya. */
  buscarPorDocumento(documentoId: string): Promise<ValidacionDocumentoEmpresarial | null>;
  listarPorPractica(practicaId: string): Promise<ValidacionDocumentoEmpresarial[]>;
  /** `ON CONFLICT DO NOTHING` sobre `documento_id`: dos procesos simultáneos terminan con UNA fila. */
  crearSiNoExiste(datos: DatosValidacionDocumentoEmpresarial): Promise<{ validacion: ValidacionDocumentoEmpresarial; creada: boolean }>;
  /** Compare-and-set por versión. `false` = otro proceso la modificó antes. */
  guardarSiVersion(datos: DatosValidacionDocumentoEmpresarial, versionEsperada: number): Promise<boolean>;
  /** Solo inserta y es idempotente por (validación, intento, tipo): `false` = ya existía. */
  agregarEvidencia(datos: DatosEvidenciaDocumentoEmpresarial): Promise<boolean>;
  listarEvidencias(validacionId: string): Promise<EvidenciaDocumentoEmpresarial[]>;
  /**
   * Otros documentos de la MISMA práctica y el MISMO tipo documental con el mismo SHA-256 (duplicados). Se reportan;
   * no se borran ni se descartan.
   */
  buscarDuplicados(practicaId: string, tipoDocumento: string, hashDocumento: string, excluirDocumentoId: string): Promise<DocumentoConHuella[]>;
}
export const VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY = Symbol('VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY');
