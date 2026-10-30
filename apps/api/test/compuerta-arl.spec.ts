import {
  CompuertaArlError, DatosPractica, EstadoPractica, ModalidadPractica, Practica,
  TransicionInvalidaError, CicloAcademico,
} from '../src/domain/entities/practica.entity';

function practicaBase(sobrescribir: Partial<DatosPractica> = {}): Practica {
  const ahora = new Date('2026-08-01T00:00:00Z');
  return Practica.desde({
    id: 'p1',
    estudianteId: 'e1',
    programaId: 'ADM-PRO',
    escuelaId: 'ESC-NEG',
    ciclo: CicloAcademico.PROFESIONAL,
    periodoAcademico: '2026-2',
    modalidad: ModalidadPractica.PASANTIA,
    estado: EstadoPractica.EN_VALIDACION,
    tutorId: 't1',
    empresaId: 'emp1',
    cargo: 'Practicante',
    jefeInmediatoNombre: 'Jefe',
    jefeInmediatoCorreo: 'jefe@empresa.com',
    fechaInicio: new Date('2026-09-01T00:00:00Z'),
    fechaFin: new Date('2026-12-01T00:00:00Z'),
    horasRegistradas: null,
    arlVerificada: false,
    responsableArlPractica: null, arlFechaAfiliacion: null,
    numeroFur: null,
    regional: null,
    asignatura: null,
    empresaRazonSocial: null,
    empresaNit: null,
    area: null,
    tipoRemuneracion: null,
    salario: null,
    horario: null,
    jefeInmediatoCargo: null,
    jefeInmediatoTelefono: null,
    ciudad: null,
    funcionesRelevantes: null,
    terminosAceptadosEn: null,
    registradaPor: 'coordinacion',
    nota: null,
    cerradaEn: null,
    ultimaActividad: ahora,
    creadaEn: ahora,
    actualizadaEn: ahora,
    ...sobrescribir,
  });
}

describe('Compuerta de afiliación a ARL (Decreto 055 de 2015)', () => {
  it('bloquea la activación sin afiliación registrada', () => {
    const practica = practicaBase();
    expect(() => practica.transicionarA(EstadoPractica.ACTIVA)).toThrow(CompuertaArlError);
    expect(practica.estado).toBe(EstadoPractica.EN_VALIDACION);
  });

  it('bloquea la activación cuando la afiliación es del MISMO día del inicio', () => {
    const practica = practicaBase({
      arlVerificada: true,
      responsableArlPractica: null, arlFechaAfiliacion: new Date('2026-09-01T00:00:00Z'),
    });
    expect(() => practica.transicionarA(EstadoPractica.ACTIVA)).toThrow(
      /anterior a la fecha de inicio/,
    );
  });

  it('bloquea la activación cuando la afiliación es posterior al inicio', () => {
    const practica = practicaBase({
      arlVerificada: true,
      responsableArlPractica: null, arlFechaAfiliacion: new Date('2026-09-05T00:00:00Z'),
    });
    expect(() => practica.transicionarA(EstadoPractica.ACTIVA)).toThrow(CompuertaArlError);
  });

  it('permite la activación con afiliación anterior al inicio', () => {
    const practica = practicaBase({
      arlVerificada: true,
      responsableArlPractica: null, arlFechaAfiliacion: new Date('2026-08-28T00:00:00Z'),
    });
    practica.transicionarA(EstadoPractica.ACTIVA);
    expect(practica.estado).toBe(EstadoPractica.ACTIVA);
  });

  it('exime la validación de experiencia laboral: no hay colocación nueva que afiliar', () => {
    const practica = practicaBase({
      modalidad: ModalidadPractica.VALIDACION_EXPERIENCIA,
      estado: EstadoPractica.INSCRITA,
    });
    practica.transicionarA(EstadoPractica.FINALIZADA);
    expect(practica.estado).toBe(EstadoPractica.FINALIZADA);
  });

  it('no deja saltar de inscrita a finalizada en modalidades ordinarias', () => {
    const practica = practicaBase({ estado: EstadoPractica.INSCRITA });
    expect(() => practica.transicionarA(EstadoPractica.FINALIZADA)).toThrow(
      TransicionInvalidaError,
    );
  });

  it('no admite transiciones desde un estado terminal', () => {
    const practica = practicaBase({ estado: EstadoPractica.CERTIFICADA });
    expect(() => practica.transicionarA(EstadoPractica.ACTIVA)).toThrow(TransicionInvalidaError);
  });
});
