import { Routes } from '@angular/router';
import { rolGuard, sesionGuard } from './core/guards/sesion.guard';

/**
 * Todas las rutas de features se cargan de forma perezosa: el paquete inicial
 * solo contiene el shell y el ingreso.
 */
export const rutas: Routes = [
  {
    path: 'ingreso',
    title: 'Ingreso · SIPRA PRÁCTICAS',
    loadComponent: () =>
      import('./features/ingreso/ingreso.component').then((m) => m.IngresoComponent),
  },
  {
    path: 'ingreso/callback',
    title: 'Ingreso · SIPRA PRÁCTICAS',
    loadComponent: () =>
      import('./features/ingreso/callback.component').then((m) => m.IngresoCallbackComponent),
  },
  {
    path: '',
    canActivate: [sesionGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio',
        title: 'Inicio · SIPRA PRÁCTICAS',
        loadComponent: () =>
          import('./features/inicio/inicio.component').then((m) => m.InicioComponent),
      },
      {
        path: 'registro',
        title: 'Registrar mi práctica · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('estudiante', 'coordinador', 'administrador', 'tutor', 'auxiliar')],
        loadComponent: () =>
          import('./features/registro/registro.component').then((m) => m.RegistroComponent),
      },
      {
        path: 'arl',
        title: 'Solicitud de ARL · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('estudiante', 'auxiliar', 'coordinador', 'administrador', 'tutor')],
        loadComponent: () => import('./features/arl/arl.component').then((m) => m.ArlComponent),
      },
      {
        path: 'ayuda',
        title: 'Centro de ayuda · SIPRA PRÁCTICAS',
        loadComponent: () => import('./features/ayuda/ayuda.component').then((m) => m.AyudaComponent),
      },
      {
        path: 'pqrs',
        title: 'PQRS · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('estudiante', 'coordinador', 'administrador', 'auxiliar')],
        loadComponent: () => import('./features/pqrs/pqrs.component').then((m) => m.PqrsComponent),
      },
      {
        path: 'gestion/usuarios',
        title: 'Gestión de usuarios · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('coordinador', 'administrador')],
        loadComponent: () =>
          import('./features/gestion/usuarios.component').then((m) => m.UsuariosComponent),
      },
      {
        path: 'gestion/periodos',
        title: 'Gestión de periodos · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('coordinador', 'administrador')],
        loadComponent: () =>
          import('./features/gestion/periodos.component').then((m) => m.PeriodosComponent),
      },
      {
        path: 'vistas',
        title: 'Vistas SINU · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('coordinador', 'administrador', 'auxiliar', 'tutor')],
        loadComponent: () =>
          import('./features/vistas/vistas.component').then((m) => m.VistasComponent),
      },
      {
        path: 'practicas',
        title: 'Prácticas · SIPRA PRÁCTICAS',
        loadComponent: () =>
          import('./features/practicas/practicas.component').then((m) => m.PracticasComponent),
      },
      {
        path: 'practicas/:id',
        title: 'Expediente · SIPRA PRÁCTICAS',
        loadComponent: () =>
          import('./features/practicas/expediente.component').then((m) => m.ExpedienteComponent),
      },
      {
        path: 'cumplimiento',
        title: 'Cumplimiento · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('administrador', 'coordinador', 'extension', 'tutor')],
        loadComponent: () =>
          import('./features/cumplimiento/cumplimiento.component').then(
            (m) => m.CumplimientoComponent,
          ),
      },
      {
        path: 'empresas',
        title: 'Empresas · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('administrador', 'coordinador', 'extension', 'empresa')],
        loadComponent: () =>
          import('./features/empresas/empresas.component').then((m) => m.EmpresasComponent),
      },
      {
        path: 'bolsa',
        title: 'Bolsa de empleo · SIPRA PRÁCTICAS',
        loadComponent: () =>
          import('./features/bolsa/bolsa.component').then((m) => m.BolsaComponent),
      },
      {
        path: 'reportes',
        title: 'Reportes · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('administrador', 'extension', 'coordinador', 'auxiliar', 'tutor')],
        loadComponent: () =>
          import('./features/reportes/reportes.component').then((m) => m.ReportesComponent),
      },
      {
        path: 'costos-ia',
        title: 'Costos de IA · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('administrador', 'coordinador')],
        loadComponent: () =>
          import('./features/costos/costos-ia.component').then((m) => m.CostosIaComponent),
      },
      {
        path: 'auditoria',
        title: 'Auditoría · SIPRA PRÁCTICAS',
        canActivate: [rolGuard('administrador')],
        loadComponent: () =>
          import('./features/auditoria/auditoria.component').then((m) => m.AuditoriaComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
