import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { Periodo, Practica, TableroCumplimiento } from '@core/models/modelos';
import { CronogramaComponent } from '@shared/components/cronograma.component';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

/**
 * Inicio orientado al perfil.
 *
 * Para el tutor la vista no es una bandeja de documentos sino una bandeja de
 * estudiantes, ordenada por señal de riesgo: responde a *a quién debo llamar
 * hoy*, no a *qué documento falta*.
 */
@Component({
  selector: 'sipra-inicio',
  standalone: true,
  imports: [EsqueletoComponent, RouterLink, EstadoComponent, EtiquetaPipe, CronogramaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .saludo { margin-bottom: var(--sp-5); display: flex; gap: var(--sp-4); align-items: flex-end; flex-wrap: wrap; }
    .saludo > div { flex: 1 1 32ch; }
    .saludo h1 { font-size: var(--fs-2xl); margin-bottom: var(--sp-1); }
    .saludo p { color: var(--texto-tenue); max-width: 68ch; margin: 0; }
    .saludo .fecha { color: var(--texto-tenue); font-size: var(--fs-sm); }
    .cifras {
      display: grid; gap: var(--sp-3); margin-bottom: var(--sp-5);
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 168px), 1fr));
    }
    .cifra { position: relative; }
    .cifra::before {
      content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; border-radius: 3px 0 0 3px;
      background: var(--borde);
    }
    .cifra.tono-peligro::before { background: var(--peligro); }
    .cifra.tono-aviso::before   { background: var(--aviso); }
    .cifra.tono-ok::before      { background: var(--ok); }
    .cifra.tono-peligro .n { color: var(--peligro); }
    .cifra.tono-aviso .n   { color: var(--aviso); }
    .cifra.tono-ok .n      { color: var(--ok); }
    .fila {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: var(--sp-3) 0; border-bottom: 1px solid var(--borde);
    }
    .fila:last-child { border-bottom: none; padding-bottom: 0; }
    .fila .quien { flex: 1; min-width: 0; }
    .fila .nombre { font-weight: 600; font-size: var(--fs-sm); }
    .fila .detalle { font-size: var(--fs-xs); color: var(--texto-tenue); margin-top: 1px; }
    .disparadores { font-size: var(--fs-xs); color: var(--peligro); margin-top: var(--sp-1); }
    .estados { display: flex; gap: var(--sp-2); flex-wrap: wrap; justify-content: flex-end; }
    .cab { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-2); }
    .cab h2 { margin: 0; }
    .dosc { display:grid; gap:var(--sp-4); grid-template-columns:1fr; } @media (width >= 1000px) { .dosc { grid-template-columns:minmax(0,1.5fr) minmax(0,1fr); align-items:start; } }
  `],
  template: `
    <div class="saludo">
      <div>
        <p class="et-sec">{{ etiquetaRol() }}</p>
        <h1>Hola, {{ sesion.sesion()?.nombre }}</h1>
        @switch (sesion.rol()) {
          @case ('estudiante') {
            <p>Su ruta: carta de presentación → registrar la práctica → solicitud de ARL (si la CUN la cubre) → cargar los documentos por momento → bitácora con su docente → cierre y nota.</p>
          }
          @case ('auxiliar') {
            <p>Validación de las solicitudes de ARL de las modalidades articuladas y revisión documental. Las aprobadas van a Capital Social en el consolidado diario.</p>
          }
          @case ('tutor') {
            <p>
              Sus estudiantes ordenados por señal de acompañamiento. La señal no es un estado: es un
              cálculo sobre la práctica que responde a quién conviene llamar hoy.
            </p>
          }
          @case ('empresa') {
            <p>Sus practicantes activos y las vacantes que ha publicado.</p>
          }
          @default {
            <p>Panorama institucional del proceso de prácticas y su cumplimiento normativo.</p>
          }
        }
      </div>
      <div class="fecha">{{ hoy }}</div>
    </div>

    @if (sesion.rol() === 'estudiante') {
      <div class="acciones" style="margin-bottom:var(--sp-5)">
        <a routerLink="/registro" class="boton boton--primario">{{ practicas().length ? 'Carta y registro' : 'Registrar mi práctica' }}</a>
        @if (practicas()[0]; as p) { <a [routerLink]="['/practicas', p.id]" class="boton">Gestionar mi práctica</a> }
        <a routerLink="/arl" class="boton">Solicitud de ARL</a>
        <a routerLink="/ayuda" class="boton">Centro de ayuda</a>
        <a routerLink="/pqrs" class="boton">PQRS</a>
      </div>
    }
    @if (sesion.rol() === 'auxiliar') {
      <div class="acciones" style="margin-bottom:var(--sp-5)">
        <a routerLink="/arl" class="boton boton--primario">Bandeja de solicitudes de ARL</a>
        <a routerLink="/practicas" class="boton">Gestión de prácticas</a>
      </div>
    }
    @if (cargando()) {
      <sipra-esqueleto tipo="cifras" [cantidad]="4" /><div style="height:var(--sp-5)"></div><div class="tarjeta"><sipra-esqueleto tipo="filas" [cantidad]="5" /></div>
    } @else {
      <div class="cifras escalonado">
        <div class="tarjeta cifra">
          <div class="n">{{ practicas().length }}</div>
          <div class="t">{{ sesion.rol() === 'estudiante' ? 'Mi práctica' : 'Expedientes en mi alcance' }}</div>
        </div>
        <div class="tarjeta cifra tono-ok">
          <div class="n">{{ activas() }}</div>
          <div class="t">Activas</div>
        </div>
        @if (sesion.esInterno()) {
          <div class="tarjeta cifra tono-aviso">
            <div class="n">{{ requierenAtencion() }}</div>
            <div class="t">Requieren atención</div>
          </div>
          <div class="tarjeta cifra tono-peligro">
            <div class="n">{{ enRiesgo() }}</div>
            <div class="t">En riesgo</div>
          </div>
          @if (tablero(); as t) {
            <div class="tarjeta cifra tono-peligro">
              <div class="n">{{ t.practicasBloqueadas }}</div>
              <div class="t">Detenidas por ARL</div>
            </div>
          }
        }
      </div>

      <div class="dosc">
      <div class="tarjeta escalonado">
        <div class="cab">
          <h2>{{ sesion.esInterno() ? 'A quién llamar hoy' : 'Mi práctica' }}</h2>
          @if (sesion.esInterno() && priorizadas().length > 0) {
            <a routerLink="/practicas" class="pista">Ver todas las prácticas →</a>
          }
        </div>
        @if (priorizadas().length === 0) {
          <div class="vacio"><img src="assets/ilustraciones/sinresultados.svg" alt="" width="600" height="360" /><strong>Sin expedientes</strong><span>No hay expedientes dentro de su alcance todavía.</span></div>
        } @else {
          @for (practica of priorizadas(); track practica.id) {
            <div class="fila">
              <div class="quien">
                <div class="nombre">
                  <a [routerLink]="['/practicas', practica.id]">{{ practica.estudianteNombre }}</a>
                </div>
                <div class="detalle">
                  {{ practica.modalidad | etiqueta }} ·
                  {{ practica.empresaRazonSocial ?? 'sin empresa asignada' }} ·
                  {{ practica.periodoAcademico }} · {{ practica.avance.porcentajeAprobado }} % aprobado
                </div>
                @if (practica.disparadoresSenal.length > 0) {
                  <div class="disparadores">{{ practica.disparadoresSenal.join(' · ') }}</div>
                }
              </div>
              <div class="estados">
                <sipra-estado [valor]="practica.estado" />
                @if (sesion.esInterno()) {
                  <sipra-estado [valor]="practica.senal" />
                }
              </div>
            </div>
          }
        }
      </div>
      @if (periodoActual(); as per) {
        <aside class="tarjeta">
          <sipra-cronograma [periodo]="per" />
          @if (sesion.rol() === 'estudiante') { <p class="pista" style="margin:var(--sp-3) 0 0">¿Dudas con las fechas? <a routerLink="/ayuda" [queryParams]="{ categoria: 'fechas_y_cronograma' }">Fechas y cronograma</a> en la ayuda.</p> }
        </aside>
      }
      </div>
    }
  `,
})
export class InicioComponent implements OnInit {
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);

  readonly practicas = signal<Practica[]>([]);
  readonly tablero = signal<TableroCumplimiento | null>(null);
  readonly periodos = signal<Periodo[]>([]);
  readonly cargando = signal(true);

  /** El periodo de la práctica del estudiante; para los demás, el vigente más próximo con registro abierto. */
  readonly periodoActual = computed(() => {
    const lista = this.periodos().filter((p) => p.activo);
    const mia = this.practicas()[0]?.periodoAcademico;
    const hoy = new Date().toISOString().slice(0, 10);
    return lista.find((p) => p.codigo === mia)
      ?? lista.find((p) => p.fechaInicio <= hoy && hoy <= p.fechaFin && p.abiertas.registro_fur)
      ?? lista.find((p) => p.fechaInicio <= hoy && hoy <= p.fechaFin)
      ?? null;
  });

  readonly hoy = (() => {
    const f = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    return f.charAt(0).toUpperCase() + f.slice(1);
  })();

  readonly etiquetaRol = computed(() => {
    const etiquetas: Record<string, string> = {
      estudiante: 'Practicante', tutor: 'Docente facilitador', coordinador: 'Coordinación de prácticas',
      administrador: 'Administrador institucional', empresa: 'Empresa habilitada',
      extension: 'Dirección de Extensión', auxiliar: 'Auxiliar de prácticas',
    };
    const rol = this.sesion.rol();
    return rol ? (etiquetas[rol] ?? rol) : '';
  });

  readonly activas = computed(() => this.practicas().filter((p) => p.estado === 'activa').length);
  readonly requierenAtencion = computed(
    () => this.practicas().filter((p) => p.senal === 'requiere_atencion').length,
  );
  readonly enRiesgo = computed(() => this.practicas().filter((p) => p.senal === 'en_riesgo').length);

  /** Orden por urgencia: en riesgo primero, luego requiere atención. */
  readonly priorizadas = computed(() => {
    const peso: Record<string, number> = { en_riesgo: 0, requiere_atencion: 1, al_dia: 2 };
    return [...this.practicas()]
      .sort((a, b) => (peso[a.senal] ?? 3) - (peso[b.senal] ?? 3))
      .slice(0, 12);
  });

  async ngOnInit(): Promise<void> {
    try {
      this.practicas.set(await firstValueFrom(this.api.listarPracticas()));
      if (this.sesion.rol() !== 'empresa') {
        this.periodos.set(await firstValueFrom(this.api.listarPeriodos()).catch(() => [] as Periodo[]));
      }
      if (this.sesion.esInterno()) {
        this.tablero.set(await firstValueFrom(this.api.tableroCumplimiento(60)));
      }
    } finally {
      this.cargando.set(false);
    }
  }
}
