import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { Periodo, ResultadoDistribucion, VistaPreviaDistribucion } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { leerError } from '@shared/utils/errores';
import {
  MENSAJE_OBSOLETA, escuelasElegibles, esPreviaObsoleta, periodoPorDefecto, textoConfirmacion, textoResultado,
} from './distribucion-docentes.util';

/**
 * G6 · «Distribuir estudiantes» entre docentes facilitadores, dentro del listado de Prácticas.
 * Flujo: periodo (obligatorio) y alcance explícito → vista previa del servidor (sin escrituras) → confirmación →
 * aplicación (transaccional; 409 si los datos cambiaron) → resumen y recarga del listado.
 */
@Component({
  selector: 'sipra-distribucion-docentes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  styles: [`
    :host { display: contents; }
    .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    dialog.cajon { margin: 0 0 0 auto; height: 100dvh; max-height: 100dvh; width: min(760px, 100vw); max-width: 100vw; box-sizing: border-box; padding: 0;
      border: 0; border-left: 1px solid var(--borde); background: var(--superficie); color: var(--texto); }
    dialog::backdrop { background: rgb(0 0 0 / .45); }
    .caj { display: flex; flex-direction: column; height: 100%; }
    .caj header { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-4) var(--sp-4) var(--sp-3); border-bottom: 1px solid var(--borde); }
    .caj header h2 { margin: 0; font-size: var(--fs-lg); flex: 1; }
    .x { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid transparent; border-radius: var(--r-sm); background: none; color: var(--texto-tenue); cursor: pointer; }
    .x:hover { border-color: var(--borde); color: var(--texto); } .x svg { width: 18px; height: 18px; }
    .x:focus-visible { outline: 2px solid var(--marca); outline-offset: 2px; }
    .cuerpo { flex: 1; overflow: auto; padding: var(--sp-4); display: grid; gap: var(--sp-4); align-content: start; }
    .conf { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: var(--sp-3); align-items: end; }
    .campo { margin: 0; min-width: 0; } .campo select { width: 100%; box-sizing: border-box; }
    fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; min-width: 0; }
    legend { font-weight: 600; font-size: var(--fs-sm); padding: 0; margin-bottom: 4px; }
    .opcion { display: flex; gap: 8px; align-items: center; font-size: var(--fs-sm); cursor: pointer; }
    .periodo-sel { font-size: var(--fs-sm); color: var(--texto-tenue); margin: 0; }
    .periodo-sel strong { color: var(--texto); }
    .cifras { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 0; border: 1px solid var(--borde); border-radius: var(--r-sm); }
    .cifras div { padding: var(--sp-2) var(--sp-3); border-left: 1px solid var(--borde); min-width: 0; }
    .cifras div:first-child { border-left: 0; }
    .cifras dt { font-size: var(--fs-xs); color: var(--texto-tenue); } .cifras dd { margin: 0; font-size: var(--fs-lg); font-weight: 600; font-variant-numeric: tabular-nums; }
    .cifras .aviso-n dd { color: var(--peligro); }
    table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--borde); vertical-align: top; }
    th { font-size: var(--fs-xs); color: var(--texto-tenue); font-weight: 600; }
    td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.mas { color: var(--marca); font-weight: 600; }
    td.esc { color: var(--texto-tenue); }
    .tabla { overflow-x: auto; }
    h3 { margin: 0 0 var(--sp-2); font-size: var(--fs-sm); }
    .lista { margin: 0; padding-left: 1.1rem; font-size: var(--fs-sm); display: grid; gap: 4px; }
    .pista { font-size: var(--fs-xs); color: var(--texto-tenue); }
    .caj footer { display: flex; gap: var(--sp-2); justify-content: flex-end; flex-wrap: wrap; padding: var(--sp-3) var(--sp-4); border-top: 1px solid var(--borde); }
    .hecho dl { display: grid; grid-template-columns: auto 1fr; gap: 4px var(--sp-3); margin: var(--sp-2) 0 0; font-size: var(--fs-sm); }
    .hecho dt { color: var(--texto-tenue); } .hecho dd { margin: 0; font-weight: 600; }
    dialog.confirmar { width: min(480px, calc(100vw - 32px)); box-sizing: border-box; border: 1px solid var(--borde); border-radius: var(--r-md); padding: var(--sp-5); background: var(--superficie); color: var(--texto); }
    .confirmar h2 { margin: 0 0 var(--sp-2); font-size: var(--fs-lg); } .confirmar p { margin: 0; color: var(--texto-tenue); font-size: var(--fs-sm); }
    .botones { display: flex; gap: var(--sp-2); justify-content: flex-end; margin-top: var(--sp-4); }
    @media (max-width: 600px) {
      .conf { grid-template-columns: 1fr; }
      .cifras { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cifras div:nth-child(3) { border-left: 0; } .cifras div:nth-child(n+3) { border-top: 1px solid var(--borde); }
      td.esc, th.esc { display: none; }
    }
  `],
  template: `
    <dialog #panel class="cajon" aria-labelledby="dd-titulo" (close)="alCerrar()">
      <div class="caj">
        <header>
          <h2 id="dd-titulo">Distribuir estudiantes</h2>
          <button type="button" class="x" aria-label="Cerrar" (click)="cerrar()"><svg aria-hidden="true"><use href="#sipra-cerrar" /></svg></button>
        </header>
        <div class="cuerpo">
          <p class="pista" style="margin:0">Reparte entre los docentes facilitadores los estudiantes del periodo que aún no tienen docente,
            empezando por el menos cargado y respetando el alcance por escuela. Las asignaciones existentes no se modifican.</p>

          <div class="conf">
            <div class="campo"><label for="dd-periodo">Periodo académico</label>
              <select #primerCampo id="dd-periodo" [ngModel]="periodo()" (ngModelChange)="periodo.set($event); invalidar()">
                @for (p of periodos(); track p.codigo) { <option [value]="p.codigo">{{ p.codigo }} · {{ p.nombre }}{{ p.activo ? '' : ' (inactivo)' }}</option> }
              </select></div>
            <fieldset>
              <legend>Escuelas</legend>
              <label class="opcion"><input type="radio" name="dd-alcance" value="todas" [checked]="modo() === 'todas'" (change)="modo.set('todas'); invalidar()" /> Todas las escuelas de mi alcance</label>
              <label class="opcion"><input type="radio" name="dd-alcance" value="una" [checked]="modo() === 'una'" (change)="modo.set('una'); invalidar()" /> Una escuela</label>
              @if (modo() === 'una') {
                <div class="campo"><label for="dd-escuela" class="sr">Escuela</label>
                  <select id="dd-escuela" [ngModel]="escuela()" (ngModelChange)="escuela.set($event); invalidar()">
                    @for (e of escuelas(); track e.codigo) { <option [value]="e.codigo">{{ e.nombre }}</option> }
                  </select></div>
              }
            </fieldset>
          </div>
          <div><button type="button" class="boton" [class.cargando]="cargando()" [disabled]="!periodo() || cargando() || (modo() === 'una' && !escuela())" (click)="previsualizar()">
            {{ vista() ? 'Actualizar vista previa' : 'Generar vista previa' }}</button></div>

          @if (obsoleta()) {
            <div class="aviso aviso--error" role="alert">{{ mensajeObsoleta }}</div>
          }

          @if (resultado(); as r) {
            <div class="aviso hecho" role="status"><strong>Distribución completada</strong>
              <dl><dt>Asignados</dt><dd>{{ r.asignados }}</dd><dt>Docentes</dt><dd>{{ r.docentes }}</dd><dt>Sin docente compatible</dt><dd>{{ r.sinDocenteCompatible }}</dd></dl>
            </div>
          }

          @if (vista(); as v) {
            <p class="periodo-sel">Vista previa del periodo <strong>{{ v.periodoAcademico }}</strong> · {{ v.escuelas === null ? 'todas las escuelas' : textoEscuelas(v.escuelas) }}</p>
            <dl class="cifras" aria-label="Resumen de la vista previa">
              <div><dt>Pendientes</dt><dd>{{ v.pendientes }}</dd></div>
              <div><dt>Docentes</dt><dd>{{ v.docentes.length }}</dd></div>
              <div><dt>Asignables</dt><dd>{{ v.asignables }}</dd></div>
              <div [class.aviso-n]="v.sinDocenteCompatible > 0"><dt>Sin docente compatible</dt><dd>{{ v.sinDocenteCompatible }}</dd></div>
            </dl>
            @if (v.motivoNoAplicable) { <div class="aviso" role="status">{{ v.motivoNoAplicable }}</div> }

            <section aria-labelledby="dd-prop">
              <h3 id="dd-prop">Distribución propuesta</h3>
              @if (v.docentes.length === 0) { <p class="pista">No hay docentes facilitadores activos con alcance en estas escuelas.</p> }
              @else {
                <div class="tabla"><table>
                  <thead><tr><th scope="col">Docente</th><th scope="col" class="esc">Escuela(s)</th><th scope="col" class="n">Actual</th><th scope="col" class="n">Nuevos</th><th scope="col" class="n">Final</th></tr></thead>
                  <tbody>
                    @for (d of v.docentes; track d.id) {
                      <tr><td>{{ d.nombre }}</td><td class="esc">{{ textoEscuelas(d.escuelas) }}</td><td class="n">{{ d.actual }}</td>
                        <td class="n" [class.mas]="d.nuevos > 0">+{{ d.nuevos }}</td><td class="n">{{ d.final }}</td></tr>
                    }
                  </tbody>
                </table></div>
              }
            </section>

            @if (v.noAsignables.length > 0) {
              <section aria-labelledby="dd-noasig">
                <h3 id="dd-noasig">Sin docente disponible · {{ v.sinDocenteCompatible }}</h3>
                <ul class="lista">@for (g of v.noAsignables; track g.escuelaId) { <li>{{ nombreEscuela(g.escuelaId) }} · {{ g.cantidad }} {{ g.cantidad === 1 ? 'estudiante' : 'estudiantes' }}</li> }</ul>
                <p class="pista">{{ v.noAsignables[0].motivo }} Quedan fuera del lote y no impiden aplicar las demás.</p>
              </section>
            }
            @if (v.docentesExcluidos.length > 0) {
              <details><summary class="pista">Docentes que no reciben asignaciones ({{ v.docentesExcluidos.length }})</summary>
                <ul class="lista">@for (x of v.docentesExcluidos; track x.id) { <li>{{ x.nombre }} — {{ x.motivo }}</li> }</ul>
              </details>
            }
          }
        </div>
        <footer>
          <button type="button" class="boton" (click)="cerrar()">{{ resultado() ? 'Cerrar' : 'Cancelar' }}</button>
          @if (!resultado()) {
            <button #botonAplicar type="button" class="boton boton--primario" [disabled]="!vista()?.puedeAplicar || cargando()" (click)="confirmar(botonAplicar)">Aplicar distribución</button>
          }
        </footer>
      </div>
    </dialog>

    <dialog #confirmacion class="confirmar" aria-labelledby="dd-conf-t" aria-describedby="dd-conf-p" (close)="alCerrarConfirmacion()">
      <h2 id="dd-conf-t">Aplicar distribución · {{ vista()?.periodoAcademico }}</h2>
      <p id="dd-conf-p">{{ textoConfirmar() }}</p>
      <div class="botones">
        <button #cancelarConf type="button" class="boton" (click)="cerrarConfirmacion()">Cancelar</button>
        <button type="button" class="boton boton--primario" [class.cargando]="cargando()" [disabled]="cargando()" (click)="aplicar()">Aplicar distribución</button>
      </div>
    </dialog>
  `,
})
export class DistribucionDocentesComponent {
  readonly periodos = input.required<Periodo[]>();
  /** Periodo elegido en el filtro del listado (si lo hay): solo sugiere el valor inicial. */
  readonly periodoFiltro = input<string>('');
  readonly aplicada = output<ResultadoDistribucion>();

  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);
  private readonly panel = viewChild.required<ElementRef<HTMLDialogElement>>('panel');
  private readonly dialogoConfirmacion = viewChild.required<ElementRef<HTMLDialogElement>>('confirmacion');
  private readonly primerCampo = viewChild<ElementRef<HTMLSelectElement>>('primerCampo');
  private readonly cancelarConf = viewChild<ElementRef<HTMLButtonElement>>('cancelarConf');
  private origenFoco: HTMLElement | null = null;
  private origenConfirmacion: HTMLElement | null = null;

  readonly mensajeObsoleta = MENSAJE_OBSOLETA;
  readonly periodo = signal('');
  readonly modo = signal<'todas' | 'una'>('todas');
  readonly escuela = signal('');
  readonly catalogo = signal<{ codigo: string; nombre: string }[]>([]);
  readonly vista = signal<VistaPreviaDistribucion | null>(null);
  readonly resultado = signal<ResultadoDistribucion | null>(null);
  readonly cargando = signal(false);
  readonly obsoleta = signal(false);

  readonly escuelas = computed(() => escuelasElegibles(this.catalogo(), this.sesion.sesion()?.escuelas ?? []));
  readonly textoConfirmar = computed(() => { const v = this.vista(); return v ? textoConfirmacion(v) : ''; });

  async abrir(origen: HTMLElement): Promise<void> {
    this.origenFoco = origen;
    this.periodo.set(periodoPorDefecto(this.periodos(), this.periodoFiltro()));
    this.modo.set('todas'); this.vista.set(null); this.resultado.set(null); this.obsoleta.set(false);
    const el = this.panel().nativeElement;
    if (!el.open) el.showModal();
    setTimeout(() => this.primerCampo()?.nativeElement.focus(), 0);
    if (this.catalogo().length === 0) {
      this.catalogo.set(await firstValueFrom(this.api.catalogoEscuelas()).catch(() => []));
      if (!this.escuela()) this.escuela.set(this.escuelas()[0]?.codigo ?? '');
    }
  }
  cerrar(): void { const el = this.panel().nativeElement; if (el.open) el.close(); }
  alCerrar(): void { this.origenFoco?.focus(); this.origenFoco = null; }

  /** Cambiar periodo o alcance invalida la vista previa: nunca se aplica algo distinto de lo que se ve. */
  invalidar(): void { this.vista.set(null); this.obsoleta.set(false); this.resultado.set(null); }

  async previsualizar(): Promise<void> {
    this.cargando.set(true); this.obsoleta.set(false); this.resultado.set(null);
    try {
      this.vista.set(await firstValueFrom(this.api.previsualizarDistribucion(this.periodo(), this.modo() === 'una' ? this.escuela() : undefined)));
    } catch (error) {
      this.vista.set(null);
      this.avisos.error(leerError(error));
    } finally { this.cargando.set(false); }
  }

  confirmar(origen: HTMLElement): void {
    this.origenConfirmacion = origen;
    this.dialogoConfirmacion().nativeElement.showModal();
    setTimeout(() => this.cancelarConf()?.nativeElement.focus(), 0);
  }
  cerrarConfirmacion(): void { const el = this.dialogoConfirmacion().nativeElement; if (el.open) el.close(); }
  alCerrarConfirmacion(): void { this.origenConfirmacion?.focus(); this.origenConfirmacion = null; }

  async aplicar(): Promise<void> {
    const v = this.vista();
    if (!v?.puedeAplicar) return;
    this.cargando.set(true);
    try {
      const r = await firstValueFrom(this.api.aplicarDistribucion({
        periodoAcademico: v.periodoAcademico, huella: v.huella, ...(this.modo() === 'una' ? { escuelaId: this.escuela() } : {}),
      }));
      this.cerrarConfirmacion();
      this.vista.set(null); this.resultado.set(r);
      this.avisos.exito(textoResultado(r));
      this.aplicada.emit(r);
    } catch (error) {
      this.cerrarConfirmacion();
      if (esPreviaObsoleta(error)) { this.vista.set(null); this.obsoleta.set(true); }
      else this.avisos.error(leerError(error));
    } finally { this.cargando.set(false); }
  }

  nombreEscuela(codigo: string): string { return this.catalogo().find((e) => e.codigo === codigo)?.nombre ?? codigo; }
  textoEscuelas(codigos: readonly string[]): string { return codigos.map((c) => this.nombreEscuela(c).replace(/^Escuela de /, '')).join(', '); }
}
