import { EstadoDocumento, TipoDocumento } from '../entities/documento.entity';
import {
  ETAPAS_POR_MOMENTO, ETIQUETA_MOMENTO, ModalidadPractica, MomentoExpediente,
  definicionModalidad, documentosExigidos,
} from '../entities/modalidad.entity';

/**
 * Los dos indicadores del SGP: porcentaje de documentos cargados y porcentaje
 * de documentos aprobados. El manual del estudiante insiste en la diferencia:
 * un expediente puede estar 100 % cargado y 50 % aprobado, y eso significa que
 * hay documentos pendientes de revisión o de corrección. Aquí se calculan
 * sobre la matriz de la modalidad, momento por momento.
 */

export interface DocumentoParaAvance {
  tipo: TipoDocumento;
  version: number;
  estado: EstadoDocumento;
}

export interface DocumentoDelMomento {
  tipo: TipoDocumento;
  /** Estado de la última versión, o null si nunca se cargó. */
  estado: EstadoDocumento | null;
  version: number | null;
  aprobado: boolean;
}

export interface AvanceMomento {
  momento: MomentoExpediente;
  etiqueta: string;
  documentos: readonly DocumentoDelMomento[];
  exigidos: number;
  cargados: number;
  aprobados: number;
  completo: boolean;
}

export interface AvanceDocumental {
  exigidos: number;
  cargados: number;
  aprobados: number;
  porcentajeCargado: number;
  porcentajeAprobado: number;
  momentos: readonly AvanceMomento[];
  /** Tipos exigidos que aún no se han cargado o fueron devueltos. */
  pendientes: readonly TipoDocumento[];
  /** Primer momento con algo pendiente, o null si todo está aprobado. */
  momentoActual: MomentoExpediente | null;
}

const APROBADOS: readonly EstadoDocumento[] = [
  EstadoDocumento.APROBADO, EstadoDocumento.AUTO_APROBADO,
];

/** Estados que exigen acción del estudiante: no cuentan como «cargado». */
const REQUIEREN_REENVIO: readonly EstadoDocumento[] = [
  EstadoDocumento.DEVUELTO, EstadoDocumento.ILEGIBLE, EstadoDocumento.RECHAZADO,
];

export class AvanceDocumentalDomainService {
  calcular(modalidad: ModalidadPractica, documentos: readonly DocumentoParaAvance[]): AvanceDocumental {
    const ultima = new Map<TipoDocumento, DocumentoParaAvance>();
    for (const d of documentos) {
      const previa = ultima.get(d.tipo);
      if (!previa || d.version > previa.version) ultima.set(d.tipo, d);
    }

    const definicion = definicionModalidad(modalidad);
    const momentos: AvanceMomento[] = (
      [MomentoExpediente.INICIALES, MomentoExpediente.AVANCE, MomentoExpediente.CIERRE]
    ).map((momento) => {
      const tipos = ETAPAS_POR_MOMENTO[momento]
        .flatMap((etapa) => definicion.documentos[etapa] ?? []);
      const docs: DocumentoDelMomento[] = tipos.map((tipo) => {
        const d = ultima.get(tipo) ?? null;
        return {
          tipo,
          estado: d?.estado ?? null,
          version: d?.version ?? null,
          aprobado: d !== null && APROBADOS.includes(d.estado),
        };
      });
      const cargados = docs.filter((d) => d.estado !== null && !REQUIEREN_REENVIO.includes(d.estado)).length;
      const aprobados = docs.filter((d) => d.aprobado).length;
      return {
        momento, etiqueta: ETIQUETA_MOMENTO[momento], documentos: docs,
        exigidos: docs.length, cargados, aprobados, completo: aprobados === docs.length,
      };
    });

    const exigidos = documentosExigidos(modalidad).length;
    const cargados = momentos.reduce((n, m) => n + m.cargados, 0);
    const aprobados = momentos.reduce((n, m) => n + m.aprobados, 0);
    const pendientes = momentos.flatMap((m) => m.documentos.filter((d) => !d.aprobado).map((d) => d.tipo));

    return {
      exigidos, cargados, aprobados,
      porcentajeCargado: exigidos === 0 ? 100 : Math.round((100 * cargados) / exigidos),
      porcentajeAprobado: exigidos === 0 ? 100 : Math.round((100 * aprobados) / exigidos),
      momentos,
      pendientes,
      momentoActual: momentos.find((m) => !m.completo)?.momento ?? null,
    };
  }

  /** Condición documental de cierre del SGP: el 100 % aprobado. */
  listoParaCerrar(modalidad: ModalidadPractica, documentos: readonly DocumentoParaAvance[]): boolean {
    return this.calcular(modalidad, documentos).porcentajeAprobado === 100;
  }
}
