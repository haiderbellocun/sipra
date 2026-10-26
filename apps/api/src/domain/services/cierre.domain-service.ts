import { EstadoPractica, NOTA_MINIMA_APROBACION, Practica } from '../entities/practica.entity';

/**
 * Condiciones de cierre del SGP. El manual las enumera: el 100 % de los
 * documentos aprobados, el estudiante respondió «Evalúa tu proceso» y el
 * docente asignó la calificación. Cuando las tres se cumplen la práctica pasa
 * de «En práctica» a «Cerrado» (o a «Reprueba» si la nota no alcanza 3,0).
 */
export interface CondicionesCierre {
  porcentajeAprobado: number;
  evaluaTuProcesoRespondido: boolean;
  nota: number | null;
}

export interface EstadoCierre {
  documentosAprobados: boolean;
  evaluaTuProceso: boolean;
  calificacion: boolean;
  enPractica: boolean;
  puedeCerrar: boolean;
  /** Lo que falta, en el orden en que el SGP lo pide. */
  faltantes: readonly string[];
  /** Estado al que llegaría si cerrara ahora. */
  resultado: EstadoPractica.CERTIFICADA | EstadoPractica.REPROBADA | null;
}

const EN_PRACTICA: readonly EstadoPractica[] = [EstadoPractica.ACTIVA, EstadoPractica.FINALIZADA];

export class CierreDomainService {
  evaluar(practica: Practica, condiciones: CondicionesCierre): EstadoCierre {
    const documentosAprobados = condiciones.porcentajeAprobado >= 100;
    const evaluaTuProceso = condiciones.evaluaTuProcesoRespondido;
    const calificacion = condiciones.nota !== null;
    const enPractica = EN_PRACTICA.includes(practica.estado);

    const faltantes: string[] = [];
    if (!enPractica) faltantes.push('La práctica no está en curso');
    if (!documentosAprobados) {
      faltantes.push(`Documentos aprobados: ${condiciones.porcentajeAprobado} % de 100 %`);
    }
    if (!evaluaTuProceso) faltantes.push('El estudiante no ha respondido «Evalúa tu proceso»');
    if (!calificacion) faltantes.push('El docente no ha registrado la calificación');

    const puedeCerrar = faltantes.length === 0;
    return {
      documentosAprobados, evaluaTuProceso, calificacion, enPractica, puedeCerrar, faltantes,
      resultado: !calificacion ? null
        : (condiciones.nota as number) >= NOTA_MINIMA_APROBACION
          ? EstadoPractica.CERTIFICADA
          : EstadoPractica.REPROBADA,
    };
  }
}
