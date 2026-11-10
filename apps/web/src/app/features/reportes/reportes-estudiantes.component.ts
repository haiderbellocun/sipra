import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { porcentaje } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Estudiantes y prácticas por escuela → programa, modalidad, estado y empresa. Sin ranking de personas: las filas son
 * unidades académicas o empresas; el detalle por estudiante solo aparece al abrir un recorte.
 */
@Component({
  selector: 'sipra-reportes-estudiantes',
  standalone: true,
  imports: [EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .cob { display: grid; grid-template-columns: minmax(80px, 1fr) 3rem; gap: 8px; align-items: center; }
    .ancho { grid-column: 1 / -1; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <div class="ra-rejilla">
        <section class="ra-bloque ancho" aria-labelledby="e-esc">
          <h2 id="e-esc">Escuelas y programas</h2>
          <p class="ra-nota">Estudiantes únicos (una persona con dos prácticas cuenta una vez) y prácticas. La cobertura es la proporción de documentos exigidos ya aprobados.</p>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Estudiantes, prácticas y cobertura por escuela y programa</caption>
              <thead><tr><th scope="col">Escuela / programa</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Completos</th><th scope="col" class="d">En corrección</th><th scope="col" style="min-width:150px">Aprobado</th></tr></thead>
              <tbody>
                @for (e of r.escuelas; track e.escuela) {
                  <tr>
                    <th scope="row"><button type="button" class="ra-abrir" [attr.aria-expanded]="abiertas().has(e.escuela)" [attr.aria-controls]="'prog-' + e.escuela" (click)="alternar(e.escuela)"><span class="ra-sr">Programas de {{ e.nombre }}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4"/></svg></button>{{ e.nombre }}</th>
                    <td class="d">{{ e.estudiantes }}</td>
                    <td class="d"><button type="button" class="ra-ir" (click)="estado.abrirDetalle({ escuela: e.escuela })">{{ e.practicas }}</button></td>
                    <td class="d">{{ e.completos }}</td>
                    <td class="d">{{ e.correccion }}</td>
                    <td><span class="cob"><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pct(e.aprobados, e.exigidos) ?? 0"></span></span><span class="d ra-num">{{ pct(e.aprobados, e.exigidos) ?? '—' }} %</span></span></td>
                  </tr>
                  @if (abiertas().has(e.escuela)) {
                    @for (p of e.programas; track p.programa) {
                      <tr class="sub" [attr.id]="$first ? 'prog-' + e.escuela : null">
                        <td>{{ p.programa }}</td>
                        <td class="d">{{ p.estudiantes }}</td>
                        <td class="d"><button type="button" class="ra-ir" (click)="estado.abrirDetalle({ escuela: e.escuela, programa: p.programa })">{{ p.practicas }}</button></td>
                        <td class="d">{{ p.completos }}</td>
                        <td class="d">{{ p.correccion }}</td>
                        <td><span class="cob"><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pct(p.aprobados, p.exigidos) ?? 0"></span></span><span class="d ra-num">{{ pct(p.aprobados, p.exigidos) ?? '—' }} %</span></span></td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="ra-bloque" aria-labelledby="e-mod">
          <h2 id="e-mod">Modalidades</h2>
          <p class="ra-nota">Cada modalidad tiene su propia matriz documental.</p>
          <table class="ra-tabla">
            <caption class="ra-sr">Prácticas por modalidad</caption>
            <thead><tr><th scope="col">Modalidad</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Aprobado</th></tr></thead>
            <tbody>
              @for (m of r.modalidades; track m.modalidad) {
                <tr><th scope="row">{{ m.modalidad | etiqueta }}</th><td class="d">{{ m.estudiantes }}</td>
                  <td class="d"><button type="button" class="ra-ir" (click)="estado.abrirDetalle({ modalidad: m.modalidad })">{{ m.practicas }}</button></td>
                  <td class="d">{{ pct(m.aprobados, m.exigidos) ?? '—' }} %</td></tr>
              }
            </tbody>
          </table>
        </section>

        <section class="ra-bloque" aria-labelledby="e-est">
          <h2 id="e-est">Estado de la práctica</h2>
          <p class="ra-nota">Estado registrado en la práctica (no es el estado documental).</p>
          <table class="ra-tabla">
            <caption class="ra-sr">Prácticas por estado</caption>
            <thead><tr><th scope="col">Estado</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">%</th></tr></thead>
            <tbody>
              @for (e of r.estadosPractica; track e.estado) {
                <tr><th scope="row">{{ e.estado | etiqueta }}</th><td class="d">{{ e.practicas }}</td><td class="d ra-tenue">{{ pct(e.practicas, r.resumen.practicas) }} %</td></tr>
              }
            </tbody>
          </table>
        </section>

        <section class="ra-bloque ancho" aria-labelledby="e-emp">
          <h2 id="e-emp">Empresas con más prácticas</h2>
          <p class="ra-nota">Las diez primeras del filtro, por razón social registrada. Las prácticas sin empresa no se listan.</p>
          @if (r.empresas.length) {
            <table class="ra-tabla">
              <caption class="ra-sr">Empresas por número de prácticas</caption>
              <thead><tr><th scope="col">Empresa</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Estudiantes</th></tr></thead>
              <tbody>@for (e of r.empresas; track e.empresa) { <tr><th scope="row">{{ e.empresa }}</th><td class="d">{{ e.practicas }}</td><td class="d">{{ e.estudiantes }}</td></tr> }</tbody>
            </table>
          } @else {
            <p class="ra-nota">Ninguna práctica del filtro tiene empresa registrada.</p>
          }
        </section>
      </div>
    }
  `,
})
export class ReportesEstudiantesComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly abiertas = signal<ReadonlySet<string>>(new Set());
  protected readonly pct = porcentaje;

  protected alternar(escuela: string): void {
    this.abiertas.update((s) => { const n = new Set(s); if (n.has(escuela)) n.delete(escuela); else n.add(escuela); return n; });
  }
}
