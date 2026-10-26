import { TipoDocumento } from './documento.entity';

/**
 * Esquema de extracción por tipo documental (capa 2 del pipeline).
 *
 * Es conocimiento del dominio, no del proveedor de IA: dice QUÉ se lee de cada
 * documento, con el nombre con que luego lo usan la coherencia cruzada (capa 3)
 * y la lista de chequeo del revisor. El adaptador que llame al modelo —el que
 * sea— recibe esta lista; no la define.
 *
 * Parcial a propósito: los documentos del cierre (informes, mentorías,
 * PSO-F012) no se extraen por campos; la revisión es humana y el catálogo de
 * criterios dice qué mirar. Un tipo sin campos declarados va directo a revisión.
 */
export const CAMPOS_POR_TIPO: Readonly<Partial<Record<TipoDocumento, readonly string[]>>> = {
  [TipoDocumento.CEDULA]: ['numero_documento', 'nombres', 'apellidos', 'fecha_expedicion'],
  // La fecha del certificado de EPS decide su vigencia: se extrae con su
  // etiqueta original, sin conciliarla con otras fechas del documento.
  [TipoDocumento.CERTIFICADO_EPS]: [
    'entidad_emisora', 'nombre_afiliado', 'documento_afiliado',
    'fecha_expedicion', 'estado_afiliacion', 'regimen',
  ],
  [TipoDocumento.ACTA_INICIO]: [
    'modalidad', 'fecha_inicio', 'fecha_fin', 'funciones',
    'nombre_responsable', 'cargo_responsable', 'firmas_presentes',
  ],
  // Fecha de generación de una copia y fecha de registro inicial no son lo
  // mismo: se extraen por separado y con la etiqueta que trae el documento.
  [TipoDocumento.RUT_NATURAL]: [
    'nit', 'nombres', 'apellidos', 'fecha_generacion', 'actividad_economica',
  ],
  [TipoDocumento.RUT_JURIDICO]: [
    'nit', 'razon_social', 'fecha_generacion', 'actividad_economica',
  ],
  [TipoDocumento.CAMARA_COMERCIO]: [
    'nit', 'razon_social', 'matricula', 'fecha_matricula', 'fecha_expedicion', 'estado',
  ],
  [TipoDocumento.SOPORTE_RELACION_LABORAL]: [
    'razon_social', 'nombre_trabajador', 'cargo', 'fecha_ingreso', 'funciones', 'vigente',
  ],
  [TipoDocumento.AUTORIZACION_FUNCIONES]: [
    'razon_social', 'nombre_trabajador', 'funciones_autorizadas',
    'nombre_firmante', 'cargo_firmante',
  ],
  [TipoDocumento.CARTA_ACEPTACION]: [
    'nit_empresa', 'razon_social', 'nombre_estudiante', 'cargo',
    'fecha_inicio', 'fecha_fin', 'firma_representante',
  ],
  [TipoDocumento.CERTIFICADO_ARL]: [
    'nit_empresa', 'razon_social', 'nombre_afiliado', 'documento_afiliado',
    'fecha_afiliacion', 'arl', 'tipo_cotizante',
  ],
  [TipoDocumento.CONVENIO_PRACTICA]: ['nit_empresa', 'razon_social', 'vigencia_desde', 'vigencia_hasta'],
  [TipoDocumento.PLANILLA_HORAS]: [
    'nombre_estudiante', 'razon_social', 'total_horas',
    'periodo_desde', 'periodo_hasta', 'nombre_firmante', 'cargo_firmante',
  ],
  [TipoDocumento.PLAN_MEJORAMIENTO]: ['nombre_estudiante', 'razon_social', 'objetivos', 'conclusiones'],
  [TipoDocumento.CERTIFICADO_EXISTENCIA]: [
    'nit_empresa', 'razon_social', 'representante_legal', 'fecha_expedicion', 'estado_matricula',
  ],
  [TipoDocumento.CERTIFICACION_LABORAL]: [
    'nit_empresa', 'razon_social', 'nombre_empleado', 'cargo',
    'fecha_ingreso', 'fecha_retiro', 'nombre_firmante',
  ],
  [TipoDocumento.PLANILLA_APORTES]: ['nit_empresa', 'periodo', 'nombre_cotizante', 'ibc'],
  [TipoDocumento.CERTIFICADO_PRACTICA]: [
    'nit_empresa', 'razon_social', 'nombre_estudiante', 'total_horas', 'fecha_expedicion',
  ],
  // ── Documentos del proceso SGP con campos legibles ──
  [TipoDocumento.CONTRATO_APRENDIZAJE]: [
    'nit_empresa', 'razon_social', 'nombre_aprendiz', 'documento_aprendiz',
    'fecha_inicio', 'fecha_fin', 'firmas_presentes',
  ],
  [TipoDocumento.CERTIFICADO_LABORAL_FUNCIONES]: [
    'nit_empresa', 'razon_social', 'nombre_empleado', 'cargo', 'fecha_ingreso',
    'funciones', 'fecha_expedicion', 'nombre_firmante', 'cargo_firmante',
  ],
  [TipoDocumento.CONTRATO_LABORAL]: [
    'nit_empresa', 'razon_social', 'nombre_trabajador', 'cargo', 'fecha_inicio',
    'tipo_contrato', 'firmas_presentes',
  ],
  [TipoDocumento.CARTA_FINALIZACION]: [
    'nit_empresa', 'razon_social', 'nombre_estudiante', 'fecha_inicio', 'fecha_fin',
    'fecha_expedicion', 'nombre_firmante', 'cargo_firmante',
  ],
  [TipoDocumento.FORMATO_SEGUIMIENTO_FINAL]: [
    'nombre_estudiante', 'razon_social', 'nombre_jefe', 'cargo_jefe', 'enlace_plan_mejora',
    'calificacion', 'firmas_presentes',
  ],
  [TipoDocumento.SEGURO_MEDICO_INTERNACIONAL]: [
    'aseguradora', 'nombre_asegurado', 'documento_asegurado', 'vigencia_desde', 'vigencia_hasta',
    'cobertura_pais',
  ],
};

/**
 * Qué significa cada campo. El modelo lee documentos colombianos muy
 * heterogéneos; sin esta semántica confunde la fecha de generación de una copia
 * con la de expedición, o el NIT de la ARL con el de la empresa.
 */
export const DESCRIPCION_CAMPOS: Readonly<Record<string, string>> = {
  numero_documento: 'Número de la cédula o documento de identidad, solo dígitos, sin puntos.',
  nombres: 'Nombres de la persona titular, tal como aparecen.',
  apellidos: 'Apellidos de la persona titular, tal como aparecen.',
  fecha_expedicion: 'Fecha en que el documento fue expedido o generado por la entidad emisora, en formato AAAA-MM-DD. No confundir con fechas de afiliación, ingreso o nacimiento.',
  entidad_emisora: 'Nombre de la EPS o entidad que expide el certificado.',
  nombre_afiliado: 'Nombre completo de la persona afiliada o cubierta.',
  documento_afiliado: 'Número de identificación de la persona afiliada, solo dígitos.',
  estado_afiliacion: 'Estado literal de la afiliación (por ejemplo ACTIVO, SUSPENDIDO, RETIRADO).',
  regimen: 'Régimen de salud (contributivo, subsidiado, especial) y tipo de afiliado (cotizante o beneficiario) si aparecen.',
  modalidad: 'Modalidad de práctica que declara el documento.',
  fecha_inicio: 'Fecha de inicio de la práctica, contrato o vínculo, en formato AAAA-MM-DD.',
  fecha_fin: 'Fecha de terminación prevista o efectiva, en formato AAAA-MM-DD.',
  funciones: 'Funciones o actividades descritas, resumidas literalmente en una frase.',
  funciones_autorizadas: 'Funciones que la empresa autoriza al trabajador para la práctica.',
  nombre_responsable: 'Nombre de la persona responsable, jefe inmediato o tutor en la organización.',
  cargo_responsable: 'Cargo de esa persona responsable.',
  firmas_presentes: 'Quiénes firman de verdad (manuscrita, digital o certificada), separados por coma. Un nombre digitado sin trazo de firma NO cuenta como firma.',
  nit: 'NIT del contribuyente, solo dígitos, sin el dígito de verificación.',
  nit_empresa: 'NIT de la empresa u organización escenario de práctica (no el de la ARL, EPS o cámara), solo dígitos, sin el dígito de verificación.',
  razon_social: 'Razón social o nombre de la empresa u organización escenario de práctica.',
  fecha_generacion: 'Fecha de generación del documento (RUT: «Fecha generación documento PDF»), en AAAA-MM-DD.',
  actividad_economica: 'Código CIIU de la actividad económica principal, cuatro dígitos.',
  matricula: 'Número de matrícula mercantil.',
  fecha_matricula: 'Fecha de matrícula mercantil, en AAAA-MM-DD.',
  estado: 'Estado literal de la matrícula o del registro (ACTIVA, CANCELADA, RENOVADA…).',
  estado_matricula: 'Estado literal de la matrícula mercantil.',
  nombre_trabajador: 'Nombre completo del trabajador o empleado.',
  nombre_empleado: 'Nombre completo del empleado certificado.',
  nombre_aprendiz: 'Nombre completo del aprendiz.',
  documento_aprendiz: 'Número de identificación del aprendiz, solo dígitos.',
  cargo: 'Cargo o posición que ocupa la persona.',
  fecha_ingreso: 'Fecha de ingreso o inicio del vínculo laboral, en AAAA-MM-DD.',
  fecha_retiro: 'Fecha de retiro, si la hay; null si el vínculo está vigente.',
  vigente: '«si» cuando el documento afirma que el vínculo está vigente; «no» cuando dice que terminó; null si no lo dice.',
  nombre_firmante: 'Nombre de quien firma el documento.',
  cargo_firmante: 'Cargo de quien firma el documento.',
  nombre_estudiante: 'Nombre completo del estudiante o practicante.',
  firma_representante: 'Nombre del representante de la empresa que firma la carta.',
  fecha_afiliacion: 'Fecha desde la cual rige la afiliación o cobertura (ARL: «fecha de afiliación», «inicio de cobertura», «fecha de ingreso»), en AAAA-MM-DD.',
  arl: 'Nombre de la administradora de riesgos laborales (Sura, Positiva, Colmena, Bolívar, AXA Colpatria, Colsanitas…).',
  tipo_cotizante: 'Código numérico del tipo de cotizante si aparece (por ejemplo 23 estudiante en práctica, 1 dependiente).',
  vigencia_desde: 'Inicio de la vigencia del convenio o póliza, en AAAA-MM-DD.',
  vigencia_hasta: 'Fin de la vigencia del convenio o póliza, en AAAA-MM-DD.',
  total_horas: 'Total de horas certificadas, número entero.',
  periodo_desde: 'Inicio del periodo que cubre la planilla, en AAAA-MM-DD.',
  periodo_hasta: 'Fin del periodo que cubre la planilla, en AAAA-MM-DD.',
  objetivos: 'Objetivos del plan, resumidos literalmente en una o dos frases.',
  conclusiones: 'Conclusiones del plan, resumidas literalmente en una o dos frases.',
  representante_legal: 'Nombre del representante legal según el certificado.',
  periodo: 'Periodo de cotización de la planilla (AAAA-MM).',
  nombre_cotizante: 'Nombre del cotizante.',
  ibc: 'Ingreso base de cotización, número sin separadores.',
  tipo_contrato: 'Tipo o término del contrato (indefinido, fijo, obra o labor, aprendizaje).',
  nombre_jefe: 'Nombre del jefe inmediato que diligencia el formato.',
  cargo_jefe: 'Cargo del jefe inmediato.',
  enlace_plan_mejora: 'Enlace (URL) consignado en «Adjunta plan de mejora».',
  calificacion: 'Calificación o valoración final consignada, tal como aparece.',
  aseguradora: 'Nombre de la aseguradora del seguro médico.',
  nombre_asegurado: 'Nombre completo de la persona asegurada.',
  documento_asegurado: 'Número de identificación de la persona asegurada, solo dígitos.',
  cobertura_pais: 'País o región que cubre la póliza.',
};

export function camposDe(tipo: TipoDocumento): readonly string[] {
  return CAMPOS_POR_TIPO[tipo] ?? [];
}
