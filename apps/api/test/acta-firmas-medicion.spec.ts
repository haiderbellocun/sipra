import { medirZonaFirmaEnPng } from '../src/infrastructure/adapters/lectura-local/medicion-firma';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { canvas } from '../src/infrastructure/adapters/lectura-local/imagen-local';
import { LecturaLocalActaService, LIMITES_LECTURA_ACTA } from '../src/domain/services/lectura-local-acta.domain-service';
import { evaluarFirmasActa } from '../src/domain/services/firmas-acta.domain-service';
import { localizarZonasFirma } from '../src/domain/services/localizacion-firmas.domain-service';
import { CajaTexto, RectRelativo } from '../src/domain/ports/out/geometria-documento.port';
import { Firma, pdfActaDigital, pdfActaEscaneada } from './soporte-acta-pdf';
import { actaSintetica } from './soporte-acta';

/**
 * Medición de firmas. Solo PRESENCIA PROBABLE: vacía → no, trazo claro → sí, ambigua → no_determinable.
 * Imágenes y PDF sintéticos generados en memoria.
 */

const ZONA_COMPLETA: RectRelativo = { x: 0, y: 0, ancho: 1, alto: 1 };
const TEXTO_CON_ROTULOS = actaSintetica();

interface Ctx2 {
  fillStyle: string; strokeStyle: string; lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

/** Zona de 600×200 px con lo que pida el caso. */
function imagenZona(dibujar: (ctx: Ctx2, ancho: number, alto: number) => void, fondo = '#ffffff'): Buffer {
  const ancho = 600; const alto = 200;
  const lienzo = canvas().createCanvas(ancho, alto);
  const ctx = lienzo.getContext('2d') as unknown as Ctx2;
  ctx.fillStyle = fondo; ctx.fillRect(0, 0, ancho, alto);
  dibujar(ctx, ancho, alto);
  return (lienzo as unknown as { toBuffer(m: string): Buffer }).toBuffer('image/png');
}

const linea = (ctx: Ctx2, ancho: number, alto: number): void => {
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(30, alto - 30); ctx.lineTo(ancho - 30, alto - 30); ctx.stroke();
};
const garabato = (ctx: Ctx2, ancho: number, alto: number, cruzaLinea = false): void => {
  ctx.strokeStyle = '#1a2a6c'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(90, 140);
  ctx.bezierCurveTo(110, 20, 170, 20, 190, 120);
  ctx.bezierCurveTo(210, 190, 250, 40, 300, 90);
  ctx.bezierCurveTo(340, 130, 380, 20, 430, 100);
  ctx.bezierCurveTo(460, 150, 500, 60, 540, 110);
  ctx.stroke();
  if (cruzaLinea) { ctx.beginPath(); ctx.moveTo(330, 60); ctx.bezierCurveTo(340, 130, 345, 190, ancho / 2 + 60, alto - 5); ctx.stroke(); }
};

describe('Acta de iniciación · medición de zonas de firma (imágenes sintéticas)', () => {
  const limites = LIMITES_LECTURA_ACTA;
  const veredicto = async (png: Buffer) =>
    evaluarFirmasActa(TEXTO_CON_ROTULOS, { empresa: await medirZonaFirmaEnPng(png, ZONA_COMPLETA, [], limites), practicante: null }).firmaEmpresaPresente;

  it('1 · zona vacía → no', async () => {
    expect(await veredicto(imagenZona(() => undefined))).toBe('no');
  });

  it('2 · solo la línea del formulario → no (la línea no es una firma)', async () => {
    const m = await medirZonaFirmaEnPng(imagenZona(linea), ZONA_COMPLETA, [], limites);
    expect(m.densidadTinta).toBe(0);
    expect(await veredicto(imagenZona(linea))).toBe('no');
  });

  it('2b · una línea inclinada o con borde vertical tampoco se toma por firma', async () => {
    const inclinada = imagenZona((ctx) => { ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(20, 150); ctx.lineTo(580, 165); ctx.stroke(); });
    expect(await veredicto(inclinada)).toBe('no');
    const borde = imagenZona((ctx, a, h) => { linea(ctx, a, h); ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(4, h); ctx.stroke(); });
    expect(await veredicto(borde)).toBe('no');
  });

  it('3 · firma simulada → sí', async () => {
    expect(await veredicto(imagenZona((ctx, a, h) => { linea(ctx, a, h); garabato(ctx, a, h); }))).toBe('si');
  });

  it('4 · trazo pequeño ambiguo → no_determinable', async () => {
    const pequeno = imagenZona((ctx, a, h) => {
      linea(ctx, a, h);
      ctx.strokeStyle = '#1a2a6c'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(280, 120); ctx.lineTo(370, 100); ctx.stroke();
    });
    expect(await veredicto(pequeno)).toBe('no_determinable');
  });

  it('5 · ruido (motas de escaneo) → no_determinable, nunca «sí»', async () => {
    const ruido = imagenZona((ctx, a, h) => {
      linea(ctx, a, h);
      ctx.fillStyle = '#222';
      let semilla = 11;
      for (let i = 0; i < 4000; i += 1) {
        semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
        const x = semilla % a;
        semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
        ctx.fillRect(x, semilla % h, 2, 2);
      }
    });
    expect(await veredicto(ruido)).toBe('no_determinable');
  });

  it('6 · firma que cruza la línea → sí (se descuenta la línea, no el trazo)', async () => {
    expect(await veredicto(imagenZona((ctx, a, h) => { linea(ctx, a, h); garabato(ctx, a, h, true); }))).toBe('si');
  });

  it('8 · zona ilegible (oscura, fuera de la página o diminuta) → no_determinable', async () => {
    const oscura = imagenZona(() => undefined, '#202020');
    expect(await veredicto(oscura)).toBe('no_determinable');
    const fuera = await medirZonaFirmaEnPng(imagenZona(() => undefined), { x: 0.8, y: 0.8, ancho: 0.6, alto: 0.6 }, [], limites);
    expect(fuera.legible).toBe(false);
    const diminuta = await medirZonaFirmaEnPng(imagenZona(() => undefined), { x: 0.1, y: 0.1, ancho: 0.02, alto: 0.02 }, [], limites);
    expect(diminuta.legible).toBe(false);
  });

  it('el texto impreso conocido (exclusiones) no cuenta como tinta', async () => {
    // «Letras»: bloques separados, como texto impreso (una banda continua sería una línea).
    const conTexto = imagenZona((ctx) => { ctx.fillStyle = '#000'; for (let i = 0; i < 18; i += 1) ctx.fillRect(100 + i * 16, 40, 10, 24); });
    const sinExcluir = await medirZonaFirmaEnPng(conTexto, ZONA_COMPLETA, [], limites);
    expect(sinExcluir.densidadTinta).toBeGreaterThan(0.01);
    const excluido = await medirZonaFirmaEnPng(conTexto, ZONA_COMPLETA, [{ x: 90 / 600, y: 30 / 200, ancho: 320 / 600, alto: 45 / 200 }], limites);
    expect(excluido.densidadTinta).toBe(0);
  });
});

describe('Acta de iniciación · localización de zonas por rótulo', () => {
  const caja = (texto: string, x: number, y: number, ancho: number, alto = 0.012): CajaTexto => ({ texto, x, y, ancho, alto, confianza: 100 });

  it('ancla en los rótulos y define la zona relativa, sobre ellos y sin solaparse', () => {
    const z = localizarZonasFirma([caja('FIRMA DE LA EMPRESA', 0.2, 0.7, 0.18), caja('FIRMA DEL PRÁCTICANTE', 0.6, 0.7, 0.2)]);
    expect(z.empresa).not.toBeNull();
    expect(z.practicante).not.toBeNull();
    expect(z.empresa!.y + z.empresa!.alto).toBeLessThan(0.7);
    expect(z.empresa!.x + z.empresa!.ancho).toBeLessThanOrEqual(z.practicante!.x + 1e-9);
  });

  it('es relativa al tamaño del rótulo: otro tamaño de página/escala da la misma zona proporcional', () => {
    const a = localizarZonasFirma([caja('FIRMA DE LA EMPRESA', 0.2, 0.7, 0.18)]).empresa!;
    const b = localizarZonasFirma([caja('FIRMA DE LA EMPRESA', 0.5, 0.4, 0.18)]).empresa!;
    expect(b.ancho).toBeCloseTo(a.ancho, 6);
    expect(b.alto).toBeCloseTo(a.alto, 6);
  });

  it('reconoce el rótulo partido en palabras (OCR) y reparte una sola caja que trae los dos rótulos', () => {
    const palabras = ['FIRMA', 'DE', 'LA', 'EMPRESA'].map((t, i) => caja(t, 0.2 + i * 0.05, 0.7, 0.045));
    expect(localizarZonasFirma(palabras).empresa).not.toBeNull();
    const unaCaja = localizarZonasFirma([caja('FIRMA DE LA EMPRESA FIRMA DEL PRÁCTICANTE', 0.2, 0.7, 0.6)]);
    expect(unaCaja.empresa).not.toBeNull();
    expect(unaCaja.practicante).not.toBeNull();
    expect(unaCaja.empresa!.x + unaCaja.empresa!.ancho).toBeLessThanOrEqual(unaCaja.practicante!.x + 1e-9);
  });

  it('7 · rótulo ausente o ancla no plausible → sin zona (no_determinable), nunca una zona inventada', () => {
    const vacio = localizarZonasFirma([caja('Nombres y apellidos', 0.2, 0.7, 0.2)]);
    expect(vacio.empresa).toBeNull();
    expect(vacio.practicante).toBeNull();
    expect(vacio.motivos).toEqual(['empresa_rotulo_no_localizado', 'practicante_rotulo_no_localizado']);
    const gigante = localizarZonasFirma([caja('FIRMA DE LA EMPRESA', 0.2, 0.4, 0.5, 0.3)]);
    expect(gigante.empresa).toBeNull();
    expect(evaluarFirmasActa(TEXTO_CON_ROTULOS, { empresa: null, practicante: null }).firmaEmpresaPresente).toBe('no_determinable');
  });

  it('solo el texto leído con confianza se descuenta; el garabato que el OCR lee mal NO', () => {
    const z = localizarZonasFirma([
      { texto: 'Nombres', x: 0.1, y: 0.1, ancho: 0.1, alto: 0.01, confianza: 95 },
      { texto: 'xk~', x: 0.2, y: 0.6, ancho: 0.1, alto: 0.03, confianza: 30 },
    ]);
    expect(z.exclusiones).toHaveLength(1);
  });
});

describe('Acta de iniciación · firmas de punta a punta (PDF)', () => {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalActaService(lector, lector);
  afterAll(async () => { await lector.onModuleDestroy(); });
  const firmas = async (pdf: Buffer) => (await servicio.leer(pdf, 'application/pdf')).analisis.firmas;

  it.each<[string, Firma, Firma, string, string]>([
    ['sin firmas', 'ninguna', 'ninguna', 'no', 'no'],
    ['firma de la empresa', 'trazo', 'ninguna', 'si', 'no_determinable'],
    ['firma del practicante', 'ninguna', 'trazo', 'no_determinable', 'si'],
    ['ambas', 'trazo', 'trazo', 'si', 'si'],
    ['trazo que cruza la línea', 'linea_cruzada', 'trazo', 'si', 'si'],
    ['marca pequeña ambigua', 'pequeno', 'ninguna', 'no_determinable', 'no'],
  ])('PDF digital · %s', async (_n, empresa, practicante, esperadaEmpresa, esperadaPracticante) => {
    const f = await firmas(await pdfActaDigital({ firmaEmpresa: empresa, firmaPracticante: practicante }));
    expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual([esperadaEmpresa, esperadaPracticante]);
  }, 60_000);

  it('PDF digital sin rótulos de firma → no_determinable', async () => {
    const f = await firmas(await pdfActaDigital({ sinRotulosFirma: true, firmaEmpresa: 'trazo' }));
    expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual(['no_determinable', 'no_determinable']);
  }, 60_000);

  it('PDF solo con la página 1 (sin zona de firmas) → no_determinable', async () => {
    const f = await firmas(await pdfActaDigital({ paginas: 'primera' }));
    expect(f.firmaEmpresaPresente).toBe('no_determinable');
  }, 60_000);

  it('PDF escaneado: los rótulos se ubican por OCR y se mide la zona', async () => {
    const f = await firmas(await pdfActaEscaneada({ firmaEmpresa: 'trazo', firmaPracticante: 'ninguna' }));
    expect(f.firmaEmpresaPresente).toBe('si');
    expect(f.firmaPracticantePresente).toBe('no_determinable');
  }, 180_000);

  it('solo se mide en un acta: otro documento no produce firmas', async () => {
    const { pdfDeLineas } = await import('./soporte-acta-pdf');
    const f = await firmas(await pdfDeLineas(['CERTIFICADO DE AFILIACION', 'ESTADO DE AFILIACION: ACTIVO', 'REGIMEN: CONTRIBUTIVO', 'TIPO DE AFILIADO: COTIZANTE', 'SE ENCUENTRA ACTIVO AFILIADO']));
    expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual(['no_determinable', 'no_determinable']);
  }, 60_000);
});
