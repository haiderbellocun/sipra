import { TipoDocumento } from '../entities/documento.entity';
import {
  DefinicionModalidad, EtapaExpediente, ModalidadPractica, ORDEN_ETAPAS, ResponsableArl,
  definicionModalidad,
} from '../entities/modalidad.entity';

/**
 * Qué se le puede exigir a un expediente y en qué momento.
 *
 * El diseño funcional advierte de una trampa concreta: pedir en la postulación
 * un acta de la empresa que aún no se ha elegido, o el certificado de ARL de una
 * colocación que todavía no existe. El estudiante queda bloqueado y ninguna
 * pantalla sabe explicar por qué. Este servicio existe para que eso no pueda
 * ocurrir: los requisitos se resuelven por etapa y cada etapa solo exige lo que
 * a esa altura del proceso puede existir.
 */

export interface DocumentoAprobado {
  tipo: TipoDocumento;
}

export interface RequisitosDeEtapa {
  etapa: EtapaExpediente;
  exigidos: readonly TipoDocumento[];
  /** Aprobados hasta ahora, de esta etapa y de las anteriores. */
  cumplidos: readonly TipoDocumento[];
  faltantes: readonly TipoDocumento[];
  completa: boolean;
}

export interface EstadoExpediente {
  modalidad: ModalidadPractica;
  etapaActual: EtapaExpediente;
  etapas: readonly RequisitosDeEtapa[];
  responsableArl: ResponsableArl;
  /** La matriz de esta modalidad aún no está ratificada por Operaciones. */
  requiereRatificacion: boolean;
  condicionesAdicionales: readonly string[];
}

export class DuracionFueraDeRangoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'DuracionFueraDeRangoError';
  }
}

export class RequisitosDomainService {
  /** Documentos exigidos en una etapa concreta, sin arrastrar las anteriores. */
  exigidosEn(modalidad: ModalidadPractica, etapa: EtapaExpediente): readonly TipoDocumento[] {
    return definicionModalidad(modalidad).documentos[etapa] ?? [];
  }

  /** Todo lo exigible hasta esa etapa, inclusive. */
  exigidosHasta(modalidad: ModalidadPractica, etapa: EtapaExpediente): readonly TipoDocumento[] {
    const hasta = ORDEN_ETAPAS.indexOf(etapa);
    const acumulado = new Set<TipoDocumento>();
    for (const e of ORDEN_ETAPAS.slice(0, hasta + 1)) {
      for (const t of this.exigidosEn(modalidad, e)) acumulado.add(t);
    }
    return [...acumulado];
  }

  /**
   * Lo que falta para poder avanzar a una etapa. Se evalúa contra lo exigible
   * hasta la etapa ANTERIOR: entrar a formalizar no puede exigir lo que solo
   * se produce al formalizar.
   */
  faltantesParaEntrarA(
    modalidad: ModalidadPractica,
    etapa: EtapaExpediente,
    aprobados: readonly DocumentoAprobado[],
  ): readonly TipoDocumento[] {
    const indice = ORDEN_ETAPAS.indexOf(etapa);
    if (indice <= 0) return [];
    const previos = this.exigidosHasta(modalidad, ORDEN_ETAPAS[indice - 1]);
    const tiene = new Set(aprobados.map((d) => d.tipo));
    return previos.filter((t) => !tiene.has(t));
  }

  puedeEntrarA(
    modalidad: ModalidadPractica,
    etapa: EtapaExpediente,
    aprobados: readonly DocumentoAprobado[],
  ): boolean {
    return this.faltantesParaEntrarA(modalidad, etapa, aprobados).length === 0;
  }

  /**
   * Retrato completo del expediente: qué exige cada etapa, qué hay y qué falta.
   * Es lo que el estudiante necesita ver para saber por qué no puede avanzar.
   */
  estado(
    modalidad: ModalidadPractica,
    aprobados: readonly DocumentoAprobado[],
    coberturaPactada: ResponsableArl | null = null,
  ): EstadoExpediente {
    const d = definicionModalidad(modalidad);
    const tiene = new Set(aprobados.map((x) => x.tipo));

    const etapas = ORDEN_ETAPAS.map((etapa) => {
      const exigidos = this.exigidosEn(modalidad, etapa);
      const cumplidos = exigidos.filter((t) => tiene.has(t));
      const faltantes = exigidos.filter((t) => !tiene.has(t));
      return { etapa, exigidos, cumplidos, faltantes, completa: faltantes.length === 0 };
    });

    const etapaActual =
      etapas.find((e) => !e.completa)?.etapa ?? ORDEN_ETAPAS[ORDEN_ETAPAS.length - 1];

    return {
      modalidad,
      etapaActual,
      etapas,
      responsableArl: this.responsableArl(d, coberturaPactada),
      requiereRatificacion: d.matrizPendienteDeRatificar,
      condicionesAdicionales: d.condicionesAdicionales,
    };
  }

  /**
   * Quién afilia a riesgos laborales.
   *
   * La cobertura pactada con una organización manda sobre el valor por defecto
   * de la modalidad, pero solo cuando existe un convenio registrado y vigente.
   * Nunca se deduce del nombre de la empresa: dos organizaciones distintas
   * pueden llamarse parecido, y una coincidencia de texto no es un acuerdo.
   */
  responsableArl(
    definicion: DefinicionModalidad,
    coberturaPactada: ResponsableArl | null,
  ): ResponsableArl {
    if (coberturaPactada) return coberturaPactada;
    return definicion.responsableArlPorDefecto;
  }

  /**
   * Comprueba la duración contra los límites de la fuente funcional. Devuelve
   * el motivo en vez de un booleano: quien recibe el rechazo necesita saber
   * cuál es el límite, no solo que lo incumplió.
   */
  verificarDuracion(modalidad: ModalidadPractica, inicio: Date, fin: Date): void {
    const d = definicionModalidad(modalidad);
    const meses =
      (fin.getFullYear() - inicio.getFullYear()) * 12 +
      (fin.getMonth() - inicio.getMonth()) +
      (fin.getDate() >= inicio.getDate() ? 0 : -1);

    if (d.duracionMesesMinima !== null && meses < d.duracionMesesMinima) {
      throw new DuracionFueraDeRangoError(
        `${d.etiqueta} requiere al menos ${d.duracionMesesMinima} mes(es); se registraron ${meses}`,
      );
    }
    if (d.duracionMesesMaxima !== null && meses > d.duracionMesesMaxima) {
      throw new DuracionFueraDeRangoError(
        `${d.etiqueta} admite hasta ${d.duracionMesesMaxima} mes(es); se registraron ${meses}`,
      );
    }
  }
}
