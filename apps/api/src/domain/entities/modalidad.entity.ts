import { TipoDocumento } from './documento.entity';

/**
 * Modalidades de práctica de la CUN y su matriz documental.
 *
 * La fuente es el proceso vigente en el Sistema de Gestión de Prácticas (SGP):
 * la guía «Documentación a cargar para cada tipo de práctica» de Desarrollo
 * Profesional fija, modalidad por modalidad, la lista oficial de documentos y
 * lo que se revisa en cada uno; el manual de coordinación enumera las quince
 * modalidades del selector; el manual del portal de ARL agrupa la carga en
 * tres momentos —inicio, avance y cierre—.
 *
 * Dos separaciones que el diseño funcional exige y que es fácil confundir:
 *
 * 1. **Modalidad académica ≠ entidad que paga la ARL.** Las articuladas las
 *    afilia la CUN; las externas, la organización receptora; y hay convenios
 *    que trasladan la cobertura (tercer sector, Destinos Tour). Por eso la
 *    responsabilidad es un dato de la matriz y admite excepción por
 *    organización y vigencia —nunca porque el nombre de la empresa se parezca.
 *
 * 2. **Etapa ≠ expediente completo.** Exigir en la postulación un acta de la
 *    empresa que todavía no se ha elegido, o una ARL emitida para una
 *    colocación que aún no existe, es una dependencia circular. Los requisitos
 *    se piden por etapa, y cada etapa solo exige lo que a esa altura puede
 *    existir. Las etapas se agrupan en los tres momentos del SGP.
 */

export enum ModalidadPractica {
  // ── Articuladas: escenario dentro de la institución; la CUN afilia ──
  MONITORIA = 'monitoria',
  SOCIAL = 'social',
  INVESTIGACION = 'investigacion',
  PRACTICA_TECNICA_INVESTIGACION = 'practica_tecnica_investigacion',
  PASANTIA_INVESTIGATIVA = 'pasantia_investigativa',
  CUNBRE_NACIENTE = 'cunbre_naciente',
  CUNBRE_CONSOLIDADO = 'cunbre_consolidado',
  // ── Externas: sector productivo; la organización afilia ──
  CONTRATO_APRENDIZAJE = 'contrato_aprendizaje',
  VALIDACION_EXPERIENCIA = 'validacion_experiencia',
  COMBINACION_FUNCIONES = 'combinacion_funciones',
  PASANTIA = 'pasantia',
  PASANTIA_INTERNACIONAL = 'pasantia_internacional',
  ESTADO_JOVEN = 'estado_joven',
  ASESORIA_ASISTENCIA_TECNICA = 'asesoria_asistencia_tecnica',
}

/**
 * Etapas del expediente. El orden importa: lo exigible en una etapa solo puede
 * depender de lo que ya existe en las anteriores.
 */
export enum EtapaExpediente {
  PRE_POSTULACION = 'pre_postulacion',
  FORMALIZACION = 'formalizacion',
  INICIO = 'inicio',
  AVANCE = 'avance',
  CIERRE = 'cierre',
}

export const ORDEN_ETAPAS: readonly EtapaExpediente[] = [
  EtapaExpediente.PRE_POSTULACION,
  EtapaExpediente.FORMALIZACION,
  EtapaExpediente.INICIO,
  EtapaExpediente.AVANCE,
  EtapaExpediente.CIERRE,
];

/** Los tres momentos de cargue del SGP (manual del portal de ARL, §7.3). */
export enum MomentoExpediente {
  INICIALES = 1,
  AVANCE = 2,
  CIERRE = 3,
}

export const ETAPAS_POR_MOMENTO: Readonly<Record<MomentoExpediente, readonly EtapaExpediente[]>> = {
  [MomentoExpediente.INICIALES]: [
    EtapaExpediente.PRE_POSTULACION, EtapaExpediente.FORMALIZACION, EtapaExpediente.INICIO,
  ],
  [MomentoExpediente.AVANCE]: [EtapaExpediente.AVANCE],
  [MomentoExpediente.CIERRE]: [EtapaExpediente.CIERRE],
};

export const ETIQUETA_MOMENTO: Readonly<Record<MomentoExpediente, string>> = {
  [MomentoExpediente.INICIALES]: 'Primer momento · documentos iniciales',
  [MomentoExpediente.AVANCE]: 'Segundo momento · avance de la práctica',
  [MomentoExpediente.CIERRE]: 'Tercer momento · cierre',
};

export function momentoDe(etapa: EtapaExpediente): MomentoExpediente {
  for (const [momento, etapas] of Object.entries(ETAPAS_POR_MOMENTO)) {
    if (etapas.includes(etapa)) return Number(momento);
  }
  return MomentoExpediente.CIERRE;
}

export enum ResponsableArl {
  /** Afilia la CUN a través de Capital Social, previa solicitud en el portal de ARL. */
  CUN = 'cun',
  /** Afilia la organización receptora. */
  EMPRESA = 'empresa',
  /**
   * Depende del convenio vigente con esa organización. No se resuelve por
   * modalidad ni por el nombre de la empresa: se consulta la cobertura pactada.
   */
  SEGUN_COBERTURA = 'segun_cobertura',
}

export interface DefinicionModalidad {
  readonly modalidad: ModalidadPractica;
  readonly etiqueta: string;
  /** Nombre exacto con el que aparece en el selector del SGP. */
  readonly etiquetaSgp: string;
  readonly descripcion: string;
  /** Articulada: escenario dentro de la CUN; la ARL se solicita en el portal. */
  readonly articulada: boolean;
  readonly responsableArlPorDefecto: ResponsableArl;
  /** Documentos exigidos en cada etapa. Una etapa ausente no exige nada. */
  readonly documentos: Readonly<Partial<Record<EtapaExpediente, readonly TipoDocumento[]>>>;
  /** Duración en meses, según la fuente funcional. `null` = no acotada allí. */
  readonly duracionMesesMinima: number | null;
  readonly duracionMesesMaxima: number | null;
  /**
   * Las fechas deben caer dentro del periodo académico, salvo la excepción que
   * el manual del docente reserva al contrato de aprendizaje (§1.11).
   */
  readonly fechasDentroDelPeriodo: boolean;
  /**
   * Condiciones que la fuente enuncia pero que no son documentos: se muestran
   * al estudiante y se comprueban con datos, no con archivos.
   */
  readonly condicionesAdicionales: readonly string[];
  /**
   * Cuando la fuente funcional no fija la matriz completa, se declara aquí en
   * vez de inventarla. Un requisito supuesto bloquea a un estudiante real.
   */
  readonly matrizPendienteDeRatificar: boolean;
}

// ── Bloques reutilizados de la matriz ─────────────────────────────────────

/** El certificado de EPS es de la persona: se reúne antes de elegir escenario. */
const EPS: readonly TipoDocumento[] = [TipoDocumento.CERTIFICADO_EPS];
const ARL: readonly TipoDocumento[] = [TipoDocumento.CERTIFICADO_ARL];
const ACTA: readonly TipoDocumento[] = [TipoDocumento.ACTA_INICIO];
/** Segundo momento: el documento del plan de mejoramiento (guía de Desarrollo Profesional). */
const PLAN: readonly TipoDocumento[] = [TipoDocumento.PLAN_MEJORAMIENTO];

/** Cierre de las modalidades con jefe inmediato en una organización. */
const CIERRE_CON_EMPRESA: readonly TipoDocumento[] = [
  TipoDocumento.FORMATO_SEGUIMIENTO_FINAL,
  TipoDocumento.CARTA_FINALIZACION,
];

const MENTORIAS_1_A_4: readonly TipoDocumento[] = [
  TipoDocumento.ENTREGABLE_MENTORIA_1, TipoDocumento.ENTREGABLE_MENTORIA_2,
  TipoDocumento.ENTREGABLE_MENTORIA_3, TipoDocumento.ENTREGABLE_MENTORIA_4,
];
const MENTORIAS_5_A_8: readonly TipoDocumento[] = [
  TipoDocumento.ENTREGABLE_MENTORIA_5, TipoDocumento.ENTREGABLE_MENTORIA_6,
  TipoDocumento.ENTREGABLE_MENTORIA_7, TipoDocumento.ENTREGABLE_MENTORIA_8,
];

/**
 * Pasantía y sus variantes (guía: EPS, ARL, acta de inicio, plan de
 * mejoramiento, formato de seguimiento y carta de finalización).
 */
const DOCUMENTOS_PASANTIA = {
  [EtapaExpediente.PRE_POSTULACION]: EPS,
  [EtapaExpediente.FORMALIZACION]: ACTA,
  [EtapaExpediente.INICIO]: ARL,
  [EtapaExpediente.AVANCE]: PLAN,
  [EtapaExpediente.CIERRE]: CIERRE_CON_EMPRESA,
} as const;

/** Semilleros: acta, EPS y ARL; el entregable de investigación al avanzar; seguimiento y carta al cerrar. */
const investigacion = (entregable: TipoDocumento) => ({
  [EtapaExpediente.PRE_POSTULACION]: EPS,
  [EtapaExpediente.FORMALIZACION]: ACTA,
  [EtapaExpediente.INICIO]: ARL,
  [EtapaExpediente.AVANCE]: [entregable],
  [EtapaExpediente.CIERRE]: CIERRE_CON_EMPRESA,
} as const);
const DOCUMENTOS_INVESTIGACION = investigacion(TipoDocumento.ARTICULO_CIENTIFICO);
const DOCUMENTOS_TECNICA_INVESTIGACION = investigacion(TipoDocumento.REPORTE_SEMILLEROS);

/** Reglas comunes a todos los planes de mejoramiento, tomadas de la guía. */
const CONDICIONES_PLAN: readonly string[] = [
  'El plan de mejoramiento sigue la plantilla institucional, es individual y de este periodo: no vale uno de prácticas anteriores; uso de IA no superior al 15 %.',
  'El formato de seguimiento lleva la firma digital del jefe (no el nombre escrito), va diligenciado en su totalidad y en «Adjunta plan de mejora» solo el enlace del plan.',
];

export const MATRIZ_MODALIDADES: readonly DefinicionModalidad[] = [
  // ── Articuladas ──────────────────────────────────────────────────────────
  {
    modalidad: ModalidadPractica.MONITORIA,
    etiqueta: 'Monitoría',
    etiquetaSgp: 'Monitoría',
    descripcion: 'Apoyo académico o administrativo dentro de la institución.',
    articulada: true,
    responsableArlPorDefecto: ResponsableArl.CUN,
    documentos: {
      [EtapaExpediente.PRE_POSTULACION]: EPS,
      [EtapaExpediente.FORMALIZACION]: ACTA,
      [EtapaExpediente.INICIO]: ARL,
      [EtapaExpediente.AVANCE]: [TipoDocumento.INFORME_1, TipoDocumento.INFORME_2],
      [EtapaExpediente.CIERRE]: [TipoDocumento.INFORME_FINAL],
    },
    duracionMesesMinima: null,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'La solicitud de ARL se radica al menos cinco días hábiles antes del inicio.',
      'Los informes 1, 2 y final los revisa el docente de monitorías.',
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.SOCIAL,
    etiqueta: 'Práctica social',
    etiquetaSgp: 'Proyección social',
    descripcion: 'Proyectos con impacto comunitario avalados por Proyección Social.',
    articulada: true,
    responsableArlPorDefecto: ResponsableArl.CUN,
    documentos: DOCUMENTOS_PASANTIA,
    duracionMesesMinima: null,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'Requiere afiliación a EPS (contributivo, beneficiario o subsidiado); no aplica consulta de Sisbén.',
      'En el acta de inicio la modalidad es «Proyección Social»; las fechas corresponden a la ARL y al registro.',
      ...CONDICIONES_PLAN,
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.INVESTIGACION,
    etiqueta: 'Práctica investigativa (semilleros)',
    etiquetaSgp: 'Práctica investigativa',
    descripcion: 'Participación en un semillero o proyecto de investigación.',
    articulada: true,
    responsableArlPorDefecto: ResponsableArl.CUN,
    documentos: DOCUMENTOS_INVESTIGACION,
    duracionMesesMinima: 1,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'El acta la firma el docente tutor o coordinador del semillero; en modalidad va «Práctica Investigativa».',
      'El artículo científico lo revisa el docente de semilleros.',
      'En el registro, elegir bien entre práctica investigativa y práctica técnica en investigación.',
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.PRACTICA_TECNICA_INVESTIGACION,
    etiqueta: 'Práctica técnica en investigación',
    etiquetaSgp: 'Práctica técnica en investigación',
    descripcion: 'Variante de semillero para el ciclo técnico.',
    articulada: true,
    responsableArlPorDefecto: ResponsableArl.CUN,
    documentos: DOCUMENTOS_TECNICA_INVESTIGACION,
    duracionMesesMinima: 1,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'En el acta de inicio la modalidad va «Práctica Técnica en Investigación».',
      'El reporte de semilleros de investigación lo revisa el docente de semilleros.',
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.PASANTIA_INVESTIGATIVA,
    etiqueta: 'Pasantía investigativa',
    etiquetaSgp: 'Pasantía investigativa',
    descripcion: 'Pasantía en un grupo o proyecto de investigación.',
    articulada: true,
    responsableArlPorDefecto: ResponsableArl.SEGUN_COBERTURA,
    documentos: DOCUMENTOS_INVESTIGACION,
    duracionMesesMinima: 1,
    duracionMesesMaxima: 6,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [],
    matrizPendienteDeRatificar: true,
  },
  {
    modalidad: ModalidadPractica.CUNBRE_NACIENTE,
    etiqueta: 'Emprendimiento CUNbre · Naciente',
    etiquetaSgp: 'Emprendimiento CUNBRE – Naciente',
    descripcion: 'Empresa propia en etapa temprana, como persona natural.',
    articulada: true,
    responsableArlPorDefecto: ResponsableArl.CUN,
    documentos: {
      [EtapaExpediente.PRE_POSTULACION]: [...EPS, TipoDocumento.RUT_NATURAL],
      [EtapaExpediente.FORMALIZACION]: [TipoDocumento.SOPORTE_ACEPTACION_CUNBRE],
      [EtapaExpediente.INICIO]: ARL,
      [EtapaExpediente.AVANCE]: MENTORIAS_1_A_4,
      [EtapaExpediente.CIERRE]: [...MENTORIAS_5_A_8, TipoDocumento.EVALUACION_FINAL_CUNBRE],
    },
    duracionMesesMinima: 3,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'El emprendimiento debe acreditar al menos tres meses de funcionamiento.',
      'La ARL se gestiona con la CUN con al menos cinco días de anticipación.',
      'Las ocho bitácoras de mentoría se cargan en orden; el RUT es del año en curso.',
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.CUNBRE_CONSOLIDADO,
    etiqueta: 'Emprendimiento CUNbre · Consolidado',
    etiquetaSgp: 'Emprendimiento CUNBRE – Consolidado',
    descripcion: 'Empresa propia constituida como persona jurídica.',
    articulada: true,
    responsableArlPorDefecto: ResponsableArl.CUN,
    documentos: {
      [EtapaExpediente.PRE_POSTULACION]: [
        ...EPS, TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO,
      ],
      [EtapaExpediente.FORMALIZACION]: [TipoDocumento.SOPORTE_ACEPTACION_CUNBRE],
      [EtapaExpediente.INICIO]: ARL,
      [EtapaExpediente.AVANCE]: MENTORIAS_1_A_4,
      [EtapaExpediente.CIERRE]: [...MENTORIAS_5_A_8, TipoDocumento.EVALUACION_FINAL_CUNBRE],
    },
    duracionMesesMinima: 3,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'El emprendimiento debe acreditar al menos tres meses de funcionamiento.',
      'RUT y Cámara de Comercio del año en curso; las ocho bitácoras de mentoría se cargan en orden.',
    ],
    matrizPendienteDeRatificar: false,
  },
  // ── Externas ─────────────────────────────────────────────────────────────
  {
    modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE,
    etiqueta: 'Contrato de aprendizaje',
    etiquetaSgp: 'Contrato de aprendizaje',
    descripcion: 'Formación teórico-práctica con empresa patrocinadora, regulada por el SENA.',
    articulada: false,
    responsableArlPorDefecto: ResponsableArl.EMPRESA,
    documentos: {
      [EtapaExpediente.PRE_POSTULACION]: EPS,
      [EtapaExpediente.FORMALIZACION]: [TipoDocumento.CONTRATO_APRENDIZAJE],
      [EtapaExpediente.INICIO]: ARL,
      [EtapaExpediente.AVANCE]: PLAN,
      [EtapaExpediente.CIERRE]: CIERRE_CON_EMPRESA,
    },
    duracionMesesMinima: 6,
    duracionMesesMaxima: 6,
    // Única modalidad cuyas fechas pueden exceder el periodo académico (§1.11).
    fechasDentroDelPeriodo: false,
    condicionesAdicionales: [
      'Duración fija de seis meses, 44 horas semanales y apoyo de sostenimiento.',
      'La empresa asume EPS contributiva y ARL; debe estar registrada en CAPRENDIZAJE.',
      'Máximo dos contratos de aprendizaje en toda la trayectoria en la CUN; el segundo exige un nivel de formación superior al del primero (cadena de formación).',
      'La carta de finalización coincide con las fechas de inicio y cierre del contrato; el contrato debe ser acorde al nivel de formación en curso.',
      ...CONDICIONES_PLAN,
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.VALIDACION_EXPERIENCIA,
    etiqueta: 'Validación de experiencia laboral',
    etiquetaSgp: 'Validación de experiencia laboral',
    descripcion: 'Reconocimiento de la relación laboral vigente afín al programa.',
    articulada: false,
    responsableArlPorDefecto: ResponsableArl.EMPRESA,
    documentos: {
      [EtapaExpediente.PRE_POSTULACION]: EPS,
      [EtapaExpediente.FORMALIZACION]: [
        TipoDocumento.CERTIFICADO_LABORAL_FUNCIONES, TipoDocumento.CONTRATO_LABORAL,
      ],
      [EtapaExpediente.INICIO]: ARL,
      [EtapaExpediente.AVANCE]: PLAN,
      [EtapaExpediente.CIERRE]: [TipoDocumento.FORMATO_SEGUIMIENTO_FINAL],
    },
    duracionMesesMinima: 1,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'El certificado laboral consigna las funciones específicas relacionadas con el programa, firmado por la organización; no vale manual de cargo ni perfil de funciones.',
      'El contrato laboral va firmado por ambas partes y con membrete; si tiene otrosí, se anexa.',
      ...CONDICIONES_PLAN,
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.COMBINACION_FUNCIONES,
    etiqueta: 'Combinación de funciones',
    etiquetaSgp: 'Combinación de funciones',
    descripcion: 'Funciones adicionales afines al programa dentro del empleo actual.',
    articulada: false,
    responsableArlPorDefecto: ResponsableArl.EMPRESA,
    documentos: DOCUMENTOS_PASANTIA,
    duracionMesesMinima: 1,
    duracionMesesMaxima: null,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'El acta especifica las funciones adicionales autorizadas por la empresa; en modalidad va «Combinación de Funciones».',
      ...CONDICIONES_PLAN,
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.PASANTIA,
    etiqueta: 'Pasantía',
    etiquetaSgp: 'Pasantía',
    descripcion: 'Experiencia en una organización receptora, con o sin remuneración.',
    articulada: false,
    responsableArlPorDefecto: ResponsableArl.EMPRESA,
    documentos: DOCUMENTOS_PASANTIA,
    duracionMesesMinima: 1,
    duracionMesesMaxima: 3,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'Dura de uno a tres meses y no supera la fecha de fin del periodo académico. Para extenderla, la empresa escribe a practicas@cun.edu.co con copia al docente facilitador; coordinación registra la extensión.',
      'En entidades del tercer sector (fundaciones, ONG) la ARL se tramita con la CUN.',
      'Las fechas del acta de inicio corresponden a la afiliación a ARL hecha por la empresa y al registro; en modalidad va «Pasantía».',
      ...CONDICIONES_PLAN,
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.PASANTIA_INTERNACIONAL,
    etiqueta: 'Pasantía internacional',
    etiquetaSgp: 'Pasantía internacional',
    descripcion: 'Pasantía en una organización fuera del país.',
    articulada: false,
    responsableArlPorDefecto: ResponsableArl.SEGUN_COBERTURA,
    documentos: {
      [EtapaExpediente.PRE_POSTULACION]: [TipoDocumento.CORREO_APROBACION_INTERNACIONAL],
      [EtapaExpediente.FORMALIZACION]: [TipoDocumento.SEGURO_MEDICO_INTERNACIONAL, TipoDocumento.ACTA_INICIO],
      [EtapaExpediente.AVANCE]: PLAN,
      [EtapaExpediente.CIERRE]: CIERRE_CON_EMPRESA,
    },
    duracionMesesMinima: 1,
    duracionMesesMaxima: 6,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [
      'Requiere el correo de aprobación de la modalidad internacional y el seguro médico internacional en lugar de EPS y ARL locales; coordinación registra la cobertura.',
      'El acta de inicio, convenio individual o contrato lleva en modalidad «Pasantía internacional».',
      'El identificador tributario de la empresa puede ser alfanumérico.',
      ...CONDICIONES_PLAN,
    ],
    matrizPendienteDeRatificar: false,
  },
  {
    modalidad: ModalidadPractica.ESTADO_JOVEN,
    etiqueta: 'Estado Joven · pasantía',
    etiquetaSgp: 'Estado Joven – Pasantías',
    descripcion: 'Pasantía en el programa Estado Joven del sector público.',
    articulada: false,
    responsableArlPorDefecto: ResponsableArl.EMPRESA,
    documentos: DOCUMENTOS_PASANTIA,
    duracionMesesMinima: 1,
    duracionMesesMaxima: 6,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [],
    matrizPendienteDeRatificar: true,
  },
  {
    modalidad: ModalidadPractica.ASESORIA_ASISTENCIA_TECNICA,
    etiqueta: 'Asesoría y asistencia técnica',
    etiquetaSgp: 'Asesoría y asistencia técnica',
    descripcion: 'Acompañamiento técnico a una organización desde el programa académico.',
    articulada: false,
    responsableArlPorDefecto: ResponsableArl.SEGUN_COBERTURA,
    documentos: DOCUMENTOS_PASANTIA,
    duracionMesesMinima: 1,
    duracionMesesMaxima: 6,
    fechasDentroDelPeriodo: true,
    condicionesAdicionales: [],
    matrizPendienteDeRatificar: true,
  },
];

const POR_MODALIDAD = new Map(MATRIZ_MODALIDADES.map((d) => [d.modalidad, d]));

export class ModalidadDesconocidaError extends Error {
  constructor(modalidad: string) {
    super(`No existe la modalidad "${modalidad}" en la matriz`);
    this.name = 'ModalidadDesconocidaError';
  }
}

export function definicionModalidad(modalidad: ModalidadPractica): DefinicionModalidad {
  const d = POR_MODALIDAD.get(modalidad);
  if (!d) throw new ModalidadDesconocidaError(modalidad);
  return d;
}

export const MODALIDADES_ARTICULADAS: readonly ModalidadPractica[] = MATRIZ_MODALIDADES
  .filter((d) => d.articulada)
  .map((d) => d.modalidad);

/** Todos los tipos que una modalidad exige, en cualquier etapa, sin repetir. */
export function documentosExigidos(modalidad: ModalidadPractica): readonly TipoDocumento[] {
  const vistos = new Set<TipoDocumento>();
  for (const etapa of ORDEN_ETAPAS) {
    for (const t of definicionModalidad(modalidad).documentos[etapa] ?? []) vistos.add(t);
  }
  return [...vistos];
}
