import {
  DatosObligacion,
  EstadoObligacion,
  Obligacion,
  TipoObligacion,
} from '../entities/obligacion.entity';
import { ModalidadPractica, Practica } from '../entities/practica.entity';

export interface PlantillaObligacion {
  tipo: TipoObligacion;
  fechaLimite: Date;
}

/**
 * M5 — Motor de obligaciones. El sistema las crea automáticamente al abrirse
 * una práctica; no dependen de que alguien cargue un documento.
 */
export class ObligacionesDomainService {
  /** Obligaciones que nacen con la práctica. */
  plantillasPara(practica: Practica, ahora: Date = new Date()): PlantillaObligacion[] {
    const plantillas: PlantillaObligacion[] = [
      { tipo: TipoObligacion.AUTORIZACION_TRATAMIENTO, fechaLimite: ahora },
    ];

    if ([ModalidadPractica.VALIDACION_EXPERIENCIA,
         ModalidadPractica.COMBINACION_FUNCIONES].includes(practica.modalidad)) {
      return plantillas;
    }

    const inicio = practica.fechaInicio;
    if (inicio) {
      // Decreto 055 de 2015: la afiliación vence el día ANTERIOR al inicio.
      const limiteArl = new Date(inicio);
      limiteArl.setUTCDate(limiteArl.getUTCDate() - 1);
      plantillas.push({ tipo: TipoObligacion.AFILIACION_ARL, fechaLimite: limiteArl });
      plantillas.push({ tipo: TipoObligacion.REPORTE_PLAZA_PRACTICA, fechaLimite: inicio });
    }

    const fin = practica.instantanea().fechaFin;
    if (fin) {
      // Ley 2043 de 2020: 30 días tras finalizar.
      const limiteCert = new Date(fin);
      limiteCert.setUTCDate(limiteCert.getUTCDate() + 30);
      plantillas.push({ tipo: TipoObligacion.CERTIFICACION_PRACTICA, fechaLimite: limiteCert });
    }

    return plantillas;
  }

  /** Barrido del proceso programado: marca vencidas las que pasaron su límite. */
  evaluarVencimientos(obligaciones: Obligacion[], ahora: Date = new Date()): Obligacion[] {
    return obligaciones.filter((o) => o.evaluarVencimiento(ahora));
  }

  /** Obligaciones que bloquean la activación de la práctica. */
  bloqueosParaActivar(obligaciones: Obligacion[]): Obligacion[] {
    return obligaciones.filter(
      (o) =>
        o.tipo === TipoObligacion.AFILIACION_ARL &&
        o.estado !== EstadoObligacion.CUMPLIDA,
    );
  }

  resumenTablero(
    obligaciones: Obligacion[],
    ahora: Date = new Date(),
  ): Record<'cumplida' | 'vencida' | 'critica' | 'alerta' | 'vigente', number> {
    const resumen = { cumplida: 0, vencida: 0, critica: 0, alerta: 0, vigente: 0 };
    for (const o of obligaciones) resumen[o.semaforo(ahora)] += 1;
    return resumen;
  }

  static nuevaObligacion(
    id: string,
    practicaId: string,
    plantilla: PlantillaObligacion,
    ahora: Date = new Date(),
  ): DatosObligacion {
    return {
      id,
      practicaId,
      tipo: plantilla.tipo,
      estado: EstadoObligacion.PENDIENTE,
      fechaLimite: plantilla.fechaLimite,
      cumplidaEn: null,
      evidenciaDocumentoId: null,
      observacion: null,
      creadaEn: ahora,
      actualizadaEn: ahora,
    };
  }
}
