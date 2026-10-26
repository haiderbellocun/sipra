import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as verificarFirma,
} from 'node:crypto';

/** Ventana en la que el `state` firmado sirve para completar el ingreso. */
const VIGENCIA_STATE_SEGUNDOS = 600;

interface ClaveJwk {
  kid: string; kty: string; n: string; e: string; alg: string; use: string;
}

export interface IdentidadOidc {
  correo: string;
  nombre: string;
  dominio: string;
  sub: string;
}

/**
 * OIDC contra Google Workspace (M1). Verifica la firma del id_token contra las
 * claves publicadas por Google y exige que el dominio del correo pertenezca al
 * directorio institucional: el retiro de un usuario revoca el acceso solo.
 *
 * Sin dependencias adicionales: la verificación RS256 usa `node:crypto`.
 */
@Injectable()
export class OidcService {
  private readonly log = new Logger(OidcService.name);
  private clavesCache: { claves: ClaveJwk[]; expira: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  get habilitado(): boolean {
    return this.config.get<string>('AUTH_MODO') === 'oidc';
  }

  /**
   * URL de autorización. El `state` es un valor firmado que lleva dos aleatorios
   * independientes —`csrf` y `nonce`— y su vencimiento; el servidor no guarda nada.
   * El cliente conserva el `state` completo y lo compara al regresar. El `nonce`
   * viaja también en la URL hacia Google, que lo copia dentro del id_token.
   */
  urlAutorizacion(): { url: string; state: string } {
    const nonce = randomBytes(32).toString('base64url');
    const state = this.firmarState({
      csrf: randomBytes(32).toString('base64url'),
      nonce,
      exp: Math.floor(Date.now() / 1000) + VIGENCIA_STATE_SEGUNDOS,
    });
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('OIDC_CLIENT_ID'),
      redirect_uri: this.config.getOrThrow<string>('OIDC_REDIRECT_URI'),
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      hd: this.dominios[0],
      state,
      nonce,
    });
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
    };
  }

  /**
   * Comprueba integridad (HMAC) y vencimiento del `state` y devuelve su contenido.
   * Cualquier defecto se rechaza con el mismo mensaje genérico.
   */
  verificarState(state: string): { csrf: string; nonce: string } {
    const invalido = (): never => {
      throw new UnauthorizedException('Sesión de ingreso inválida o vencida');
    };
    if (typeof state !== 'string' || state.length === 0 || state.length > 1024) return invalido();

    const partes = state.split('.');
    if (partes.length !== 2 || !partes[0] || !partes[1]) return invalido();
    const [cargaB64, firmaB64] = partes;

    const esperada = this.hmacState(cargaB64);
    const recibida = Buffer.from(firmaB64, 'base64url');
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return invalido();

    let carga: { csrf?: unknown; nonce?: unknown; exp?: unknown };
    try {
      carga = JSON.parse(base64UrlADecodificado(cargaB64)) as typeof carga;
    } catch {
      return invalido();
    }
    if (
      typeof carga.csrf !== 'string' || !carga.csrf ||
      typeof carga.nonce !== 'string' || !carga.nonce ||
      typeof carga.exp !== 'number' || carga.exp * 1000 < Date.now()
    ) {
      return invalido();
    }
    return { csrf: carga.csrf, nonce: carga.nonce };
  }

  /** Verifica el `state`, canjea el código y valida el id_token contra el nonce del `state`. */
  async intercambiarCodigo(codigo: string, state: string): Promise<IdentidadOidc> {
    if (typeof codigo !== 'string' || codigo.length === 0) {
      throw new BadRequestException('No fue posible completar el ingreso institucional');
    }
    const { nonce } = this.verificarState(state);

    let respuesta: Response;
    try {
      respuesta = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: codigo,
          client_id: this.config.getOrThrow<string>('OIDC_CLIENT_ID'),
          client_secret: this.config.getOrThrow<string>('OIDC_CLIENT_SECRET'),
          redirect_uri: this.config.getOrThrow<string>('OIDC_REDIRECT_URI'),
          grant_type: 'authorization_code',
        }),
      });
    } catch {
      throw new BadRequestException('No fue posible completar el ingreso institucional');
    }
    if (!respuesta.ok) {
      throw new BadRequestException('No fue posible completar el ingreso institucional');
    }
    let idToken: string | undefined;
    try {
      idToken = ((await respuesta.json()) as { id_token?: string }).id_token;
    } catch {
      idToken = undefined;
    }
    if (!idToken) throw new BadRequestException('No fue posible completar el ingreso institucional');
    return this.verificarIdToken(idToken, nonce);
  }

  /** El nonce es obligatorio: sin el esperado, o sin el del token, no hay ingreso. */
  async verificarIdToken(idToken: string, nonceEsperado: string): Promise<IdentidadOidc> {
    const [cabeceraB64, cargaB64, firmaB64] = idToken.split('.');
    if (!cabeceraB64 || !cargaB64 || !firmaB64) {
      throw new UnauthorizedException('id_token malformado');
    }

    let cabecera: { kid: string; alg: string };
    try {
      cabecera = JSON.parse(base64UrlADecodificado(cabeceraB64)) as { kid: string; alg: string };
    } catch {
      throw new UnauthorizedException('id_token malformado');
    }
    if (cabecera.alg !== 'RS256') throw new UnauthorizedException('Algoritmo no admitido');

    const clave = (await this.claves()).find((c) => c.kid === cabecera.kid);
    if (!clave) throw new UnauthorizedException('Clave de firma desconocida');

    const publica = createPublicKey({
      key: { kty: clave.kty, n: clave.n, e: clave.e },
      format: 'jwk',
    });
    const valida = verificarFirma(
      'RSA-SHA256',
      Buffer.from(`${cabeceraB64}.${cargaB64}`),
      publica,
      Buffer.from(firmaB64, 'base64url'),
    );
    if (!valida) throw new UnauthorizedException('Firma del id_token inválida');

    let carga: {
      iss: string; aud: string; exp: number; email?: string; email_verified?: boolean;
      name?: string; hd?: string; sub: string; nonce?: string;
    };
    try {
      carga = JSON.parse(base64UrlADecodificado(cargaB64)) as typeof carga;
    } catch {
      throw new UnauthorizedException('id_token malformado');
    }

    if (!['https://accounts.google.com', 'accounts.google.com'].includes(carga.iss)) {
      throw new UnauthorizedException('Emisor no reconocido');
    }
    if (carga.aud !== this.config.getOrThrow<string>('OIDC_CLIENT_ID')) {
      throw new UnauthorizedException('El token no fue emitido para esta aplicación');
    }
    if (carga.exp * 1000 < Date.now()) throw new UnauthorizedException('Token vencido');
    if (!nonceEsperado || typeof carga.nonce !== 'string' || !igualesEnTiempoConstante(carga.nonce, nonceEsperado)) {
      throw new UnauthorizedException('Nonce no coincide');
    }
    if (!carga.email || carga.email_verified === false) {
      throw new UnauthorizedException('Correo no verificado');
    }

    const dominio = carga.hd ?? carga.email.split('@')[1];
    if (!this.dominios.includes(dominio)) {
      this.log.warn(`Intento de ingreso desde dominio no institucional: ${dominio}`);
      throw new UnauthorizedException('Solo se admiten cuentas institucionales de la CUN');
    }

    return {
      correo: carga.email.toLowerCase(),
      nombre: carga.name ?? carga.email,
      dominio,
      sub: carga.sub,
    };
  }

  /**
   * Verifica un id_token emitido por Google para una CUENTA DE SERVICIO, no
   * para una persona. Lo usa el endpoint worker que dispara Cloud Tasks: la
   * petición no viene de un usuario, viene de la propia infraestructura.
   */
  async verificarTokenDeServicio(
    idToken: string,
    correoEsperado: string,
  ): Promise<{ correo: string } | null> {
    const [cabeceraB64, cargaB64, firmaB64] = idToken.split('.');
    if (!cabeceraB64 || !cargaB64 || !firmaB64) return null;

    const cabecera = JSON.parse(base64UrlADecodificado(cabeceraB64)) as { kid: string; alg: string };
    if (cabecera.alg !== 'RS256') return null;

    const clave = (await this.claves()).find((c) => c.kid === cabecera.kid);
    if (!clave) return null;

    const publica = createPublicKey({
      key: { kty: clave.kty, n: clave.n, e: clave.e },
      format: 'jwk',
    });
    const valida = verificarFirma(
      'RSA-SHA256',
      Buffer.from(`${cabeceraB64}.${cargaB64}`),
      publica,
      Buffer.from(firmaB64, 'base64url'),
    );
    if (!valida) return null;

    const carga = JSON.parse(base64UrlADecodificado(cargaB64)) as {
      iss: string; exp: number; email?: string; email_verified?: boolean;
    };
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(carga.iss)) return null;
    if (carga.exp * 1000 < Date.now()) return null;
    if (carga.email !== correoEsperado) {
      this.log.warn(`Token de servicio con identidad inesperada: ${carga.email ?? 'sin correo'}`);
      return null;
    }
    return { correo: carga.email };
  }

  private firmarState(carga: { csrf: string; nonce: string; exp: number }): string {
    const cargaB64 = Buffer.from(JSON.stringify(carga), 'utf8').toString('base64url');
    return `${cargaB64}.${this.hmacState(cargaB64).toString('base64url')}`;
  }

  /** Clave propia del `state`, derivada del secreto de firma: no se reutiliza la del JWT tal cual. */
  private hmacState(cargaB64: string): Buffer {
    const clave = createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRETO'))
      .update('sipra:oidc:state:v1')
      .digest();
    return createHmac('sha256', clave).update(cargaB64).digest();
  }

  private get dominios(): string[] {
    return (this.config.get<string>('OIDC_DOMINIOS_PERMITIDOS') ?? 'cun.edu.co')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
  }

  private async claves(): Promise<ClaveJwk[]> {
    if (this.clavesCache && this.clavesCache.expira > Date.now()) return this.clavesCache.claves;
    const respuesta = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!respuesta.ok) throw new UnauthorizedException('No fue posible obtener las claves de Google');
    const { keys } = (await respuesta.json()) as { keys: ClaveJwk[] };
    this.clavesCache = { claves: keys, expira: Date.now() + 3_600_000 };
    return keys;
  }
}

function base64UrlADecodificado(valor: string): string {
  return Buffer.from(valor, 'base64url').toString('utf8');
}

function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function huellaCorreo(correo: string): string {
  return createHash('sha256').update(correo.toLowerCase()).digest('hex').slice(0, 16);
}
