import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import {
  CATEGORIAS_OBLIGACION, Cobertura, FiltrosAnalitica, RECEPTORES, SIN_DATO, TASAS, TipoReceptor, compararNiveles, horas, nivel, partes, pct1, razon, segunOrden, semestre,
} from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

type DimensionSalud = 'programa' | 'ciclo' | 'semestre' | 'modalidad' | 'periodo' | 'receptor' | 'sector' | 'ciudad';
export const DIMENSIONES_SALUD: readonly { id: DimensionSalud; texto: string }[] = [
  { id: 'programa', texto: 'Programa' }, { id: 'ciclo', texto: 'Nivel' }, { id: 'semestre', texto: 'Semestre' }, { id: 'modalidad', texto: 'Modalidad' },
  { id: 'periodo', texto: 'Periodo' }, { id: 'receptor', texto: 'Interna / externa' }, { id: 'sector', texto: 'Sector' }, { id: 'ciudad', texto: 'Ciudad' },
];
interface FilaSalud { clave: string; texto: string; c: Cobertura }

/**
 * Salud documental por dimensión académica (programa, nivel, modalidad, periodo) con TASAS (no solo volumen) y
 * Documentos de la Mesa Única como dimensiones: tipo de documento × estado de su última versión (obligaciones),
 * fricción por versiones y decisiones auditadas, y tiempo de carga a decisión. No hay un reporte por motor.
 */
@Component({
  selector: 'sipra-reportes-documentos',
  standalone: true,
  imports: [EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .ancho { grid-column: 1 / -1; }
    .leyenda { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: -4px 0 14px; padding: 0; list-style: none; font-size: 12px; color: var(--text-secondary); }
    .ra-tabla td.mini { min-width: 140px; }
    .dims { display: inline-flex; gap: 2px; margin: 0 0 10px; padding: 2px; border: 1px solid var(--border-default); border-radius: 7px; }
    .dims button { height: 28px; padding: 0 12px; font: 500 12px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; border-radius: 5px; cursor: pointer; }
    .dims button[aria-pressed='true'] { color: var(--text-primary); background: color-mix(in srgb, var(--signal-active) 18%, transparent); font-weight: 600; }
    .dims button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <div class="ra-rejilla">
        <section class="ra-bloque ancho" aria-labelledby="d-salud">
          <h2 id="d-salud">Salud documental · ¿dónde están los problemas?</h2>
          <p class="ra-nota">{{ tasas.aprobacion.texto }} = {{ tasas.aprobacion.definicion }}. {{ tasas.devolucion.texto }} = {{ tasas.devolucion.definicion }}. {{ tasas.versiones.texto }} = {{ tasas.versiones.definicion }}. El volumen (devoluciones) crece con el tamaño del grupo; la tasa permite comparar. Ordenado de menor a mayor aprobación. El nombre filtra el reporte.</p>
          <div class="dims" role="group" aria-label="Agrupar la salud documental por">
            @for (d of dimensionesVisibles(); track d.id) { <button type="button" [attr.aria-pressed]="dimension() === d.id" (click)="dimension.set(d.id)">{{ d.texto }}</button> }
          </div>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Salud documental por {{ dimension() }}</caption>
              <thead><tr><th scope="col">{{ rotuloDimension() }}</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Exigidos</th><th scope="col" class="d">Aprobación</th><th scope="col"><span class="ra-sr">Estados de las obligaciones</span></th><th scope="col" class="d">En corrección</th><th scope="col" class="d">Devoluciones</th><th scope="col" class="d">Devol./doc.</th><th scope="col" class="d">Versiones/doc.</th></tr></thead>
              <tbody>
                @for (fila of salud(); track fila.clave) {
                  <tr>
                    <th scope="row"><button type="button" class="ra-ir" [attr.aria-pressed]="activo(fila.clave)" (click)="filtrar(fila.clave)">{{ fila.texto }}</button></th>
                    <td class="d">{{ fila.c.estudiantes }}</td>
                    <td class="d">{{ fila.c.exigidos }}</td>
                    <td class="d" [title]="fila.c.aprobados + ' / ' + fila.c.exigidos">{{ pct1(fila.c.aprobados, fila.c.exigidos) }}</td>
                    <td class="mini"><span class="ra-mini" aria-hidden="true">@for (c of categorias; track c.clave) { <span [class]="'t-' + (c.clase ?? c.tono)" [style.flex-grow]="fila.c.obligaciones[c.clave]"></span> }</span></td>
                    <td class="d">{{ fila.c.correccion }}</td>
                    <td class="d">{{ fila.c.devoluciones }}</td>
                    <td class="d" [title]="fila.c.devoluciones + ' / ' + fila.c.documentos">{{ razon(fila.c.devoluciones, fila.c.documentos) }}</td>
                    <td class="d" [title]="fila.c.versiones + ' / ' + fila.c.documentos">{{ razon(fila.c.versiones, fila.c.documentos) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="ra-bloque ancho" aria-labelledby="d-tipo">
          <h2 id="d-tipo">Obligaciones por tipo de documento</h2>
          <p class="ra-nota">Una obligación por documento exigido en cada práctica, según el estado de su última versión: las versiones nuevas no suman obligaciones. Cada cifra abre las prácticas de ese recorte.</p>
          <div class="ra-pila" aria-hidden="true">
            @for (p of total(); track p.clave) { <span [class]="'t-' + (p.clase ?? p.tono)" [style.flex-grow]="p.n" [title]="p.texto + ': ' + p.n"></span> }
          </div>
          <ul class="leyenda">
            @for (p of total(); track p.clave) { <li><span class="ra-punto" [class]="'t-' + (p.clase ?? p.tono)" aria-hidden="true"></span>{{ p.texto }} · <span class="ra-num">{{ p.n }}</span> ({{ p.pct }} %)</li> }
          </ul>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Obligaciones documentales por tipo y estado</caption>
              <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Exigidos</th>
                @for (c of categorias; track c.clave) { <th scope="col" class="d">{{ c.texto }}</th> }
                <th scope="col"><span class="ra-sr">Distribución</span></th></tr></thead>
              <tbody>
                @for (t of r.porTipo; track t.tipo) {
                  <tr>
                    <th scope="row">{{ t.tipo | etiqueta }}</th>
                    <td class="d">{{ t.exigidos }}</td>
                    @for (c of categorias; track c.clave) {
                      <td class="d">
                        @if (t[c.clave]) { <button type="button" class="ra-ir" (click)="estado.abrirDetalle({ tipo: t.tipo, estadoDocumental: c.clave })" [attr.aria-label]="(t.tipo | etiqueta) + ', ' + c.texto + ': ' + t[c.clave] + '. Ver prácticas'">{{ t[c.clave] }}</button> }
                        @else { <span class="ra-tenue">0</span> }
                      </td>
                    }
                    <td class="mini"><span class="ra-mini" aria-hidden="true">@for (c of categorias; track c.clave) { <span [class]="'t-' + (c.clase ?? c.tono)" [style.flex-grow]="t[c.clave]"></span> }</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="ra-bloque" aria-labelledby="d-fric">
          <h2 id="d-fric">Correcciones y versiones</h2>
          <p class="ra-nota">Por tipo: documentos (práctica y tipo), versiones cargadas, documentos con reenvío y decisiones de devolver o rechazar registradas en la auditoría.</p>
          @if (r.friccion.length) {
            <div class="ra-desliza">
              <table class="ra-tabla">
                <caption class="ra-sr">Versiones, reenvíos, devoluciones y rechazos por tipo de documento</caption>
                <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Docs.</th><th scope="col" class="d">Versiones</th><th scope="col" class="d">Prom.</th><th scope="col" class="d">Con reenvío</th><th scope="col" class="d">Devol.</th><th scope="col" class="d">Rech.</th></tr></thead>
                <tbody>@for (f of r.friccion; track f.tipo) {
                  <tr><th scope="row">{{ f.tipo | etiqueta }}</th><td class="d">{{ f.documentos }}</td><td class="d">{{ f.versiones }}</td><td class="d">{{ f.promedioVersiones }}</td><td class="d">{{ f.conReenvio }}</td><td class="d">{{ f.devoluciones }}</td><td class="d">{{ f.rechazos }}</td></tr>
                }</tbody>
              </table>
            </div>
          } @else { <p class="ra-nota">Aún no hay documentos cargados en este filtro.</p> }
        </section>

        <section class="ra-bloque" aria-labelledby="d-tiempo">
          <h2 id="d-tiempo">Tiempo de carga a decisión</h2>
          <p class="ra-nota">Desde la carga de cada versión hasta su decisión humana auditada. No se usa la fecha de actualización del registro. No hay meta de servicio definida institucionalmente, por eso no se muestra cumplimiento de SLA.</p>
          @if (r.tiempos.decisiones) {
            <p class="ra-nota" style="color:var(--text-primary)">Mediana <strong class="ra-num">{{ horas(r.tiempos.medianaHoras) }}</strong> · p90 <strong class="ra-num">{{ horas(r.tiempos.p90Horas) }}</strong> · {{ r.tiempos.decisiones }} decisiones</p>
            <table class="ra-tabla">
              <caption class="ra-sr">Mediana de horas de carga a decisión por tipo de documento</caption>
              <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Decisiones</th><th scope="col" class="d">Mediana</th></tr></thead>
              <tbody>@for (t of r.tiempos.porTipo; track t.tipo) { <tr><th scope="row">{{ t.tipo | etiqueta }}</th><td class="d">{{ t.decisiones }}</td><td class="d">{{ horas(t.medianaHoras) }}</td></tr> }</tbody>
            </table>
          } @else { <p class="ra-nota">Sin decisiones auditadas en este filtro.</p> }
        </section>
      </div>
    }
  `,
})
export class ReportesDocumentosComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly dimensiones = DIMENSIONES_SALUD;
  protected readonly dimension = signal<DimensionSalud>('programa');
  protected readonly tasas = TASAS;
  protected readonly pct1 = pct1;
  protected readonly razon = razon;
  private readonly pipe = new EtiquetaPipe();
  private readonly filtroDe: Record<DimensionSalud, keyof FiltrosAnalitica> = {
    programa: 'programa', ciclo: 'ciclo', semestre: 'semestre', modalidad: 'modalidad', periodo: 'periodos', receptor: 'tipoReceptor', sector: 'sector', ciudad: 'ciudad',
  };
  /** Semestre solo con el overlay sintético de pruebas; en producción la opción no aparece. */
  protected readonly dimensionesVisibles = computed(() => DIMENSIONES_SALUD.filter((d) => d.id !== 'semestre' || this.estado.datos()?.dimensiones.semestre === 'sintetica'));

  protected readonly rotuloDimension = computed(() => DIMENSIONES_SALUD.find((d) => d.id === this.dimension())?.texto ?? '');
  protected readonly salud = computed<FilaSalud[]>(() => {
    const r = this.estado.datos();
    if (!r) return [];
    const filas: FilaSalud[] = this.dimension() === 'programa' ? r.programas.map((p) => ({ clave: p.programa, texto: p.nombre ?? p.programa, c: p }))
      : this.dimension() === 'ciclo' ? [...r.niveles].sort((a, b) => compararNiveles(a.ciclo, b.ciclo)).map((n) => ({ clave: n.ciclo, texto: nivel(n.ciclo), c: n }))
        : this.dimension() === 'semestre' ? r.semestres.map((s) => ({ clave: s.semestre === null ? '' : String(s.semestre), texto: semestre(s.semestre), c: s }))
          : this.dimension() === 'receptor' ? r.receptores.filter((x) => x.tipo).map((x) => ({ clave: x.tipo as string, texto: RECEPTORES[x.tipo as TipoReceptor], c: x }))
          : this.dimension() === 'sector' ? r.sectores.map((x) => ({ clave: x.sector ?? SIN_DATO, texto: x.nombre ?? 'Sin información', c: x }))
          : this.dimension() === 'ciudad' ? r.ciudades.map((x) => ({ clave: x.ciudad ?? SIN_DATO, texto: x.nombre ?? 'Sin municipio registrado', c: x }))
          : this.dimension() === 'modalidad' ? r.modalidades.map((m) => ({ clave: m.modalidad, texto: this.pipe.transform(m.modalidad), c: m }))
            : [...r.periodos].sort((a, b) => segunOrden(r.ordenPeriodos)(a.periodo, b.periodo)).map((p) => ({ clave: p.periodo, texto: p.periodo, c: p }));
    if (['periodo', 'ciclo', 'semestre', 'receptor'].includes(this.dimension())) return filas;
    const tasa = (f: FilaSalud) => (f.c.exigidos ? f.c.aprobados / f.c.exigidos : 2);
    return filas.sort((a, b) => tasa(a) - tasa(b) || b.c.estudiantes - a.c.estudiantes);
  });

  protected activo(clave: string): boolean {
    const f = this.estado.filtros();
    return this.dimension() === 'periodo' ? f.periodos.length === 1 && f.periodos[0] === clave : f[this.filtroDe[this.dimension()]] === clave;
  }

  protected filtrar(clave: string): void {
    const d = this.dimension();
    if (d === 'semestre' && clave === '') return;
    if (d === 'periodo') this.estado.filtrar({ periodos: this.activo(clave) ? [] : [clave] });
    else this.estado.alternar(this.filtroDe[d] as 'programa' | 'ciclo' | 'semestre' | 'modalidad' | 'tipoReceptor' | 'sector' | 'ciudad', clave as never);
  }
  protected readonly categorias = CATEGORIAS_OBLIGACION;
  protected readonly horas = horas;
  protected readonly total = computed(() => { const r = this.estado.datos(); return r ? partes(CATEGORIAS_OBLIGACION, r.documental) : []; });
}
