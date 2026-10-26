import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ConsultaAdresPreparada, EstadoAdres, FilaBandejaAdres, ResultadoAdres } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { leerError } from '@shared/utils/errores';

const ESTADOS: Record<EstadoAdres, string> = {
  no_requerido: 'No requerido',
  pendiente: 'Pendiente de ADRES',
  en_consulta: 'En consulta',
  evidencia_recibida: 'Resultado recibido',
  procesado: 'Procesado',
  error: 'Con error',
  no_determinable: 'No determinable',
};

const RECOMENDACIONES: Record<string, string> = {
  candidato_autoaprobacion: 'Candidato (solo etiqueta; decide una persona)',
  recomendar_revision_documental: 'Revisar el documento',
  recomendar_revision_rechazo: 'Revisar: posible rechazo',
  discrepancia_critica: 'Discrepancia crítica entre fuentes',
  pendiente_adres: 'Pendiente de ADRES',
  informacion_insuficiente: 'Información insuficiente',
};

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

const CAMPOS: Record<string, string> = {
  numero_documento: 'Número de documento', tipo_documento: 'Tipo de documento', nombre: 'Nombre', eps: 'EPS', regimen: 'Régimen', estado: 'Estado',
};

/**
 * Validación de EPS · consulta ADRES asistida (interfaz mínima de operación).
 *
 * La PERSONA consulta el portal oficial de ADRES en su propio navegador y resuelve
 * ella misma la verificación (CAPTCHA); aquí solo se prepara qué consultar, se
 * carga el resultado guardado como PDF y se ve la comparación. SIPRA no llama a ADRES.
 */
@Component({
  selector: 'sipra-eps',
  standalone: true,
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cab p { margin: 0; }
    .dos { display:grid; gap:var(--sp-4); grid-template-columns:1fr; margin-top:var(--sp-4); } @media (width >= 1000px) { .dos { grid-template-columns:1fr 1.2fr; align-items:start; } }
    .fila { display:flex; gap:var(--sp-3); align-items:center; padding:var(--sp-2) 0; border-bottom:1px solid var(--borde); font-size:var(--fs-sm); cursor:pointer; }
    .fila:last-child { border-bottom:0; } .fila:hover { background:var(--superficie-2); } .fila.sel { background:var(--marca-suave); }
    .fila .q { flex:1; min-width:0; } .fila .n { font-weight:600; }
    .datos { display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr)); font-size:var(--fs-sm); }
    .datos .k { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    .consulta { border-left:3px solid var(--marca); padding:var(--sp-2) var(--sp-3); background:var(--superficie-2); border-radius:0 var(--r-sm) var(--r-sm) 0; margin:var(--sp-3) 0; }
    .consulta .grande { font-size:var(--fs-lg, 1.25rem); font-weight:700; letter-spacing:.04em; }
    table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--borde); }
    tr.critico td { background:var(--peligro-suave, #fde8e8); } .pista-error { color:var(--peligro, #b42318); }
  `],
  template: `
    <div class="cab">
      <h1>Validación de EPS · contraste con ADRES</h1>
      <p class="pista">
        Para los certificados cuya afiliación no está contrastada. Usted consulta el portal oficial de ADRES, resuelve
        usted mismo la verificación (CAPTCHA) y carga aquí el resultado guardado como PDF. El resultado de ADRES contrasta la
        <strong>afiliación</strong>; no prueba que el certificado sea auténtico.
      </p>
    </div>

    <div class="dos">
      <section class="tarjeta">
        <h2>Casos pendientes</h2>
        @if (cargando()) { <p class="pista">Cargando…</p> }
        @else if (filas().length === 0) { <div class="vacio">No hay casos con la afiliación pendiente de contrastar.</div> }
        @for (f of filas(); track f.validacionId) {
          <div class="fila" [class.sel]="seleccion()?.validacionId === f.validacionId" (click)="seleccionar(f)" (keyup.enter)="seleccionar(f)" tabindex="0" role="button">
            <div class="q">
              <div class="n">{{ f.estudiante.nombre }} <span class="pista">· {{ f.estudiante.documentoEnmascarado }}</span></div>
              <div class="pista">{{ estadoEtiqueta(f.estadoAdres) }} · afiliación {{ f.afiliacion.replace('_', ' ') }} · {{ f.metodoValidacion === 'qr_oficial' ? 'verificada por fuente oficial' : 'sin verificar' }}</div>
            </div>
            @if (f.responsable) { <span class="etiqueta etiqueta--{{ esMio(f) ? 'ok' : 'neutra' }}">{{ esMio(f) ? 'Tomado por usted' : 'Tomado por otra persona' }}</span> }
          </div>
        }
        <div class="acciones"><button type="button" class="boton" (click)="cargar()" [disabled]="cargando()">Actualizar</button></div>
      </section>

      <section class="tarjeta">
        @if (seleccion(); as f) {
          <h2>{{ f.estudiante.nombre }}</h2>
          <div class="datos">
            <div><div class="k">Documento</div>{{ f.estudiante.documentoEnmascarado }}</div>
            <div><div class="k">Método</div>{{ f.metodoValidacion === 'qr_oficial' ? 'Fuente oficial (QR)' : 'Sin verificar' }}</div>
            <div><div class="k">Afiliación</div>{{ f.afiliacion.replace('_', ' ') }}</div>
            <div><div class="k">Estado ADRES</div>{{ estadoEtiqueta(f.estadoAdres) }}</div>
            <div><div class="k">Recomendación</div>{{ f.recomendacion ? recomendacion(f.recomendacion) : '—' }}</div>
            <div><div class="k">Responsable</div>{{ f.responsable ? (esMio(f) ? 'Usted' : 'Otra persona') : 'Nadie' }}@if (f.reservaHasta) { <span class="pista"> hasta {{ f.reservaHasta | date: 'HH:mm' }}</span> }</div>
          </div>

          <div class="acciones" style="margin-top:var(--sp-3)">
            @if (!f.responsable) { <button type="button" class="boton boton--primario" [disabled]="ocupado()" (click)="tomar(f)">Tomar el caso</button> }
            @if (esMio(f)) {
              <button type="button" class="boton" [disabled]="ocupado()" (click)="liberar(f)">Liberar</button>
              @if (puedeConsultar(f)) { <button type="button" class="boton boton--primario" [disabled]="ocupado()" (click)="preparar(f)">Consultar ADRES</button> }
              @if (f.estadoAdres === 'evidencia_recibida' || f.estadoAdres === 'error') { <button type="button" class="boton" [disabled]="ocupado()" (click)="reprocesar(f)">Reintentar el procesamiento</button> }
            }
          </div>
          @if (!esMio(f) && f.responsable) { <p class="pista">Este caso lo tiene otra persona; podrá tomarlo cuando venza su reserva.</p> }

          @if (pidiendoTipo(); as t) {
            <div class="consulta">
              <p><strong>SIPRA no conoce el tipo de documento de este estudiante.</strong> Confírmelo usted: no se deduce del número.</p>
              @if (t.sugerencia) { <p class="pista">El certificado menciona «{{ t.sugerencia }}», pero eso no es una fuente válida.</p> }
              <div class="campo"><label for="e-tipo">Tipo de documento</label>
                <select id="e-tipo" [(ngModel)]="tipoElegido"><option value="">Seleccione…</option>@for (o of t.opciones ?? []; track o) { <option [value]="o">{{ o }}</option> }</select></div>
              <button type="button" class="boton boton--primario" [disabled]="!tipoElegido || ocupado()" (click)="preparar(f, tipoElegido)">Confirmar y preparar</button>
            </div>
          }

          @if (consulta(); as c) {
            <div class="consulta">
              <p>Consulte en ADRES este documento:</p>
              <p class="grande">{{ c.tipoDocumento }} {{ c.numeroDocumento }}</p>
              <ol>@for (i of c.instrucciones ?? []; track i) { <li>{{ i }}</li> }</ol>
              <p><a class="boton boton--primario" [href]="c.portalUrl" target="_blank" rel="noopener noreferrer">Abrir el portal oficial de ADRES</a>
                <span class="pista"> · la consulta vence a las {{ c.venceEn | date: 'HH:mm' }}</span></p>
              <h3>Cargar el resultado</h3>
              <div class="campo"><label for="e-arch">Resultado de ADRES (PDF)</label><input id="e-arch" type="file" accept="application/pdf,.pdf" (change)="elegirArchivo($event)" /></div>
              <div class="campo"><label for="e-fecha">Fecha de la consulta (opcional)</label><input id="e-fecha" type="date" [(ngModel)]="fechaConsulta" /></div>
              <button type="button" class="boton boton--primario" [disabled]="!archivo() || ocupado()" (click)="subir(f, c)">Cargar y procesar</button>
            </div>
          }

          @if (resultado(); as r) {
            <h3>Resultado</h3>
            @if (r.error) { <p class="pista-error">{{ errorTexto(r.error) }}</p> }
            @if (r.duplicada) { <p class="pista">Este resultado ya estaba cargado: no se registró otra vez.</p> }
            <div class="datos">
              <div><div class="k">Estado ADRES</div>{{ estadoEtiqueta(r.estadoAdres) }}</div>
              <div><div class="k">Afiliación</div>{{ r.afiliacion.replace('_', ' ') }}</div>
              <div><div class="k">Recomendación</div>{{ r.recomendacion ? recomendacion(r.recomendacion) : '—' }}</div>
            </div>
            @if (r.comparacion.length) {
              <table>
                <thead><tr><th>Campo</th><th>SIPRA</th><th>Certificado</th><th>ADRES</th><th>Resultado</th></tr></thead>
                <tbody>
                  @for (c of r.comparacion; track c.campo) {
                    <tr [class.critico]="c.critico"><td>{{ campoEtiqueta(c.campo) }}</td><td>{{ c.sipra ?? '—' }}</td><td>{{ c.certificado ?? '—' }}</td><td>{{ c.adres ?? '—' }}</td><td>{{ c.resultado.replace('_', ' ') }}@if (c.critico) { · crítico }</td></tr>
                  }
                </tbody>
              </table>
            }
            <p class="pista">La decisión sobre el certificado sigue siendo de una persona; esta pantalla no aprueba nada.</p>
          }
        } @else {
          <div class="vacio">Seleccione un caso.</div>
        }
      </section>
    </div>
  `,
})
export class EpsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);

  readonly filas = signal<FilaBandejaAdres[]>([]);
  readonly cargando = signal(false);
  readonly ocupado = signal(false);
  readonly seleccionId = signal<string | null>(null);
  readonly seleccion = computed(() => this.filas().find((f) => f.validacionId === this.seleccionId()) ?? null);
  readonly consulta = signal<ConsultaAdresPreparada | null>(null);
  readonly pidiendoTipo = signal<ConsultaAdresPreparada | null>(null);
  readonly resultado = signal<ResultadoAdres | null>(null);
  readonly archivo = signal<File | null>(null);
  tipoElegido = '';
  fechaConsulta = '';

  async ngOnInit(): Promise<void> { await this.cargar(); }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try { this.filas.set(await firstValueFrom(this.api.bandejaAdres())); } catch (e) { this.avisos.error(leerError(e)); } finally { this.cargando.set(false); }
  }

  seleccionar(f: FilaBandejaAdres): void {
    this.seleccionId.set(f.validacionId);
    // La consulta preparada y el resultado son de UN caso: al cambiar de caso se descartan.
    this.consulta.set(null); this.pidiendoTipo.set(null); this.resultado.set(null); this.archivo.set(null); this.tipoElegido = ''; this.fechaConsulta = '';
  }

  esMio(f: FilaBandejaAdres): boolean { return f.responsable !== null && f.responsable === this.sesion.sesion()?.id; }
  puedeConsultar(f: FilaBandejaAdres): boolean { return ['pendiente', 'en_consulta', 'error', 'no_determinable'].includes(f.estadoAdres); }
  estadoEtiqueta(e: EstadoAdres): string { return ESTADOS[e] ?? e; }
  recomendacion(r: string): string { return RECOMENDACIONES[r] ?? r; }
  errorTexto(e: string): string { return ERRORES[e] ?? e; }
  campoEtiqueta(c: string): string { return CAMPOS[c] ?? c; }

  elegirArchivo(evento: Event): void {
    this.archivo.set((evento.target as HTMLInputElement).files?.[0] ?? null);
  }

  private async ejecutar(accion: () => Promise<void>): Promise<void> {
    this.ocupado.set(true);
    try { await accion(); } catch (e) { this.avisos.error(leerError(e)); } finally { this.ocupado.set(false); }
  }

  async tomar(f: FilaBandejaAdres): Promise<void> {
    await this.ejecutar(async () => { await firstValueFrom(this.api.tomarCasoEps(f.validacionId)); await this.cargar(); this.avisos.exito('Caso tomado.'); });
  }

  async liberar(f: FilaBandejaAdres): Promise<void> {
    await this.ejecutar(async () => { await firstValueFrom(this.api.liberarCasoEps(f.validacionId)); this.consulta.set(null); await this.cargar(); });
  }

  async preparar(f: FilaBandejaAdres, tipo?: string): Promise<void> {
    await this.ejecutar(async () => {
      const r = await firstValueFrom(this.api.prepararAdres(f.validacionId, tipo));
      if (r.estado === 'requiere_tipo_documento') { this.pidiendoTipo.set(r); this.consulta.set(null); return; }
      this.pidiendoTipo.set(null); this.consulta.set(r); this.resultado.set(null);
      await this.cargar();
    });
  }

  async subir(f: FilaBandejaAdres, c: ConsultaAdresPreparada): Promise<void> {
    const archivo = this.archivo();
    if (!archivo || !c.consultaId) return;
    await this.ejecutar(async () => {
      const formulario = new FormData();
      formulario.append('consultaId', c.consultaId as string);
      if (this.fechaConsulta) formulario.append('fechaConsulta', this.fechaConsulta);
      formulario.append('archivo', archivo);
      this.resultado.set(await firstValueFrom(this.api.cargarResultadoAdres(f.validacionId, formulario)));
      // El identificador de la consulta es de un solo uso: ya se consumió.
      this.consulta.set(null); this.archivo.set(null);
      await this.cargar();
    });
  }

  async reprocesar(f: FilaBandejaAdres): Promise<void> {
    await this.ejecutar(async () => { this.resultado.set(await firstValueFrom(this.api.procesarResultadoAdres(f.validacionId))); await this.cargar(); });
  }
}
