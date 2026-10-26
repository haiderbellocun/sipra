import { TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  EtapaExpediente, MATRIZ_MODALIDADES, ModalidadPractica, ORDEN_ETAPAS, ResponsableArl,
  definicionModalidad,
} from '../src/domain/entities/modalidad.entity';
import {
  DuracionFueraDeRangoError, RequisitosDomainService,
} from '../src/domain/services/requisitos.domain-service';

const servicio = new RequisitosDomainService();
const docs = (...tipos: TipoDocumento[]) => tipos.map((tipo) => ({ tipo }));

describe('Matriz documental por modalidad y etapa', () => {
  describe('la dependencia circular que el diseño funcional advierte', () => {
    it('postular no exige el acta de una empresa que aún no se ha elegido', () => {
      const exigidos = servicio.exigidosEn(
        ModalidadPractica.PASANTIA, EtapaExpediente.PRE_POSTULACION,
      );
      expect(exigidos).not.toContain(TipoDocumento.ACTA_INICIO);
    });

    it('postular no exige la ARL de una colocación que todavía no existe', () => {
      const exigidos = servicio.exigidosEn(
        ModalidadPractica.PASANTIA, EtapaExpediente.PRE_POSTULACION,
      );
      expect(exigidos).not.toContain(TipoDocumento.CERTIFICADO_ARL);
    });

    it('ninguna modalidad exige acta ni ARL antes de postular', () => {
      for (const d of MATRIZ_MODALIDADES) {
        const previos = servicio.exigidosEn(d.modalidad, EtapaExpediente.PRE_POSTULACION);
        expect(previos).not.toContain(TipoDocumento.ACTA_INICIO);
        expect(previos).not.toContain(TipoDocumento.CERTIFICADO_ARL);
      }
    });

    it('con los documentos personales aprobados ya se puede formalizar', () => {
      const puede = servicio.puedeEntrarA(
        ModalidadPractica.PASANTIA, EtapaExpediente.FORMALIZACION,
        docs(TipoDocumento.CEDULA, TipoDocumento.CERTIFICADO_EPS),
      );
      expect(puede).toBe(true);
    });
  });

  describe('lo que cada modalidad pide de más', () => {
    it('CUNBRE Naciente pide RUT de persona natural', () => {
      expect(servicio.exigidosEn(
        ModalidadPractica.CUNBRE_NACIENTE, EtapaExpediente.PRE_POSTULACION,
      )).toContain(TipoDocumento.RUT_NATURAL);
    });

    it('CUNBRE Consolidado pide además la Cámara de Comercio', () => {
      const exigidos = servicio.exigidosEn(
        ModalidadPractica.CUNBRE_CONSOLIDADO, EtapaExpediente.PRE_POSTULACION,
      );
      expect(exigidos).toContain(TipoDocumento.RUT_JURIDICO);
      expect(exigidos).toContain(TipoDocumento.CAMARA_COMERCIO);
    });

    it('validación de experiencia formaliza con certificado laboral con funciones y contrato', () => {
      const exigidos = servicio.exigidosEn(
        ModalidadPractica.VALIDACION_EXPERIENCIA, EtapaExpediente.FORMALIZACION,
      );
      expect(exigidos).toContain(TipoDocumento.CERTIFICADO_LABORAL_FUNCIONES);
      expect(exigidos).toContain(TipoDocumento.CONTRATO_LABORAL);
    });

    it('todas piden el certificado de EPS antes de postular, salvo la internacional (seguro médico)', () => {
      for (const d of MATRIZ_MODALIDADES) {
        const previos = servicio.exigidosEn(d.modalidad, EtapaExpediente.PRE_POSTULACION);
        if (d.modalidad === ModalidadPractica.PASANTIA_INTERNACIONAL) {
          expect(previos).toContain(TipoDocumento.CORREO_APROBACION_INTERNACIONAL);
          expect(servicio.exigidosEn(d.modalidad, EtapaExpediente.FORMALIZACION)).toContain(TipoDocumento.SEGURO_MEDICO_INTERNACIONAL);
          continue;
        }
        expect(previos).toContain(TipoDocumento.CERTIFICADO_EPS);
      }
    });
  });

  describe('quién afilia a riesgos laborales', () => {
    it('la pasantía la afilia la empresa por defecto', () => {
      const d = definicionModalidad(ModalidadPractica.PASANTIA);
      expect(servicio.responsableArl(d, null)).toBe(ResponsableArl.EMPRESA);
    });

    it('la monitoría la afilia la CUN', () => {
      const d = definicionModalidad(ModalidadPractica.MONITORIA);
      expect(servicio.responsableArl(d, null)).toBe(ResponsableArl.CUN);
    });

    it('un convenio registrado manda sobre el valor de la modalidad', () => {
      const d = definicionModalidad(ModalidadPractica.PASANTIA);
      expect(servicio.responsableArl(d, ResponsableArl.CUN)).toBe(ResponsableArl.CUN);
    });

    it('sin convenio registrado no se traslada la cobertura, aunque la empresa se llame parecido', () => {
      // La excepción histórica se parametriza por organización y vigencia.
      // El nombre no es un acuerdo: dos empresas distintas pueden parecerse.
      const d = definicionModalidad(ModalidadPractica.PASANTIA);
      expect(servicio.responsableArl(d, null)).toBe(ResponsableArl.EMPRESA);
    });
  });

  describe('estado del expediente', () => {
    it('señala la primera etapa incompleta y qué falta en ella', () => {
      const estado = servicio.estado(
        ModalidadPractica.PASANTIA, docs(TipoDocumento.CEDULA),
      );
      expect(estado.etapaActual).toBe(EtapaExpediente.PRE_POSTULACION);
      const pre = estado.etapas.find((e) => e.etapa === EtapaExpediente.PRE_POSTULACION);
      expect(pre?.faltantes).toEqual([TipoDocumento.CERTIFICADO_EPS]);
    });

    it('avanza de etapa cuando la anterior está completa', () => {
      const estado = servicio.estado(
        ModalidadPractica.PASANTIA,
        docs(TipoDocumento.CEDULA, TipoDocumento.CERTIFICADO_EPS),
      );
      expect(estado.etapaActual).toBe(EtapaExpediente.FORMALIZACION);
    });

    it('la matriz documental oficial ratifica todas las modalidades que describe; quedan tres por ratificar', () => {
      const pendientes = MATRIZ_MODALIDADES.filter((d) => servicio.estado(d.modalidad, []).requiereRatificacion).map((d) => d.modalidad);
      expect(pendientes).toEqual([
        ModalidadPractica.PASANTIA_INVESTIGATIVA, ModalidadPractica.ESTADO_JOVEN, ModalidadPractica.ASESORIA_ASISTENCIA_TECNICA,
      ]);
      expect(servicio.estado(ModalidadPractica.PASANTIA_INTERNACIONAL, []).requiereRatificacion).toBe(false);
    });
  });

  describe('duración según la fuente funcional', () => {
    it('la pasantía admite hasta tres meses (documento «Documentación a cargar»)', () => {
      expect(() => servicio.verificarDuracion(
        ModalidadPractica.PASANTIA, new Date('2026-01-15'), new Date('2026-04-15'),
      )).not.toThrow();
    });

    it('la pasantía rechaza cuatro meses, diciendo cuál es el límite', () => {
      expect(() => servicio.verificarDuracion(
        ModalidadPractica.PASANTIA, new Date('2026-01-15'), new Date('2026-05-15'),
      )).toThrow(/admite hasta 3 mes/);
    });

    it('CUNBRE exige al menos tres meses de funcionamiento', () => {
      expect(() => servicio.verificarDuracion(
        ModalidadPractica.CUNBRE_NACIENTE, new Date('2026-01-15'), new Date('2026-03-01'),
      )).toThrow(DuracionFueraDeRangoError);
    });
  });

  describe('integridad de la matriz', () => {
    it('cubre todas las modalidades del selector sin repetir', () => {
      const claves = MATRIZ_MODALIDADES.map((d) => d.modalidad);
      expect(new Set(claves).size).toBe(claves.length);
      expect(claves.length).toBe(Object.keys(ModalidadPractica).length);
    });

    it('toda etapa declarada pertenece al orden conocido', () => {
      for (const d of MATRIZ_MODALIDADES) {
        for (const etapa of Object.keys(d.documentos)) {
          expect(ORDEN_ETAPAS).toContain(etapa as EtapaExpediente);
        }
      }
    });

    it('toda modalidad cierra pidiendo al menos un soporte de finalización', () => {
      for (const d of MATRIZ_MODALIDADES) {
        expect(servicio.exigidosEn(d.modalidad, EtapaExpediente.CIERRE).length)
          .toBeGreaterThan(0);
      }
    });
  });
});
