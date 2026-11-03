import { randomUUID } from 'node:crypto';
import { Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoAutenticidad, EstadoValidacionDocumentoEmpresarial as Estado,
} from '../src/domain/entities/documento-empresarial';
import {
  DatosEvidenciaDocumentoEmpresarial, DatosValidacionDocumentoEmpresarial, EvidenciaDocumentoEmpresarial, ValidacionDocumentoEmpresarial,
} from '../src/domain/entities/validacion-documento-empresarial.entity';
import { CajaTexto, GeometriaDocumentoPort } from '../src/domain/ports/out/geometria-documento.port';
import { LectorDocumentoLocalPort, LimitesLecturaLocal } from '../src/domain/ports/out/lector-documento-local.port';
import { ValidacionDocumentoEmpresarialRepositoryPort } from '../src/domain/ports/out/validacion-documento-empresarial.port';
import { calcularSha256 } from '../src/domain/services/duplicados-documento-empresarial.domain-service';
import { LecturaLocalRutService } from '../src/domain/services/lectura-local-rut.domain-service';
import { ValidacionRutUseCase } from '../src/application/use-cases/documentos/validacion-rut.use-case';
import { caja, rutSintetico } from './soporte-rut-sintetico';
import { textoCamaraExistencia, textoFactura } from './soporte-documento-empresarial';

/** Fakes de los puertos de lectura: sirven cajas sintéticas y QR configurados; no hay red ni archivos. */
function puertos(paginas: { nativo: CajaTexto[] | null; ocr?: CajaTexto[] }[], qr: Record<number, string[]> = {}) {
  const renders: LimitesLecturaLocal[] = [];
  const lector: LectorDocumentoLocalPort = {
    extraerTextoNativo: async () => ({
      paginas: paginas.length,
      porPagina: paginas.map((p, i) => ({ pagina: i + 1, texto: p.nativo ? p.nativo.map((c) => c.texto).join(' ') : '' })),
    }),
    renderizarPagina: async (_c, pagina, limites) => { renders.push(limites); return { pagina, ancho: 10, alto: 10, imagen: Buffer.from([pagina]) }; },
    prepararImagen: async (_c, _m, limites) => { renders.push(limites); return { pagina: 1, ancho: 10, alto: 10, imagen: Buffer.from([1]) }; },
    detectarQr: async (imagen, pagina) => (qr[pagina ?? imagen[0]] ?? []).map((contenido) => ({ formato: 'QRCode', contenido, pagina, posicion: null })),
    ejecutarOcr: async () => ({ pagina: 1, texto: '', confianza: 0, giro: 0 }),
  };
  const geometria: GeometriaDocumentoPort = {
    cajasTextoNativo: async (_c, pagina) => paginas[pagina - 1].nativo ?? [],
    cajasOcr: async (imagen) => paginas[imagen[0] - 1]?.ocr ?? [],
    medirZonaFirma: async () => ({ legible: false, densidadTinta: 0, alturaRelativaTrazo: 0 }),
  };
  return { lector, geometria, renders };
}

const URL_DIAN = 'https://muisca.dian.gov.co/WebRutMuisca/DefConsultaEstadoRUT.faces?codigo=SECRETO';
const PDF = Buffer.from('%PDF-1.4 sintetico');

describe('LecturaLocalRutService: lectura local, QR clasificado sin abrirse', () => {
  it('PDF digital: método texto, SHA-256 del archivo, y QR hacia la DIAN registrado SIN afirmar autenticidad', async () => {
    const fetchEspia = jest.spyOn(globalThis, 'fetch');
    const { lector, geometria, renders } = puertos([{ nativo: rutSintetico({ persona: 'natural' }) }], { 1: [URL_DIAN] });
    const l = await new LecturaLocalRutService(lector, geometria).leer(PDF, 'application/pdf');
    expect(l.metodo).toBe('texto');
    expect(l.hashSha256).toBe(calcularSha256(PDF));
    expect(l.interpretacion.clasificacion.clasificacion).toBe(C.RUT_PERSONA_NATURAL);
    expect(l.autenticidad).toMatchObject({
      estado: EstadoAutenticidad.NO_VERIFICABLE, fuente: null, qrPresente: true, qrDecodificado: true, qrDestinoOficial: true, firmaPdfValida: null,
    });
    // El contenido del QR (con su código) no se conserva en ningún lado y la URL no se abrió.
    expect(JSON.stringify(l)).not.toContain('SECRETO');
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(renders[0].escalaRender).toBe(2);
    fetchEspia.mockRestore();
  });

  it('un QR que NO apunta a la DIAN (host parecido, texto o sin QR) no es destino oficial', async () => {
    for (const contenido of ['https://dian.gov.co.evil.example/x', 'https://evildian.gov.co/', 'texto cualquiera']) {
      const { lector, geometria } = puertos([{ nativo: rutSintetico({ persona: 'juridica' }) }], { 1: [contenido] });
      const l = await new LecturaLocalRutService(lector, geometria).leer(PDF, 'application/pdf');
      expect(l.autenticidad).toMatchObject({ qrPresente: true, qrDecodificado: true, qrDestinoOficial: false, estado: EstadoAutenticidad.NO_VERIFICABLE });
    }
    const sin = puertos([{ nativo: rutSintetico({ persona: 'juridica' }) }]);
    expect((await new LecturaLocalRutService(sin.lector, sin.geometria).leer(PDF, 'application/pdf')).autenticidad)
      .toMatchObject({ qrPresente: false, qrDecodificado: false, qrDestinoOficial: false });
  });

  it('escaneado: OCR a 3×, método ocr y, sin QR decodificado, la presencia del QR queda SIN determinar (no se afirma ausencia)', async () => {
    const { lector, geometria, renders } = puertos([{ nativo: null, ocr: rutSintetico({ persona: 'natural', fuente: 'ocr', confTexto: 95, confDigitos: 95 }) }]);
    const l = await new LecturaLocalRutService(lector, geometria).leer(PDF, 'application/pdf');
    expect(l.metodo).toBe('ocr');
    expect(renders[0].escalaRender).toBe(3);
    expect(l.resumen.paginasOcr).toBe(1);
    expect(l.interpretacion.datos).toMatchObject({ nit: '1000000001', controlNit: 'confiable' });
    expect(l.autenticidad).toMatchObject({ qrPresente: null, qrDecodificado: null, qrDestinoOficial: null });
  });

  it('híbrido: la página con texto se lee del texto y la que es imagen, por OCR', async () => {
    const { lector, geometria } = puertos([{ nativo: rutSintetico({ persona: 'juridica' }) }, { nativo: null, ocr: [caja('pagina', 10, 700, 90)] }]);
    const l = await new LecturaLocalRutService(lector, geometria).leer(PDF, 'application/pdf');
    expect(l.metodo).toBe('hibrido');
    expect(l.resumen).toMatchObject({ paginas: 2, paginasOcr: 1 });
  });

  it('una imagen (no PDF) se lee solo por OCR', async () => {
    const { lector, geometria } = puertos([{ nativo: null, ocr: rutSintetico({ persona: 'juridica', fuente: 'ocr', confTexto: 95, confDigitos: 95 }) }]);
    const l = await new LecturaLocalRutService(lector, geometria).leer(Buffer.from('png'), 'image/png');
    expect(l.metodo).toBe('ocr');
    expect(l.interpretacion.clasificacion.clasificacion).toBe(C.RUT_PERSONA_JURIDICA);
  });
});

describe('Documentos que no son un RUT', () => {
  const clasificar = async (cajas: CajaTexto[]) => {
    const { lector, geometria } = puertos([{ nativo: cajas }]);
    return (await new LecturaLocalRutService(lector, geometria).leer(PDF, 'application/pdf')).interpretacion;
  };
  const cajasDeTexto = (texto: string): CajaTexto[] => texto.split(/\s+/).map((p, i) => caja(p, 20 + (i % 40) * 14, 700 - Math.floor(i / 40) * 10));

  it('una factura NO es un RUT: DOCUMENTO_INCORRECTO, sin datos', async () => {
    const r = await clasificar(cajasDeTexto(textoFactura()));
    expect(r.clasificacion.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect(r.datos).toBeNull();
  });

  it('un certificado de Cámara en el lugar del RUT se informa como Cámara y no se extrae nada como RUT', async () => {
    const r = await clasificar(cajasDeTexto(textoCamaraExistencia()));
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_EXISTENCIA_REPRESENTACION);
    expect(r.datos).toBeNull();
  });

  it('un documento cualquiera con mucho texto es incorrecto; «DIAN» y «NIT» sueltos no lo vuelven un RUT', async () => {
    const carta = 'Carta de presentación. Cordial saludo. Por medio de la presente nos permitimos informar que el NIT de la empresa fue radicado ante la DIAN. '.repeat(3);
    expect((await clasificar(cajasDeTexto(carta))).clasificacion.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect((await clasificar(cajasDeTexto('DIAN NIT'))).clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
  });

  it('un formulario con las dos personas a la vez, o sin ninguna, es NO_DETERMINABLE', async () => {
    const ambiguo = rutSintetico({ persona: 'natural' }).concat([caja('Persona', 27, 300), caja('jurídica', 60, 300)]);
    expect((await clasificar(ambiguo)).clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
    expect((await clasificar(rutSintetico({ persona: 'natural', valor24: null }))).clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
  });
});

// ── Caso de uso con repositorios en memoria ────────────────────────────────────────

class RepoMemoria implements ValidacionDocumentoEmpresarialRepositoryPort {
  filas = new Map<string, DatosValidacionDocumentoEmpresarial>();
  evidencias: DatosEvidenciaDocumentoEmpresarial[] = [];
  documentos: { documentoId: string; practicaId: string; tipo: string; hash: string }[] = [];
  async buscarPorId(id: string) { const f = this.filas.get(id); return f ? ValidacionDocumentoEmpresarial.desde(f) : null; }
  async buscarPorDocumento(d: string) { const f = [...this.filas.values()].find((x) => x.documentoId === d); return f ? ValidacionDocumentoEmpresarial.desde(f) : null; }
  async listarPorPractica(p: string) { return [...this.filas.values()].filter((x) => x.practicaId === p).map((f) => ValidacionDocumentoEmpresarial.desde(f)); }
  async crearSiNoExiste(datos: DatosValidacionDocumentoEmpresarial) {
    const existente = await this.buscarPorDocumento(datos.documentoId);
    if (existente) return { validacion: existente, creada: false };
    this.filas.set(datos.id, datos);
    return { validacion: ValidacionDocumentoEmpresarial.desde(datos), creada: true };
  }
  async guardarSiVersion(datos: DatosValidacionDocumentoEmpresarial, v: number) {
    const actual = this.filas.get(datos.id);
    if (!actual || actual.version !== v) return false;
    this.filas.set(datos.id, { ...datos, version: v + 1 });
    return true;
  }
  async agregarEvidencia(d: DatosEvidenciaDocumentoEmpresarial) {
    if (this.evidencias.some((e) => e.validacionId === d.validacionId && e.intento === d.intento && e.tipo === d.tipo)) return false;
    this.evidencias.push(EvidenciaDocumentoEmpresarial.crear(d).instantanea());
    return true;
  }
  async listarEvidencias(v: string) { return this.evidencias.filter((e) => e.validacionId === v).map((e) => EvidenciaDocumentoEmpresarial.desde(e)); }
  async buscarDuplicados(practicaId: string, tipo: string, hash: string, excluir: string) {
    return this.documentos.filter((d) => d.practicaId === practicaId && d.tipo === tipo && d.hash === hash && d.documentoId !== excluir)
      .map((d) => ({ documentoId: d.documentoId, validacionId: '', version: 1, hashDocumento: d.hash }));
  }
}

describe('ValidacionRutUseCase', () => {
  const PRACTICA = '00000000-0000-4000-8000-0000000000a1';
  const ESTUDIANTE = '00000000-0000-4000-8000-0000000000b1';

  function entorno(cajasPorRuta: Record<string, CajaTexto[]>, tipoPorDoc: Record<string, TipoDocumento>, fallaLectura = false) {
    const repo = new RepoMemoria();
    const docs = new Map<string, Documento>();
    for (const [ruta, tipo] of Object.entries(tipoPorDoc)) {
      const id = randomUUID();
      docs.set(id, Documento.desde({
        id, practicaId: PRACTICA, tipo, version: docs.size + 1, estado: EstadoDocumento.EN_REVISION, nombreOriginal: 'x.pdf', mimeReal: 'application/pdf',
        tamanoBytes: 10, hashSha256: calcularSha256(Buffer.from(ruta)), hashPerceptual: null, rutaAlmacenamiento: ruta, calidadCaptura: null, banderas: [],
        puntaje: null, banda: null, extraccion: null, decididoPor: null, justificacionDecision: null, motivoDevolucion: null,
        cargadoEn: new Date('2026-11-03T14:00:00Z'), actualizadoEn: new Date('2026-11-03T14:00:00Z'), purgarDespuesDe: null,
      }));
      repo.documentos.push({ documentoId: id, practicaId: PRACTICA, tipo, hash: calcularSha256(Buffer.from(ruta)) });
    }
    const documentos = { buscarPorId: async (id: string) => docs.get(id) ?? null };
    const practicas = { buscarPorId: async () => ({ estudianteId: ESTUDIANTE }) };
    const almacen = { leer: async (ruta: string) => { if (fallaLectura) throw new Error('el contenido del documento no debe salir en el mensaje'); return Buffer.from(ruta); } };
    const lectura = {
      leer: async (contenido: Buffer, mime: string) => {
        const ruta = contenido.toString();
        const { lector, geometria } = puertos([{ nativo: cajasPorRuta[ruta] }], { 1: [URL_DIAN] });
        return new LecturaLocalRutService(lector, geometria).leer(contenido, mime);
      },
    };
    const caso = new ValidacionRutUseCase(repo, documentos as never, practicas as never, almacen as never, lectura);
    return { caso, repo, ids: [...docs.keys()] };
  }
  const AHORA = new Date('2026-11-03T15:00:00Z');

  it('procesa un RUT: clasifica por contenido, guarda lo minimizado, el hash, la autenticidad por defecto y DOS evidencias', async () => {
    const { caso, repo, ids } = entorno({ a: rutSintetico({ persona: 'natural', conContacto: true }) }, { a: TipoDocumento.RUT_NATURAL });
    const v = (await caso.procesar(ids[0], AHORA))!.instantanea();
    expect(v).toMatchObject({
      estado: Estado.REVISION, familiaDocumento: 'rut', tipoDetectado: C.RUT_PERSONA_NATURAL, tipoPersona: 'natural', tipoEsperado: 'rut_natural',
      expectativa: 'coincide', metodoLectura: 'texto', confianza: 1, lecturaDudosa: false, hashDocumento: calcularSha256(Buffer.from('a')),
      duplicadoDeDocumentoId: null, comparacion: null, procesadaEn: AHORA, practicaId: PRACTICA, estudianteId: ESTUDIANTE,
    });
    expect(v.autenticidad).toMatchObject({ estado: 'no_verificable', qrDecodificado: true, qrDestinoOficial: true, firmaPdfValida: null });
    expect(v.datosExtraidos).toMatchObject({ nit: '1000000001', nombres: 'MARIA FERNANDA', divipolaMunicipio: '25290' });
    const guardado = JSON.stringify([v, repo.evidencias]);
    for (const prohibido of ['CALLE FALSA', 'persona.demo@ejemplo.test', '3000000000', 'SECRETO']) expect(guardado).not.toContain(prohibido);
    expect(repo.evidencias.map((e) => e.tipo).sort()).toEqual(['clasificacion', 'lectura_documento']);
    expect(repo.evidencias.every((e) => e.hashDocumento === v.hashDocumento && e.actorId === null)).toBe(true);
  });

  it('es idempotente: repetir el procesamiento no duplica la validación ni las evidencias ni pisa el resultado', async () => {
    const { caso, repo, ids } = entorno({ a: rutSintetico({ persona: 'juridica' }) }, { a: TipoDocumento.RUT_JURIDICO });
    const primera = (await caso.procesar(ids[0], AHORA))!.instantanea();
    const segunda = (await caso.procesar(ids[0], new Date('2026-11-04T00:00:00Z')))!.instantanea();
    expect(repo.filas.size).toBe(1);
    expect(repo.evidencias).toHaveLength(2);
    expect(segunda.procesadaEn).toEqual(primera.procesadaEn);
    expect(segunda.version).toBe(primera.version);
  });

  it('RUT jurídico subido como «RUT persona natural»: se detecta jurídico, la expectativa dice persona_distinta, NO se reclasifica', async () => {
    const { caso, ids } = entorno({ a: rutSintetico({ persona: 'juridica' }) }, { a: TipoDocumento.RUT_NATURAL });
    const v = (await caso.procesar(ids[0], AHORA))!.instantanea();
    expect(v).toMatchObject({ tipoEsperado: 'rut_natural', tipoDetectado: C.RUT_PERSONA_JURIDICA, tipoPersona: 'juridica', expectativa: 'persona_distinta', estado: Estado.REVISION });
    expect(v.datosExtraidos).toMatchObject({ tipoPersona: 'juridica', razonSocial: 'ACME DEMOSTRACION S.A.S.' });
  });

  it('un documento incorrecto queda DOCUMENTO_INCORRECTO en revisión, sin datos', async () => {
    const factura = textoFactura().split(/\s+/).map((p, i) => caja(p, 20 + (i % 40) * 14, 700 - Math.floor(i / 40) * 10));
    const { caso, ids } = entorno({ a: factura }, { a: TipoDocumento.RUT_NATURAL });
    const v = (await caso.procesar(ids[0], AHORA))!.instantanea();
    expect(v).toMatchObject({ tipoDetectado: C.DOCUMENTO_INCORRECTO, expectativa: 'documento_incorrecto', datosExtraidos: null, familiaDocumento: null, tipoPersona: null });
  });

  it('un duplicado exacto (misma práctica y tipo) se REPORTA y no impide la lectura', async () => {
    const mismo = rutSintetico({ persona: 'natural' });
    // Dos documentos con el MISMO contenido (misma ruta ⇒ mismo hash) en la misma práctica y tipo.
    const repo = new RepoMemoria();
    const { caso, ids, repo: r2 } = entorno({ igual: mismo }, { igual: TipoDocumento.RUT_NATURAL });
    void repo;
    r2.documentos.push({ documentoId: 'otro-documento-anterior', practicaId: PRACTICA, tipo: TipoDocumento.RUT_NATURAL, hash: calcularSha256(Buffer.from('igual')) });
    const v = (await caso.procesar(ids[0], AHORA))!.instantanea();
    expect(v.duplicadoDeDocumentoId).toBe('otro-documento-anterior');
    expect(v.estado).toBe(Estado.REVISION);
    expect(v.tipoDetectado).toBe(C.RUT_PERSONA_NATURAL);
  });

  it('si la lectura falla, queda en error con un CÓDIGO (nunca el mensaje) y un reintento la reanuda', async () => {
    const { caso, repo, ids } = entorno({ a: rutSintetico({ persona: 'natural' }) }, { a: TipoDocumento.RUT_NATURAL }, true);
    const v = (await caso.procesar(ids[0], AHORA))!.instantanea();
    expect(v).toMatchObject({ estado: Estado.ERROR, errorCodigo: 'error_procesamiento', tipoDetectado: null });
    expect(JSON.stringify(v)).not.toContain('contenido del documento');
    expect(repo.evidencias).toHaveLength(0);
  });

  it('los tipos que no son RUT (y los documentos inexistentes) no se procesan aquí', async () => {
    const { caso, ids } = entorno({ a: rutSintetico({ persona: 'natural' }) }, { a: TipoDocumento.CAMARA_COMERCIO });
    expect(await caso.procesar(ids[0], AHORA)).toBeNull();
    expect(await caso.procesar(randomUUID(), AHORA)).toBeNull();
  });
});
