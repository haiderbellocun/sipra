import '@angular/compiler';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { DecisionActa, DetalleActa, FiltrosActas, ListadoBandejaActa, ReservaActa } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { ActasMesaEstado } from '../src/app/features/actas/actas-mesa.estado';

const listado = (n = 2): ListadoBandejaActa => ({
  kpis: { abiertas: n, libres: n, mias: 0, conDiscrepanciaCritica: 0, documentoIncorrecto: 0, tomadas: 0, porVencer: 0, firmasPendientes: 0 },
  total: n,
  items: Array.from({ length: n }, (_, i) => ({
    validacionId: `v${i + 1}`, practicaId: 'p1', estudiante: { nombre: `Estudiante ${i + 1}` }, empresa: 'Empresa SAS', modalidad: 'Pasantía', fechaInicio: null,
    version: 1, esReenvio: false, estado: 'revision', tipoActa: 'iniciacion_practicas', remuneracionActa: null, responsableArlActa: null, firmaEmpresa: 'si',
    firmaPracticante: 'si', hayDiscrepanciaCritica: false, recomendacion: 'consistente', prioridad: { puntaje: 10, razones: [] },
    reserva: { estado: 'libre' as const, por: null, hasta: null, minutosRestantes: null }, recibidaEn: '2026-10-20T12:00:00Z', diasEnBandeja: 1,
    datosPracticaCambiaronDespuesDeDecision: false, inconsistenciaOperativa: false,
  })),
});

const detalle = (reserva: ReservaActa, puedeDecidir: boolean): DetalleActa => ({
  validacionId: 'v1', practicaId: 'p1', documentoId: 'd1', version: 1, vigente: true, estado: 'revision', recomendacion: 'consistente',
  prioridad: { puntaje: 10, razones: [] }, reserva, puedeDecidir, inconsistenciaOperativa: null,
  estudiante: { nombre: 'Estudiante 1', documento: puedeDecidir ? '1000000001' : null, documentoEnmascarado: '••••0001', programa: 'Ingeniería' },
  practica: { empresa: 'Empresa SAS', nit: '900', modalidad: 'Pasantía', fechaInicio: null, fechaFin: null }, responsableArlSugeridoPorModalidad: 'empresa',
  resumen: { clasificacion: 'iniciacion_practicas', remuneracionSipra: 'Remunerada', remuneracionActa: 'Remunerada', responsableArlSipra: 'Empresa', responsableArlActa: 'Empresa', firmaEmpresa: 'si', firmaPracticante: 'si' },
  comparacion: null, datosPracticaCambiaronDespuesDeDecision: null, decision: null, versiones: [], historial: [],
});

const libre: ReservaActa = { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
const miaHasta = (ms: number): ReservaActa => ({ estado: 'mia', por: 'Usted', hasta: new Date(Date.now() + ms).toISOString(), minutosRestantes: Math.ceil(ms / 60000) });
const conflicto = (mensaje: string) => throwError(() => new HttpErrorResponse({ status: 409, error: { message: mensaje } }));

class ApiFalsa {
  llamadas: string[] = [];
  filtros: FiltrosActas[] = [];
  detalleActual: DetalleActa = detalle(libre, false);
  tomar: () => Observable<unknown> = () => of({});
  decidirFn: (dto: DecisionActa) => Observable<unknown> = () => of({});
  siguiente: () => Observable<unknown> = () => of({ estado: 'sin_casos', validacionId: null });
  listarMesaActas(f: FiltrosActas): Observable<ListadoBandejaActa> { this.llamadas.push('listar'); this.filtros.push(f); return of(listado()); }
  detalleActa(id: string): Observable<DetalleActa> { this.llamadas.push(`detalle:${id}`); return of(this.detalleActual); }
  tomarActa(id: string): Observable<unknown> { this.llamadas.push(`tomar:${id}`); return this.tomar(); }
  liberarActa(id: string): Observable<unknown> { this.llamadas.push(`liberar:${id}`); return of({}); }
  tomarSiguienteActa(c: unknown): Observable<unknown> { this.llamadas.push(`siguiente:${JSON.stringify(c)}`); return this.siguiente(); }
  decidirActa(id: string, dto: DecisionActa): Observable<unknown> { this.llamadas.push(`decidir:${id}:${dto.decision}`); return this.decidirFn(dto); }
  supervisionActas(): Observable<unknown> { this.llamadas.push('supervision'); return of({ abiertas: 0, libres: 0, tomadas: 0, porVencer: 0, vencidas: 0, porEstado: {}, inconsistentes: 0, inconsistencias: [], conDiscrepanciaCritica: 0, documentoIncorrecto: 0, funcionarios: [] }); }
  corregirDatosGobernantes(id: string, dto: unknown): Observable<unknown> { this.llamadas.push(`corregir:${id}:${JSON.stringify(dto)}`); return of({ practicaId: id, tipoRemuneracion: null, responsableArl: 'cun', actaIniciacion: 'recalculada' }); }
}

class AvisosFalsos {
  mensajes: Array<{ tipo: string; texto: string }> = [];
  exito(texto: string): void { this.mensajes.push({ tipo: 'ok', texto }); }
  error(texto: string): void { this.mensajes.push({ tipo: 'error', texto }); }
  info(texto: string): void { this.mensajes.push({ tipo: 'info', texto }); }
}

function crear(rol: string | null = 'auxiliar') {
  const api = new ApiFalsa();
  const avisos = new AvisosFalsos();
  const injector = Injector.create({
    providers: [
      { provide: ActasMesaEstado, useClass: ActasMesaEstado },
      { provide: ApiService, useValue: api },
      { provide: AvisosService, useValue: avisos },
      { provide: SesionService, useValue: { rol: signal(rol), sesion: signal({ id: 'yo' }) } },
    ],
  });
  return { api, avisos, estado: injector.get(ActasMesaEstado), cerrar: () => (injector as unknown as { destroy?: () => void }).destroy?.() };
}

describe('ActasMesaEstado · bandeja', () => {
  it('cargar pide la bandeja con los filtros activos; limpiar los quita', async () => {
    const { api, estado, cerrar } = crear();
    await estado.aplicarFiltros({ firmas: 'faltantes', buscar: 'ana' });
    assert.deepEqual(api.filtros.at(-1), { firmas: 'faltantes', buscar: 'ana' });
    await estado.aplicarFiltros({ firmas: '' });
    assert.deepEqual(api.filtros.at(-1), { buscar: 'ana' });
    await estado.limpiarFiltros();
    assert.deepEqual(api.filtros.at(-1), {});
    cerrar();
  });
  it('seleccionar un caso carga su detalle y pasa a la vista del caso (móvil)', async () => {
    const { api, estado, cerrar } = crear();
    await estado.seleccionar('v1');
    assert.equal(estado.vista(), 'caso');
    assert.ok(api.llamadas.includes('detalle:v1'));
    estado.volverALista();
    assert.equal(estado.vista(), 'lista');
    cerrar();
  });
  it('solo coordinación y administración supervisan', () => {
    assert.equal(crear('auxiliar').estado.esSupervisor(), false);
    assert.equal(crear('coordinador').estado.esSupervisor(), true);
    assert.equal(crear('administrador').estado.esSupervisor(), true);
  });
});

describe('ActasMesaEstado · reserva', () => {
  it('tomar refresca el caso y la bandeja y avisa en lenguaje humano', async () => {
    const { api, avisos, estado, cerrar } = crear();
    await estado.seleccionar('v1');
    api.llamadas.length = 0;
    assert.equal(await estado.tomar(), true);
    assert.ok(api.llamadas.includes('tomar:v1') && api.llamadas.includes('detalle:v1') && api.llamadas.includes('listar'));
    assert.match(avisos.mensajes.at(-1)?.texto ?? '', /Caso tomado/);
    cerrar();
  });
  it('si otra persona lo tomó (409): mensaje humano del servidor y se refresca; nada de códigos', async () => {
    const { api, avisos, estado, cerrar } = crear();
    await estado.seleccionar('v1');
    api.tomar = () => conflicto('El caso ya está reservado por otro funcionario');
    api.llamadas.length = 0;
    assert.equal(await estado.tomar(), false);
    assert.equal(avisos.mensajes.at(-1)?.texto, 'El caso ya está reservado por otro funcionario');
    assert.ok(api.llamadas.includes('detalle:v1') && api.llamadas.includes('listar'));
    assert.equal(estado.ocupado(), false);
    cerrar();
  });
  it('«tomar siguiente»: sin casos avisa; con caso lo abre', async () => {
    const { api, avisos, estado, cerrar } = crear();
    await estado.tomarSiguiente();
    assert.equal(avisos.mensajes.at(-1)?.texto, 'No hay casos disponibles ahora.');
    assert.equal(estado.seleccionId(), null);
    api.siguiente = () => of({ estado: 'tomado', validacionId: 'v2' });
    await estado.tomarSiguiente();
    assert.equal(estado.seleccionId(), 'v2');
    assert.equal(estado.vista(), 'caso');
    cerrar();
  });
  it('«tomar siguiente» respeta los filtros que la API entiende', async () => {
    const { api, estado, cerrar } = crear();
    await estado.aplicarFiltros({ conDiscrepancias: 'si', documentoIncorrecto: 'si' });
    await estado.tomarSiguiente();
    assert.equal(api.llamadas.at(-1), 'siguiente:{"conDiscrepancias":"si","documentoIncorrecto":"si"}');
    cerrar();
  });
  it('una reserva vencida en pantalla bloquea decidir sin llamar a la API', async () => {
    const { api, avisos, estado, cerrar } = crear();
    api.detalleActual = detalle({ estado: 'mia', por: 'Usted', hasta: new Date(Date.now() - 1000).toISOString(), minutosRestantes: 0 }, true);
    await estado.seleccionar('v1');
    assert.equal(estado.reservaVencidaEnPantalla(), true);
    assert.equal(estado.puedeDecidir(), false);
    api.llamadas.length = 0;
    assert.equal(await estado.decidir({ decision: 'aprobar' }), false);
    assert.ok(!api.llamadas.some((l) => l.startsWith('decidir')));
    assert.match(avisos.mensajes.at(-1)?.texto ?? '', /reserva del caso venció/);
    cerrar();
  });
});

describe('ActasMesaEstado · decisión', () => {
  it('con el caso tomado y el servidor de acuerdo (puedeDecidir) se puede decidir; sin eso, no', async () => {
    const t = crear();
    t.api.detalleActual = detalle(miaHasta(600_000), true);
    await t.estado.seleccionar('v1');
    assert.equal(t.estado.puedeDecidir(), true);
    const s = crear();
    s.api.detalleActual = detalle(miaHasta(600_000), false);
    await s.estado.seleccionar('v1');
    assert.equal(s.estado.puedeDecidir(), false, 'si la API dice que no (p. ej. inconsistencia operativa), la pantalla no lo ofrece');
    t.cerrar(); s.cerrar();
  });
  it('decidir manda la decisión, refresca y avisa según la decisión', async () => {
    const { api, avisos, estado, cerrar } = crear();
    api.detalleActual = detalle(miaHasta(600_000), true);
    await estado.seleccionar('v1');
    for (const [decision, texto] of [['aprobar', 'Acta aprobada.'], ['devolver', 'Acta devuelta al estudiante.'], ['rechazar', 'Acta rechazada.']] as const) {
      assert.equal(await estado.decidir({ decision, justificacion: 'x'.repeat(50) }), true);
      assert.equal(avisos.mensajes.at(-1)?.texto, texto);
    }
    cerrar();
  });
  it('si la decisión falla (409), no se queda ocupada: refresca y deja decidir de nuevo', async () => {
    const { api, avisos, estado, cerrar } = crear();
    api.detalleActual = detalle(miaHasta(600_000), true);
    await estado.seleccionar('v1');
    api.decidirFn = () => conflicto('El caso ya fue decidido');
    api.llamadas.length = 0;
    assert.equal(await estado.decidir({ decision: 'aprobar' }), false);
    assert.equal(avisos.mensajes.at(-1)?.texto, 'El caso ya fue decidido');
    assert.equal(estado.ocupado(), false);
    assert.ok(api.llamadas.includes('detalle:v1'));
    cerrar();
  });
  it('un doble clic no manda dos decisiones', async () => {
    const { api, estado, cerrar } = crear();
    api.detalleActual = detalle(miaHasta(600_000), true);
    await estado.seleccionar('v1');
    let resolver: (v: unknown) => void = () => undefined;
    api.decidirFn = () => new Observable((o) => { resolver = (v) => { o.next(v); o.complete(); }; });
    const primera = estado.decidir({ decision: 'aprobar' });
    const segunda = await estado.decidir({ decision: 'aprobar' });
    assert.equal(segunda, false);
    resolver({});
    await primera;
    assert.equal(api.llamadas.filter((l) => l.startsWith('decidir')).length, 1);
    cerrar();
  });
});

describe('ActasMesaEstado · corrección controlada y supervisión', () => {
  it('corregir manda los datos, refresca y devuelve qué ocurrió con la comparación', async () => {
    const { api, estado, cerrar } = crear('coordinador');
    api.detalleActual = detalle(libre, false);
    await estado.seleccionar('v1');
    const r = await estado.corregirDatos('p1', { responsableArl: 'cun', justificacion: 'Acuerdo con la empresa.' });
    assert.equal(r?.actaIniciacion, 'recalculada');
    assert.ok(api.llamadas.some((l) => l.startsWith('corregir:p1:') && l.includes('"responsableArl":"cun"')));
    cerrar();
  });
  it('un auxiliar no carga la supervisión (la API tampoco se la daría)', async () => {
    const aux = crear('auxiliar');
    await aux.estado.cargarSupervision();
    assert.ok(!aux.api.llamadas.includes('supervision'));
    const co = crear('coordinador');
    await co.estado.cargarSupervision();
    assert.ok(co.api.llamadas.includes('supervision'));
    assert.ok(co.estado.supervision());
  });
});
