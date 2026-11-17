import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { Rol, UsuarioAdministrativo } from '@core/models/modelos';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { MetricaV3, TiraMetricasComponent } from '@shared/components/tira-metricas.component';
import { leerError } from '@shared/utils/errores';
import {
  AYUDA_PERMISO, ETIQUETA_PERFIL, EscuelaCatalogo, FILTROS_VACIOS, FiltrosUsuarios, FormularioUsuario, alcancePorDefecto,
  cuerpoCreacion, cuerpoEdicion, detalleEscuelas, fechaUsuario, filtrarUsuarios, formularioDesde, formularioVacio, hayFiltros,
  metricasUsuarios, modoAlcance, nombreCortoEscuela, perfilesGestionables, perfilesVisibles, problemasFormulario, puedeGestionar,
  textoAlcance,
} from './usuarios.util';

/**
 * G4 · Gestión de usuarios V3: consola de administración (franja de cifras, filtros, tabla e inspector lateral).
 * Solo administrador y dirección (G1). El estudiante viene de la matrícula (SINU) y la empresa tiene su propio
 * proceso: ninguno se crea aquí. «Inhabilitar» no borra: el historial y lo que hizo la persona se conservan.
 */
@Component({
  selector: 'sipra-usuarios',
  standalone: true,
  imports: [FormsModule, TiraMetricasComponent, EsqueletoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'cerrarMenuFuera($event)' },
  styles: [`
    .cabecera { display:flex; flex-wrap:wrap; gap:var(--sp-2) var(--sp-4); align-items:center; justify-content:space-between; margin-bottom:var(--sp-3); }
    .cabecera p { margin:0; color:var(--texto-tenue); font-size:var(--fs-sm); max-width:62ch; }
    .cabecera .ayuda-modulo { font-size:var(--fs-xs); }
    .franja { margin-bottom:var(--sp-3); }
    .filtros { display:flex; flex-wrap:wrap; gap:var(--sp-2); align-items:flex-end; padding:var(--sp-2) 0 var(--sp-3); border-bottom:1px solid var(--borde); margin-bottom:var(--sp-2); }
    .filtros .campo { margin:0; min-width:min(100%, 150px); flex:1 1 150px; } .filtros .campo.buscar { flex:2 1 240px; }
    .filtros .resumen { margin-left:auto; font-size:var(--fs-xs); color:var(--texto-tenue); white-space:nowrap; align-self:center; }

    table.usuarios { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
    .usuarios th { text-align:left; font-size:var(--fs-xs); font-weight:600; color:var(--texto-tenue); padding:var(--sp-2); border-bottom:1px solid var(--borde); white-space:nowrap; }
    .usuarios td { padding:var(--sp-2); border-bottom:1px solid var(--borde); vertical-align:middle; }
    .usuarios tr.inhabilitado td { color:var(--texto-tenue); }
    .usuarios .nombre { font-weight:600; } .usuarios .doc { font-size:var(--fs-xs); color:var(--texto-tenue); font-variant-numeric:tabular-nums; }
    .usuarios .correo { white-space:nowrap; max-width:260px; overflow:hidden; text-overflow:ellipsis; } .usuarios .nw { white-space:nowrap; }
    .estado { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
    .estado i { width:8px; height:8px; border-radius:50%; flex:none; background:var(--ok); }
    .estado.off i { background:transparent; border:1.5px solid var(--texto-tenue); }
    .acciones-celda { width:48px; text-align:right; position:relative; }
    .menu-boton { display:inline-grid; place-items:center; width:36px; height:36px; border:1px solid transparent; border-radius:var(--r-sm); background:none; color:inherit; font:inherit; font-size:18px; line-height:1; cursor:pointer; }
    .menu-boton:hover, .menu-boton[aria-expanded="true"] { border-color:var(--borde); background:var(--superficie-2); }
    .menu-boton:focus-visible, .menu button:focus-visible { outline:2px solid var(--marca); outline-offset:1px; }
    .menu { position:absolute; right:var(--sp-2); top:calc(100% - 6px); z-index:20; min-width:200px; margin:0; padding:4px; list-style:none; text-align:left;
      background:var(--superficie); border:1px solid var(--borde); border-radius:var(--r-sm); box-shadow:0 10px 28px rgb(0 0 0 / .22); }
    .menu button { display:block; width:100%; text-align:left; font:inherit; font-size:var(--fs-sm); padding:8px 10px; border:0; border-radius:6px; background:none; color:inherit; cursor:pointer; }
    .menu button:hover { background:var(--superficie-2); } .menu .peligro { color:var(--peligro); }
    .menu .nota { padding:6px 10px; font-size:var(--fs-xs); color:var(--texto-tenue); }
    .sin-acciones { color:var(--texto-tenue); }
    .vacio-filtros { padding:var(--sp-5) var(--sp-2); text-align:center; color:var(--texto-tenue); font-size:var(--fs-sm); }
    .vacio-filtros button { margin-top:var(--sp-2); }

    /* Móvil: filas compactas (nombre · perfil · estado · correo) con su menú, sin desplazamiento horizontal. */
    @media (width < 760px) {
      .usuarios thead { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
      .usuarios tr { display:grid; grid-template-columns:max-content minmax(0,1fr) auto; grid-template-areas:"u u m" "p e m" "c c m";
        column-gap:var(--sp-2); row-gap:2px; padding:var(--sp-2) 0; border-bottom:1px solid var(--borde); }
      .usuarios td { padding:0; border:0; }
      .usuarios td.c-usuario { grid-area:u; } .usuarios td.acciones-celda { grid-area:m; align-self:start; }
      .usuarios td.c-perfil { grid-area:p; font-size:var(--fs-xs); } .usuarios td.c-estado { grid-area:e; font-size:var(--fs-xs); }
      .usuarios td.c-correo { grid-area:c; font-size:var(--fs-xs); color:var(--texto-tenue); max-width:none; }
      .usuarios td.c-alcance, .usuarios td.c-permiso, .usuarios td.c-acceso, .usuarios .doc { display:none; }
      .usuarios td.c-perfil::after { content:" ·"; color:var(--texto-tenue); }
      .filtros .resumen { margin-left:0; }
    }

    /* Inspector lateral: <dialog> nativo (foco atrapado, fondo inerte, Esc). */
    dialog.inspector { margin:0 0 0 auto; height:100dvh; max-height:100dvh; width:min(460px, 100vw); max-width:100vw; box-sizing:border-box; padding:0;
      border:0; border-left:1px solid var(--borde); background:var(--superficie); color:var(--texto); }
    dialog.inspector::backdrop { background:rgb(0 0 0 / .4); }
    .ins { display:flex; flex-direction:column; height:100%; }
    .ins header { display:flex; align-items:center; gap:var(--sp-2); padding:var(--sp-4) var(--sp-4) var(--sp-3); border-bottom:1px solid var(--borde); }
    .ins header h2 { margin:0; font-size:var(--fs-lg); flex:1; }
    .ins .x { display:grid; place-items:center; width:40px; height:40px; border:1px solid transparent; border-radius:var(--r-sm); background:none; color:var(--texto-tenue); cursor:pointer; }
    .ins .x:hover { border-color:var(--borde); color:var(--texto); } .ins .x svg { width:18px; height:18px; }
    .ins .x:focus-visible { outline:2px solid var(--marca); outline-offset:2px; }
    .ins .cuerpo { flex:1; overflow:auto; padding:var(--sp-4); display:grid; gap:var(--sp-3); align-content:start; }
    .ins .campo { margin:0; } .ins .campo input:not([type]), .ins .campo input[type="text"], .ins .campo input[type="email"], .ins .campo select { width:100%; box-sizing:border-box; }
    .ins .error { color:var(--peligro); font-size:var(--fs-xs); }
    .ins fieldset { border:0; margin:0; padding:0; display:grid; gap:6px; }
    .ins legend { font-weight:600; font-size:var(--fs-sm); padding:0; margin-bottom:4px; }
    .opcion { display:grid; grid-template-columns:auto 1fr; gap:2px 8px; align-items:start; font-size:var(--fs-sm); cursor:pointer; }
    .opcion input { margin-top:3px; } .opcion small { grid-column:2; color:var(--texto-tenue); font-size:var(--fs-xs); }
    .escuelas { display:grid; gap:4px; padding:var(--sp-2) var(--sp-3); border:1px solid var(--borde); border-radius:var(--r-sm); }
    .fijo { font-size:var(--fs-sm); } .fijo strong { display:block; } .fijo span { color:var(--texto-tenue); font-size:var(--fs-xs); }
    .meta { display:grid; grid-template-columns:auto 1fr; gap:4px var(--sp-3); font-size:var(--fs-sm); margin:0; padding-top:var(--sp-2); border-top:1px solid var(--borde); }
    .meta dt { color:var(--texto-tenue); } .meta dd { margin:0; }
    .ins footer { display:flex; gap:var(--sp-2); justify-content:flex-end; padding:var(--sp-3) var(--sp-4); border-top:1px solid var(--borde); }

    dialog.confirmar { width:min(480px, calc(100vw - 32px)); box-sizing:border-box; border:1px solid var(--borde); border-radius:var(--r-md); padding:var(--sp-5); background:var(--superficie); color:var(--texto); }
    dialog.confirmar::backdrop { background:rgb(0 0 0 / .45); }
    .confirmar h2 { margin:0 0 var(--sp-2); font-size:var(--fs-lg); } .confirmar p { margin:0; color:var(--texto-tenue); font-size:var(--fs-sm); }
    .confirmar .botones { display:flex; gap:var(--sp-2); justify-content:flex-end; margin-top:var(--sp-4); }
  `],
  template: `
    <div class="cabecera">
      <p>Administra los perfiles operativos y sus alcances dentro de SIPRA.
        <span class="ayuda-modulo" title="Los estudiantes provienen de la matrícula (SINU) y las empresas tienen su propio proceso de habilitación.">Estudiantes y empresas no se gestionan aquí.</span></p>
      <button #botonNuevo type="button" class="boton boton--primario" (click)="nuevo(botonNuevo)">+ Nuevo usuario</button>
    </div>

    <div class="franja"><sipra-tira-metricas [metricas]="cifras()" etiqueta="Usuarios" /></div>

    <section class="tarjeta" aria-label="Usuarios administrativos">
      <div class="filtros" role="search">
        <div class="campo buscar"><label for="u-buscar">Buscar</label>
          <input id="u-buscar" type="search" placeholder="Nombre, correo o documento" [ngModel]="filtros().texto" (ngModelChange)="filtrar('texto', $event)" /></div>
        <div class="campo"><label for="u-perfil">Perfil</label>
          <select id="u-perfil" [ngModel]="filtros().perfil" (ngModelChange)="filtrar('perfil', $event)">
            <option value="">Todos</option>
            @for (r of perfilesFiltro(); track r) { <option [value]="r">{{ etiqueta(r) }}</option> }
          </select></div>
        <div class="campo"><label for="u-estado">Estado</label>
          <select id="u-estado" [ngModel]="filtros().estado" (ngModelChange)="filtrar('estado', $event)">
            <option value="">Todos</option><option value="activo">Activos</option><option value="inactivo">Inhabilitados</option>
          </select></div>
        @if (escuelas().length > 0) {
          <div class="campo"><label for="u-escuela">Escuela</label>
            <select id="u-escuela" [ngModel]="filtros().escuela" (ngModelChange)="filtrar('escuela', $event)">
              <option value="">Todas</option>
              @for (e of escuelas(); track e.codigo) { <option [value]="e.codigo">{{ corto(e.codigo) }}</option> }
            </select></div>
        }
        @if (conFiltros()) { <button type="button" class="boton compacto" (click)="limpiar()">Limpiar filtros</button> }
        <span class="resumen" aria-live="polite">{{ visibles().length }} de {{ usuarios().length }} usuarios</span>
      </div>

      @if (cargando()) {
        <sipra-esqueleto tipo="filas" [cantidad]="6" />
      } @else if (visibles().length === 0) {
        <div class="vacio-filtros">
          {{ usuarios().length === 0 ? 'Aún no hay usuarios administrativos.' : 'No hay usuarios con estos filtros.' }}
          @if (conFiltros()) { <div><button type="button" class="boton compacto" (click)="limpiar()">Limpiar filtros</button></div> }
        </div>
      } @else {
        <table class="usuarios">
          <thead><tr><th scope="col">Usuario</th><th scope="col">Correo</th><th scope="col">Perfil</th><th scope="col">Alcance</th><th scope="col">Permiso</th><th scope="col">Estado</th><th scope="col">Último acceso</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            @for (u of visibles(); track u.id) {
              <tr [class.inhabilitado]="!u.activo">
                <td class="c-usuario"><div class="nombre">{{ u.nombre }}</div><div class="doc">{{ u.documento ?? '—' }}</div></td>
                <td class="c-correo correo" [attr.title]="u.correo">{{ u.correo }}</td>
                <td class="c-perfil nw">{{ etiqueta(u.rol) }}</td>
                <td class="c-alcance" [attr.title]="u.escuelas.length > 1 ? detalle(u.escuelas) : null">{{ alcance(u) }}</td>
                <td class="c-permiso nw">{{ u.permiso === 'consulta' ? 'Consulta' : 'Escritura' }}</td>
                <td class="c-estado"><span class="estado" [class.off]="!u.activo"><i aria-hidden="true"></i>{{ u.activo ? 'Activo' : 'Inhabilitado' }}</span></td>
                <td class="c-acceso nw">{{ fecha(u.ultimoAccesoEn) }}</td>
                <td class="acciones-celda">
                  @if (gestionable(u)) {
                    <button #botonMenu type="button" class="menu-boton" aria-haspopup="menu" [attr.aria-expanded]="menuAbierto() === u.id" [attr.aria-controls]="'menu-' + u.id"
                            [attr.aria-label]="'Acciones para ' + u.nombre" (click)="alternarMenu(u.id, $event)" (keydown)="teclaBotonMenu($event, u.id)">⋯</button>
                    @if (menuAbierto() === u.id) {
                      <ul class="menu" role="menu" [id]="'menu-' + u.id" [attr.aria-label]="'Acciones para ' + u.nombre">
                        <li role="none"><button type="button" role="menuitem" (keydown)="teclaMenu($event, botonMenu)" (click)="editar(u, botonMenu)">Editar</button></li>
                        @if (u.activo) {
                          @if (esUnoMismo(u)) { <li role="none" class="nota">No puedes inhabilitar tu propio usuario.</li> }
                          @else { <li role="none"><button type="button" role="menuitem" class="peligro" (keydown)="teclaMenu($event, botonMenu)" (click)="pedirInhabilitar(u, botonMenu)">Inhabilitar</button></li> }
                        } @else {
                          <li role="none"><button type="button" role="menuitem" (keydown)="teclaMenu($event, botonMenu)" (click)="reactivar(u, botonMenu)">Reactivar usuario</button></li>
                        }
                      </ul>
                    }
                  } @else { <span class="sin-acciones" [attr.title]="'Solo un administrador gestiona perfiles de ' + etiqueta(u.rol)"><span aria-hidden="true">—</span><span class="sr-only">Sin acciones disponibles para su perfil</span></span> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    <!-- ── Inspector lateral: crear / editar ─────────────────────────────── -->
    <dialog #inspector class="inspector" aria-labelledby="ins-titulo" (close)="alCerrarInspector()">
      <form class="ins" (ngSubmit)="guardar()" novalidate>
        <header>
          <h2 id="ins-titulo">{{ editando() ? 'Editar usuario' : 'Nuevo usuario' }}</h2>
          <button type="button" class="x" aria-label="Cerrar" (click)="cerrarInspector()"><svg aria-hidden="true"><use href="#sipra-cerrar" /></svg></button>
        </header>
        <div class="cuerpo">
          <div class="campo"><label for="f-nombre">Nombre completo</label>
            <input #primerCampo id="f-nombre" name="nombre" type="text" autocomplete="off" [(ngModel)]="f.nombre" [attr.aria-invalid]="mostrar('nombre') ? 'true' : null" [attr.aria-describedby]="mostrar('nombre') ? 'f-nombre-e' : null" />
            @if (mostrar('nombre')) { <span class="error" id="f-nombre-e">{{ problemas().nombre }}</span> }</div>

          <div class="campo"><label for="f-correo">Correo institucional</label>
            <input id="f-correo" name="correo" type="email" autocomplete="off" placeholder="nombre@cun.edu.co" [(ngModel)]="f.correo" [readonly]="!!editando()"
                   [attr.aria-describedby]="mostrar('correo') ? 'f-correo-a f-correo-e' : 'f-correo-a'" [attr.aria-invalid]="mostrar('correo') ? 'true' : null" />
            <span class="pista" id="f-correo-a">{{ editando() ? 'El correo no se modifica.' : 'Usa el correo institucional.' }}</span>
            @if (mostrar('correo')) { <span class="error" id="f-correo-e">{{ problemas().correo }}</span> }</div>

          <div class="campo"><label for="f-doc">Documento</label>
            <input id="f-doc" name="documento" type="text" inputmode="text" autocomplete="off" [(ngModel)]="f.documento" [attr.aria-invalid]="mostrar('documento') ? 'true' : null" [attr.aria-describedby]="mostrar('documento') ? 'f-doc-e' : null" />
            @if (mostrar('documento')) { <span class="error" id="f-doc-e">{{ problemas().documento }}</span> }</div>

          @if (editando(); as u) {
            <div class="fijo"><strong>Perfil</strong>{{ etiqueta(u.rol) }}<span> · el perfil no se cambia al editar.</span></div>
          } @else {
            <div class="campo"><label for="f-rol">Perfil</label>
              <select id="f-rol" name="rol" [ngModel]="f.rol" (ngModelChange)="cambiarPerfil($event)" [attr.aria-invalid]="mostrar('rol') ? 'true' : null" [attr.aria-describedby]="mostrar('rol') ? 'f-rol-e' : null">
                <option value="">Elige un perfil…</option>
                @for (r of perfilesCreables(); track r) { <option [value]="r">{{ etiqueta(r) }}</option> }
              </select>
              @if (mostrar('rol')) { <span class="error" id="f-rol-e">{{ problemas().rol }}</span> }</div>
          }

          <fieldset>
            <legend>Permiso</legend>
            <label class="opcion"><input type="radio" name="permiso" value="consulta" [(ngModel)]="f.permiso" /><span>Consulta</span><small>{{ ayudaPermiso.consulta }}</small></label>
            <label class="opcion"><input type="radio" name="permiso" value="escritura" [(ngModel)]="f.permiso" /><span>Escritura</span><small>{{ ayudaPermiso.escritura }}</small></label>
            <span class="pista">El permiso nunca amplía lo que permite el perfil.</span>
          </fieldset>

          @if (f.rol) {
            @switch (modo(f.rol)) {
              @case ('institucional') {
                <div class="fijo"><strong>Alcance</strong>Institucional<span> · este perfil no se limita por escuelas.</span></div>
              }
              @case ('coordinacion') {
                <fieldset>
                  <legend>Alcance</legend>
                  <label class="opcion"><input type="radio" name="alcance" value="institucional" [(ngModel)]="f.alcance" /><span>Institucional</span><small>Todas las escuelas (Área de Prácticas).</small></label>
                  <label class="opcion"><input type="radio" name="alcance" value="especificas" [(ngModel)]="f.alcance" /><span>Escuelas específicas</span></label>
                </fieldset>
              }
              @case ('docente') {
                <fieldset>
                  <legend>Alcance</legend>
                  <label class="opcion"><input type="radio" name="alcance" value="asignados" [(ngModel)]="f.alcance" /><span>Sus estudiantes asignados</span><small>Ve las prácticas que tiene a cargo.</small></label>
                  <label class="opcion"><input type="radio" name="alcance" value="especificas" [(ngModel)]="f.alcance" /><span>Asignados y escuelas específicas</span><small>Además, las prácticas de las escuelas elegidas.</small></label>
                </fieldset>
              }
            }
            @if (f.alcance === 'especificas' && modo(f.rol) !== 'institucional') {
              <fieldset class="escuelas" [attr.aria-describedby]="mostrar('escuelas') ? 'f-esc-e' : null">
                <legend>Escuelas</legend>
                @for (e of escuelas(); track e.codigo) {
                  <label class="opcion"><input type="checkbox" [name]="'esc-' + e.codigo" [checked]="f.escuelas.includes(e.codigo)" (change)="alternarEscuela(e.codigo)" /><span>{{ e.nombre }}</span></label>
                } @empty { <span class="pista">No se pudo cargar el catálogo de escuelas.</span> }
                @if (mostrar('escuelas')) { <span class="error" id="f-esc-e">{{ problemas().escuelas }}</span> }
              </fieldset>
            }
          }

          @if (editando(); as u) {
            <dl class="meta">
              <dt>Estado</dt><dd><span class="estado" [class.off]="!u.activo"><i aria-hidden="true"></i>{{ u.activo ? 'Activo' : 'Inhabilitado' }}</span></dd>
              @if (u.escuelas.length > 0) { <dt>Escuelas</dt><dd>{{ detalle(u.escuelas) }}</dd> }
              <dt>Creado</dt><dd>{{ fecha(u.creadoEn) }}</dd>
              <dt>Último acceso</dt><dd>{{ fecha(u.ultimoAccesoEn) }}</dd>
            </dl>
          } @else {
            <fieldset>
              <legend>Estado</legend>
              <label class="opcion"><input type="radio" name="activo" [value]="true" [(ngModel)]="f.activo" /><span>Activo</span></label>
              <label class="opcion"><input type="radio" name="activo" [value]="false" [(ngModel)]="f.activo" /><span>Inhabilitado</span></label>
            </fieldset>
          }
        </div>
        <footer>
          <button type="button" class="boton" (click)="cerrarInspector()">Cancelar</button>
          <button type="submit" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()">{{ editando() ? 'Guardar cambios' : 'Crear usuario' }}</button>
        </footer>
      </form>
    </dialog>

    <!-- ── Confirmación de inhabilitación ────────────────────────────────── -->
    <dialog #confirmacion class="confirmar" aria-labelledby="conf-titulo" aria-describedby="conf-texto" (close)="alCerrarConfirmacion()">
      <h2 id="conf-titulo">Inhabilitar a {{ porInhabilitar()?.nombre }}</h2>
      <p id="conf-texto">El usuario dejará de poder acceder a SIPRA. Su historial y las acciones registradas se conservarán.</p>
      <div class="botones">
        <button #cancelarConf type="button" class="boton" (click)="cerrarConfirmacion()">Cancelar</button>
        <button type="button" class="boton boton--peligro" [class.cargando]="guardando()" [disabled]="guardando()" (click)="confirmarInhabilitar()">Inhabilitar</button>
      </div>
    </dialog>
  `,
})
export class UsuariosComponent implements OnInit {
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  readonly usuarios = signal<UsuarioAdministrativo[]>([]);
  readonly escuelas = signal<EscuelaCatalogo[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly filtros = signal<FiltrosUsuarios>({ ...FILTROS_VACIOS });
  readonly menuAbierto = signal<string | null>(null);
  readonly editando = signal<UsuarioAdministrativo | null>(null);
  readonly porInhabilitar = signal<UsuarioAdministrativo | null>(null);
  readonly intentoGuardar = signal(false);
  /** Formulario del inspector (ngModel); `version` fuerza el recálculo de los avisos en OnPush. */
  f: FormularioUsuario = formularioVacio();

  private readonly inspector = viewChild.required<ElementRef<HTMLDialogElement>>('inspector');
  private readonly confirmacion = viewChild.required<ElementRef<HTMLDialogElement>>('confirmacion');
  private readonly primerCampo = viewChild<ElementRef<HTMLInputElement>>('primerCampo');
  private readonly cancelarConf = viewChild<ElementRef<HTMLButtonElement>>('cancelarConf');
  private origenFoco: HTMLElement | null = null;

  readonly ayudaPermiso = AYUDA_PERMISO;
  readonly fecha = fechaUsuario;
  readonly modo = modoAlcance;
  readonly etiqueta = (r: string) => ETIQUETA_PERFIL[r] ?? r;

  readonly rolActor = computed(() => this.sesion.rol());
  readonly perfilesCreables = computed(() => perfilesGestionables(this.rolActor()));
  readonly perfilesFiltro = computed(() => perfilesVisibles(this.rolActor()));
  readonly visibles = computed(() => filtrarUsuarios(this.usuarios(), this.filtros()));
  readonly conFiltros = computed(() => hayFiltros(this.filtros()));
  readonly cifras = computed<MetricaV3[]>(() => {
    const m = metricasUsuarios(this.usuarios());
    return [
      { n: m.activos, t: 'Usuarios activos', tono: 'ok', contexto: `de ${this.usuarios().length}` },
      { n: m.docentes, t: 'Docentes facilitadores', tono: 'info', contexto: 'activos' },
      { n: m.analistas, t: 'Analistas', tono: 'info', contexto: 'activos' },
      { n: m.inhabilitados, t: 'Inhabilitados', tono: 'neutra', contexto: 'sin acceso' },
    ];
  });

  async ngOnInit(): Promise<void> {
    void firstValueFrom(this.api.catalogoEscuelas()).then((e) => this.escuelas.set(e)).catch(() => undefined);
    await this.cargar();
  }

  /** Carga TODOS los usuarios administrativos una vez; los filtros se aplican en el cliente (sin recargar). */
  async cargar(): Promise<void> {
    try { this.usuarios.set(await firstValueFrom(this.api.listarUsuarios({}))); }
    catch (error) { this.avisos.error(leerError(error, 'No fue posible cargar los usuarios.')); }
    finally { this.cargando.set(false); }
  }

  filtrar(campo: keyof FiltrosUsuarios, valor: string): void { this.filtros.update((f) => ({ ...f, [campo]: valor ?? '' })); }
  limpiar(): void { this.filtros.set({ ...FILTROS_VACIOS }); }

  gestionable(u: UsuarioAdministrativo): boolean { return puedeGestionar(this.rolActor(), u); }
  esUnoMismo(u: UsuarioAdministrativo): boolean { return u.id === this.sesion.sesion()?.id; }
  alcance(u: UsuarioAdministrativo): string { return textoAlcance(u, this.escuelas()); }
  detalle(escuelas: readonly string[]): string { return detalleEscuelas(escuelas, this.escuelas()); }
  corto(codigo: string): string { return nombreCortoEscuela(codigo, this.escuelas()); }

  // ── Menú de acciones (botón ⋯): teclado completo, Esc devuelve el foco ──
  alternarMenu(id: string, evento: Event): void {
    evento.stopPropagation();
    const abrir = this.menuAbierto() !== id;
    this.menuAbierto.set(abrir ? id : null);
    if (abrir) setTimeout(() => this.itemsMenu(id)[0]?.focus(), 0);
  }

  teclaBotonMenu(evento: KeyboardEvent, id: string): void {
    if (evento.key === 'ArrowDown') { evento.preventDefault(); this.menuAbierto.set(id); setTimeout(() => this.itemsMenu(id)[0]?.focus(), 0); }
  }

  teclaMenu(evento: KeyboardEvent, boton: HTMLElement): void {
    const id = this.menuAbierto();
    if (!id) return;
    const items = this.itemsMenu(id);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (evento.key === 'Escape' || evento.key === 'Tab') { if (evento.key === 'Escape') evento.preventDefault(); this.menuAbierto.set(null); boton.focus(); return; }
    const destino = evento.key === 'ArrowDown' ? (i + 1) % items.length : evento.key === 'ArrowUp' ? (i - 1 + items.length) % items.length
      : evento.key === 'Home' ? 0 : evento.key === 'End' ? items.length - 1 : -1;
    if (destino >= 0) { evento.preventDefault(); items[destino]?.focus(); }
  }

  cerrarMenuFuera(evento: Event): void {
    if (this.menuAbierto() && !(evento.target as HTMLElement | null)?.closest('.acciones-celda')) this.menuAbierto.set(null);
  }

  private itemsMenu(id: string): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>(`#menu-${CSS.escape(id)} [role="menuitem"]`)];
  }

  // ── Inspector ──
  nuevo(origen: HTMLElement): void {
    this.editando.set(null);
    this.f = formularioVacio();
    this.abrirInspector(origen);
  }

  editar(u: UsuarioAdministrativo, origen: HTMLElement): void {
    this.menuAbierto.set(null);
    this.editando.set(u);
    this.f = formularioDesde(u);
    this.abrirInspector(origen);
  }

  private abrirInspector(origen: HTMLElement): void {
    this.origenFoco = origen;
    this.intentoGuardar.set(false);
    const el = this.inspector().nativeElement;
    if (!el.open) el.showModal();
    setTimeout(() => this.primerCampo()?.nativeElement.focus(), 0);
  }

  cerrarInspector(): void { const el = this.inspector().nativeElement; if (el.open) el.close(); }
  alCerrarInspector(): void { this.origenFoco?.focus(); this.origenFoco = null; }

  cambiarPerfil(rol: Rol | ''): void {
    this.f.rol = rol;
    this.f.alcance = alcancePorDefecto(rol);
    this.f.escuelas = [];
  }

  alternarEscuela(codigo: string): void {
    this.f.escuelas = this.f.escuelas.includes(codigo) ? this.f.escuelas.filter((c) => c !== codigo) : [...this.f.escuelas, codigo];
  }

  problemas() { return problemasFormulario(this.f, !this.editando()); }
  mostrar(campo: 'nombre' | 'correo' | 'documento' | 'rol' | 'escuelas'): boolean { return this.intentoGuardar() && !!this.problemas()[campo]; }

  async guardar(): Promise<void> {
    this.intentoGuardar.set(true);
    const problemas = this.problemas();
    if (Object.keys(problemas).length > 0) {
      const primero = { nombre: 'f-nombre', correo: 'f-correo', documento: 'f-doc', rol: 'f-rol', escuelas: 'f-nombre' }[Object.keys(problemas)[0] as 'nombre'];
      document.getElementById(primero)?.focus();
      return;
    }
    const u = this.editando();
    const ok = await this.ejecutar(async () => {
      if (u) { await firstValueFrom(this.api.actualizarUsuario(u.id, cuerpoEdicion(this.f))); return 'Usuario actualizado.'; }
      await firstValueFrom(this.api.crearUsuario(cuerpoCreacion(this.f)));
      return 'Usuario creado. Ingresa con su correo institucional.';
    });
    if (ok) this.cerrarInspector();
  }

  // ── Inhabilitar / reactivar ──
  pedirInhabilitar(u: UsuarioAdministrativo, origen: HTMLElement): void {
    this.menuAbierto.set(null);
    this.origenFoco = origen;
    this.porInhabilitar.set(u);
    this.confirmacion().nativeElement.showModal();
    // El foco inicial va a «Cancelar»: la acción destructiva exige un gesto explícito.
    setTimeout(() => this.cancelarConf()?.nativeElement.focus(), 0);
  }

  cerrarConfirmacion(): void { const el = this.confirmacion().nativeElement; if (el.open) el.close(); }
  alCerrarConfirmacion(): void { this.porInhabilitar.set(null); this.origenFoco?.focus(); this.origenFoco = null; }

  async confirmarInhabilitar(): Promise<void> {
    const u = this.porInhabilitar();
    if (!u) return;
    const ok = await this.ejecutar(async () => { await firstValueFrom(this.api.eliminarUsuario(u.id)); return `${u.nombre} quedó inhabilitado.`; });
    if (ok) this.cerrarConfirmacion();
  }

  async reactivar(u: UsuarioAdministrativo, origen: HTMLElement): Promise<void> {
    this.menuAbierto.set(null);
    await this.ejecutar(async () => { await firstValueFrom(this.api.actualizarUsuario(u.id, { activo: true })); return `${u.nombre} quedó activo de nuevo.`; });
    origen.focus();
  }

  private async ejecutar(accion: () => Promise<string>): Promise<boolean> {
    this.guardando.set(true);
    try { this.avisos.exito(await accion()); await this.cargar(); return true; }
    catch (error) { this.avisos.error(leerError(error)); return false; }
    finally { this.guardando.set(false); }
  }
}
