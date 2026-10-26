import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPublicKey, randomBytes, verify as verificarFirma } from 'node:crypto';

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

  /** URL de autorización con `state` y `nonce` de un solo uso. */
  urlAutorizacion(): { url: string; state: string; nonce: string } {
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
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
      nonce,
    };
  }

  async intercambiarCodigo(codigo: string, nonceEsperado: string): Promise<IdentidadOidc> {
    const respuesta = await fetch('https://oauth2.googleapis.com/token', {
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
    if (!respuesta.ok) {
      throw new BadRequestException('No fue posible completar el ingreso institucional');
    }
    const { id_token: idToken } = (await respuesta.json()) as { id_token?: string };
    if (!idToken) throw new BadRequestException('Google no devolvió un id_token');
    return this.verificarIdToken(idToken, nonceEsperado);
  }

  async verificarIdToken(idToken: string, nonceEsperado?: string): Promise<IdentidadOidc> {
    const [cabeceraB64, cargaB64, firmaB64] = idToken.split('.');
    if (!cabeceraB64 || !cargaB64 || !firmaB64) {
      throw new UnauthorizedException('id_token malformado');
    }

    const cabecera = JSON.parse(base64UrlADecodificado(cabeceraB64)) as { kid: string; alg: string };
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

    const carga = JSON.parse(base64UrlADecodificado(cargaB64)) as {
      iss: string; aud: string; exp: number; email?: string; email_verified?: boolean;
      name?: string; hd?: string; sub: string; nonce?: string;
    };

    if (!['https://accounts.google.com', 'accounts.google.com'].includes(carga.iss)) {
      throw new UnauthorizedException('Emisor no reconocido');
    }
    if (carga.aud !== this.config.getOrThrow<string>('OIDC_CLIENT_ID')) {
      throw new UnauthorizedException('El token no fue emitido para esta aplicación');
    }
    if (carga.exp * 1000 < Date.now()) throw new UnauthorizedException('Token vencido');
    if (nonceEsperado && carga.nonce !== nonceEsperado) {
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

export function huellaCorreo(correo: string): string {
  return createHash('sha256').update(correo.toLowerCase()).digest('hex').slice(0, 16);
}
