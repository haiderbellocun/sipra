import { Inject, Injectable, Logger } from '@nestjs/common';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort,
} from '../../../domain/ports/out/lector-documento-local.port';
import { ExtraccionIaPort, ResultadoExtraccion } from '../../../domain/ports/out/servicios-externos.port';
import { CAMPOS_EPS } from '../../../domain/services/extraccion-eps-local.domain-service';
import { LecturaLocalEpsService } from '../../../domain/services/lectura-local-eps.domain-service';
import { ExtraccionSimuladaAdapter } from './extraccion.adapter';

/**
 * Extractor LOCAL (puerto `EXTRACCION_LOCAL`). Para el certificado de EPS lee
 * texto nativo, QR y, solo si hace falta, OCR, todo dentro del proceso: ni el
 * documento ni su texto salen a ningún proveedor. No emite juicio de
 * autenticidad ni de afiliación: entrega lo que el certificado DICE, con la
 * fuente de cada dato.
 *
 * Los demás tipos nunca llegan aquí (la política los manda al extractor
 * configurado); si llegaran, conservan el comportamiento determinístico anterior.
 */
@Injectable()
export class ExtraccionLocalAdapter implements ExtraccionIaPort {
  private readonly log = new Logger(ExtraccionLocalAdapter.name);
  private readonly servicio: LecturaLocalEpsService;

  constructor(
    @Inject(LECTOR_DOCUMENTO_LOCAL) lector: LectorDocumentoLocalPort,
    private readonly respaldo: ExtraccionSimuladaAdapter,
  ) {
    this.servicio = new LecturaLocalEpsService(lector);
  }

  async extraer(contenido: Buffer, mime: string, tipoEsperado: TipoDocumento): Promise<ResultadoExtraccion> {
    if (tipoEsperado !== TipoDocumento.CERTIFICADO_EPS) return this.respaldo.extraer(contenido, mime, tipoEsperado);

    const lectura = await this.servicio.leer(contenido, mime);
    const campos: ResultadoExtraccion['campos'] = {};
    for (const nombre of CAMPOS_EPS) {
      const c = lectura.campos[nombre];
      campos[nombre] = { valor: c.valor, confianza: c.confianza, evidencia: c.evidencia, fuente: c.fuente };
    }
    const conValor = Object.values(campos).filter((c) => c.valor !== null).length;
    // Solo conteos: ni el contenido del certificado ni datos personales llegan al registro.
    this.log.debug(
      `Lectura local EPS: ${conValor}/${CAMPOS_EPS.length} campos, ocr=${lectura.resumen.ocr.ejecutado}, ` +
        `qr=${lectura.resumen.qr.hallazgos.length}, ${lectura.resumen.duracionMs} ms`,
    );
    return {
      // Nombrar una EPS no basta para decir que es un certificado de EPS (una EPS también emite cartas laborales).
      tipoDetectado: campos.entidad_emisora.valor && lectura.resumen.clasificacion?.tipo !== 'documento_incorrecto' ? TipoDocumento.CERTIFICADO_EPS : null,
      campos,
      ilegible: lectura.ilegible,
      motivoIlegible: lectura.motivoIlegible,
      modelo: 'local-pdfjs-zxing-tesseract',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
      proveedor: 'local',
      duracionMs: lectura.resumen.duracionMs,
      lecturaLocal: lectura.resumen,
    };
  }
}
