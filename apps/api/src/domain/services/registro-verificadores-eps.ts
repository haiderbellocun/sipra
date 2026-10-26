/**
 * Registro de VERIFICADORES OFICIALES de certificados de EPS.
 *
 * Es la ÚNICA lista de destinos a los que SIPRA puede dirigir una consulta
 * tomada de un QR. No hay «cualquier dominio de EPS»: solo mecanismos que una
 * persona responsable verificó como públicos y oficiales, con host exacto.
 *
 * Reglas del registro:
 *  · una consulta solo existe si el host de la URL del QR coincide EXACTAMENTE
 *    con uno declarado (nada de sufijos ni «contiene»), por https, sin
 *    credenciales y en un puerto declarado;
 *  · un verificador que requiere interacción humana (CAPTCHA, sesión) o
 *    credenciales NUNCA se consulta por esta vía;
 *  · cada verificador declara qué puede establecer: autenticidad del
 *    certificado, afiliación vigente, o ambas. Lo que no declara, no lo puede
 *    establecer aunque el contenido de la respuesta lo diga.
 */

export interface VerificadorEpsDefinicion {
  /** Identificador estable (se guarda en la validación y en la evidencia). */
  codigo: string;
  /** Entidad emisora a la que corresponde. */
  emisor: string;
  /** Otras denominaciones aprobadas del emisor (alias controlados, sin comparación aproximada). */
  aliasesEmisor: readonly string[];
  /** Hosts EXACTOS (minúsculas, sin comodines, sin IP). */
  hostsPermitidos: readonly string[];
  /** Puertos permitidos; por defecto solo 443. */
  puertosPermitidos?: readonly number[];
  /** Si se declara, la ruta de la URL debe empezar por alguno de estos prefijos. */
  prefijosRuta?: readonly string[];
  formato: 'json' | 'html';
  /** Content-Type esperados de la respuesta (sin parámetros). */
  contentTypes: readonly string[];
  /** Establece la AUTENTICIDAD del certificado (existe, el código corresponde, la fuente lo da por válido). */
  autenticaCertificado: boolean;
  /** Confirma el estado VIGENTE de la afiliación. */
  confirmaAfiliacion: boolean;
  /** CAPTCHA, sesión de usuario o cualquier paso humano: no se consulta automáticamente. */
  requiereInteraccionHumana: boolean;
  requiereCredenciales: boolean;
  /** Redirecciones: ninguna salvo que se declaren los hosts de destino (también deben pasar la allowlist). */
  hostsRedireccionPermitidos?: readonly string[];
  maxRedirecciones?: number;
  /** Referencia pública que sustenta que el mecanismo es oficial y de uso permitido. */
  fuenteOficial: string;
  /** Quién y cuándo lo aprobó (decisión humana documentada). */
  aprobadoPor: string;
  aprobadoEn: string;
}

export const MAX_REDIRECCIONES_ABSOLUTO = 2;

/** Token de inyección del registro vigente. */
export const REGISTRO_VERIFICADORES_EPS = Symbol('REGISTRO_VERIFICADORES_EPS');

export class VerificadorEpsInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'VerificadorEpsInvalidoError';
  }
}

export type MotivoRechazoDestino =
  | 'url_invalida'
  | 'esquema_no_permitido'
  | 'credenciales_en_url'
  | 'host_no_permitido'
  | 'puerto_no_permitido'
  | 'ruta_no_permitida';

export type ResolucionDestino =
  | { permitido: true; verificador: VerificadorEpsDefinicion; url: URL }
  | { permitido: false; motivo: MotivoRechazoDestino };

const HOST_VALIDO = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ES_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function validarDefinicion(d: VerificadorEpsDefinicion): void {
  const falla = (m: string): never => { throw new VerificadorEpsInvalidoError(`Verificador «${d.codigo}»: ${m}`); };
  if (!/^[a-z0-9_]{3,60}$/.test(d.codigo)) throw new VerificadorEpsInvalidoError('Código de verificador inválido');
  if (d.hostsPermitidos.length === 0) falla('sin hosts permitidos');
  for (const h of [...d.hostsPermitidos, ...(d.hostsRedireccionPermitidos ?? [])]) {
    if (h !== h.toLowerCase() || !HOST_VALIDO.test(h) || ES_IPV4.test(h)) falla(`host no válido «${h}» (exacto, minúsculas, sin IP ni comodines)`);
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) falla(`host interno «${h}»`);
  }
  for (const p of d.puertosPermitidos ?? [443]) if (!Number.isInteger(p) || p < 1 || p > 65535) falla('puerto inválido');
  if ((d.maxRedirecciones ?? 0) < 0 || (d.maxRedirecciones ?? 0) > MAX_REDIRECCIONES_ABSOLUTO) falla('demasiadas redirecciones');
  if ((d.maxRedirecciones ?? 0) > 0 && !d.hostsRedireccionPermitidos?.length) falla('redirecciones sin hosts de destino declarados');
  if (d.contentTypes.length === 0) falla('sin Content-Type esperado');
  if (!d.fuenteOficial.trim() || !d.aprobadoPor.trim() || !d.aprobadoEn.trim()) falla('sin fuente oficial o sin aprobación documentada');
  if (!d.autenticaCertificado && !d.confirmaAfiliacion) falla('no establece ni autenticidad ni afiliación');
}

export class RegistroVerificadoresEps {
  private readonly porHost = new Map<string, VerificadorEpsDefinicion>();
  readonly verificadores: readonly VerificadorEpsDefinicion[];

  constructor(definiciones: readonly VerificadorEpsDefinicion[]) {
    const codigos = new Set<string>();
    for (const d of definiciones) {
      validarDefinicion(d);
      if (codigos.has(d.codigo)) throw new VerificadorEpsInvalidoError(`Código de verificador repetido «${d.codigo}»`);
      codigos.add(d.codigo);
      for (const h of d.hostsPermitidos) {
        if (this.porHost.has(h)) throw new VerificadorEpsInvalidoError(`El host «${h}» está en dos verificadores`);
        this.porHost.set(h, d);
      }
    }
    this.verificadores = [...definiciones];
  }

  get vacio(): boolean { return this.verificadores.length === 0; }

  porCodigo(codigo: string): VerificadorEpsDefinicion | null {
    return this.verificadores.find((v) => v.codigo === codigo) ?? null;
  }

  /**
   * ¿Esta URL (tomada de un QR, NO confiable) apunta a un verificador registrado?
   * Todas las comprobaciones se hacen ANTES de cualquier conexión.
   */
  resolver(urlTexto: string): ResolucionDestino {
    let url: URL;
    try { url = new URL(urlTexto); } catch { return { permitido: false, motivo: 'url_invalida' }; }
    if (url.protocol !== 'https:') return { permitido: false, motivo: 'esquema_no_permitido' };
    if (url.username || url.password) return { permitido: false, motivo: 'credenciales_en_url' };
    const verificador = this.porHost.get(url.hostname.toLowerCase());
    if (!verificador) return { permitido: false, motivo: 'host_no_permitido' };
    const puerto = url.port === '' ? 443 : Number(url.port);
    if (!(verificador.puertosPermitidos ?? [443]).includes(puerto)) return { permitido: false, motivo: 'puerto_no_permitido' };
    if (verificador.prefijosRuta?.length && !verificador.prefijosRuta.some((p) => url.pathname.startsWith(p))) {
      return { permitido: false, motivo: 'ruta_no_permitida' };
    }
    return { permitido: true, verificador, url };
  }

  /** ¿Se puede consultar automáticamente? (sin pasos humanos ni credenciales). */
  static puedeConsultarse(v: VerificadorEpsDefinicion): boolean {
    return !v.requiereInteraccionHumana && !v.requiereCredenciales;
  }
}

/**
 * INVENTARIO DE VERIFICADORES OFICIALES HABILITADOS: VACÍO a propósito.
 *
 * Ningún mecanismo de verificación por QR de una EPS pudo confirmarse como
 * público, oficial y de uso permitido (ver «Inventario» en el documento
 * técnico). No se inventan URLs ni se deducen endpoints inspeccionando
 * portales. Cada alta exige una decisión humana documentada
 * (`fuenteOficial`, `aprobadoPor`, `aprobadoEn`) y un adaptador específico.
 */
export const VERIFICADORES_EPS_OFICIALES: readonly VerificadorEpsDefinicion[] = [];
