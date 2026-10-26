/**
 * M11 — Registro inmutable. La tabla no otorga UPDATE ni DELETE a los roles de
 * aplicación (ver migración). Ninguna función puede modificar el histórico.
 */
export enum AccionAuditada {
  SESION_INICIADA = 'sesion_iniciada',
  EXPEDIENTE_CONSULTADO = 'expediente_consultado',
  DOCUMENTO_VISUALIZADO = 'documento_visualizado',
  DOCUMENTO_DESCARGADO = 'documento_descargado',
  DOCUMENTO_CARGADO = 'documento_cargado',
  DECISION_DOCUMENTO = 'decision_documento',
  DECISION_EMPRESA = 'decision_empresa',
  TRANSICION_PRACTICA = 'transicion_practica',
  OBLIGACION_CUMPLIDA = 'obligacion_cumplida',
  VACANTE_PUBLICADA = 'vacante_publicada',
  VACANTE_BLOQUEADA_ANTIDISCRIMINACION = 'vacante_bloqueada_antidiscriminacion',
  REPORTE_GENERADO = 'reporte_generado',
  CERTIFICADO_EMITIDO = 'certificado_emitido',
  AUTORIZACION_TRATAMIENTO = 'autorizacion_tratamiento',
  ACCESO_FUERA_DE_ALCANCE = 'acceso_fuera_de_alcance',
  NOTIFICACION_ENVIADA = 'notificacion_enviada',
  PARAMETRO_CAMBIADO = 'parametro_cambiado',
  REGISTRO_FUR = 'registro_fur',
  VACANTE_PRACTICA_ACTUALIZADA = 'vacante_practica_actualizada',
  CARTA_PRESENTACION_GENERADA = 'carta_presentacion_generada',
  BITACORA_REGISTRADA = 'bitacora_registrada',
  CALIFICACION_REGISTRADA = 'calificacion_registrada',
  PRACTICA_CERRADA = 'practica_cerrada',
  SOLICITUD_ARL_RADICADA = 'solicitud_arl_radicada',
  DECISION_SOLICITUD_ARL = 'decision_solicitud_arl',
  CERTIFICADO_ARL_ENVIADO = 'certificado_arl_enviado',
  USUARIO_CREADO = 'usuario_creado',
  USUARIO_ACTUALIZADO = 'usuario_actualizado',
  SINCRONIZACION_DOCENTES = 'sincronizacion_docentes',
  PERIODO_ACTUALIZADO = 'periodo_actualizado',
  PQRS_RADICADA = 'pqrs_radicada',
  PQRS_RESPONDIDA = 'pqrs_respondida',
}

export interface RegistroAuditoria {
  id?: string;
  actorId: string | null;
  actorCorreo: string | null;
  actorRol: string | null;
  accion: AccionAuditada;
  entidad: string;
  entidadId: string | null;
  justificacion: string | null;
  metadatos: Record<string, unknown> | null;
  ip: string | null;
  agenteUsuario: string | null;
  ocurridoEn: Date;
}

/** Umbral de detección de uso anómalo: no bloquea, notifica. */
export const UMBRAL_CONSULTAS_POR_HORA = 40;
