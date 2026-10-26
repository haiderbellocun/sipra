import { TipoDocumento } from '../entities/documento.entity';
import { Rol } from './rol.vo';

/**
 * Quién puede tocar los documentos de una práctica, por función. Es un
 * criterio ADICIONAL a la visibilidad de la práctica (`visiblePara`): ver el
 * expediente no basta para ver sus documentos, que contienen datos personales
 * (cédula, afiliación a salud, RUT).
 *
 *  · Estudiante, docente, coordinación y administración: todos los documentos
 *    de las prácticas dentro de su alcance.
 *  · Auxiliar de prácticas: solo los que necesita para validar y gestionar la
 *    afiliación a ARL (`TIPOS_DEL_AUXILIAR`); nunca el expediente completo.
 *  · Empresa y extensión: ninguno por defecto.
 */
const ROLES_CON_ACCESO_COMPLETO: readonly Rol[] = [
  Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR,
];

/** Documentos que respaldan la solicitud y la gestión de ARL. */
export const TIPOS_DEL_AUXILIAR: readonly TipoDocumento[] = [
  TipoDocumento.CERTIFICADO_EPS,
  TipoDocumento.CEDULA,
  TipoDocumento.ACTA_INICIO,
  TipoDocumento.RUT_NATURAL,
  TipoDocumento.RUT_JURIDICO,
  TipoDocumento.CAMARA_COMERCIO,
  TipoDocumento.CERTIFICADO_ARL,
];

/** Roles que cargan documentos (DT §5). Empresa, extensión y auxiliar no. */
const ROLES_QUE_CARGAN: readonly Rol[] = ROLES_CON_ACCESO_COMPLETO;

/** ¿El rol puede consultar documentos en alguna medida? */
export function puedeConsultarDocumentos(rol: Rol): boolean {
  return ROLES_CON_ACCESO_COMPLETO.includes(rol) || rol === Rol.AUXILIAR;
}

/** ¿El rol puede consultar un documento de este tipo? */
export function puedeVerDocumento(rol: Rol, tipo: TipoDocumento): boolean {
  if (ROLES_CON_ACCESO_COMPLETO.includes(rol)) return true;
  if (rol === Rol.AUXILIAR) return TIPOS_DEL_AUXILIAR.includes(tipo);
  return false;
}

export function puedeCargarDocumentos(rol: Rol): boolean {
  return ROLES_QUE_CARGAN.includes(rol);
}
