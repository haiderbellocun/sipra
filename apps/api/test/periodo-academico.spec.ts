import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import {
  FechasFueraDelPeriodoError, FinDeSemanaError, ModalidadNoOfertadaError, PeriodoAcademico,
  PeriodoCerradoError, TipoVentana, VentanaCerradaError, esFinDeSemana,
} from '../src/domain/entities/periodo.entity';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const periodo = (extra: Partial<Parameters<typeof PeriodoAcademico.desde>[0]> = {}) =>
  PeriodoAcademico.desde({
    codigo: '2026C',
    nombre: '2026 · segundo periodo presencial',
    calendario: 'presencial',
    fechaInicio: dia('2026-07-20'),
    fechaFin: dia('2026-12-04'),
    ventanas: PeriodoAcademico.ventanasHabituales(dia('2026-07-20'), dia('2026-12-04'), dia('2026-08-21')),
    jornadasInduccion: [], fechaCargueDocumentos: null, sincronizacionDocentes: true,
    modalidadesHabilitadas: [],
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    ...extra,
  });

describe('Periodo académico y ventanas de habilitación (gestión de periodos del SGP)', () => {
  describe('ventanas', () => {
    it('el registro FUR abre con el periodo y cierra en la fecha programada', () => {
      const p = periodo();
      expect(p.ventanaAbierta(TipoVentana.REGISTRO_FUR, dia('2026-07-20'))).toBe(true);
      expect(p.ventanaAbierta(TipoVentana.REGISTRO_FUR, dia('2026-08-21'))).toBe(true);
      expect(p.ventanaAbierta(TipoVentana.REGISTRO_FUR, dia('2026-08-22'))).toBe(false);
    });

    it('la carta de presentación se habilita un mes antes del periodo y hasta el cierre del FUR', () => {
      const p = periodo();
      expect(p.ventanaAbierta(TipoVentana.CARTA_PRESENTACION, dia('2026-06-20'))).toBe(true);
      expect(p.ventanaAbierta(TipoVentana.CARTA_PRESENTACION, dia('2026-06-19'))).toBe(false);
      expect(p.ventanaAbierta(TipoVentana.CARTA_PRESENTACION, dia('2026-08-21'))).toBe(true);
    });

    it('el cargue del docente solo existe si la coordinación lo habilita para casos especiales', () => {
      const p = periodo();
      expect(p.ventanaAbierta(TipoVentana.CARGUE_DOCENTE, dia('2026-09-01'))).toBe(false);
      p.fijarVentana(TipoVentana.CARGUE_DOCENTE, { desde: dia('2026-09-01'), hasta: dia('2026-09-05') });
      expect(p.ventanaAbierta(TipoVentana.CARGUE_DOCENTE, dia('2026-09-03'))).toBe(true);
    });

    it('exigir una ventana cerrada dice cuál y de qué periodo', () => {
      expect(() => periodo().exigirVentana(TipoVentana.REGISTRO_FUR, dia('2026-10-01')))
        .toThrow(VentanaCerradaError);
      expect(() => periodo().exigirVentana(TipoVentana.REGISTRO_FUR, dia('2026-10-01')))
        .toThrow(/Registro FUR.*2026C/);
    });

    it('un periodo inactivo no tiene ninguna ventana abierta', () => {
      expect(periodo({ activo: false }).ventanaAbierta(TipoVentana.REGISTRO_FUR, dia('2026-08-01'))).toBe(false);
    });
  });

  describe('fechas de la práctica', () => {
    it('acepta fechas hábiles dentro del periodo', () => {
      expect(() => periodo().validarFechasDePractica(dia('2026-08-03'), dia('2026-11-27'), { exigirDentroDelPeriodo: true }))
        .not.toThrow();
    });

    it('rechaza sábados y domingos: no serán válidos', () => {
      expect(esFinDeSemana(dia('2026-08-01'))).toBe(true); // sábado
      expect(() => periodo().validarFechasDePractica(dia('2026-08-01'), dia('2026-11-27'), { exigirDentroDelPeriodo: true }))
        .toThrow(FinDeSemanaError);
    });

    it('rechaza fechas fuera del periodo salvo cuando la modalidad está exenta', () => {
      const p = periodo();
      expect(() => p.validarFechasDePractica(dia('2026-08-03'), dia('2027-01-29'), { exigirDentroDelPeriodo: true }))
        .toThrow(FechasFueraDelPeriodoError);
      expect(() => p.validarFechasDePractica(dia('2026-08-03'), dia('2027-01-29'), { exigirDentroDelPeriodo: false }))
        .not.toThrow();
    });

    it('rechaza un fin anterior o igual al inicio', () => {
      expect(() => periodo().validarFechasDePractica(dia('2026-08-03'), dia('2026-08-03'), { exigirDentroDelPeriodo: true }))
        .toThrow(FechasFueraDelPeriodoError);
    });
  });

  describe('periodos vencidos y modalidades ofertadas', () => {
    it('el sistema no admite registros en periodos vencidos', () => {
      const p = periodo();
      expect(p.esVigenteOFuturo(dia('2026-12-04'))).toBe(true);
      expect(() => p.exigirVigenteOFuturo(dia('2026-12-05'))).toThrow(PeriodoCerradoError);
    });

    it('sin lista de modalidades, todas están ofertadas; con lista, solo esas', () => {
      const p = periodo();
      expect(p.modalidadHabilitada(ModalidadPractica.ESTADO_JOVEN)).toBe(true);
      p.habilitarModalidades([ModalidadPractica.PASANTIA, ModalidadPractica.MONITORIA]);
      expect(p.modalidadHabilitada(ModalidadPractica.PASANTIA)).toBe(true);
      expect(() => p.exigirModalidad(ModalidadPractica.ESTADO_JOVEN)).toThrow(ModalidadNoOfertadaError);
    });
  });
});
