import { Inject, Injectable } from '@nestjs/common';
import { GEOMETRIA_DOCUMENTO, GeometriaDocumentoPort } from '../../../domain/ports/out/geometria-documento.port';
import { LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort } from '../../../domain/ports/out/lector-documento-local.port';
import { LecturaRutPort } from '../../../domain/ports/out/lectura-rut.port';
import { LecturaLocalRut, LecturaLocalRutService } from '../../../domain/services/lectura-local-rut.domain-service';

/**
 * Lectura local del RUT (PDF o imagen → posiciones de texto/OCR → `interpretarRut`), lista para inyectar.
 * Solo cablea los puertos al servicio de dominio; no decide nada. 100 % local: sin proveedores externos.
 */
@Injectable()
export class LecturaRutLocalAdapter implements LecturaRutPort {
  private readonly servicio: LecturaLocalRutService;

  constructor(
    @Inject(LECTOR_DOCUMENTO_LOCAL) lector: LectorDocumentoLocalPort,
    @Inject(GEOMETRIA_DOCUMENTO) geometria: GeometriaDocumentoPort,
  ) {
    this.servicio = new LecturaLocalRutService(lector, geometria);
  }

  leer(contenido: Buffer, mime: string): Promise<LecturaLocalRut> {
    return this.servicio.leer(contenido, mime);
  }
}
