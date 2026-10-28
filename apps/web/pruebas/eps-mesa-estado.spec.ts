import '@angular/compiler';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { DecisionMesa, DetalleMesa, FiltrosMesa, ListadoMesa, ReservaMesa } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { EpsMesaEstado } from '../src/app/features/eps/eps-mesa.estado';

// ── Dobles ──────────────────────────────────────────────────────────────────

const listado = (n = 2): ListadoMesa => ({
  kpis: { abiertas: n, pendientes: n, enRevision: 0, pendientesAdres: 0, conDiscrepancias: 0, candidatos: 0, asignadosAMi: 0, misPorVencer: 0 },
  total: n, pagina: 1, limite: 25, truncado: false, mostrando: n, generadoEn: '2026-10-26T12:00:00Z',
  filtrosDisponibles: { periodos: [], programas: [], modalidades: [] },
  filas: Array.from({ length: n }, (_, i) => ({
    validacionId: `v${i + 1}`, documentoId: `d${i + 1}`, estudiante: { nombre: `Estudiante ${i + 1}`, documentoEnmascarado: '••••0001' },
    programa: 'Ingeniería', modalidad: 'presencial', periodo: '2026-2', fechaInicioPractica: null, versionDocumento: 1, totalVersiones: 1,
    recibidaEn: '2026-10-20T12:00:00Z', procesamiento: 'procesado', autenticidad: 'no_evaluada', afiliacion: 'no_contrastada',
    estadoAdres: 'pendiente' as const, recomendacion: 'pendiente_adres', discrepancias: { criticas: 0, informativas: 0 }, decision: 'pendiente',
    prioridad: { puntaje: 10, razones: [] }, reserva: { estado: 'libre' as const, responsable: null, hasta: null },
  })),
});

const detalle = (reserva: ReservaMesa, esMia: boolean): DetalleMesa => ({
  caso: {
    validacionId: 'v1', documentoId: 'd1', practicaId: 'p1', estudiante: { nombre: 'Estudiante 1', documento: null, documentoEnmascarado: '••••0001' },
    programa: 'Ingeniería', modalidad: 'presencial', periodo: '2026-2', fechaInicioPractica: null, esVersionVigente: true, version: 1, totalVersiones: 1,
    decision: 'pendiente', decididoEn: null,
  },
  acceso: { puedeVerValores: esMia, esMia, reserva, puedeDecidir: esMia, puedeConsultarAdres: esMia, motivoSinAcceso: null },
  certificado: { nombreOriginal: 'c.pdf', mime: 'application/pdf', tamanoBytes: 1, version: 1, cargadoEn: '2026-10-20T12:00:00Z', estadoDocumento: 'recibido', metodoExtraccion: 'texto_nativo', lectura: { estado: 'leida', motivo: null }, clasificacion: { tipo: 'certificado_eps_probable', motivos: [] }, vigencia: 'vigente', vigenciaDetalle: { fechaExpedicion: null, diasTranscurridos: null, diasVigencia: 30 }, campos: [] },
  autenticidad: { estado: 'no_evaluada', metodo: 'ninguno', verificador: null, verificadoEn: null, qrHallados: 0, explicacion: '' },
  afiliacion: { estado: 'no_contrastada', fuente: 'ninguna', consultadoEn: null, fuenteActualizadaEn: null, estadoAdres: 'pendiente', frescura: { politicaDefinida: false, dias: null, vencida: null, diasDesdeConsulta: null } },
  comparacion: [], discrepancias: [], recomendacion: { codigo: 'pendiente_adres', titulo: 'Falta ADRES', explicacion: '', esDecision: false, tambien: [] },
  adres: { resultado: null, estado: 'pendiente', tipoDocumento: null, error: null, cargadaEn: null }, evidencias: [], historial: [], versiones: [],
  metricas: { recibidaEn: null, primeraRevisionEn: null, decididoEn: null, horasHastaDecision: null, reenvios: 0 },
  prioridad: { puntaje: 10, razones: [] }, retencion: 'POLÍTICA DE RETENCIÓN EPS PENDIENTE DE DEFINICIÓN INSTITUCIONAL',
});

const libre: ReservaMesa = { estado: 'libre', responsable: null, hasta: null };
const miaHasta = (ms: number): ReservaMesa => ({ estado: 'mia', responsable: 'Usted', hasta: new Date(Date.now() + ms).toISOString() });
const conflicto = (mensaje: string) => throwError(() => new HttpErrorResponse({ status: 409, error: { message: mensaje } }));

class ApiFalsa {
  llamadas: string[] = [];
  filtrosRecibidos: FiltrosMesa[] = [];
  detalleActual: DetalleMesa = detalle(libre, false);
  listadoActual: ListadoMesa = listado();
  tomar: () => Observable<unknown> = () => of({});
  decidirFn: (dto: DecisionMesa) => Observable<unknown> = () => of({});
  siguiente: () => Observable<unknown> = () => of({ estado: 'sin_casos', mensaje: 'No hay casos disponibles ahora.' });

  listarMesaEps(f: FiltrosMesa): Observable<ListadoMesa> { this.llamadas.push('listar'); this.filtrosRecibidos.push(f); return of(this.listadoActual); }
  detalleMesaEps(id: string): Observable<DetalleMesa> { this.llamadas.push(`detalle:${id}`); return of(this.detalleActual); }
  tomarCasoEps(id: string): Observable<unknown> { this.llamadas.push(`tomar:${id}`); return this.tomar(); }
  liberarCasoEps(id: string): Observable<unknown> { this.llamadas.push(`liberar:${id}`); return of({}); }
  tomarSiguienteEps(): Observable<unknown> { this.llamadas.push('siguiente'); return this.siguiente(); }
  decidirMesaEps(id: string, dto: DecisionMesa): Observable<unknown> { this.llamadas.push(`decidir:${id}:${dto.decision}`); return this.decidirFn(dto); }
  supervisionMesaEps(): Observable<unknown> { return of({ abiertas: 0, sinAsignar: 0, horasMediasHastaPrimeraRevision: null, funcionarios: [] }); }
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
  const rolSenal = signal(rol);
  const injector = Injector.create({
    providers: [
      { provide: EpsMesaEstado, useClass: EpsMesaEstado },
      { provide: ApiService, useValue: api },
      { provide: AvisosService, useValue: avisos },
      { provide: SesionService, useValue: { rol: rolSenal, sesion: signal({ id: 'yo' }) } },
    ],
  });
  const estado = injector.get(EpsMesaEstado);
  return { api, avisos, estado, rolSenal, cerrar: () => (injector as unknown as { destroy?: () => void }).destroy?.() };
}

// ── Pruebas ─────────────────────────────────────────────────────────────────

describe('EpsMesaEstado · bandeja y filtros', () => {
  let ctx: ReturnType<typeof crear>;
  beforeEach(() => { ctx = crear(); });
  afterEach(() => ctx.cerrar());

  it('carga el listado y lo expone como filas', async () => {
    await ctx.estado.cargar();
    assert.equal(ctx.estado.filas().length, 2);
    assert.equal(ctx.estado.errorListado(), null);
    assert.equal(ctx.estado.cargando(), false);
  });

  it('si la bandeja está truncada (más casos que el tope) el estado lo expone y los KPI traen el total real', async () => {
    ctx.api.listadoActual = { ...listado(3), truncado: true, mostrando: 3, kpis: { ...listado(3).kpis, abiertas: 12000 } };
    await ctx.estado.cargar();
    assert.equal(ctx.estado.listado()?.truncado, true);
    assert.equal(ctx.estado.listado()?.kpis.abiertas, 12000);
    assert.equal(ctx.estado.filas().length, 3);
  });

  it('un error de la API se traduce y no deja la pantalla cargando', async () => {
    ctx.api.listarMesaEps = () => throwError(() => new HttpErrorResponse({ status: 500 }));
    await ctx.estado.cargar();
    assert.match(ctx.estado.errorListado() ?? '', /servidor/i);
    assert.equal(ctx.estado.cargando(), false);
  });

  it('aplicar filtros descarta los vacíos y vuelve a la página 1', async () => {
    await ctx.estado.aplicarFiltros({ estadoAdres: 'pendiente', pagina: 3 });
    await ctx.estado.aplicarFiltros({ estadoAdres: '', programa: 'Ingeniería' });
    const enviado = ctx.api.filtrosRecibidos.at(-1) as FiltrosMesa;
    assert.equal(enviado.estadoAdres, undefined);
    assert.equal(enviado.programa, 'Ingeniería');
    assert.equal(enviado.pagina, 1);
  });

  it('limpiar filtros vuelve a la vista "todos" sin criterios', async () => {
    await ctx.estado.elegirVista('mis');
    await ctx.estado.aplicarFiltros({ programa: 'X' });
    await ctx.estado.limpiarFiltros();
    assert.deepEqual(ctx.estado.filtros(), {});
    assert.equal(ctx.estado.vistaRapida(), 'todos');
  });

  it('"Mis casos" pide solo los propios y "Míos · falta ADRES" suma el estado', async () => {
    await ctx.estado.elegirVista('mis');
    assert.equal((ctx.api.filtrosRecibidos.at(-1) as FiltrosMesa).soloMios, 'true');
    await ctx.estado.elegirVista('mis_pendiente_adres');
    const f = ctx.api.filtrosRecibidos.at(-1) as FiltrosMesa;
    assert.equal(f.soloMios, 'true');
    assert.equal(f.estadoAdres, 'pendiente');
  });

  it('la búsqueda espera un instante antes de consultar', async () => {
    ctx.estado.buscar('  ana  ');
    assert.equal(ctx.api.llamadas.filter((l) => l === 'listar').length, 0);
    await new Promise((r) => setTimeout(r, 450));
    assert.equal((ctx.api.filtrosRecibidos.at(-1) as FiltrosMesa).buscar, 'ana');
  });
});

describe('EpsMesaEstado · selección y reserva', () => {
  let ctx: ReturnType<typeof crear>;
  beforeEach(() => { ctx = crear(); });
  afterEach(() => ctx.cerrar());

  it('seleccionar abre el detalle (vista de detalle en pantallas angostas)', async () => {
    await ctx.estado.seleccionar('v1');
    assert.equal(ctx.estado.vista(), 'detalle');
    assert.equal(ctx.estado.detalle()?.caso.validacionId, 'v1');
    ctx.estado.volverALista();
    assert.equal(ctx.estado.vista(), 'lista');
  });

  it('tomar un caso refresca detalle y bandeja y avisa', async () => {
    await ctx.estado.seleccionar('v1');
    ctx.api.detalleActual = detalle(miaHasta(15 * 60_000), true);
    assert.equal(await ctx.estado.tomar(), true);
    assert.equal(ctx.estado.puedeActuar(), true);
    assert.ok(ctx.api.llamadas.includes('tomar:v1'));
    assert.equal(ctx.avisos.mensajes.at(-1)?.tipo, 'ok');
  });

  it('si otra persona ya lo tomó (409) se muestra el mensaje y se refresca el estado', async () => {
    await ctx.estado.seleccionar('v1');
    ctx.api.tomar = () => conflicto('El caso ya está reservado por otra persona');
    ctx.api.detalleActual = detalle({ estado: 'ajena', responsable: 'Otra', hasta: new Date(Date.now() + 600_000).toISOString() }, false);
    const antes = ctx.api.llamadas.filter((l) => l.startsWith('detalle')).length;
    assert.equal(await ctx.estado.tomar(), false);
    assert.equal(ctx.avisos.mensajes.at(-1)?.texto, 'El caso ya está reservado por otra persona');
    assert.ok(ctx.api.llamadas.filter((l) => l.startsWith('detalle')).length > antes);
    assert.equal(ctx.estado.puedeActuar(), false);
  });

  it('una reserva propia vencida deja de permitir actuar', async () => {
    ctx.api.detalleActual = detalle(miaHasta(-1000), true);
    await ctx.estado.seleccionar('v1');
    assert.equal(ctx.estado.reservaVencidaEnPantalla(), true);
    assert.equal(ctx.estado.puedeActuar(), false);
  });

  it('sin doble envío: una segunda acción mientras hay una en curso se ignora', async () => {
    await ctx.estado.seleccionar('v1');
    let liberar!: () => void;
    ctx.api.tomar = () => new Observable((s) => { liberar = () => { s.next({}); s.complete(); }; });
    const primera = ctx.estado.tomar();
    assert.equal(ctx.estado.ocupado(), true);
    assert.equal(await ctx.estado.tomar(), false);
    liberar();
    await primera;
    assert.equal(ctx.api.llamadas.filter((l) => l === 'tomar:v1').length, 1);
    assert.equal(ctx.estado.ocupado(), false);
  });

  it('renueva la reserva solo si quedan menos de 5 minutos', async () => {
    ctx.api.detalleActual = detalle(miaHasta(10 * 60_000), true);
    await ctx.estado.seleccionar('v1');
    await ctx.estado.renovarSiHaceFalta();
    assert.equal(ctx.api.llamadas.includes('tomar:v1'), false);
    ctx.api.detalleActual = detalle(miaHasta(2 * 60_000), true);
    await ctx.estado.refrescarDetalle();
    await ctx.estado.renovarSiHaceFalta();
    assert.equal(ctx.api.llamadas.includes('tomar:v1'), true);
  });
});

describe('EpsMesaEstado · tomar siguiente', () => {
  let ctx: ReturnType<typeof crear>;
  beforeEach(() => { ctx = crear(); });
  afterEach(() => ctx.cerrar());

  it('sin casos: avisa y no selecciona nada', async () => {
    await ctx.estado.tomarSiguiente();
    assert.equal(ctx.estado.seleccionId(), null);
    assert.equal(ctx.avisos.mensajes.at(-1)?.tipo, 'info');
  });

  it('con caso: el servidor lo asigna y la pantalla lo abre', async () => {
    ctx.api.siguiente = () => of({ estado: 'tomado', validacionId: 'v2' });
    ctx.api.detalleActual = { ...detalle(miaHasta(900_000), true), caso: { ...detalle(libre, false).caso, validacionId: 'v2' } };
    await ctx.estado.tomarSiguiente();
    assert.equal(ctx.estado.seleccionId(), 'v2');
    assert.equal(ctx.estado.vista(), 'detalle');
    assert.equal(ctx.estado.detalle()?.caso.validacionId, 'v2');
  });
});

describe('EpsMesaEstado · decisiones', () => {
  let ctx: ReturnType<typeof crear>;
  beforeEach(() => { ctx = crear(); });
  afterEach(() => ctx.cerrar());

  it('decidir con reserva vencida no llama a la API', async () => {
    ctx.api.detalleActual = detalle(miaHasta(-1000), true);
    await ctx.estado.seleccionar('v1');
    assert.equal(await ctx.estado.decidir({ decision: 'aprobar' }), false);
    assert.equal(ctx.api.llamadas.some((l) => l.startsWith('decidir')), false);
    assert.match(ctx.avisos.mensajes.at(-1)?.texto ?? '', /venció/);
  });

  it('decidir con reserva vigente envía la decisión y avisa', async () => {
    ctx.api.detalleActual = detalle(miaHasta(600_000), true);
    await ctx.estado.seleccionar('v1');
    assert.equal(await ctx.estado.decidir({ decision: 'devolver', motivo: 'documento_ilegible' }), true);
    assert.ok(ctx.api.llamadas.includes('decidir:v1:devolver'));
    assert.match(ctx.avisos.mensajes.at(-1)?.texto ?? '', /devuelto/i);
  });

  it('si el servidor rechaza la decisión se muestra el motivo y se refresca', async () => {
    ctx.api.detalleActual = detalle(miaHasta(600_000), true);
    await ctx.estado.seleccionar('v1');
    ctx.api.decidirFn = () => conflicto('Su reserva del caso venció: tómelo de nuevo antes de decidir');
    assert.equal(await ctx.estado.decidir({ decision: 'aprobar' }), false);
    assert.match(ctx.avisos.mensajes.at(-1)?.texto ?? '', /reserva del caso venció/);
  });
});

describe('EpsMesaEstado · permisos de pantalla', () => {
  it('solo coordinación y administración son supervisión', () => {
    for (const [rol, esperado] of [['auxiliar', false], ['coordinador', true], ['administrador', true], ['tutor', false], ['estudiante', false]] as const) {
      const ctx = crear(rol);
      assert.equal(ctx.estado.esSupervisor(), esperado, rol);
      ctx.cerrar();
    }
  });

  it('un perfil sin supervisión no carga el panel de supervisión', async () => {
    const ctx = crear('auxiliar');
    await ctx.estado.cargarSupervision();
    assert.equal(ctx.estado.supervision(), null);
    ctx.cerrar();
  });

  it('coordinación sí lo carga', async () => {
    const ctx = crear('coordinador');
    await ctx.estado.cargarSupervision();
    assert.notEqual(ctx.estado.supervision(), null);
    ctx.cerrar();
  });
});
