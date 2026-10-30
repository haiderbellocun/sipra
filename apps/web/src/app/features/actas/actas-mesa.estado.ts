import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import {
  CorreccionDatosPractica, DecisionActa, DetalleActa, FiltrosActas, ListadoBandejaActa, MotivoDevolucionActa, SupervisionActa,
} from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { traducirErrorEps } from '../eps/eps.util';

/** La reserva se renueva sola si quedan menos de estos minutos y la persona sigue trabajando el caso. */
const RENOVAR_DESDE_MS = 5 * 60_000;

/**
 * Estado y acciones de la Mesa de Actas (signals). Toda la lógica de negocio vive en la API; aquí solo se coordina la
 * pantalla: qué se ve, qué está en curso y qué hacer cuando el servidor dice que el caso cambió. Nada de esto decide.
 */
@Injectable()
export class ActasMesaEstado {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);

  /** «Ahora», actualizado cada 15 s: lo usan las cuentas regresivas de la reserva. */
  readonly ahora = signal(Date.now());

  readonly listado = signal<ListadoBandejaActa | null>(null);
  readonly cargando = signal(false);
  readonly errorListado = signal<string | null>(null);
  readonly filtros = signal<FiltrosActas>({});

  /** En pantallas angostas se ve una cosa a la vez: la lista o el caso. */
  readonly vista = signal<'lista' | 'caso'>('lista');
  readonly seleccionId = signal<string | null>(null);
  readonly detalle = signal<DetalleActa | null>(null);
  readonly cargandoDetalle = signal(false);
  readonly errorDetalle = signal<string | null>(null);

  /** Una operación crítica en curso: mientras dura, los botones quedan inactivos. */
  readonly ocupado = signal(false);
  readonly supervision = signal<SupervisionActa | null>(null);
  readonly cargandoSupervision = signal(false);

  /** Motivos de devolución: los entrega la API (fuente única); sin ellos no se puede devolver. */
  readonly motivos = signal<MotivoDevolucionActa[]>([]);
  readonly errorMotivos = signal(false);

  readonly items = computed(() => this.listado()?.items ?? []);
  readonly esSupervisor = computed(() => ['coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly reservaVencidaEnPantalla = computed(() => {
    const d = this.detalle();
    return d !== null && d.reserva.estado === 'mia' && d.reserva.hasta !== null && new Date(d.reserva.hasta).getTime() <= this.ahora();
  });
  /** Tiene el caso, su reserva sigue vigente y el servidor lo deja decidir. */
  readonly puedeDecidir = computed(() => (this.detalle()?.puedeDecidir ?? false) && !this.reservaVencidaEnPantalla() && !this.ocupado());

  private temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const reloj = setInterval(() => this.ahora.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    });
  }

  async cargarMotivos(): Promise<void> {
    try {
      this.motivos.set(await firstValueFrom(this.api.motivosDevolucionActa()));
      this.errorMotivos.set(false);
    } catch {
      this.errorMotivos.set(true);
    }
  }

  // ── Bandeja ───────────────────────────────────────────────────────────────

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorListado.set(null);
    try {
      this.listado.set(await firstValueFrom(this.api.listarMesaActas(this.filtros())));
    } catch (e) {
      this.errorListado.set(traducirErrorEps(e));
    } finally {
      this.cargando.set(false);
    }
  }

  async aplicarFiltros(parcial: FiltrosActas): Promise<void> {
    this.filtros.update((f) => {
      const nuevo: FiltrosActas = { ...f, ...parcial };
      for (const k of Object.keys(nuevo) as Array<keyof FiltrosActas>) if (nuevo[k] === '' || nuevo[k] === undefined) delete nuevo[k];
      return nuevo;
    });
    await this.cargar();
  }

  async limpiarFiltros(): Promise<void> {
    this.filtros.set({});
    await this.cargar();
  }

  /** Búsqueda con espera corta para no consultar en cada tecla. */
  buscar(texto: string): void {
    if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => { void this.aplicarFiltros({ buscar: texto.trim() }); }, 300);
  }

  // ── Caso ──────────────────────────────────────────────────────────────────

  async seleccionar(id: string): Promise<void> {
    this.seleccionId.set(id);
    this.vista.set('caso');
    await this.refrescarDetalle();
  }

  volverALista(): void {
    this.vista.set('lista');
  }

  async refrescarDetalle(): Promise<void> {
    const id = this.seleccionId();
    if (!id) return;
    this.cargandoDetalle.set(true);
    this.errorDetalle.set(null);
    try {
      this.detalle.set(await firstValueFrom(this.api.detalleActa(id)));
    } catch (e) {
      this.detalle.set(null);
      this.errorDetalle.set(traducirErrorEps(e));
    } finally {
      this.cargandoDetalle.set(false);
    }
  }

  /** Ejecuta una acción crítica: sin dobles envíos, con el error traducido y el estado refrescado si falla. */
  private async ejecutar(accion: () => Promise<void>, exito?: string): Promise<boolean> {
    if (this.ocupado()) return false;
    this.ocupado.set(true);
    try {
      await accion();
      if (exito) this.avisos.exito(exito);
      return true;
    } catch (e) {
      this.avisos.error(traducirErrorEps(e));
      // Un conflicto casi siempre significa que el caso cambió (lo tomó otra persona, la reserva venció, ya se decidió).
      await Promise.all([this.refrescarDetalle(), this.cargar()]);
      return false;
    } finally {
      this.ocupado.set(false);
    }
  }

  async tomar(): Promise<boolean> {
    const id = this.seleccionId();
    if (!id) return false;
    return this.ejecutar(async () => {
      await firstValueFrom(this.api.tomarActa(id));
      await Promise.all([this.refrescarDetalle(), this.cargar()]);
    }, 'Caso tomado. Es suyo por 15 minutos; se renueva mientras trabaja.');
  }

  async liberar(): Promise<boolean> {
    const id = this.seleccionId();
    if (!id) return false;
    return this.ejecutar(async () => {
      await firstValueFrom(this.api.liberarActa(id));
      await Promise.all([this.refrescarDetalle(), this.cargar(), this.recargarSupervision()]);
    }, 'Reserva liberada: el caso quedó disponible.');
  }

  /** Renueva la reserva si quedan pocos minutos (hay actividad). Silencioso: si no se pudo, la pantalla lo mostrará al refrescar. */
  async renovarSiHaceFalta(): Promise<void> {
    const d = this.detalle();
    if (d?.reserva.estado !== 'mia' || !d.reserva.hasta || this.reservaVencidaEnPantalla()) return;
    if (new Date(d.reserva.hasta).getTime() - Date.now() > RENOVAR_DESDE_MS) return;
    try {
      await firstValueFrom(this.api.tomarActa(d.validacionId));
      await this.refrescarDetalle();
    } catch { /* se verá al refrescar */ }
  }

  /** El servidor elige y reserva en una sola operación atómica: aquí solo se pide y se muestra el resultado. */
  async tomarSiguiente(): Promise<boolean> {
    return this.ejecutar(async () => {
      const f = this.filtros();
      const r = await firstValueFrom(this.api.tomarSiguienteActa({
        conDiscrepancias: f.conDiscrepancias === 'si' || f.conDiscrepancias === 'no' ? f.conDiscrepancias : undefined,
        documentoIncorrecto: f.documentoIncorrecto === 'si' ? 'si' : undefined,
      }));
      if (r.estado === 'sin_casos' || !r.validacionId) {
        this.avisos.info('No hay casos disponibles ahora.');
        return;
      }
      this.seleccionId.set(r.validacionId);
      this.vista.set('caso');
      await Promise.all([this.refrescarDetalle(), this.cargar()]);
      this.avisos.exito('Caso asignado. Es suyo por 15 minutos; se renueva mientras trabaja.');
    });
  }

  async decidir(dto: DecisionActa): Promise<boolean> {
    if (this.reservaVencidaEnPantalla()) {
      this.avisos.error('Su reserva del caso venció. Tómelo de nuevo antes de decidir.');
      await this.refrescarDetalle();
      return false;
    }
    const id = this.seleccionId();
    if (!id) return false;
    return this.ejecutar(async () => {
      await firstValueFrom(this.api.decidirActa(id, dto));
      await Promise.all([this.refrescarDetalle(), this.cargar()]);
    }, dto.decision === 'aprobar' ? 'Acta aprobada.' : dto.decision === 'devolver' ? 'Acta devuelta al estudiante.' : 'Acta rechazada.');
  }

  /** Corrección controlada (coordinación/administración). Devuelve qué ocurrió con la comparación, o `null` si falló. */
  async corregirDatos(practicaId: string, dto: { tipoRemuneracion?: string; responsableArl?: string; justificacion: string }): Promise<CorreccionDatosPractica | null> {
    if (this.ocupado()) return null;
    this.ocupado.set(true);
    try {
      const r = await firstValueFrom(this.api.corregirDatosGobernantes(practicaId, dto));
      await Promise.all([this.refrescarDetalle(), this.cargar()]);
      return r;
    } catch (e) {
      this.avisos.error(traducirErrorEps(e));
      return null;
    } finally {
      this.ocupado.set(false);
    }
  }

  // ── Supervisión ───────────────────────────────────────────────────────────

  async cargarSupervision(): Promise<void> {
    if (!this.esSupervisor()) return;
    this.cargandoSupervision.set(true);
    try { this.supervision.set(await firstValueFrom(this.api.supervisionActas())); } catch (e) { this.avisos.error(traducirErrorEps(e)); } finally { this.cargandoSupervision.set(false); }
  }

  private async recargarSupervision(): Promise<void> {
    if (this.supervision()) await this.cargarSupervision();
  }
}
