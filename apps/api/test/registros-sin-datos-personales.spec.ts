import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OidcService } from '../src/infrastructure/auth/oidc.service';
import { NotificacionesService } from '../src/infrastructure/modules/notificaciones.service';

/**
 * Los registros operativos no llevan correos personales. (La auditoría
 * inmutable sí guarda a quién se avisó: es evidencia, no un registro operativo.)
 */

const CORREO_PERSONAL = 'laura.ramirez@estudiante.cun.edu.co';

afterEach(() => jest.restoreAllMocks());

describe('Registros operativos sin datos personales', () => {
  it('un fallo de notificación no escribe el correo del destinatario en el registro', async () => {
    const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const servicio = new NotificacionesService(
      { enviar: () => Promise.resolve({ enviado: false, referencia: null, motivo: 'proveedor caído' }) },
      { registrar: () => Promise.resolve() } as never,
    );
    await servicio.notificar('documento_devuelto' as never, { correo: CORREO_PERSONAL, nombre: 'Laura Ramírez' }, {});

    const escrito = aviso.mock.calls.map((c) => String(c[0])).join('\n');
    expect(escrito).toContain('No se pudo notificar');
    expect(escrito).toContain('proveedor caído');
    expect(escrito).not.toContain(CORREO_PERSONAL);
    expect(escrito).not.toContain('laura');
    expect(escrito).not.toContain('Ramírez');
  });

  it('un token de servicio con otra identidad registra solo el dominio, no la dirección', async () => {
    const par = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...par.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ keys: [jwk] })));
    const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
    const cabecera = b64({ alg: 'RS256', kid: 'k1' });
    const carga = b64({
      iss: 'https://accounts.google.com', aud: 'https://worker.example', exp: Math.floor(Date.now() / 1000) + 600,
      email: CORREO_PERSONAL, email_verified: true,
    });
    const firma = sign('RSA-SHA256', Buffer.from(`${cabecera}.${carga}`), par.privateKey).toString('base64url');

    const oidc = new OidcService(new ConfigService({ JWT_SECRETO: 'x'.repeat(40) }));
    const identidad = await oidc.verificarTokenDeServicio(
      `${cabecera}.${carga}.${firma}`, 'sipra@proyecto.iam.gserviceaccount.com', 'https://worker.example',
    );

    expect(identidad).toBeNull();
    const escrito = aviso.mock.calls.map((c) => String(c[0])).join('\n');
    expect(escrito).toContain('estudiante.cun.edu.co');
    expect(escrito).not.toContain(CORREO_PERSONAL);
    expect(escrito).not.toContain('laura.ramirez');
  });
});
