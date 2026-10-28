/**
 * Las alertas automáticas del análisis de un documento, en lenguaje de quien revisa. El código interno (C0_…, C2_…) NO se muestra
 * como texto principal: queda como detalle para diagnóstico (atributo `title`). Solo presentación: el valor real no cambia.
 */
export const TEXTO_BANDERA: Readonly<Record<string, string>> = {
  // Capa 0 · archivo e imagen
  C0_CEDULA_OTRO_TITULAR: 'La cédula parece ser de otra persona.',
  C0_HASH_DUPLICADO: 'El mismo archivo ya fue cargado anteriormente.',
  C0_IMAGEN_REUTILIZADA: 'La imagen se parece a otra ya presentada.',
  C0_NITIDEZ_INSUFICIENTE: 'La imagen no es lo bastante nítida.',
  C0_NUIP_DIGITO_INVALIDO: 'El número de identificación no pasa la verificación de su dígito.',
  C0_PDF417_NO_INTERPRETABLE: 'El código de barras de la cédula no se pudo interpretar.',
  C0_RESOLUCION_BAJA: 'La resolución de la imagen es baja.',
  C0_SIN_PDF417: 'No se encontró el código de barras de la cédula.',
  C0_SOBREEXPUESTA: 'La imagen está sobreexpuesta (demasiada luz).',
  C0_TIPO_DISCREPANTE: 'El tipo de documento no coincide con el esperado.',
  C0_TIPO_NO_RECONOCIDO: 'No se reconoció qué tipo de documento es.',
  C0_TITULAR_NO_COMPROBABLE: 'No se pudo comprobar de quién es el documento.',
  // Capa 1 · PDF
  C1_MODIFICADO_POSTERIORMENTE: 'El PDF fue modificado después de crearse.',
  C1_PRODUCTOR_DESCONOCIDO: 'No se sabe con qué programa se creó el PDF.',
  C1_PRODUCTOR_ESCRITORIO: 'El PDF se creó con un programa de escritorio común.',
  C1_REVISIONES_INCREMENTALES: 'El PDF tiene varias versiones guardadas una sobre otra.',
  C1_SIN_CAPA_TEXTO: 'El PDF es una imagen, sin texto seleccionable.',
  C1_TIPOGRAFIAS_MULTIPLES: 'El PDF mezcla muchos tipos de letra.',
  // Capa 2 · lectura
  C2_CAMPO_AUSENTE: 'Falta un dato que el documento debería traer.',
  C2_CONFIANZA_BAJA: 'La lectura automática no está segura de algunos datos.',
  C2_CRITERIOS_NO_DETERMINABLES: 'No se pudo comprobar algunos requisitos del documento.',
  C2_EXTRACCION_NO_DISPONIBLE: 'La lectura automática no pudo ejecutarse.',
  C2_LEGIBLE_TRAS_PREPROCESO: 'Solo se pudo leer después de mejorar la imagen.',
  C2_LIMITE_LECTURAS_PRACTICA: 'Se alcanzó el límite de lecturas automáticas de la práctica.',
  C2_PROCESAMIENTO_LOCAL_NO_DISPONIBLE: 'La lectura automática no está disponible para este documento.',
  C2_REVISION_HUMANA_OBLIGATORIA: 'Este tipo de documento siempre lo revisa una persona.',
  C2_SIN_LECTURA_AUTOMATICA: 'No se pudo leer automáticamente el documento.',
  C2_TIPO_INCORRECTO: 'El archivo no parece ser el documento que se pidió.',
  C2_TOPE_DIARIO_ALCANZADO: 'Se alcanzó el tope diario de lectura automática.',
  // Capa 3 · coherencia entre documentos
  C3_AFILIADO_NO_CORRESPONDE: 'El afiliado no corresponde al estudiante.',
  C3_ARL_NO_ANTERIOR_AL_INICIO: 'La afiliación a ARL no es anterior al inicio de la práctica.',
  C3_AUTOAPROBACION_NO_HABILITADA: 'Este documento no se aprueba automáticamente: lo decide una persona.',
  C3_CERTIFICADO_EXISTENCIA_VENCIDO: 'El certificado de existencia está vencido.',
  C3_EPS_DOCUMENTO_DISTINTO: 'El documento del certificado de EPS no coincide con el del estudiante.',
  C3_EPS_NOMBRE_DISTINTO: 'El nombre del certificado de EPS no coincide con el del estudiante.',
  C3_EPS_VENCIDO: 'El certificado de EPS está vencido.',
  C3_FIRMANTE_DISCREPANTE: 'El firmante no coincide con el esperado.',
  C3_NIT_INCONSISTENTE: 'El NIT no es consistente entre los documentos.',
  C3_NIT_NO_CORRESPONDE_EMPRESA: 'El NIT no corresponde a la empresa.',
};

/** Texto para mostrar: la traducción si existe; si no, el mensaje que trae el servidor (nunca el código solo). */
export function textoBandera(codigo: string, mensaje: string | null | undefined): string {
  return TEXTO_BANDERA[codigo] ?? (mensaje && mensaje.trim() ? mensaje : 'Hay una alerta automática en este documento.');
}
