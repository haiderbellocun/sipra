/**
 * «¿Quién asume la ARL?» en el registro de la práctica (FUR).
 *
 * Es un dato EXPLÍCITO de la práctica: lo confirma quien registra. La modalidad solo SUGIERE un valor, que aparece ya
 * marcado en el formulario (nunca se guarda sin que se vea) y que la persona puede cambiar. Si la modalidad depende del
 * convenio con la organización («según cobertura»), no hay sugerencia y hay que elegir. El acta de iniciación luego
 * confirma o contradice este dato; nunca lo establece.
 */
export type ResponsableArl = 'empresa' | 'cun';
export type ResponsableArlFormulario = ResponsableArl | '';

export const ETIQUETA_RESPONSABLE_ARL: Readonly<Record<ResponsableArl, string>> = { empresa: 'Empresa', cun: 'CUN' };

/** El catálogo dice `cun`, `empresa` o `segun_cobertura` (este último no se resuelve por modalidad). */
export function sugerenciaArl(responsableArlDelCatalogo: string | null | undefined): ResponsableArl | null {
  return responsableArlDelCatalogo === 'cun' || responsableArlDelCatalogo === 'empresa' ? responsableArlDelCatalogo : null;
}

/**
 * Valor del formulario al cambiar de modalidad. Si la persona ya eligió, se respeta su elección; si no, se muestra
 * marcada la sugerencia de la modalidad (o nada, si no hay).
 */
export function valorArlAlElegirModalidad(
  actual: ResponsableArlFormulario, elegidaPorLaPersona: boolean, sugerida: ResponsableArl | null,
): ResponsableArlFormulario {
  return elegidaPorLaPersona ? actual : (sugerida ?? '');
}

/** Ayuda bajo el control, en lenguaje de quien registra. Sin códigos técnicos. */
export function ayudaArl(
  hayModalidad: boolean, sugerida: ResponsableArl | null, elegida: ResponsableArlFormulario,
): string {
  if (!hayModalidad) {
    return 'Elija la modalidad y le mostramos la sugerencia. Usted confirma quién afilia al estudiante a la ARL.';
  }
  if (sugerida === null) {
    return 'En esta modalidad depende del convenio con la organización: indique quién asume la ARL según lo acordado.';
  }
  if (elegida !== '' && elegida !== sugerida) {
    return `La modalidad sugiere: ${ETIQUETA_RESPONSABLE_ARL[sugerida]}. Usted indicó otra opción; se guarda lo que usted elija.`;
  }
  return `Sugerido por la modalidad: ${ETIQUETA_RESPONSABLE_ARL[sugerida]}. Confírmelo o cámbielo si lo acordado es distinto.`;
}

/** Cómo se ve el dato guardado de una práctica; las anteriores a este dato no lo tienen. */
export function etiquetaResponsableArl(valor: string | null | undefined): string {
  return valor === 'cun' || valor === 'empresa' ? ETIQUETA_RESPONSABLE_ARL[valor] : 'No informado';
}
