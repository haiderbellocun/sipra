import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { firstValueFrom } from 'rxjs';
import { entorno } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { EstadoCatalogo, Periodo, ReporteTabla } from '@core/models/modelos';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { descargarBlob, leerError, nombreDeCabecera } from '@shared/utils/errores';

type ReporteSgp = 'practicas' | 'bitacoras' | 'cartas';

@Component({
  selector: 'sipra-reportes',
  standalone: true,
  imports: [EsqueletoComponent, DecimalPipe, DatePipe, FormsModule, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .catalogo { padding:0.8rem 0; border-bottom:1px solid var(--borde); display:grid; gap:0.35rem; }
    .catalogo:last-child { border-bottom:none; }
    .fila { display:flex; gap:0.7rem; align-items:center; flex-wrap:wrap; }
    .fila .nombre { font-weight:640; flex:1; min-width:180px; }
    .barra { height:6px; border-radius:3px; background:var(--superficie-2); overflow:hidden; }
    .barra span { display:block; height:100%; background:var(--ok); }
    .barra.parcial span { background:var(--aviso); }
    .acciones { display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:1rem; }
    .sgp { display:grid; gap:var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr)); }
    .sgp .campo { margin-bottom:var(--sp-2); }
    .et-campo { font-size:var(--fs-sm); font-weight:600; color:var(--texto-tenue); }
    .chk { display:inline-flex; gap:4px; align-items:center; white-space:nowrap; min-width:max-content; }
    .vista td, .vista th { font-size:var(--fs-xs); white-space:nowrap; }
  `],
  template: `
    <h1>Reportes del proceso de prácticas</h1>
    <p class="pista" style="max-width:74ch;margin-bottom:1.2rem">Bases en Excel con las columnas del manual de coordinación. Cada generación queda en la auditoría. El alcance de su perfil acota lo que sale.</p>
    <div class="sgp" style="margin-bottom:1.2rem">
      <div class="tarjeta">
        <h2>Reporte de prácticas</h2>
        <div class="campo"><span class="et-campo">Periodos</span>
          <div style="display:flex;flex-wrap:wrap;gap:var(--sp-1) var(--sp-3);font-size:var(--fs-sm)">
            @for (p of periodos(); track p.codigo) { <label class="chk"><input type="checkbox" [checked]="periodosSel().includes(p.codigo)" (change)="alternarPeriodo(p.codigo)" /> {{ p.codigo }}</label> }
          </div></div>
        <div class="campo"><label for="rp-mod">Modalidad</label><input id="rp-mod" [(ngModel)]="rpModalidad" placeholder="Código, p. ej. pasantia (vacío = todas)" /></div>
        <div class="campo"><label for="rp-est">Estado</label><select id="rp-est" [(ngModel)]="rpEstado"><option value="">Todos</option><option value="inscrita">Inscrito</option><option value="activa">En práctica</option><option value="certificada">Cerrado</option><option value="reprobada">Reprueba</option><option value="anulada">Anulado</option></select></div>
        <div class="acciones" style="margin-top:0"><button type="button" class="boton boton--primario" [class.cargando]="ocupado()" [disabled]="ocupado() || periodosSel().length === 0" (click)="sgp('practicas', 'xlsx')">Descargar Excel</button><button type="button" class="boton" [disabled]="ocupado() || periodosSel().length === 0" (click)="sgp('practicas', 'json')">Vista previa</button></div>
      </div>
      <div class="tarjeta">
        <h2>Reporte de bitácoras</h2>
        <div class="campo"><label for="rb-tipo">Tipo</label><select id="rb-tipo" [(ngModel)]="rbTipo"><option value="seguimiento">Bitácora de seguimiento</option><option value="evalua_tu_proceso">Evalúa tu proceso</option><option value="mensaje_libre">Mensaje libre</option><option value="calificacion_docente">Calificación docente</option></select></div>
        <div class="campo"><label for="rb-per">Periodo</label><select id="rb-per" [(ngModel)]="rbPeriodo"><option value="">Todos</option>@for (p of periodos(); track p.codigo) { <option [value]="p.codigo">{{ p.codigo }}</option> }</select></div>
        <div class="campo"><label for="rb-est">Estado de la práctica</label><select id="rb-est" [(ngModel)]="rbEstado"><option value="">Todos</option><option value="activa">En práctica</option><option value="certificada">Cerrado</option><option value="reprobada">Reprueba</option></select></div>
        <div class="acciones" style="margin-top:0"><button type="button" class="boton boton--primario" [class.cargando]="ocupado()" [disabled]="ocupado()" (click)="sgp('bitacoras', 'xlsx')">Descargar Excel</button><button type="button" class="boton" [disabled]="ocupado()" (click)="sgp('bitacoras', 'json')">Vista previa</button></div>
      </div>
      <div class="tarjeta">
        <h2>Reporte de cartas</h2>
        <div class="campo"><label for="rc-per">Periodo</label><select id="rc-per" [(ngModel)]="rcPeriodo"><option value="">Todos</option>@for (p of periodos(); track p.codigo) { <option [value]="p.codigo">{{ p.codigo }}</option> }</select></div>
        <div class="campo"><label for="rc-desde">Desde</label><input id="rc-desde" type="date" [(ngModel)]="rcDesde" /></div>
        <div class="campo"><label for="rc-hasta">Hasta</label><input id="rc-hasta" type="date" [(ngModel)]="rcHasta" /></div>
        <div class="acciones" style="margin-top:0"><button type="button" class="boton boton--primario" [class.cargando]="ocupado()" [disabled]="ocupado()" (click)="sgp('cartas', 'xlsx')">Descargar Excel</button><button type="button" class="boton" [disabled]="ocupado()" (click)="sgp('cartas', 'json')">Vista previa</button></div>
      </div>
    </div>
    @if (vista(); as v) {
      <div class="tarjeta" style="margin-bottom:1.2rem;padding:0">
        <div style="padding:var(--sp-3) var(--sp-4);display:flex;gap:var(--sp-3);align-items:center"><strong>Vista previa</strong><span class="pista">{{ v.total }} fila(s) · se muestran hasta 50</span><button type="button" class="boton compacto" style="margin-left:auto" (click)="vista.set(null)">Cerrar</button></div>
        <div class="tabla-envoltura"><table class="tabla vista"><thead><tr>@for (c of v.columnas; track c.clave) { <th>{{ c.encabezado }}</th> }</tr></thead>
          <tbody>@for (f of v.filas.slice(0, 50); track $index) { <tr>@for (c of v.columnas; track c.clave) { <td>{{ celda(f[c.clave]) }}</td> }</tr> }</tbody></table></div>
      </div>
    }

    @if (esRegulatorio()) {
    <h1 style="margin-top:var(--sp-6)">Reportes regulatorios</h1>
    <p class="pista" style="max-width:74ch;margin-bottom:1.2rem">
      Archivos para la Unidad del Servicio Público de Empleo. Solo entran las vacantes en marco
      laboral: las de marco práctica son un requisito académico y no constituyen intermediación.
    </p>


    @if (bloqueado()) {
      <div class="aviso aviso--error" style="margin-bottom:1.2rem;max-width:78ch">
        <strong>Los archivos no son radicables todavía.</strong> Un archivo con códigos fuera de la
        nomenclatura oficial se radica, queda en firme y luego hay que corregirlo ante la entidad.
        Por eso, en preproducción y producción, el sistema se niega a generarlos mientras un
        catálogo requerido siga incompleto.
      </div>
    }

    <div class="tarjeta" style="margin-bottom:1.2rem">
      <h2>Catálogos oficiales</h2>
      @if (cargando()) {
        <sipra-esqueleto tipo="bloque" />
      } @else {
        @for (catalogo of catalogos(); track catalogo.nombre) {
          <div class="catalogo">
            <div class="fila">
              <span class="nombre">{{ catalogo.nombre | etiqueta }}</span>
              <span class="etiqueta"
                    [class.etiqueta--ok]="catalogo.estado === 'completo'"
                    [class.etiqueta--aviso]="catalogo.estado === 'parcial'"
                    [class.etiqueta--peligro]="catalogo.estado === 'ausente'">
                {{ catalogo.estado }}
              </span>
              <span class="pista mono">
                {{ catalogo.filasCargadas | number }} de
                {{ catalogo.filasEsperadas === null ? '—' : (catalogo.filasEsperadas | number) }}
              </span>
            </div>
            <div class="barra" [class.parcial]="catalogo.estado !== 'completo'">
              <span [style.width.%]="porcentaje(catalogo)"></span>
            </div>
            @if (catalogo.justificacion) {
              <div class="pista">{{ catalogo.justificacion }}</div>
            }
          </div>
        }
      }
    </div>

    <div class="tarjeta">
      <h2>Generar archivos</h2>
      <p class="pista">
        Cada generación queda en la auditoría con el hash del archivo producido, que es lo que
        se conserva junto al acuse para poder demostrar después qué se envió exactamente.
      </p>
      <div class="acciones">
        <button type="button" class="boton boton--primario" [disabled]="descargando() !== null"
                (click)="descargar('vacantes')">
          {{ descargando() === 'vacantes' ? 'Generando…' : 'Archivo de vacantes' }}
        </button>
        <button type="button" class="boton" [disabled]="descargando() !== null"
                (click)="descargar('plazas')">
          {{ descargando() === 'plazas' ? 'Generando…' : 'Archivo de plazas de práctica' }}
        </button>
      </div>
      @if (ultimo(); as u) {
        <div class="aviso" style="margin-top:1rem"
             [class.aviso--ok]="u.radicable" [class.aviso--info]="!u.radicable">
          <strong>{{ u.nombre }}</strong> · {{ u.registros }} registro(s) ·
          {{ u.radicable ? 'radicable' : 'borrador, no radicar' }}
          <div class="pista mono" style="margin-top:0.3rem">sha256 {{ u.hash }}</div>
          <div class="pista">generado {{ u.momento | date: 'd MMM y, HH:mm' }}</div>
        </div>
      }
    </div>
    }
  `,
})
export class ReportesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  readonly sesion = inject(SesionService);

  readonly periodos = signal<Periodo[]>([]);
  readonly periodosSel = signal<string[]>([]);
  readonly vista = signal<ReporteTabla | null>(null);
  readonly ocupado = signal(false);
  readonly rpModalidad = signal(''); readonly rpEstado = signal('');
  readonly rbTipo = signal('seguimiento'); readonly rbPeriodo = signal(''); readonly rbEstado = signal('');
  readonly rcPeriodo = signal(''); readonly rcDesde = signal(''); readonly rcHasta = signal('');
  readonly esRegulatorio = computed(() => ['administrador', 'extension', 'coordinador'].includes(this.sesion.rol() ?? ''));

  alternarPeriodo(codigo: string): void { this.periodosSel.update((l) => (l.includes(codigo) ? l.filter((x) => x !== codigo) : [...l, codigo])); }
  celda(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 16).replace('T', ' ');
    return String(v);
  }

  private filtroSgp(reporte: ReporteSgp): Record<string, string | undefined> {
    switch (reporte) {
      case 'practicas': return { periodos: this.periodosSel().join(','), modalidad: this.rpModalidad() || undefined, estado: this.rpEstado() || undefined };
      case 'bitacoras': return { tipo: this.rbTipo(), periodo: this.rbPeriodo() || undefined, estado: this.rbEstado() || undefined };
      default: return { periodo: this.rcPeriodo() || undefined, desde: this.rcDesde() || undefined, hasta: this.rcHasta() || undefined };
    }
  }

  async sgp(reporte: ReporteSgp, formato: 'xlsx' | 'json'): Promise<void> {
    this.ocupado.set(true);
    try {
      if (formato === 'json') { this.vista.set(await firstValueFrom(this.api.reporteSgpTabla(reporte, this.filtroSgp(reporte)))); }
      else {
        const r = await firstValueFrom(this.api.reporteSgpExcel(reporte, this.filtroSgp(reporte)));
        descargarBlob(r.body as Blob, nombreDeCabecera(r.headers.get('content-disposition'), `${reporte}.xlsx`));
        this.avisos.exito(`Excel generado con ${r.headers.get('x-filas') ?? '?'} fila(s) y registrado en la auditoría.`);
      }
    } catch (error) { this.avisos.error(leerError(error)); }
    finally { this.ocupado.set(false); }
  }

  readonly catalogos = signal<EstadoCatalogo[]>([]);
  readonly cargando = signal(true);
  readonly descargando = signal<'vacantes' | 'plazas' | null>(null);
  readonly ultimo = signal<{
    nombre: string; registros: string; hash: string; radicable: boolean; momento: Date;
  } | null>(null);

  /** Los catálogos que el reporte necesita para producir un archivo radicable. */
  private readonly requeridos = ['cno', 'ciiu', 'divipola_municipio', 'nivel_educativo'];

  readonly bloqueado = computed(() =>
    this.catalogos().some((c) => this.requeridos.includes(c.nombre) && c.estado !== 'completo'),
  );

  async ngOnInit(): Promise<void> {
    void firstValueFrom(this.api.listarPeriodos()).then((p) => { this.periodos.set(p); this.periodosSel.set(p.filter((x) => x.vigente && x.activo).map((x) => x.codigo)); }).catch(() => undefined);
    if (!this.esRegulatorio()) { this.cargando.set(false); return; }
    try {
      this.catalogos.set(
        await firstValueFrom(
          this.http.get<EstadoCatalogo[]>(`${entorno.apiBase}/reportes/catalogos`),
        ),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  porcentaje(catalogo: EstadoCatalogo): number {
    if (!catalogo.filasEsperadas) return catalogo.filasCargadas > 0 ? 100 : 0;
    return Math.min(100, Math.round((catalogo.filasCargadas / catalogo.filasEsperadas) * 100));
  }

  async descargar(tipo: 'vacantes' | 'plazas'): Promise<void> {
    this.descargando.set(tipo);
    try {
      const respuesta = await firstValueFrom(
        this.http.get(`${entorno.apiBase}/reportes/spe/${tipo}`, {
          observe: 'response',
          responseType: 'text',
        }),
      );
      const nombre =
        respuesta.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        `${tipo}.txt`;

      this.ultimo.set({
        nombre,
        registros: respuesta.headers.get('x-sipra-registros') ?? '0',
        hash: respuesta.headers.get('x-sipra-hash') ?? '',
        radicable: respuesta.headers.get('x-sipra-radicable') === 'true',
        momento: new Date(),
      });

      this.guardarArchivo(nombre, respuesta.body ?? '');
      this.avisos.exito('Archivo generado y registrado en la auditoría.');
    } catch (error) {
      const cuerpo = error instanceof HttpErrorResponse
        ? (error.error as { mensaje?: string; message?: string } | null)
        : null;
      this.avisos.error(cuerpo?.mensaje ?? cuerpo?.message ?? 'No fue posible generar el archivo.');
    } finally {
      this.descargando.set(null);
    }
  }

  private guardarArchivo(nombre: string, contenido: string): void {
    const url = URL.createObjectURL(new Blob([contenido], { type: 'text/plain;charset=utf-8' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(url);
  }
}
