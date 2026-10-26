import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { Empresa } from '@core/models/modelos';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

@Component({
  selector: 'sipra-empresas',
  standalone: true,
  imports: [EsqueletoComponent, FormsModule, DatePipe, EstadoComponent, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .barra { display:flex; gap:0.8rem; align-items:flex-end; flex-wrap:wrap; margin-bottom:1.1rem; }
    .barra .campo { margin:0; min-width:190px; }
    .empresa { padding:1rem 0; border-bottom:1px solid var(--borde); }
    .empresa:last-child { border-bottom:none; }
    .cab { display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap; }
    .cab .razon { font-weight:640; flex:1; min-width:200px; }
    .senal { font-size:0.81rem; padding:0.28rem 0.5rem; border-radius:var(--r-sm);
             margin-top:0.28rem; background:var(--superficie-2); }
    .senal.advertencia { background:var(--aviso-suave); color:var(--aviso); }
    .senal.critico { background:var(--peligro-suave); color:var(--peligro); }
    .acciones { display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem; }
    .verificador { display:flex; gap:0.6rem; align-items:flex-end; flex-wrap:wrap; }
  `],
  template: `
    <h1>Empresas</h1>
    <p class="pista" style="max-width:74ch;margin-bottom:1.2rem">
      La pre-verificación automática alimenta el semáforo; la decisión es humana y exige
      justificación. Una solicitud no es una organización: mientras no se apruebe, no hay usuario
      ni acceso.
    </p>


    <div class="tarjeta" style="margin-bottom:1.1rem">
      <h2>Verificador de NIT</h2>
      <p class="pista">Algoritmo DIAN, determinístico. Capa 0 del pipeline.</p>
      <div class="verificador">
        <div class="campo" style="margin:0;max-width:220px">
          <label for="nit">Número sin dígito de verificación</label>
          <input id="nit" type="text" [(ngModel)]="nit" placeholder="901458772" />
        </div>
        <button type="button" class="boton" [disabled]="nit().length < 6" (click)="verificar()">
          Calcular DV
        </button>
        @if (nitCalculado(); as r) {
          <span class="etiqueta etiqueta--ok" style="margin-bottom:0.5rem">{{ r }}</span>
        }
      </div>
    </div>

    <div class="barra">
      <div class="campo">
        <label for="f-estado-emp">Estado</label>
        <select id="f-estado-emp" [(ngModel)]="filtro">
          <option value="">Todos</option>
          @for (estado of estados; track estado) {
            <option [value]="estado">{{ estado | etiqueta }}</option>
          }
        </select>
      </div>
    </div>

    <div class="tarjeta">
      @if (cargando()) {
        <sipra-esqueleto tipo="filas" [cantidad]="5" />
      } @else if (visibles().length === 0) {
        <div class="vacio">No hay empresas que coincidan con el filtro.</div>
      } @else {
        @for (empresa of visibles(); track empresa.id) {
          <div class="empresa">
            <div class="cab">
              <span class="razon">{{ empresa.razonSocial }}</span>
              <span class="mono pista">NIT {{ empresa.nit }}</span>
              <sipra-estado [valor]="empresa.estado" />
              <sipra-estado [valor]="empresa.semaforo" />
            </div>
            <div class="pista">
              Solicitó {{ empresa.solicitanteNombre }} ({{ empresa.solicitanteCorreo }}) ·
              {{ empresa.solicitadaEn | date: 'd MMM y' }}
            </div>

            @for (senal of empresa.senales ?? []; track senal.codigo) {
              <div class="senal" [class.advertencia]="senal.resultado === 'advertencia'"
                   [class.critico]="senal.resultado === 'critico'">
                <strong class="mono">{{ senal.codigo }}</strong> · {{ senal.detalle }}
              </div>
            }

            @if (puedeDecidir() && decidible(empresa)) {
              <div class="campo" style="margin-top:0.7rem;margin-bottom:0.4rem">
                <input type="text" [ngModel]="justificaciones()[empresa.id] ?? ''"
                       (ngModelChange)="anotar(empresa.id, $event)"
                       placeholder="Justificación de la decisión (mínimo 10 caracteres)" />
              </div>
              <div class="acciones">
                @if (empresa.estado !== 'habilitada') {
                  <button type="button" class="boton boton--primario"
                          [disabled]="!justificado(empresa.id) || guardando()"
                          (click)="decidir(empresa, 'habilitar')">Habilitar</button>
                  <button type="button" class="boton"
                          [disabled]="!justificado(empresa.id) || guardando()"
                          (click)="decidir(empresa, 'requerir_info')">Requerir información</button>
                  <button type="button" class="boton boton--peligro"
                          [disabled]="!justificado(empresa.id) || guardando()"
                          (click)="decidir(empresa, 'rechazar')">Rechazar</button>
                } @else {
                  <button type="button" class="boton boton--peligro"
                          [disabled]="!justificado(empresa.id) || guardando()"
                          (click)="decidir(empresa, 'suspender')">Suspender</button>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class EmpresasComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);

  readonly empresas = signal<Empresa[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly filtro = signal('');
  readonly nit = signal('');
  readonly nitCalculado = signal<string | null>(null);
  readonly justificaciones = signal<Record<string, string | undefined>>({});

  readonly estados = [
    'solicitud_recibida', 'en_verificacion', 'requiere_info',
    'habilitada', 'rechazada', 'suspendida',
  ];

  readonly puedeDecidir = computed(() => this.sesion.rol() === 'administrador');
  readonly visibles = computed(() => {
    const estado = this.filtro();
    return this.empresas().filter((e) => !estado || e.estado === estado);
  });

  async ngOnInit(): Promise<void> {
    await this.recargar();
  }

  decidible(empresa: Empresa): boolean {
    return !['rechazada'].includes(empresa.estado);
  }

  justificado(id: string): boolean {
    return (this.justificaciones()[id] ?? '').trim().length >= 10;
  }

  anotar(id: string, texto: string): void {
    this.justificaciones.update((actual) => ({ ...actual, [id]: texto }));
  }

  async verificar(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.verificarNit(this.nit()));
      this.nitCalculado.set(r.formateado);
    } catch {
      this.nitCalculado.set(null);
      this.avisos.error('El número indicado no es un NIT válido.');
    }
  }

  async decidir(
    empresa: Empresa,
    decision: 'habilitar' | 'rechazar' | 'requerir_info' | 'suspender',
  ): Promise<void> {
    this.guardando.set(true);
    try {
      await firstValueFrom(
        this.api.decidirEmpresa(empresa.id, decision, this.justificaciones()[empresa.id] ?? ''),
      );
      this.anotar(empresa.id, '');
      this.avisos.exito('Decisión registrada en la auditoría inmutable.');
      await this.recargar();
    } catch (error) {
      const cuerpo = error instanceof HttpErrorResponse
        ? (error.error as { message?: string } | null)
        : null;
      this.avisos.error(cuerpo?.message ?? 'No fue posible registrar la decisión.');
    } finally {
      this.guardando.set(false);
    }
  }

  private async recargar(): Promise<void> {
    try {
      this.empresas.set(await firstValueFrom(this.api.listarEmpresas()));
    } finally {
      this.cargando.set(false);
    }
  }
}
