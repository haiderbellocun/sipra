import {
  CompuertaArlError, DatosPractica, EstadoPractica, ModalidadPractica, Practica, ResponsableArlNoDefinidoError,
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
    responsableArlPractica: 'empresa', arlFechaAfiliacion: null,
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
      responsableArlPractica: 'empresa', arlFechaAfiliacion: new Date('2026-09-01T00:00:00Z'),
    });
    expect(() => practica.transicionarA(EstadoPractica.ACTIVA)).toThrow(
      /anterior a la fecha de inicio/,
    );
  });

  it('bloquea la activación cuando la afiliación es posterior al inicio', () => {
    const practica = practicaBase({
      arlVerificada: true,
      responsableArlPractica: 'empresa', arlFechaAfiliacion: new Date('2026-09-05T00:00:00Z'),
    });
    expect(() => practica.transicionarA(EstadoPractica.ACTIVA)).toThrow(CompuertaArlError);
  });

  it('permite la activación con afiliación anterior al inicio', () => {
    const practica = practicaBase({
      arlVerificada: true,
      responsableArlPractica: 'empresa', arlFechaAfiliacion: new Date('2026-08-28T00:00:00Z'),
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

describe('Compuerta del responsable de la ARL (la práctica no avanza sin definirlo)', () => {
  const AVANCES: [EstadoPractica, EstadoPractica][] = [
    [EstadoPractica.INSCRITA, EstadoPractica.DOCUMENTACION],
    [EstadoPractica.DOCUMENTACION, EstadoPractica.EN_VALIDACION],
    [EstadoPractica.EN_VALIDACION, EstadoPractica.ACTIVA],
  ];

  it.each(AVANCES)('22 · %s → %s se bloquea si el responsable de la ARL sigue sin definir, con un mensaje humano', (desde, hacia) => {
    const practica = practicaBase({ estado: desde, responsableArlPractica: null, arlVerificada: true, arlFechaAfiliacion: new Date('2026-08-01T00:00:00Z') });
    expect(() => practica.transicionarA(hacia)).toThrow(ResponsableArlNoDefinidoError);
    expect(() => practica.transicionarA(hacia)).toThrow('Debes indicar quién asume la ARL antes de continuar.');
    expect(practica.estado).toBe(desde);
  });

  it('con el responsable definido (empresa o CUN) la práctica avanza', () => {
    for (const valor of ['empresa', 'cun'] as const) {
      const practica = practicaBase({ estado: EstadoPractica.INSCRITA, responsableArlPractica: valor });
      practica.transicionarA(EstadoPractica.DOCUMENTACION);
      expect(practica.estado).toBe(EstadoPractica.DOCUMENTACION);
    }
  });

  it('NO se infiere de la modalidad: una pasantía (que sugiere «empresa» por catálogo) sin dato también se bloquea', () => {
    const practica = practicaBase({ estado: EstadoPractica.INSCRITA, modalidad: ModalidadPractica.PASANTIA, responsableArlPractica: null });
    expect(() => practica.transicionarA(EstadoPractica.DOCUMENTACION)).toThrow(ResponsableArlNoDefinidoError);
    expect(practica.responsableArlPractica).toBeNull();
  });

  it('23 · un histórico con el dato en null sigue siendo válido almacenado y puede cerrarse, cancelarse o anularse', () => {
    for (const destino of [EstadoPractica.CANCELADA, EstadoPractica.ANULADA, EstadoPractica.REPROBADA]) {
      const practica = practicaBase({ estado: EstadoPractica.EN_VALIDACION, responsableArlPractica: null });
      practica.transicionarA(destino);
      expect(practica.estado).toBe(destino);
      expect(practica.responsableArlPractica).toBeNull();
    }
  });

  it('volver atrás (en validación → documentación) y reanudar una suspendida no exigen el dato', () => {
    const atras = practicaBase({ estado: EstadoPractica.EN_VALIDACION, responsableArlPractica: null });
    atras.transicionarA(EstadoPractica.DOCUMENTACION);
    expect(atras.estado).toBe(EstadoPractica.DOCUMENTACION);
    const reanudada = practicaBase({
      estado: EstadoPractica.SUSPENDIDA, responsableArlPractica: null, arlVerificada: true, arlFechaAfiliacion: new Date('2026-08-01T00:00:00Z'),
    });
    reanudada.transicionarA(EstadoPractica.ACTIVA);
    expect(reanudada.estado).toBe(EstadoPractica.ACTIVA);
  });

  it('las modalidades sin colocación nueva (no hay afiliación que asignar) no se bloquean', () => {
    const practica = practicaBase({ estado: EstadoPractica.INSCRITA, modalidad: ModalidadPractica.VALIDACION_EXPERIENCIA, responsableArlPractica: null });
    practica.transicionarA(EstadoPractica.DOCUMENTACION);
    expect(practica.estado).toBe(EstadoPractica.DOCUMENTACION);
  });
});
