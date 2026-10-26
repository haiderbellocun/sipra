/**
 * Roles institucionales. El rol se resuelve SIEMPRE desde el token de sesión,
 * nunca desde un parámetro enviado por el cliente (principio rector de M1).
 *
 * Correspondencia con los actores del SGP (manual de coordinación, §3):
 *   Practicante → ESTUDIANTE · Docente facilitador → TUTOR ·
 *   Coordinador de prácticas y analista → COORDINADOR sin escuelas ·
 *   Auxiliar de Desarrollo Profesional → AUXILIAR · Administrador → ADMINISTRADOR.
 * EMPRESA y EXTENSION no existen en el SGP: son perfiles propios de SIPRA.
 */
export enum Rol {
  ESTUDIANTE = 'estudiante',
  TUTOR = 'tutor',
  COORDINADOR = 'coordinador',
  ADMINISTRADOR = 'administrador',
  EMPRESA = 'empresa',
  EXTENSION = 'extension',
  AUXILIAR = 'auxiliar',
}

/**
 * Tipo de permiso de un usuario administrativo (SGP, gestión de usuarios):
 * `consulta` solo visualiza; `escritura` visualiza, valida y registra.
 * Estudiantes y empresas siempre escriben: cargan sus propios documentos.
 */
export type Permiso = 'consulta' | 'escritura';

export const ROLES_INTERNOS: readonly Rol[] = [
  Rol.TUTOR,
  Rol.COORDINADOR,
  Rol.ADMINISTRADOR,
  Rol.EXTENSION,
  Rol.AUXILIAR,
];

/** Los que en el SGP se crean desde «Gestión de usuarios». */
export const ROLES_ADMINISTRATIVOS: readonly Rol[] = [
  Rol.ADMINISTRADOR,
  Rol.COORDINADOR,
  Rol.AUXILIAR,
  Rol.TUTOR,
  Rol.EXTENSION,
];

/** Alcance de visibilidad calculado en el servidor al abrir la sesión. */
export interface AlcanceVisibilidad {
  /** Ve únicamente sus propios expedientes. */
  readonly propio: boolean;
  /** Escuelas cuyos expedientes puede ver (vacío = ninguna restricción por escuela). */
  readonly escuelas: readonly string[];
  /** Empresa a la que pertenece, cuando el rol es EMPRESA. */
  readonly empresaId: string | null;
  /** Ve todos los expedientes de la institución. */
  readonly institucional: boolean;
}

export function alcancePorRol(
  rol: Rol,
  opciones: { escuelas?: readonly string[]; empresaId?: string | null } = {},
): AlcanceVisibilidad {
  const escuelas = opciones.escuelas ?? [];
  const empresaId = opciones.empresaId ?? null;

  switch (rol) {
    case Rol.ESTUDIANTE:
      return { propio: true, escuelas: [], empresaId: null, institucional: false };
    case Rol.EMPRESA:
      return { propio: false, escuelas: [], empresaId, institucional: false };
    case Rol.TUTOR:
      return { propio: false, escuelas, empresaId: null, institucional: false };
    case Rol.COORDINADOR:
      // Sin escuelas asignadas es la coordinación del Área de Prácticas, que en
      // el SGP consulta y valida toda la institución. Con escuelas, es la
      // coordinación de escuela y ve solo las suyas.
      return { propio: false, escuelas, empresaId: null, institucional: escuelas.length === 0 };
    case Rol.ADMINISTRADOR:
    case Rol.EXTENSION:
    case Rol.AUXILIAR:
      return { propio: false, escuelas: [], empresaId: null, institucional: true };
  }
}
