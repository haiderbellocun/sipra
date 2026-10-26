/**
 * Evidencia de una validación de EPS: UN hecho observado, con su fuente.
 *
 * Una validación acumula varias (lo que se leyó del PDF, un QR, la respuesta de
 * una EPS, una consulta a ADRES, la revisión de una persona). Son registros
 * append-only. NO se guarda aquí:
 *   · secretos, tokens ni cookies;
 *   · la respuesta a un CAPTCHA;
 *   · URLs con credenciales o firmas (solo el origen, sin parámetros).
 * No hay un «porcentaje de confianza»: la evidencia se clasifica por fuente y
 * por tipo, y es una persona quien pondera.
 */
export enum TipoEvidenciaEps {
  TEXTO_PDF = 'texto_pdf',
  QR = 'qr',
  RESPUESTA_EPS = 'respuesta_eps',
  ADRES = 'adres',
  REVISION_HUMANA = 'revision_humana',
}

/** De dónde sale el hecho. Que el QR exista no lo hace «oficial»: eso lo dice la fuente. */
export enum FuenteEvidenciaEps {
  CERTIFICADO = 'certificado',
  QR_OFICIAL = 'qr_oficial',
  EPS_OFICIAL = 'eps_oficial',
  ADRES = 'adres',
  REVISION_HUMANA = 'revision_humana',
}

export interface DatosEvidenciaEps {
  id: string;
  validacionEpsId: string;
  tipo: TipoEvidenciaEps;
  fuente: FuenteEvidenciaEps;
  /** Cómo se obtuvo (p. ej. `extraccion_local_texto_pdf`). */
  metodo: string;
  resultado: string;
  fechaVerificacion: Date;
  /** SHA-256 del objeto observado (documento, respuesta), si aplica. */
  hashEvidencia: string | null;
  /** Origen SIN credenciales: sin parámetros, fragmento ni usuario. */
  origen: string | null;
  /** Hechos obtenidos; nunca secretos ni respuestas a CAPTCHA. */
  datosObtenidos: Record<string, unknown>;
  errorCodigo: string | null;
  verificadoPor: string | null;
  creadoEn: Date;
}

export class EvidenciaEpsInvalidaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'EvidenciaEpsInvalidaError';
  }
}

/** Claves que jamás deben viajar en `datosObtenidos`. */
export const CLAVES_PROHIBIDAS_EN_EVIDENCIA: readonly string[] = [
  'captcha', 'token', 'password', 'secreto', 'cookie', 'url_firmada', 'authorization',
];

const FUENTES_POR_TIPO: Readonly<Record<TipoEvidenciaEps, readonly FuenteEvidenciaEps[]>> = {
  [TipoEvidenciaEps.TEXTO_PDF]: [FuenteEvidenciaEps.CERTIFICADO],
  [TipoEvidenciaEps.QR]: [FuenteEvidenciaEps.CERTIFICADO, FuenteEvidenciaEps.QR_OFICIAL],
  [TipoEvidenciaEps.RESPUESTA_EPS]: [FuenteEvidenciaEps.EPS_OFICIAL, FuenteEvidenciaEps.QR_OFICIAL],
  [TipoEvidenciaEps.ADRES]: [FuenteEvidenciaEps.ADRES],
  [TipoEvidenciaEps.REVISION_HUMANA]: [FuenteEvidenciaEps.REVISION_HUMANA],
};

/** Un origen es una dirección sin parámetros: nada de `?token=…`, fragmentos ni usuario:clave@. */
export function origenSinCredenciales(origen: string): boolean {
  return !/[?#]/.test(origen) && !/\/\/[^/]*@/.test(origen);
}

export class EvidenciaEps {
  private constructor(private readonly datos: DatosEvidenciaEps) {}

  /** Valida lo mismo que los CHECK de la base: una evidencia inválida no llega a insertarse. */
  static crear(datos: DatosEvidenciaEps): EvidenciaEps {
    if (!FUENTES_POR_TIPO[datos.tipo].includes(datos.fuente)) {
      throw new EvidenciaEpsInvalidaError(`La fuente «${datos.fuente}» no corresponde a evidencia de tipo «${datos.tipo}»`);
    }
    if (datos.tipo === TipoEvidenciaEps.REVISION_HUMANA && !datos.verificadoPor) {
      throw new EvidenciaEpsInvalidaError('La revisión humana exige indicar quién la hizo');
    }
    if (datos.origen !== null && !origenSinCredenciales(datos.origen)) {
      throw new EvidenciaEpsInvalidaError('El origen no puede llevar parámetros, fragmento ni credenciales');
    }
    if (datos.hashEvidencia !== null && !/^[0-9a-f]{64}$/.test(datos.hashEvidencia)) {
      throw new EvidenciaEpsInvalidaError('El hash de la evidencia debe ser un SHA-256 en hexadecimal');
    }
    const prohibida = Object.keys(datos.datosObtenidos)
      .find((k) => CLAVES_PROHIBIDAS_EN_EVIDENCIA.includes(k.toLowerCase()));
    if (prohibida) throw new EvidenciaEpsInvalidaError(`La evidencia no puede contener «${prohibida}»`);
    return new EvidenciaEps({ ...datos, datosObtenidos: { ...datos.datosObtenidos } });
  }

  static desde(datos: DatosEvidenciaEps): EvidenciaEps {
    return new EvidenciaEps({ ...datos, datosObtenidos: { ...datos.datosObtenidos } });
  }

  get id(): string { return this.datos.id; }
  get tipo(): TipoEvidenciaEps { return this.datos.tipo; }
  get fuente(): FuenteEvidenciaEps { return this.datos.fuente; }

  instantanea(): DatosEvidenciaEps {
    return { ...this.datos, datosObtenidos: { ...this.datos.datosObtenidos } };
  }
}
