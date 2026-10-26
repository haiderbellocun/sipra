import { TipoDocumento } from '../entities/documento.entity';
import {
  MATRIZ_MODALIDADES, ModalidadPractica, documentosExigidos,
} from '../entities/modalidad.entity';
import {
  MODELO_OPENAI_PREDETERMINADO, TARIFAS_IA, TarifaModelo, costoDe, tarifaDe, tokensImagen,
} from '../entities/tarifas-ia';
import { ConocimientoDocumentalDomainService } from './conocimiento-documental.domain-service';
import { tokensEsquemaAproximados } from './esquema-lectura';

/**
 * Estimador de costo de la lectura automática por estudiante.
 *
 * No adivina: aplica la matriz documental de cada modalidad (qué documentos
 * exige), un número de páginas típico por tipo, la regla de tokens por imagen
 * que publica el proveedor y la tarifa vigente. Todos los supuestos se
 * devuelven junto con el resultado, para que quien lea la cifra sepa de dónde
 * sale y pueda recalibrarla con el gasto real de las primeras lecturas.
 */

/** Páginas típicas por tipo documental (estimación institucional, conservadora). */
export const PAGINAS_TIPICAS: Readonly<Partial<Record<TipoDocumento, number>>> = {
  [TipoDocumento.CEDULA]: 1,
  [TipoDocumento.CERTIFICADO_EPS]: 1,
  [TipoDocumento.CERTIFICADO_ARL]: 1,
  [TipoDocumento.ACTA_INICIO]: 2,
  [TipoDocumento.RUT_NATURAL]: 2,
  [TipoDocumento.RUT_JURIDICO]: 2,
  [TipoDocumento.CAMARA_COMERCIO]: 4,
  [TipoDocumento.SOPORTE_RELACION_LABORAL]: 3,
  [TipoDocumento.AUTORIZACION_FUNCIONES]: 1,
  [TipoDocumento.CARTA_ACEPTACION]: 1,
  [TipoDocumento.CONVENIO_PRACTICA]: 6,
  [TipoDocumento.PLANILLA_HORAS]: 2,
  [TipoDocumento.PLAN_MEJORAMIENTO]: 6,
  [TipoDocumento.CERTIFICADO_EXISTENCIA]: 4,
  [TipoDocumento.CERTIFICACION_LABORAL]: 1,
  [TipoDocumento.PLANILLA_APORTES]: 2,
  [TipoDocumento.CERTIFICADO_PRACTICA]: 1,
  [TipoDocumento.CONTRATO_APRENDIZAJE]: 4,
  [TipoDocumento.CERTIFICADO_LABORAL_FUNCIONES]: 1,
  [TipoDocumento.CONTRATO_LABORAL]: 5,
  [TipoDocumento.FORMATO_SEGUIMIENTO_FINAL]: 3,
  [TipoDocumento.CARTA_FINALIZACION]: 1,
  [TipoDocumento.AVANCE_PLAN_MEJORAMIENTO]: 4,
  [TipoDocumento.PROPUESTA_ARTICULO]: 6,
  [TipoDocumento.CONSTANCIA_PUBLICACION]: 1,
  [TipoDocumento.SOPORTE_ACEPTACION_CUNBRE]: 1,
  [TipoDocumento.EVALUACION_FINAL_CUNBRE]: 3,
  [TipoDocumento.INFORME_1]: 8,
  [TipoDocumento.INFORME_2]: 8,
  [TipoDocumento.INFORME_FINAL]: 12,
  [TipoDocumento.REPORTE_SEMILLEROS]: 8,
  [TipoDocumento.ARTICULO_CIENTIFICO]: 12,
  [TipoDocumento.CORREO_APROBACION_INTERNACIONAL]: 1,
  [TipoDocumento.SEGURO_MEDICO_INTERNACIONAL]: 2,
};

export interface SupuestosEstimacion {
  /** Página carta escaneada a 200 ppp. */
  anchoPaginaPx: number;
  altoPaginaPx: number;
  /** Tokens de la capa de texto por página (0 en un escaneo puro; ~700 en un PDF nativo denso). */
  tokensTextoPorPagina: number;
  /** Tokens del JSON de respuesta. */
  tokensRespuesta: number;
  /** Tokens de razonamiento con esfuerzo bajo (solo modelos razonadores). */
  tokensRazonamiento: number;
  /** Lecturas adicionales por documento devuelto, ilegible o reintentado tras preproceso. */
  factorReenvios: number;
  /** Mensaje de usuario que acompaña al archivo en cada petición. */
  tokensMensajeUsuario: number;
}

export const SUPUESTOS_PREDETERMINADOS: SupuestosEstimacion = {
  anchoPaginaPx: 1700,
  altoPaginaPx: 2200,
  tokensTextoPorPagina: 500,
  tokensRespuesta: 400,
  tokensRazonamiento: 300,
  factorReenvios: 1.25,
  tokensMensajeUsuario: 40,
};

export interface EstimacionDocumento {
  tipo: TipoDocumento;
  nombre: string;
  paginas: number;
  /** Desglose de la entrada: instrucción institucional, esquema JSON y páginas. */
  tokensInstruccion: number;
  tokensEsquema: number;
  tokensPaginas: number;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
}

export interface EstimacionModalidad {
  modalidad: ModalidadPractica;
  etiqueta: string;
  articulada: boolean;
  documentos: EstimacionDocumento[];
  totalDocumentos: number;
  totalPaginas: number;
  tokensEntrada: number;
  tokensSalida: number;
  /** Una sola lectura por documento. */
  costoUsd: number;
  /** Con el factor de reenvíos: la cifra que conviene presupuestar. */
  costoConReenviosUsd: number;
}

export interface EstimacionPorEstudiante {
  modelo: string;
  tarifa: TarifaModelo;
  tarifaExacta: boolean;
  supuestos: SupuestosEstimacion;
  tokensImagenPorPagina: number;
  modalidades: EstimacionModalidad[];
  /** Promedio simple entre modalidades, con reenvíos. */
  promedioEstudianteUsd: number;
  minimoEstudianteUsd: number;
  maximoEstudianteUsd: number;
  porMilEstudiantesUsd: number;
}

export interface ComparativaModelo {
  modelo: string;
  familia: string;
  recomendacion: TarifaModelo['recomendacion'];
  retiro: string | null;
  entradaUsdPorMillon: number;
  salidaUsdPorMillon: number;
  costoPorPaginaUsd: number;
  promedioEstudianteUsd: number;
  minimoEstudianteUsd: number;
  maximoEstudianteUsd: number;
  porMilEstudiantesUsd: number;
}

export class CostosIaDomainService {
  private readonly conocimiento = new ConocimientoDocumentalDomainService();

  paginasDe(tipo: TipoDocumento): number {
    return PAGINAS_TIPICAS[tipo] ?? 2;
  }

  /** Costo de leer un documento de ese tipo, con ese modelo. */
  estimarDocumento(
    tipo: TipoDocumento,
    tarifa: TarifaModelo,
    supuestos: SupuestosEstimacion = SUPUESTOS_PREDETERMINADOS,
  ): EstimacionDocumento {
    const paginas = this.paginasDe(tipo);
    const porPagina = tokensImagen(tarifa, supuestos.anchoPaginaPx, supuestos.altoPaginaPx)
      + supuestos.tokensTextoPorPagina;
    const tokensInstruccion = this.conocimiento.tokensInstruccionAproximados(tipo);
    const tokensEsquema = tokensEsquemaAproximados(tipo, this.conocimiento.criteriosEvaluables(tipo).map((c) => c.codigo));
    const tokensPaginas = paginas * porPagina;
    const tokensEntrada = tokensInstruccion + tokensEsquema + supuestos.tokensMensajeUsuario + tokensPaginas;
    const tokensSalida = supuestos.tokensRespuesta + (tarifa.razonador ? supuestos.tokensRazonamiento : 0);
    return {
      tipo,
      nombre: this.conocimiento.nombreDe(tipo),
      paginas,
      tokensInstruccion,
      tokensEsquema,
      tokensPaginas,
      tokensEntrada,
      tokensSalida,
      costoUsd: costoDe(tarifa, { entrada: tokensEntrada, salida: tokensSalida }),
    };
  }

  estimarModalidad(
    modalidad: ModalidadPractica,
    tarifa: TarifaModelo,
    supuestos: SupuestosEstimacion = SUPUESTOS_PREDETERMINADOS,
  ): EstimacionModalidad {
    const definicion = MATRIZ_MODALIDADES.find((d) => d.modalidad === modalidad);
    const documentos = documentosExigidos(modalidad).map((t) => this.estimarDocumento(t, tarifa, supuestos));
    const costoExacto = documentos.reduce((s, d) => s + d.costoUsd, 0);
    const costoUsd = redondear(costoExacto);
    return {
      modalidad,
      etiqueta: definicion?.etiqueta ?? modalidad,
      articulada: definicion?.articulada ?? false,
      documentos,
      totalDocumentos: documentos.length,
      totalPaginas: documentos.reduce((s, d) => s + d.paginas, 0),
      tokensEntrada: documentos.reduce((s, d) => s + d.tokensEntrada, 0),
      tokensSalida: documentos.reduce((s, d) => s + d.tokensSalida, 0),
      costoUsd,
      costoConReenviosUsd: redondear(costoExacto * supuestos.factorReenvios),
    };
  }

  /** Estimación completa para un modelo: todas las modalidades de la matriz. */
  estimarPorEstudiante(
    modelo: string = MODELO_OPENAI_PREDETERMINADO,
    supuestos: SupuestosEstimacion = SUPUESTOS_PREDETERMINADOS,
  ): EstimacionPorEstudiante | null {
    const resuelta = tarifaDe(modelo);
    if (!resuelta) return null;
    const { tarifa, exacta } = resuelta;
    const modalidades = MATRIZ_MODALIDADES.map((d) => this.estimarModalidad(d.modalidad, tarifa, supuestos));
    const costos = modalidades.map((m) => m.costoConReenviosUsd);
    const promedio = redondear(costos.reduce((s, c) => s + c, 0) / Math.max(1, costos.length));
    return {
      modelo,
      tarifa,
      tarifaExacta: exacta,
      supuestos,
      tokensImagenPorPagina: tokensImagen(tarifa, supuestos.anchoPaginaPx, supuestos.altoPaginaPx),
      modalidades,
      promedioEstudianteUsd: promedio,
      minimoEstudianteUsd: Math.min(...costos),
      maximoEstudianteUsd: Math.max(...costos),
      porMilEstudiantesUsd: redondear(promedio * 1000, 2),
    };
  }

  /** La misma estimación para cada modelo de la tabla, para comparar de un vistazo. */
  comparativa(supuestos: SupuestosEstimacion = SUPUESTOS_PREDETERMINADOS): ComparativaModelo[] {
    return TARIFAS_IA
      .filter((t) => t.proveedor === 'openai')
      .map((t) => {
        const estimacion = this.estimarPorEstudiante(t.id, supuestos);
        const porPagina = tokensImagen(t, supuestos.anchoPaginaPx, supuestos.altoPaginaPx)
          + supuestos.tokensTextoPorPagina;
        return {
          modelo: t.id,
          familia: t.familia,
          recomendacion: t.recomendacion,
          retiro: t.retiro,
          entradaUsdPorMillon: t.entradaUsdPorMillon,
          salidaUsdPorMillon: t.salidaUsdPorMillon,
          costoPorPaginaUsd: costoDe(t, { entrada: porPagina, salida: 0 }),
          promedioEstudianteUsd: estimacion?.promedioEstudianteUsd ?? 0,
          minimoEstudianteUsd: estimacion?.minimoEstudianteUsd ?? 0,
          maximoEstudianteUsd: estimacion?.maximoEstudianteUsd ?? 0,
          porMilEstudiantesUsd: estimacion?.porMilEstudiantesUsd ?? 0,
        };
      })
      // Del más barato al más caro, pero los modelos con retiro anunciado o no
      // recomendados van al final: un precio bajo de un modelo que se apaga en
      // dos meses no es una opción, es una trampa.
      .sort((a, b) => {
        const grupoA = a.recomendacion === 'no_recomendado' || a.retiro ? 1 : 0;
        const grupoB = b.recomendacion === 'no_recomendado' || b.retiro ? 1 : 0;
        return grupoA - grupoB || a.promedioEstudianteUsd - b.promedioEstudianteUsd;
      });
  }
}

function redondear(valor: number, decimales = 6): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}
