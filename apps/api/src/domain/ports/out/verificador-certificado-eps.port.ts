import { DatosExtraidosEps, DatosVerificadosEps } from '../../entities/validacion-eps.entity';
import { VerificadorEpsDefinicion } from '../../services/registro-verificadores-eps';

/**
 * Verificación de un certificado de EPS contra un mecanismo OFICIAL registrado.
 * El dominio y la aplicación dependen de este puerto, no de ningún cliente HTTP.
 */

/** Por qué una verificación no concluyó, o por qué la fuente rechazó el certificado. */
export type CodigoErrorVerificacion =
  | 'sin_qr'
  | 'qr_no_soportado'
  | 'qr_ambiguo'
  | 'host_no_permitido'
  | 'requiere_interaccion_humana'
  | 'verificador_no_disponible'
  | 'timeout'
  | 'respuesta_invalida'
  | 'respuesta_demasiado_grande'
  | 'contenido_no_esperado'
  | 'redireccion_no_permitida'
  | 'documento_no_disponible'
  | 'certificado_no_encontrado'
  | 'certificado_invalido'
  | 'datos_inconsistentes';

export interface SolicitudVerificacionEps {
  /** URL COMPLETA del QR, solo en memoria: jamás se guarda ni se registra. */
  url: string;
  verificador: VerificadorEpsDefinicion;
  /** Lo que dice el certificado (para que el adaptador sepa qué contrastar). */
  datosCertificado: DatosExtraidosEps | null;
}

interface Base {
  verificador: string;
  verificadoEn: Date;
  /** Origen SIN parámetros ni credenciales. */
  origen: string;
  /** SHA-256 de la respuesta recibida (no se guarda el cuerpo). */
  hashRespuesta: string | null;
  httpStatus: number | null;
  bytes: number;
}

export type ResultadoVerificacionEps =
  /** La fuente confirma que el certificado existe y corresponde. */
  | (Base & { estado: 'verificado'; datosVerificados: DatosVerificadosEps })
  /** La fuente afirma, de forma explícita, que el certificado no existe o no es válido. */
  | (Base & { estado: 'rechazado'; errorCodigo: 'certificado_no_encontrado' | 'certificado_invalido' })
  /** No se pudo concluir: portal caído, tiempo, estructura no reconocida… NUNCA implica certificado falso. */
  | (Base & { estado: 'no_verificable'; errorCodigo: CodigoErrorVerificacion });

export interface VerificadorCertificadoEpsPort {
  verificar(solicitud: SolicitudVerificacionEps): Promise<ResultadoVerificacionEps>;
}
export const VERIFICADOR_CERTIFICADO_EPS = Symbol('VERIFICADOR_CERTIFICADO_EPS');

/** Lo que un adaptador específico entiende de la respuesta de SU verificador. */
export type InterpretacionRespuestaEps =
  | { tipo: 'verificado'; datos: Omit<DatosVerificadosEps, 'fuente' | 'verificadoEn'> }
  | { tipo: 'rechazado'; errorCodigo: 'certificado_no_encontrado' | 'certificado_invalido' }
  /** La estructura no es la que el adaptador conoce (el sitio cambió): falla cerrado. */
  | { tipo: 'estructura_no_reconocida' };

export interface AdaptadorRespuestaEps {
  /** Código del verificador al que pertenece. */
  readonly codigoVerificador: string;
  /**
   * Interpreta el cuerpo de la respuesta (ya acotado y con Content-Type
   * validado). Debe reconocer POSITIVAMENTE tanto el éxito como el rechazo;
   * todo lo demás es `estructura_no_reconocida`.
   */
  interpretar(cuerpo: string, solicitud: SolicitudVerificacionEps): InterpretacionRespuestaEps;
}
export const ADAPTADORES_RESPUESTA_EPS = Symbol('ADAPTADORES_RESPUESTA_EPS');
