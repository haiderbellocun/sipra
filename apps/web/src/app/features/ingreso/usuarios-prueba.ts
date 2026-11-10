import { ModoAutenticacion } from '@core/models/modelos';

/** Subconjunto del entorno del cliente que decide la visibilidad (ver `src/environments`). */
export interface EntornoCliente {
  produccion: boolean;
  ambiente: string;
}

/** Ambientes que nunca pueden ofrecer ingreso sin contraseña, vengan de donde vengan. */
const AMBIENTES_PROTEGIDOS = new Set(['pre', 'preproduccion', 'prod', 'produccion']);

const esProtegido = (ambiente: string | null | undefined): boolean =>
  AMBIENTES_PROTEGIDOS.has((ambiente ?? '').trim().toLowerCase());

/**
 * ¿Se muestra el bloque «Usuarios de prueba»?
 *
 * Solo si el SERVIDOR habilita el selector de perfil Y el cliente no es de producción
 * ni de preproducción. Es una defensa adicional: el servidor sigue siendo la fuente de
 * verdad (la validación de configuración ya rechaza `AUTH_MODO=abierto` fuera de dev).
 */
export function debeMostrarUsuariosDePrueba(
  modo: Pick<ModoAutenticacion, 'permiteSelectorDePerfil' | 'ambiente'> & Partial<ModoAutenticacion> | null | undefined,
  entorno: EntornoCliente,
): boolean {
  if (!modo || modo.permiteSelectorDePerfil !== true) return false;
  if (entorno.produccion) return false;
  if (esProtegido(entorno.ambiente) || esProtegido(modo.ambiente)) return false;
  return true;
}
