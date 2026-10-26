import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';

/**
 * Enlace de descarga firmado por la propia API (HMAC con vencimiento). Lo usa
 * el almacenamiento local siempre y el de Cloud Storage cuando no puede firmar
 * URL del bucket; el controlador de descarga verifica la firma y sirve el
 * archivo leyéndolo del almacenamiento activo.
 */
export function firmarEnlaceDescarga(secreto: string, ruta: string, minutos: number): string {
  const expira = Date.now() + minutos * 60_000;
  const firma = createHmac('sha256', secreto).update(`${ruta}:${expira}`).digest('hex');
  const params = new URLSearchParams({ ruta, expira: String(expira), firma });
  return `/api/v1/documentos/descarga?${params.toString()}`;
}

export function verificarEnlaceDescarga(secreto: string, ruta: string, expira: number, firma: string): boolean {
  if (Number.isNaN(expira) || expira < Date.now()) return false;
  const esperada = createHmac('sha256', secreto).update(`${ruta}:${expira}`).digest('hex');
  return esperada === firma;
}

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
    this.secreto = config.get<string>('JWT_SECRETO') ?? 'local';
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

  /** Firma HMAC con vencimiento; el controlador de descarga la verifica. */
  async enlaceFirmado(ruta: string, minutos: number): Promise<string> {
    return firmarEnlaceDescarga(this.secreto, ruta, minutos);
  }

  verificarFirma(ruta: string, expira: number, firma: string): boolean {
    return verificarEnlaceDescarga(this.secreto, ruta, expira, firma);
  }

  /** Impide salir del directorio raíz por rutas con `..`. */
  private resolver(ruta: string): string {
    const destino = resolve(join(this.raiz, normalize(ruta)));
    if (destino !== this.raiz && !destino.startsWith(this.raiz + sep)) {
      throw new NotFoundException('Documento no encontrado');
    }
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
    this.secreto = config.get<string>('JWT_SECRETO') ?? 'local';
  }

  private async bucketRef(): Promise<{
    file: (ruta: string) => {
      save: (c: Buffer, o: unknown) => Promise<void>;
      download: () => Promise<[Buffer]>;
      delete: (o?: unknown) => Promise<unknown>;
      getSignedUrl: (o: unknown) => Promise<[string]>;
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
   * URL firmada del bucket cuando la identidad puede firmar (exige
   * iam.serviceAccountTokenCreator sobre sí misma en Cloud Run). Si no puede,
   * el enlace lo firma la API y el archivo se sirve a través de ella: la
   * persona ve el documento igual, sin exponer el bucket.
   */
  async enlaceFirmado(ruta: string, minutos: number): Promise<string> {
    try {
      const bucket = await this.bucketRef();
      const [url] = await bucket.file(ruta).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + minutos * 60_000,
      });
      return url;
    } catch (error) {
      this.log.warn(`No se pudo firmar la URL de ${ruta} en GCS (${(error as Error).message}); se sirve por la API.`);
      return firmarEnlaceDescarga(this.secreto, ruta, minutos);
    }
  }
}
