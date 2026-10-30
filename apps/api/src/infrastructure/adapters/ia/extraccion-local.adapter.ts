import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort,
} from '../../../domain/ports/out/lector-documento-local.port';
import { CampoExtraido, ExtraccionIaPort, ResultadoExtraccion } from '../../../domain/ports/out/servicios-externos.port';
import { CAMPOS_EPS } from '../../../domain/services/extraccion-eps-local.domain-service';
import { LecturaLocalEpsService } from '../../../domain/services/lectura-local-eps.domain-service';
import { CampoLeidoActa } from '../../../domain/entities/acta-iniciacion';
import { GEOMETRIA_DOCUMENTO, GeometriaDocumentoPort } from '../../../domain/ports/out/geometria-documento.port';
import { minimizarLecturaActa } from '../../../domain/services/validacion-acta.domain-service';
import { fechaDeActa } from '../../../domain/services/comparacion-acta.domain-service';
import { LecturaActaLocalAdapter } from '../lectura-local/lectura-acta-local.adapter';
import { ExtraccionSimuladaAdapter } from './extraccion.adapter';

/** Documento ajeno que se reconoce al leer un acta → tipo documental de SIPRA (si lo hay). */
const TIPO_DE_DOCUMENTO_AJENO: Readonly<Record<string, TipoDocumento>> = {
  certificado_eps: TipoDocumento.CERTIFICADO_EPS,
  cedula: TipoDocumento.CEDULA,
  carta_laboral: TipoDocumento.CERTIFICACION_LABORAL,
  certificado_arl: TipoDocumento.CERTIFICADO_ARL,
};

/**
 * Extractor LOCAL (puerto `EXTRACCION_LOCAL`). Para el certificado de EPS lee
 * texto nativo, QR y, solo si hace falta, OCR, todo dentro del proceso: ni el
 * documento ni su texto salen a ningún proveedor. No emite juicio de
 * autenticidad ni de afiliación: entrega lo que el certificado DICE, con la
 * fuente de cada dato.
 *
 * El acta de iniciación también se lee aquí, por su propio servicio de dominio
 * (`LecturaLocalActaService`): ni la regex del extractor determinístico ni ningún
 * proveedor externo deciden su contenido.
 *
 * Los demás tipos nunca llegan aquí (la política los manda al extractor
 * configurado); si llegaran, conservan el comportamiento determinístico anterior.
 */
@Injectable()
export class ExtraccionLocalAdapter implements ExtraccionIaPort {
  private readonly log = new Logger(ExtraccionLocalAdapter.name);
  private readonly servicio: LecturaLocalEpsService;
  private readonly actas: LecturaActaLocalAdapter;

  constructor(
    @Inject(LECTOR_DOCUMENTO_LOCAL) lector: LectorDocumentoLocalPort,
    private readonly respaldo: ExtraccionSimuladaAdapter,
    @Optional() actas?: LecturaActaLocalAdapter,
    @Optional() @Inject(GEOMETRIA_DOCUMENTO) geometria?: GeometriaDocumentoPort,
  ) {
    this.servicio = new LecturaLocalEpsService(lector);
    this.actas = actas ?? new LecturaActaLocalAdapter(lector, geometria);
  }

  async extraer(contenido: Buffer, mime: string, tipoEsperado: TipoDocumento): Promise<ResultadoExtraccion> {
    if (tipoEsperado === TipoDocumento.ACTA_INICIO) return this.extraerActa(contenido, mime);
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

  /**
   * Acta de iniciación: la lectura completa (clasificación, remuneración, ARL, firmas) vive en el dominio; aquí solo se
   * traduce a la forma que consume el pipeline. La comparación contra SIPRA no ocurre aquí: este puerto no conoce la práctica.
   */
  private async extraerActa(contenido: Buffer, mime: string): Promise<ResultadoExtraccion> {
    const lectura = await this.actas.leer(contenido, mime);
    const { clasificacion: c, campos: k, firmas } = lectura.analisis;
    // Solo conteos y códigos al registro: ni el texto del acta ni datos personales.
    this.log.debug(
      `Lectura local de acta: ${c.tipoActaDetectada}, método=${lectura.resumen.metodoLectura}, ` +
        `páginas OCR=${lectura.resumen.paginasOcr.length}, ${lectura.resumen.duracionMs} ms`,
    );
    const campo = (valor: string | null, origen: CampoLeidoActa): CampoExtraido => ({
      valor, confianza: valor === null ? 0 : origen.confianza, evidencia: null, fuente: origen.fuente,
    });
    const quienFirma = [
      firmas.firmaEmpresaPresente === 'si' ? 'empresa' : null,
      firmas.firmaPracticantePresente === 'si' ? 'practicante' : null,
    ].filter((x): x is string => x !== null).join(',');
    const campos: ResultadoExtraccion['campos'] = {
      modalidad: campo(k.modalidad_practica.valor, k.modalidad_practica),
      fecha_inicio: campo(fechaDeActa(k.fecha_inicio.valor), k.fecha_inicio),
      fecha_fin: campo(fechaDeActa(k.fecha_fin.valor), k.fecha_fin),
      funciones: campo(k.funciones.valor, k.funciones),
      nombre_responsable: campo(k.jefe_inmediato.valor, k.jefe_inmediato),
      firmas_presentes: { valor: quienFirma || null, confianza: quienFirma ? 0.7 : 0, evidencia: null, fuente: null },
    };
    return {
      tipoDetectado: c.tipoActaDetectada === 'iniciacion_practicas' ? TipoDocumento.ACTA_INICIO
        : c.tipoActaDetectada === 'documento_incorrecto' && c.documentoAjeno ? (TIPO_DE_DOCUMENTO_AJENO[c.documentoAjeno] ?? null) : null,
      campos,
      ilegible: lectura.ilegible,
      motivoIlegible: lectura.motivoIlegible,
      modelo: 'local-pdfjs-tesseract-acta',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
      proveedor: 'local',
      duracionMs: lectura.resumen.duracionMs,
      lecturaActa: minimizarLecturaActa(lectura),
    };
  }

}
