import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import {
  DocumentoDeExpediente, Expediente, FiltrosExpedientes, ListadoExpedientes, SupervisionDocumental, VersionDocumento, VistaRapida,
} from '@core/models/validacion-documental.model';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { traducirErrorEps } from '../eps/eps.util';
import { filtrosLimpios, navegarDocumento } from './vd.util';

/**
 * Estado de la Mesa de Validación Documental (signals). SOLO coordina la pantalla: qué expediente y qué documento se ven. No decide
 * ni reserva nada: eso lo hace el componente del motor del documento activo (con su propio endpoint) y aquí solo se REFRESCAN los
 * metadatos del expediente y de la cola después.
 */
@Injectable()
export class ValidacionDocumentalEstado {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);

  readonly ahora = signal(Date.now());

  // Cola
  readonly listado = signal<ListadoExpedientes | null>(null);
  readonly cargando = signal(false);
  readonly errorListado = signal<string | null>(null);
  readonly filtros = signal<FiltrosExpedientes>({});
  readonly items = computed(() => this.listado()?.items ?? []);

  // Expediente abierto
  readonly practicaId = signal<string | null>(null);
  readonly expediente = signal<Expediente | null>(null);
  readonly cargandoExpediente = signal(false);
  readonly errorExpediente = signal<string | null>(null);
  readonly tipoActivo = signal<string | null>(null);
  readonly versiones = signal<{ tipo: string; items: VersionDocumento[] } | null>(null);

  /** En pantallas angostas se ve una cosa a la vez: la cola, el expediente (con su lista de documentos) o el documento. */
  readonly vista = signal<'cola' | 'expediente' | 'documento'>('cola');
  readonly colaVisible = signal(true);

  readonly supervision = signal<SupervisionDocumental | null>(null);
  readonly cargandoSupervision = signal(false);
  readonly esSupervisor = computed(() => ['coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));

  readonly documentos = computed(() => this.expediente()?.documentos ?? []);
  readonly documentoActivo = computed<DocumentoDeExpediente | null>(() => this.documentos().find((d) => d.tipoDocumento === this.tipoActivo()) ?? null);

  private temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const reloj = setInterval(() => this.ahora.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    });
  }

  // ── Cola ────────────────────────────────────────────────────────────────

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorListado.set(null);
    try {
      this.listado.set(await firstValueFrom(this.api.listarExpedientes(filtrosLimpios(this.filtros()))));
    } catch (e) {
      this.errorListado.set(traducirErrorEps(e));
    } finally {
      this.cargando.set(false);
    }
  }

  async aplicarFiltros(parcial: FiltrosExpedientes): Promise<void> {
    this.filtros.update((f) => ({ ...f, ...parcial }));
    await this.cargar();
  }

  async elegirVista(vista: VistaRapida): Promise<void> {
    await this.aplicarFiltros({ vista });
  }

  async limpiarFiltros(): Promise<void> {
    this.filtros.update((f) => (f.vista ? { vista: f.vista } : {}));
    await this.cargar();
  }

  buscar(texto: string): void {
    if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => { void this.aplicarFiltros({ buscar: texto.trim() }); }, 300);
  }

  // ── Expediente y documento ──────────────────────────────────────────────

  /** Abre un expediente (solo metadatos) y deja activo el documento pedido, o el siguiente pendiente, o el primero. */
  async abrirExpediente(practicaId: string, tipo: string | null = null): Promise<void> {
    const cambia = this.practicaId() !== practicaId;
    this.practicaId.set(practicaId);
    if (cambia) { this.expediente.set(null); this.tipoActivo.set(null); this.versiones.set(null); }
    this.vista.set('expediente');
    await this.refrescarExpediente();
    const e = this.expediente();
    if (!e) return;
    const elegido = (tipo && e.documentos.some((d) => d.tipoDocumento === tipo) ? tipo : null)
      ?? (cambia || !this.tipoActivo() ? e.siguientePendiente ?? e.documentos.find((d) => d.documentoId)?.tipoDocumento ?? e.documentos[0]?.tipoDocumento ?? null : this.tipoActivo());
    this.tipoActivo.set(elegido);
  }

  /** Vuelve a pedir SOLO los metadatos (estado humano, reservas, progreso); no toca PDF ni resultados de los motores. */
  async refrescarExpediente(): Promise<void> {
    const id = this.practicaId();
    if (!id) return;
    this.cargandoExpediente.set(true);
    this.errorExpediente.set(null);
    try {
      this.expediente.set(await firstValueFrom(this.api.expedienteDocumental(id)));
    } catch (e) {
      this.expediente.set(null);
      this.errorExpediente.set(traducirErrorEps(e));
    } finally {
      this.cargandoExpediente.set(false);
    }
  }

  /** Después de una acción de un motor: actualiza el expediente, el progreso y los contadores de la cola, sin recargar la aplicación. */
  async actualizarTrasAccion(): Promise<void> {
    await Promise.all([this.refrescarExpediente(), this.cargar()]);
    if (this.supervision()) await this.cargarSupervision();
  }

  seleccionarDocumento(tipo: string): void {
    this.tipoActivo.set(tipo);
    this.versiones.set(null);
    this.vista.set('documento');
  }

  navegar(modo: 'siguiente' | 'anterior' | 'pendiente'): void {
    const d = navegarDocumento(this.documentos(), this.tipoActivo(), modo);
    if (!d) { this.avisos.info('No hay otro documento pendiente en este expediente.'); return; }
    this.seleccionarDocumento(d.tipoDocumento);
  }

  volver(): void {
    this.vista.set(this.vista() === 'documento' ? 'expediente' : 'cola');
  }

  cerrarExpediente(): void {
    this.practicaId.set(null);
    this.expediente.set(null);
    this.tipoActivo.set(null);
    this.versiones.set(null);
    this.vista.set('cola');
    this.colaVisible.set(true);
  }

  /** El histórico de versiones se pide solo cuando la persona lo abre. */
  async cargarVersiones(tipo: string): Promise<void> {
    const id = this.practicaId();
    if (!id) return;
    try {
      this.versiones.set({ tipo, items: await firstValueFrom(this.api.versionesDocumento(id, tipo)) });
    } catch (e) {
      this.avisos.error(traducirErrorEps(e));
    }
  }

  // ── Supervisión ─────────────────────────────────────────────────────────

  async cargarSupervision(): Promise<void> {
    if (!this.esSupervisor()) return;
    this.cargandoSupervision.set(true);
    try { this.supervision.set(await firstValueFrom(this.api.supervisionDocumental())); } catch (e) { this.avisos.error(traducirErrorEps(e)); } finally { this.cargandoSupervision.set(false); }
  }
}
