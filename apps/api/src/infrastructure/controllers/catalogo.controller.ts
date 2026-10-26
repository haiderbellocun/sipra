import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PqrsUseCase } from '../../application/use-cases/administracion/pqrs.use-case';
import { PREGUNTAS_EVALUA_TU_PROCESO } from '../../domain/entities/bitacora.entity';
import { CRITERIOS_DOCUMENTALES, REGLAS_GENERALES_CARGUE } from '../../domain/entities/criterios-documentales';
import { TipoDocumento } from '../../domain/entities/documento.entity';
import {
  ETAPAS_POR_MOMENTO, ETIQUETA_MOMENTO, MATRIZ_MODALIDADES, MomentoExpediente,
} from '../../domain/entities/modalidad.entity';
import { EQUIVALENCIA_SGP, EstadoPractica } from '../../domain/entities/practica.entity';
import { CategoriaAyuda, PreguntaFrecuente } from '../../domain/entities/preguntas-frecuentes';
import { CATEGORIAS_PQRS } from '../../domain/entities/pqrs.entity';
import { Autenticado } from '../auth/roles.decorator';
import {
  ETIQUETA_MOTIVO_RECHAZO, MotivoRechazoArl, aplicaSolicitudArl, documentosExigidosArl,
} from '../../domain/entities/solicitud-arl.entity';

export interface ModalidadCatalogo {
  modalidad: string;
  etiqueta: string;
  etiquetaSgp: string;
  descripcion: string;
  articulada: boolean;
  responsableArl: string;
  solicitudArl: 'si' | 'no' | 'segun_cobertura';
  documentosPorMomento: { momento: MomentoExpediente; etiqueta: string; documentos: TipoDocumento[] }[];
  documentosArl: TipoDocumento[];
  duracionMesesMinima: number | null;
  duracionMesesMaxima: number | null;
  fechasDentroDelPeriodo: boolean;
  condicionesAdicionales: string[];
}

/**
 * Catálogos del proceso, tal como los define el dominio. El frontend no
 * duplica la matriz de modalidades ni los criterios: los consulta aquí.
 */
@ApiTags('Catálogo del proceso')
@ApiBearerAuth()
@Autenticado()
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly ayuda: PqrsUseCase) {}

  @Get('modalidades')
  @ApiOperation({ summary: 'Matriz de modalidades con documentos por momento y condiciones' })
  modalidades(): ModalidadCatalogo[] {
    return MATRIZ_MODALIDADES.map((d) => ({
      modalidad: d.modalidad,
      etiqueta: d.etiqueta,
      etiquetaSgp: d.etiquetaSgp,
      descripcion: d.descripcion,
      articulada: d.articulada,
      responsableArl: d.responsableArlPorDefecto,
      solicitudArl: aplicaSolicitudArl(d.modalidad),
      documentosPorMomento: ([MomentoExpediente.INICIALES, MomentoExpediente.AVANCE, MomentoExpediente.CIERRE]).map((momento) => ({
        momento, etiqueta: ETIQUETA_MOMENTO[momento],
        documentos: ETAPAS_POR_MOMENTO[momento].flatMap((etapa) => [...(d.documentos[etapa] ?? [])]),
      })),
      documentosArl: [...documentosExigidosArl(d.modalidad)],
      duracionMesesMinima: d.duracionMesesMinima,
      duracionMesesMaxima: d.duracionMesesMaxima,
      fechasDentroDelPeriodo: d.fechasDentroDelPeriodo,
      condicionesAdicionales: [...d.condicionesAdicionales],
    }));
  }

  @Get('documentos')
  @ApiOperation({ summary: 'Criterios de revisión por tipo documental y reglas generales de cargue' })
  documentos(): { reglasGenerales: readonly string[]; criterios: typeof CRITERIOS_DOCUMENTALES } {
    return { reglasGenerales: REGLAS_GENERALES_CARGUE, criterios: CRITERIOS_DOCUMENTALES };
  }

  @Get('proceso')
  @ApiOperation({ summary: 'Estados del SGP, motivos de rechazo de ARL y preguntas de «Evalúa tu proceso»' })
  proceso(): {
    estadosSgp: Record<EstadoPractica, string>;
    motivosRechazoArl: { codigo: MotivoRechazoArl; etiqueta: string }[];
    preguntasEvaluaTuProceso: readonly string[];
  } {
    return {
      estadosSgp: EQUIVALENCIA_SGP,
      motivosRechazoArl: Object.values(MotivoRechazoArl).map((codigo) => ({ codigo, etiqueta: ETIQUETA_MOTIVO_RECHAZO[codigo] })),
      preguntasEvaluaTuProceso: PREGUNTAS_EVALUA_TU_PROCESO,
    };
  }

  @Get('categorias-ayuda')
  @ApiOperation({ summary: 'Categorías del centro de ayuda y de las PQRS, con las pantallas donde aplican' })
  categoriasAyuda(): readonly CategoriaAyuda[] {
    return this.ayuda.categorias();
  }

  @Get('preguntas')
  @ApiOperation({ summary: 'Preguntas frecuentes de Desarrollo Profesional (búsqueda por texto y categoría)' })
  @ApiQuery({ name: 'texto', required: false })
  @ApiQuery({ name: 'categoria', required: false, enum: CATEGORIAS_PQRS })
  preguntas(@Query('texto') texto?: string, @Query('categoria') categoria?: string): PreguntaFrecuente[] {
    return this.ayuda.buscar(texto, categoria);
  }
}
