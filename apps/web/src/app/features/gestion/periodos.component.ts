import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { ModalidadCatalogo, Periodo, TipoVentana } from '@core/models/modelos';
import { CronogramaComponent } from '@shared/components/cronograma.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';

const VENTANAS: TipoVentana[] = ['registro_fur', 'solicitud_arl', 'cargue_estudiante', 'cargue_docente', 'carta_presentacion'];

/** Gestión de periodos (SGP): ventanas, modalidades ofertadas y sincronización, periodo por periodo. */
@Component({
  selector: 'sipra-periodos',
  standalone: true,
  imports: [FormsModule, EtiquetaPipe, CronogramaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .intro { margin-bottom:var(--sp-3); } .intro summary { cursor:pointer; font-weight:600; font-size:var(--fs-sm); min-height:36px; display:flex; align-items:center; width:fit-content; }
    /* Maestro / detalle: una lista de periodos y la configuración del elegido (antes, nueve periodos expandidos en una sola página). */
    .maestro-detalle { display:grid; gap:var(--sp-3); grid-template-columns:minmax(0,1fr); align-items:start; }
    @media (width >= 1000px) { .maestro-detalle { grid-template-columns:260px minmax(0,1fr); } .maestro { position:sticky; top:calc(var(--alto-cinta, 0px) + 62px + 12px); max-height:calc(100dvh - 140px); overflow:auto; } }
    .maestro { display:flex; flex-wrap:wrap; gap:var(--sp-1); }
    @media (width >= 1000px) { .maestro { flex-direction:column; flex-wrap:nowrap; } }
    .maestro .item { display:flex; gap:var(--sp-2); align-items:center; text-align:left; font:inherit; color:inherit; background:var(--superficie); border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); min-height:44px; cursor:pointer; }
    .maestro .item:hover { background:var(--superficie-2); } .maestro .item.sel { border-color:var(--marca); background:var(--marca-suave); }
    .maestro .item { flex-wrap:wrap; } .maestro .cod { font-weight:700; flex:1; } .maestro .item .etiqueta { flex:none; }
    .maestro .nom { flex:1 1 100%; order:3; font-size:var(--fs-xs); color:var(--texto-tenue); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @media (width < 1000px) { .maestro .nom { display:none; } }
    .periodo { display:grid; gap:var(--sp-3); }
    .periodo header { display:flex; gap:var(--sp-2) var(--sp-4); align-items:center; flex-wrap:wrap; } .periodo header h2 { margin:0; flex:1 1 20rem; font-size:var(--fs-lg); }
    .marca { display:flex; gap:6px; align-items:center; font-size:var(--fs-sm); min-height:36px; }
    .pestanas { display:flex; gap:2px; border-bottom:1px solid var(--borde); overflow-x:auto; }
    .pestanas button { flex:none; font:inherit; font-size:var(--fs-sm); font-weight:600; color:var(--texto-tenue); background:none; border:0; border-bottom:2px solid transparent; padding:var(--sp-2) var(--sp-3); min-height:44px; cursor:pointer; white-space:nowrap; }
    .pestanas button.activa { color:var(--marca); border-bottom-color:var(--marca); }
    .pestanas button:focus-visible { outline:2px solid var(--marca); outline-offset:-2px; }
    /* Cada ventana en UNA fila: nombre y estado, fechas y acciones. */
    .ventanas { display:grid; gap:var(--sp-1); }
    .ventana { border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); font-size:var(--fs-sm); display:grid; gap:var(--sp-2); align-items:center; }
    @media (width >= 900px) { .ventana { grid-template-columns:minmax(14rem,1.1fr) minmax(0,1.2fr) auto; } }
    .ventana .t { display:flex; gap:var(--sp-2); align-items:center; justify-content:space-between; flex-wrap:wrap; font-weight:600; } .ventana .t .etiqueta { flex:none; white-space:nowrap; }
    .ventana input { font:inherit; font-size:var(--fs-xs); border:1px solid var(--borde); border-radius:var(--r-sm); padding:4px 6px; background:var(--superficie); color:inherit; min-height:32px; }
    .fechas { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-1); }
    .mods { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-3); font-size:var(--fs-xs); } .mods label { display:flex; gap:4px; align-items:center; }
    .rej { display:grid; gap:0 var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr)); }
    .crono { display:grid; gap:var(--sp-3); grid-template-columns:1fr; } @media (width >= 900px) { .crono { grid-template-columns:minmax(0,1fr) 300px; align-items:start; } }
    .crono input { font:inherit; font-size:var(--fs-xs); border:1px solid var(--borde); border-radius:var(--r-sm); padding:4px 6px; background:var(--superficie); color:inherit; min-height:32px; }
    .crono .campo { margin:0; }
  `],
  template: `
    <details class="intro">
      <summary>Cómo funcionan los periodos</summary>
    <p class="pista" style="max-width:72ch;margin:var(--sp-2) 0 0">
      Habilite o deshabilite por periodo el registro FUR, el cargue de documentos del estudiante y del docente (casos especiales),
      la solicitud de ARL, la carta de presentación, la sincronización de docentes con SINU y las modalidades ofertadas. Hay tres calendarios:
      presencial (2026A–D), virtual (26V01–06) y 335 (26P01–06). Al crear un periodo, el cronograma se arma con la regla del Área de Prácticas:
      dos meses desde el inicio para registrar y solicitar la ARL, inducción en la segunda semana y cargue de documentos dos semanas antes del cierre.
    </p>
    </details>

    <details class="tarjeta" style="margin-bottom:var(--sp-4)">
      <summary class="boton compacto" style="display:inline-flex">+ Crear periodo</summary>
      <div class="rej" style="margin-top:var(--sp-3)">
        <div class="campo"><label for="n-cod">Código</label><input id="n-cod" [(ngModel)]="n.codigo" placeholder="2027A o 27V01" /></div>
        <div class="campo"><label for="n-nom">Nombre</label><input id="n-nom" [(ngModel)]="n.nombre" /></div>
        <div class="campo"><label for="n-cal">Calendario</label><select id="n-cal" [(ngModel)]="n.calendario"><option value="presencial">Presencial</option><option value="virtual">Virtual</option><option value="335">335</option></select></div>
        <div class="campo"><label for="n-ini">Inicio</label><input id="n-ini" type="date" [(ngModel)]="n.fechaInicio" /></div>
        <div class="campo"><label for="n-fin">Fin</label><input id="n-fin" type="date" [(ngModel)]="n.fechaFin" /></div>
        <div class="campo"><label for="n-fur">Límite de registro y ARL</label><input id="n-fur" type="date" [(ngModel)]="n.cierreFur" /><span class="pista">Vacío: dos meses después del inicio.</span></div>
        <div class="campo"><label for="n-car">Fecha de cargue de documentos</label><input id="n-car" type="date" [(ngModel)]="n.fechaCargueDocumentos" /><span class="pista">Vacío: dos semanas antes del cierre.</span></div>
      </div>
      <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()" (click)="crear()">Crear con las ventanas habituales</button>
    </details>

    <div class="maestro-detalle">
      <nav class="maestro" aria-label="Periodos académicos">
        @for (p of periodos(); track p.codigo) {
          <button type="button" class="item" [class.sel]="actual().codigo === p.codigo" [attr.aria-current]="actual().codigo === p.codigo ? 'true' : null" (click)="elegir(p.codigo)">
            <span class="cod">{{ p.codigo }}</span>
            <span class="nom">{{ p.nombre }}</span>
            <span class="etiqueta" [class.etiqueta--ok]="p.vigente && p.activo" [class.etiqueta--neutra]="!(p.vigente && p.activo)">{{ !p.activo ? 'inactivo' : p.vigente ? 'vigente' : 'cerrado' }}</span>
          </button>
        }
      </nav>

      @if (actual(); as p) {
        <section class="tarjeta periodo" [attr.aria-label]="'Periodo ' + p.codigo">
          <header>
            <h2>{{ p.codigo }} <span class="pista">· {{ p.nombre }} · {{ p.calendario | etiqueta }} · {{ p.fechaInicio }} a {{ p.fechaFin }}</span></h2>
            <label class="marca"><input type="checkbox" [checked]="p.sincronizacionDocentes" (change)="guardar(p, { sincronizacionDocentes: !p.sincronizacionDocentes })" /> Sincronización de docentes</label>
            <label class="marca"><input type="checkbox" [checked]="p.activo" (change)="guardar(p, { activo: !p.activo })" /> Activo</label>
          </header>

          <div role="tablist" class="pestanas" aria-label="Qué configurar de este periodo">
            @for (t of pestanas; track t.clave) {
              <button type="button" role="tab" [id]="'pt-' + t.clave" [attr.aria-selected]="pestana() === t.clave" [attr.aria-controls]="'pp-' + t.clave" [tabIndex]="pestana() === t.clave ? 0 : -1"
                      [class.activa]="pestana() === t.clave" (click)="pestana.set(t.clave)" (keydown)="teclaPestana($event)">{{ t.texto }}@if (t.clave === 'modalidades') { <span class="pista"> ({{ p.modalidadesHabilitadas.length === 0 ? 'todas' : p.modalidadesHabilitadas.length }})</span> }</button>
            }
          </div>

          @if (pestana() === 'ventanas') {
            <div role="tabpanel" id="pp-ventanas" aria-labelledby="pt-ventanas" class="ventanas">
              @for (v of ventanas; track v) {
                <div class="ventana">
                  <div class="t"><span>{{ v | etiqueta }}</span><span class="etiqueta etiqueta--icono" [class.etiqueta--ok]="p.abiertas[v]" [class.etiqueta--neutra]="!p.abiertas[v]"><span aria-hidden="true">{{ p.abiertas[v] ? '●' : '○' }}</span> {{ p.abiertas[v] ? 'abierta' : 'cerrada' }}</span></div>
                  <div class="fechas">
                    <input type="date" [value]="p.ventanas[v]?.desde ?? ''" (change)="fecha(p, v, 'desde', $event)" [attr.aria-label]="(v | etiqueta) + ': desde'" />
                    <input type="date" [value]="p.ventanas[v]?.hasta ?? ''" (change)="fecha(p, v, 'hasta', $event)" [attr.aria-label]="(v | etiqueta) + ': hasta'" />
                  </div>
                  <div class="acciones"><button type="button" class="boton compacto" (click)="aplicarVentana(p, v)" [disabled]="guardando()">Aplicar</button>
                    @if (p.ventanas[v]) { <button type="button" class="boton compacto boton--peligro" (click)="deshabilitarVentana(p, v)" [disabled]="guardando()">Deshabilitar</button> }</div>
                </div>
              }
            </div>
          }
          @if (pestana() === 'cronograma') {
            <div role="tabpanel" id="pp-cronograma" aria-labelledby="pt-cronograma" class="crono">
              <div class="rej">
                <div class="campo"><label [for]="'j1-' + p.codigo">Jornada de inducción 1</label><input [id]="'j1-' + p.codigo" type="date" [value]="jornada(p, 0)" (change)="campoCrono(p, 'j1', $event)" /></div>
                <div class="campo"><label [for]="'j2-' + p.codigo">Jornada de inducción 2</label><input [id]="'j2-' + p.codigo" type="date" [value]="jornada(p, 1)" (change)="campoCrono(p, 'j2', $event)" /></div>
                <div class="campo"><label [for]="'fc-' + p.codigo">Fecha de cargue de documentos</label><input [id]="'fc-' + p.codigo" type="date" [value]="p.cronograma.fechaCargueDocumentos ?? ''" (change)="campoCrono(p, 'cargue', $event)" /></div>
                <div class="acciones" style="align-self:end"><button type="button" class="boton compacto" [disabled]="guardando()" (click)="aplicarCronograma(p)">Aplicar cronograma</button></div>
              </div>
              <sipra-cronograma [periodo]="p" />
            </div>
          }
          @if (pestana() === 'modalidades') {
            <div role="tabpanel" id="pp-modalidades" aria-labelledby="pt-modalidades">
              <div class="mods">
                @for (m of modalidades(); track m.modalidad) {
                  <label><input type="checkbox" [checked]="p.modalidadesOfertadas.includes(m.modalidad)" (change)="alternarModalidad(p, m.modalidad)" /> {{ m.etiquetaSgp }}</label>
                }
              </div>
              <p class="pista" style="margin-top:var(--sp-2)">Desmarque las que no se ofertan este periodo. Con todas marcadas, la oferta queda abierta.</p>
            </div>
          }
        </section>
      } @else {
        <div class="vacio"><strong>Aún no hay periodos</strong><br />Cree el primero con el botón «Crear periodo».</div>
      }
    </div>
  `,
})
export class PeriodosComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  readonly periodos = signal<Periodo[]>([]);
  /** Periodo elegido en la lista (por defecto, el vigente y activo, o el primero) y la pestaña de su configuración. */
  readonly seleccion = signal<string | null>(null);
  readonly actual = computed(() => {
    const lista = this.periodos();
    return lista.find((x) => x.codigo === this.seleccion()) ?? lista.find((x) => x.vigente && x.activo) ?? lista[0] ?? null;
  });
  readonly pestanas = [
    { clave: 'ventanas', texto: 'Ventanas habilitadas' }, { clave: 'cronograma', texto: 'Cronograma' }, { clave: 'modalidades', texto: 'Modalidades ofertadas' },
  ] as const;
  readonly pestana = signal<'ventanas' | 'cronograma' | 'modalidades'>('ventanas');
  elegir(codigo: string): void { this.seleccion.set(codigo); }
  /** Flechas, Inicio y Fin cambian de pestaña (patrón de pestañas del APG). */
  teclaPestana(e: KeyboardEvent): void {
    const claves = this.pestanas.map((t) => t.clave); const i = claves.indexOf(this.pestana());
    const siguiente = e.key === 'ArrowRight' ? (i + 1) % claves.length : e.key === 'ArrowLeft' ? (i - 1 + claves.length) % claves.length : e.key === 'Home' ? 0 : e.key === 'End' ? claves.length - 1 : -1;
    if (siguiente < 0) return;
    e.preventDefault(); this.pestana.set(claves[siguiente]);
    setTimeout(() => document.getElementById('pt-' + claves[siguiente])?.focus(), 0);
  }
  readonly modalidades = signal<ModalidadCatalogo[]>([]);
  readonly guardando = signal(false);
  readonly ventanas = VENTANAS;
  readonly n = { codigo: '', nombre: '', calendario: 'presencial', fechaInicio: '', fechaFin: '', cierreFur: '', fechaCargueDocumentos: '' };
  private readonly borrador = new Map<string, { desde?: string; hasta?: string }>();
  private readonly borradorCrono = new Map<string, { j1?: string; j2?: string; cargue?: string }>();

  async ngOnInit(): Promise<void> {
    void firstValueFrom(this.api.catalogoModalidades()).then((m) => this.modalidades.set(m)).catch(() => undefined);
    await this.cargar();
  }

  async cargar(): Promise<void> {
    try { this.periodos.set(await firstValueFrom(this.api.listarPeriodos())); } catch (error) { this.avisos.error(leerError(error)); }
  }

  fecha(p: Periodo, v: TipoVentana, campo: 'desde' | 'hasta', evento: Event): void {
    const clave = `${p.codigo}:${v}`;
    this.borrador.set(clave, { ...(this.borrador.get(clave) ?? {}), [campo]: (evento.target as HTMLInputElement).value });
  }

  async aplicarVentana(p: Periodo, v: TipoVentana): Promise<void> {
    const b = this.borrador.get(`${p.codigo}:${v}`) ?? {};
    const desde = b.desde ?? p.ventanas[v]?.desde; const hasta = b.hasta ?? p.ventanas[v]?.hasta;
    if (!desde || !hasta) { this.avisos.error('Indique desde y hasta para la ventana.'); return; }
    await this.guardar(p, { ventanas: { [v]: { desde, hasta } } });
  }

  async deshabilitarVentana(p: Periodo, v: TipoVentana): Promise<void> {
    await this.guardar(p, { ventanas: { [v]: null } });
  }

  jornada(p: Periodo, i: number): string { return p.cronograma.jornadasInduccion[i] ?? ''; }

  campoCrono(p: Periodo, campo: 'j1' | 'j2' | 'cargue', evento: Event): void {
    this.borradorCrono.set(p.codigo, { ...(this.borradorCrono.get(p.codigo) ?? {}), [campo]: (evento.target as HTMLInputElement).value });
  }

  async aplicarCronograma(p: Periodo): Promise<void> {
    const b = this.borradorCrono.get(p.codigo) ?? {};
    const j1 = b.j1 ?? p.cronograma.jornadasInduccion[0] ?? '';
    const j2 = b.j2 ?? p.cronograma.jornadasInduccion[1] ?? '';
    const cargue = b.cargue ?? p.cronograma.fechaCargueDocumentos ?? '';
    await this.guardar(p, { jornadasInduccion: [j1, j2].filter(Boolean), fechaCargueDocumentos: cargue || null });
    this.borradorCrono.delete(p.codigo);
  }

  async alternarModalidad(p: Periodo, modalidad: string): Promise<void> {
    const actuales = new Set(p.modalidadesOfertadas);
    if (actuales.has(modalidad)) actuales.delete(modalidad); else actuales.add(modalidad);
    const todas = this.modalidades().map((m) => m.modalidad);
    const lista = todas.filter((m) => actuales.has(m));
    await this.guardar(p, { modalidadesHabilitadas: lista.length === todas.length ? [] : lista });
  }

  async guardar(p: Periodo, cambios: Record<string, unknown>): Promise<void> {
    this.guardando.set(true);
    try { await firstValueFrom(this.api.actualizarPeriodo(p.codigo, cambios)); await this.cargar(); this.avisos.exito(`Periodo ${p.codigo} actualizado.`); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }

  async crear(): Promise<void> {
    this.guardando.set(true);
    try {
      const p = await firstValueFrom(this.api.crearPeriodo({ ...this.n, cierreFur: this.n.cierreFur || undefined, fechaCargueDocumentos: this.n.fechaCargueDocumentos || undefined }));
      await this.cargar(); this.avisos.exito(`Periodo ${p.codigo} creado.`); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }
}
