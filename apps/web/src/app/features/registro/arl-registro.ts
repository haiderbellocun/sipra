/**
 * «¿Quién asume la ARL?» en el registro de la práctica (FUR).
 *
 * Es un dato EXPLÍCITO de la práctica: lo confirma quien registra. La modalidad solo SUGIERE un valor y NUNCA lo marca: para
 * un registro nuevo hay que elegir una opción (el formulario no se envía sin ella). Si la modalidad depende del convenio con la
 * organización («según cobertura»), no hay sugerencia. Cambiar de modalidad solo cambia la sugerencia. El acta de iniciación
 * luego confirma o contradice este dato; nunca lo establece. Las prácticas ya registradas no se tocan.
 */
export type ResponsableArl = 'empresa' | 'cun';
export type ResponsableArlFormulario = ResponsableArl | '';

export const ETIQUETA_RESPONSABLE_ARL: Readonly<Record<ResponsableArl, string>> = { empresa: 'Empresa', cun: 'CUN' };

/** El catálogo dice `cun`, `empresa` o `segun_cobertura` (este último no se resuelve por modalidad). */
export function sugerenciaArl(responsableArlDelCatalogo: string | null | undefined): ResponsableArl | null {
  return responsableArlDelCatalogo === 'cun' || responsableArlDelCatalogo === 'empresa' ? responsableArlDelCatalogo : null;
}

/** Error asociado al grupo de opciones cuando aún no se eligió ninguna. */
export const ERROR_ARL_SIN_ELEGIR = 'Selecciona quién asume la ARL.';

/**
 * Ayuda bajo el control, en lenguaje de quien registra. La modalidad solo SUGIERE: nunca marca una opción. Si la persona ya
 * eligió algo distinto de la sugerencia, se le dice, sin bloquear. Sin códigos técnicos.
 */
export function ayudaArl(
  hayModalidad: boolean, sugerida: ResponsableArl | null, elegida: ResponsableArlFormulario,
): string {
  if (!hayModalidad) {
    return 'Elige la modalidad y te mostramos la sugerencia. Tú confirmas quién afilia al estudiante a la ARL.';
  }
  if (sugerida === null) {
    return 'En esta modalidad depende del convenio con la organización: indica quién asume la ARL según lo acordado.';
  }
  const base = `Sugerencia según la modalidad: ${ETIQUETA_RESPONSABLE_ARL[sugerida]}.`;
  if (elegida !== '' && elegida !== sugerida) return `${base} Tu elección es diferente de la sugerencia de la modalidad.`;
  if (elegida === sugerida) return `${base} Tu elección coincide con la sugerencia.`;
  return `${base} La modalidad sugiere esta opción, pero confirma quién asume la ARL en esta práctica.`;
}

/** Cómo se ve el dato guardado de una práctica; las anteriores a este dato no lo tienen. */
export function etiquetaResponsableArl(valor: string | null | undefined): string {
  return valor === 'cun' || valor === 'empresa' ? ETIQUETA_RESPONSABLE_ARL[valor] : 'No informado';
}
