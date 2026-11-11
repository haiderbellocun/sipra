import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { MetricaV3, TiraMetricasComponent } from '@shared/components/tira-metricas.component';
import { ReportesBarrasComponent } from './reportes-barras.component';
import {
  CATEGORIAS_EXPEDIENTE, ItemBarra, RECEPTORES, ReporteAnalitica, SIN_DATO, SIN_EMPRESA, TASAS, TipoReceptor, escalaSemanas, horas, nivel, partes, pct1,
  porcentaje, semanaCorta, semestre,
} from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Cifras de la franja General. Estudiantes = DISTINCT; prácticas = filas; documentos = obligaciones de la matriz.
 * Con filtros activos, el contexto muestra el denominador «en alcance» (lo que el perfil puede ver sin filtros).
 */
export function metricasGenerales(r: ReporteAnalitica, filtrado = false): MetricaV3[] {
  const { resumen: s, expedientes: e, tiempos: t, universo: u } = r;
  const pctCompletos = porcentaje(s.completos, s.practicas);
  const pctAprobados = porcentaje(s.aprobados, s.exigidos);
  return [
    { n: s.estudiantes, t: 'Estudiantes', tono: 'info', contexto: filtrado ? `de ${u.estudiantes} en alcance · ${s.practicas} práctica(s)` : `${s.practicas} práctica(s)` },
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
  imports: [TiraMetricasComponent, ReportesBarrasComponent],
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
    .seccion { grid-column: 1 / -1; margin: 8px 0 -14px; font: 600 11px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); border-top: 1px solid var(--ra-regla); padding-top: 18px; }
    @media (width < 700px) { .ejes span:nth-child(odd) { visibility: hidden; } .cobertura div { grid-template-columns: 7rem 1fr 3.5rem; } }
  `],
  template: `
    @if (estado.datos(); as r) {
      <sipra-tira-metricas class="tira" [etiqueta]="filtrado() ? 'Resumen del universo filtrado' : 'Resumen del alcance'" [metricas]="metricas()" />
      <div class="ra-rejilla">
        <section class="ra-bloque" aria-labelledby="g-prog">
          <h2 id="g-prog">Estudiantes por programa</h2>
          <p class="ra-nota">Estudiantes únicos por programa (código registrado en la práctica), sobre {{ r.resumen.estudiantes }} del universo filtrado. Elija un programa para recalcular todo el reporte con él.</p>
          <sipra-reportes-barras titulo="Estudiantes por programa" [items]="programas()" [total]="r.resumen.estudiantes" [seleccion]="f().programa" (elegir)="estado.alternar('programa', $event)" />
        </section>

        <section class="ra-bloque" aria-labelledby="g-exp">
          <h2 id="g-exp">Situación de los expedientes</h2>
          <p class="ra-nota">Una categoría por práctica: completo (todo aprobado), requiere corrección (algún documento devuelto, ilegible o rechazado), en curso y sin iniciar. Mismo avance del Expediente. Elegir una filtra el reporte.</p>
          <div class="ra-pila" aria-hidden="true">
            @for (p of expedientes(); track p.clave) { <span [class]="'t-' + p.tono" [style.flex-grow]="p.n" [title]="p.texto + ': ' + p.n"></span> }
          </div>
          <table class="ra-tabla">
            <caption class="ra-sr">Prácticas por situación del expediente</caption>
            <thead><tr><th scope="col">Situación</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">%</th></tr></thead>
            <tbody>
              @for (p of expedientes(); track p.clave) {
                <tr>
                  <th scope="row"><button type="button" class="ra-ir" [attr.aria-pressed]="f().situacion === p.clave" (click)="estado.alternar('situacion', p.clave)"><span class="ra-punto" [class]="'t-' + p.tono" aria-hidden="true"></span>{{ p.texto }}</button></th>
                  <td class="d">{{ p.n }}</td>
                  <td class="d ra-tenue">{{ p.pct }} %</td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <h2 class="seccion">Composición</h2>
        <section class="ra-bloque" aria-labelledby="g-mod">
          <h2 id="g-mod">Modalidad de práctica</h2>
          <p class="ra-nota">Estudiantes únicos por modalidad (la entidad real del dominio).</p>
          <sipra-reportes-barras titulo="Estudiantes por modalidad" [items]="modalidades()" [total]="r.resumen.estudiantes" [seleccion]="f().modalidad" [limite]="8" (elegir)="estado.alternar('modalidad', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="g-niv">
          <h2 id="g-niv">Nivel de formación</h2>
          <p class="ra-nota">Ciclo registrado en la práctica.@if (r.dimensiones.semestre === 'no_disponible') { El semestre no está en SIPRA (solo en SINU, por estudiante): no se muestra ni se deduce. }</p>
          <sipra-reportes-barras titulo="Estudiantes por nivel de formación" [items]="niveles()" [total]="r.resumen.estudiantes" [seleccion]="f().ciclo" (elegir)="estado.alternar('ciclo', $event)" />
        </section>
        @if (r.dimensiones.semestre === 'sintetica') {
          <section class="ra-bloque" aria-labelledby="g-semestre">
            <h2 id="g-semestre">Estudiantes por semestre</h2>
            <p class="ra-nota">Semestre: dato sintético de prueba (tabla auxiliar de desarrollo); en producción SIPRA no lo guarda. Orden numérico.</p>
            <sipra-reportes-barras titulo="Estudiantes por semestre" [items]="semestres()" [total]="r.resumen.estudiantes" [seleccion]="f().semestre" [limite]="12" (elegir)="estado.alternar('semestre', $event)" />
          </section>
        }
        <section class="ra-bloque" aria-labelledby="g-est">
          <h2 id="g-est">Estado de la práctica</h2>
          <p class="ra-nota">Prácticas por estado registrado (no es el estado documental).</p>
          <sipra-reportes-barras titulo="Prácticas por estado" unidad="prácticas" [items]="estados()" [total]="r.resumen.practicas" [seleccion]="f().estado" (elegir)="estado.alternar('estado', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="g-cob">
          <h2 id="g-cob">Salud documental</h2>
          <p class="ra-nota">{{ tasa.texto }} = {{ tasa.definicion }}: {{ r.resumen.aprobados }} / {{ r.resumen.exigidos }}. «Cargado» es la última versión vigente; no se suma con aprobado. Detalle por programa, nivel y tipo en Documentos.</p>
          <div class="cobertura">
            <div><span>Cargado</span><span class="ra-mini" aria-hidden="true"><span class="t-info" [style.width.%]="pctCargado() ?? 0"></span></span><span class="d ra-num">{{ pctCargado() ?? '—' }} %</span></div>
            <div><span>Aprobado</span><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pctAprobado() ?? 0"></span></span><span class="d ra-num">{{ pctAprobado() ?? '—' }} %</span></div>
          </div>
          <p class="ra-nota" style="margin-top:10px">{{ r.resumen.correccion }} en corrección · {{ r.resumen.devoluciones }} devoluciones auditadas · carga → decisión: mediana {{ horas(r.tiempos.medianaHoras) }}, p90 {{ horas(r.tiempos.p90Horas) }}.</p>
        </section>

        <h2 class="seccion">Organizaciones receptoras</h2>
        <section class="ra-bloque" aria-labelledby="g-rec">
          <h2 id="g-rec">Tipo de organización receptora</h2>
          <p class="ra-nota">Interna CUN: modalidad articulada («escenario dentro de la institución», regla del dominio). Externa: las demás.</p>
          <sipra-reportes-barras titulo="Estudiantes por tipo de receptor" [items]="receptores()" [total]="r.resumen.estudiantes" [seleccion]="f().tipoReceptor" [limite]="2" (elegir)="tipo($event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="g-emp">
          <h2 id="g-emp">Empresas con más estudiantes</h2>
          <p class="ra-nota">Por razón social registrada. Elija una para recalcular el reporte; «Ver todos» lista el universo completo.</p>
          <sipra-reportes-barras titulo="Estudiantes por empresa" [items]="empresas()" [total]="r.resumen.estudiantes" [seleccion]="f().empresa" (elegir)="estado.alternar('empresa', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="g-sector">
          <h2 id="g-sector">Sector económico</h2>
          <p class="ra-nota">Sección CIIU de la actividad registrada de la empresa (catálogo oficial cargado en SIPRA).</p>
          <sipra-reportes-barras titulo="Estudiantes por sector económico" [items]="sectores()" [total]="r.resumen.estudiantes" [seleccion]="f().sector" [limite]="12" (elegir)="filtrarDato('sector', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="g-ciudad">
          <h2 id="g-ciudad">Ciudad</h2>
          <p class="ra-nota">Municipio DIVIPOLA de la empresa.@if (r.dimensiones.ubicacionInternacional === 'sintetica') { «Internacional · sin DIVIPOLA» proviene del dataset sintético de prueba (SIPRA no guarda país); «Sin municipio registrado» es un dato faltante. } @else { Sin municipio registrado: dato faltante (incluye receptoras en el exterior, porque SIPRA no guarda país). }</p>
          <sipra-reportes-barras titulo="Estudiantes por ciudad" [items]="ciudades()" [total]="r.resumen.estudiantes" [seleccion]="f().ciudad" [limite]="12" (elegir)="filtrarDato('ciudad', $event)" />
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
  protected readonly tasa = TASAS.aprobacion;
  private readonly etiqueta = new EtiquetaPipe();

  protected readonly f = this.estado.filtros;
  protected readonly filtrado = computed(() => this.estado.activos() > 0);
  protected readonly metricas = computed(() => { const r = this.estado.datos(); return r ? metricasGenerales(r, this.filtrado()) : []; });
  protected readonly expedientes = computed(() => { const r = this.estado.datos(); return r ? partes(CATEGORIAS_EXPEDIENTE, r.expedientes) : []; });
  protected readonly programas = computed<ItemBarra[]>(() => (this.estado.datos()?.programas ?? [])
    .map((p) => ({ clave: p.programa, texto: p.nombre ?? p.programa, n: p.estudiantes, sub: p.nombre ? p.programa : p.nombreEscuela })));
  protected readonly modalidades = computed<ItemBarra[]>(() => [...(this.estado.datos()?.modalidades ?? [])]
    .sort((a, b) => b.estudiantes - a.estudiantes).map((m) => ({ clave: m.modalidad, texto: this.etiqueta.transform(m.modalidad), n: m.estudiantes })));
  protected readonly niveles = computed<ItemBarra[]>(() => (this.estado.datos()?.niveles ?? [])
    .map((n) => ({ clave: n.ciclo, texto: nivel(n.ciclo), n: n.estudiantes, sub: `${pct1(n.aprobados, n.exigidos)} aprobado` })));
  /** Semestres en orden numérico (no por volumen): el eje es académico. «Sin información» no es filtrable. */
  protected readonly semestres = computed<ItemBarra[]>(() => (this.estado.datos()?.semestres ?? [])
    .filter((s) => s.semestre !== null).map((s) => ({ clave: String(s.semestre), texto: semestre(s.semestre), n: s.estudiantes, sub: `${pct1(s.aprobados, s.exigidos)} aprobado` })));
  protected readonly receptores = computed<ItemBarra[]>(() => (this.estado.datos()?.receptores ?? [])
    .filter((x) => x.tipo).map((x) => ({ clave: x.tipo as string, texto: RECEPTORES[x.tipo as TipoReceptor], n: x.estudiantes })));
  protected readonly empresas = computed<ItemBarra[]>(() => (this.estado.datos()?.empresas ?? [])
    .map((e) => ({ clave: e.empresa ?? SIN_EMPRESA, texto: e.empresa ?? 'Sin empresa registrada', n: e.estudiantes, sub: e.ciudad ? this.estado.nombreCiudad(e.ciudad) : undefined })));
  protected readonly sectores = computed<ItemBarra[]>(() => (this.estado.datos()?.sectores ?? [])
    .map((s) => ({ clave: s.sector ?? SIN_DATO, texto: s.nombre ?? 'Sin información', n: s.estudiantes })));
  protected readonly ciudades = computed<ItemBarra[]>(() => (this.estado.datos()?.ciudades ?? [])
    .map((c) => ({ clave: c.ciudad ?? SIN_DATO, texto: c.nombre ?? 'Sin municipio registrado', n: c.estudiantes })));
  protected tipo(t: string): void { this.estado.alternar('tipoReceptor', t as TipoReceptor); }
  protected filtrarDato(k: 'sector' | 'ciudad', v: string): void { this.estado.alternar(k, v); }
  protected readonly estados = computed<ItemBarra[]>(() => (this.estado.datos()?.estadosPractica ?? [])
    .map((e) => ({ clave: e.estado, texto: this.etiqueta.transform(e.estado), n: e.practicas })));
  protected readonly pctCargado = computed(() => { const s = this.estado.datos()?.resumen; return s ? porcentaje(s.cargados, s.exigidos) : null; });
  protected readonly pctAprobado = computed(() => { const s = this.estado.datos()?.resumen; return s ? porcentaje(s.aprobados, s.exigidos) : null; });
  private readonly maximo = computed(() => escalaSemanas(this.estado.datos()?.semanas ?? []));

  protected alto(n: number): number {
    const max = this.maximo();
    return max === 0 ? 0 : Math.max(n > 0 ? 3 : 0, Math.round((n * 100) / max));
  }
}
