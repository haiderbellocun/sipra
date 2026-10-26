import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import {
  ComparativaModeloIa, ConfiguracionIa, EstimacionIa, RecomendacionModeloIa, ResumenGastoIa, TarifaIa,
} from '@core/models/modelos';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';
import { formatearCop, formatearEntero, formatearUsd } from '@shared/utils/moneda';

const TONO_RECOMENDACION: Record<RecomendacionModeloIa, 'ok' | 'info' | 'aviso' | 'neutra'> = {
  principal: 'ok', alternativa: 'info', escalamiento: 'aviso', no_recomendado: 'neutra',
};

/**
 * Costos de la lectura asistida: gasto real registrado por el pipeline,
 * estimación por estudiante y modalidad, comparativa de modelos y tarifas
 * vigentes. Lo consultan administración y coordinación. Toda cifra en USD se
 * acompaña de su conversión a pesos con la TRM que la persona indique.
 */
@Component({
  selector: 'sipra-costos-ia',
  standalone: true,
  imports: [EsqueletoComponent, FormsModule, DatePipe, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .barra { display:flex; gap:var(--sp-3); align-items:flex-end; flex-wrap:wrap; margin-bottom:var(--sp-4); }
    .barra .campo { margin:0; min-width:170px; flex:1 1 170px; max-width:260px; }
    .config { display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap; margin-bottom:var(--sp-4); font-size:var(--fs-sm); }
    .cifras { display:grid; gap:var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); margin-bottom:var(--sp-4); }
    .cifra { padding:var(--sp-3) var(--sp-4); display:grid; gap:2px; }
    .cifra .n { font-size:clamp(1.3rem,3.2vw,1.7rem); font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
    .cifra .t { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    .tope { height:6px; border-radius:3px; background:var(--superficie-2); overflow:hidden; margin-top:var(--sp-1); }
    .tope span { display:block; height:100%; background:var(--ok); transition:width var(--dur-5) var(--ease-out); }
    .tope.alto span { background:var(--aviso); } .tope.lleno span { background:var(--peligro); }
    .seccion { margin-bottom:var(--sp-5); }
    .seccion > h2 { margin-bottom:var(--sp-1); }
    .seccion > .pista { margin-bottom:var(--sp-3); max-width:80ch; }
    .cop { display:block; font-size:var(--fs-xs); color:var(--texto-tenue); font-variant-numeric:tabular-nums; }
    .tabla tfoot td { font-weight:700; border-top:2px solid var(--borde); background:var(--superficie-2); }
    .tabla tr.actual td { background:var(--marca-suave); }
    .tabla tr.actual td:first-child { box-shadow:inset 3px 0 0 var(--marca); }
    .tabla tr.detalle td { background:var(--superficie-2); padding:var(--sp-2) var(--sp-4) var(--sp-3); }
    .tabla tr.detalle .tabla { font-size:var(--fs-xs); }
    .tabla tr.detalle .tabla td, .tabla tr.detalle .tabla th { padding:var(--sp-1) var(--sp-2); }
    .supuestos { display:flex; gap:var(--sp-1) var(--sp-4); flex-wrap:wrap; list-style:none; padding:0; margin:var(--sp-3) 0 0; font-size:var(--fs-xs); color:var(--texto-tenue); }
    .supuestos strong { color:var(--texto); font-weight:600; }
    .rejilla2 { display:grid; gap:var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr)); }
    .rejilla2 .tarjeta { padding:0; } .rejilla2 h3 { padding:var(--sp-3) var(--sp-4) 0; margin:0; }
    td.nota { max-width:36ch; font-size:var(--fs-xs); color:var(--texto-tenue); }
    td.id { white-space:nowrap; }
  `],
  template: `
    <h1>Costos de IA</h1>
    <p class="pista" style="max-width:80ch;margin-bottom:var(--sp-4)">
      Cada lectura asistida se valora en el momento de hacerse con la tarifa vigente del modelo; lo que se ve
      aquí como estimación parte de supuestos (páginas por tipo de documento, tokens por página, reenvíos) que se
      recalibran con el gasto real a medida que se acumulan lecturas.
    </p>

    @if (cargando()) {
      <sipra-esqueleto tipo="cifras" [cantidad]="6" /><div style="height:var(--sp-5)"></div>
      <div class="tarjeta"><sipra-esqueleto tipo="filas" [cantidad]="6" /></div>
    } @else {
      <!-- ── Configuración vigente ──────────────────────────────────────── -->
      @if (configuracion(); as c) {
        <div class="config">
          <span class="etiqueta" [class.etiqueta--ok]="c.driver !== 'simulado'" [class.etiqueta--neutra]="c.driver === 'simulado'">{{ c.driver }}</span>
          <span><strong>Modelo</strong>&ngsp;<span class="mono">{{ c.modelo }}</span></span>
          <span class="pista">·</span>
          <span><strong>Esfuerzo</strong> {{ c.esfuerzo }}</span>
          <span class="pista">·</span>
          <span><strong>Tope diario</strong> {{ usd(c.topeDiarioUsd) }} <span class="pista">({{ cop(c.topeDiarioUsd) }})</span></span>
        </div>
        @if (c.driver === 'simulado') {
          <div class="aviso aviso--info" style="margin-bottom:var(--sp-4);max-width:80ch">
            La lectura asistida está en modo <strong>simulado</strong>: los documentos se procesan sin llamar a un
            proveedor y no generan costo. Las cifras reales empezarán a acumularse cuando se active OpenAI.
          </div>
        }
      }

      <!-- ── Filtros y TRM ──────────────────────────────────────────────── -->
      <div class="barra">
        <div class="campo"><label for="f-periodo">Periodo</label>
          <select id="f-periodo" [ngModel]="periodo()" (ngModelChange)="periodo.set($event); recargarResumen()">
            <option value="">Todos</option>
            @for (p of periodosDisponibles(); track p) { <option [value]="p">{{ p }}</option> }
          </select></div>
        <div class="campo"><label for="f-desde">Desde</label><input id="f-desde" type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event); recargarResumen()" /></div>
        <div class="campo"><label for="f-hasta">Hasta</label><input id="f-hasta" type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event); recargarResumen()" /></div>
        <div class="campo"><label for="f-trm">TRM (COP por USD)</label><input id="f-trm" type="number" min="1" step="1" [ngModel]="trm()" (ngModelChange)="cambiarTrm($event)" /></div>
      </div>

      <!-- ── Gasto real ─────────────────────────────────────────────────── -->
      <section class="seccion">
        @if (cargandoResumen()) {
          <sipra-esqueleto tipo="cifras" [cantidad]="6" />
        } @else if (resumen(); as r) {
          @if (r.totales.documentos === 0) {
            <div class="vacio">
              <strong>Aún no hay lecturas con IA registradas</strong>
              <span>Cuando el pipeline lea documentos{{ periodo() || desde() || hasta() ? ' en el filtro elegido' : '' }}, aquí aparecerán el gasto, los documentos y los estudiantes atendidos.</span>
            </div>
          } @else {
            <div class="cifras">
              <div class="tarjeta cifra"><div class="t">Gasto total</div><div class="n">{{ usd(r.totales.costoUsd) }}</div><span class="cop">{{ cop(r.totales.costoUsd) }}</span></div>
              <div class="tarjeta cifra"><div class="t">Documentos leídos</div><div class="n">{{ entero(r.totales.documentos) }}</div>
                @if (r.totales.documentosSinCosto > 0) { <span class="cop">{{ entero(r.totales.documentosSinCosto) }} sin costo</span> }</div>
              <div class="tarjeta cifra"><div class="t">Estudiantes</div><div class="n">{{ entero(r.totales.estudiantes) }}</div></div>
              <div class="tarjeta cifra"><div class="t">Promedio por documento</div><div class="n">{{ usd(r.totales.costoPromedioDocumentoUsd) }}</div><span class="cop">{{ cop(r.totales.costoPromedioDocumentoUsd) }}</span></div>
              <div class="tarjeta cifra"><div class="t">Promedio por estudiante</div><div class="n">{{ usd(r.totales.costoPromedioEstudianteUsd) }}</div><span class="cop">{{ cop(r.totales.costoPromedioEstudianteUsd) }}</span></div>
              <div class="tarjeta cifra"><div class="t">Gasto de hoy</div><div class="n">{{ usd(r.gastoHoyUsd) }}</div>
                <span class="cop">de {{ usd(r.topeDiarioUsd) }} de tope · {{ cop(r.gastoHoyUsd) }}</span>
                @if (r.topeDiarioUsd > 0) { <div class="tope" [class.alto]="porcentajeTope() >= 70" [class.lleno]="porcentajeTope() >= 100"><span [style.width.%]="porcentajeTope()"></span></div> }</div>
            </div>
          }
        }
      </section>

      <!-- ── Estimación por estudiante ──────────────────────────────────── -->
      <section class="seccion">
        <h2>Estimación por estudiante</h2>
        <p class="pista">Lo que cuesta leer todos los documentos que exige cada modalidad, con el modelo elegido. «Con reenvíos» aplica el factor de lecturas adicionales por devoluciones, ilegibles y reintentos: es la cifra que conviene presupuestar.</p>
        <div class="barra">
          <div class="campo" style="max-width:340px"><label for="e-modelo">Modelo</label>
            <select id="e-modelo" [ngModel]="modeloElegido()" (ngModelChange)="modeloElegido.set($event); recalcularEstimacion()">
              @for (t of opcionesModelo(); track t.id) { <option [value]="t.id">{{ t.id }} · {{ t.recomendacion | etiqueta }}</option> }
            </select></div>
          <div class="campo"><label for="e-factor">Factor de reenvíos (1,0 a 2,0)</label><input id="e-factor" type="number" min="1" max="2" step="0.05" [ngModel]="factorReenvios()" (ngModelChange)="cambiarFactor($event)" /></div>
        </div>
        <div class="tarjeta" style="padding:0">
          @if (cargandoEstimacion()) {
            <sipra-esqueleto tipo="filas" [cantidad]="6" />
          } @else if (estimacion(); as e) {
            <div class="tabla-envoltura">
              <table class="tabla">
                <thead><tr>
                  <th>Modalidad</th><th class="num">Documentos exigidos</th><th class="num">Páginas</th><th class="num">Tokens entrada</th><th class="num">Tokens salida</th>
                  <th class="num">Costo por estudiante</th><th class="num">Con reenvíos (×{{ e.supuestos.factorReenvios }})</th><th></th>
                </tr></thead>
                <tbody>
                  @for (m of e.modalidades; track m.modalidad) {
                    <tr>
                      <td>{{ m.etiqueta }}@if (m.articulada) { <span class="pista"> · articulada</span> }</td>
                      <td class="num">{{ m.totalDocumentos }}</td>
                      <td class="num">{{ m.totalPaginas }}</td>
                      <td class="num">{{ entero(m.tokensEntrada) }}</td>
                      <td class="num">{{ entero(m.tokensSalida) }}</td>
                      <td class="num">{{ usd(m.costoUsd) }}<span class="cop">{{ cop(m.costoUsd) }}</span></td>
                      <td class="num"><strong>{{ usd(m.costoConReenviosUsd) }}</strong><span class="cop">{{ cop(m.costoConReenviosUsd) }}</span></td>
                      <td><button type="button" class="boton compacto" [attr.aria-expanded]="abierta(m.modalidad)" (click)="alternar(m.modalidad)">{{ abierta(m.modalidad) ? 'Ocultar' : 'Ver documentos' }}</button></td>
                    </tr>
                    @if (abierta(m.modalidad)) {
                      <tr class="detalle"><td colspan="8">
                        <table class="tabla">
                          <thead><tr><th>Tipo</th><th>Documento</th><th class="num">Páginas</th><th class="num">Tokens entrada</th><th class="num">Tokens salida</th><th class="num">Costo</th></tr></thead>
                          <tbody>
                            @for (d of m.documentos; track d.tipo) {
                              <tr><td class="mono">{{ d.tipo }}</td><td>{{ d.nombre }}</td><td class="num">{{ d.paginas }}</td><td class="num">{{ entero(d.tokensEntrada) }}</td><td class="num">{{ entero(d.tokensSalida) }}</td><td class="num">{{ usd(d.costoUsd) }}<span class="cop">{{ cop(d.costoUsd) }}</span></td></tr>
                            }
                          </tbody>
                        </table>
                      </td></tr>
                    }
                  }
                </tbody>
                <tfoot>
                  <tr><td colspan="5">Promedio entre modalidades (con reenvíos)</td><td class="num" colspan="2">{{ usd(e.promedioEstudianteUsd) }}<span class="cop">{{ cop(e.promedioEstudianteUsd) }}</span></td><td></td></tr>
                  <tr><td colspan="5">Mínimo · máximo</td><td class="num" colspan="2">{{ usd(e.minimoEstudianteUsd) }} · {{ usd(e.maximoEstudianteUsd) }}<span class="cop">{{ cop(e.minimoEstudianteUsd) }} · {{ cop(e.maximoEstudianteUsd) }}</span></td><td></td></tr>
                  <tr><td colspan="5">Por 1 000 estudiantes</td><td class="num" colspan="2">{{ usd(e.porMilEstudiantesUsd) }}<span class="cop">{{ cop(e.porMilEstudiantesUsd) }}</span></td><td></td></tr>
                </tfoot>
              </table>
            </div>
            <div style="padding:0 var(--sp-4) var(--sp-4)">
              <ul class="supuestos">
                <li><strong>{{ entero(e.tokensImagenPorPagina) }}</strong> tokens de imagen por página</li>
                <li><strong>{{ entero(e.supuestos.tokensTextoPorPagina) }}</strong> tokens de texto por página</li>
                <li><strong>{{ entero(e.supuestos.tokensRespuesta) }}</strong> tokens de respuesta</li>
                <li><strong>{{ entero(e.supuestos.tokensRazonamiento) }}</strong> tokens de razonamiento{{ e.tarifa.razonador ? '' : ' (no aplica: el modelo no razona)' }}</li>
                <li>página de <strong>{{ e.supuestos.anchoPaginaPx }} × {{ e.supuestos.altoPaginaPx }} px</strong> (carta a 200 ppp)</li>
                <li>tarifa <strong>{{ usd(e.tarifa.entradaUsdPorMillon) }}</strong> entrada · <strong>{{ usd(e.tarifa.salidaUsdPorMillon) }}</strong> salida por millón de tokens</li>
              </ul>
              @if (!e.tarifaExacta) {
                <p class="pista" style="margin:var(--sp-2) 0 0">El modelo <span class="mono">{{ e.modelo }}</span> no tiene tarifa propia en la tabla; se usa la de <span class="mono">{{ e.tarifa.id }}</span>.</p>
              }
              @if (e.tarifa.imagen.tipo === 'parches' && !e.tarifa.imagen.publicada) {
                <p class="pista" style="margin:var(--sp-2) 0 0">El proveedor no publica la regla de imagen de este modelo; se asume la de su familia (×{{ e.tarifa.imagen.multiplicador }}, tope {{ entero(e.tarifa.imagen.topeParches) }} parches) hasta calibrarla con el consumo real.</p>
              }
            </div>
          } @else {
            <div class="vacio">No fue posible calcular la estimación para el modelo elegido.</div>
          }
        </div>
      </section>

      <!-- ── Comparativa de modelos ─────────────────────────────────────── -->
      <section class="seccion">
        <h2>Comparativa de modelos</h2>
        <p class="pista">La misma estimación para cada modelo de la tabla, del más barato al más caro. La fila resaltada es el modelo configurado hoy.</p>
        <div class="tarjeta" style="padding:0">
          @if (cargandoEstimacion()) {
            <sipra-esqueleto tipo="filas" [cantidad]="6" />
          } @else if (comparativa().length === 0) {
            <div class="vacio">Sin modelos para comparar.</div>
          } @else {
            <div class="tabla-envoltura">
              <table class="tabla">
                <thead><tr>
                  <th>Modelo</th><th>Familia</th><th>Recomendación</th><th>Retiro anunciado</th>
                  <th class="num">Entrada / salida (USD por millón)</th><th class="num">Costo por página</th>
                  <th class="num">Promedio por estudiante</th><th class="num">Por 1 000 estudiantes</th>
                </tr></thead>
                <tbody>
                  @for (c of comparativa(); track c.modelo) {
                    <tr [class.actual]="esConfigurado(c.modelo)">
                      <td class="id mono">{{ c.modelo }}</td>
                      <td>{{ c.familia }}</td>
                      <td><span class="etiqueta etiqueta--{{ tono(c.recomendacion) }}">{{ c.recomendacion | etiqueta }}</span></td>
                      <td class="pista">{{ c.retiro ? (c.retiro | date: 'd MMM y') : '—' }}</td>
                      <td class="num">{{ usd(c.entradaUsdPorMillon) }} / {{ usd(c.salidaUsdPorMillon) }}</td>
                      <td class="num">{{ usd(c.costoPorPaginaUsd) }}<span class="cop">{{ cop(c.costoPorPaginaUsd) }}</span></td>
                      <td class="num">{{ usd(c.promedioEstudianteUsd) }}<span class="cop">{{ cop(c.promedioEstudianteUsd) }}</span></td>
                      <td class="num">{{ usd(c.porMilEstudiantesUsd) }}<span class="cop">{{ cop(c.porMilEstudiantesUsd) }}</span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </section>

      <!-- ── Tarifas vigentes ───────────────────────────────────────────── -->
      <section class="seccion">
        <h2>Tarifas vigentes</h2>
        <p class="pista">USD por millón de tokens, tarifa estándar.
          @if (configuracion(); as c) { Vigentes desde el {{ c.tarifasVigentesDesde | date: 'd MMM y' }} · <a [href]="c.fuenteTarifas" target="_blank" rel="noopener">fuente del proveedor</a>. }
          El costo guardado en cada documento no se recalcula: refleja la tarifa que regía cuando se leyó.</p>
        <div class="tarjeta" style="padding:0">
          <div class="tabla-envoltura">
            <table class="tabla">
              <thead><tr>
                <th>Modelo</th><th>Proveedor</th><th>Familia</th><th class="num">Entrada</th><th class="num">Entrada en caché</th><th class="num">Salida</th>
                <th class="num">Lote (−50 %)</th><th>Razonador</th><th>Retiro</th><th>Nota</th>
              </tr></thead>
              <tbody>
                @for (t of tarifas(); track t.id) {
                  <tr [class.actual]="esConfigurado(t.id)">
                    <td class="id mono">{{ t.id }}</td>
                    <td>{{ t.proveedor }}</td>
                    <td>{{ t.familia }}</td>
                    <td class="num">{{ usd(t.entradaUsdPorMillon) }}</td>
                    <td class="num">{{ usd(t.entradaCacheUsdPorMillon) }}</td>
                    <td class="num">{{ usd(t.salidaUsdPorMillon) }}</td>
                    <td class="num">{{ usd(lote(t.entradaUsdPorMillon, t)) }} / {{ usd(lote(t.salidaUsdPorMillon, t)) }}</td>
                    <td>{{ t.razonador ? 'Sí' : 'No' }}</td>
                    <td class="pista">{{ t.retiro ? (t.retiro | date: 'd MMM y') : '—' }}</td>
                    <td class="nota">{{ t.nota }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ── Gasto real detallado ───────────────────────────────────────── -->
      @if (resumen(); as r) {
        @if (r.totales.documentos > 0) {
          <section class="seccion">
            <h2>Gasto real detallado</h2>
            <p class="pista">Lecturas registradas por el pipeline en el filtro elegido, agrupadas por modelo, tipo documental, modalidad, periodo y estudiante.</p>
            <div class="rejilla2" style="margin-bottom:var(--sp-4)">
              @for (grupo of grupos(); track grupo.titulo) {
                <div class="tarjeta">
                  <h3>{{ grupo.titulo }}</h3>
                  <div class="tabla-envoltura">
                    <table class="tabla">
                      <thead><tr><th>{{ grupo.columna }}</th><th class="num">Documentos</th><th class="num">Tokens entrada</th><th class="num">Tokens salida</th><th class="num">Costo</th></tr></thead>
                      <tbody>
                        @for (f of grupo.filas; track f.clave) {
                          <tr><td>{{ f.etiqueta }}</td><td class="num">{{ entero(f.documentos) }}</td><td class="num">{{ entero(f.tokensEntrada) }}</td><td class="num">{{ entero(f.tokensSalida) }}</td><td class="num">{{ usd(f.costoUsd) }}<span class="cop">{{ cop(f.costoUsd) }}</span></td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            </div>
            <div class="tarjeta" style="padding:0">
              <h3 style="padding:var(--sp-3) var(--sp-4) 0;margin:0">Por estudiante</h3>
              <div class="tabla-envoltura">
                <table class="tabla">
                  <thead><tr><th>Estudiante</th><th>Periodo</th><th>Modalidad</th><th class="num">Documentos</th><th class="num">Tokens entrada</th><th class="num">Tokens salida</th><th class="num">Costo</th><th>Última lectura</th></tr></thead>
                  <tbody>
                    @for (f of r.porEstudiante; track f.estudianteId + f.periodoAcademico + f.modalidad) {
                      <tr>
                        <td>{{ f.nombre }}</td>
                        <td>{{ f.periodoAcademico }}</td>
                        <td>{{ f.modalidadEtiqueta }}</td>
                        <td class="num">{{ entero(f.documentos) }}</td>
                        <td class="num">{{ entero(f.tokensEntrada) }}</td>
                        <td class="num">{{ entero(f.tokensSalida) }}</td>
                        <td class="num">{{ usd(f.costoUsd) }}<span class="cop">{{ cop(f.costoUsd) }}</span></td>
                        <td class="pista" style="white-space:nowrap">{{ f.ultimaLectura | date: 'd MMM y, HH:mm' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        }
      }
    }
  `,
})
export class CostosIaComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  readonly cargando = signal(true);
  readonly cargandoResumen = signal(false);
  readonly cargandoEstimacion = signal(false);

  readonly configuracion = signal<ConfiguracionIa | null>(null);
  readonly tarifas = signal<TarifaIa[]>([]);
  readonly estimacion = signal<EstimacionIa | null>(null);
  readonly comparativa = signal<ComparativaModeloIa[]>([]);
  readonly resumen = signal<ResumenGastoIa | null>(null);

  readonly trm = signal(4000);
  readonly periodo = signal('');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly modeloElegido = signal('');
  readonly factorReenvios = signal(1.25);
  readonly abiertas = signal<string[]>([]);

  /** Los periodos del primer resumen sin filtro; el filtrado no los recorta. */
  readonly periodosDisponibles = signal<string[]>([]);

  /** Modelos de OpenAI, más el configurado si fuera de otro proveedor. */
  readonly opcionesModelo = computed(() => {
    const elegido = this.modeloElegido();
    return this.tarifas().filter((t) => t.proveedor === 'openai' || t.id === elegido);
  });

  readonly porcentajeTope = computed(() => {
    const r = this.resumen();
    if (!r || r.topeDiarioUsd <= 0) return 0;
    return Math.min(100, Math.round((r.gastoHoyUsd / r.topeDiarioUsd) * 100));
  });

  readonly grupos = computed(() => {
    const r = this.resumen();
    if (!r) return [];
    return [
      { titulo: 'Por modelo', columna: 'Modelo', filas: r.porModelo },
      { titulo: 'Por tipo documental', columna: 'Tipo', filas: r.porTipo },
      { titulo: 'Por modalidad', columna: 'Modalidad', filas: r.porModalidad },
      { titulo: 'Por periodo', columna: 'Periodo', filas: r.porPeriodo },
    ].filter((g) => g.filas.length > 0);
  });

  async ngOnInit(): Promise<void> {
    try {
      const [configuracion, tarifas, estimacion, comparativa, resumen] = await Promise.all([
        firstValueFrom(this.api.configuracionIa()),
        firstValueFrom(this.api.tarifasIa()),
        firstValueFrom(this.api.estimacionIa(undefined, { factorReenvios: this.factorReenvios() })),
        firstValueFrom(this.api.comparativaIa(this.factorReenvios())),
        firstValueFrom(this.api.resumenCostosIa()),
      ]);
      this.configuracion.set(configuracion);
      this.tarifas.set(tarifas);
      this.estimacion.set(estimacion);
      this.comparativa.set(comparativa);
      this.resumen.set(resumen);
      this.periodosDisponibles.set(resumen.periodosDisponibles);
      // El selector solo lista identificadores de la tabla; un alias con fecha cae en su tarifa.
      this.modeloElegido.set(tarifas.some((t) => t.id === estimacion.modelo) ? estimacion.modelo : estimacion.tarifa.id);
    } catch (error) {
      this.avisos.error(leerError(error, 'No fue posible cargar los costos de IA.'));
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Formato ────────────────────────────────────────────────────────────
  usd(valor: number): string { return formatearUsd(valor); }
  cop(valor: number): string { return formatearCop(valor, this.trm()); }
  entero(valor: number): string { return formatearEntero(valor); }
  tono(recomendacion: RecomendacionModeloIa): string { return TONO_RECOMENDACION[recomendacion] ?? 'neutra'; }
  lote(valorUsd: number, tarifa: TarifaIa): number { return valorUsd * (1 - tarifa.descuentoLotePorcentaje / 100); }

  esConfigurado(modelo: string): boolean {
    const actual = this.configuracion()?.modelo.trim().toLowerCase() ?? '';
    return actual === modelo || actual.startsWith(`${modelo}-`);
  }

  abierta(modalidad: string): boolean { return this.abiertas().includes(modalidad); }
  alternar(modalidad: string): void {
    this.abiertas.update((l) => (l.includes(modalidad) ? l.filter((m) => m !== modalidad) : [...l, modalidad]));
  }

  cambiarTrm(valor: number | null): void {
    if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) this.trm.set(valor);
  }

  /** Solo recalcula con un factor válido; mientras la persona escribe no se dispara nada. */
  cambiarFactor(valor: number | null): void {
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 1 || valor > 2) return;
    this.factorReenvios.set(valor);
    void this.recalcularEstimacion(true);
  }

  async recalcularEstimacion(conComparativa = false): Promise<void> {
    this.cargandoEstimacion.set(true);
    try {
      const factor = this.factorReenvios();
      const [estimacion, comparativa] = await Promise.all([
        firstValueFrom(this.api.estimacionIa(this.modeloElegido() || undefined, { factorReenvios: factor })),
        conComparativa ? firstValueFrom(this.api.comparativaIa(factor)) : Promise.resolve(this.comparativa()),
      ]);
      this.estimacion.set(estimacion);
      this.comparativa.set(comparativa);
    } catch (error) {
      this.avisos.error(leerError(error, 'No fue posible recalcular la estimación.'));
    } finally {
      this.cargandoEstimacion.set(false);
    }
  }

  async recargarResumen(): Promise<void> {
    this.cargandoResumen.set(true);
    try {
      const resumen = await firstValueFrom(this.api.resumenCostosIa({
        periodo: this.periodo() || undefined,
        desde: this.desde() ? `${this.desde()}T00:00:00-05:00` : undefined,
        // El servidor toma «hasta» como exclusivo; la persona espera que el día elegido quede incluido.
        hasta: this.hasta() ? diaSiguiente(this.hasta()) : undefined,
      }));
      this.resumen.set(resumen);
      if (this.periodosDisponibles().length === 0) this.periodosDisponibles.set(resumen.periodosDisponibles);
    } catch (error) {
      this.avisos.error(leerError(error, 'No fue posible cargar el gasto real.'));
    } finally {
      this.cargandoResumen.set(false);
    }
  }
}

/** Medianoche (hora de Colombia) del día siguiente a una fecha `AAAA-MM-DD`, en ISO. */
function diaSiguiente(fecha: string): string {
  const f = new Date(`${fecha}T00:00:00-05:00`);
  f.setUTCDate(f.getUTCDate() + 1);
  return f.toISOString();
}
