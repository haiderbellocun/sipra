import { Pipe, PipeTransform } from '@angular/core';

const ETIQUETAS: Record<string, string> = {
  // Estados de práctica
  inscrita: 'Inscrita', documentacion: 'En documentación', en_validacion: 'En validación',
  activa: 'Activa', finalizada: 'Finalizada', certificada: 'Certificada',
  suspendida: 'Suspendida', cancelada: 'Cancelada', anulada: 'Anulada', reprobada: 'Reprueba',
  // Señales
  al_dia: 'Al día', requiere_atencion: 'Requiere atención', en_riesgo: 'En riesgo',
  // Documentos
  recibido: 'Recibido', analizando: 'Analizando', auto_aprobado: 'Aprobado automáticamente',
  en_revision: 'En revisión', ilegible: 'Ilegible', devuelto: 'Devuelto',
  aprobado: 'Aprobado', rechazado: 'Rechazado',
  // Tipos documentales
  cedula: 'Documento de identidad', carta_aceptacion: 'Carta de aceptación',
  certificado_arl: 'Certificado de ARL', convenio_practica: 'Convenio de práctica',
  planilla_horas: 'Planilla de horas', plan_mejoramiento: 'Plan de mejoramiento',
  certificado_existencia: 'Certificado de existencia',
  certificacion_laboral: 'Certificación laboral', planilla_aportes: 'Planilla de aportes',
  certificado_practica: 'Certificado de práctica',
  certificado_eps: 'Certificado de EPS', acta_inicio: 'Acta de inicio', rut_natural: 'RUT persona natural',
  rut_juridico: 'RUT persona jurídica', camara_comercio: 'Cámara de Comercio',
  soporte_relacion_laboral: 'Soporte de relación laboral', autorizacion_funciones: 'Autorización de funciones',
  contrato_aprendizaje: 'Contrato de aprendizaje', certificado_laboral_funciones: 'Certificado laboral con funciones',
  contrato_laboral: 'Contrato laboral', formato_seguimiento_final: 'Formato de seguimiento final (PSO-F012)',
  carta_finalizacion: 'Carta de finalización', avance_plan_mejoramiento: 'Avance del plan de mejoramiento',
  propuesta_articulo: 'Propuesta de artículo', constancia_publicacion: 'Constancia de publicación',
  reporte_semilleros: 'Reporte de semilleros', articulo_cientifico: 'Artículo científico',
  correo_aprobacion_internacional: 'Correo de aprobación · prácticas internacionales',
  seguro_medico_internacional: 'Seguro médico internacional',
  soporte_aceptacion_cunbre: 'Soporte de aceptación CUNbre', evaluacion_final_cunbre: 'Evaluación final CUNbre',
  entregable_mentoria_1: 'Entregable de mentoría 1', entregable_mentoria_2: 'Entregable de mentoría 2',
  entregable_mentoria_3: 'Entregable de mentoría 3', entregable_mentoria_4: 'Entregable de mentoría 4',
  entregable_mentoria_5: 'Entregable de mentoría 5', entregable_mentoria_6: 'Entregable de mentoría 6',
  entregable_mentoria_7: 'Entregable de mentoría 7', entregable_mentoria_8: 'Entregable de mentoría 8',
  informe_1: 'Informe 1', informe_2: 'Informe 2', informe_final: 'Informe final',
  // Modalidades del SGP
  monitoria: 'Monitoría', social: 'Proyección social', investigacion: 'Práctica investigativa',
  practica_tecnica_investigacion: 'Práctica técnica en investigación', pasantia_investigativa: 'Pasantía investigativa',
  cunbre_naciente: 'Emprendimiento CUNbre · naciente', cunbre_consolidado: 'Emprendimiento CUNbre · consolidado',
  validacion_experiencia: 'Validación de experiencia laboral', combinacion_funciones: 'Combinación de funciones',
  pasantia: 'Pasantía', pasantia_internacional: 'Pasantía internacional', estado_joven: 'Estado Joven · pasantías',
  asesoria_asistencia_tecnica: 'Asesoría y asistencia técnica',
  // Bitácora
  mensaje_libre: 'Mensaje libre', seguimiento: 'Bitácora de seguimiento', evaluacion_final: 'Evaluación final',
  evalua_tu_proceso: 'Evalúa tu proceso', calificacion_docente: 'Calificación docente',
  plazo_subsanacion: 'Plazo de subsanación', sistema: 'Plataforma',
  docente: 'Docente facilitador', coordinacion: 'Coordinación',
  // Solicitud de ARL
  radicada: 'Radicada', aprobada: 'Aprobada', certificado_enviado: 'Certificado enviado',
  cumple: 'Cumple', no_cumple: 'No cumple', revision_manual: 'Revisión manual',
  aprobar: 'Aprobar', rechazar: 'Rechazar', segun_cobertura: 'Según cobertura',
  convencional: 'Convencional', regimen_especial: 'Régimen especial', fomag: 'FOMAG', epsi: 'EPSI',
  // Ventanas y roles
  solicitud_arl: 'Solicitud de ARL',
  cargue_estudiante: 'Cargue de documentos · estudiante',
  cargue_docente: 'Cargue de documentos · docente', carta_presentacion: 'Carta de presentación',
  presencial: 'Presencial', virtual: 'Virtual', '335': 'Calendario 335', auxiliar: 'Auxiliar',
  // PQRS
  peticion: 'Petición', queja: 'Queja', reclamo: 'Reclamo', sugerencia: 'Sugerencia',
  en_tramite: 'En trámite', respondida: 'Respondida', unificada: 'Unificada', consulta: 'Consulta', escritura: 'Escritura',
  remunerada: 'Remunerada', no_remunerada: 'No remunerada',
  // Empresas
  solicitud_recibida: 'Solicitud recibida', en_verificacion: 'En verificación',
  requiere_info: 'Requiere información', habilitada: 'Habilitada', rechazada: 'Rechazada',
  // Obligaciones
  afiliacion_arl: 'Afiliación a ARL', certificacion_practica: 'Certificación de práctica',
  reporte_plaza_practica: 'Reporte de plaza de práctica',
  autorizacion_tratamiento: 'Autorización de tratamiento',
  pendiente: 'Pendiente', cumplida: 'Cumplida', vencida: 'Vencida', no_aplica: 'No aplica',
  bloquea_activa: 'Bloquea la activación', bloquea_certificada: 'Bloquea la certificación',
  bloquea_cargue: 'Bloquea el cargue', alerta: 'Genera alerta',
  cun: 'CUN', empresa: 'Empresa', estudiante: 'Estudiante',
  // Modalidades y ciclos
  empresarial: 'Práctica empresarial', emprendimiento: 'Emprendimiento',
  vinculo_laboral: 'Vínculo laboral homologado', proyecto_social: 'Proyecto social',
  tecnico: 'Técnico', tecnologo: 'Tecnólogo', profesional: 'Profesional',
  // Vacantes
  borrador: 'Borrador', publicada: 'Publicada', reportada_spe: 'Reportada al SPE',
  cerrada: 'Cerrada', practica: 'Marco práctica', laboral: 'Marco laboral',
  // Catálogos oficiales
  cno: 'CNO — ocupaciones', ciiu: 'CIIU — actividad económica',
  divipola_municipio: 'DIVIPOLA — municipios',
  divipola_departamento: 'DIVIPOLA — departamentos',
  nivel_educativo: 'Niveles educativos',
  // Costos de IA
  principal: 'Principal', alternativa: 'Alternativa', escalamiento: 'Escalamiento', no_recomendado: 'No recomendado',
  // Auditoría
  sesion_iniciada: 'Sesión iniciada', expediente_consultado: 'Expediente consultado',
  documento_visualizado: 'Documento visualizado', documento_descargado: 'Documento descargado',
  documento_cargado: 'Documento cargado', decision_documento: 'Decisión sobre documento',
  decision_empresa: 'Decisión sobre empresa', transicion_practica: 'Cambio de estado',
  obligacion_cumplida: 'Obligación cumplida', vacante_publicada: 'Vacante publicada',
  vacante_bloqueada_antidiscriminacion: 'Vacante bloqueada (antidiscriminación)',
  reporte_generado: 'Reporte generado', certificado_emitido: 'Certificado emitido',
  acceso_fuera_de_alcance: 'Acceso fuera de alcance', registro_fur: 'Registro FUR',
  vacante_practica_actualizada: 'Datos de la práctica actualizados', carta_presentacion_generada: 'Carta generada',
  bitacora_registrada: 'Entrada de bitácora', calificacion_registrada: 'Calificación registrada',
  practica_cerrada: 'Práctica cerrada', solicitud_arl_radicada: 'Solicitud de ARL radicada',
  decision_solicitud_arl: 'Decisión sobre solicitud de ARL', certificado_arl_enviado: 'Certificado de ARL remitido',
  usuario_creado: 'Usuario creado', usuario_actualizado: 'Usuario actualizado',
  sincronizacion_docentes: 'Sincronización de docentes', periodo_actualizado: 'Periodo actualizado',
  consentimiento_aceptado: 'Consentimiento aceptado', consentimiento_revocado: 'Consentimiento revocado',
  politica_consentimiento_publicada: 'Política de consentimiento publicada',
};

/** Traduce los códigos de la API a lenguaje comprensible en la interfaz. */
@Pipe({ name: 'etiqueta', standalone: true })
export class EtiquetaPipe implements PipeTransform {
  transform(valor: string | null | undefined): string {
    if (!valor) return '—';
    return ETIQUETAS[valor] ?? valor.replace(/_/g, ' ');
  }
}
