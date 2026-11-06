import { Inject, Injectable } from '@nestjs/common';
import { GEOMETRIA_DOCUMENTO, GeometriaDocumentoPort } from '../../../domain/ports/out/geometria-documento.port';
import { LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort } from '../../../domain/ports/out/lector-documento-local.port';
import { LecturaCamaraPort } from '../../../domain/ports/out/lectura-camara.port';
import {
  LIMITES_LECTURA_CAMARA, LecturaLocalCamara, LecturaLocalCamaraService, OpcionesLecturaCamara,
} from '../../../domain/services/lectura-local-camara.domain-service';

/**
 * Lectura local del certificado de Cámara (PDF o imagen → texto nativo / OCR → `interpretarCamara`), lista para inyectar.
 * Solo cablea los puertos al servicio de dominio; no decide nada. 100 % local: sin proveedores externos.
 */
@Injectable()
export class LecturaCamaraLocalAdapter implements LecturaCamaraPort {
  private readonly servicio: LecturaLocalCamaraService;

  constructor(
    @Inject(LECTOR_DOCUMENTO_LOCAL) lector: LectorDocumentoLocalPort,
    @Inject(GEOMETRIA_DOCUMENTO) geometria: GeometriaDocumentoPort,
  ) {
    this.servicio = new LecturaLocalCamaraService(lector, geometria);
  }

  leer(contenido: Buffer, mime: string, opciones?: OpcionesLecturaCamara): Promise<LecturaLocalCamara> {
    return this.servicio.leer(contenido, mime, LIMITES_LECTURA_CAMARA, opciones);
  }
}
