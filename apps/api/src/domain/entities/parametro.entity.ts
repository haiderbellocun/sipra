/**
 * M12 — Parametrización de reglas y umbrales sin desplegar.
 *
 * El catálogo vive en el código y la base solo guarda las sobrescrituras. Así,
 * un parámetro que nadie declaró no se puede escribir, y cada valor viaja con
 * su tipo, su rango y su razón de ser.
 *
 * La distinción que define este módulo: **no todo umbral es negociable**. Los
 * valores operativos los mueve la Dirección según lo que observe; los
 * normativos los fija una norma y el sistema los muestra, los explica y se
 * niega a cambiarlos. Dejar que una pantalla de administración relaje la
 * compuerta de ARL o la vigencia de una vacante sería convertir el
 * incumplimiento en un descuido de dos clics.
 */

export enum TipoParametro {
  ENTERO = 'entero',
  DECIMAL = 'decimal',
  BOOLEANO = 'booleano',
}

export enum NaturalezaParametro {
  /** Lo decide la Dirección con lo que observa en operación. */
  OPERATIVO = 'operativo',
  /** Lo fija una norma. Se muestra y se explica; no se cambia. */
  NORMATIVO = 'normativo',
}

export type ValorParametro = number | boolean;

export interface DefinicionParametro {
  readonly clave: string;
  readonly etiqueta: string;
  readonly descripcion: string;
  readonly tipo: TipoParametro;
  readonly naturaleza: NaturalezaParametro;
  readonly valorPorDefecto: ValorParametro;
  readonly minimo?: number;
  readonly maximo?: number;
  readonly unidad?: string;
  /** Solo en los normativos: la norma que lo fija. */
  readonly norma?: string;
}

export class ParametroDesconocidoError extends Error {
  constructor(clave: string) {
    super(`No existe un parámetro con la clave "${clave}"`);
    this.name = 'ParametroDesconocidoError';
  }
}

export class ParametroNormativoError extends Error {
  constructor(definicion: DefinicionParametro) {
    super(
      `"${definicion.etiqueta}" lo fija ${definicion.norma}. El sistema puede mostrarlo, ` +
        'pero no cambiarlo: modificarlo aquí sería incumplir la norma sin dejar rastro.',
    );
    this.name = 'ParametroNormativoError';
  }
}

export class ValorParametroInvalidoError extends Error {
  constructor(definicion: DefinicionParametro, motivo: string) {
    super(`Valor inválido para "${definicion.etiqueta}": ${motivo}`);
    this.name = 'ValorParametroInvalidoError';
  }
}

const operativo = (
  clave: string, etiqueta: string, descripcion: string, valorPorDefecto: ValorParametro,
  extra: Partial<DefinicionParametro> = {},
): DefinicionParametro => ({
  clave, etiqueta, descripcion, valorPorDefecto,
  tipo: typeof valorPorDefecto === 'boolean' ? TipoParametro.BOOLEANO : TipoParametro.ENTERO,
  naturaleza: NaturalezaParametro.OPERATIVO, ...extra,
});

const normativo = (
  clave: string, etiqueta: string, descripcion: string, valorPorDefecto: ValorParametro,
  norma: string, extra: Partial<DefinicionParametro> = {},
): DefinicionParametro => ({
  clave, etiqueta, descripcion, valorPorDefecto, norma,
  tipo: typeof valorPorDefecto === 'boolean' ? TipoParametro.BOOLEANO : TipoParametro.ENTERO,
  naturaleza: NaturalezaParametro.NORMATIVO, ...extra,
});

export const CATALOGO_PARAMETROS: readonly DefinicionParametro[] = [
  // ── Pipeline de validación documental ────────────────────────────────────
  operativo(
    'pipeline.umbral_verde', 'Puntaje mínimo para aprobación automática',
    'Desde este puntaje el documento se aprueba sin intervención humana. Subirlo manda ' +
      'más documentos a revisión; bajarlo aprueba más rápido y con menos certeza. Es la ' +
      'perilla que se calibra durante el piloto contra documentos reales.',
    85, { minimo: 0, maximo: 100, unidad: 'puntos' },
  ),
  operativo(
    'pipeline.umbral_amarillo', 'Puntaje mínimo para revisión humana',
    'Por debajo de este puntaje el documento se devuelve. Entre este umbral y el de ' +
      'aprobación queda en manos de una persona. Nunca hay rechazo automático.',
    60, { minimo: 0, maximo: 100, unidad: 'puntos' },
  ),
  operativo(
    'documentos.similitud_maxima', 'Distancia máxima para considerar dos imágenes iguales',
    'Distancia entre huellas perceptuales por debajo de la cual dos cargas se tratan como ' +
      'la misma imagen. Más alto detecta más reenvíos disfrazados, con más falsos positivos.',
    16, { minimo: 0, maximo: 128, unidad: 'bits' },
  ),
  operativo(
    'documentos.tamano_maximo_mb', 'Tamaño máximo de un documento',
    'Un teléfono moderno produce fotos de varios megabytes; un límite muy bajo devuelve ' +
      'cargas legítimas.',
    10, { minimo: 1, maximo: 50, unidad: 'MB' },
  ),
  operativo(
    'ia.tope_diario_usd', 'Tope de gasto diario en lectura asistida por IA',
    'Suma máxima, en dólares, que el proveedor de IA puede facturar en un día (hora de ' +
      'Colombia). Alcanzado el tope, los documentos nuevos pasan a revisión humana sin lectura ' +
      'automática y nada se pierde: el revisor los ve igual. Cero desactiva el tope.',
    50, { minimo: 0, maximo: 5000, unidad: 'USD' },
  ),
  operativo(
    'ia.lecturas_por_practica_dia', 'Lecturas automáticas por práctica y día',
    'Cuántos documentos de una misma práctica puede leer la IA en un día. Frena los cargues ' +
      'en bucle sin castigar al estudiante: lo que pase del límite entra igual y lo revisa una ' +
      'persona. Cero desactiva el límite.',
    40, { minimo: 0, maximo: 500, unidad: 'lecturas' },
  ),

  // ── Acompañamiento y señales ─────────────────────────────────────────────
  operativo(
    'acompanamiento.dias_sin_actividad', 'Días sin actividad antes de señalar la práctica',
    'Silencio prolongado en un expediente es la señal más temprana de que algo se atascó.',
    15, { minimo: 1, maximo: 90, unidad: 'días' },
  ),
  operativo(
    'acompanamiento.dias_vencimiento_riesgo', 'Días antes de un vencimiento para marcar riesgo',
    'Cuánta anticipación quiere la Dirección frente a una obligación por vencer.',
    10, { minimo: 1, maximo: 60, unidad: 'días' },
  ),
  operativo(
    'plan_mejoramiento.dias_plazo', 'Plazo de entrega del plan de mejoramiento',
    'Ampliarlo de dos a cuatro semanas reduce a la mitad la carga diaria del tutor sin ' +
      'costo alguno. Es una decisión de operación, y por eso se cambia aquí y no en un ' +
      'despliegue.',
    14, { minimo: 7, maximo: 60, unidad: 'días' },
  ),

  // ── Registro y revisión documental (proceso SGP) ─────────────────────────
  operativo(
    'registro.coordinacion_periodos_cerrados', 'Coordinación registra en periodos cerrados',
    'El registro FUR del estudiante solo abre en su ventana. Con esto activo, el usuario ' +
      'de coordinación puede registrar excepciones en periodos ya cerrados, como en el SGP ' +
      'cuando la configuración lo permite.',
    false,
  ),
  operativo(
    'documentos.dias_subsanacion', 'Plazo para subsanar un documento devuelto',
    'El manual del docente facilitador fija ocho días calendario. Se registra en la ' +
      'bitácora al devolver y alimenta la señal de acompañamiento.',
    8, { minimo: 1, maximo: 30, unidad: 'días' },
  ),

  // ── Solicitud de ARL (portal de gestión de ARL) ──────────────────────────
  operativo(
    'arl.dias_habiles_anticipacion', 'Días hábiles de anticipación para solicitar la ARL',
    'La solicitud de afiliación se radica con al menos cinco días hábiles antes del inicio de ' +
      'la práctica (manual del docente facilitador). No cuenta sábados ni domingos.',
    5, { minimo: 1, maximo: 15, unidad: 'días hábiles' },
  ),
  operativo(
    'arl.dias_vigencia_eps', 'Vigencia máxima del certificado de EPS',
    'El certificado de EPS que soporta la solicitud de ARL no puede tener más de treinta días ' +
      'de expedición (manual del portal de ARL, §5.3).',
    30, { minimo: 1, maximo: 90, unidad: 'días' },
  ),

  // ── Auditoría ────────────────────────────────────────────────────────────
  operativo(
    'auditoria.consultas_por_hora', 'Consultas por hora que disparan alerta de uso anómalo',
    'Un funcionario legítimo consulta decenas de expedientes al día; quien está extrayendo ' +
      'información consulta cientos en una hora.',
    40, { minimo: 1, maximo: 1000, unidad: 'consultas/hora' },
  ),

  // ── Normativos: se muestran, no se tocan ─────────────────────────────────
  normativo(
    'arl.exige_afiliacion_previa', 'La afiliación a ARL debe ser anterior al inicio',
    'Una práctica no puede activarse sin afiliación a riesgos laborales vigente desde antes ' +
      'del primer día. La regla vive en el dominio y como restricción del motor de base de ' +
      'datos: ninguna configuración la omite.',
    true, 'el Decreto 055 de 2015',
  ),
  normativo(
    'vacantes.vigencia_maxima_meses', 'Vigencia máxima de una vacante publicada',
    'Una vacante no puede permanecer publicada más allá de este plazo.',
    6, 'la Resolución 2605 de 2014', { minimo: 6, maximo: 6, unidad: 'meses' },
  ),
];

const POR_CLAVE = new Map(CATALOGO_PARAMETROS.map((d) => [d.clave, d]));

export function definicionDe(clave: string): DefinicionParametro {
  const definicion = POR_CLAVE.get(clave);
  if (!definicion) throw new ParametroDesconocidoError(clave);
  return definicion;
}

/**
 * Comprueba que un cambio es admisible. Rechaza antes de escribir: un valor
 * inválido guardado es una avería que aparece más tarde y en otro sitio.
 */
export function validarCambio(clave: string, valor: unknown): ValorParametro {
  const d = definicionDe(clave);
  if (d.naturaleza === NaturalezaParametro.NORMATIVO) throw new ParametroNormativoError(d);

  if (d.tipo === TipoParametro.BOOLEANO) {
    if (typeof valor !== 'boolean') {
      throw new ValorParametroInvalidoError(d, 'se esperaba verdadero o falso');
    }
    return valor;
  }

  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new ValorParametroInvalidoError(d, 'se esperaba un número');
  }
  if (d.tipo === TipoParametro.ENTERO && !Number.isInteger(n)) {
    throw new ValorParametroInvalidoError(d, 'se esperaba un número entero');
  }
  if (d.minimo !== undefined && n < d.minimo) {
    throw new ValorParametroInvalidoError(d, `no puede ser menor que ${d.minimo}`);
  }
  if (d.maximo !== undefined && n > d.maximo) {
    throw new ValorParametroInvalidoError(d, `no puede ser mayor que ${d.maximo}`);
  }
  return n;
}

/**
 * Los dos umbrales del pipeline se leen juntos porque su relación importa:
 * aprobar por debajo del punto de revisión dejaría la banda amarilla vacía y
 * volvería automática una decisión que debía ser humana.
 */
export function validarCoherenciaUmbrales(verde: number, amarillo: number): void {
  if (verde <= amarillo) {
    throw new ValorParametroInvalidoError(
      definicionDe('pipeline.umbral_verde'),
      `el umbral de aprobación (${verde}) debe ser mayor que el de revisión (${amarillo}); ` +
        'de lo contrario no queda banda de revisión humana',
    );
  }
}
