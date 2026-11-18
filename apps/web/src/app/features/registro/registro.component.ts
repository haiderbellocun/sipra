import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { ModalidadCatalogo, Periodo, RegistroFur } from '@core/models/modelos';
import { CronogramaComponent } from '@shared/components/cronograma.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';
import {
  ResponsableArl, ResponsableArlFormulario, ERROR_ARL_SIN_ELEGIR, ayudaArl, sugerenciaArl,
} from './arl-registro';
import { AperturaAvisoArl } from './aviso-arl';
import { CartaPresentacionComponent } from './carta-presentacion.component';
import { AvisoArlComponent } from './aviso-arl.component';

/**
 * Pasos 1 y 2 del estudiante en el SGP: la carta de presentación y el
 * Formulario Único de Registro. Coordinación llega aquí para el registro FUR
 * administrativo y para generar cartas por documento del estudiante.
 */
@Component({
  selector: 'sipra-registro',
  standalone: true,
  imports: [FormsModule, RouterLink, EtiquetaPipe, CronogramaComponent, AvisoArlComponent, CartaPresentacionComponent],
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
    /* G3 · acceso discreto al aviso de ARL junto a la pregunta. */
    .info-arl { display:inline-flex; align-items:center; gap:6px; margin:2px 0 var(--sp-2); padding:4px 2px; min-height:32px; font:inherit; font-size:var(--fs-xs); font-weight:600; color:var(--marca); background:none; border:0; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
    .info-arl svg { width:16px; height:16px; flex:none; } .info-arl:focus-visible { outline:2px solid var(--marca); outline-offset:2px; border-radius:4px; }
    .terminos input { width: 18px; height: 18px; margin-top: 3px; }
    .ventana { font-size: var(--fs-xs); }
    .grupo { border: 0; padding: 0; margin: 0 0 var(--sp-4); min-width: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
    .grupo legend { padding: 0; margin-bottom: var(--sp-2); font-size: var(--fs-sm); font-weight: 700; color: var(--texto); }
    .opciones { display: flex; flex-wrap: wrap; gap: 0 var(--sp-5); }
    .opcion { display: inline-flex; align-items: center; gap: var(--sp-2); min-height: 44px; cursor: pointer; font-size: var(--fs-base); }
    .opcion input { width: 20px; height: 20px; margin: 0; accent-color: var(--marca); }
    .opcion:has(input:focus-visible) { outline: 2px solid var(--marca); outline-offset: 2px; border-radius: var(--r-sm); }
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
          Presenta al estudiante ante la organización con un PDF institucional verificable (referencia y QR). El estudiante la
          genera dentro de la ventana del periodo; el docente, el auxiliar y coordinación, en cualquier momento.
        </p>
        <sipra-carta-presentacion [periodos]="periodos()" />
      </section>

      <!-- ── Paso 2 · Formulario Único de Registro ──────────────────────── -->
      <section class="tarjeta">
        <h2><span class="paso-n">2</span>{{ esEstudiante() ? 'Registrar mi práctica' : 'Registro FUR administrativo' }}</h2>
        <p class="pista">
          Diligéncielo solo cuando tenga definida la modalidad y la organización. La modalidad y las fechas
          <strong>no se modifican</strong> después de registrar; los datos de la vacante sí.
        </p>

        <sipra-aviso-arl />
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
            <fieldset #grupoArl class="grupo" (focusin)="llegarASeccionArl()" [attr.aria-describedby]="mostrarErrorArl() ? 'r-arl-ayuda r-arl-error' : 'r-arl-ayuda'" [attr.aria-invalid]="mostrarErrorArl() ? 'true' : null">
              <legend>¿Quién asume la ARL?</legend>
              <button #infoArl type="button" class="info-arl" aria-haspopup="dialog" (click)="avisoArl().abrir(infoArl)"><svg aria-hidden="true"><use href="#sipra-seguridad" /></svg>Información sobre ARL</button>
              <div class="opciones">
                <label class="opcion"><input type="radio" name="responsableArl" value="empresa" [ngModel]="fur.responsableArl" (ngModelChange)="elegirArl($event)" (blur)="tocarArl()" required /> Empresa</label>
                <label class="opcion"><input type="radio" name="responsableArl" value="cun" [ngModel]="fur.responsableArl" (ngModelChange)="elegirArl($event)" (blur)="tocarArl()" required /> CUN</label>
              </div>
              <span class="pista" id="r-arl-ayuda">{{ ayudaArl() }}</span>
              @if (mostrarErrorArl()) { <span class="error-campo" id="r-arl-error" role="alert" style="color:var(--peligro);font-size:var(--fs-sm)">{{ errorArl }}</span> }
            </fieldset>
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
export class RegistroComponent implements OnInit, AfterViewInit {
  readonly sesion = inject(SesionService);
  readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly router = inject(Router);

  readonly periodos = signal<Periodo[]>([]);
  readonly modalidades = signal<ModalidadCatalogo[]>([]);
  readonly guardando = signal(false);
  readonly registrada = signal<string | null>(null);


  readonly esEstudiante = computed(() => this.sesion.rol() === 'estudiante');

  readonly fur: Omit<RegistroFur, 'responsableArl'> & { periodoAcademico: string; responsableArl: ResponsableArlFormulario } = {
    periodoAcademico: '', modalidad: '', empresaRazonSocial: '', empresaNit: '', area: '', cargo: '',
    tipoRemuneracion: 'no_remunerada', responsableArl: '', salario: undefined, horario: '', jefeInmediatoNombre: '', jefeInmediatoCargo: '',
    jefeInmediatoCorreo: '', jefeInmediatoTelefono: '', ciudad: '', funcionesRelevantes: '', fechaInicio: '', fechaFin: '',
    aceptaTerminos: false, estudianteDocumento: undefined,
  };
  /** Espejo en signals de lo que ngModel escribe en `fur`, para los cómputos. */
  readonly periodoSeleccionado = signal('');
  readonly modalidadSeleccionada = signal('');
  /** Espejo del radio «¿Quién asume la ARL?». La modalidad no lo marca nunca: solo la persona lo elige. */
  readonly arlSeleccionada = signal<ResponsableArlFormulario>('');
  /** La persona pasó por el grupo sin elegir: recién entonces se muestra el error (no antes de que lo haya visto). */
  readonly arlTocada = signal(false);
  readonly errorArl = ERROR_ARL_SIN_ELEGIR;
  readonly mostrarErrorArl = computed(() => this.arlTocada() && this.arlSeleccionada() === '');

  readonly periodoElegido = computed(() => this.periodos().find((p) => p.codigo === this.periodoSeleccionado()) ?? null);
  readonly modalidadesOfertadas = computed(() => {
    const p = this.periodoElegido();
    return this.modalidades().filter((m) => !p || p.modalidadesOfertadas.includes(m.modalidad));
  });
  readonly modalidadElegida = computed(() => this.modalidades().find((m) => m.modalidad === this.modalidadSeleccionada()) ?? null);

  readonly sugerenciaArl = computed(() => sugerenciaArl(this.modalidadElegida()?.responsableArl));
  readonly ayudaArl = computed(() => ayudaArl(this.modalidadElegida() !== null, this.sugerenciaArl(), this.arlSeleccionada()));

  // ── G3 · aviso institucional sobre la ARL (informativo; no cambia el registro ni su envío) ──
  readonly avisoArl = viewChild.required(AvisoArlComponent);
  private readonly grupoArl = viewChild<ElementRef<HTMLFieldSetElement>>('grupoArl');
  private readonly infoArl = viewChild<ElementRef<HTMLButtonElement>>('infoArl');
  private readonly destruir = inject(DestroyRef);
  /** Una vez por instancia del formulario y solo para el estudiante. */
  private readonly aperturaArl = new AperturaAvisoArl(this.sesion.rol());

  /** El estudiante llegó a «¿Quién asume la ARL?» (la vio o la enfocó): el aviso se abre solo, una vez. */
  llegarASeccionArl(): void {
    if (this.aperturaArl.alLlegarASeccion()) this.avisoArl().abrir(this.infoArl()?.nativeElement ?? null);
  }

  ngAfterViewInit(): void {
    const grupo = this.grupoArl()?.nativeElement;
    if (!grupo || this.sesion.rol() !== 'estudiante' || typeof IntersectionObserver === 'undefined') return;
    // Si la sección ya se ve al cargar, eso no es «llegar»: se espera a que el estudiante la recorra
    // (desplazándose hasta ella) o la enfoque. Así el aviso nunca aparece apenas se abre la pantalla.
    let lecturaInicial = true;
    const observador = new IntersectionObserver((entradas) => {
      const visible = entradas.some((e) => e.isIntersecting);
      if (lecturaInicial) { lecturaInicial = false; if (visible) return; }
      if (visible) { observador.disconnect(); this.llegarASeccionArl(); }
    }, { threshold: 0.6 });
    observador.observe(grupo);
    this.destruir.onDestroy(() => observador.disconnect());
  }

  /**
   * El grupo cuenta como «tocado» al salir de él sin elegir (y entonces se ve el error). Si la salida es porque se
   * abrió el aviso de ARL (el foco pasa al diálogo), no cuenta: el estudiante aún no tuvo oportunidad de elegir.
   */
  tocarArl(): void {
    if (this.avisoArl().abierto) return;
    this.arlTocada.set(true);
  }

  elegirArl(valor: ResponsableArlFormulario): void {
    this.fur.responsableArl = valor;
    this.arlSeleccionada.set(valor);
  }

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
    }
  }

  /** Etiquetas de los campos del formulario que todavía no están completos: dice qué falta en lugar de dejar el botón apagado sin explicación. */
  faltantes(f: NgForm): string[] {
    const etiquetas: Record<string, string> = {
      estudianteDocumento: 'Documento del estudiante', periodoAcademico: 'Periodo académico', modalidad: 'Modalidad', empresaRazonSocial: 'Razón social',
      empresaNit: 'NIT', ciudad: 'Ciudad', area: 'Área', cargo: 'Cargo', tipoRemuneracion: 'Remuneración', responsableArl: '¿Quién asume la ARL?', horario: 'Horario', fechaInicio: 'Fecha de inicio',
      fechaFin: 'Fecha de finalización', funcionesRelevantes: 'Funciones relevantes', jefeInmediatoNombre: 'Jefe inmediato: nombre',
      jefeInmediatoCargo: 'Jefe inmediato: cargo', jefeInmediatoCorreo: 'Jefe inmediato: correo', jefeInmediatoTelefono: 'Jefe inmediato: teléfono',
      aceptaTerminos: 'Aceptar los términos',
    };
    return Object.entries(f?.controls ?? {}).filter(([, c]) => c.invalid).map(([n]) => etiquetas[n] ?? n);
  }

  async registrar(): Promise<void> {
    await this.ejecutar(async () => {
      // El formulario es inválido mientras no haya una opción marcada, así que aquí siempre hay valor.
      const practica = await firstValueFrom(this.api.registrarPractica({
        ...this.fur,
        responsableArl: this.fur.responsableArl as ResponsableArl,
        salario: this.fur.tipoRemuneracion === 'remunerada' ? this.fur.salario : undefined,
        estudianteDocumento: this.esEstudiante() ? undefined : this.fur.estudianteDocumento,
      }));
      this.registrada.set(practica.id);
      if (this.esEstudiante()) setTimeout(() => void this.router.navigate(['/practicas', practica.id]), 1500);
      return `Registro creado con el FUR n.º ${practica.numeroFur ?? '—'}. Le enviamos al correo la lista de documentos por momento.`;
    });
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
