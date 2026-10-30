import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { ExtraccionLocalAdapter } from '../src/infrastructure/adapters/ia/extraccion-local.adapter';
import { ExtraccionSimuladaAdapter } from '../src/infrastructure/adapters/ia/extraccion.adapter';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { pdfActaDigital, pdfDeLineas } from './soporte-acta-pdf';
import { TEXTO_ARCHIVO_CUALQUIERA, TEXTO_CEDULA } from './soporte-acta';

/**
 * El acta de iniciación pasa por su lectura local: la regex del extractor determinístico («acta de inicio»)
 * ya no decide su contenido, y el resultado trae solo códigos y los campos que consume el pipeline.
 */
describe('Extractor local · acta de iniciación', () => {
  const lector = new LectorDocumentoLocalAdapter();
  const respaldo = new ExtraccionSimuladaAdapter();
  const extractor = new ExtraccionLocalAdapter(lector, respaldo);
  afterAll(async () => { await lector.onModuleDestroy(); });

  it('el extractor determinístico antiguo NO interviene en el acta', async () => {
    const espia = jest.spyOn(respaldo, 'extraer');
    // Título «INICIACIÓN»: la regex antigua (acta de inicio) no lo reconocería; el clasificador nuevo sí.
    const r = await extractor.extraer(await pdfActaDigital({}), 'application/pdf', TipoDocumento.ACTA_INICIO);
    expect(espia).not.toHaveBeenCalled();
    expect(r.tipoDetectado).toBe(TipoDocumento.ACTA_INICIO);
    espia.mockRestore();
  }, 60_000);

  it('entrega lo que consume el pipeline, 100 % local y sin costo de IA', async () => {
    const r = await extractor.extraer(
      await pdfActaDigital({ remuneracion: 'no_remunerada', encabezadoArl: 'cun', obligacionArl: 'institucion' }), 'application/pdf', TipoDocumento.ACTA_INICIO,
    );
    expect(r).toMatchObject({ proveedor: 'local', costoUsd: 0, tokensEntrada: 0, tokensSalida: 0, ilegible: false });
    expect(r.campos.fecha_inicio).toMatchObject({ valor: '2026-03-17', fuente: 'texto_nativo' });
    expect(r.campos.fecha_fin.valor).toBe('2026-09-17');
    expect(r.campos.modalidad.valor).toBe('Contrato de aprendizaje');
    expect(r.campos.nombre_responsable.valor).toBe('Laura Jefe Ficticia');
    expect(r.lecturaActa?.clasificacion).toMatchObject({ tipoActaDetectada: 'iniciacion_practicas', remuneracion: 'no_remunerada', responsableArl: 'cun' });
    expect(r.lecturaActa?.lectura.metodoLectura).toBe('texto');
  }, 60_000);

  it('la lectura que sale del extractor viene MINIMIZADA: sin texto del documento y sin datos que ninguna regla usa', async () => {
    const r = await extractor.extraer(await pdfActaDigital({}), 'application/pdf', TipoDocumento.ACTA_INICIO);
    const json = JSON.stringify(r.lecturaActa);
    // Conserva lo que sirve a la comparación…
    expect(r.lecturaActa?.campos.nombre_estudiante?.valor).toBe('Ana Maria Prueba Sintetica');
    // …y descarta dirección, teléfonos y documentos de terceros, que el formulario trae pero nadie usa.
    for (const dato of ['Calle 1 # 2-3', '3000000000', '6010000000', '1.000.000.002', '1.000.000.003', 'Barrio Ficticio']) expect(json).not.toContain(dato);
    expect(json).not.toContain('OBLIGACIONES DE LA EMPRESA');
    expect(json).not.toContain('Afiliar el estudiante');
  }, 60_000);

  it('un documento de otro tipo se reconoce: tipo detectado distinto y veredicto «documento_incorrecto»', async () => {
    const cedula = await extractor.extraer(await pdfDeLineas(TEXTO_CEDULA.split('\n')), 'application/pdf', TipoDocumento.ACTA_INICIO);
    expect(cedula.tipoDetectado).toBe(TipoDocumento.CEDULA);
    expect(cedula.lecturaActa?.clasificacion.tipoActaDetectada).toBe('documento_incorrecto');
    const otro = await extractor.extraer(await pdfDeLineas(TEXTO_ARCHIVO_CUALQUIERA.split('. ')), 'application/pdf', TipoDocumento.ACTA_INICIO);
    expect(otro.tipoDetectado).toBeNull();
    expect(otro.lecturaActa?.clasificacion).toMatchObject({ tipoActaDetectada: 'documento_incorrecto', documentoAjeno: 'otro' });
  }, 60_000);

  it('un archivo dañado queda ilegible (reenvío), no clasificado', async () => {
    const r = await extractor.extraer(Buffer.from('%PDF-1.4 roto'), 'application/pdf', TipoDocumento.ACTA_INICIO);
    expect(r.ilegible).toBe(true);
    expect(r.tipoDetectado).toBeNull();
  }, 60_000);

  it('otros tipos (distintos de EPS y acta) siguen al extractor determinístico de respaldo', async () => {
    const espia = jest.spyOn(respaldo, 'extraer');
    await extractor.extraer(await pdfActaDigital({}), 'application/pdf', TipoDocumento.CEDULA);
    expect(espia).toHaveBeenCalledTimes(1);
    espia.mockRestore();
  }, 60_000);
});
