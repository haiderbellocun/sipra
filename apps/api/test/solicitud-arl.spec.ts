import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SolicitudArlUseCase } from '../src/application/use-cases/practicas/solicitud-arl.use-case';
import { DatosDocumento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { PeriodoAcademico, TipoVentana, diasHabilesEntre } from '../src/domain/entities/periodo.entity';
import { CicloAcademico, DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import {
  DatosSolicitudArl, EstadoSolicitudArl, MotivoRechazoArl, SolicitudArl, SolicitudArlError, aplicaSolicitudArl,
  documentosExigidosArl,
} from '../src/domain/entities/solicitud-arl.entity';
import { Usuario } from '../src/domain/entities/usuario.entity';
import { EventoNotificable } from '../src/domain/services/plantillas-notificacion.domain-service';
import { ValidacionArlDomainService } from '../src/domain/services/validacion-arl.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOY = dia('2026-08-03'); // lunes

const periodo = PeriodoAcademico.desde({
  codigo: '2026C', nombre: '2026 · segundo periodo presencial', calendario: 'presencial',
  fechaInicio: dia('2026-07-20'), fechaFin: dia('2026-12-04'),
  ventanas: PeriodoAcademico.ventanasHabituales(dia('2026-07-20'), dia('2026-12-04'), dia('2026-08-21')),
  jornadasInduccion: [], fechaCargueDocumentos: null, sincronizacionDocentes: true, modalidadesHabilitadas: [], activo: true, creadoEn: HOY, actualizadoEn: HOY,
});

function practicaBase(sobrescribir: Partial<DatosPractica> = {}): DatosPractica {
  return {
    id: 'p1', numeroFur: 7, estudianteId: 'est-1', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG',
    regional: 'Bogotá', asignatura: null, ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2026C',
    modalidad: ModalidadPractica.MONITORIA, estado: EstadoPractica.DOCUMENTACION, tutorId: 'doc-1',
    empresaId: null, empresaRazonSocial: 'CUN', empresaNit: null, area: null, cargo: 'Monitor',
    tipoRemuneracion: null, salario: null, horario: null, jefeInmediatoNombre: 'Ana Ruiz', jefeInmediatoCargo: null,
    jefeInmediatoCorreo: null, jefeInmediatoTelefono: null, ciudad: null, funcionesRelevantes: null,
    fechaInicio: dia('2026-08-18'), fechaFin: dia('2026-11-27'), horasRegistradas: null, arlVerificada: false,
    responsableArlPractica: null, arlFechaAfiliacion: null, terminosAceptadosEn: HOY, registradaPor: 'estudiante', nota: null, cerradaEn: null,
    ultimaActividad: HOY, creadaEn: HOY, actualizadaEn: HOY, ...sobrescribir,
  };
}

const solicitudBase = (sobrescribir: Partial<DatosSolicitudArl> = {}): DatosSolicitudArl => ({
  id: 's1', consecutivo: 1, practicaId: 'p1', estudianteId: 'est-1', periodoAcademico: '2026C',
  modalidad: ModalidadPractica.MONITORIA, tipoIdentificacion: 'CC', numeroIdentificacion: '1032456786',
  fechaInicio: dia('2026-08-18'), fechaFin: dia('2026-11-27'), epsNombre: 'Nueva EPS', epsRegimen: 'convencional',
  fechaExpedicionEps: dia('2026-07-25'), fechaExpedicionRut: null, fechaExpedicionCamara: null,
  documentos: [
    { tipo: TipoDocumento.CERTIFICADO_EPS, documentoId: 'd1', estado: EstadoDocumento.AUTO_APROBADO },
    { tipo: TipoDocumento.CEDULA, documentoId: 'd2', estado: EstadoDocumento.APROBADO },
    { tipo: TipoDocumento.ACTA_INICIO, documentoId: 'd3', estado: EstadoDocumento.APROBADO },
  ],
  validacion: null, estado: EstadoSolicitudArl.RADICADA, motivosRechazo: [], observacion: null,
  decididaPor: null, decididaEn: null, certificadoDocumentoId: null, certificadoEnviadoEn: null,
  radicadaEn: HOY, actualizadaEn: HOY, ...sobrescribir,
});

const contexto = { periodo, ahora: HOY, diasHabilesAnticipacion: 5, diasVigenciaEps: 30 };

describe('Catálogo de la solicitud de ARL', () => {
  it('la CUN cubre las articuladas; las externas no; la pasantía depende del convenio', () => {
    expect(aplicaSolicitudArl(ModalidadPractica.MONITORIA)).toBe('si');
    expect(aplicaSolicitudArl(ModalidadPractica.CUNBRE_NACIENTE)).toBe('si');
    expect(aplicaSolicitudArl(ModalidadPractica.CONTRATO_APRENDIZAJE)).toBe('no');
    expect(aplicaSolicitudArl(ModalidadPractica.PASANTIA)).toBe('segun_cobertura');
  });

  it('los soportes cambian con la modalidad (§5.1)', () => {
    expect(documentosExigidosArl(ModalidadPractica.SOCIAL)).toEqual([TipoDocumento.CERTIFICADO_EPS, TipoDocumento.CEDULA, TipoDocumento.ACTA_INICIO]);
    expect(documentosExigidosArl(ModalidadPractica.CUNBRE_NACIENTE)).toContain(TipoDocumento.RUT_NATURAL);
    expect(documentosExigidosArl(ModalidadPractica.CUNBRE_CONSOLIDADO)).toEqual(expect.arrayContaining([TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO]));
  });

  it('los días hábiles no cuentan sábados ni domingos', () => {
    expect(diasHabilesEntre(dia('2026-08-03'), dia('2026-08-10'))).toBe(4); // mar, mié, jue, vie
    expect(diasHabilesEntre(dia('2026-08-03'), dia('2026-08-18'))).toBe(10);
  });
});

describe('Validación automática (§9)', () => {
  const servicio = new ValidacionArlDomainService();

  it('con todo en regla recomienda aprobar salvo la comparación humana del acta', () => {
    const v = servicio.validar(solicitudBase(), contexto);
    expect(v.criterios.filter((c) => c.resultado === 'no_cumple')).toHaveLength(0);
    expect(v.recomendacion).toBe('revision_manual');
    expect(v.criterios.find((c) => c.criterio.startsWith('Acta'))?.resultado).toBe('revision_manual');
  });

  it('CUNbre naciente con RUT del año se aprueba sin revisión manual', () => {
    const v = servicio.validar(solicitudBase({
      modalidad: ModalidadPractica.CUNBRE_NACIENTE, fechaExpedicionRut: dia('2026-02-10'),
      documentos: [
        { tipo: TipoDocumento.CERTIFICADO_EPS, documentoId: 'd1', estado: EstadoDocumento.APROBADO },
        { tipo: TipoDocumento.CEDULA, documentoId: 'd2', estado: EstadoDocumento.APROBADO },
        { tipo: TipoDocumento.RUT_NATURAL, documentoId: 'd4', estado: EstadoDocumento.APROBADO },
      ],
    }), contexto);
    expect(v.recomendacion).toBe('aprobar');
  });

  it('EPS con más de 30 días, RUT de otro año y poca anticipación recomiendan rechazar con sus motivos', () => {
    const v = servicio.validar(solicitudBase({
      modalidad: ModalidadPractica.CUNBRE_CONSOLIDADO, fechaExpedicionEps: dia('2026-06-01'),
      fechaExpedicionRut: dia('2025-03-01'), fechaExpedicionCamara: dia('2026-01-15'), fechaInicio: dia('2026-08-06'),
      documentos: [
        { tipo: TipoDocumento.CERTIFICADO_EPS, documentoId: 'd1', estado: EstadoDocumento.APROBADO },
        { tipo: TipoDocumento.CEDULA, documentoId: 'd2', estado: EstadoDocumento.ILEGIBLE },
        { tipo: TipoDocumento.RUT_JURIDICO, documentoId: 'd4', estado: EstadoDocumento.APROBADO },
      ],
    }), contexto);
    expect(v.recomendacion).toBe('rechazar');
    expect(v.motivos).toEqual(expect.arrayContaining([
      MotivoRechazoArl.CERTIFICADO_VENCIDO, MotivoRechazoArl.RUT_NO_VIGENTE, MotivoRechazoArl.ANTICIPACION_INSUFICIENTE,
      MotivoRechazoArl.IDENTIFICACION_NO_LEGIBLE, MotivoRechazoArl.DOCUMENTO_FALTANTE,
    ]));
    expect(v.motivos).not.toContain(MotivoRechazoArl.CAMARA_NO_VIGENTE);
  });

  it('fechas en fin de semana o fuera del periodo y modalidad externa se rechazan', () => {
    const v = servicio.validar(solicitudBase({ modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, fechaInicio: dia('2026-08-16') }), contexto);
    expect(v.motivos).toEqual(expect.arrayContaining([MotivoRechazoArl.MODALIDAD_NO_CUBIERTA, MotivoRechazoArl.FECHAS_FUERA_DEL_PERIODO]));
  });

  it('régimen especial y FOMAG van a verificación manual del auxiliar', () => {
    const v = servicio.validar(solicitudBase({ epsRegimen: 'fomag' }), contexto);
    expect(v.criterios.find((c) => c.criterio.startsWith('Vigencia'))?.resultado).toBe('revision_manual');
  });
});

describe('Entidad SolicitudArl', () => {
  it('el rechazo exige motivos y «otro» exige observación', () => {
    const s = SolicitudArl.desde(solicitudBase());
    expect(() => s.rechazar('aux', [], null)).toThrow(SolicitudArlError);
    expect(() => s.rechazar('aux', [MotivoRechazoArl.OTRO], null)).toThrow(/observación/);
    s.rechazar('aux', [MotivoRechazoArl.CERTIFICADO_SISBEN, MotivoRechazoArl.CERTIFICADO_SISBEN], null);
    expect(s.instantanea().motivosRechazo).toEqual([MotivoRechazoArl.CERTIFICADO_SISBEN]);
  });

  it('una decisión se puede corregir hasta que sale el certificado (§9.7)', () => {
    const s = SolicitudArl.desde(solicitudBase());
    s.rechazar('aux', [MotivoRechazoArl.DOCUMENTO_BORROSO], null);
    s.aprobar('aux', 'Revisado de nuevo, legible', HOY);
    expect(s.estado).toBe(EstadoSolicitudArl.APROBADA);
    expect(s.instantanea().motivosRechazo).toEqual([]);
    s.registrarCertificado('doc-arl', HOY);
    expect(() => s.rechazar('aux', [MotivoRechazoArl.OTRO], 'x')).toThrow(SolicitudArlError);
    expect(() => s.anular()).toThrow(SolicitudArlError);
  });
});

// ── Caso de uso ──────────────────────────────────────────────────────────
const actorEstudiante = { id: 'est-1', correo: 'laura@estudiante.cun.edu.co', rol: Rol.ESTUDIANTE, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const actorAuxiliar = { id: 'aux-1', correo: 'auxiliar@cun.edu.co', rol: Rol.AUXILIAR, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const actorEmpresa = { id: 'emp-u', correo: 'rrhh@x.co', rol: Rol.EMPRESA, permiso: 'escritura' as const, escuelas: [], empresaId: 'emp-1' };

const estudiante = Usuario.desde({
  id: 'est-1', correo: actorEstudiante.correo, nombre: 'Laura Ramírez', documento: '1032456786', rol: Rol.ESTUDIANTE,
  permiso: 'escritura', escuelas: ['ESC-NEG'], empresaId: null, programaId: 'ADM-PRO', activo: true, creadoEn: HOY, ultimoAccesoEn: null,
});

function armar(opciones: { practica?: Partial<DatosPractica>; documentos?: Partial<DatosDocumento>[] } = {}) {
  let practica = practicaBase(opciones.practica);
  const solicitudes: DatosSolicitudArl[] = [];
  const documentos: DatosDocumento[] = (opciones.documentos ?? [
    { tipo: TipoDocumento.CERTIFICADO_EPS, estado: EstadoDocumento.AUTO_APROBADO },
    { tipo: TipoDocumento.CEDULA, estado: EstadoDocumento.APROBADO },
    { tipo: TipoDocumento.ACTA_INICIO, estado: EstadoDocumento.APROBADO },
  ]).map((d, i) => ({
    id: `d${i}`, practicaId: 'p1', tipo: TipoDocumento.CEDULA, version: 1, estado: EstadoDocumento.APROBADO,
    nombreOriginal: 'x.pdf', mimeReal: 'application/pdf', tamanoBytes: 10, hashSha256: 'h', hashPerceptual: null,
    rutaAlmacenamiento: 'r', calidadCaptura: null, banderas: [], puntaje: null, banda: null, extraccion: null,
    decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: HOY, actualizadoEn: HOY,
    purgarDespuesDe: null, ...d,
  }));
  const notificaciones: { evento: EventoNotificable; datos: Record<string, unknown> }[] = [];
  const auditoria: string[] = [];
  const almacen: string[] = [];
  const registrosArl: { fecha: Date; documentoId: string | null }[] = [];
  const { Documento } = jest.requireActual<typeof import('../src/domain/entities/documento.entity')>('../src/domain/entities/documento.entity');

  const caso = new SolicitudArlUseCase(
    {
      buscarPorId: async (id: string) => { const d = solicitudes.find((s) => s.id === id); return d ? SolicitudArl.desde(d) : null; },
      buscarVigente: async (p: string) => { const d = solicitudes.find((s) => s.practicaId === p && ['radicada', 'aprobada'].includes(s.estado)); return d ? SolicitudArl.desde(d) : null; },
      listar: async (f: { decididaDesde?: Date; decididaHasta?: Date }) => solicitudes
        .filter((s) => !f.decididaDesde || (s.decididaEn && s.decididaEn >= f.decididaDesde && s.decididaEn <= (f.decididaHasta as Date)))
        .map((s) => SolicitudArl.desde(s)),
      guardar: async (d: DatosSolicitudArl) => {
        const previa = solicitudes.findIndex((s) => s.id === d.id);
        const conConsecutivo = { ...d, consecutivo: d.consecutivo ?? solicitudes.length + 1 };
        if (previa >= 0) solicitudes[previa] = conConsecutivo; else solicitudes.push(conConsecutivo);
        return SolicitudArl.desde(conConsecutivo);
      },
    },
    {
      buscarPorId: async () => Practica.desde(practica),
      listar: async () => [Practica.desde(practica)],
      guardar: async (d: DatosPractica) => { practica = d; return Practica.desde(d); },
    } as never,
    { buscarPorCodigo: async () => periodo } as never,
    {
      listarPorPractica: async () => documentos.map((d) => Documento.desde(d)),
      ultimaVersion: async () => 0,
      guardar: async (d: DatosDocumento) => { documentos.push(d); return Documento.desde(d); },
    } as never,
    {
      buscarPorId: async (id: string) => (id === 'est-1' ? estudiante : null),
      listar: async () => [Usuario.desde({ ...estudiante.instantanea(), id: 'coo-1', rol: Rol.COORDINADOR, escuelas: [], correo: 'coordinacion@cun.edu.co', nombre: 'Coordinación' })],
    } as never,
    { registrar: async (r: { accion: string }) => { auditoria.push(r.accion); } } as never,
    { guardar: async (ruta: string) => { almacen.push(ruta); return ruta; } } as never,
    { notificar: async (evento: EventoNotificable, _d: unknown, datos: Record<string, unknown>) => { notificaciones.push({ evento, datos }); } } as never,
    { numero: async (clave: string) => (clave === 'arl.dias_vigencia_eps' ? 30 : 5) } as never,
    {
      registrarArl: async (_p: string, fecha: Date, documentoId: string | null) => {
        registrosArl.push({ fecha, documentoId });
        const p = Practica.desde(practica); p.registrarAfiliacionArl(fecha); practica = p.instantanea();
      },
    } as never,
  );
  return { caso, solicitudes, documentos, notificaciones, auditoria, almacen, registrosArl, practica: () => practica };
}

const radicacion = { tipoIdentificacion: 'CC' as const, numeroIdentificacion: '1032456786', epsNombre: 'Nueva EPS', epsRegimen: 'convencional' as const, fechaExpedicionEps: '2026-07-25' };

describe('SolicitudArlUseCase', () => {
  it('la empresa no radica; una modalidad externa tampoco', async () => {
    const { caso } = armar();
    await expect(caso.radicar(radicacion, actorEmpresa, HOY)).rejects.toBeInstanceOf(ForbiddenException);
    const externa = armar({ practica: { modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE } });
    await expect(externa.caso.radicar(radicacion, actorEstudiante, HOY)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el estudiante radica sobre su práctica, con soportes del expediente, validación y correo de recibido', async () => {
    const { caso, notificaciones, auditoria } = armar();
    const s = await caso.radicar(radicacion, actorEstudiante, HOY);
    expect(s.consecutivo).toBe(1);
    expect(s.estado).toBe(EstadoSolicitudArl.RADICADA);
    expect(s.documentos.map((d) => d.tipo)).toEqual([TipoDocumento.CERTIFICADO_EPS, TipoDocumento.CEDULA, TipoDocumento.ACTA_INICIO]);
    expect(s.recomendacion).toBe('revision_manual');
    expect(notificaciones[0]).toMatchObject({ evento: EventoNotificable.SOLICITUD_ARL_RADICADA, datos: { consecutivo: 1 } });
    expect(auditoria).toContain('solicitud_arl_radicada');
    await expect(caso.radicar(radicacion, actorEstudiante, HOY)).rejects.toBeInstanceOf(ConflictException);
  });

  it('sin soportes cargados no hay solicitud; el documento debe ser el del estudiante', async () => {
    const { caso } = armar({ documentos: [] });
    await expect(caso.radicar(radicacion, actorEstudiante, HOY)).rejects.toThrow(/cargue en su expediente/);
    const otra = armar();
    await expect(otra.caso.radicar({ ...radicacion, numeroIdentificacion: '999' }, actorEstudiante, HOY)).rejects.toThrow(/no coincide/);
  });

  it('el rechazo del auxiliar avisa al estudiante con los motivos en su lenguaje', async () => {
    const { caso, notificaciones } = armar();
    const s = await caso.radicar(radicacion, actorEstudiante, HOY);
    await expect(caso.decidir(s.id, { decision: 'rechazar' }, actorAuxiliar, HOY)).rejects.toBeInstanceOf(BadRequestException);
    const r = await caso.decidir(s.id, { decision: 'rechazar', motivos: [MotivoRechazoArl.CERTIFICADO_ADRES], observacion: 'Cargue el de la EPS' }, actorAuxiliar, HOY);
    expect(r.estado).toBe(EstadoSolicitudArl.RECHAZADA);
    expect(r.motivosRechazoEtiquetas[0]).toMatch(/ADRES/);
    const aviso = notificaciones.find((n) => n.evento === EventoNotificable.SOLICITUD_ARL_RECHAZADA);
    expect(aviso?.datos.motivos).toEqual([expect.stringMatching(/ADRES/)]);
    // Rechazada, el estudiante puede radicar de nuevo.
    await expect(caso.radicar(radicacion, actorEstudiante, HOY)).resolves.toMatchObject({ consecutivo: 2 });
  });

  it('el estudiante no decide', async () => {
    const { caso } = armar();
    const s = await caso.radicar(radicacion, actorEstudiante, HOY);
    await expect(caso.decidir(s.id, { decision: 'aprobar' }, actorEstudiante, HOY)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('aprobada, el certificado queda en el expediente aprobado, registra la afiliación y avisa', async () => {
    const { caso, documentos, registrosArl, notificaciones, practica } = armar();
    const s = await caso.radicar(radicacion, actorEstudiante, HOY);
    await caso.decidir(s.id, { decision: 'aprobar' }, actorAuxiliar, HOY);
    const pdf = Buffer.from('%PDF-1.4 certificado');
    await expect(caso.enviarCertificado(s.id, { nombreOriginal: 'x.txt', contenido: Buffer.from('hola') }, dia('2026-08-10'), actorAuxiliar, HOY))
      .rejects.toThrow(/PDF/);
    // La cobertura no puede empezar el mismo día del inicio (compuerta).
    await expect(caso.enviarCertificado(s.id, { nombreOriginal: 'arl.pdf', contenido: pdf }, dia('2026-08-18'), actorAuxiliar, HOY))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(documentos.some((d) => d.tipo === TipoDocumento.CERTIFICADO_ARL)).toBe(false);

    const r = await caso.enviarCertificado(s.id, { nombreOriginal: 'arl.pdf', contenido: pdf }, dia('2026-08-10'), actorAuxiliar, HOY);
    expect(r.estado).toBe(EstadoSolicitudArl.CERTIFICADO_ENVIADO);
    const certificado = documentos.find((d) => d.tipo === TipoDocumento.CERTIFICADO_ARL);
    expect(certificado?.estado).toBe(EstadoDocumento.APROBADO);
    expect(r.certificadoDocumentoId).toBe(certificado?.id);
    expect(registrosArl[0]).toMatchObject({ documentoId: certificado?.id });
    expect(practica().arlVerificada).toBe(true);
    expect(notificaciones.at(-1)?.evento).toBe(EventoNotificable.CERTIFICADO_ARL_DISPONIBLE);
  });

  it('el consolidado del día separa aprobadas, rechazadas y certificados, y se envía a coordinación', async () => {
    const { caso, notificaciones } = armar();
    const s = await caso.radicar(radicacion, actorEstudiante, HOY);
    await caso.decidir(s.id, { decision: 'rechazar', motivos: [MotivoRechazoArl.PLANILLA_PAGOS] }, actorAuxiliar, dia('2026-08-04'));
    const c = await caso.consolidado(dia('2026-08-04'), actorAuxiliar);
    expect(c.rechazadas).toHaveLength(1);
    expect(c.rechazadas[0]).toMatchObject({ estudianteNombre: 'Laura Ramírez', modalidad: 'Monitoría', motivos: [expect.stringMatching(/planilla/i)] });
    expect(c.aprobadas).toHaveLength(0);
    const enviados = await caso.enviarConsolidadoDiario(dia('2026-08-04'));
    expect(enviados).toBe(1);
    const correo = notificaciones.find((n) => n.evento === EventoNotificable.CONSOLIDADO_ARL);
    expect((correo?.datos.filas as string[])[0]).toMatch(/^RECHAZADA n\.º 1/);
  });

  it('el estudiante solo ve las suyas y puede anular la radicada', async () => {
    const { caso } = armar();
    const s = await caso.radicar(radicacion, actorEstudiante, HOY);
    expect(await caso.listar({}, actorEstudiante)).toHaveLength(1);
    await expect(caso.listar({}, actorEmpresa)).rejects.toBeInstanceOf(ForbiddenException);
    const anulada = await caso.anular(s.id, actorEstudiante, HOY);
    expect(anulada.estado).toBe(EstadoSolicitudArl.ANULADA);
  });
});

describe('Plazo de la solicitud de ARL (cronograma del proceso)', () => {
  it('el estudiante no radica después del límite de dos meses; coordinación sí atiende la excepción', async () => {
    const { caso } = armar();
    await expect(caso.radicar(radicacion, actorEstudiante, dia('2026-08-24'))).rejects.toThrow(/plazo para solicitar la ARL.*2026-08-21/);
    expect(periodo.ventanaAbierta(TipoVentana.SOLICITUD_ARL, dia('2026-08-21'))).toBe(true);
    const actorCoordinacion = { ...actorAuxiliar, id: 'coo-1', rol: Rol.COORDINADOR };
    const s = await caso.radicar({ ...radicacion, practicaId: 'p1' }, actorCoordinacion, dia('2026-08-24'));
    expect(s.estado).toBe(EstadoSolicitudArl.RADICADA);
  });
});
