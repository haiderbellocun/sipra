import { BadRequestException } from '@nestjs/common';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { PeriodoAcademico } from '../src/domain/entities/periodo.entity';
import { CicloAcademico, DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const periodo = PeriodoAcademico.desde({
  codigo: '2026C', nombre: 'x', calendario: 'presencial', fechaInicio: dia('2026-07-20'), fechaFin: dia('2026-12-04'),
  ventanas: PeriodoAcademico.ventanasHabituales(dia('2026-07-20'), dia('2026-12-04')),
  jornadasInduccion: [], fechaCargueDocumentos: dia('2026-11-20'), sincronizacionDocentes: true, modalidadesHabilitadas: [],
  activo: true, creadoEn: dia('2026-07-01'), actualizadoEn: dia('2026-07-01'),
});

const practica: DatosPractica = {
  id: 'p1', numeroFur: 7, estudianteId: 'est-1', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG', regional: 'Bogotá', asignatura: null,
  ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2026C', modalidad: ModalidadPractica.PASANTIA,
  estado: EstadoPractica.ACTIVA, tutorId: 'doc-1', empresaId: null, empresaRazonSocial: 'X', empresaNit: null, area: null,
  cargo: null, tipoRemuneracion: null, salario: null, horario: null, jefeInmediatoNombre: null, jefeInmediatoCargo: null,
  jefeInmediatoCorreo: null, jefeInmediatoTelefono: null, ciudad: null, funcionesRelevantes: null,
  fechaInicio: dia('2026-08-18'), fechaFin: dia('2026-11-27'), horasRegistradas: null, arlVerificada: true,
  responsableArlPractica: null, arlFechaAfiliacion: dia('2026-08-17'), terminosAceptadosEn: dia('2026-08-01'), registradaPor: 'estudiante', nota: null,
  cerradaEn: null, ultimaActividad: dia('2026-08-01'), creadaEn: dia('2026-08-01'), actualizadaEn: dia('2026-08-01'),
};

const actorEstudiante = { id: 'est-1', correo: 'laura@estudiante.cun.edu.co', rol: Rol.ESTUDIANTE, permiso: 'escritura' as const, escuelas: [], empresaId: null };

function armar(devueltos: DatosDocumento[] = []) {
  return new GestionarDocumentoUseCase(
    { listarPorPractica: async () => devueltos.map((d) => Documento.desde(d)), ultimaVersion: async () => 0 } as never,
    { buscarPorId: async () => Practica.desde(practica) } as never,
    {} as never, { registrar: async () => undefined } as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never,
    { buscarPorCodigo: async () => periodo } as never,
    { numero: async () => 8 } as never,
    { exigirParaCargar: async () => undefined } as never,
    {} as never,
  );
}

const subir = (caso: GestionarDocumentoUseCase) => caso.cargar(
  'p1', TipoDocumento.CARTA_FINALIZACION,
  { nombreOriginal: 'carta.txt', mimeDeclarado: 'text/plain', contenido: Buffer.from('no es un pdf') },
  null, 10_000_000, actorEstudiante,
);

/**
 * PQRS n.º 54: terminada la práctica, el estudiante tiene ocho días
 * calendario para cargar lo pendiente; después, solo el docente lo habilita.
 */
describe('Plazo de cargue del estudiante', () => {
  afterEach(() => jest.restoreAllMocks());

  it('dentro de los ocho días posteriores al fin de la práctica aún carga (y el archivo se valida)', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(dia('2026-12-04').getTime());
    await expect(subir(armar())).rejects.toThrow(/no es un PDF/);
  });

  it('pasados la fecha de cargue y los ocho días, el cargue se cierra con la indicación de pedirlo al docente', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(dia('2026-12-10').getTime());
    const error = await subir(armar()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toMatch(/plazo de cargue venció/);
  });

  it('una devolución del docente reabre el plazo de subsanación', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(dia('2026-12-10').getTime());
    const devuelto: DatosDocumento = {
      id: 'd1', practicaId: 'p1', tipo: TipoDocumento.CARTA_FINALIZACION, version: 1, estado: EstadoDocumento.DEVUELTO,
      nombreOriginal: 'x.pdf', mimeReal: 'application/pdf', tamanoBytes: 10, hashSha256: 'h', hashPerceptual: null,
      rutaAlmacenamiento: 'r', calidadCaptura: null, banderas: [], puntaje: null, banda: null, extraccion: null,
      decididoPor: 'doc-1', justificacionDecision: null, motivoDevolucion: 'Sin membrete', cargadoEn: dia('2026-12-01'),
      actualizadoEn: dia('2026-12-08'), purgarDespuesDe: null,
    };
    await expect(subir(armar([devuelto]))).rejects.toThrow(/no es un PDF/);
  });
});
