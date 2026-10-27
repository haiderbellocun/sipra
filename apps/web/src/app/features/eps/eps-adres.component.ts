import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ConsultaAdresPreparada, EstadoAdres, ResultadoAdres } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { ESTADO_ADRES, traducirErrorEps } from './eps.util';

const ERRORES: Record<string, string> = {
  pdf_ilegible: 'El PDF está dañado o no se pudo abrir.',
  sin_texto: 'El PDF no tiene texto legible (ni siquiera con OCR).',
  no_es_resultado_adres: 'El archivo no parece un resultado de ADRES.',
  documento_no_corresponde: 'El documento del resultado no es el del estudiante.',
  sin_documento_en_resultado: 'El resultado no trae el número de documento: no se puede atar al estudiante.',
  tipo_documento_no_corresponde: 'El tipo de documento del resultado no es el consultado.',
  nombre_no_corresponde: 'El nombre del resultado no corresponde al del estudiante.',
  archivo_no_disponible: 'El archivo cargado ya no está disponible.',
  lectura_fallida: 'No se pudo leer el resultado.',
};

/**
 * Consulta ADRES asistida dentro de la Mesa. La PERSONA abre el portal oficial en su
 * navegador, resuelve ella misma la verificación (CAPTCHA) y carga aquí el PDF guardado.
 * SIPRA no llama a ADRES. El resultado contrasta la afiliación; no prueba autenticidad.
 */
@Component({
  selector: 'sipra-eps-adres',
  standalone: true,
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .consulta { border-left:3px solid var(--marca); padding:var(--sp-2) var(--sp-3); background:var(--superficie-2); border-radius:0 var(--r-sm) var(--r-sm) 0; margin:var(--sp-3) 0; }
    .consulta .grande { font-size:var(--fs-lg, 1.25rem); font-weight:700; letter-spacing:.04em; }
    .error-texto { color:var(--peligro); }
  `],
  template: `
    <p>
      <span class="etiqueta etiqueta--icono etiqueta--{{ rotulo().tono }}"><span aria-hidden="true">{{ rotulo().icono }}</span> {{ rotulo().texto }}</span>
      @if (errorPrevio()) { <span class="error-texto"> · {{ errorTexto(errorPrevio()!) }}</span> }
    </p>

    @if (puedeConsultar()) {
      <div class="acciones">
        <button type="button" class="boton boton--primario" [disabled]="ocupado()" (click)="preparar()">Consultar ADRES</button>
        @if (estado() === 'evidencia_recibida' || estado() === 'error') {
          <button type="button" class="boton" [disabled]="ocupado()" (click)="reprocesar()">Reintentar el procesamiento</button>
        }
      </div>
    } @else {
      <p class="pista">Para consultar ADRES, tome el caso y espere a que su reserva esté vigente.</p>
    }

    @if (pidiendoTipo(); as t) {
      <div class="consulta">
        <p><strong>SIPRA no conoce el tipo de documento de este estudiante.</strong> Confírmelo usted: no se deduce del número.</p>
        @if (t.sugerencia) { <p class="pista">El certificado menciona «{{ t.sugerencia }}», pero eso no es una fuente válida.</p> }
        <div class="campo">
          <label for="a-tipo">Tipo de documento</label>
          <select id="a-tipo" [(ngModel)]="tipoElegido"><option value="">Seleccione…</option>@for (o of t.opciones ?? []; track o) { <option [value]="o">{{ o }}</option> }</select>
        </div>
        <button type="button" class="boton boton--primario" [disabled]="!tipoElegido || ocupado()" (click)="preparar(tipoElegido)">Confirmar y preparar</button>
      </div>
    }

    @if (consulta(); as c) {
      <div class="consulta">
        <p>Consulte en ADRES este documento:</p>
        <p class="grande">{{ c.tipoDocumento }} {{ c.numeroDocumento }}</p>
        <ol>@for (i of c.instrucciones ?? []; track i) { <li>{{ i }}</li> }</ol>
        <p>
          <a class="boton boton--primario" [href]="c.portalUrl" target="_blank" rel="noopener noreferrer">Abrir el portal oficial de ADRES</a>
          <span class="pista"> · la consulta vence a las {{ c.venceEn | date: 'HH:mm' }}</span>
        </p>
        <h4>Cargar el resultado</h4>
        <div class="campo"><label for="a-arch">Resultado de ADRES (PDF)</label><input id="a-arch" type="file" accept="application/pdf,.pdf" (change)="elegirArchivo($event)" /></div>
        <div class="campo"><label for="a-fecha">Fecha de la consulta (opcional)</label><input id="a-fecha" type="date" [(ngModel)]="fechaConsulta" /></div>
        <button type="button" class="boton boton--primario" [disabled]="!archivo() || ocupado()" (click)="subir(c)">Cargar y procesar</button>
      </div>
    }

    @if (resultado(); as r) {
      @if (r.error) { <p class="error-texto" role="alert">{{ errorTexto(r.error) }}</p> }
      @if (r.duplicada) { <p class="pista">Este resultado ya estaba cargado: no se registró otra vez.</p> }
    }
  `,
})
export class EpsAdresComponent {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  readonly validacionId = input.required<string>();
  readonly estado = input.required<EstadoAdres>();
  readonly errorPrevio = input<string | null>(null);
  readonly puedeConsultar = input<boolean>(false);
  /** Avisa que cambió algo en ADRES: la Mesa vuelve a pedir el detalle (comparación, recomendación). */
  readonly cambio = output<void>();

  readonly ocupado = signal(false);
  readonly consulta = signal<ConsultaAdresPreparada | null>(null);
  readonly pidiendoTipo = signal<ConsultaAdresPreparada | null>(null);
  readonly resultado = signal<ResultadoAdres | null>(null);
  readonly archivo = signal<File | null>(null);
  tipoElegido = '';
  fechaConsulta = '';

  constructor() {
    // La consulta preparada y el resultado son de UN caso: al cambiar de caso se descartan.
    effect(() => {
      this.validacionId();
      untracked(() => {
        this.consulta.set(null); this.pidiendoTipo.set(null); this.resultado.set(null); this.archivo.set(null);
        this.tipoElegido = ''; this.fechaConsulta = '';
      });
    });
  }

  rotulo() { return ESTADO_ADRES[this.estado()] ?? ESTADO_ADRES['no_determinable']; }
  errorTexto(e: string): string { return ERRORES[e] ?? 'No se pudo procesar el resultado.'; }

  elegirArchivo(evento: Event): void {
    this.archivo.set((evento.target as HTMLInputElement).files?.[0] ?? null);
  }

  private async ejecutar(accion: () => Promise<void>): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try { await accion(); } catch (e) { this.avisos.error(traducirErrorEps(e)); this.cambio.emit(); } finally { this.ocupado.set(false); }
  }

  async preparar(tipo?: string): Promise<void> {
    await this.ejecutar(async () => {
      const r = await firstValueFrom(this.api.prepararAdres(this.validacionId(), tipo));
      if (r.estado === 'requiere_tipo_documento') { this.pidiendoTipo.set(r); this.consulta.set(null); return; }
      this.pidiendoTipo.set(null); this.consulta.set(r); this.resultado.set(null);
      this.cambio.emit();
    });
  }

  async subir(c: ConsultaAdresPreparada): Promise<void> {
    const archivo = this.archivo();
    if (!archivo || !c.consultaId) return;
    await this.ejecutar(async () => {
      const formulario = new FormData();
      formulario.append('consultaId', c.consultaId as string);
      if (this.fechaConsulta) formulario.append('fechaConsulta', this.fechaConsulta);
      formulario.append('archivo', archivo);
      this.resultado.set(await firstValueFrom(this.api.cargarResultadoAdres(this.validacionId(), formulario)));
      // El identificador de la consulta es de un solo uso: ya se consumió.
      this.consulta.set(null); this.archivo.set(null);
      this.cambio.emit();
    });
  }

  async reprocesar(): Promise<void> {
    await this.ejecutar(async () => {
      this.resultado.set(await firstValueFrom(this.api.procesarResultadoAdres(this.validacionId())));
      this.cambio.emit();
    });
  }
}
