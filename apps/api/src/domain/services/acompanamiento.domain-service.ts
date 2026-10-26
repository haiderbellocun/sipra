import { EstadoDocumento } from '../entities/documento.entity';
import { EstadoPractica, Practica, SenalAcompanamiento } from '../entities/practica.entity';
import { EstadoObligacion, Obligacion } from '../entities/obligacion.entity';

export interface ContextoSenal {
  /** Reenvíos por tipo de documento: `{ certificado_arl: 3 }`. */
  reenviosPorTipo: Record<string, number>;
  estadosDocumentos: EstadoDocumento[];
  obligaciones: Obligacion[];
  /** Última respuesta de la empresa a una solicitud, si la hubo. */
  empresaRespondio: boolean;
  /** Cierre del periodo académico. */
  cierrePeriodo: Date | null;
}

export interface EvaluacionSenal {
  senal: SenalAcompanamiento;
  disparadores: string[];
}

/** Valores de fábrica. La Dirección los mueve desde M12 y quien llama los pasa. */
export const DIAS_SIN_ACTIVIDAD_ATENCION = 15;
export const DIAS_VENCIMIENTO_RIESGO = 10;

export interface UmbralesAcompanamiento {
  diasSinActividad: number;
  diasVencimientoRiesgo: number;
}

/**
 * M8 — Responde a la pregunta operativa del tutor, que no es *qué documento
 * falta* sino *a quién debo llamar hoy*.
 */
export class AcompanamientoDomainService {
  evaluar(
    practica: Practica,
    contexto: ContextoSenal,
    ahora: Date = new Date(),
    umbrales: UmbralesAcompanamiento = {
      diasSinActividad: DIAS_SIN_ACTIVIDAD_ATENCION,
      diasVencimientoRiesgo: DIAS_VENCIMIENTO_RIESGO,
    },
  ): EvaluacionSenal {
    const riesgo: string[] = [];
    const atencion: string[] = [];

    const datos = practica.instantanea();
    const diasSinActividad = Math.floor(
      (ahora.getTime() - datos.ultimaActividad.getTime()) / 86_400_000,
    );

    if (diasSinActividad >= umbrales.diasSinActividad) {
      atencion.push(`${diasSinActividad} días sin actividad`);
    }

    const maxReenvios = Math.max(0, ...Object.values(contexto.reenviosPorTipo));
    if (maxReenvios >= 3) {
      riesgo.push('tercer reenvío del mismo documento');
    } else if (maxReenvios === 2) {
      atencion.push('segundo reenvío del mismo documento');
    }

    const documentacionIncompleta = contexto.estadosDocumentos.some((e) =>
      [EstadoDocumento.DEVUELTO, EstadoDocumento.ILEGIBLE, EstadoDocumento.EN_REVISION].includes(e),
    );
    if (
      documentacionIncompleta &&
      datos.fechaInicio &&
      diasHasta(datos.fechaInicio, ahora) <= 15
    ) {
      atencion.push('documentación incompleta con inicio próximo');
    }

    if (!contexto.empresaRespondio && datos.empresaId) {
      riesgo.push('empresa sin responder');
    }

    const vencimientoProximo = contexto.obligaciones.some(
      (o) =>
        o.estado === EstadoObligacion.PENDIENTE &&
        o.diasRestantes(ahora) >= 0 &&
        o.diasRestantes(ahora) < umbrales.diasVencimientoRiesgo,
    );
    if (vencimientoProximo) {
      riesgo.push(`menos de ${umbrales.diasVencimientoRiesgo} días para un vencimiento`);
    }

    const obligacionVencida = contexto.obligaciones.some(
      (o) => o.estado === EstadoObligacion.VENCIDA,
    );
    if (obligacionVencida) riesgo.push('obligación vencida');

    if (
      practica.estado === EstadoPractica.ACTIVA &&
      contexto.estadosDocumentos.length === 0 &&
      contexto.cierrePeriodo &&
      ahora.getTime() >= contexto.cierrePeriodo.getTime()
    ) {
      riesgo.push('práctica activa sin ningún soporte al cierre del periodo');
    }

    if (riesgo.length > 0) {
      return { senal: SenalAcompanamiento.EN_RIESGO, disparadores: [...riesgo, ...atencion] };
    }
    if (atencion.length > 0) {
      return { senal: SenalAcompanamiento.REQUIERE_ATENCION, disparadores: atencion };
    }
    return { senal: SenalAcompanamiento.AL_DIA, disparadores: [] };
  }
}

function diasHasta(fecha: Date, ahora: Date): number {
  return Math.floor((fecha.getTime() - ahora.getTime()) / 86_400_000);
}
