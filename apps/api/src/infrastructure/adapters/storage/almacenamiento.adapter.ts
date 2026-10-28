import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  AlmacenamientoPort, ContextoEnlaceDocumento,
} from '../../../domain/ports/out/servicios-externos.port';
import { firmarEnlaceDocumento } from './enlace-documento';

/**
 * Almacenamiento en disco. Ambiente local únicamente: la validación de
 * configuración exige `STORAGE_DRIVER=gcs` en preproducción y producción.
 */
@Injectable()
export class AlmacenamientoLocalAdapter implements AlmacenamientoPort {
  private readonly log = new Logger(AlmacenamientoLocalAdapter.name);
  private readonly raiz: string;
  private readonly secreto: string;

  constructor(config: ConfigService) {
    this.raiz = resolve(config.get<string>('STORAGE_RUTA_LOCAL') ?? './.almacen');
    this.secreto = config.getOrThrow<string>('JWT_SECRETO');
  }

  async guardar(ruta: string, contenido: Buffer, _mime: string): Promise<string> {
    const destino = this.resolver(ruta);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, contenido);
    return ruta;
  }

  async leer(ruta: string): Promise<Buffer> {
    try {
      return await readFile(this.resolver(ruta));
    } catch {
      throw new NotFoundException('Documento no encontrado');
    }
  }

  async eliminar(ruta: string): Promise<void> {
    await rm(this.resolver(ruta), { force: true });
    this.log.log(`Documento purgado: ${ruta}`);
  }

  /** Enlace firmado por la API; el controlador de descarga lo verifica y audita. */
  async enlaceFirmado(contexto: ContextoEnlaceDocumento, minutos: number): Promise<string> {
    return firmarEnlaceDocumento(this.secreto, contexto, minutos);
  }

  /**
   * Impide salir del directorio raíz, igual en Windows y en Linux. `/` y `\` se tratan SIEMPRE como
   * separadores (en Linux `\` es un carácter válido de nombre y `..\x` no sería un salto para el SO,
   * pero la misma ruta sí lo es si luego se sirve desde Windows). Se validan los segmentos —sin `..`,
   * sin ruta absoluta (`/x`, `C:\x`, `\\servidor\x`), sin unidad ni bytes nulos— y solo entonces se
   * resuelve contra la raíz y se comprueba pertenencia. No se decodifica nada: la ruta llega ya decodificada.
   */
  private resolver(ruta: string): string {
    const rechazar = (): never => { throw new NotFoundException('Documento no encontrado'); };
    if (typeof ruta !== 'string' || ruta.length === 0 || ruta.includes('\0')) rechazar();
    const unificada = ruta.replace(/\\/g, '/');
    if (unificada.startsWith('/') || /^[a-zA-Z]:/.test(unificada)) rechazar();
    const segmentos = unificada.split('/').filter((s) => s !== '' && s !== '.');
    if (segmentos.length === 0 || segmentos.some((s) => s === '..' || s.includes(':'))) rechazar();
    const destino = resolve(this.raiz, ...segmentos);
    const relativa = relative(this.raiz, destino);
    if (relativa === '' || relativa === '..' || relativa.startsWith('..' + sep) || isAbsolute(relativa)) rechazar();
    return destino;
  }
}

/**
 * Cloud Storage. Buckets privados, rutas no adivinables y enlaces firmados de
 * vigencia corta (sección 5.3 del documento técnico).
 */
@Injectable()
export class AlmacenamientoGcsAdapter implements AlmacenamientoPort {
  private readonly log = new Logger(AlmacenamientoGcsAdapter.name);
  private readonly bucket: string;
  private readonly secreto: string;
  // Carga diferida: el SDK solo se requiere cuando el driver es gcs.
  private clienteCache: unknown;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('GCS_BUCKET') ?? '';
    this.secreto = config.getOrThrow<string>('JWT_SECRETO');
  }

  private async bucketRef(): Promise<{
    file: (ruta: string) => {
      save: (c: Buffer, o: unknown) => Promise<void>;
      download: () => Promise<[Buffer]>;
      delete: (o?: unknown) => Promise<unknown>;
    };
  }> {
    if (!this.clienteCache) {
      const { Storage } = await import('@google-cloud/storage');
      this.clienteCache = new Storage();
    }
    const storage = this.clienteCache as { bucket: (n: string) => never };
    return storage.bucket(this.bucket);
  }

  async guardar(ruta: string, contenido: Buffer, mime: string): Promise<string> {
    const bucket = await this.bucketRef();
    await bucket.file(ruta).save(contenido, {
      contentType: mime,
      resumable: false,
      // El bucket es privado por política (acceso uniforme a nivel de bucket y
      // prevención de acceso público). No se fija ACL por objeto: con acceso
      // uniforme, Cloud Storage rechaza cualquier ACL heredada.
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });
    return ruta;
  }

  async leer(ruta: string): Promise<Buffer> {
    const bucket = await this.bucketRef();
    const [contenido] = await bucket.file(ruta).download();
    return contenido;
  }

  async eliminar(ruta: string): Promise<void> {
    const bucket = await this.bucketRef();
    await bucket.file(ruta).delete({ ignoreNotFound: true });
    this.log.log(`Documento purgado de GCS: ${ruta}`);
  }

  /**
   * El enlace lo firma la API y el archivo se sirve a través de ella. No se usa
   * la URL firmada nativa del bucket: esa descarga no pasa por la API y no
   * podría auditarse. El bucket permanece privado.
   */
  async enlaceFirmado(contexto: ContextoEnlaceDocumento, minutos: number): Promise<string> {
    return firmarEnlaceDocumento(this.secreto, contexto, minutos);
  }
}
