import { TipoDocumento } from './documento.entity';

/**
 * Criterios de revisión por tipo documental, tomados del manual del docente
 * facilitador (capítulos 3 y 4) y del manual del portal de ARL (§8 y §9).
 *
 * Son datos del dominio, no texto de interfaz: alimentan la lista de chequeo
 * que ve quien revisa, las guías de devolución que recibe el estudiante y el
 * contexto que se entrega a la extracción asistida. Cuando el manual fija un
 * criterio, aquí aparece con sus palabras; lo que el manual no dice, no se
 * inventa.
 */

export interface CriteriosDocumento {
  readonly nombre: string;
  /** Quién lo produce o de dónde se descarga. */
  readonly origen: string;
  /** Días máximos desde la expedición. `null` = sin vigencia exigida. */
  readonly vigenciaDias: number | null;
  /** Debe corresponder al año en curso (RUT y Cámara de Comercio). */
  readonly delAnoEnCurso: boolean;
  /** Firmas que el manual exige. Vacío = no aplica. */
  readonly firmas: readonly string[];
  /** Lo que se comprueba para aprobar. */
  readonly criterios: readonly string[];
  /** Causales de devolución explícitas en la fuente. */
  readonly noSeAcepta: readonly string[];
  /** Fuente externa donde se contrasta, si existe. */
  readonly verificacionExterna: string | null;
}

/** Reglas comunes a todo cargue (manuales de coordinación y de ARL). */
export const REGLAS_GENERALES_CARGUE: readonly string[] = [
  'Todos los documentos se cargan en formato PDF.',
  'Ningún documento puede tener contraseña.',
  'Las firmas deben ser manuscritas, digitales o digitales certificadas; no se aceptan nombres escritos en computador ni imágenes recortadas de firmas.',
  'Un documento devuelto se subsana en un plazo máximo de ocho días calendario.',
];

const FIRMA_VALIDA = 'Firma manuscrita o digital válida; no se acepta el nombre digitado ni tipografía que imite una firma.';

export const CRITERIOS_DOCUMENTALES: Readonly<Partial<Record<TipoDocumento, CriteriosDocumento>>> = {
  [TipoDocumento.CERTIFICADO_ARL]: {
    nombre: 'Certificado de afiliación a ARL',
    origen: 'Se descarga del portal web de la ARL.',
    vigenciaDias: 30,
    delAnoEnCurso: false,
    firmas: [],
    criterios: [
      'Es el certificado oficial de afiliación, no otro documento.',
      'Identifica claramente al estudiante.',
      'Muestra estado de afiliación y fecha de cobertura.',
      'La cobertura debe iniciar antes de la fecha de inicio de la práctica.',
    ],
    noSeAcepta: ['Planilla de pago', 'Carné de la ARL', 'Documento distinto al certificado oficial'],
    verificacionExterna: 'Portal de la aseguradora (Sura, Positiva, Colmena, Bolívar, AXA Colpatria, Colsanitas) o RUAF',
  },
  [TipoDocumento.CERTIFICADO_EPS]: {
    nombre: 'Certificado de afiliación a EPS',
    origen: 'Se descarga del portal web de la EPS.',
    vigenciaDias: 30,
    delAnoEnCurso: false,
    firmas: [],
    criterios: [
      'Certificado oficial de la EPS en estado activo.',
      'Identifica claramente al estudiante.',
      'Expedido hace 30 días o menos.',
    ],
    noSeAcepta: [
      'Planilla de aportes', 'Carné', 'Certificado o consulta del Sisbén',
      'Pantallazo o consulta de ADRES como sustituto', 'Soporte de novedades',
      'Certificado con contraseña', 'Certificado con más de 30 días de expedición',
    ],
    verificacionExterna: 'ADRES (BDUA) o RUAF. Régimen especial y FOMAG no registran en ADRES: verificación manual.',
  },
  [TipoDocumento.CEDULA]: {
    nombre: 'Documento de identificación',
    origen: 'Cédula de ciudadanía, tarjeta de identidad, cédula de extranjería o pasaporte.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Legible.', 'Ambas caras coinciden en el número de identificación.', 'Corresponde al estudiante.'],
    noSeAcepta: ['Licencia de conducción u otro documento no oficial', 'Imagen borrosa'],
    verificacionExterna: null,
  },
  [TipoDocumento.ACTA_INICIO]: {
    nombre: 'Acta de inicio',
    origen: 'Formato oficial CUN, descargado del Site de Prácticas. Manuscrita o digital.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Estudiante', 'Jefe inmediato o representante del escenario de práctica'],
    criterios: [
      'Fechas de inicio y fin dentro del periodo de práctica seleccionado.',
      'El jefe inmediato registrado corresponde al firmante por la empresa.',
      'Especifica actividades, horario y escenario.',
      FIRMA_VALIDA,
    ],
    noSeAcepta: ['Fechas fuera del periodo', 'Nombre del jefe distinto de la firma de la empresa'],
    verificacionExterna: null,
  },
  [TipoDocumento.CONTRATO_APRENDIZAJE]: {
    nombre: 'Contrato de aprendizaje',
    origen: 'Copia del contrato registrado en CAPRENDIZAJE.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Estudiante', 'Empresa patrocinadora'],
    criterios: [
      'Firmado por ambas partes.', 'Fechas coherentes con las registradas.',
      'Acorde al nivel de formación en curso.', FIRMA_VALIDA,
    ],
    noSeAcepta: ['Contrato de un nivel de formación distinto al que cursa'],
    verificacionExterna: null,
  },
  [TipoDocumento.CERTIFICADO_LABORAL_FUNCIONES]: {
    nombre: 'Certificado laboral con funciones',
    origen: 'Expedido por la empresa en papel membretado.',
    vigenciaDias: 30,
    delAnoEnCurso: false,
    firmas: ['Responsable autorizado de la empresa (firma y sello)'],
    criterios: [
      'Identifica al estudiante, la empresa y el vínculo laboral.',
      'Incluye tipo de contrato, cargo y las funciones específicas relacionadas con el programa.',
      'Las funciones guardan relación con el nivel de formación y el programa.',
      'Firmado por la organización.',
      FIRMA_VALIDA,
    ],
    noSeAcepta: ['Sin membrete', 'Sin funciones', 'Más de 30 días de expedición', 'Manual de cargo o perfil de funciones en lugar del certificado'],
    verificacionExterna: 'Lineamientos de funciones por programa y ciclo (carpeta institucional)',
  },
  [TipoDocumento.CONTRATO_LABORAL]: {
    nombre: 'Contrato laboral',
    origen: 'Copia del contrato vigente entre el estudiante y la empresa.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Empleador', 'Empleado'],
    criterios: [
      'Firmado por empleador y empleado, con membrete de la organización.',
      'La vigencia cubre la duración del periodo de práctica.',
      'Si el contrato tiene otrosí, se anexa.',
      FIRMA_VALIDA,
    ],
    noSeAcepta: ['Contrato sin firmas o sin membrete', 'Otrosí omitido'],
    verificacionExterna: null,
  },
  [TipoDocumento.FORMATO_SEGUIMIENTO_FINAL]: {
    nombre: 'Formato Seguimiento Final de Prácticas (PSO-F012)',
    origen: 'Formato oficial CUN; lo diligencia y firma el jefe inmediato.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Estudiante', 'Responsable de la empresa'],
    criterios: [
      'Encabezado con datos del estudiante, la empresa y el lugar de práctica.',
      'Calificación de habilidades y competencias por el jefe directo.',
      'Apreciaciones del jefe y del estudiante diligenciadas.',
      'Nota definitiva registrada.',
      'Diligenciado en su totalidad; en «Adjunta plan de mejora» únicamente el enlace del plan.',
      'Firma digital del jefe inmediato; el nombre escrito no es firma.',
      FIRMA_VALIDA,
    ],
    noSeAcepta: [
      'Información incompleta', 'Ausencia de calificación', 'Falta de apreciaciones',
      'Ausencia de firmas', 'Nombre escrito en lugar de la firma del jefe', 'Ausencia de la nota definitiva', 'Inconsistencias',
    ],
    verificacionExterna: null,
  },
  [TipoDocumento.CARTA_FINALIZACION]: {
    nombre: 'Carta de finalización',
    origen: 'Expedida por la empresa en papel membretado.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Jefe o representante autorizado (firma y sello)'],
    criterios: [
      'Certifica el cumplimiento satisfactorio.',
      'Las fechas coinciden con las de inicio y cierre del registro y del acta de inicio (o del contrato de aprendizaje).',
      'Firmada por la organización y con membrete.',
      FIRMA_VALIDA,
    ],
    noSeAcepta: ['Fechas distintas a las del registro y el acta', 'Sin membrete o sin firma'],
    verificacionExterna: null,
  },
  [TipoDocumento.PLAN_MEJORAMIENTO]: {
    nombre: 'Documento del plan de mejoramiento',
    origen: 'Elaborado por el estudiante con la plantilla institucional de su nivel.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: [
      'Desarrolla todos los apartados de la plantilla.',
      'Normas APA 7.ª edición.',
      'Uso de IA declarado y no superior al 15 %.',
      'Producto individual: no se aceptan documentos idénticos entre estudiantes.',
      'Desarrollado en este periodo académico.',
      'Diferencia resultados proyectados de resultados efectivamente alcanzados.',
    ],
    noSeAcepta: ['Ejemplos de la plantilla replicados como contenido propio', 'Plan de una práctica anterior'],
    verificacionExterna: null,
  },
  [TipoDocumento.AVANCE_PLAN_MEJORAMIENTO]: {
    nombre: 'Avance del plan de mejoramiento',
    origen: 'Elaborado por el estudiante (segundo momento).',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Diagnóstico y planteamiento del problema desarrollados.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.PROPUESTA_ARTICULO]: {
    nombre: 'Propuesta de artículo científico',
    origen: 'Elaborada por el estudiante según lineamientos del semillero.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: [
      'Título provisional, planteamiento, justificación, objetivos, marco teórico preliminar y metodología.',
      'Normas APA 7.ª edición.',
    ],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.CONSTANCIA_PUBLICACION]: {
    nombre: 'Carta de finalización o constancia de publicación',
    origen: 'Coordinador del semillero, docente tutor, evento o revista.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Coordinador del semillero o docente tutor'],
    criterios: ['Certifica la participación y el desarrollo del artículo.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.RUT_NATURAL]: {
    nombre: 'RUT de persona natural',
    origen: 'Portal de la DIAN.',
    vigenciaDias: null,
    delAnoEnCurso: true,
    firmas: [],
    criterios: ['Vigente para el año en curso.', 'Relaciona directamente al estudiante.'],
    noSeAcepta: ['RUT de un año distinto al actual'],
    verificacionExterna: null,
  },
  [TipoDocumento.RUT_JURIDICO]: {
    nombre: 'RUT de persona jurídica',
    origen: 'Portal de la DIAN.',
    vigenciaDias: null,
    delAnoEnCurso: true,
    firmas: [],
    criterios: ['Vigente para el año en curso.'],
    noSeAcepta: ['RUT de un año distinto al actual'],
    verificacionExterna: null,
  },
  [TipoDocumento.CAMARA_COMERCIO]: {
    nombre: 'Cámara de Comercio',
    origen: 'Certificado de existencia y representación legal.',
    vigenciaDias: null,
    delAnoEnCurso: true,
    firmas: [],
    criterios: ['Vigente para el año en curso.'],
    noSeAcepta: ['Certificado de un año distinto al actual'],
    verificacionExterna: 'RUES',
  },
  [TipoDocumento.SOPORTE_ACEPTACION_CUNBRE]: {
    nombre: 'Soporte de aceptación de CUNbre',
    origen: 'Emitido por el área de CUNbre.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Certifica que el emprendimiento fue evaluado y aceptado. Sin él no se avanza.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.EVALUACION_FINAL_CUNBRE]: {
    nombre: 'Formato de evaluación final CUNbre',
    origen: 'Docente de emprendimiento asignado.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Docente mentor'],
    criterios: ['Evalúa desempeño y resultados de toda la mentoría.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.REPORTE_SEMILLEROS]: {
    nombre: 'Reporte de semilleros de investigación',
    origen: 'Entregable del semillero; lo revisa el docente de semilleros.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Lo aprueba el docente de semilleros; el docente facilitador verifica que esté cargado y corresponda al periodo.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.ARTICULO_CIENTIFICO]: {
    nombre: 'Artículo científico',
    origen: 'Producto del semillero; lo revisa el docente de semilleros.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Lo aprueba el docente de semilleros; el docente facilitador verifica que esté cargado y corresponda al periodo.', 'Normas APA 7.ª edición.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.CORREO_APROBACION_INTERNACIONAL]: {
    nombre: 'Correo de aprobación de la modalidad internacional',
    origen: 'Emitido por el área responsable de prácticas internacionales.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Aprueba expresamente la pasantía internacional del estudiante para el periodo.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.SEGURO_MEDICO_INTERNACIONAL]: {
    nombre: 'Certificado de seguro médico internacional',
    origen: 'Aseguradora.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Cobertura vigente durante toda la pasantía y en el país de destino.'],
    noSeAcepta: ['Póliza vencida o que no cubre las fechas de la pasantía'],
    verificacionExterna: null,
  },
  [TipoDocumento.INFORME_1]: {
    nombre: 'Informe 1 de monitoría',
    origen: 'Estudiante monitor, formato oficial.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Sesiones, temas, estudiantes atendidos, material preparado y apoyo a Permanencia.', 'Lo revisa el docente de monitorías.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.INFORME_2]: {
    nombre: 'Informe 2 de monitoría',
    origen: 'Estudiante monitor, formato oficial.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: [],
    criterios: ['Progreso de la segunda etapa y ajustes frente a los compromisos del informe anterior.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
  [TipoDocumento.INFORME_FINAL]: {
    nombre: 'Informe final de monitoría',
    origen: 'Estudiante monitor, formato oficial.',
    vigenciaDias: null,
    delAnoEnCurso: false,
    firmas: ['Líder o analista de Permanencia'],
    criterios: ['Consolida el proceso, evidencias, matriz FODA, apreciaciones y retroalimentación del área.'],
    noSeAcepta: [],
    verificacionExterna: null,
  },
};

const MENTORIA: CriteriosDocumento = {
  nombre: 'Entregable de mentoría CUNbre',
  origen: 'Formato oficial del encuentro de mentoría.',
  vigenciaDias: null,
  delAnoEnCurso: false,
  firmas: ['Estudiante', 'Docente mentor'],
  criterios: ['Documenta avances, compromisos y resultados de la sesión.', 'Las ocho bitácoras se cargan en orden.', FIRMA_VALIDA],
  noSeAcepta: [],
  verificacionExterna: null,
};

/** Criterios de un tipo; los ocho entregables de mentoría comparten los suyos. */
export function criteriosDe(tipo: TipoDocumento): CriteriosDocumento | null {
  if (tipo.startsWith('entregable_mentoria_')) {
    return { ...MENTORIA, nombre: `${MENTORIA.nombre} ${tipo.slice(-1)}` };
  }
  return CRITERIOS_DOCUMENTALES[tipo] ?? null;
}
