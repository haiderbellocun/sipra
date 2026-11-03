import { TipoDocumento } from './documento.entity';

/**
 * Documentos empresariales de la práctica (RUT y Cámara de Comercio). Bloque 1: solo dominio.
 *
 * Los documentos siguen perteneciendo a la PRÁCTICA (`documentos.practica_id`); esto no los traslada a la empresa.
 *
 * Ejes que NUNCA se mezclan en una sola bandera:
 *  · clasificación (qué es el documento, según su CONTENIDO) frente a expectativa (lo que el estudiante eligió);
 *  · estado registral, renovación, antigüedad del certificado y autenticidad (Cámara);
 *  · `empresas.estado` (habilitación interna de SIPRA) frente a `estadoRegistral` (el registro mercantil).
 */

export enum FamiliaDocumentoEmpresarial {
  RUT = 'rut',
  CAMARA = 'camara',
}

/** Clasificación canónica, obtenida del contenido. El tipo elegido por el estudiante es solo una expectativa. */
export enum ClasificacionDocumentoEmpresarial {
  RUT_PERSONA_NATURAL = 'rut_persona_natural',
  RUT_PERSONA_JURIDICA = 'rut_persona_juridica',
  /** Certificado de matrícula mercantil de un comerciante persona natural (no exige representante legal). */
  CAMARA_MATRICULA_PERSONA_NATURAL = 'camara_matricula_persona_natural',
  /** Certificado de matrícula mercantil de una sociedad (persona jurídica) que NO es el de existencia y representación. */
  CAMARA_MATRICULA_SOCIEDAD = 'camara_matricula_sociedad',
  CAMARA_EXISTENCIA_REPRESENTACION = 'camara_existencia_representacion',
  DOCUMENTO_INCORRECTO = 'documento_incorrecto',
  NO_DETERMINABLE = 'no_determinable',
}

export enum TipoPersona {
  NATURAL = 'natural',
  JURIDICA = 'juridica',
}

export const FAMILIA_POR_CLASIFICACION: Readonly<Record<ClasificacionDocumentoEmpresarial, FamiliaDocumentoEmpresarial | null>> = {
  [ClasificacionDocumentoEmpresarial.RUT_PERSONA_NATURAL]: FamiliaDocumentoEmpresarial.RUT,
  [ClasificacionDocumentoEmpresarial.RUT_PERSONA_JURIDICA]: FamiliaDocumentoEmpresarial.RUT,
  [ClasificacionDocumentoEmpresarial.CAMARA_MATRICULA_PERSONA_NATURAL]: FamiliaDocumentoEmpresarial.CAMARA,
  [ClasificacionDocumentoEmpresarial.CAMARA_MATRICULA_SOCIEDAD]: FamiliaDocumentoEmpresarial.CAMARA,
  [ClasificacionDocumentoEmpresarial.CAMARA_EXISTENCIA_REPRESENTACION]: FamiliaDocumentoEmpresarial.CAMARA,
  [ClasificacionDocumentoEmpresarial.DOCUMENTO_INCORRECTO]: null,
  [ClasificacionDocumentoEmpresarial.NO_DETERMINABLE]: null,
};

export const PERSONA_POR_CLASIFICACION: Readonly<Record<ClasificacionDocumentoEmpresarial, TipoPersona | null>> = {
  [ClasificacionDocumentoEmpresarial.RUT_PERSONA_NATURAL]: TipoPersona.NATURAL,
  [ClasificacionDocumentoEmpresarial.RUT_PERSONA_JURIDICA]: TipoPersona.JURIDICA,
  [ClasificacionDocumentoEmpresarial.CAMARA_MATRICULA_PERSONA_NATURAL]: TipoPersona.NATURAL,
  [ClasificacionDocumentoEmpresarial.CAMARA_MATRICULA_SOCIEDAD]: TipoPersona.JURIDICA,
  [ClasificacionDocumentoEmpresarial.CAMARA_EXISTENCIA_REPRESENTACION]: TipoPersona.JURIDICA,
  [ClasificacionDocumentoEmpresarial.DOCUMENTO_INCORRECTO]: null,
  [ClasificacionDocumentoEmpresarial.NO_DETERMINABLE]: null,
};

export function familiaDe(c: ClasificacionDocumentoEmpresarial): FamiliaDocumentoEmpresarial | null {
  return FAMILIA_POR_CLASIFICACION[c];
}
export function personaDe(c: ClasificacionDocumentoEmpresarial): TipoPersona | null {
  return PERSONA_POR_CLASIFICACION[c];
}

// ── Expectativa (lo que eligió el estudiante) ───────────────────────────────

export interface ExpectativaDocumento {
  familia: FamiliaDocumentoEmpresarial;
  /** `null` = el tipo documental elegido no determina la persona (Cámara). */
  persona: TipoPersona | null;
}

/** Tipos documentales de SIPRA que este dominio sabe interpretar; los demás no son documentos empresariales. */
export function expectativaDeTipoDocumento(tipo: TipoDocumento, personaEsperada: TipoPersona | null = null): ExpectativaDocumento | null {
  switch (tipo) {
    case TipoDocumento.RUT_NATURAL: return { familia: FamiliaDocumentoEmpresarial.RUT, persona: TipoPersona.NATURAL };
    case TipoDocumento.RUT_JURIDICO: return { familia: FamiliaDocumentoEmpresarial.RUT, persona: TipoPersona.JURIDICA };
    // `camara_comercio` no distingue persona: quien llama puede aportarla (p. ej. CUNbre Consolidado → jurídica).
    case TipoDocumento.CAMARA_COMERCIO: return { familia: FamiliaDocumentoEmpresarial.CAMARA, persona: personaEsperada };
    default: return null;
  }
}

// ── Estados ─────────────────────────────────────────────────────────────────

/** Estados de PROCESAMIENTO. La decisión humana llega en un bloque posterior. */
export enum EstadoValidacionDocumentoEmpresarial {
  PENDIENTE = 'pendiente',
  PROCESANDO = 'procesando',
  REVISION = 'revision',
  ERROR = 'error',
}

export enum EstadoRegistral {
  ACTIVO = 'activo',
  CANCELADO = 'cancelado',
  OTRO = 'otro',
  NO_DETERMINABLE = 'no_determinable',
}

export enum EstadoAutenticidad {
  VERIFICADA = 'verificada',
  NO_VERIFICABLE = 'no_verificable',
  INVALIDA = 'invalida',
  NO_DETERMINABLE = 'no_determinable',
}

/**
 * Autenticidad. Por defecto `no_verificable`. Que exista un QR, un código, una URL o una firma de PDF NO la eleva:
 * `firmaPdfPresente` no es `firmaPdfValida`. Solo una fuente oficial (consulta o validación criptográfica) podrá
 * declararla `verificada`, y entonces `fuente` dice cuál.
 */
export interface AutenticidadDocumento {
  estado: EstadoAutenticidad;
  /** Origen de una verificación real; `null` mientras no exista. Obligatoria para `verificada`. */
  fuente: string | null;
  qrPresente: boolean | null;
  qrDecodificado: boolean | null;
  /** El QR apunta a un dominio oficial (DIAN). Es una señal sintáctica: no prueba autenticidad. */
  qrDestinoOficial: boolean | null;
  firmaPdfPresente: boolean | null;
  /** Reservado: este bloque no valida firmas; siempre `null`. */
  firmaPdfValida: boolean | null;
  codigoVerificacionPresente: boolean | null;
  urlVerificacionPresente: boolean | null;
}

export function autenticidadPorDefecto(): AutenticidadDocumento {
  return {
    estado: EstadoAutenticidad.NO_VERIFICABLE, fuente: null, qrPresente: null, qrDecodificado: null, qrDestinoOficial: null,
    firmaPdfPresente: null, firmaPdfValida: null, codigoVerificacionPresente: null, urlVerificacionPresente: null,
  };
}

// ── Datos extraídos (modelo MINIMIZADO) ─────────────────────────────────────

export type MetodoLecturaEmpresarial = 'texto' | 'ocr' | 'hibrido';

/**
 * RUT. Se guarda lo necesario para comparar. NO se persisten dirección, correo, teléfono ni responsabilidades:
 * pueden leerse durante el procesamiento pero no salen de él.
 */
export interface DatosRutExtraidos {
  tipoPersona: TipoPersona;
  nit: string | null;
  dv: string | null;
  /** Fecha de generación del PDF (AAAA-MM-DD). DATO INFORMATIVO: no implica vencimiento. */
  fechaGeneracion: string | null;
  // Persona natural
  tipoDocumento?: string | null;
  numeroDocumento?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
  // Persona jurídica
  razonSocial?: string | null;
  // Opcionales (solo informativos: los catálogos de CIIU y DIVIPOLA están incompletos)
  ciiuPrincipal?: string | null;
  divipolaMunicipio?: string | null;
}

export type TipoCertificadoCamara = 'matricula_mercantil' | 'existencia_representacion';

export interface DatosCamaraExtraidos {
  tipoCertificado: TipoCertificadoCamara;
  tipoPersona: TipoPersona;
  nombreORazonSocial: string | null;
  nit: string | null;
  dv: string | null;
  matricula: string | null;
  camara: string | null;
  fechaMatricula: string | null;
  /** Dato del certificado. Por sí solo NO decide vigencia. */
  ultimoAnioRenovado: number | null;
  fechaRenovacion: string | null;
  /** Estado que el documento muestra de forma EXPLÍCITA; sin eso, `no_determinable`. */
  estadoRegistral: EstadoRegistral;
  domicilioMunicipio: string | null;
  ciiu: string | null;
  /** Solo aplica a persona jurídica. En una matrícula de persona natural se descarta. */
  representanteLegal: string | null;
  fechaExpedicion: string | null;
  codigoVerificacion: string | null;
  /** URL sanitizada (sin credenciales, parámetros ni fragmento). */
  urlVerificacion: string | null;
  /** Días de verificación en línea que el propio certificado declara (p. ej. 60). NO es vigencia registral. */
  diasVerificacionDocumento: number | null;
  firmaPdfPresente: boolean | null;
}

export type DatosExtraidosEmpresariales = DatosRutExtraidos | DatosCamaraExtraidos;

/** Claves que nunca se persisten (la base también las rechaza en el primer nivel). */
export const CLAVES_PROHIBIDAS_DOCUMENTO_EMPRESARIAL: readonly string[] = [
  'texto', 'texto_ocr', 'texto_nativo', 'textoOcr', 'textoNativo', 'ocr', 'imagen', 'imagenes',
  'direccion', 'direccion_completa', 'direccionCompleta', 'correo', 'correo_electronico', 'correoElectronico', 'email',
  'telefono', 'telefonos',
  'responsabilidades', 'token', 'password', 'secreto', 'cookie', 'authorization',
];
