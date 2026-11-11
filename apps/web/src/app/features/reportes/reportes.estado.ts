import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { descargarBlob, leerError, nombreDeCabecera } from '@shared/utils/errores';
import {
  DetalleAnalitica, FILTROS_VACIOS, FiltrosAnalitica, ReporteAnalitica, SegmentoAnalitica, cantidadFiltros, parametros, quitar,
} from './reportes-analitica.util';

export type PestanaReportes = 'general' | 'estudiantes' | 'organizaciones' | 'documentos' | 'periodos' | 'exportaciones';

/** Opciones de filtro aprendidas de las respuestas (solo valores que existen en los datos del alcance). */
interface Opciones {
  periodos: string[]; escuelas: { codigo: string; nombre: string; programas: string[] }[];
  ciclos: string[]; semestres: number[]; modalidades: string[]; estados: string[]; empresas: (string | null)[];
}

/**
 * Estado de la pantalla de Reportes (una instancia por pantalla) y ÚNICO contexto de filtros: cada gráfica, el detalle y
 * el CSV leen `filtros`. Una selección en cualquier gráfica (cross-filter) cambia este contexto y todo se recalcula en el
 * servidor. El detalle (tabla granular) sigue abierto y se recarga con el nuevo contexto.
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
  readonly opciones = signal<Opciones>({ periodos: [], escuelas: [], ciclos: [], semestres: [], modalidades: [], estados: [], empresas: [] });

  readonly segmento = signal<SegmentoAnalitica | null>(null);
  readonly buscar = signal('');
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
  readonly nombreEscuela = (codigo: string): string => this.opciones().escuelas.find((e) => e.codigo === codigo)?.nombre ?? codigo;
  /** Nombres de programa aprendidos (solo existen con el mapping sintético de dev); sin nombre se muestra el código. */
  private readonly nombresPrograma = signal<Record<string, string>>({});
  readonly nombrePrograma = (codigo: string): string => this.nombresPrograma()[codigo] ?? codigo;
  /** Nombres de sección CIIU y municipio DIVIPOLA aprendidos de las respuestas (catálogos reales). '' = sin dato. */
  private readonly nombresSector = signal<Record<string, string>>({});
  private readonly nombresCiudad = signal<Record<string, string>>({});
  readonly nombreSector = (codigo: string): string => (codigo === '' ? 'Sin información' : this.nombresSector()[codigo] ?? codigo);
  readonly nombreCiudad = (codigo: string): string => (codigo === '' ? 'Sin municipio registrado' : this.nombresCiudad()[codigo] ?? codigo);

  private turno = 0;
  private turnoDetalle = 0;

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

  /** Cambia el contexto. Un programa elegido fija su escuela como contexto; cambiar de escuela suelta el programa ajeno. */
  filtrar(cambio: Partial<FiltrosAnalitica>): void {
    this.filtros.update((f) => {
      const nuevo = { ...f, ...cambio };
      if (cambio.escuela !== undefined && cambio.escuela !== f.escuela && cambio.programa === undefined) nuevo.programa = '';
      if (cambio.programa) {
        const escuela = this.opciones().escuelas.find((e) => e.programas.includes(cambio.programa as string));
        if (escuela && !cambio.escuela) nuevo.escuela = escuela.codigo;
      }
      return nuevo;
    });
    this.recargar();
  }

  /** Cross-filter: elegir de nuevo el valor activo lo quita (alternar). */
  alternar<K extends Exclude<keyof FiltrosAnalitica, 'periodos'>>(clave: K, valor: FiltrosAnalitica[K]): void {
    if (this.filtros()[clave] === valor) this.quitar(clave);
    else this.filtrar({ [clave]: valor } as Partial<FiltrosAnalitica>);
  }

  alternarPeriodo(periodo: string): void {
    const actuales = this.filtros().periodos;
    this.filtrar({ periodos: actuales.includes(periodo) ? actuales.filter((p) => p !== periodo) : [...actuales, periodo] });
  }

  quitar(clave: keyof FiltrosAnalitica): void {
    this.filtros.update((f) => quitar(f, clave));
    this.recargar();
  }

  limpiar(): void {
    this.filtros.set(FILTROS_VACIOS);
    this.recargar();
  }

  /** Abre la tabla granular del contexto (opcionalmente con un recorte documental). */
  async abrirDetalle(segmento: SegmentoAnalitica = {}): Promise<void> {
    this.segmento.set(segmento);
    await this.cargarDetalle();
  }

  async cargarDetalle(): Promise<void> {
    const segmento = this.segmento();
    if (!segmento) return;
    const mio = ++this.turnoDetalle;
    this.errorDetalle.set(null);
    this.cargandoDetalle.set(true);
    try {
      const d = await firstValueFrom(this.api.reporteAnaliticaDetalle(parametros(this.filtros(), segmento, this.buscar())));
      if (mio === this.turnoDetalle) this.detalle.set(d);
    } catch (e) {
      if (mio === this.turnoDetalle) this.errorDetalle.set(leerError(e));
    } finally {
      if (mio === this.turnoDetalle) this.cargandoDetalle.set(false);
    }
  }

  cerrarDetalle(): void {
    this.turnoDetalle += 1;
    this.segmento.set(null);
    this.detalle.set(null);
    this.errorDetalle.set(null);
    this.cargandoDetalle.set(false);
    this.buscar.set('');
  }

  /** CSV del contexto (y del recorte y la búsqueda de la tabla). Filtrado y auditado en el servidor. */
  async exportar(): Promise<void> {
    this.exportando.set(true);
    try {
      const r = await firstValueFrom(this.api.reporteAnaliticaCsv(parametros(this.filtros(), this.segmento() ?? {}, this.buscar())));
      descargarBlob(r.body as Blob, nombreDeCabecera(r.headers.get('content-disposition'), 'reporte-analitico.csv'));
      this.avisos.exito(`CSV generado con ${r.headers.get('x-filas') ?? '?'} fila(s) y registrado en la auditoría.`);
    } catch (e) {
      this.avisos.error(leerError(e));
    } finally {
      this.exportando.set(false);
    }
  }

  private recargar(): void {
    void this.cargar();
    if (this.segmento()) void this.cargarDetalle();
  }

  private aprender(r: ReporteAnalitica): void {
    this.nombresSector.update((n) => ({ ...n, ...r.etiquetas.sectores }));
    this.nombresCiudad.update((n) => ({ ...n, ...r.etiquetas.ciudades }));
    const nombres = Object.fromEntries(r.programas.filter((p) => p.nombre).map((p) => [p.programa, p.nombre as string]));
    if (Object.keys(nombres).length) this.nombresPrograma.update((n) => ({ ...n, ...nombres }));
    this.opciones.update((o) => {
      const escuelas = new Map(o.escuelas.map((e) => [e.codigo, { ...e, programas: [...e.programas] }]));
      for (const e of r.escuelas) {
        const previa = escuelas.get(e.escuela);
        const programas = new Set([...(previa?.programas ?? []), ...e.programas.map((p) => p.programa)]);
        escuelas.set(e.escuela, { codigo: e.escuela, nombre: e.nombre, programas: [...programas] });
      }
      const unir = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];
      return {
        periodos: r.periodosDisponibles,
        escuelas: [...escuelas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
        ciclos: unir(o.ciclos, r.niveles.map((n) => n.ciclo)),
        semestres: unir(o.semestres, r.semestres.flatMap((s) => (s.semestre === null ? [] : [s.semestre]))).sort((a, b) => a - b),
        modalidades: unir(o.modalidades, r.modalidades.map((m) => m.modalidad)).sort(),
        estados: unir(o.estados, r.estadosPractica.map((e) => e.estado)).sort(),
        empresas: unir(o.empresas, r.empresas.map((e) => e.empresa)),
      };
    });
  }
}
