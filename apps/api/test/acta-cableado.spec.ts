import { Test } from '@nestjs/testing';
import { GEOMETRIA_DOCUMENTO } from '../src/domain/ports/out/geometria-documento.port';
import { LECTOR_DOCUMENTO_LOCAL } from '../src/domain/ports/out/lector-documento-local.port';
import { ExtraccionLocalAdapter } from '../src/infrastructure/adapters/ia/extraccion-local.adapter';
import { ExtraccionSimuladaAdapter } from '../src/infrastructure/adapters/ia/extraccion.adapter';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { LecturaActaLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lectura-acta-local.adapter';
import { pdfActaDigital } from './soporte-acta-pdf';

/** El cableado de inyección que usa `AppModule` para la lectura del acta (las pruebas unitarias no levantan `AppModule`). */
describe('Acta de iniciación · cableado de dependencias', () => {
  it('una sola instancia del lector sirve a sus dos puertos y el acta se lee de punta a punta', async () => {
    const modulo = await Test.createTestingModule({
      providers: [
        LectorDocumentoLocalAdapter,
        { provide: LECTOR_DOCUMENTO_LOCAL, useExisting: LectorDocumentoLocalAdapter },
        { provide: GEOMETRIA_DOCUMENTO, useExisting: LectorDocumentoLocalAdapter },
        LecturaActaLocalAdapter,
        ExtraccionSimuladaAdapter,
        ExtraccionLocalAdapter,
      ],
    }).compile();
    try {
      expect(modulo.get(LECTOR_DOCUMENTO_LOCAL)).toBe(modulo.get(GEOMETRIA_DOCUMENTO));
      const lectura = await modulo.get(LecturaActaLocalAdapter).leer(await pdfActaDigital({ firmaEmpresa: 'trazo' }), 'application/pdf');
      expect(lectura.analisis.clasificacion.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(lectura.analisis.firmas.firmaEmpresaPresente).toBe('si');
      expect(modulo.get(ExtraccionLocalAdapter)).toBeDefined();
    } finally {
      await modulo.get(LectorDocumentoLocalAdapter).onModuleDestroy();
      await modulo.close();
    }
  }, 60_000);
});
