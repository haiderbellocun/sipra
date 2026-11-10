import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { descargarBlob, leerError, nombreDeCabecera } from '@shared/utils/errores';
import {
  DetalleAnalitica, FILTROS_VACIOS, FiltrosAnalitica, ReporteAnalitica, SegmentoAnalitica, cantidadFiltros, parametros,
} from './reportes-analitica.util';

export type PestanaReportes = 'general' | 'estudiantes' | 'documentos' | 'periodos' | 'exportaciones';

/** Opciones de filtro aprendidas de las respuestas (solo valores que existen en los datos del alcance). */
interface Opciones { periodos: string[]; escuelas: { codigo: string; nombre: string; programas: string[] }[]; modalidades: string[]; estados: string[] }

/**
 * Estado de la pantalla de Reportes (una instancia por pantalla). Los filtros viajan al servidor; el detalle es un
 * recorte del mismo filtro, con las mismas definiciones que los agregados. Distingue carga, error y vacío.
 */
@Injectable()
export class ReportesEstado {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  readonly pestana = signal<PestanaReportes>('general');
  readonly filtros = signal<FiltrosAnalitica>(FILTROS_VACIOS);
  readonly datos = signal<ReporteAnalitica | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly opciones = signal<Opciones>({ periodos: [], escuelas: [], modalidades: [], estados: [] });

  readonly segmento = signal<SegmentoAnalitica | null>(null);
  readonly detalle = signal<DetalleAnalitica | null>(null);
  readonly cargandoDetalle = signal(false);
  readonly errorDetalle = signal<string | null>(null);
  readonly exportando = signal(false);

  readonly activos = computed(() => cantidadFiltros(this.filtros()));
  readonly programas = computed(() => {
    const escuela = this.filtros().escuela;
    const lista = this.opciones().escuelas.filter((e) => !escuela || e.codigo === escuela).flatMap((e) => e.programas);
    return [...new Set(lista)].sort();
  });

  private turno = 0;

  async cargar(): Promise<void> {
    const mio = ++this.turno;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.reporteAnalitica(parametros(this.filtros())));
      if (mio !== this.turno) return;
      this.datos.set(r);
      this.aprender(r);
    } catch (e) {
      if (mio === this.turno) this.error.set(leerError(e));
    } finally {
      if (mio === this.turno) this.cargando.set(false);
    }
  }

  filtrar(cambio: Partial<FiltrosAnalitica>): void {
    this.filtros.update((f) => {
      const nuevo = { ...f, ...cambio };
      // Un programa de otra escuela no sobrevive al cambio de escuela.
      if (cambio.escuela !== undefined && cambio.escuela !== f.escuela) nuevo.programa = '';
      return nuevo;
    });
    this.cerrarDetalle();
    void this.cargar();
  }

  alternarPeriodo(periodo: string): void {
    const actuales = this.filtros().periodos;
    this.filtrar({ periodos: actuales.includes(periodo) ? actuales.filter((p) => p !== periodo) : [...actuales, periodo] });
  }

  limpiar(): void {
    this.filtros.set(FILTROS_VACIOS);
    this.cerrarDetalle();
    void this.cargar();
  }

  async abrirDetalle(segmento: SegmentoAnalitica): Promise<void> {
    this.segmento.set(segmento);
    this.detalle.set(null);
    this.errorDetalle.set(null);
    this.cargandoDetalle.set(true);
    try {
      const d = await firstValueFrom(this.api.reporteAnaliticaDetalle(parametros(this.filtros(), segmento)));
      if (this.segmento() === segmento) this.detalle.set(d);
    } catch (e) {
      if (this.segmento() === segmento) this.errorDetalle.set(leerError(e));
    } finally {
      if (this.segmento() === segmento) this.cargandoDetalle.set(false);
    }
  }

  cerrarDetalle(): void {
    this.segmento.set(null);
    this.detalle.set(null);
    this.errorDetalle.set(null);
    this.cargandoDetalle.set(false);
  }

  /** CSV del recorte abierto (o de todo el filtro). Filtrado y auditado en el servidor. */
  async exportar(): Promise<void> {
    this.exportando.set(true);
    try {
      const r = await firstValueFrom(this.api.reporteAnaliticaCsv(parametros(this.filtros(), this.segmento() ?? {})));
      descargarBlob(r.body as Blob, nombreDeCabecera(r.headers.get('content-disposition'), 'reporte-analitico.csv'));
      this.avisos.exito(`CSV generado con ${r.headers.get('x-filas') ?? '?'} fila(s) y registrado en la auditoría.`);
    } catch (e) {
      this.avisos.error(leerError(e));
    } finally {
      this.exportando.set(false);
    }
  }

  private aprender(r: ReporteAnalitica): void {
    this.opciones.update((o) => {
      const escuelas = new Map(o.escuelas.map((e) => [e.codigo, { ...e, programas: [...e.programas] }]));
      for (const e of r.escuelas) {
        const previa = escuelas.get(e.escuela);
        const programas = new Set([...(previa?.programas ?? []), ...e.programas.map((p) => p.programa)]);
        escuelas.set(e.escuela, { codigo: e.escuela, nombre: e.nombre, programas: [...programas] });
      }
      return {
        periodos: r.periodosDisponibles,
        escuelas: [...escuelas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
        modalidades: [...new Set([...o.modalidades, ...r.modalidades.map((m) => m.modalidad)])].sort(),
        estados: [...new Set([...o.estados, ...r.estadosPractica.map((e) => e.estado)])].sort(),
      };
    });
  }
}
