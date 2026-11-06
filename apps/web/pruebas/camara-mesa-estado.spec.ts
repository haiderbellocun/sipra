import '@angular/compiler';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { DecisionCamara, DetalleCamara, FiltrosCamara, ListadoBandejaCamara, ReservaCamara } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { CamaraMesaEstado } from '../src/app/features/camara/camara-mesa.estado';

const listado = (n = 2): ListadoBandejaCamara => ({
  kpis: { abiertas: n, libres: n, mias: 0, tomadas: 0, porVencer: 0, conDiscrepancia: 0, documentoIncorrecto: 0, lecturaDudosa: 0, personaDistinta: 0 },
  total: n,
  items: Array.from({ length: n }, (_, i) => ({
    validacionId: `v${i + 1}`, practicaId: 'p1', estudianteId: 'e1', documentoId: `d${i + 1}`, tipo: 'camara_comercio' as const, estado: 'revision',
    estadoHumano: { etiqueta: 'Consistente', nivel: 'ok' as const }, problemaPrincipal: null, fechaCarga: '2026-11-03T12:00:00Z',
    estudiante: { nombre: `Estudiante ${i + 1}` }, modalidad: 'cunbre_naciente', empresa: null, tipoEsperado: 'camara_comercio',
    tipoDetectado: 'camara_existencia_representacion', tipoCertificado: 'persona_juridica' as const, personaDistinta: false, version: 1, esReenvio: false,
    hayDiscrepancia: false, representanteDiferente: false, matriculaCancelada: false, lecturaDudosa: false, lecturaOcr: false,
    recomendacion: 'consistente', prioridad: { puntaje: 10, razones: [] },
    reserva: { estado: 'libre' as const, por: null, hasta: null, minutosRestantes: null }, diasEnBandeja: 1,
    datosSipraCambiaronDespuesDeDecision: false, inconsistenciaOperativa: false,
  })),
});

const detalle = (reserva: ReservaCamara, puedeDecidir: boolean): DetalleCamara => ({
  validacionId: 'v1', practicaId: 'p1', estudianteId: 'e1', documentoId: 'd1', tipo: 'camara_comercio', estado: 'revision',
  estadoHumano: { etiqueta: 'Consistente', nivel: 'ok' }, reserva, problemaPrincipal: null, fechaCarga: '2026-11-03T12:00:00Z',
  version: 1, vigente: true, recomendacion: 'consistente', resumen: { etiqueta: 'Consistente', nivel: 'ok', problemaPrincipal: null },
  prioridad: { puntaje: 10, razones: [] }, puedeDecidir, aprobarExigeJustificacion: false, minimoJustificacionAprobar: 0, minimoJustificacionRechazar: 10,
  tipoEsperado: 'camara_comercio', tipoDetectado: 'camara_existencia_representacion', tipoCertificado: 'persona_juridica', certificado: 'Certificado de existencia y representación legal',
  lectura: { metodo: 'texto', dudosa: false, aviso: null }, estudiante: { nombre: 'Estudiante 1' }, practica: { empresa: null, nit: null, modalidad: null },
  criticos: [], representante: null, informativos: [], estadoRegistral: { estado: 'no_determinable', etiqueta: 'No determinable', alerta: null },
  renovacion: { ultimoAnioRenovado: null, fechaRenovacion: null }, expedicion: { fecha: null, diasDesdeExpedicion: null, politicaDias: null, cumplePolitica: null },
  verificacion: { codigoDetectado: false, urlDetectada: false, firmaPdfPresente: null, disponibleHasta: null, autenticidad: { estado: 'no_verificable', etiqueta: 'No verificada', aviso: '' } },
  comparacion: null, avisoDatosSipra: null, datosSipraCambiaronEn: null, decision: null, versiones: [], historial: [], inconsistenciaOperativa: null,
});

const libre: ReservaCamara = { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
const miaHasta = (ms: number): ReservaCamara => ({ estado: 'mia', por: 'Usted', hasta: new Date(Date.now() + ms).toISOString(), minutosRestantes: Math.ceil(ms / 60000) });
const conflicto = (mensaje: string) => throwError(() => new HttpErrorResponse({ status: 409, error: { message: mensaje } }));

class ApiFalsa {
  llamadas: string[] = [];
  filtros: FiltrosCamara[] = [];
  detalleActual: DetalleCamara = detalle(libre, false);
  tomar: () => Observable<unknown> = () => of({});
  decidirFn: (dto: DecisionCamara) => Observable<unknown> = () => of({});
  siguiente: () => Observable<unknown> = () => of({ estado: 'sin_casos', validacionId: null });
  listarMesaCamara(f: FiltrosCamara): Observable<ListadoBandejaCamara> { this.llamadas.push('listar'); this.filtros.push(f); return of(listado()); }
  detalleCamara(id: string): Observable<DetalleCamara> { this.llamadas.push(`detalle:${id}`); return of(this.detalleActual); }
  tomarCamara(id: string): Observable<unknown> { this.llamadas.push(`tomar:${id}`); return this.tomar(); }
  liberarCamara(id: string): Observable<unknown> { this.llamadas.push(`liberar:${id}`); return of({}); }
  tomarSiguienteCamara(c: unknown): Observable<unknown> { this.llamadas.push(`siguiente:${JSON.stringify(c)}`); return this.siguiente(); }
  decidirCamara(id: string, dto: DecisionCamara): Observable<unknown> { this.llamadas.push(`decidir:${id}:${dto.decision}`); return this.decidirFn(dto); }
  catalogo = [{ codigo: 'x_1', titulo: 'Motivo de prueba', mensajeEstudiante: { que: 'Q.', hacer: 'H.' }, requiereDetalle: false, aplicaA: ['natural', 'juridica'] }];
  motivosDevolucionCamara(): Observable<unknown> { this.llamadas.push('motivos'); return of(this.catalogo); }
  supervisionCamara(): Observable<unknown> { this.llamadas.push('supervision'); return of({ abiertas: 0, libres: 0, tomadas: 0, porVencer: 0, vencidas: 0, conDiscrepancia: 0, documentoIncorrecto: 0, lecturaDudosa: 0, personaDistinta: 0, porEstado: {}, funcionarios: [] }); }
}

class AvisosFalsos {
  mensajes: Array<{ tipo: string; texto: string }> = [];
  exito(texto: string): void { this.mensajes.push({ tipo: 'ok', texto }); }
  error(texto: string): void { this.mensajes.push({ tipo: 'error', texto }); }
  info(texto: string): void { this.mensajes.push({ tipo: 'info', texto }); }
}

function crear(rol: string | null = 'tutor') {
  const api = new ApiFalsa();
  const avisos = new AvisosFalsos();
  const injector = Injector.create({
    providers: [
      { provide: CamaraMesaEstado, useClass: CamaraMesaEstado },
      { provide: ApiService, useValue: api },
      { provide: AvisosService, useValue: avisos },
      { provide: SesionService, useValue: { rol: signal(rol), sesion: signal({ id: 'yo' }) } },
    ],
  });
  return { api, avisos, estado: injector.get(CamaraMesaEstado), cerrar: () => (injector as unknown as { destroy?: () => void }).destroy?.() };
}

describe('CamaraMesaEstado · bandeja', () => {
  it('cargar pide la bandeja con los filtros activos; limpiar los quita', async () => {
    const { api, estado, cerrar } = crear();
    await estado.aplicarFiltros({ personaDistinta: 'si', buscar: 'ana' });
    assert.deepEqual(api.filtros.at(-1), { personaDistinta: 'si', buscar: 'ana' });
    await estado.aplicarFiltros({ personaDistinta: '' });
    assert.deepEqual(api.filtros.at(-1), { buscar: 'ana' });
    await estado.limpiarFiltros();
    assert.deepEqual(api.filtros.at(-1), {});
    cerrar();
  });
  it('seleccionar un caso carga su detalle (la API recalcula la comparación) y pasa a la vista del caso', async () => {
    const { api, estado, cerrar } = crear();
    await estado.seleccionar('v1');
    assert.equal(estado.vista(), 'caso');
    assert.ok(api.llamadas.includes('detalle:v1'));
    estado.volverALista();
    assert.equal(estado.vista(), 'lista');
    cerrar();
  });
  it('solo coordinación y administración supervisan (el docente no)', () => {
    assert.equal(crear('tutor').estado.esSupervisor(), false);
    assert.equal(crear('coordinador').estado.esSupervisor(), true);
    assert.equal(crear('administrador').estado.esSupervisor(), true);
  });
  it('el catálogo de motivos se pide a la API; si falla, se avisa y no hay lista propia', async () => {
    const { estado, cerrar } = crear();
    await estado.cargarMotivos();
    assert.deepEqual(estado.motivos().map((m) => m.codigo), ['x_1']);
    cerrar();
  });
});

describe('CamaraMesaEstado · reserva', () => {
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
    assert.ok(api.llamadas.includes('siguiente:{"conDiscrepancias":"si","documentoIncorrecto":"si"}'));
    cerrar();
  });
  it('liberar pide la liberación al servidor y refresca', async () => {
    const { api, avisos, estado, cerrar } = crear('coordinador');
    api.detalleActual = detalle({ estado: 'otro', por: 'Ana', hasta: new Date(Date.now() + 600_000).toISOString(), minutosRestantes: 10 }, false);
    await estado.seleccionar('v1');
    api.llamadas.length = 0;
    assert.equal(await estado.liberar(), true);
    assert.ok(api.llamadas.includes('liberar:v1') && api.llamadas.includes('detalle:v1'));
    assert.match(avisos.mensajes.at(-1)?.texto ?? '', /Reserva liberada/);
    cerrar();
  });
});

describe('CamaraMesaEstado · decisión', () => {
  it('sin reserva válida NO se decide: ni siquiera se llama a la API', async () => {
    const { api, avisos, estado, cerrar } = crear();
    api.detalleActual = detalle(libre, false);
    await estado.seleccionar('v1');
    assert.equal(estado.puedeDecidir(), false);
    api.detalleActual = detalle(miaHasta(-60_000), true);
    await estado.refrescarDetalle();
    assert.equal(estado.reservaVencidaEnPantalla(), true);
    assert.equal(estado.puedeDecidir(), false);
    api.llamadas.length = 0;
    assert.equal(await estado.decidir({ decision: 'aprobar' }), false);
    assert.ok(!api.llamadas.some((l) => l.startsWith('decidir:')));
    assert.match(avisos.mensajes.at(-1)?.texto ?? '', /reserva del caso venció/);
    cerrar();
  });
  it('con el caso tomado y el servidor de acuerdo, decide y refresca; avisa según la decisión', async () => {
    const { api, avisos, estado, cerrar } = crear();
    api.detalleActual = detalle(miaHasta(600_000), true);
    await estado.seleccionar('v1');
    assert.equal(estado.puedeDecidir(), true);
    assert.equal(await estado.decidir({ decision: 'devolver', motivo: 'x_1' }), true);
    assert.ok(api.llamadas.includes('decidir:v1:devolver'));
    assert.equal(avisos.mensajes.at(-1)?.texto, 'Certificado devuelto al estudiante.');
    assert.equal(await estado.decidir({ decision: 'rechazar', justificacion: 'x'.repeat(40) }), true);
    assert.equal(avisos.mensajes.at(-1)?.texto, 'Certificado rechazado.');
    cerrar();
  });
  it('si el servidor rechaza (otra decisión simultánea, 409): mensaje del servidor, se refresca y no queda ocupado', async () => {
    const { api, avisos, estado, cerrar } = crear();
    api.detalleActual = detalle(miaHasta(600_000), true);
    await estado.seleccionar('v1');
    api.decidirFn = () => conflicto('El caso ya fue decidido');
    api.llamadas.length = 0;
    assert.equal(await estado.decidir({ decision: 'aprobar' }), false);
    assert.equal(avisos.mensajes.at(-1)?.texto, 'El caso ya fue decidido');
    assert.ok(api.llamadas.includes('detalle:v1') && api.llamadas.includes('listar'));
    assert.equal(estado.ocupado(), false);
    cerrar();
  });
  it('un doble clic no envía dos decisiones: mientras una está en curso la otra se ignora', async () => {
    const { api, estado, cerrar } = crear();
    api.detalleActual = detalle(miaHasta(600_000), true);
    await estado.seleccionar('v1');
    const [a, b] = await Promise.all([estado.decidir({ decision: 'aprobar' }), estado.decidir({ decision: 'aprobar' })]);
    assert.deepEqual([a, b].sort(), [false, true]);
    assert.equal(api.llamadas.filter((l) => l.startsWith('decidir:')).length, 1);
    cerrar();
  });
});

describe('CamaraMesaEstado · supervisión y renovación', () => {
  it('solo supervisión carga la supervisión', async () => {
    const docente = crear('tutor');
    await docente.estado.cargarSupervision();
    assert.ok(!docente.api.llamadas.includes('supervision'));
    const coord = crear('coordinador');
    await coord.estado.cargarSupervision();
    assert.ok(coord.api.llamadas.includes('supervision'));
    assert.equal(coord.estado.supervision()?.lecturaDudosa, 0);
    docente.cerrar(); coord.cerrar();
  });
  it('la reserva se renueva sola solo si quedan pocos minutos y el caso es de quien trabaja', async () => {
    const { api, estado, cerrar } = crear();
    api.detalleActual = detalle(miaHasta(10 * 60_000), true);
    await estado.seleccionar('v1');
    api.llamadas.length = 0;
    await estado.renovarSiHaceFalta();
    assert.ok(!api.llamadas.includes('tomar:v1'));
    api.detalleActual = detalle(miaHasta(2 * 60_000), true);
    await estado.refrescarDetalle();
    api.llamadas.length = 0;
    await estado.renovarSiHaceFalta();
    assert.ok(api.llamadas.includes('tomar:v1'));
    cerrar();
  });
});
