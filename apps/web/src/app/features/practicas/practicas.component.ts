import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { ModalidadCatalogo, Periodo, Practica } from '@core/models/modelos';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

/**
 * Gestión de prácticas (SGP, apartado Prácticas): la bandeja con los filtros
 * del manual de coordinación. El alcance se aplica en el servidor; aquí solo
 * se elige qué pedir.
 */
@Component({
  selector: 'sipra-practicas',
  standalone: true,
  imports: [EsqueletoComponent, RouterLink, FormsModule, DatePipe, EstadoComponent, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cab { display: flex; gap: var(--sp-3); align-items: flex-start; flex-wrap: wrap; margin-bottom: var(--sp-4); }
    .cab > div { flex: 1 1 30ch; }
    .cab p { margin: 0; }
    .filtros { display: grid; gap: var(--sp-2) var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); margin-bottom: var(--sp-3); }
    .filtros .campo { margin: 0; }
    .filtros .ancho { grid-column: 1 / -1; }
    .pie { display: flex; gap: var(--sp-3); align-items: center; flex-wrap: wrap; margin-bottom: var(--sp-3); }
    .pie .conteo { margin-left: auto; font-size: var(--fs-sm); color: var(--texto-tenue); }
    td.compacto { white-space: nowrap; }
    .barra { display: inline-block; width: 64px; height: 6px; border-radius: 3px; background: var(--superficie-2); overflow: hidden; vertical-align: middle; margin-right: 6px; }
    .barra span { display: block; height: 100%; background: var(--marca); }
    .barra.ok span { background: var(--ok); }
    .fur { font-family: var(--fuente-mono); font-size: var(--fs-xs); color: var(--texto-tenue); }
  `],
  template: `
    <div class="cab">
      <div>
        <h1>{{ sesion.rol() === 'estudiante' ? 'Mi práctica' : 'Gestión de prácticas' }}</h1>
        <p class="pista">
          @if (sesion.rol() === 'estudiante') {
            Su registro del periodo y el avance documental por momentos. Abra el expediente para cargar documentos y hablar con su docente.
          } @else {
            Consulta y validación de los registros del periodo vigente y de los anteriores. El alcance se aplica en el servidor: lo que no le corresponde no llega al navegador.
          }
        </p>
      </div>
      @if (sesion.rol() === 'estudiante') {
        <a routerLink="/registro" class="boton boton--primario">Registrar mi práctica</a>
      } @else if (['coordinador', 'administrador'].includes(sesion.rol() ?? '')) {
        <a routerLink="/registro" class="boton">Registro FUR administrativo</a>
      }
    </div>

    @if (sesion.esInterno()) {
      <div class="tarjeta compacto" style="margin-bottom:var(--sp-3)">
        <div class="filtros">
          <div class="campo ancho">
            <label for="f-busqueda">Buscar</label>
            <input id="f-busqueda" type="search" [(ngModel)]="f.busqueda" (keyup.enter)="consultar()"
                   placeholder="Documento, correo institucional o nombre del estudiante" />
          </div>
          <div class="campo">
            <label for="f-periodo">Periodo</label>
            <select id="f-periodo" [(ngModel)]="f.periodo">
              <option value="">Todos</option>
              @for (p of periodos(); track p.codigo) { <option [value]="p.codigo">{{ p.codigo }} · {{ p.nombre }}</option> }
            </select>
          </div>
          <div class="campo">
            <label for="f-programa">Programa</label>
            <input id="f-programa" [(ngModel)]="f.programa" placeholder="Código, p. ej. ADM-PRO" />
          </div>
          <div class="campo">
            <label for="f-regional">Regional</label>
            <input id="f-regional" [(ngModel)]="f.regional" placeholder="Bogotá, Medellín…" />
          </div>
          <div class="campo">
            <label for="f-modalidad">Modalidad de práctica</label>
            <select id="f-modalidad" [(ngModel)]="f.modalidad">
              <option value="">Todas</option>
              @for (m of modalidades(); track m.modalidad) { <option [value]="m.modalidad">{{ m.etiquetaSgp }}</option> }
            </select>
          </div>
          <div class="campo">
            <label for="f-estado">Estado</label>
            <select id="f-estado" [(ngModel)]="f.estado">
              <option value="">Todos</option>
              @for (e of estados; track e.valor) { <option [value]="e.valor">{{ e.etiqueta }}</option> }
            </select>
          </div>
          <div class="campo">
            <label for="f-asignacion">Asignación docente</label>
            <select id="f-asignacion" [(ngModel)]="f.asignacion">
              <option value="">Todas</option>
              <option value="asignado">Asignado</option>
              <option value="sin_asignacion">Sin asignación</option>
            </select>
          </div>
          <div class="campo">
            <label for="f-nivel">Nivel de práctica</label>
            <select id="f-nivel" [(ngModel)]="f.nivel">
              <option value="">Todos</option>
              <option value="tecnico">Técnico</option>
              <option value="tecnologo">Tecnólogo</option>
              <option value="profesional">Profesional</option>
            </select>
          </div>
          <div class="campo">
            <label for="f-desde">Movimiento desde</label>
            <input id="f-desde" type="date" [(ngModel)]="f.movimientoDesde" />
          </div>
          <div class="campo">
            <label for="f-hasta">Movimiento hasta</label>
            <input id="f-hasta" type="date" [(ngModel)]="f.movimientoHasta" />
          </div>
          <div class="campo">
            <label for="f-cargado">% cargados mínimo</label>
            <input id="f-cargado" type="number" min="0" max="100" [(ngModel)]="f.cargadoMinimo" />
          </div>
          <div class="campo">
            <label for="f-aprobado">% aprobados mínimo</label>
            <input id="f-aprobado" type="number" min="0" max="100" [(ngModel)]="f.aprobadoMinimo" />
          </div>
          <div class="campo">
            <label for="f-cantidad">Cantidad</label>
            <select id="f-cantidad" [(ngModel)]="f.cantidad">
              <option [ngValue]="50">50</option><option [ngValue]="200">200</option><option [ngValue]="500">500</option>
            </select>
          </div>
        </div>
        <div class="pie">
          <button type="button" class="boton boton--primario" (click)="consultar()" [disabled]="cargando()">Filtrar</button>
          <button type="button" class="boton" (click)="limpiar()">Limpiar</button>
          <select class="boton compacto" [(ngModel)]="filtroSenal" aria-label="Señal de acompañamiento">
            <option value="">Todas las señales</option>
            <option value="en_riesgo">En riesgo</option>
            <option value="requiere_atencion">Requiere atención</option>
            <option value="al_dia">Al día</option>
          </select>
          <span class="conteo">{{ visibles().length }} registro(s)</span>
        </div>
      </div>
    }

    <div class="tarjeta" style="padding:0">
      @if (cargando()) {
        <sipra-esqueleto tipo="filas" [cantidad]="6" />
      } @else if (visibles().length === 0) {
        <div class="vacio">
          <img src="assets/ilustraciones/sinresultados.svg" alt="" width="600" height="360" />
          @if (sesion.rol() === 'estudiante') { <strong>Sin práctica registrada</strong><span>Aún no tiene una práctica registrada en este periodo.</span> <a routerLink="/registro" class="boton compacto boton--primario">Registrar mi práctica</a> }
          @else { <strong>Sin resultados</strong><span>No hay registros que coincidan con el filtro.</span> }
        </div>
      } @else {
        <div class="tabla-envoltura">
          <table class="tabla">
            <thead>
              <tr>
                <th>FUR</th>
                <th>Estudiante</th>
                <th>Periodo</th>
                <th>Modalidad</th>
                <th>Empresa</th>
                <th>Docente</th>
                <th>Estado</th>
                <th>Cargados / aprobados</th>
                @if (sesion.esInterno()) { <th>Señal</th> }
                <th>Último movimiento</th>
              </tr>
            </thead>
            <tbody>
              @for (p of visibles(); track p.id) {
                <tr>
                  <td class="compacto fur">{{ p.numeroFur ?? '—' }}</td>
                  <td>
                    <a [routerLink]="['/practicas', p.id]">{{ p.estudianteNombre }}</a>
                    <div class="pista">{{ p.programaId }} · {{ p.ciclo | etiqueta }}{{ p.regional ? ' · ' + p.regional : '' }}</div>
                  </td>
                  <td class="compacto">{{ p.periodoAcademico }}</td>
                  <td>{{ p.modalidad | etiqueta }}</td>
                  <td>{{ p.empresaRazonSocial ?? '—' }}</td>
                  <td>{{ p.tutorNombre ?? (veDocente() ? 'Sin asignación' : '—') }}</td>
                  <td class="compacto"><sipra-estado [valor]="p.estado" /><div class="pista">{{ p.estadoSgp }}</div></td>
                  <td class="compacto num">
                    @if (veAvance()) {
                      <span class="barra"><span [style.width.%]="p.avance.porcentajeCargado"></span></span>{{ p.avance.porcentajeCargado }} %
                      <br>
                      <span class="barra ok"><span [style.width.%]="p.avance.porcentajeAprobado"></span></span>{{ p.avance.porcentajeAprobado }} %
                    } @else { — }
                  </td>
                  @if (sesion.esInterno()) { <td class="compacto"><sipra-estado [valor]="p.senal" /></td> }
                  <td class="compacto pista">{{ p.ultimaActividad | date: 'd MMM y' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class PracticasComponent implements OnInit {
  readonly sesion = inject(SesionService);
  /** El avance documental y el docente solo se muestran a quien los recibe del servidor. */
  readonly veAvance = computed(() => ['estudiante', 'tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly veDocente = computed(() => !['empresa', 'extension'].includes(this.sesion.rol() ?? ''));
  private readonly api = inject(ApiService);

  readonly practicas = signal<Practica[]>([]);
  readonly periodos = signal<Periodo[]>([]);
  readonly modalidades = signal<ModalidadCatalogo[]>([]);
  readonly cargando = signal(true);
  readonly filtroSenal = signal('');

  /** Filtros del formulario (objeto mutable enlazado con ngModel). */
  readonly f = {
    busqueda: '', periodo: '', programa: '', regional: '', modalidad: '', estado: '', asignacion: '' as '' | 'asignado' | 'sin_asignacion',
    nivel: '', movimientoDesde: '', movimientoHasta: '', cargadoMinimo: null as number | null, aprobadoMinimo: null as number | null,
    cantidad: 200,
  };

  readonly estados = [
    { valor: 'inscrita', etiqueta: 'Inscrito (registro)' }, { valor: 'documentacion', etiqueta: 'Inscrito (en documentación)' },
    { valor: 'en_validacion', etiqueta: 'Inscrito (en validación)' }, { valor: 'activa', etiqueta: 'En práctica' },
    { valor: 'finalizada', etiqueta: 'En práctica (finalizada)' }, { valor: 'certificada', etiqueta: 'Cerrado' },
    { valor: 'reprobada', etiqueta: 'Reprueba' }, { valor: 'anulada', etiqueta: 'Anulado' },
    { valor: 'suspendida', etiqueta: 'Suspendida' }, { valor: 'cancelada', etiqueta: 'Cancelada' },
  ];

  readonly visibles = computed(() => {
    const senal = this.filtroSenal();
    return this.practicas().filter((p) => !senal || p.senal === senal);
  });

  async ngOnInit(): Promise<void> {
    if (this.sesion.esInterno()) {
      void firstValueFrom(this.api.listarPeriodos()).then((p) => this.periodos.set(p)).catch(() => undefined);
      void firstValueFrom(this.api.catalogoModalidades()).then((m) => this.modalidades.set(m)).catch(() => undefined);
    }
    await this.consultar();
  }

  async consultar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.practicas.set(await firstValueFrom(this.api.listarPracticas({
        ...this.f,
        cargadoMinimo: this.f.cargadoMinimo ?? undefined,
        aprobadoMinimo: this.f.aprobadoMinimo ?? undefined,
      })));
    } catch {
      this.practicas.set([]);
    } finally {
      this.cargando.set(false);
    }
  }

  async limpiar(): Promise<void> {
    Object.assign(this.f, {
      busqueda: '', periodo: '', programa: '', regional: '', modalidad: '', estado: '', asignacion: '', nivel: '',
      movimientoDesde: '', movimientoHasta: '', cargadoMinimo: null, aprobadoMinimo: null, cantidad: 200,
    });
    this.filtroSenal.set('');
    await this.consultar();
  }
}
