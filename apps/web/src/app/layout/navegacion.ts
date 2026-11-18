import { tieneRol } from '@core/auth/roles';
import { Rol } from '@core/models/modelos';

/**
 * Navegación de SIPRA: UNA configuración central, agrupada por función, que el armazón filtra por rol.
 *
 * - Solo refleja permisos: los roles de cada entrada son EXACTAMENTE los del `rolGuard` de su ruta (app.routes.ts),
 *   y la API sigue siendo la autoridad. La prueba `shell-navegacion.spec.ts` lo verifica entrada por entrada.
 * - Mismo orden para todos los perfiles (memoria muscular): si un perfil no tiene una entrada, simplemente no aparece;
 *   un grupo sin entradas visibles no se muestra.
 * - Validación documental es el ÚNICO acceso de primer nivel a la validación. Las mesas especializadas (EPS, Actas,
 *   RUT, Cámara) siguen existiendo con sus rutas; se alcanzan desde la navegación secundaria de Validación documental
 *   (`MESAS_ESPECIALIZADAS`) y, estando en ellas, «Validación documental» aparece activa.
 */
export interface NavItem {
  readonly ruta: string;
  readonly etiqueta: string;
  readonly icono: string;
  /** null = cualquier sesión. Lista = exactamente esos roles (sin expansión de grupos). */
  readonly roles: readonly Rol[] | null;
  /** Otras rutas (y sus subrutas) que también marcan esta entrada como activa. */
  readonly rutasActivas?: readonly string[];
}

export interface NavGroup {
  readonly id: 'principal' | 'operacion' | 'analisis' | 'validacion' | 'gestion' | 'soporte';
  readonly etiqueta: string;
  readonly items: readonly NavItem[];
}

const PERSONAL_PRACTICAS: readonly Rol[] = ['coordinador', 'analista', 'administrador', 'tutor', 'auxiliar'];

/** Mesas de los motores especializados: rutas históricas, ahora navegación secundaria de Validación documental. */
export const MESAS_ESPECIALIZADAS: readonly NavItem[] = [
  { ruta: '/eps', etiqueta: 'EPS', icono: 'sipra-seguridad', roles: ['auxiliar', 'coordinador', 'analista', 'administrador'] },
  { ruta: '/actas', etiqueta: 'Actas', icono: 'sipra-documentos', roles: ['auxiliar', 'coordinador', 'analista', 'administrador'] },
  { ruta: '/mesa-rut', etiqueta: 'RUT', icono: 'sipra-documentos', roles: ['tutor', 'coordinador', 'analista', 'administrador'] },
  { ruta: '/mesa-camara', etiqueta: 'Cámara', icono: 'sipra-empresa', roles: ['tutor', 'coordinador', 'analista', 'administrador'] },
];

export const NAVEGACION: readonly NavGroup[] = [
  {
    id: 'principal', etiqueta: 'Principal', items: [
      { ruta: '/inicio', etiqueta: 'Inicio', icono: 'sipra-inicio', roles: null },
    ],
  },
  {
    id: 'operacion', etiqueta: 'Operación', items: [
      { ruta: '/practicas', etiqueta: 'Prácticas', icono: 'sipra-documentos', roles: null },
      { ruta: '/registro', etiqueta: 'Registrar mi práctica', icono: 'sipra-cargar', roles: ['estudiante'] },
      { ruta: '/arl', etiqueta: 'Solicitud de ARL', icono: 'sipra-seguridad', roles: ['estudiante', 'auxiliar', 'coordinador', 'analista', 'administrador', 'tutor'] },
      { ruta: '/registro', etiqueta: 'Registro FUR y cartas', icono: 'sipra-cargar', roles: PERSONAL_PRACTICAS },
      { ruta: '/cumplimiento', etiqueta: 'Cumplimiento', icono: 'sipra-verificado', roles: ['administrador', 'director', 'coordinador', 'analista', 'extension', 'tutor'] },
      { ruta: '/empresas', etiqueta: 'Empresas', icono: 'sipra-empresa', roles: ['administrador', 'coordinador', 'analista', 'extension', 'empresa'] },
      { ruta: '/bolsa', etiqueta: 'Bolsa de empleo', icono: 'sipra-oportunidades', roles: null },
    ],
  },
  {
    id: 'analisis', etiqueta: 'Análisis', items: [
      { ruta: '/reportes', etiqueta: 'Reportes', icono: 'sipra-indicadores', roles: ['administrador', 'director', 'extension', 'coordinador', 'analista', 'auxiliar', 'tutor'] },
      { ruta: '/costos-ia', etiqueta: 'Costos de IA', icono: 'sipra-costos', roles: ['administrador', 'coordinador', 'analista'] },
      { ruta: '/vistas', etiqueta: 'Vistas SINU', icono: 'sipra-buscar', roles: PERSONAL_PRACTICAS },
    ],
  },
  {
    id: 'validacion', etiqueta: 'Validación', items: [
      {
        ruta: '/validacion-documental', etiqueta: 'Validación documental', icono: 'sipra-revision',
        roles: ['tutor', 'auxiliar', 'coordinador', 'analista', 'administrador'],
        rutasActivas: MESAS_ESPECIALIZADAS.map((m) => m.ruta),
      },
    ],
  },
  {
    id: 'gestion', etiqueta: 'Gestión', items: [
      { ruta: '/gestion/periodos', etiqueta: 'Gestión de periodos', icono: 'sipra-calendario', roles: ['administrador', 'director'] },
      { ruta: '/gestion/usuarios', etiqueta: 'Gestión de usuarios', icono: 'sipra-configuracion', roles: ['administrador', 'director'] },
      { ruta: '/auditoria', etiqueta: 'Auditoría', icono: 'sipra-auditoria', roles: ['administrador'] },
    ],
  },
  {
    id: 'soporte', etiqueta: 'Soporte', items: [
      { ruta: '/pqrs', etiqueta: 'PQRS', icono: 'sipra-correo', roles: ['estudiante', 'coordinador', 'analista', 'administrador', 'auxiliar'] },
      { ruta: '/ayuda', etiqueta: 'Ayuda', icono: 'sipra-ayuda', roles: null },
    ],
  },
];

export function puedeVer(item: Pick<NavItem, 'roles'>, rol: Rol | null | undefined): boolean {
  return rol != null && (item.roles === null || tieneRol(item.roles, rol));
}

/** Grupos visibles para el rol, en el orden común; los grupos vacíos no se devuelven. */
export function navegacionPara(rol: Rol | null | undefined): NavGroup[] {
  if (!rol) return [];
  return NAVEGACION
    .map((g) => ({ ...g, items: g.items.filter((i) => puedeVer(i, rol)) }))
    .filter((g) => g.items.length > 0);
}

/** Mesas especializadas que el rol puede abrir (navegación secundaria de Validación documental). */
export function mesasPara(rol: Rol | null | undefined): NavItem[] {
  return MESAS_ESPECIALIZADAS.filter((m) => puedeVer(m, rol));
}

const coincide = (url: string, ruta: string) => url === ruta || url.startsWith(ruta + '/');

/** ¿La entrada está activa para esta URL? Incluye subrutas y `rutasActivas` (p. ej. /mesa-rut → Validación documental). */
export function estaActiva(item: Pick<NavItem, 'ruta' | 'rutasActivas'>, url: string): boolean {
  const limpia = url.split('?')[0].split('#')[0];
  return [item.ruta, ...(item.rutasActivas ?? [])].some((r) => coincide(limpia, r));
}
