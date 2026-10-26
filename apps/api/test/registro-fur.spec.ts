import { BadRequestException, ConflictException } from '@nestjs/common';
import { RegistrarPracticaDto } from '../src/application/dtos/practica.dto';
import { RegistrarPracticaUseCase } from '../src/application/use-cases/practicas/registrar-practica.use-case';
import { Empresa, EstadoEmpresa } from '../src/domain/entities/empresa.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { PeriodoAcademico, TipoVentana } from '../src/domain/entities/periodo.entity';
import { CicloAcademico, DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { Usuario } from '../src/domain/entities/usuario.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { EventoNotificable } from '../src/domain/services/plantillas-notificacion.domain-service';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOY = dia('2026-08-03'); // lunes, dentro de la ventana FUR de 2026C

// ── Dobles mínimos de los puertos ────────────────────────────────────────
class PracticasEnMemoria {
  filas: DatosPractica[] = [];
  async buscarPorId(id: string) { const d = this.filas.find((f) => f.id === id); return d ? Practica.desde(d) : null; }
  async listar(f: { estudianteId?: string; modalidad?: string } = {}) {
    return this.filas
      .filter((d) => (!f.estudianteId || d.estudianteId === f.estudianteId) && (!f.modalidad || (d.modalidad as string) === f.modalidad))
      .map((d) => Practica.desde(d));
  }
  async contar() { return this.filas.length; }
  async buscarRegistroVigente(estudianteId: string, periodo: string) {
    const d = this.filas.find((f) => f.estudianteId === estudianteId && f.periodoAcademico === periodo && f.estado !== EstadoPractica.ANULADA);
    return d ? Practica.desde(d) : null;
  }
  async guardar(d: DatosPractica) { this.filas = [...this.filas.filter((f) => f.id !== d.id), { ...d, numeroFur: d.numeroFur ?? this.filas.length + 1 }]; return Practica.desde(d); }
}

const estudiante = Usuario.desde({
  id: 'est-1', correo: 'laura@estudiante.cun.edu.co', nombre: 'Laura Ramírez', documento: '1032456786',
  rol: Rol.ESTUDIANTE, permiso: 'escritura', escuelas: ['ESC-NEG'], empresaId: null, programaId: 'ADM-PRO',
  activo: true, creadoEn: HOY, ultimoAccesoEn: null,
});

const periodo = PeriodoAcademico.desde({
  codigo: '2026C', nombre: '2026 · segundo periodo presencial', calendario: 'presencial',
  fechaInicio: dia('2026-07-20'), fechaFin: dia('2026-12-04'),
  ventanas: PeriodoAcademico.ventanasHabituales(dia('2026-07-20'), dia('2026-12-04'), dia('2026-08-21')),
  jornadasInduccion: [], fechaCargueDocumentos: null, sincronizacionDocentes: true, modalidadesHabilitadas: [], activo: true, creadoEn: HOY, actualizadoEn: HOY,
});

const empresaHabilitada = Empresa.desde({
  id: 'emp-1', razonSocial: 'Soluciones Logísticas Andinas S.A.S.', nitNumero: '901458772', nitDv: 2,
  ciiu: null, divipolaMunicipio: null, direccion: null, telefono: null, solicitanteNombre: 'x',
  solicitanteCorreo: 'x@x.co', solicitanteCargo: null, representanteLegal: null,
  estado: EstadoEmpresa.HABILITADA, senales: [], decididaPor: null, justificacionDecision: null,
  solicitadaEn: HOY, actualizadaEn: HOY,
});

const actorEstudiante = { id: 'est-1', correo: estudiante.correo, rol: Rol.ESTUDIANTE, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const actorCoordinacion = { id: 'coo-1', correo: 'coordinacion@cun.edu.co', rol: Rol.COORDINADOR, permiso: 'escritura' as const, escuelas: [], empresaId: null };

function armar(opciones: { periodoCerradoPermitido?: boolean; sinu?: boolean } = {}) {
  const practicas = new PracticasEnMemoria();
  const notificaciones: { evento: EventoNotificable; datos: Record<string, unknown> }[] = [];
  const auditoria: string[] = [];
  const auditorias: { accion: string; metadatos: Record<string, unknown> }[] = [];
  const caso = new RegistrarPracticaUseCase(
    practicas,
    { buscarPorCodigo: async (c: string) => (c === '2026C' ? periodo : null), listar: async () => [periodo], guardar: async () => periodo },
    {
      buscarPorId: async (id: string) => (id === 'est-1' ? estudiante : null),
      buscarPorDocumento: async (doc: string) => (doc === '1032456786' ? estudiante : null),
    } as never,
    { buscarPorNit: async (n: string) => (n === '901458772' ? empresaHabilitada : null) } as never,
    { guardarLote: async (x: unknown[]) => x } as never,
    { registrar: async (r: { accion: string; metadatos: Record<string, unknown> }) => { auditoria.push(r.accion); auditorias.push(r); } } as never,
    {
      buscarPorDocumento: async () => (opciones.sinu === false ? null : {
        documentoEstudiante: '1032456786', nombreEstudiante: 'Laura Ramírez', correoInstitucional: estudiante.correo,
        programaId: 'ADM-PRO', programaNombre: 'Administración de Empresas', escuelaId: 'ESC-NEG',
        ciclo: 'profesional', periodoAcademico: '2026C', asignaturaPractica: 'Práctica Profesional I',
      }),
      listarMatriculasPractica: async () => [],
      listarAsignacionesDocentes: async () => [],
    },
    { notificar: async (evento: EventoNotificable, _d: unknown, datos: Record<string, unknown>) => { notificaciones.push({ evento, datos }); } } as never,
    { booleano: async () => opciones.periodoCerradoPermitido ?? false, numero: async () => 0 } as never,
    { presentar: async (p: Practica) => p.instantanea() } as never,
  );
  return { caso, practicas, notificaciones, auditoria, auditorias };
}

const dto = (extra: Partial<RegistrarPracticaDto> = {}): RegistrarPracticaDto => ({
  periodoAcademico: '2026C',
  modalidad: ModalidadPractica.PASANTIA,
  empresaRazonSocial: 'Soluciones Logísticas Andinas S.A.S.',
  empresaNit: '901458772',
  area: 'Operaciones',
  cargo: 'Practicante de logística',
  tipoRemuneracion: 'remunerada',
  salario: 1_423_500,
  horario: 'Lunes a viernes, 8:00 a 17:00',
  jefeInmediatoNombre: 'Camila Restrepo Duarte',
  jefeInmediatoCargo: 'Coordinadora de operaciones',
  jefeInmediatoCorreo: 'Camila.Restrepo@logisticasandinas.com.co',
  jefeInmediatoTelefono: '3001234567',
  ciudad: 'Bogotá D. C.',
  funcionesRelevantes: 'Registro y verificación de guías; conciliación de inventario; apoyo en rutas.',
  fechaInicio: '2026-08-10',
  fechaFin: '2026-11-27',
  aceptaTerminos: true,
  ...extra,
});

describe('Formulario Único de Registro (SGP, Paso 2)', () => {
  it('registra la práctica con los datos básicos de SINU y los de la vacante', async () => {
    const { caso, practicas } = armar();
    const r = (await caso.registrar(dto(), actorEstudiante, HOY)) as unknown as DatosPractica;
    expect(r.estado).toBe(EstadoPractica.INSCRITA);
    expect(r.programaId).toBe('ADM-PRO');
    expect(r.ciclo).toBe(CicloAcademico.PROFESIONAL);
    expect(r.asignatura).toBe('Práctica Profesional I');
    expect(r.jefeInmediatoCorreo).toBe('camila.restrepo@logisticasandinas.com.co');
    expect(r.registradaPor).toBe('estudiante');
    expect(r.terminosAceptadosEn).toEqual(HOY);
    expect(practicas.filas).toHaveLength(1);
  });

  it('vincula la empresa habilitada cuando el NIT coincide, y conserva el texto si no', async () => {
    const { caso } = armar();
    const con = (await caso.registrar(dto(), actorEstudiante, HOY)) as unknown as DatosPractica;
    expect(con.empresaId).toBe('emp-1');

    const { caso: caso2 } = armar();
    const sin = (await caso2.registrar(dto({ empresaNit: 'ES-B12345678', empresaRazonSocial: 'Iberia Servicios S.L.' }), actorEstudiante, HOY)) as unknown as DatosPractica;
    expect(sin.empresaId).toBeNull();
    expect(sin.empresaNit).toBe('ES-B12345678');
  });

  it('solo admite un registro por estudiante y periodo', async () => {
    const { caso } = armar();
    await caso.registrar(dto(), actorEstudiante, HOY);
    await expect(caso.registrar(dto(), actorEstudiante, HOY)).rejects.toBeInstanceOf(ConflictException);
  });

  it('un registro anulado habilita uno nuevo', async () => {
    const { caso, practicas } = armar();
    await caso.registrar(dto(), actorEstudiante, HOY);
    practicas.filas[0].estado = EstadoPractica.ANULADA;
    await expect(caso.registrar(dto(), actorEstudiante, HOY)).resolves.toBeDefined();
  });

  it('el estudiante no registra fuera de la ventana del FUR', async () => {
    const { caso } = armar();
    const tarde = dia('2026-09-15');
    expect(periodo.ventanaAbierta(TipoVentana.REGISTRO_FUR, tarde)).toBe(false);
    await expect(caso.registrar(dto(), actorEstudiante, tarde)).rejects.toThrow(/Registro FUR/);
  });

  it('coordinación registra en periodo cerrado solo si el parámetro lo permite', async () => {
    const despues = dia('2026-12-10');
    const conDocumento = dto({ estudianteDocumento: '1032456786' });
    await expect(armar().caso.registrar(conDocumento, actorCoordinacion, despues)).rejects.toThrow(/ya cerró/);
    const permitido = armar({ periodoCerradoPermitido: true });
    // Fuera del periodo hay que usar contrato de aprendizaje o fechas del periodo; aquí se prueba solo la ventana.
    const r = (await permitido.caso.registrar(
      dto({ ...conDocumento, fechaInicio: '2026-08-10', fechaFin: '2026-11-27' }), actorCoordinacion, despues,
    )) as unknown as DatosPractica;
    expect(r.registradaPor).toBe('coordinacion');
  });

  it('rechaza sábados y domingos y fechas fuera del periodo', async () => {
    await expect(armar().caso.registrar(dto({ fechaInicio: '2026-08-08' }), actorEstudiante, HOY))
      .rejects.toThrow(/sábado ni domingo/);
    await expect(armar().caso.registrar(dto({ fechaFin: '2027-01-29' }), actorEstudiante, HOY))
      .rejects.toThrow(/dentro del periodo/);
  });

  it('el contrato de aprendizaje puede salir del periodo, pero dura seis meses', async () => {
    const { caso } = armar();
    const r = (await caso.registrar(
      dto({ modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, fechaInicio: '2026-08-10', fechaFin: '2027-02-10' }),
      actorEstudiante, HOY,
    )) as unknown as DatosPractica;
    expect(r.modalidad).toBe(ModalidadPractica.CONTRATO_APRENDIZAJE);
    await expect(armar().caso.registrar(
      dto({ modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, fechaInicio: '2026-08-10', fechaFin: '2026-11-27' }),
      actorEstudiante, HOY,
    )).rejects.toThrow(/al menos 6 mes/);
  });

  it('rechaza una modalidad no ofertada en el periodo', async () => {
    periodo.habilitarModalidades([ModalidadPractica.PASANTIA]);
    try {
      await expect(armar().caso.registrar(dto({ modalidad: ModalidadPractica.MONITORIA }), actorEstudiante, HOY))
        .rejects.toBeInstanceOf(BadRequestException);
    } finally {
      periodo.habilitarModalidades([]);
    }
  });

  it('sin matrícula en SINU ni respaldo declarado, no registra', async () => {
    const sinPrograma = Usuario.desde({ ...estudiante.instantanea(), programaId: null, escuelas: [] });
    const { caso } = armar({ sinu: false });
    // el doble de usuarios devuelve al estudiante con programa; forzamos el caso sin datos
    (caso as unknown as { usuarios: { buscarPorId: () => Promise<Usuario> } }).usuarios = {
      buscarPorId: async () => sinPrograma,
    };
    await expect(caso.registrar(dto(), actorEstudiante, HOY)).rejects.toThrow(/matriculad/);
  });

  it('confirma por correo con la lista documental por momento', async () => {
    const { caso, notificaciones, auditoria } = armar();
    await caso.registrar(dto(), actorEstudiante, HOY);
    expect(auditoria).toContain('registro_fur');
    const aviso = notificaciones.find((n) => n.evento === EventoNotificable.REGISTRO_CONFIRMADO);
    expect(aviso).toBeDefined();
    const bloques = aviso?.datos.documentosPorMomento as { momento: string; documentos: string[] }[];
    expect(bloques.map((b) => b.momento)).toEqual([
      'Primer momento · documentos iniciales', 'Segundo momento · avance de la práctica', 'Tercer momento · cierre',
    ]);
    expect(bloques[0].documentos).toContain('Certificado de afiliación a ARL');
    expect(bloques[2].documentos).toContain('Formato Seguimiento Final de Prácticas (PSO-F012)');
  });
});

describe('Reglas del documento PQRS y del cronograma sobre el registro', () => {
  const contrato = (fechas: Partial<RegistrarPracticaDto> = {}) =>
    dto({ modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, fechaInicio: '2026-08-10', fechaFin: '2027-02-10', ...fechas });

  async function contratoPrevio(ciclo: CicloAcademico, periodoAcademico: string, id: string): Promise<DatosPractica> {
    const base = (await armar().caso.registrar(contrato(), actorEstudiante, HOY)) as unknown as DatosPractica;
    return { ...base, id, periodoAcademico, ciclo, numeroFur: 1 };
  }

  it('el segundo contrato de aprendizaje exige subir de nivel (cadena de formación)', async () => {
    const conTecnico = armar();
    conTecnico.practicas.filas.push(await contratoPrevio(CicloAcademico.TECNICO, '2025C', 'prev-1'));
    const r = (await conTecnico.caso.registrar(contrato(), actorEstudiante, HOY)) as unknown as DatosPractica;
    expect(r.modalidad).toBe(ModalidadPractica.CONTRATO_APRENDIZAJE);

    const mismoNivel = armar();
    mismoNivel.practicas.filas.push(await contratoPrevio(CicloAcademico.PROFESIONAL, '2025C', 'prev-2'));
    await expect(mismoNivel.caso.registrar(contrato(), actorEstudiante, HOY)).rejects.toThrow(/cadena de formación/);
  });

  it('nunca hay un tercer contrato de aprendizaje; coordinación gestiona las excepciones', async () => {
    const dos = armar();
    dos.practicas.filas.push(await contratoPrevio(CicloAcademico.TECNICO, '2024C', 'prev-1'));
    dos.practicas.filas.push(await contratoPrevio(CicloAcademico.TECNOLOGO, '2025C', 'prev-2'));
    await expect(dos.caso.registrar(contrato(), actorEstudiante, HOY)).rejects.toThrow(/máximo dos contratos/);
    const porCoordinacion = (await dos.caso.registrar(
      contrato({ estudianteDocumento: '1032456786' }), actorCoordinacion, HOY,
    )) as unknown as DatosPractica;
    expect(porCoordinacion.registradaPor).not.toBe('estudiante');
  });

  it('la pasantía dura hasta tres meses; solo coordinación registra la extensión pedida por la empresa', async () => {
    await expect(armar().caso.registrar(dto({ fechaInicio: '2026-07-21', fechaFin: '2026-11-27' }), actorEstudiante, HOY))
      .rejects.toThrow(/admite hasta 3 mes/);
    const { caso, auditorias } = armar();
    const r = (await caso.registrar(
      dto({ fechaInicio: '2026-07-21', fechaFin: '2026-11-27', estudianteDocumento: '1032456786' }),
      actorCoordinacion, HOY,
    )) as unknown as DatosPractica;
    expect(r.modalidad).toBe(ModalidadPractica.PASANTIA);
    expect(auditorias.some((a) => a.metadatos.extensionAutorizada === true)).toBe(true);
  });
});
