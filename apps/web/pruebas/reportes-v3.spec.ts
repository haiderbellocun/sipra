import '@angular/compiler';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import {
  CATEGORIAS_EXPEDIENTE, CATEGORIAS_OBLIGACION, DetalleAnalitica, FILTROS_VACIOS, ReporteAnalitica, cantidadFiltros, escalaSemanas,
  hayDatos, horas, parametros, partes, porcentaje, semanaCorta, tituloSegmento,
} from '../src/app/features/reportes/reportes-analitica.util';
import { metricasGenerales } from '../src/app/features/reportes/reportes-general.component';
import { PESTANAS, ROLES_ANALITICA } from '../src/app/features/reportes/reportes.component';
import { ReportesEstado } from '../src/app/features/reportes/reportes.estado';

// Las pruebas corren con cwd = apps/web.
const dir = join(process.cwd(), 'src', 'app', 'features', 'reportes');
const archivos = readdirSync(dir).filter((f) => f.endsWith('.component.ts'));
const leer = (f: string) => readFileSync(join(dir, f), 'utf8');
const globales = new Set([...readFileSync(join(process.cwd(), 'src', 'estilos.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
const plantilla = (f: string) => /template: `([\s\S]*?)`,\n\}\)/.exec(leer(f))?.[1] ?? '';

/** Respuesta sintética mínima: sin datos personales reales. */
function reporte(s: Partial<ReporteAnalitica> = {}): ReporteAnalitica {
  return {
    generadoEn: '2026-09-16T15:00:00.000Z', periodosDisponibles: ['2026C', '2026A'],
    resumen: { estudiantes: 3, practicas: 4, exigidos: 18, cargados: 2, aprobados: 1, correccion: 1, completos: 0 },
    expedientes: { completo: 0, requiere_correccion: 1, sin_iniciar: 1, en_curso: 1, sin_matriz: 1 },
    estadosPractica: [{ estado: 'activa', practicas: 3 }, { estado: 'cerrada', practicas: 1 }],
    documental: { sin_cargar: 15, en_proceso: 0, en_revision: 1, correccion: 1, rechazado: 0, aprobado: 1 },
    porTipo: [], friccion: [], tiempos: { decisiones: 3, medianaHoras: 4, p90Horas: 10, porTipo: [] },
    semanas: [{ semana: '2026-09-07', cargas: 1, aprobaciones: 0, devoluciones: 1, rechazos: 0 }, { semana: '2026-09-14', cargas: 3, aprobaciones: 1, devoluciones: 1, rechazos: 0 }],
    periodos: [], modalidades: [{ modalidad: 'pasantia', estudiantes: 2, practicas: 3, exigidos: 18, cargados: 2, aprobados: 1, correccion: 1, completos: 0 }],
    escuelas: [{ escuela: 'ESC-NEG', nombre: 'Negocios', estudiantes: 2, practicas: 3, exigidos: 12, cargados: 2, aprobados: 1, correccion: 0, completos: 0,
      programas: [{ programa: 'ADM-PRO', estudiantes: 2, practicas: 3, exigidos: 12, cargados: 2, aprobados: 1, correccion: 0, completos: 0 }] }],
    empresas: [], ...s,
  };
}

class ApiFalsa {
  llamadas: { metodo: string; p: Record<string, string> }[] = [];
  fallar = false;
  respuesta = reporte();
  reporteAnalitica(p: Record<string, string>): Observable<ReporteAnalitica> {
    this.llamadas.push({ metodo: 'analitica', p });
    return this.fallar ? throwError(() => new HttpErrorResponse({ status: 500, error: { mensaje: 'Base no disponible' } })) : of(this.respuesta);
  }
  reporteAnaliticaDetalle(p: Record<string, string>): Observable<DetalleAnalitica> {
    this.llamadas.push({ metodo: 'detalle', p });
    return of({ total: 1, estudiantesUnicos: 1, filas: [] });
  }
}
class AvisosFalsos { exito(): void { /* */ } error(): void { /* */ } info(): void { /* */ } }

function crear() {
  const api = new ApiFalsa();
  const injector = Injector.create({ providers: [
    { provide: ReportesEstado, useClass: ReportesEstado }, { provide: ApiService, useValue: api }, { provide: AvisosService, useValue: new AvisosFalsos() },
  ] });
  return { api, estado: injector.get(ReportesEstado) };
}

describe('Reportes V3 · lógica pura', () => {
  it('las partes suman 100 % con el mayor residuo y omiten las vacías', () => {
    const p = partes(CATEGORIAS_EXPEDIENTE, { completo: 1, en_curso: 1, requiere_correccion: 1, sin_iniciar: 0, sin_matriz: 0 });
    assert.equal(p.reduce((n, x) => n + x.pct, 0), 100);
    assert.deepEqual(p.map((x) => x.clave), ['completo', 'en_curso', 'requiere_correccion']);
    assert.deepEqual(partes(CATEGORIAS_OBLIGACION, { sin_cargar: 0, en_proceso: 0, en_revision: 0, correccion: 0, rechazado: 0, aprobado: 0 }), []);
  });
  it('porcentaje sin denominador es null (la vista muestra «—»), no 0 ni NaN', () => {
    assert.equal(porcentaje(1, 0), null);
    assert.equal(porcentaje(1, 3), 33);
  });
  it('los filtros vacíos no viajan; el segmento se suma al filtro y el periodo del segmento lo reemplaza', () => {
    assert.deepEqual(parametros(FILTROS_VACIOS), {});
    const f = { ...FILTROS_VACIOS, periodos: ['2026A', '2026C'], modalidad: 'pasantia' };
    assert.deepEqual(parametros(f), { periodos: '2026A,2026C', modalidad: 'pasantia' });
    assert.deepEqual(parametros(f, { tipo: 'certificado_eps', estadoDocumental: 'correccion' }), { periodos: '2026A,2026C', modalidad: 'pasantia', tipo: 'certificado_eps', estadoDocumental: 'correccion' });
    assert.deepEqual(parametros(f, { periodo: '2026A' })['periodos'], '2026A');
    assert.equal(cantidadFiltros(f), 2);
  });
  it('horas, semanas y títulos legibles', () => {
    assert.equal(horas(null), '—');
    assert.equal(horas(0.5), '30 min');
    assert.equal(horas(72), '3 d');
    assert.equal(semanaCorta('2026-09-14'), '14 sep');
    assert.equal(tituloSegmento({ situacion: 'requiere_correccion' }, (v) => v), 'Expedientes · Requiere corrección');
    assert.equal(escalaSemanas([]), 0);
  });
  it('vacío = sin prácticas en el resultado', () => {
    assert.equal(hayDatos(null), false);
    assert.equal(hayDatos(reporte({ resumen: { ...reporte().resumen, practicas: 0 } })), false);
    assert.equal(hayDatos(reporte()), true);
  });
  it('la franja General tiene 6 cifras y separa estudiantes de prácticas y cargado de aprobado', () => {
    const m = metricasGenerales(reporte());
    assert.equal(m.length, 6);
    assert.deepEqual(m.map((x) => x.t), ['Estudiantes', 'Expedientes completos', 'Requieren corrección', 'Aprobados', 'Cargados', 'Decisiones']);
    assert.equal(m[0].n, 3);
    assert.match(m[0].contexto, /4 práctica/);
    assert.match(m[3].contexto, /documentos · 6 % de 18/);
    assert.match(m[4].contexto, /documentos vigentes/);
  });
});

describe('Reportes V3 · estado', () => {
  it('carga con los filtros activos y distingue error de vacío', async () => {
    const { api, estado } = crear();
    api.fallar = true;
    await estado.cargar();
    assert.equal(estado.error(), 'Base no disponible');
    assert.equal(estado.datos(), null);
    api.fallar = false;
    await estado.cargar();
    assert.equal(estado.error(), null);
    assert.equal(estado.datos()?.resumen.practicas, 4);
    assert.deepEqual(estado.opciones().periodos, ['2026C', '2026A']);
    assert.deepEqual(estado.opciones().escuelas.map((e) => e.programas), [['ADM-PRO']]);
  });
  it('cambiar de escuela borra el programa; los periodos se alternan; limpiar quita todo', async () => {
    const { api, estado } = crear();
    estado.filtrar({ escuela: 'ESC-NEG', programa: 'ADM-PRO' });
    estado.filtrar({ escuela: 'ESC-ING' });
    assert.equal(estado.filtros().programa, '');
    estado.alternarPeriodo('2026C');
    assert.deepEqual(estado.filtros().periodos, ['2026C']);
    estado.alternarPeriodo('2026C');
    assert.deepEqual(estado.filtros().periodos, []);
    estado.limpiar();
    assert.equal(estado.activos(), 0);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(api.llamadas.some((l) => l.p['escuela'] === 'ESC-ING'));
  });
  it('el detalle usa el mismo filtro más el segmento y se cierra al filtrar', async () => {
    const { api, estado } = crear();
    estado.filtros.set({ ...FILTROS_VACIOS, periodos: ['2026C'] });
    await estado.abrirDetalle({ situacion: 'en_curso' });
    assert.deepEqual(api.llamadas.at(-1), { metodo: 'detalle', p: { periodos: '2026C', situacion: 'en_curso' } });
    assert.equal(estado.detalle()?.total, 1);
    estado.filtrar({ modalidad: 'pasantia' });
    assert.equal(estado.segmento(), null);
  });
});

describe('Reportes V3 · plantillas', () => {
  it('todos los componentes son OnPush y no reutilizan clases globales', () => {
    for (const f of archivos) {
      assert.match(leer(f), /ChangeDetectionStrategy\.OnPush/, f);
      if (f === 'reportes-exportaciones.component.ts') continue; // Conserva la presentación previa (clases globales a propósito).
      const estilos = /styles: \[([\s\S]*?)\],\n  template/.exec(leer(f))?.[1] ?? '';
      const propias = [...estilos.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
      assert.deepEqual(propias.filter((c) => globales.has(c)), [], f);
    }
    const comunes = readFileSync(join(dir, 'reportes.estilos.ts'), 'utf8');
    const propias = [...comunes.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
    assert.deepEqual(propias.filter((c) => globales.has(c)), []);
  });
  it('pestañas ARIA General, Estudiantes, Documentos, Períodos y Exportaciones; extensión solo exporta', () => {
    assert.deepEqual(PESTANAS.map((p) => p.texto), ['General', 'Estudiantes', 'Documentos', 'Períodos', 'Exportaciones']);
    assert.deepEqual(ROLES_ANALITICA, ['administrador', 'coordinador', 'auxiliar', 'tutor']);
    const t = plantilla('reportes.component.ts');
    assert.match(t, /role="tablist"/);
    assert.match(t, /\[attr\.aria-selected\]/);
    assert.match(t, /role="tabpanel"/);
  });
  it('carga con sipra-carga-senal, vacío con sipra-estado-vacio y error con reintento', () => {
    const t = plantilla('reportes.component.ts');
    assert.match(t, /<sipra-carga-senal/);
    assert.match(t, /titulo="Sin prácticas para estos filtros"/);
    assert.match(t, /titulo="Aún no hay prácticas en su alcance"/);
    assert.match(t, /role="alert"[\s\S]*?Reintentar/);
  });
  it('las gráficas son decorativas y tienen alternativa tabular', () => {
    for (const f of ['reportes-general.component.ts', 'reportes-documentos.component.ts']) {
      const t = plantilla(f);
      assert.match(t, /class="ra-pila" aria-hidden="true"/, f);
      assert.match(t, /<caption class="ra-sr">/, f);
    }
    assert.match(plantilla('reportes-general.component.ts'), /Ver la serie como tabla/);
  });
  it('el detalle no muestra documento ni correo y enlaza al expediente', () => {
    const t = plantilla('reportes-detalle.component.ts');
    assert.doesNotMatch(t, /documento de identidad|correo|\.documento\b/i);
    assert.match(t, /\[routerLink\]="\['\/practicas', f\.practicaId\]"/);
    assert.match(t, /Descargar CSV/);
  });
  it('no inventa SLA ni ranking de personas', () => {
    const todo = archivos.map(plantilla).join('\n');
    assert.match(todo, /No hay meta de servicio definida institucionalmente/);
    assert.doesNotMatch(todo, /ranking|top revisores|por revisor/i);
  });
  it('la tira de cifras y las tablas se adaptan a móvil', () => {
    assert.match(leer('reportes-detalle.component.ts'), /@media \(width < 700px\)/);
    assert.match(leer('reportes.component.ts'), /@media \(width < 700px\)/);
    assert.match(readFileSync(join(dir, 'reportes.estilos.ts'), 'utf8'), /\.ra-desliza \{ overflow-x: auto; \}/);
  });
});
