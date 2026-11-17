import { ForbiddenException } from '@nestjs/common';
import { CargueEstudianteService } from '../src/application/use-cases/documentos/cargue-estudiante.service';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { EntradaBitacora, TipoEntradaBitacora } from '../src/domain/entities/bitacora.entity';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { EstadoCargueEstudiante, PeriodoAcademico, TipoVentana } from '../src/domain/entities/periodo.entity';
import { CicloAcademico, DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';

/**
 * G2 · Cargue del estudiante controlado por la ventana del periodo.
 * Antes de G2 regía PQRS n.º 54 («fin de la práctica + ocho días»); ya NO extiende el cargue ordinario.
 * Instantes en hora de Colombia (UTC−5): `col('2027-05-30', 22)` son las 10 p. m. del 30 de mayo.
 */
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const col = (iso: string, hora = 12) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hora + 5));

function periodoCon(opciones: { activo?: boolean; habilitado?: boolean; ventana?: boolean } = {}) {
  const ventanas = PeriodoAcademico.ventanasHabituales(dia('2027-01-20'), dia('2027-06-30'));
  if (opciones.ventana === false) delete ventanas[TipoVentana.CARGUE_ESTUDIANTE];
  else ventanas[TipoVentana.CARGUE_ESTUDIANTE] = { desde: dia('2027-02-01'), hasta: dia('2027-05-30') };
  return PeriodoAcademico.desde({
    codigo: '2027A', nombre: '2027A', calendario: 'presencial', fechaInicio: dia('2027-01-20'), fechaFin: dia('2027-06-30'),
    ventanas, jornadasInduccion: [], fechaCargueDocumentos: dia('2027-05-30'), sincronizacionDocentes: true, modalidadesHabilitadas: [],
    activo: opciones.activo ?? true, cargueEstudianteHabilitado: opciones.habilitado ?? true,
    creadoEn: dia('2027-01-01'), actualizadoEn: dia('2027-01-01'),
  });
}

const practica: DatosPractica = {
  id: 'p1', numeroFur: 7, estudianteId: 'est-1', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG', regional: 'Bogotá', asignatura: null,
  ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2027A', modalidad: ModalidadPractica.PASANTIA,
  estado: EstadoPractica.ACTIVA, tutorId: 'doc-1', empresaId: null, empresaRazonSocial: 'X', empresaNit: null, area: null,
  cargo: null, tipoRemuneracion: null, salario: null, horario: null, jefeInmediatoNombre: null, jefeInmediatoCargo: null,
  jefeInmediatoCorreo: null, jefeInmediatoTelefono: null, ciudad: null, funcionesRelevantes: null,
  // Termina el 28 de mayo: con la regla anterior, «+8 días» habría permitido cargar hasta el 5 de junio.
  fechaInicio: dia('2027-02-15'), fechaFin: dia('2027-05-28'), horasRegistradas: null, arlVerificada: true,
  responsableArlPractica: null, arlFechaAfiliacion: dia('2027-02-12'), terminosAceptadosEn: dia('2027-02-01'), registradaPor: 'estudiante', nota: null,
  cerradaEn: null, ultimaActividad: dia('2027-02-01'), creadaEn: dia('2027-02-01'), actualizadaEn: dia('2027-02-01'),
};

const actor = (rol: Rol, extra: Record<string, unknown> = {}) => ({
  id: rol === Rol.ESTUDIANTE ? 'est-1' : `${rol}-1`, correo: `${rol}@cun.edu.co`, rol, permiso: 'escritura' as const,
  escuelas: [], empresaId: null, ...extra,
});
const estudiante = actor(Rol.ESTUDIANTE);

const version = (tipo: TipoDocumento, estado: EstadoDocumento, actualizadoEn: Date, v = 1): DatosDocumento => ({
  id: `${tipo}-${v}`, practicaId: 'p1', tipo, version: v, estado,
  nombreOriginal: 'x.pdf', mimeReal: 'application/pdf', tamanoBytes: 10, hashSha256: 'h', hashPerceptual: null,
  rutaAlmacenamiento: 'r', calidadCaptura: null, banderas: [], puntaje: null, banda: null, extraccion: null,
  decididoPor: 'doc-1', justificacionDecision: null, motivoDevolucion: estado === EstadoDocumento.DEVUELTO ? 'Ilegible el NIT' : null,
  cargadoEn: dia('2027-05-01'), actualizadoEn, purgarDespuesDe: null,
});

function armar(opciones: { periodo?: PeriodoAcademico | null; versiones?: DatosDocumento[] } = {}) {
  const periodo = opciones.periodo === undefined ? periodoCon() : opciones.periodo;
  return new GestionarDocumentoUseCase(
    { listarPorPractica: async () => (opciones.versiones ?? []).map((d) => Documento.desde(d)), ultimaVersion: async () => 0 } as never,
    { buscarPorId: async () => Practica.desde(practica) } as never,
    {} as never, { registrar: async () => undefined } as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never,
    { buscarPorCodigo: async () => periodo } as never,
    { numero: async () => 8 } as never,
    { exigirParaCargar: async () => undefined } as never,
    {} as never,
  );
}

/** Sube un «archivo» que no es PDF: si el cargue está permitido, falla DESPUÉS, en la verificación del archivo. */
const subir = (caso: GestionarDocumentoUseCase, tipo = TipoDocumento.CARTA_FINALIZACION, quien = estudiante) => caso.cargar(
  'p1', tipo, { nombreOriginal: 'x.txt', mimeDeclarado: 'text/plain', contenido: Buffer.from('no es un pdf') },
  null, 10_000_000, quien,
);
const PERMITIDO = /no es un PDF/;

async function rechazo(p: Promise<unknown>): Promise<Error> {
  const e = await p.then(() => null, (x: unknown) => x as Error);
  expect(e).toBeInstanceOf(ForbiddenException);
  return e as Error;
}

beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
afterEach(() => jest.useRealTimers());
const hoy = (instante: Date) => jest.setSystemTime(instante);

describe('G2 · cargue del estudiante: la ventana del periodo manda', () => {
  it('antes de «desde»: rechazado con el mensaje de «aún no inicia»', async () => {
    hoy(col('2027-01-31', 23));
    expect((await rechazo(subir(armar()))).message).toMatch(/aún no inicia/);
  });

  it('exactamente «desde» (primera hora del día en Colombia): permitido', async () => {
    hoy(col('2027-02-01', 0));
    await expect(subir(armar())).rejects.toThrow(PERMITIDO);
  });

  it('entre fechas: permitido', async () => {
    hoy(col('2027-04-10'));
    await expect(subir(armar())).rejects.toThrow(PERMITIDO);
  });

  it('exactamente «hasta», a las 10 p. m. de Colombia (ya es el día siguiente en UTC): permitido', async () => {
    hoy(col('2027-05-30', 22));
    await expect(subir(armar())).rejects.toThrow(PERMITIDO);
  });

  it('el día posterior a «hasta»: rechazado', async () => {
    hoy(col('2027-05-31', 0));
    expect((await rechazo(subir(armar()))).message).toMatch(/finalizó el 30 de mayo de 2027/);
  });

  it('el fin de la práctica + 8 días YA NO extiende el cargue ordinario', async () => {
    hoy(col('2027-06-02'));
    await rechazo(subir(armar()));
  });

  it('cargue inhabilitado manualmente: rechazado aunque las fechas estén vigentes', async () => {
    hoy(col('2027-04-10'));
    expect((await rechazo(subir(armar({ periodo: periodoCon({ habilitado: false }) })))).message).toMatch(/restringido temporalmente/);
  });

  it('periodo inactivo: rechazado', async () => {
    hoy(col('2027-04-10'));
    await rechazo(subir(armar({ periodo: periodoCon({ activo: false }) })));
  });

  it('periodo inexistente: falla CERRADA con mensaje operativo', async () => {
    hoy(col('2027-04-10'));
    expect((await rechazo(subir(armar({ periodo: null })))).message).toMatch(/No encontramos una ventana de cargue habilitada/);
  });

  it('periodo sin ventana de cargue configurada: falla cerrada', async () => {
    hoy(col('2027-04-10'));
    await rechazo(subir(armar({ periodo: periodoCon({ ventana: false }) })));
  });
});

describe('G2 · subsanación específica por tipo (ventana cerrada por fecha)', () => {
  const rutDevuelto = version(TipoDocumento.RUT_NATURAL, EstadoDocumento.DEVUELTO, col('2027-06-03', 9));

  it('RUT devuelto el 3 de junio: el RUT se puede corregir hasta el 11 de junio (3 + 8 días)', async () => {
    hoy(col('2027-06-11', 22));
    await expect(subir(armar({ versiones: [rutDevuelto] }), TipoDocumento.RUT_NATURAL)).rejects.toThrow(PERMITIDO);
  });

  it('la devolución del RUT NO abre EPS, Cámara ni Acta', async () => {
    hoy(col('2027-06-05'));
    for (const tipo of [TipoDocumento.CERTIFICADO_EPS, TipoDocumento.CAMARA_COMERCIO, TipoDocumento.ACTA_INICIO]) {
      expect((await rechazo(subir(armar({ versiones: [rutDevuelto] }), tipo))).message).toMatch(/aplica únicamente a/);
    }
  });

  it('y viceversa: una EPS ilegible habilita EPS, no el RUT', async () => {
    hoy(col('2027-06-05'));
    const eps = version(TipoDocumento.CERTIFICADO_EPS, EstadoDocumento.ILEGIBLE, col('2027-06-02'));
    await expect(subir(armar({ versiones: [eps] }), TipoDocumento.CERTIFICADO_EPS)).rejects.toThrow(PERMITIDO);
    await rechazo(subir(armar({ versiones: [eps] }), TipoDocumento.RUT_NATURAL));
  });

  it('vencido el plazo de subsanación, el RUT vuelve a quedar bloqueado', async () => {
    hoy(col('2027-06-12', 0));
    await rechazo(subir(armar({ versiones: [rutDevuelto] }), TipoDocumento.RUT_NATURAL));
  });

  it('si ya cargó una corrección (la última versión no está devuelta), la devolución anterior no abre nada', async () => {
    hoy(col('2027-06-05'));
    const corregido = version(TipoDocumento.RUT_NATURAL, EstadoDocumento.RECIBIDO, col('2027-06-04'), 2);
    await rechazo(subir(armar({ versiones: [rutDevuelto, corregido] }), TipoDocumento.RUT_NATURAL));
  });

  it('con el cargue inhabilitado o el periodo inactivo, la devolución NO habilita nada', async () => {
    hoy(col('2027-06-05'));
    await rechazo(subir(armar({ periodo: periodoCon({ habilitado: false }), versiones: [rutDevuelto] }), TipoDocumento.RUT_NATURAL));
    await rechazo(subir(armar({ periodo: periodoCon({ activo: false }), versiones: [rutDevuelto] }), TipoDocumento.RUT_NATURAL));
  });

  it('un «plazo de subsanación» de la bitácora habilita solo los documentos que el docente indicó', async () => {
    hoy(col('2027-06-05'));
    const entrada = EntradaBitacora.nueva({
      id: 'b1', practicaId: 'p1', tipo: TipoEntradaBitacora.PLAZO_SUBSANACION, autor: 'docente', autorId: 'doc-1',
      mensaje: 'Cargue la planilla', detalle: { documentos: [TipoDocumento.PLANILLA_HORAS], venceEl: col('2027-06-09').toISOString() },
      venceEl: col('2027-06-09'), creadaEn: col('2027-06-01'),
    });
    const servicio = new CargueEstudianteService(
      { buscarPorCodigo: async () => periodoCon() } as never,
      { listarPorPractica: async () => [] } as never,
      { numero: async () => 8 } as never,
      { listarPorPractica: async () => [entrada] } as never,
    );
    const contexto = await servicio.contexto(Practica.desde(practica));
    expect(contexto.evaluacion.estado).toBe(EstadoCargueEstudiante.CERRADO_POR_FECHA);
    expect(servicio.puedeCargarTipo(contexto, TipoDocumento.PLANILLA_HORAS)).toBe(true);
    expect(servicio.puedeCargarTipo(contexto, TipoDocumento.CERTIFICADO_EPS)).toBe(false);
    expect(servicio.proyectar(contexto).subsanaciones).toEqual([{ tipo: TipoDocumento.PLANILLA_HORAS, vence: '2027-06-09', origen: 'bitacora' }]);
  });
});

describe('G2 · prevalidación antes de recibir el archivo', () => {
  it('estudiante con el cargue cerrado: rechazado sin archivo', async () => {
    hoy(col('2027-06-02'));
    await rechazo(armar().prevalidarCargue('p1', estudiante));
  });

  it('estudiante con una subsanación vigente: pasa la prevalidación (el tipo se exige después)', async () => {
    hoy(col('2027-06-05'));
    const rut = version(TipoDocumento.RUT_NATURAL, EstadoDocumento.DEVUELTO, col('2027-06-03'));
    await expect(armar({ versiones: [rut] }).prevalidarCargue('p1', estudiante)).resolves.toBeUndefined();
  });

  it('estudiante con la ventana abierta: pasa', async () => {
    hoy(col('2027-04-10'));
    await expect(armar().prevalidarCargue('p1', estudiante)).resolves.toBeUndefined();
  });

  it('el director no carga: rechazado en la prevalidación', async () => {
    hoy(col('2027-04-10'));
    await rechazo(armar().prevalidarCargue('p1', actor(Rol.DIRECTOR)));
    await rechazo(subir(armar(), TipoDocumento.CARTA_FINALIZACION, actor(Rol.DIRECTOR)));
  });
});

describe('G2 · otros perfiles: sin cambios (no los gobierna la ventana del estudiante)', () => {
  it.each([Rol.TUTOR, Rol.COORDINADOR, Rol.ANALISTA, Rol.ADMINISTRADOR])('%s carga aunque el cargue del estudiante esté cerrado o inhabilitado', async (rol) => {
    hoy(col('2027-06-20'));
    const quien = actor(rol, rol === Rol.TUTOR ? { id: 'doc-1' } : {});
    const caso = armar({ periodo: periodoCon({ habilitado: false }) });
    await expect(caso.prevalidarCargue('p1', quien)).resolves.toBeUndefined();
    await expect(subir(caso, TipoDocumento.CARTA_FINALIZACION, quien)).rejects.toThrow(PERMITIDO);
  });
});
