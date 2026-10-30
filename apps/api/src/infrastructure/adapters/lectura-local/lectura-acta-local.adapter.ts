import { Inject, Injectable, Optional } from '@nestjs/common';
import { DatosSipraActa } from '../../../domain/entities/acta-iniciacion';
import { GEOMETRIA_DOCUMENTO, GeometriaDocumentoPort } from '../../../domain/ports/out/geometria-documento.port';
import { LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort } from '../../../domain/ports/out/lector-documento-local.port';
import { LecturaActaLocal, LecturaLocalActaService } from '../../../domain/services/lectura-local-acta.domain-service';

/**
 * Lectura local del acta de iniciación (PDF o imagen → texto/OCR → `analizarActa`), lista para inyectar.
 * Solo cablea los puertos al servicio de dominio; no decide nada. 100 % local: sin proveedores externos.
 */
@Injectable()
export class LecturaActaLocalAdapter {
  private readonly servicio: LecturaLocalActaService;

  constructor(
    @Inject(LECTOR_DOCUMENTO_LOCAL) lector: LectorDocumentoLocalPort,
    @Optional() @Inject(GEOMETRIA_DOCUMENTO) geometria?: GeometriaDocumentoPort,
  ) {
    this.servicio = new LecturaLocalActaService(lector, geometria ?? null);
  }

  /** `sipra`: datos esperados de la práctica; si se pasan, el análisis incluye la comparación. */
  leer(contenido: Buffer, mime: string, sipra: DatosSipraActa | null = null): Promise<LecturaActaLocal> {
    return this.servicio.leer(contenido, mime, sipra);
  }
}
