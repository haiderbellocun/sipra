import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import {
  PipelineValidacionUseCase,
} from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import {
  DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import {
  DocumentoRepositoryPort, PracticaRepositoryPort, UsuarioRepositoryPort,
} from '../src/domain/ports/out/repositorios.port';
import {
  AlmacenamientoPort, CoherenciaCruzadaPort, ExtraccionIaPort, LectorCodigoBarrasPort,
  ResultadoExtraccion,
} from '../src/domain/ports/out/servicios-externos.port';
import {
  DecodificadorImagenAdapter,
} from '../src/infrastructure/adapters/imagen/decodificador.adapter';
import { ImagenGris } from '../src/domain/services/hash-perceptual.domain-service';

/**
 * El preprocesamiento existe para agotar el recurso determinístico ANTES de
 * devolverle el documento al estudiante. Estas pruebas fijan que el pipeline
 * de verdad lo intente, y que no mienta cuando no sirve.
 */

const decodificador = new DecodificadorImagenAdapter();

/** Documento inclinado, con margen y con sombra: los tres casos que corrige. */
function imagenTorcida(ancho = 320, alto = 260): ImagenGris {
  const pixeles = new Uint8Array(ancho * alto).fill(240);
  const tangente = Math.tan((5 * Math.PI) / 180);
  for (let renglon = 0; renglon < 12; renglon += 1) {
    const yBase = 40 + Math.round((renglon * (alto - 80)) / 12);
    for (let x = 40; x < ancho - 40; x += 1) {
      const y = Math.round(yBase + (x - ancho / 2) * tangente);
      for (let g = 0; g < 4; g += 1) {
        if (y + g >= 0 && y + g < alto) pixeles[(y + g) * ancho + x] = 30;
      }
    }
  }
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      const i = y * ancho + x;
      pixeles[i] = Math.round(pixeles[i] * (1 - 0.5 * (x / ancho)));
    }
  }
  return { ancho, alto, pixeles };
}

const PNG_TORCIDO = decodificador.codificarPng(imagenTorcida());

function extraccion(ilegible: boolean): ResultadoExtraccion {
  return {
    tipoDetectado: null,
    campos: ilegible ? {} : { total_horas: { valor: '480', confianza: 0.93, evidencia: 'Total: 480' } },
    ilegible,
    modelo: 'prueba',
    tokensEntrada: 0,
    tokensSalida: 0,
    costoUsd: 0,
  };
}

function datosDocumento(): DatosDocumento {
  const ahora = new Date();
  return {
    id: 'doc-1', practicaId: 'p-1', tipo: TipoDocumento.PLANILLA_HORAS, version: 1,
    estado: EstadoDocumento.RECIBIDO, nombreOriginal: 'planilla.png', mimeReal: 'image/png',
    tamanoBytes: PNG_TORCIDO.length, hashSha256: 'a'.repeat(64), hashPerceptual: null,
    rutaAlmacenamiento: 'ruta/x', calidadCaptura: null, banderas: [], puntaje: null,
    banda: null, extraccion: null, decididoPor: null, justificacionDecision: null,
    motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora, purgarDespuesDe: null,
  };
}

/** Construye el pipeline con un extractor cuyo comportamiento se controla. */
function pipeline(extractor: ExtraccionIaPort): {
  uso: PipelineValidacionUseCase;
  guardado: () => DatosDocumento;
} {
  let almacenado = datosDocumento();

  const documentos: DocumentoRepositoryPort = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)),
    listarPorPractica: () => Promise.resolve([]),
    contarPorHash: () => Promise.resolve(0),
    listarHashesPerceptuales: () => Promise.resolve([]),
    ultimaVersion: () => Promise.resolve(1),
    guardar: (datos) => {
      almacenado = datos;
      return Promise.resolve(Documento.desde(datos));
    },
    listarParaPurga: () => Promise.resolve([]),
    gastoIaDesde: () => Promise.resolve(0),
    contarLecturasDesde: () => Promise.resolve(0),
  };

  const practicas = { buscarPorId: () => Promise.resolve(null) } as unknown as PracticaRepositoryPort;
  const usuarios = { buscarPorId: () => Promise.resolve(null) } as unknown as UsuarioRepositoryPort;
  const almacen = { leer: () => Promise.resolve(PNG_TORCIDO) } as unknown as AlmacenamientoPort;
  const coherencia: CoherenciaCruzadaPort = { evaluar: () => Promise.resolve([]) };
  // La planilla no es una cédula: el lector de códigos no interviene.
  const lectorCodigos: LectorCodigoBarrasPort = {
    leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }),
  };

  return {
    uso: new PipelineValidacionUseCase(
      documentos, practicas, usuarios, almacen, extractor, coherencia, decodificador,
      lectorCodigos, parametrosDeFabrica(),
    ),
    guardado: () => almacenado,
  };
}

/** Sin sobrescrituras: el pipeline recibe los umbrales de fábrica. */
function parametrosDeFabrica(): ParametrosUseCase {
  return new ParametrosUseCase({
    listarSobrescrituras: () => Promise.resolve([]),
    guardar: () => Promise.resolve(),
    restaurar: () => Promise.resolve(),
  });
}

describe('Segundo intento con preprocesamiento', () => {
  it('reintenta sobre la copia preprocesada cuando el primer intento es ilegible', async () => {
    const recibido: { mime: string; bytes: number }[] = [];
    const extractor: ExtraccionIaPort = {
      extraer: (contenido, mime) => {
        recibido.push({ mime, bytes: contenido.length });
        // Ilegible la primera vez; legible sobre la copia enderezada.
        return Promise.resolve(extraccion(recibido.length === 1));
      },
    };

    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    expect(recibido).toHaveLength(2);
    expect(guardado().estado).not.toBe(EstadoDocumento.ILEGIBLE);
  });

  it('deja constancia de qué operaciones lo hicieron legible', async () => {
    let intentos = 0;
    const extractor: ExtraccionIaPort = {
      extraer: () => {
        intentos += 1;
        return Promise.resolve(extraccion(intentos === 1));
      },
    };

    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    const bandera = guardado().banderas.find((b) => b.codigo === 'C2_LEGIBLE_TRAS_PREPROCESO');
    expect(bandera).toBeDefined();
    expect(bandera!.mensaje).toMatch(/enderez|ecualiz|binariz/);
    // Es informativa: el documento se leyó, no hay nada que reprochar.
    expect(bandera!.severidad).toBe('informativa');
  });

  it('si sigue ilegible tras preprocesar, se devuelve al estudiante', async () => {
    const extractor: ExtraccionIaPort = { extraer: () => Promise.resolve(extraccion(true)) };

    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    const datos = guardado();
    expect(datos.estado).toBe(EstadoDocumento.ILEGIBLE);
    // El mensaje explica cómo volver a capturarlo, no culpa al estudiante.
    expect(datos.motivoDevolucion).toMatch(/buena luz|enfocado/);
    // Y no se inventa que el preprocesamiento sirvió.
    expect(datos.banderas.some((b) => b.codigo === 'C2_LEGIBLE_TRAS_PREPROCESO')).toBe(false);
  });

  it('no reintenta cuando el primer intento ya fue legible', async () => {
    let intentos = 0;
    const extractor: ExtraccionIaPort = {
      extraer: () => {
        intentos += 1;
        return Promise.resolve(extraccion(false));
      },
    };

    const { uso } = pipeline(extractor);
    await uso.ejecutar('doc-1');
    expect(intentos).toBe(1);
  });
});
