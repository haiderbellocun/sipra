import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { FilaMatriculaSinu, Periodo, ResumenSincronizacion, VistaEstudianteSinu } from '@core/models/modelos';
import { leerError } from '@shared/utils/errores';

/** Apartado Vistas del SGP: consulta de correspondencia con SINU y sincronizador prácticas–docente. */
@Component({
  selector: 'sipra-vistas',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .dos { display:grid; gap:var(--sp-4); grid-template-columns:1fr; } @media (width >= 1000px) { .dos { grid-template-columns:1fr 1fr; align-items:start; } }
    .buscar { display:flex; gap:var(--sp-2); align-items:flex-end; flex-wrap:wrap; } .buscar .campo { margin:0; flex:1; min-width:200px; }
    .corr td.si { color:var(--ok); } .corr td.no { color:var(--peligro); font-weight:600; }
    .bloque { margin-top:var(--sp-3); } .bloque h3 { margin-bottom:var(--sp-1); }
    td.compacto { white-space:nowrap; }
  `],
  template: `
    <p class="pista" style="max-width:72ch;margin-bottom:var(--sp-4)">SINU es la fuente única de verdad académica. Aquí se consulta qué dice SINU del estudiante y qué hay en SGP, haya registrado o no, y se sincroniza la asignación docente.</p>

    <div class="dos">
      <section class="tarjeta">
        <h2>Consulta de estudiante</h2>
        <div class="buscar">
          <div class="campo"><label for="v-doc">Número de documento</label><input id="v-doc" [(ngModel)]="documento" (keyup.enter)="consultar()" /></div>
          <button type="button" class="boton boton--primario" (click)="consultar()" [disabled]="!documento().trim()">Consultar</button>
        </div>
        @if (vista(); as v) {
          <div class="bloque"><h3>SINU</h3>
            @if (v.matricula; as m) { <div class="linea-txt">{{ m.nombreEstudiante }} · {{ m.programaNombre }} ({{ m.programaId }}) · {{ m.ciclo }} · {{ m.periodoAcademico }} · {{ m.asignaturaPractica }}</div> }
            @else { <div class="pista">Sin matrícula de práctica en SINU para ese documento.</div> }</div>
          <div class="bloque"><h3>SGP</h3>
            @if (v.usuarioSgp; as u) { <div>{{ u.nombre }} · {{ u.correo }} · {{ u.activo ? 'activo' : 'inactivo' }}</div> } @else { <div class="pista">Sin usuario en SGP.</div> }
            @if (v.practica; as p) { <div style="margin-top:var(--sp-1)"><a [routerLink]="['/practicas', p.id]">FUR n.º {{ p.numeroFur ?? '—' }}</a> · {{ p.periodoAcademico }} · {{ p.estadoSgp }} · docente {{ p.tutorNombre ?? 'sin asignación' }}</div> }
            @else { <div class="pista">No ha registrado práctica.</div> }</div>
          <div class="bloque"><h3>Correspondencia</h3>
            <div class="tabla-envoltura"><table class="tabla corr"><thead><tr><th>Campo</th><th>SINU</th><th>SGP</th><th></th></tr></thead><tbody>
              @for (c of v.correspondencia; track c.campo) { <tr><td>{{ c.campo }}</td><td>{{ c.sinu ?? '—' }}</td><td>{{ c.sgp ?? '—' }}</td><td [class.si]="c.coincide" [class.no]="!c.coincide">{{ c.coincide ? '✓' : 'difiere' }}</td></tr> }
            </tbody></table></div></div>
        }
      </section>

      <section class="tarjeta">
        <h2>Sincronizador prácticas – docente</h2>
        <div class="buscar">
          <div class="campo"><label for="s-per">Periodo</label><select id="s-per" [(ngModel)]="periodo"><option value="">Seleccione…</option>@for (p of periodos(); track p.codigo) { <option [value]="p.codigo">{{ p.codigo }} · {{ p.nombre }}{{ p.sincronizacionDocentes ? '' : ' (sincronización apagada)' }}</option> }</select></div>
          <button type="button" class="boton" (click)="matriculas()" [disabled]="!periodo()">Ver matrículas SINU</button>
          @if (puedeSincronizar()) { <button type="button" class="boton boton--primario" (click)="sincronizar()" [disabled]="!periodo() || guardando()">Sincronizar docentes</button> }
        </div>
        @if (resumen(); as r) {
          <div class="aviso aviso--ok" style="margin-top:var(--sp-3)">Revisadas {{ r.practicasRevisadas }} · asignadas {{ r.asignadas }} · sin cambios {{ r.sinCambios }} · docentes creados {{ r.docentesCreados }} · sin docente en SINU {{ r.sinDocenteEnSinu.length }}</div>
        }
        @if (filas().length > 0) {
          <div class="tabla-envoltura" style="margin-top:var(--sp-3)"><table class="tabla"><thead><tr><th>Documento</th><th>Estudiante</th><th>Programa</th><th>SGP</th><th>Docente</th></tr></thead><tbody>
            @for (f of filas(); track f.matricula.documentoEstudiante) {
              <tr><td class="compacto">{{ f.matricula.documentoEstudiante }}</td><td>{{ f.matricula.nombreEstudiante }}</td><td>{{ f.matricula.programaId }}</td>
                <td class="compacto">@if (f.registradaEnSgp) { <a [routerLink]="['/practicas', f.practicaId]">{{ f.estadoSgp }}</a> } @else { <span class="etiqueta etiqueta--neutra">sin registro</span> }</td>
                <td>{{ f.tutorNombre ?? '—' }}</td></tr>
            }
          </tbody></table></div>
        }
      </section>
    </div>
  `,
})
export class VistasComponent implements OnInit {
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  readonly documento = signal(''); readonly periodo = signal('');
  readonly vista = signal<VistaEstudianteSinu | null>(null);
  readonly periodos = signal<Periodo[]>([]);
  readonly filas = signal<FilaMatriculaSinu[]>([]);
  readonly resumen = signal<ResumenSincronizacion | null>(null);
  readonly guardando = signal(false);
  readonly puedeSincronizar = computed(() => ['coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));

  async ngOnInit(): Promise<void> {
    try { const p = await firstValueFrom(this.api.listarPeriodos()); this.periodos.set(p); this.periodo.set(p.find((x) => x.vigente && x.activo)?.codigo ?? ''); } catch { /* sin periodos */ }
  }
  async consultar(): Promise<void> {
    try { this.vista.set(await firstValueFrom(this.api.vistaEstudianteSinu(this.documento().trim()))); } catch (error) { this.avisos.error(leerError(error)); }
  }
  async matriculas(): Promise<void> {
    try { this.filas.set(await firstValueFrom(this.api.matriculasSinu(this.periodo()))); } catch (error) { this.avisos.error(leerError(error)); }
  }
  async sincronizar(): Promise<void> {
    this.guardando.set(true);
    try { this.resumen.set(await firstValueFrom(this.api.sincronizarDocentes(this.periodo()))); await this.matriculas(); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }
}
