/**
 * Roles institucionales. El rol se resuelve SIEMPRE desde el token de sesión,
 * nunca desde un parámetro enviado por el cliente (principio rector de M1).
 *
 * Correspondencia con los actores del SGP (manual de coordinación, §3):
 *   Practicante → ESTUDIANTE · Docente facilitador → TUTOR ·
 *   Coordinador de prácticas → COORDINADOR · Analista de prácticas → ANALISTA ·
 *   Auxiliar de Desarrollo Profesional → AUXILIAR · Administrador → ADMINISTRADOR.
 * DIRECTOR es el perfil institucional de gobierno operativo (G1): no es un
 * administrador técnico. EMPRESA y EXTENSION son perfiles propios de SIPRA.
 *
 * Hasta G1 el analista se representaba como COORDINADOR sin escuelas; los usuarios
 * existentes con rol `coordinador` siguen siéndolo (no se infieren perfiles nuevos).
 */
export enum Rol {
  ESTUDIANTE = 'estudiante',
  TUTOR = 'tutor',
  COORDINADOR = 'coordinador',
  ADMINISTRADOR = 'administrador',
  EMPRESA = 'empresa',
  EXTENSION = 'extension',
  AUXILIAR = 'auxiliar',
  DIRECTOR = 'director',
  ANALISTA = 'analista',
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
  Rol.ANALISTA,
  Rol.DIRECTOR,
  Rol.ADMINISTRADOR,
  Rol.EXTENSION,
  Rol.AUXILIAR,
];

/** Los que en el SGP se crean desde «Gestión de usuarios». */
export const ROLES_ADMINISTRATIVOS: readonly Rol[] = [
  Rol.ADMINISTRADOR,
  Rol.DIRECTOR,
  Rol.COORDINADOR,
  Rol.ANALISTA,
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
    case Rol.ANALISTA:
      // Sin escuelas asignadas es el Área de Prácticas, que en el SGP consulta y
      // valida toda la institución. Con escuelas, ve solo las suyas.
      return { propio: false, escuelas, empresaId: null, institucional: escuelas.length === 0 };
    case Rol.DIRECTOR:
    case Rol.ADMINISTRADOR:
    case Rol.EXTENSION:
    case Rol.AUXILIAR:
      return { propio: false, escuelas: [], empresaId: null, institucional: true };
  }
}

// ── Capacidades (G1, corregido en 0.39.1) ───────────────────────────────────
//
// Matriz explícita y pequeña. Dos funciones separadas:
//   · GOBIERNO: administrador y director (periodos, usuarios, supervisión institucional).
//   · OPERACIÓN DE PRÁCTICAS: coordinador y analista.
// El director NO es «un coordinador con más permisos»: ve la institución, pero no hereda
// las escrituras operativas. `@Roles(...)` significa exactamente los roles declarados;
// no hay expansión implícita de grupos.

/** Perfiles que operan las prácticas (antes de G1, el analista era un coordinador sin escuelas). */
export const ROLES_OPERACION_PRACTICAS: readonly Rol[] = [Rol.COORDINADOR, Rol.ANALISTA];

/** Coordinador o analista. NO incluye al director. */
export function esCoordinacionOperativa(sujeto: Rol | { readonly rol: Rol }): boolean {
  return ROLES_OPERACION_PRACTICAS.includes(typeof sujeto === 'string' ? sujeto : sujeto.rol);
}

interface ActorConAlcance { readonly rol: Rol; readonly escuelas: readonly string[] }

/**
 * Escuelas a las que queda restringida la coordinación operativa, o `null` si su alcance es
 * institucional o no aplica. Coordinador y analista: según `escuelas` (vacío = Área de
 * Prácticas, institucional; un solo mecanismo para ambos). Para el director y el resto de
 * roles devuelve `null`.
 */
export function escuelasDeCoordinacion(actor: ActorConAlcance): string[] | null {
  if (esCoordinacionOperativa(actor) && actor.escuelas.length > 0) return [...actor.escuelas];
  return null;
}

/** Coordinación operativa del Área de Prácticas: coordinador o analista SIN escuelas. No incluye al director. */
export function esCoordinacionInstitucional(actor: ActorConAlcance): boolean {
  return esCoordinacionOperativa(actor) && actor.escuelas.length === 0;
}

/** Lectura y supervisión de toda la institución por función de gobierno: administrador y director. */
export function puedeSupervisarInstitucionalmente(actor: { readonly rol: Rol }): boolean {
  return actor.rol === Rol.ADMINISTRADOR || actor.rol === Rol.DIRECTOR;
}

/** Crear periodos y habilitarlos/deshabilitarlos: administrador y director. */
export function puedeGestionarPeriodos(actor: { readonly rol: Rol }): boolean {
  return actor.rol === Rol.ADMINISTRADOR || actor.rol === Rol.DIRECTOR;
}

/** Gestión de usuarios administrativos: administrador y director. */
export function puedeGestionarUsuarios(actor: { readonly rol: Rol }): boolean {
  return actor.rol === Rol.ADMINISTRADOR || actor.rol === Rol.DIRECTOR;
}

/** Perfiles operativos que el director gestiona. */
const ROLES_OPERATIVOS_GESTIONABLES: readonly Rol[] = [Rol.COORDINADOR, Rol.ANALISTA, Rol.AUXILIAR, Rol.TUTOR, Rol.EXTENSION];

/**
 * Roles que `actor` puede crear, modificar o inhabilitar. Solo el administrador gobierna
 * administradores y directores; el director gestiona los perfiles operativos.
 */
export function rolesGestionablesPor(actor: { readonly rol: Rol }): readonly Rol[] {
  if (actor.rol === Rol.ADMINISTRADOR) return ROLES_ADMINISTRATIVOS;
  if (actor.rol === Rol.DIRECTOR) return ROLES_OPERATIVOS_GESTIONABLES;
  return [];
}

/**
 * Cambio de modalidad y modificación de la información de la práctica (preparada para G5;
 * todavía no la consume ninguna ruta): EXCLUSIVAMENTE coordinador y analista. Ni
 * administrador, ni director, ni docente, ni auxiliar, ni estudiante.
 */
export function puedeModificarPractica(actor: { readonly rol: Rol }): boolean {
  return esCoordinacionOperativa(actor);
}
