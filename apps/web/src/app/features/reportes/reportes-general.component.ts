import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MetricaV3, TiraMetricasComponent } from '@shared/components/tira-metricas.component';
import {
  CATEGORIAS_EXPEDIENTE, ReporteAnalitica, escalaSemanas, horas, partes, porcentaje, semanaCorta,
} from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Cifras de la franja General. Estudiantes = DISTINCT; prácticas = filas; documentos = obligaciones de la matriz. */
export function metricasGenerales(r: ReporteAnalitica): MetricaV3[] {
  const { resumen: s, expedientes: e, tiempos: t } = r;
  const pctCompletos = porcentaje(s.completos, s.practicas);
  const pctAprobados = porcentaje(s.aprobados, s.exigidos);
  return [
    { n: s.estudiantes, t: 'Estudiantes', tono: 'info', contexto: `${s.practicas} práctica(s)` },
    { n: s.completos, t: 'Expedientes completos', tono: 'ok', contexto: pctCompletos === null ? 'sin prácticas' : `${pctCompletos} % de las prácticas` },
    { n: e.requiere_correccion, t: 'Requieren corrección', tono: e.requiere_correccion ? 'aviso' : 'neutra', contexto: `${s.correccion} documento(s) devuelto(s)` },
    { n: s.aprobados, t: 'Aprobados', tono: 'ok', contexto: pctAprobados === null ? 'documentos · sin exigidos' : `documentos · ${pctAprobados} % de ${s.exigidos}` },
    { n: s.cargados, t: 'Cargados', tono: 'info', contexto: 'documentos vigentes' },
    { n: t.decisiones, t: 'Decisiones', tono: 'neutra', contexto: `auditadas · mediana ${horas(t.medianaHoras)}` },
  ];
}

@Component({
  selector: 'sipra-reportes-general',
  standalone: true,
  imports: [TiraMetricasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .tira { margin: 4px 0 28px; }
    .cobertura { display: grid; gap: 10px; margin: 2px 0 6px; }
    .cobertura div { display: grid; grid-template-columns: 9.5rem 1fr 4.5rem; align-items: center; gap: 12px; font-size: 13px; }
    .cobertura .ra-mini { height: 10px; border-radius: 5px; }
    .semanas { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); align-items: end; gap: 6px; height: 132px; padding: 0 0 4px; border-bottom: 1px solid var(--border-default); }
    .semana { display: flex; align-items: flex-end; justify-content: center; gap: 2px; height: 100%; }
    .semana span { width: 42%; max-width: 14px; min-height: 1px; border-radius: 2px 2px 0 0; }
    .ejes { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 6px; margin-top: 4px; font: 500 10px/14px var(--fuente-mono); color: var(--text-muted); text-align: center; }
    .leyenda { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); }
    details { margin-top: 10px; font-size: 13px; }
    summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    summary:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    @media (width < 700px) { .ejes span:nth-child(odd) { visibility: hidden; } .cobertura div { grid-template-columns: 7rem 1fr 3.5rem; } }
  `],
  template: `
    @if (estado.datos(); as r) {
      <sipra-tira-metricas class="tira" etiqueta="Resumen del filtro" [metricas]="metricas()" />
      <div class="ra-rejilla">
        <section class="ra-bloque" aria-labelledby="g-exp">
          <h2 id="g-exp">Situación de los expedientes</h2>
          <p class="ra-nota">Una categoría por práctica, en este orden: completo (todo aprobado), requiere corrección (algún documento devuelto, ilegible o rechazado), sin iniciar y en curso. Calculado con el mismo avance del Expediente.</p>
          <div class="ra-pila" aria-hidden="true">
            @for (p of expedientes(); track p.clave) { <span [class]="'t-' + p.tono" [style.flex-grow]="p.n" [title]="p.texto + ': ' + p.n"></span> }
          </div>
          <table class="ra-tabla">
            <caption class="ra-sr">Prácticas por situación del expediente</caption>
            <thead><tr><th scope="col">Situación</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">%</th></tr></thead>
            <tbody>
              @for (p of expedientes(); track p.clave) {
                <tr>
                  <th scope="row"><span class="ra-punto" [class]="'t-' + p.tono" aria-hidden="true"></span>{{ p.texto }}</th>
                  <td class="d"><button type="button" class="ra-ir" (click)="estado.abrirDetalle({ situacion: p.clave })" [attr.aria-label]="'Ver ' + p.n + ' prácticas: ' + p.texto">{{ p.n }}</button></td>
                  <td class="d ra-tenue">{{ p.pct }} %</td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="ra-bloque" aria-labelledby="g-cob">
          <h2 id="g-cob">Cobertura documental</h2>
          <p class="ra-nota">Sobre {{ r.resumen.exigidos }} obligaciones exigidas por la matriz de cada modalidad. «Cargado» es la última versión vigente (sin devueltos, ilegibles ni rechazados); «aprobado» exige decisión. No se suman entre sí.</p>
          <div class="cobertura">
            <div><span>Cargado</span><span class="ra-mini" aria-hidden="true"><span class="t-info" [style.width.%]="pctCargado() ?? 0"></span></span><span class="d ra-num">{{ pctCargado() ?? '—' }} %</span></div>
            <div><span>Aprobado</span><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pctAprobado() ?? 0"></span></span><span class="d ra-num">{{ pctAprobado() ?? '—' }} %</span></div>
          </div>
          <p class="ra-nota" style="margin-top:10px">{{ r.resumen.cargados }} cargados · {{ r.resumen.aprobados }} aprobados · {{ r.resumen.correccion }} en corrección · tiempo carga → decisión: mediana {{ horas(r.tiempos.medianaHoras) }}, p90 {{ horas(r.tiempos.p90Horas) }} ({{ r.tiempos.decisiones }} decisiones auditadas).</p>
        </section>

        <section class="ra-bloque" aria-labelledby="g-sem" style="grid-column:1 / -1">
          <h2 id="g-sem">Movimiento de las últimas 12 semanas</h2>
          <p class="ra-nota">Semanas de lunes a domingo en hora de Colombia. Cargas por fecha de carga; decisiones por su registro en la auditoría. La última semana está en curso.</p>
          <div class="semanas" aria-hidden="true">
            @for (s of r.semanas; track s.semana) {
              <div class="semana" [title]="semanaCorta(s.semana) + ': ' + s.cargas + ' cargas, ' + (s.aprobaciones + s.devoluciones + s.rechazos) + ' decisiones'">
                <span class="t-info" [style.height.%]="alto(s.cargas)"></span>
                <span class="t-ok" [style.height.%]="alto(s.aprobaciones + s.devoluciones + s.rechazos)"></span>
              </div>
            }
          </div>
          <div class="ejes" aria-hidden="true">@for (s of r.semanas; track s.semana) { <span>{{ semanaCorta(s.semana) }}</span> }</div>
          <div class="leyenda" aria-hidden="true"><span><span class="ra-punto t-info"></span>Cargas</span><span><span class="ra-punto t-ok"></span>Decisiones (aprobar, devolver, rechazar)</span></div>
          <details>
            <summary>Ver la serie como tabla</summary>
            <div class="ra-desliza">
              <table class="ra-tabla" style="margin-top:8px">
                <caption class="ra-sr">Cargas y decisiones por semana</caption>
                <thead><tr><th scope="col">Semana</th><th scope="col" class="d">Cargas</th><th scope="col" class="d">Aprobaciones</th><th scope="col" class="d">Devoluciones</th><th scope="col" class="d">Rechazos</th></tr></thead>
                <tbody>@for (s of r.semanas; track s.semana) { <tr><td>{{ semanaCorta(s.semana) }}</td><td class="d">{{ s.cargas }}</td><td class="d">{{ s.aprobaciones }}</td><td class="d">{{ s.devoluciones }}</td><td class="d">{{ s.rechazos }}</td></tr> }</tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
    }
  `,
})
export class ReportesGeneralComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly horas = horas;
  protected readonly semanaCorta = semanaCorta;

  protected readonly metricas = computed(() => { const r = this.estado.datos(); return r ? metricasGenerales(r) : []; });
  protected readonly expedientes = computed(() => { const r = this.estado.datos(); return r ? partes(CATEGORIAS_EXPEDIENTE, r.expedientes) : []; });
  protected readonly pctCargado = computed(() => { const s = this.estado.datos()?.resumen; return s ? porcentaje(s.cargados, s.exigidos) : null; });
  protected readonly pctAprobado = computed(() => { const s = this.estado.datos()?.resumen; return s ? porcentaje(s.aprobados, s.exigidos) : null; });
  private readonly maximo = computed(() => escalaSemanas(this.estado.datos()?.semanas ?? []));

  protected alto(n: number): number {
    const max = this.maximo();
    return max === 0 ? 0 : Math.max(n > 0 ? 3 : 0, Math.round((n * 100) / max));
  }
}
