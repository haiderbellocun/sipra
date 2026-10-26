import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';
import {
  MensajeNotificacion, NotificacionPort, ResultadoEnvio,
} from '../../../domain/ports/out/servicios-externos.port';

/**
 * Envío de correo por Google Workspace (M10).
 *
 * Usa la API de Gmail con una cuenta de servicio y delegación en todo el
 * dominio, que es el mecanismo que permite a una aplicación enviar «como» la
 * cuenta institucional de prácticas sin conocer su contraseña.
 *
 * Se firma el JWT con `node:crypto` en vez de arrastrar el SDK de Google:
 * son treinta líneas, y evita una dependencia con superficie muy superior a
 * lo que este servicio necesita.
 *
 * CONFIGURACIÓN QUE DEBE ENTREGAR TECNOLOGÍA
 * ──────────────────────────────────────────
 *  · Cuenta de servicio con delegación en todo el dominio, autorizada para el
 *    alcance https://www.googleapis.com/auth/gmail.send
 *  · Su clave privada, en Secret Manager (nunca en el repositorio)
 *  · La dirección institucional desde la que se envía
 */
@Injectable()
export class NotificacionWorkspaceAdapter implements NotificacionPort {
  private readonly log = new Logger(NotificacionWorkspaceAdapter.name);
  private token: { valor: string; expiraEn: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  async enviar(mensaje: MensajeNotificacion): Promise<ResultadoEnvio> {
    try {
      const acceso = await this.tokenDeAcceso();
      const remitente = this.config.getOrThrow<string>('CORREO_REMITENTE');
      const crudo = this.construirMime(mensaje, remitente);

      const respuesta = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${acceso}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ raw: crudo }),
        },
      );

      if (!respuesta.ok) {
        const detalle = await respuesta.text();
        this.log.error(`Gmail respondió ${respuesta.status}: ${detalle.slice(0, 300)}`);
        return {
          enviado: false,
          referencia: null,
          motivo: `El proveedor de correo respondió ${respuesta.status}`,
        };
      }

      const { id } = (await respuesta.json()) as { id?: string };
      // Sin el destinatario: el correo es un dato personal y no hace falta en el registro operativo.
      this.log.log(`Correo enviado (${mensaje.plantilla ?? 'sin plantilla'}, referencia ${id ?? 'sin referencia'})`);
      return { enviado: true, referencia: id ?? null };
    } catch (error) {
      // Un fallo de correo no puede tumbar el pipeline: el documento ya se
      // procesó y su estado es correcto. Se informa y se sigue.
      this.log.error(`No fue posible enviar el correo: ${(error as Error).message}`);
      return { enviado: false, referencia: null, motivo: (error as Error).message };
    }
  }

  /**
   * Construye el mensaje MIME. Se envía multiparte cuando hay HTML, para que
   * los clientes que no lo admiten reciban igual el texto plano.
   */
  private construirMime(mensaje: MensajeNotificacion, remitente: string): string {
    const asunto = `=?UTF-8?B?${Buffer.from(mensaje.asunto, 'utf8').toString('base64')}?=`;
    const cabeceras = [
      `From: SIPRA Prácticas <${remitente}>`,
      `To: ${mensaje.destinatario}`,
      `Subject: ${asunto}`,
      'MIME-Version: 1.0',
      // Marca el correo como automático: evita respuestas automáticas de
      // ausencia y que los filtros lo traten como conversación.
      'Auto-Submitted: auto-generated',
    ];

    let cuerpo: string;
    if (mensaje.html) {
      const frontera = `sipra_${Date.now().toString(36)}`;
      cabeceras.push(`Content-Type: multipart/alternative; boundary="${frontera}"`);
      cuerpo = [
        '',
        `--${frontera}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(mensaje.cuerpo, 'utf8').toString('base64'),
        `--${frontera}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(mensaje.html, 'utf8').toString('base64'),
        `--${frontera}--`,
      ].join('\r\n');
    } else {
      cabeceras.push('Content-Type: text/plain; charset=UTF-8');
      cabeceras.push('Content-Transfer-Encoding: base64');
      cuerpo = `\r\n${Buffer.from(mensaje.cuerpo, 'utf8').toString('base64')}`;
    }

    // Gmail exige base64url, sin relleno.
    return Buffer.from(cabeceras.join('\r\n') + cuerpo, 'utf8').toString('base64url');
  }

  /** Token de acceso por JWT firmado, con reutilización mientras siga vigente. */
  private async tokenDeAcceso(): Promise<string> {
    if (this.token && this.token.expiraEn > Date.now() + 60_000) return this.token.valor;

    const correoServicio = this.config.getOrThrow<string>('WORKSPACE_CUENTA_SERVICIO');
    const clavePrivada = this.config
      .getOrThrow<string>('WORKSPACE_CLAVE_PRIVADA')
      .replace(/\\n/g, '\n');
    const suplantar = this.config.getOrThrow<string>('CORREO_REMITENTE');

    const ahora = Math.floor(Date.now() / 1000);
    const cabecera = { alg: 'RS256', typ: 'JWT' };
    const carga = {
      iss: correoServicio,
      // La delegación en todo el dominio permite actuar «como» esta dirección.
      sub: suplantar,
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
      iat: ahora,
      exp: ahora + 3600,
    };

    const base = `${base64Url(cabecera)}.${base64Url(carga)}`;
    const firma = createSign('RSA-SHA256').update(base).sign(clavePrivada).toString('base64url');

    const respuesta = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${base}.${firma}`,
      }),
    });

    if (!respuesta.ok) {
      throw new Error(
        `No fue posible obtener el token de Workspace (${respuesta.status}). ` +
          'Verifique la delegación en todo el dominio y el alcance gmail.send.',
      );
    }

    const { access_token: valor, expires_in: vigencia } = (await respuesta.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = { valor, expiraEn: Date.now() + vigencia * 1000 };
    return valor;
  }
}

function base64Url(objeto: unknown): string {
  return Buffer.from(JSON.stringify(objeto), 'utf8').toString('base64url');
}
