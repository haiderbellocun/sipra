import { CALENDARIOS, ETIQUETA_CALENDARIO, PeriodoAcademico, TipoVentana } from '../src/domain/entities/periodo.entity';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Documento «Periodos académicos y cronograma del proceso de prácticas»:
 * tres calendarios, dos meses desde el inicio para registrar y solicitar la
 * ARL, inducción en la segunda semana y cargue de documentos antes del cierre.
 */
describe('Cronograma del proceso por periodo', () => {
  it('reconoce los tres calendarios: presencial, virtual y 335', () => {
    expect(CALENDARIOS).toEqual(['presencial', 'virtual', '335']);
    expect(ETIQUETA_CALENDARIO['335']).toMatch(/335/);
  });

  it('el límite habitual para registrar y solicitar la ARL es dos meses después del inicio', () => {
    expect(iso(PeriodoAcademico.limiteRegistroHabitual(dia('2026-09-28')))).toBe('2026-11-28');
    expect(iso(PeriodoAcademico.limiteRegistroHabitual(dia('2026-01-26')))).toBe('2026-03-26');
  });

  it('la fecha de cargue habitual es dos semanas antes del cierre y la inducción cae en la segunda semana', () => {
    expect(iso(PeriodoAcademico.cargueHabitual(dia('2027-01-15')))).toBe('2027-01-01');
    const jornadas = PeriodoAcademico.jornadasHabituales(dia('2026-09-28'));
    expect(jornadas.map(iso)).toEqual(['2026-10-09', '2026-10-13']);
  });

  it('las ventanas habituales se derivan del cronograma: FUR y ARL hasta el límite, cargue hasta la fecha de cargue', () => {
    const v = PeriodoAcademico.ventanasHabituales(dia('2026-09-28'), dia('2027-01-15'));
    expect(iso(v[TipoVentana.REGISTRO_FUR]?.hasta ?? null)).toBe('2026-11-28');
    expect(iso(v[TipoVentana.SOLICITUD_ARL]?.hasta ?? null)).toBe('2026-11-28');
    expect(iso(v[TipoVentana.CARGUE_ESTUDIANTE]?.hasta ?? null)).toBe('2027-01-01');
    expect(iso(v[TipoVentana.CARTA_PRESENTACION]?.desde ?? null)).toBe('2026-08-28');
    const propio = PeriodoAcademico.ventanasHabituales(dia('2026-09-28'), dia('2027-01-15'), dia('2026-11-28'), dia('2026-12-31'));
    expect(iso(propio[TipoVentana.CARGUE_ESTUDIANTE]?.hasta ?? null)).toBe('2026-12-31');
  });

  it('el periodo expone su cronograma completo (ejemplo 26V04 del documento)', () => {
    const p = PeriodoAcademico.desde({
      codigo: '26V04', nombre: '2026 · cuarto periodo virtual', calendario: 'virtual',
      fechaInicio: dia('2026-09-28'), fechaFin: dia('2027-01-15'),
      ventanas: PeriodoAcademico.ventanasHabituales(dia('2026-09-28'), dia('2027-01-15'), dia('2026-11-28'), dia('2026-12-31')),
      jornadasInduccion: [dia('2026-10-09'), dia('2026-10-13')], fechaCargueDocumentos: dia('2026-12-31'),
      sincronizacionDocentes: true, modalidadesHabilitadas: [], activo: true, creadoEn: new Date(), actualizadoEn: new Date(),
    });
    const c = p.cronograma();
    expect(iso(c.limiteRegistro)).toBe('2026-11-28');
    expect(iso(c.limiteSolicitudArl)).toBe('2026-11-28');
    expect(c.jornadasInduccion.map(iso)).toEqual(['2026-10-09', '2026-10-13']);
    expect(iso(c.fechaCargueDocumentos)).toBe('2026-12-31');
    expect(iso(c.cierre)).toBe('2027-01-15');
    expect(p.ventanaAbierta(TipoVentana.SOLICITUD_ARL, dia('2026-11-28'))).toBe(true);
    expect(p.ventanaAbierta(TipoVentana.SOLICITUD_ARL, dia('2026-11-29'))).toBe(false);
  });

  it('coordinación ajusta inducción y fecha de cargue, siempre dentro del periodo', () => {
    const p = PeriodoAcademico.desde({
      codigo: '2026C', nombre: 'x', calendario: 'presencial', fechaInicio: dia('2026-07-20'), fechaFin: dia('2026-12-04'),
      ventanas: PeriodoAcademico.ventanasHabituales(dia('2026-07-20'), dia('2026-12-04')),
      jornadasInduccion: [], fechaCargueDocumentos: null, sincronizacionDocentes: true, modalidadesHabilitadas: [],
      activo: true, creadoEn: new Date(), actualizadoEn: new Date(),
    });
    p.fijarCronograma({ jornadasInduccion: [dia('2026-07-31')], fechaCargueDocumentos: dia('2026-11-13') });
    expect(p.cronograma().jornadasInduccion.map(iso)).toEqual(['2026-07-31']);
    expect(iso(p.cronograma().fechaCargueDocumentos)).toBe('2026-11-13');
    expect(() => p.fijarCronograma({ fechaCargueDocumentos: dia('2027-01-10') })).toThrow();
    expect(() => p.fijarCronograma({ jornadasInduccion: [dia('2026-06-01')] })).toThrow();
  });
});
