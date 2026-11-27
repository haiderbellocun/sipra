import { ConfigService } from '@nestjs/config';
import { interruptoresDecisionAutomatica } from '../src/application/services/interruptores-decision-automatica';
import { DecisionAutomaticaNoAplicableError, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { permiteAutoAprobacionDelPipeline, modoProcesamientoDe, ModoProcesamiento } from '../src/domain/services/politica-procesamiento';
import { VariablesEntorno, validarEntorno } from '../src/infrastructure/config/configuracion';

/** Configuración fail-closed del motor de decisión automática (1.6A). Fixtures sintéticos. */

const BASE: Record<string, unknown> = {
  SIPRA_AMBIENTE: 'dev', AUTH_MODO: 'abierto', AUTH_ABIERTO_CONFIRMADO: 'true',
  JWT_SECRETO: 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres', DB_HOST: 'localhost', DB_USER: 'sipra', DB_PASSWORD: 'sipra', DB_NAME: 'sipra',
};
const OIDC = { AUTH_MODO: 'oidc', OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 's', OIDC_REDIRECT_URI: 'http://localhost:4200/ingreso/callback', METRICAS_HABILITADAS: 'false' };
const ESPECIFICOS = [
  'AUTO_APROBACION_EPS', 'AUTO_APROBACION_RUT', 'AUTO_APROBACION_CAMARA', 'AUTO_APROBACION_ARL',
  'AUTO_DEVOLUCION_DOCUMENTO_INCORRECTO', 'AUTO_DEVOLUCION_INCUMPLIMIENTO',
] as const;
const entorno = (extra: Record<string, unknown> = {}): VariablesEntorno => validarEntorno({ ...BASE, ...extra });

describe('Motor de decisión automática · configuración', () => {
  it('todos los interruptores nacen apagados', () => {
    const c = entorno() as unknown as Record<string, unknown>;
    for (const k of ['AUTO_DECISION_DOCUMENTAL_HABILITADA', ...ESPECIFICOS]) expect(c[k]).toBe(false);
  });

  it.each(ESPECIFICOS)('39. %s=true con el general apagado → el arranque falla', (flag) => {
    expect(() => entorno({ [flag]: 'true' })).toThrow(new RegExp(`${flag}.*AUTO_DECISION_DOCUMENTAL_HABILITADA`));
  });

  it('en dev, general + específicos → arranca', () => {
    expect(() => entorno({ AUTO_DECISION_DOCUMENTAL_HABILITADA: 'true', ...Object.fromEntries(ESPECIFICOS.map((k) => [k, 'true'])) })).not.toThrow();
  });

  it.each(['qa', 'pre', 'prod'])('40. en %s cualquier interruptor del motor (incluido el general) → el arranque falla', (ambiente) => {
    for (const flag of ['AUTO_DECISION_DOCUMENTAL_HABILITADA', ...ESPECIFICOS]) {
      const extra = { ...OIDC, SIPRA_AMBIENTE: ambiente, AUTO_DECISION_DOCUMENTAL_HABILITADA: 'true', [flag]: 'true' };
      expect(() => entorno(extra)).toThrow(/solo puede encenderse en el ambiente "dev"/);
    }
  });

  it('qa sin interruptores del motor arranca (control)', () => {
    expect(() => entorno({ ...OIDC, SIPRA_AMBIENTE: 'qa' })).not.toThrow();
  });

  it('EPS_AUTOAPROBACION_HABILITADA sigue impidiendo el arranque (no es este mecanismo)', () => {
    expect(() => entorno({ EPS_AUTOAPROBACION_HABILITADA: 'true' })).toThrow();
    expect(() => entorno({ EPS_AUTOAPROBACION_HABILITADA: 'true', AUTO_DECISION_DOCUMENTAL_HABILITADA: 'true', AUTO_APROBACION_EPS: 'true' })).toThrow();
  });

  it('el helper lee exactamente lo configurado (con la salida real de validarEntorno), fallo cerrado ante valores raros', () => {
    const c = entorno({ AUTO_DECISION_DOCUMENTAL_HABILITADA: 'TRUE', AUTO_APROBACION_RUT: 'true' }) as unknown as Record<string, unknown>;
    const i = interruptoresDecisionAutomatica({ get: (k: string) => c[k] } as unknown as ConfigService);
    expect(i).toEqual({
      habilitado: true, aprobacionEps: false, aprobacionRut: true, aprobacionCamara: false, aprobacionArl: false,
      devolucionDocumentoIncorrecto: false, devolucionIncumplimiento: false,
    });
    expect(interruptoresDecisionAutomatica({ get: () => 1 } as unknown as ConfigService).habilitado).toBe(false);
    expect(interruptoresDecisionAutomatica(undefined).habilitado).toBe(false);
  });

  it('no cambia SOLO_LOCAL ni la autoaprobación del pipeline de los tipos sensibles', () => {
    for (const t of [TipoDocumento.CERTIFICADO_EPS, TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO, TipoDocumento.ACTA_INICIO]) {
      expect(modoProcesamientoDe(t)).toBe(ModoProcesamiento.LOCAL);
      expect(permiteAutoAprobacionDelPipeline(t)).toBe(false);
    }
  });
});

describe('Documento · decisiones del motor', () => {
  const doc = (estado: EstadoDocumento) => Documento.desde({
    id: 'd', practicaId: 'p', tipo: TipoDocumento.CERTIFICADO_EPS, version: 1, estado, nombreOriginal: 'x.pdf', mimeReal: 'application/pdf',
    tamanoBytes: 1, hashSha256: 'a'.repeat(64), hashPerceptual: null, rutaAlmacenamiento: 'r', calidadCaptura: null, banderas: [], puntaje: null,
    banda: null, extraccion: null, decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: new Date(),
    actualizadoEn: new Date(), purgarDespuesDe: null,
  });

  it('solo se aplican desde en_revision; nunca sobre una decisión humana ni otro resultado automático', () => {
    for (const estado of Object.values(EstadoDocumento).filter((e) => e !== EstadoDocumento.EN_REVISION)) {
      expect(() => doc(estado).aplicarAutoAprobacion()).toThrow();
      expect(() => doc(estado).aplicarAutoDevolucion('m')).toThrow();
    }
    expect(() => doc(EstadoDocumento.AUTO_APROBADO).aplicarAutoDevolucion('m')).toThrow(DecisionAutomaticaNoAplicableError);
  });

  it('auto-devolución exige mensaje y no registra actor', () => {
    expect(() => doc(EstadoDocumento.EN_REVISION).aplicarAutoDevolucion('  ')).toThrow();
    const d = doc(EstadoDocumento.EN_REVISION);
    d.aplicarAutoDevolucion('Mensaje genérico.');
    expect(d.instantanea()).toMatchObject({ estado: EstadoDocumento.AUTO_DEVUELTO, decididoPor: null, motivoDevolucion: 'Mensaje genérico.' });
    // Una persona puede seguir decidiéndolo (como un ilegible): no es una decisión humana.
    expect(d.estaDecidido).toBe(false);
  });
});
