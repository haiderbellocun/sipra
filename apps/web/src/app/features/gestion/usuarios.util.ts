import { Permiso, Rol, UsuarioAdministrativo } from '@core/models/modelos';

/**
 * G4 · Gestión de usuarios (presentación). Consume las reglas de G1; no las redefine: el backend sigue siendo
 * quien autoriza (`rolesGestionablesPor`, 403). Aquí solo se decide qué ofrecer para no mostrar acciones que
 * terminarían en 403. Estudiantes (SINU) y empresas NO se gestionan en este módulo.
 */

export interface EscuelaCatalogo { codigo: string; nombre: string }

/** Perfiles administrativos, en el orden en que se ofrecen. */
export const PERFILES_ADMINISTRATIVOS: readonly Rol[] = ['administrador', 'director', 'coordinador', 'analista', 'auxiliar', 'tutor', 'extension'];

export const ETIQUETA_PERFIL: Readonly<Record<string, string>> = {
  administrador: 'Administrador',
  director: 'Director',
  coordinador: 'Coordinador de prácticas',
  analista: 'Analista de prácticas',
  auxiliar: 'Auxiliar',
  tutor: 'Docente facilitador',
  extension: 'Extensión',
};

const OPERATIVOS: readonly Rol[] = ['coordinador', 'analista', 'auxiliar', 'tutor', 'extension'];

/** Espejo de `rolesGestionablesPor` (G1): administrador, todos; director, solo operativos; nadie más. */
export function perfilesGestionables(actor: Rol | null | undefined): readonly Rol[] {
  if (actor === 'administrador') return PERFILES_ADMINISTRATIVOS;
  if (actor === 'director') return OPERATIVOS;
  return [];
}

export function puedeGestionar(actor: Rol | null | undefined, usuario: Pick<UsuarioAdministrativo, 'rol'>): boolean {
  return perfilesGestionables(actor).includes(usuario.rol);
}

/** Perfiles que el actor puede VER en el filtro (el listado incluye a todos los administrativos). */
export function perfilesVisibles(actor: Rol | null | undefined): readonly Rol[] {
  return actor === 'administrador' || actor === 'director' ? PERFILES_ADMINISTRATIVOS : [];
}

/**
 * Cómo se define el alcance de cada perfil (semántica actual del dominio, sin cambios):
 *  · `institucional`: administrador, director, auxiliar y extensión (siempre institucional; no llevan escuelas).
 *  · `coordinacion`: coordinador y analista; sin escuelas = Área de Prácticas (institucional), o escuelas específicas.
 *  · `docente`: el docente facilitador ve sus estudiantes asignados y, si se le asignan, las escuelas completas.
 */
export type ModoAlcance = 'institucional' | 'coordinacion' | 'docente';

export function modoAlcance(rol: Rol): ModoAlcance {
  if (rol === 'coordinador' || rol === 'analista') return 'coordinacion';
  if (rol === 'tutor') return 'docente';
  return 'institucional';
}

/** «Escuela de Ingenierías» → «Ingenierías» (es el nombre del catálogo, sin el prefijo). */
export function nombreCortoEscuela(codigo: string, catalogo: readonly EscuelaCatalogo[]): string {
  const e = catalogo.find((x) => x.codigo === codigo);
  return e ? e.nombre.replace(/^Escuela de\s+/i, '') : codigo;
}

/** Texto compacto del alcance para la tabla; el detalle completo va en el inspector. */
export function textoAlcance(u: Pick<UsuarioAdministrativo, 'rol' | 'escuelas'>, catalogo: readonly EscuelaCatalogo[]): string {
  const modo = modoAlcance(u.rol);
  if (modo === 'institucional') return 'Institucional';
  if (u.escuelas.length === 0) return modo === 'docente' ? 'Sus estudiantes asignados' : 'Institucional';
  const base = u.escuelas.length === 1 ? nombreCortoEscuela(u.escuelas[0], catalogo) : `${u.escuelas.length} escuelas`;
  return modo === 'docente' ? `Asignados + ${base}` : base;
}

export function detalleEscuelas(escuelas: readonly string[], catalogo: readonly EscuelaCatalogo[]): string {
  return escuelas.map((c) => catalogo.find((x) => x.codigo === c)?.nombre ?? c).join(' · ');
}

// ── Filtros (en el cliente: el listado administrativo es corto y así no se recarga en cada cambio) ──

export interface FiltrosUsuarios { texto: string; perfil: string; estado: '' | 'activo' | 'inactivo'; escuela: string }
export const FILTROS_VACIOS: FiltrosUsuarios = { texto: '', perfil: '', estado: '', escuela: '' };

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function filtrarUsuarios(lista: readonly UsuarioAdministrativo[], f: FiltrosUsuarios): UsuarioAdministrativo[] {
  const q = normalizar(f.texto);
  return lista.filter((u) =>
    (!q || [u.nombre, u.correo, u.documento ?? ''].some((v) => normalizar(v).includes(q)))
    && (!f.perfil || u.rol === f.perfil)
    && (!f.estado || (f.estado === 'activo') === u.activo)
    && (!f.escuela || u.escuelas.includes(f.escuela)));
}

export function hayFiltros(f: FiltrosUsuarios): boolean {
  return !!(f.texto.trim() || f.perfil || f.estado || f.escuela);
}

/** Cifras de la franja: sobre TODOS los usuarios cargados, no sobre el filtro. */
export function metricasUsuarios(lista: readonly UsuarioAdministrativo[]) {
  const activos = lista.filter((u) => u.activo);
  return {
    activos: activos.length,
    docentes: activos.filter((u) => u.rol === 'tutor').length,
    analistas: activos.filter((u) => u.rol === 'analista').length,
    inhabilitados: lista.length - activos.length,
  };
}

// ── Formulario ──────────────────────────────────────────────────────────────

export interface FormularioUsuario {
  nombre: string;
  correo: string;
  documento: string;
  rol: Rol | '';
  permiso: Permiso;
  /** Coordinación: «institucional» (sin escuelas) o «especificas». Docente: «asignados» o «especificas». */
  alcance: 'institucional' | 'asignados' | 'especificas';
  escuelas: string[];
  activo: boolean;
}

export function formularioVacio(): FormularioUsuario {
  return { nombre: '', correo: '', documento: '', rol: '', permiso: 'escritura', alcance: 'institucional', escuelas: [], activo: true };
}

export function formularioDesde(u: UsuarioAdministrativo): FormularioUsuario {
  const modo = modoAlcance(u.rol);
  return {
    nombre: u.nombre, correo: u.correo, documento: u.documento ?? '', rol: u.rol, permiso: u.permiso,
    alcance: u.escuelas.length > 0 ? 'especificas' : modo === 'docente' ? 'asignados' : 'institucional',
    escuelas: [...u.escuelas], activo: u.activo,
  };
}

/** Al cambiar de perfil, el alcance vuelve al valor por defecto de ese perfil. */
export function alcancePorDefecto(rol: Rol | ''): FormularioUsuario['alcance'] {
  return rol === 'tutor' ? 'asignados' : 'institucional';
}

export const DOMINIO_INSTITUCIONAL = '@cun.edu.co';

/** Problemas del formulario en lenguaje de quien lo llena (el backend valida igual). */
export function problemasFormulario(f: FormularioUsuario, creando: boolean): Partial<Record<'nombre' | 'correo' | 'documento' | 'rol' | 'escuelas', string>> {
  const p: Partial<Record<'nombre' | 'correo' | 'documento' | 'rol' | 'escuelas', string>> = {};
  if (f.nombre.trim().length < 3) p.nombre = 'Escribe el nombre completo.';
  if (creando && !/^[^@\s]+@cun\.edu\.co$/i.test(f.correo.trim())) p.correo = 'Usa el correo institucional (@cun.edu.co).';
  if (!/^[A-Za-z0-9]{4,30}$/.test(f.documento.trim())) p.documento = 'Solo números o letras, sin puntos ni espacios (4 a 30 caracteres).';
  if (creando && !f.rol) p.rol = 'Elige el perfil.';
  if (f.alcance === 'especificas' && f.escuelas.length === 0) p.escuelas = 'Elige al menos una escuela.';
  return p;
}

/** Escuelas que se envían: solo para los perfiles que las usan; en los demás no se tocan. */
function escuelasDe(f: FormularioUsuario): string[] | undefined {
  if (!f.rol || modoAlcance(f.rol) === 'institucional') return undefined;
  return f.alcance === 'especificas' ? [...f.escuelas] : [];
}

export function cuerpoCreacion(f: FormularioUsuario): Record<string, unknown> {
  const escuelas = escuelasDe(f);
  return {
    nombre: f.nombre.trim(), correo: f.correo.trim().toLowerCase(), documento: f.documento.trim(), rol: f.rol, permiso: f.permiso,
    activo: f.activo, ...(escuelas !== undefined ? { escuelas } : {}),
  };
}

/** Edición: el correo y el perfil no cambian (el backend no lo admite); el estado se cambia con su acción propia. */
export function cuerpoEdicion(f: FormularioUsuario): Record<string, unknown> {
  const escuelas = escuelasDe(f);
  return { nombre: f.nombre.trim(), documento: f.documento.trim(), permiso: f.permiso, ...(escuelas !== undefined ? { escuelas } : {}) };
}

export const AYUDA_PERMISO: Readonly<Record<Permiso, string>> = {
  consulta: 'Puede visualizar dentro de su alcance.',
  escritura: 'Puede realizar las acciones habilitadas para su perfil.',
};

/** Fecha corta legible para «Último acceso» y «Creado». */
export function fechaUsuario(iso: string | null): string {
  if (!iso) return 'Nunca';
  const f = new Date(iso);
  return f.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
}
