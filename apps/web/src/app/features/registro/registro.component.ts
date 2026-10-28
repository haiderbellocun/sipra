import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { Carta, ModalidadCatalogo, Periodo, RegistroFur } from '@core/models/modelos';
import { CronogramaComponent } from '@shared/components/cronograma.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';

/**
 * Pasos 1 y 2 del estudiante en el SGP: la carta de presentación y el
 * Formulario Único de Registro. Coordinación llega aquí para el registro FUR
 * administrativo y para generar cartas por documento del estudiante.
 */
@Component({
  selector: 'sipra-registro',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, EtiquetaPipe, CronogramaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .pasos { display: grid; gap: var(--sp-4); grid-template-columns: 1fr; align-items: start; }
    @media (width >= 1100px) { .pasos { grid-template-columns: 1fr 1.6fr; } }
    .paso-n { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--marca); color: var(--marca-contraste); font-size: var(--fs-xs); font-weight: 700; margin-right: var(--sp-2); }
    .rej { display: grid; gap: 0 var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); }
    .rej .ancho { grid-column: 1 / -1; }
    .modal-desc { font-size: var(--fs-sm); color: var(--texto-tenue); margin: var(--sp-1) 0 var(--sp-3); }
    .momentos { display: grid; gap: var(--sp-2); grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); margin: var(--sp-2) 0 var(--sp-3); }
    .momento { border: 1px solid var(--borde); border-radius: var(--r-sm); padding: var(--sp-2) var(--sp-3); font-size: var(--fs-xs); background: var(--superficie-2); }
    .momento strong { display: block; margin-bottom: 2px; font-size: var(--fs-xs); }
    .momento ul { margin: 0; padding-left: 1.1em; }
    .cond { font-size: var(--fs-xs); color: var(--texto-tenue); padding-left: 1.1em; margin: 0 0 var(--sp-3); }
    .terminos { display: flex; gap: var(--sp-2); align-items: flex-start; font-size: var(--fs-sm); margin: var(--sp-3) 0; }
    .terminos input { width: 18px; height: 18px; margin-top: 3px; }
    .carta { display: flex; gap: var(--sp-3); align-items: center; padding: var(--sp-2) 0; border-bottom: 1px solid var(--borde); font-size: var(--fs-sm); }
    .carta:last-child { border-bottom: none; }
    .carta .q { flex: 1; min-width: 0; }
    .ventana { font-size: var(--fs-xs); }
  `],
  template: `
    @if (registrada(); as r) {
      <div class="aviso aviso--ok" style="margin-bottom:var(--sp-4)">Práctica registrada. <a [routerLink]="['/practicas', r]">Ir al expediente</a></div>
    }

    <div class="pasos">
      <!-- ── Paso 1 · Carta de presentación ─────────────────────────────── -->
      <section class="tarjeta">
        <h2><span class="paso-n">1</span>Carta de presentación</h2>
        <p class="pista">
          Presenta al estudiante ante la organización antes del registro. Disponible desde un mes antes del
          periodo hasta el cierre del registro FUR; el docente y coordinación la generan en cualquier momento.
        </p>
        @if (!esEstudiante()) {
          <div class="campo">
            <label for="c-doc">Documento del estudiante</label>
            <input id="c-doc" [(ngModel)]="cartaDocumento" placeholder="Número de identificación" />
          </div>
        }
        <div class="campo">
          <label for="c-periodo">Periodo académico</label>
          <select id="c-periodo" [(ngModel)]="cartaPeriodo">
            @for (p of periodos(); track p.codigo) {
              <option [value]="p.codigo">{{ p.codigo }} · {{ p.nombre }}{{ p.abiertas.carta_presentacion ? '' : ' (ventana cerrada)' }}</option>
            }
          </select>
        </div>
        <div class="campo">
          <label for="c-empresa">Organización (opcional)</label>
          <input id="c-empresa" [(ngModel)]="cartaEmpresa" placeholder="En blanco: «A quien corresponda»" />
        </div>
        <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando() || !cartaPeriodo()" (click)="generarCarta()">
          Generar carta
        </button>

        @if (cartas().length > 0) {
          <h3 style="margin-top:var(--sp-5)">Cartas generadas</h3>
          @for (c of cartas(); track c.id) {
            <div class="carta">
              <div class="q">
                <strong>{{ c.estudianteNombre }}</strong>
                <div class="pista">{{ c.periodoAcademico }} · {{ c.modalidadCarta === 'abierta' ? 'A quien corresponda' : c.empresaRazonSocial }}
                  · {{ c.generadaEn | date: 'd MMM y, HH:mm' }}{{ c.numeroFur ? ' · FUR ' + c.numeroFur : '' }}</div>
              </div>
              <a class="boton compacto" [href]="api.urlCartaPdf(c.id)" target="_blank" rel="noopener" (click)="abrirPdf($event, c)">PDF</a>
            </div>
          }
        }
      </section>

      <!-- ── Paso 2 · Formulario Único de Registro ──────────────────────── -->
      <section class="tarjeta">
        <h2><span class="paso-n">2</span>{{ esEstudiante() ? 'Registrar mi práctica' : 'Registro FUR administrativo' }}</h2>
        <p class="pista">
          Diligéncielo solo cuando tenga definida la modalidad y la organización. La modalidad y las fechas
          <strong>no se modifican</strong> después de registrar; los datos de la vacante sí.
        </p>

        <form (ngSubmit)="registrar()" #formulario="ngForm">
          <p class="pista" style="margin:0 0 var(--sp-3)">Todos los campos son obligatorios, salvo los marcados como opcionales.</p>
          <div class="rej">
            @if (!esEstudiante()) {
              <div class="campo">
                <label for="r-doc">Documento del estudiante</label>
                <input id="r-doc" name="estudianteDocumento" [(ngModel)]="fur.estudianteDocumento" required />
              </div>
            }
            <div class="campo">
              <label for="r-periodo">Periodo académico</label>
              <select id="r-periodo" name="periodoAcademico" [ngModel]="fur.periodoAcademico"
                      (ngModelChange)="fur.periodoAcademico = $event; periodoSeleccionado.set($event)" required>
                @for (p of periodos(); track p.codigo) {
                  <option [value]="p.codigo">{{ p.codigo }} · {{ p.nombre }}</option>
                }
              </select>
              @if (periodoElegido(); as p) {
                <span class="ventana" [class.tenue]="p.abiertas.registro_fur" [style.color]="p.abiertas.registro_fur ? null : 'var(--peligro)'">
                  Registro FUR {{ p.abiertas.registro_fur ? 'abierto' : 'cerrado' }}
                  @if (p.ventanas.registro_fur; as v) { ({{ v.desde }} a {{ v.hasta }}) }
                </span>
                <details style="margin-top:var(--sp-2)"><summary class="pista" style="cursor:pointer">Ver el cronograma del periodo {{ p.codigo }}</summary>
                  <div style="margin-top:var(--sp-2)"><sipra-cronograma [periodo]="p" /></div></details>
              }
            </div>
            <div class="campo">
              <label for="r-modalidad">Modalidad de práctica</label>
              <select id="r-modalidad" name="modalidad" [ngModel]="fur.modalidad"
                      (ngModelChange)="fur.modalidad = $event; modalidadSeleccionada.set($event)" required>
                <option value="">Seleccione…</option>
                @for (m of modalidadesOfertadas(); track m.modalidad) {
                  <option [value]="m.modalidad">{{ m.etiquetaSgp }}</option>
                }
              </select>
            </div>
          </div>

          @if (modalidadElegida(); as m) {
            <p class="modal-desc">{{ m.descripcion }}
              @if (m.solicitudArl === 'si') { <strong>La CUN afilia a la ARL:</strong> después de registrar, radique la solicitud en «Solicitud de ARL». }
              @else if (m.solicitudArl === 'no') { La ARL la asume la organización receptora. }
            </p>
            <div class="momentos">
              @for (b of m.documentosPorMomento; track b.momento) {
                <div class="momento">
                  <strong>{{ b.etiqueta }}</strong>
                  <ul>@for (d of b.documentos; track d) { <li>{{ d | etiqueta }}</li> }</ul>
                </div>
              }
            </div>
            @if (m.condicionesAdicionales.length > 0) {
              <ul class="cond">@for (c of m.condicionesAdicionales; track c) { <li>{{ c }}</li> }</ul>
            }
          }

          <h3>Organización</h3>
          <div class="rej">
            <div class="campo"><label for="r-razon">Razón social</label><input id="r-razon" name="empresaRazonSocial" [(ngModel)]="fur.empresaRazonSocial" required minlength="3" /></div>
            <div class="campo"><label for="r-nit">NIT o identificador</label><input id="r-nit" name="empresaNit" [(ngModel)]="fur.empresaNit" required placeholder="Alfanumérico si es extranjera" /></div>
            <div class="campo"><label for="r-ciudad">Ciudad</label><input id="r-ciudad" name="ciudad" [(ngModel)]="fur.ciudad" required /></div>
          </div>

          <h3>Datos de la práctica</h3>
          <div class="rej">
            <div class="campo"><label for="r-area">Área</label><input id="r-area" name="area" [(ngModel)]="fur.area" required /></div>
            <div class="campo"><label for="r-cargo">Cargo</label><input id="r-cargo" name="cargo" [(ngModel)]="fur.cargo" required /></div>
            <div class="campo">
              <label for="r-rem">Remuneración</label>
              <select id="r-rem" name="tipoRemuneracion" [(ngModel)]="fur.tipoRemuneracion" required>
                <option value="remunerada">Remunerada</option><option value="no_remunerada">No remunerada</option>
              </select>
            </div>
            @if (fur.tipoRemuneracion === 'remunerada') {
              <div class="campo"><label for="r-salario">Salario o apoyo (COP)</label><input id="r-salario" name="salario" type="number" min="0" [(ngModel)]="fur.salario" /></div>
            }
            <div class="campo"><label for="r-horario">Horario</label><input id="r-horario" name="horario" [(ngModel)]="fur.horario" required placeholder="Lunes a viernes, 8:00 a 17:00" /></div>
          </div>

          <h3>Fechas</h3>
          <div class="rej">
            <div class="campo"><label for="r-inicio">Fecha de inicio</label><input id="r-inicio" name="fechaInicio" type="date" [(ngModel)]="fur.fechaInicio" required aria-describedby="r-fechas-ayuda" /></div>
            <div class="campo"><label for="r-fin">Fecha de finalización</label><input id="r-fin" name="fechaFin" type="date" [(ngModel)]="fur.fechaFin" required aria-describedby="r-fechas-ayuda" /></div>
          </div>
          <p class="pista" id="r-fechas-ayuda">Las fechas van dentro del periodo y no pueden caer en sábado ni domingo.</p>

          <h3>Funciones</h3>
          <div class="campo ancho"><label for="r-func">Funciones relevantes</label><textarea id="r-func" name="funcionesRelevantes" [(ngModel)]="fur.funcionesRelevantes" required minlength="20" aria-describedby="r-func-ayuda"></textarea>
            <span class="pista" id="r-func-ayuda">Describa en pocas líneas qué hará (mínimo 20 caracteres).</span></div>

          <h3>Jefe inmediato</h3>
          <div class="rej">
            <div class="campo"><label for="r-jn">Nombre</label><input id="r-jn" name="jefeInmediatoNombre" [(ngModel)]="fur.jefeInmediatoNombre" required /></div>
            <div class="campo"><label for="r-jc">Cargo</label><input id="r-jc" name="jefeInmediatoCargo" [(ngModel)]="fur.jefeInmediatoCargo" required /></div>
            <div class="campo"><label for="r-je">Correo</label><input id="r-je" name="jefeInmediatoCorreo" type="email" [(ngModel)]="fur.jefeInmediatoCorreo" required /></div>
            <div class="campo"><label for="r-jt">Teléfono</label><input id="r-jt" name="jefeInmediatoTelefono" [(ngModel)]="fur.jefeInmediatoTelefono" required /></div>
          </div>

          <label class="terminos">
            <input type="checkbox" name="aceptaTerminos" [(ngModel)]="fur.aceptaTerminos" required />
            <span>Acepto los términos y condiciones del proceso de prácticas: la información es veraz, los documentos se cargan
              en PDF sin contraseña, las firmas son manuscritas o digitales, y la modalidad y las fechas quedan fijas al registrar.</span>
          </label>

          @if (faltantes(formulario); as falta) {
            @if (falta.length > 0) { <p class="pista" role="status" style="margin:0 0 var(--sp-2)">Para registrar falta completar: {{ falta.join(', ') }}.</p> }
          }
          <div class="acciones">
            <button type="submit" class="boton boton--primario" [disabled]="formulario.invalid || guardando()">
              {{ guardando() ? 'Registrando…' : 'Registrar la práctica' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  `,
})
export class RegistroComponent implements OnInit {
  readonly sesion = inject(SesionService);
  readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly router = inject(Router);

  readonly periodos = signal<Periodo[]>([]);
  readonly modalidades = signal<ModalidadCatalogo[]>([]);
  readonly cartas = signal<Carta[]>([]);
  readonly guardando = signal(false);
  readonly registrada = signal<string | null>(null);

  readonly cartaPeriodo = signal('');
  readonly cartaEmpresa = signal('');
  readonly cartaDocumento = signal('');

  readonly esEstudiante = computed(() => this.sesion.rol() === 'estudiante');

  readonly fur: RegistroFur & { periodoAcademico: string } = {
    periodoAcademico: '', modalidad: '', empresaRazonSocial: '', empresaNit: '', area: '', cargo: '',
    tipoRemuneracion: 'no_remunerada', salario: undefined, horario: '', jefeInmediatoNombre: '', jefeInmediatoCargo: '',
    jefeInmediatoCorreo: '', jefeInmediatoTelefono: '', ciudad: '', funcionesRelevantes: '', fechaInicio: '', fechaFin: '',
    aceptaTerminos: false, estudianteDocumento: undefined,
  };
  /** Espejo en signals de lo que ngModel escribe en `fur`, para los cómputos. */
  readonly periodoSeleccionado = signal('');
  readonly modalidadSeleccionada = signal('');

  readonly periodoElegido = computed(() => this.periodos().find((p) => p.codigo === this.periodoSeleccionado()) ?? null);
  readonly modalidadesOfertadas = computed(() => {
    const p = this.periodoElegido();
    return this.modalidades().filter((m) => !p || p.modalidadesOfertadas.includes(m.modalidad));
  });
  readonly modalidadElegida = computed(() => this.modalidades().find((m) => m.modalidad === this.modalidadSeleccionada()) ?? null);

  async ngOnInit(): Promise<void> {
    const [periodos, modalidades] = await Promise.all([
      firstValueFrom(this.api.listarPeriodos()).catch(() => [] as Periodo[]),
      firstValueFrom(this.api.catalogoModalidades()).catch(() => [] as ModalidadCatalogo[]),
    ]);
    this.periodos.set(periodos.filter((p) => p.activo && p.vigente));
    this.modalidades.set(modalidades);
    const hoy = new Date().toISOString().slice(0, 10);
    const abierto = this.periodos().find((p) => p.abiertas.registro_fur)
      ?? this.periodos().find((p) => p.fechaInicio <= hoy && hoy <= p.fechaFin)
      ?? this.periodos()[0];
    if (abierto) {
      this.fur.periodoAcademico = abierto.codigo;
      this.periodoSeleccionado.set(abierto.codigo);
      this.cartaPeriodo.set((this.periodos().find((p) => p.abiertas.carta_presentacion) ?? abierto).codigo);
    }
    await this.cargarCartas();
  }

  async generarCarta(): Promise<void> {
    await this.ejecutar(async () => {
      await firstValueFrom(this.api.generarCarta({
        periodoAcademico: this.cartaPeriodo(),
        empresaRazonSocial: this.cartaEmpresa().trim() || undefined,
        estudianteDocumento: this.esEstudiante() ? undefined : this.cartaDocumento().trim() || undefined,
      }));
      await this.cargarCartas();
      return 'Carta generada. Puede descargarla en PDF cuantas veces necesite: siempre sale idéntica.';
    });
  }

  /** Etiquetas de los campos del formulario que todavía no están completos: dice qué falta en lugar de dejar el botón apagado sin explicación. */
  faltantes(f: NgForm): string[] {
    const etiquetas: Record<string, string> = {
      estudianteDocumento: 'Documento del estudiante', periodoAcademico: 'Periodo académico', modalidad: 'Modalidad', empresaRazonSocial: 'Razón social',
      empresaNit: 'NIT', ciudad: 'Ciudad', area: 'Área', cargo: 'Cargo', tipoRemuneracion: 'Remuneración', horario: 'Horario', fechaInicio: 'Fecha de inicio',
      fechaFin: 'Fecha de finalización', funcionesRelevantes: 'Funciones relevantes', jefeInmediatoNombre: 'Jefe inmediato: nombre',
      jefeInmediatoCargo: 'Jefe inmediato: cargo', jefeInmediatoCorreo: 'Jefe inmediato: correo', jefeInmediatoTelefono: 'Jefe inmediato: teléfono',
      aceptaTerminos: 'Aceptar los términos',
    };
    return Object.entries(f?.controls ?? {}).filter(([, c]) => c.invalid).map(([n]) => etiquetas[n] ?? n);
  }

  async registrar(): Promise<void> {
    await this.ejecutar(async () => {
      const practica = await firstValueFrom(this.api.registrarPractica({
        ...this.fur,
        salario: this.fur.tipoRemuneracion === 'remunerada' ? this.fur.salario : undefined,
        estudianteDocumento: this.esEstudiante() ? undefined : this.fur.estudianteDocumento,
      }));
      this.registrada.set(practica.id);
      if (this.esEstudiante()) setTimeout(() => void this.router.navigate(['/practicas', practica.id]), 1500);
      return `Registro creado con el FUR n.º ${practica.numeroFur ?? '—'}. Le enviamos al correo la lista de documentos por momento.`;
    });
  }

  async abrirPdf(evento: Event, carta: Carta): Promise<void> {
    evento.preventDefault();
    const blob = await firstValueFrom(this.api.descargarCartaPdf(carta.id));
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private async cargarCartas(): Promise<void> {
    try { this.cartas.set(await firstValueFrom(this.api.listarCartas())); } catch { this.cartas.set([]); }
  }

  private async ejecutar(accion: () => Promise<string>): Promise<void> {
    this.guardando.set(true);
    try {
      this.avisos.exito(await accion());
    } catch (error) {
      this.avisos.error(leerError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
