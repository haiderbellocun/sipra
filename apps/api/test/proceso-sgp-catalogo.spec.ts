import { TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  CRITERIOS_DOCUMENTALES, REGLAS_GENERALES_CARGUE, criteriosDe,
} from '../src/domain/entities/criterios-documentales';
import {
  ETAPAS_POR_MOMENTO, EtapaExpediente, MATRIZ_MODALIDADES, MODALIDADES_ARTICULADAS,
  ModalidadPractica, MomentoExpediente, ResponsableArl, definicionModalidad, documentosExigidos,
  momentoDe,
} from '../src/domain/entities/modalidad.entity';
import {
  EQUIVALENCIA_SGP, EstadoPractica, Practica, TransicionInvalidaError,
} from '../src/domain/entities/practica.entity';
import { CicloAcademico } from '../src/domain/entities/practica.entity';
import { Rol, alcancePorRol } from '../src/domain/value-objects/rol.vo';

const practica = (estado: EstadoPractica) => Practica.desde({
  id: 'p', estudianteId: 'e', programaId: 'ADM', escuelaId: 'ESC-NEG',
  ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2026A',
  modalidad: ModalidadPractica.PASANTIA, estado, tutorId: null, empresaId: null,
  cargo: null, jefeInmediatoNombre: null, jefeInmediatoCorreo: null,
  fechaInicio: null, fechaFin: null, horasRegistradas: null, arlVerificada: false,
  responsableArlPractica: null, arlFechaAfiliacion: null, ultimaActividad: new Date(), creadaEn: new Date(),
  actualizadaEn: new Date(),
  numeroFur: null, regional: null, asignatura: null, empresaRazonSocial: null, empresaNit: null,
  area: null, tipoRemuneracion: null, salario: null, horario: null, jefeInmediatoCargo: null,
  jefeInmediatoTelefono: null, ciudad: null, funcionesRelevantes: null, terminosAceptadosEn: null,
  registradaPor: 'coordinacion', nota: null, cerradaEn: null,
});

describe('Catálogo del proceso SGP', () => {
  describe('las quince modalidades del selector de coordinación', () => {
    const selectorSgp = [
      'Contrato de aprendizaje', 'Pasantía', 'Monitoría', 'Combinación de funciones',
      'Asesoría y asistencia técnica', 'Proyección social', 'Validación de experiencia laboral',
      'Emprendimiento CUNBRE – Consolidado', 'Emprendimiento CUNBRE – Naciente',
      'Pasantía internacional', 'Pasantía investigativa', 'Estado Joven – Pasantías',
      'Práctica investigativa', 'Práctica técnica en investigación',
    ];

    it('cada nombre del SGP tiene su modalidad', () => {
      const nombres = MATRIZ_MODALIDADES.map((d) => d.etiquetaSgp);
      for (const n of selectorSgp) expect(nombres).toContain(n);
    });

    it('«Empresa propia» del selector es la familia CUNbre, no una modalidad aparte', () => {
      const cunbre = MATRIZ_MODALIDADES.filter((d) => d.etiqueta.startsWith('Emprendimiento CUNbre'));
      expect(cunbre).toHaveLength(2);
    });

    it('las articuladas las afilia la CUN o su convenio; las externas, la empresa', () => {
      for (const d of MATRIZ_MODALIDADES) {
        if (d.articulada) {
          expect([ResponsableArl.CUN, ResponsableArl.SEGUN_COBERTURA]).toContain(d.responsableArlPorDefecto);
        }
      }
      expect(definicionModalidad(ModalidadPractica.CONTRATO_APRENDIZAJE).responsableArlPorDefecto)
        .toBe(ResponsableArl.EMPRESA);
      expect(MODALIDADES_ARTICULADAS).toContain(ModalidadPractica.MONITORIA);
      expect(MODALIDADES_ARTICULADAS).not.toContain(ModalidadPractica.PASANTIA);
    });

    it('solo el contrato de aprendizaje puede salir del periodo académico (manual §1.11)', () => {
      const fuera = MATRIZ_MODALIDADES.filter((d) => !d.fechasDentroDelPeriodo);
      expect(fuera.map((d) => d.modalidad)).toEqual([ModalidadPractica.CONTRATO_APRENDIZAJE]);
    });
  });

  describe('la matriz documental del manual del docente (capítulo 3)', () => {
    const exige = (m: ModalidadPractica, ...tipos: TipoDocumento[]) => {
      const todos = documentosExigidos(m);
      for (const t of tipos) expect(todos).toContain(t);
    };

    it('contrato de aprendizaje: ARL, EPS, contrato, PSO-F012, carta de finalización y plan', () => {
      exige(ModalidadPractica.CONTRATO_APRENDIZAJE,
        TipoDocumento.CERTIFICADO_ARL, TipoDocumento.CERTIFICADO_EPS,
        TipoDocumento.CONTRATO_APRENDIZAJE, TipoDocumento.FORMATO_SEGUIMIENTO_FINAL,
        TipoDocumento.CARTA_FINALIZACION, TipoDocumento.PLAN_MEJORAMIENTO);
    });

    it('validación de experiencia: certificado laboral con funciones y contrato laboral', () => {
      exige(ModalidadPractica.VALIDACION_EXPERIENCIA,
        TipoDocumento.CERTIFICADO_LABORAL_FUNCIONES, TipoDocumento.CONTRATO_LABORAL,
        TipoDocumento.FORMATO_SEGUIMIENTO_FINAL, TipoDocumento.PLAN_MEJORAMIENTO);
      expect(documentosExigidos(ModalidadPractica.VALIDACION_EXPERIENCIA))
        .not.toContain(TipoDocumento.ACTA_INICIO);
    });

    it('semilleros: acta, EPS, ARL, artículo científico, seguimiento y carta de finalización', () => {
      exige(ModalidadPractica.INVESTIGACION,
        TipoDocumento.ACTA_INICIO, TipoDocumento.CERTIFICADO_EPS, TipoDocumento.CERTIFICADO_ARL,
        TipoDocumento.ARTICULO_CIENTIFICO, TipoDocumento.FORMATO_SEGUIMIENTO_FINAL, TipoDocumento.CARTA_FINALIZACION);
      exige(ModalidadPractica.PRACTICA_TECNICA_INVESTIGACION, TipoDocumento.REPORTE_SEMILLEROS);
    });

    it('CUNbre: RUT, soporte de aceptación, ocho mentorías y evaluación final', () => {
      const todos = documentosExigidos(ModalidadPractica.CUNBRE_CONSOLIDADO);
      expect(todos).toContain(TipoDocumento.RUT_JURIDICO);
      expect(todos).toContain(TipoDocumento.CAMARA_COMERCIO);
      expect(todos).toContain(TipoDocumento.SOPORTE_ACEPTACION_CUNBRE);
      expect(todos.filter((t) => t.startsWith('entregable_mentoria_'))).toHaveLength(8);
      expect(todos).toContain(TipoDocumento.EVALUACION_FINAL_CUNBRE);
    });

    it('monitoría: acta, EPS, ARL, informes 1 y 2 e informe final', () => {
      exige(ModalidadPractica.MONITORIA,
        TipoDocumento.ACTA_INICIO, TipoDocumento.CERTIFICADO_EPS, TipoDocumento.CERTIFICADO_ARL,
        TipoDocumento.INFORME_1, TipoDocumento.INFORME_2, TipoDocumento.INFORME_FINAL);
    });

    it('el primer momento reúne EPS, formalización y ARL; el segundo, el avance; el tercero, el cierre', () => {
      expect(momentoDe(EtapaExpediente.PRE_POSTULACION)).toBe(MomentoExpediente.INICIALES);
      expect(momentoDe(EtapaExpediente.INICIO)).toBe(MomentoExpediente.INICIALES);
      expect(momentoDe(EtapaExpediente.AVANCE)).toBe(MomentoExpediente.AVANCE);
      expect(momentoDe(EtapaExpediente.CIERRE)).toBe(MomentoExpediente.CIERRE);
      const todas = Object.values(ETAPAS_POR_MOMENTO).flat();
      expect(new Set(todas).size).toBe(Object.values(EtapaExpediente).length);
    });

    it('la ARL nunca se exige antes de la etapa de inicio: la solicitud es previa y separada', () => {
      for (const d of MATRIZ_MODALIDADES) {
        expect(d.documentos[EtapaExpediente.PRE_POSTULACION] ?? []).not.toContain(TipoDocumento.CERTIFICADO_ARL);
        expect(d.documentos[EtapaExpediente.FORMALIZACION] ?? []).not.toContain(TipoDocumento.CERTIFICADO_ARL);
      }
    });
  });

  describe('criterios de revisión por documento', () => {
    it('todo documento exigido por alguna modalidad tiene criterios de revisión', () => {
      for (const d of MATRIZ_MODALIDADES) {
        for (const tipo of documentosExigidos(d.modalidad)) {
          expect(criteriosDe(tipo)).not.toBeNull();
        }
      }
    });

    it('EPS y ARL caducan a los 30 días; RUT y Cámara deben ser del año en curso', () => {
      expect(CRITERIOS_DOCUMENTALES[TipoDocumento.CERTIFICADO_EPS]?.vigenciaDias).toBe(30);
      expect(CRITERIOS_DOCUMENTALES[TipoDocumento.CERTIFICADO_ARL]?.vigenciaDias).toBe(30);
      expect(CRITERIOS_DOCUMENTALES[TipoDocumento.RUT_NATURAL]?.delAnoEnCurso).toBe(true);
      expect(CRITERIOS_DOCUMENTALES[TipoDocumento.CAMARA_COMERCIO]?.delAnoEnCurso).toBe(true);
    });

    it('la EPS no acepta Sisbén, ADRES ni planilla, tal como lo dice el manual', () => {
      const no = CRITERIOS_DOCUMENTALES[TipoDocumento.CERTIFICADO_EPS]?.noSeAcepta.join(' ') ?? '';
      expect(no).toMatch(/Sisbén/);
      expect(no).toMatch(/ADRES/);
      expect(no).toMatch(/Planilla/);
    });

    it('las reglas generales exigen PDF sin contraseña y ocho días para subsanar', () => {
      const texto = REGLAS_GENERALES_CARGUE.join(' ');
      expect(texto).toMatch(/PDF/);
      expect(texto).toMatch(/contraseña/);
      expect(texto).toMatch(/ocho días/);
    });
  });

  describe('estados del SGP: anulado y reprueba', () => {
    it('una práctica inscrita se puede anular para habilitar un registro nuevo', () => {
      const p = practica(EstadoPractica.INSCRITA);
      p.transicionarA(EstadoPractica.ANULADA);
      expect(p.estado).toBe(EstadoPractica.ANULADA);
      expect(p.esTerminal).toBe(true);
    });

    it('una práctica activa puede reprobar, pero una reprobada no vuelve', () => {
      const p = practica(EstadoPractica.ACTIVA);
      p.transicionarA(EstadoPractica.REPROBADA);
      expect(() => p.transicionarA(EstadoPractica.ACTIVA)).toThrow(TransicionInvalidaError);
    });

    it('la equivalencia cubre todos los estados y aterriza en los cinco del SGP', () => {
      const valores = new Set(Object.values(EQUIVALENCIA_SGP));
      expect(Object.keys(EQUIVALENCIA_SGP)).toHaveLength(Object.values(EstadoPractica).length);
      expect([...valores].sort()).toEqual(['Anulado', 'Cerrado', 'En práctica', 'Inscrito', 'Reprueba']);
    });
  });

  describe('roles del SGP', () => {
    it('el auxiliar de prácticas tiene alcance institucional', () => {
      expect(alcancePorRol(Rol.AUXILIAR).institucional).toBe(true);
    });

    it('la coordinación sin escuelas es el Área de Prácticas: ve toda la institución', () => {
      expect(alcancePorRol(Rol.COORDINADOR, { escuelas: [] }).institucional).toBe(true);
      expect(alcancePorRol(Rol.COORDINADOR, { escuelas: ['ESC-ING'] }).institucional).toBe(false);
    });

    it('el auxiliar y la coordinación de área ven cualquier expediente', () => {
      const p = practica(EstadoPractica.ACTIVA);
      expect(p.visiblePara({ id: 'x', rol: Rol.AUXILIAR, escuelas: [], empresaId: null })).toBe(true);
      expect(p.visiblePara({ id: 'x', rol: Rol.COORDINADOR, escuelas: [], empresaId: null })).toBe(true);
      expect(p.visiblePara({ id: 'x', rol: Rol.COORDINADOR, escuelas: ['ESC-ING'], empresaId: null })).toBe(false);
    });
  });
});
