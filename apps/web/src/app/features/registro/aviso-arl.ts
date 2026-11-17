import { Rol } from '@core/models/modelos';

/**
 * G3 · Aviso institucional sobre la afiliación a ARL en el registro de la práctica (FUR).
 *
 * Es INFORMATIVO: no es un error, no bloquea, no es consentimiento ni deja evidencia. «Entendido» solo cierra.
 * No cambia ninguna regla de ARL (sugerencia por modalidad, responsable, compuerta): el backend sigue decidiendo.
 * El texto institucional se usa EXACTO.
 */
export const MENSAJE_ARL = 'La afiliación a ARL por parte de la CUN aplica únicamente para prácticas articuladas y entidades del tercer sector';
export const AYUDA_ARL = 'Revisa quién será responsable de tu afiliación antes de continuar con el registro de la práctica.';
export const TITULO_ARL = 'Información sobre tu ARL';

/**
 * Apertura automática: solo para el ESTUDIANTE, una única vez por instancia del formulario (estado de UI; sin
 * base de datos ni almacenamiento del navegador, para que un registro futuro vuelva a mostrarlo). Los perfiles
 * administrativos lo abren a mano, sin interrupciones.
 */
export class AperturaAvisoArl {
  private yaAbiertoAutomaticamente = false;

  constructor(private readonly rol: Rol | null) {}

  /** La persona llegó a la sección «¿Quién asume la ARL?». ¿Se abre el aviso solo? */
  alLlegarASeccion(): boolean {
    if (this.rol !== 'estudiante' || this.yaAbiertoAutomaticamente) return false;
    this.yaAbiertoAutomaticamente = true;
    return true;
  }
}
