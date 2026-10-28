import { NotFoundException } from '@nestjs/common';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { SaneamientoPdfDomainService } from '../src/domain/services/saneamiento-pdf.domain-service';
import { AlmacenamientoLocalAdapter } from '../src/infrastructure/adapters/storage/almacenamiento.adapter';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { pdfDigital } from './soporte-lectura-local';

/**
 * Regresión de seguridad de archivos (Fase 6). Solo PDF, PNG y JPEG; el nombre que envía la
 * persona NUNCA forma parte de la ruta; el contenido hostil se degrada a «ilegible», jamás
 * a un error del sistema ni a una aprobación. Datos 100 % sintéticos.
 */

jest.setTimeout(240_000);

describe('Almacenamiento local · rutas', () => {
  let raiz: string;
  let afuera: string;
  let almacen: AlmacenamientoLocalAdapter;
  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'sipra-alm-'));
    raiz = join(base, 'raiz');
    afuera = base;
    almacen = new AlmacenamientoLocalAdapter({
      get: (k: string) => (k === 'STORAGE_RUTA_LOCAL' ? raiz : undefined),
      getOrThrow: () => 'secreto-de-prueba-de-al-menos-32-caracteres',
    } as never);
  });
  afterEach(() => rmSync(afuera, { recursive: true, force: true }));

  it.each([
    '../fuera.txt', '..\\fuera.txt', 'a/../../fuera.txt', 'a\\..\\..\\fuera.txt',
    'practicas/../../fuera.txt', 'practicas\\..\\..\\fuera.txt', './../fuera.txt', '.\\..\\fuera.txt',
    'a/..\\../fuera.txt', 'a\\../..\\fuera.txt', '..', '..\\', 'practicas/../..',
  ])(
    'una ruta que sale de la raíz se rechaza y NO escribe fuera: %s',
    async (ruta) => {
      await expect(almacen.guardar(ruta, Buffer.from('x'), 'application/pdf')).rejects.toBeInstanceOf(NotFoundException);
      await expect(almacen.leer(ruta)).rejects.toBeInstanceOf(NotFoundException);
      await expect(almacen.eliminar(ruta)).rejects.toBeInstanceOf(NotFoundException);
      expect(existsSync(join(afuera, 'fuera.txt'))).toBe(false);
      expect(readdirSync(afuera)).toEqual(existsSync(raiz) ? ['raiz'] : []);
    },
  );

  it.each([
    '/etc/passwd', '\\etc\\passwd', 'C:\\Windows\\fuera.txt', 'C:/Windows/fuera.txt', 'c:fuera.txt',
    '\\\\servidor\\recurso\\fuera.txt', '//servidor/recurso/fuera.txt', '/\\servidor/fuera.txt',
    'practicas/C:\\fuera.txt', 'practicas\\a\0b', '', '.', './', 'practicas/%2e%2e/%2e%2e/fuera.txt/..',
  ])('una ruta absoluta, UNC, con unidad o vacía se rechaza y nada se escribe fuera (%j)', async (ruta) => {
    await expect(almacen.guardar(ruta, Buffer.from('x'), 'application/pdf')).rejects.toBeInstanceOf(NotFoundException);
    await expect(almacen.leer(ruta)).rejects.toBeInstanceOf(NotFoundException);
    await expect(almacen.eliminar(ruta)).rejects.toBeInstanceOf(NotFoundException);
    expect(readdirSync(afuera)).toEqual(existsSync(raiz) ? ['raiz'] : []);
  });

  it.each(['practicas/a/b', 'practicas\\a\\b', 'practicas/./a//b', 'practicas/%2e%2e/b', 'a..b/c'])(
    'rutas internas con cualquier separador quedan DENTRO de la raíz (%s)', async (ruta) => {
      await almacen.guardar(ruta, Buffer.from('x'), 'application/pdf');
      expect((await almacen.leer(ruta)).toString()).toBe('x');
      expect(readdirSync(afuera)).toEqual(['raiz']);
      await almacen.eliminar(ruta);
    },
  );

  it('una ruta legítima (la que construye el servidor) guarda, lee y elimina dentro de la raíz', async () => {
    const ruta = `practicas/${'0'.repeat(8)}/certificado_eps/${'a'.repeat(32)}`;
    await almacen.guardar(ruta, Buffer.from('contenido'), 'application/pdf');
    expect((await almacen.leer(ruta)).toString()).toBe('contenido');
    await almacen.eliminar(ruta);
    await expect(almacen.leer(ruta)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Lectura local · documentos hostiles', () => {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalEpsService(lector);
  afterAll(async () => { await lector.onModuleDestroy(); });

  const cifrado = (): Promise<Buffer> => new Promise((ok) => {
    const doc = new PDFDocument({ userPassword: 'clave-usuario', ownerPassword: 'clave-dueno', permissions: { printing: 'lowResolution' } });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.text('Nombre: PERSONA PRUEBA\nDocumento: CC 1.032.456.786');
    doc.end();
  });

  it('un PDF CIFRADO no se lee y no rompe: queda ilegible (se pide reenvío)', async () => {
    const r = await servicio.leer(await cifrado(), 'application/pdf');
    expect(r.ilegible).toBe(true);
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
  });

  it.each([
    ['archivo vacío', Buffer.alloc(0)],
    ['un solo byte', Buffer.from([0x25])],
    ['solo la firma %PDF- sin nada más', Buffer.from('%PDF-1.7\n')],
    ['firma de PDF con basura binaria', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 0xff)])],
    ['ceros', Buffer.alloc(65_536)],
  ])('%s: ilegible, sin excepción ni aprobación', async (_n, contenido) => {
    const r = await servicio.leer(contenido, 'application/pdf');
    expect(r.ilegible).toBe(true);
  });

  it('un PDF con cientos de páginas lee solo las primeras y avisa del recorte (no agota la memoria ni el tiempo)', async () => {
    const t0 = Date.now();
    const r = await servicio.leer(await pdfDigital(undefined, { paginas: 300 }), 'application/pdf');
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(r.resumen.limitesAplicados.length).toBeGreaterThan(0);
  });

  it.each([
    ['/Launch', '/S /Launch /F (calc.exe)'],
    ['/EmbeddedFile', '/Type /EmbeddedFile /Length 1'],
    ['/OpenAction', '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'],
    ['/AA', '/AA << /O << /S /JavaScript /JS (x) >> >>'],
    ['/JavaScript', '/S /JavaScript /JS (this.print())'],
  ])('el saneamiento neutraliza %s antes de que cualquier lector lo vea', (token, fragmento) => {
    const entrada = Buffer.from(`%PDF-1.7\n1 0 obj\n<< ${fragmento} >>\nendobj\n%%EOF`, 'latin1');
    const salida = new SaneamientoPdfDomainService().sanear(entrada);
    expect(salida.contenido.toString('latin1')).not.toContain(token + ' ');
    expect(salida.contenido.toString('latin1')).not.toMatch(new RegExp(`${token.replace('/', '\\/')}(?![A-Za-z0-9_])`));
    expect(salida.contenido.length).toBe(entrada.length); // mismo tamaño: no se corrompen los desplazamientos del PDF
  });

  it('una «bomba» de imagen (PNG que declara 60.000 × 60.000 px) se rechaza por píxeles sin reservar memoria', async () => {
    const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(60_000, 8); ihdr.writeUInt32BE(60_000, 12); ihdr[16] = 8; ihdr[17] = 2;
    const png = Buffer.concat([firma, ihdr, Buffer.alloc(32)]);
    const antes = process.memoryUsage().rss;
    const r = await servicio.leer(png, 'image/png');
    // No se rasteriza ni se pasa al OCR: queda sin campos leídos, con el límite anotado → revisión humana del archivo original.
    expect(r.resumen.limitesAplicados).toContain('pagina_excede_pixeles');
    expect(r.resumen.ocr.ejecutado).toBe(false);
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
    expect(process.memoryUsage().rss - antes).toBeLessThan(400 * 1_048_576);
  });

  it('un nombre de archivo hostil no cambia nada: la lectura no lo usa', async () => {
    writeFileSync(join(tmpdir(), 'sipra-nombre-hostil.tmp'), 'x');
    const r = await servicio.leer(await pdfDigital(), 'application/pdf');
    expect(r.ilegible).toBe(false);
    rmSync(join(tmpdir(), 'sipra-nombre-hostil.tmp'), { force: true });
  });
});
