/**
 * Tarifas de los modelos de lectura documental (capa 2), en USD por millón de
 * tokens, tarifa «Standard» de OpenAI para contexto corto (≤ 272 000 tokens de
 * entrada), que es el único caso de la validación documental.
 *
 * Verificadas el 9 de octubre de 2026 contra la página oficial de precios
 * (https://developers.openai.com/api/docs/pricing) y la ficha de cada modelo
 * (https://developers.openai.com/api/docs/models/<id>). Son datos de
 * referencia para estimar y para valorar cada lectura al momento de hacerla;
 * el gasto real se concilia contra la facturación del proveedor.
 *
 * Cuando OpenAI cambie precios, se actualiza esta tabla y `VIGENCIA_TARIFAS`.
 * El costo guardado en cada documento no se recalcula: refleja la tarifa que
 * regía cuando se leyó.
 */

export const VIGENCIA_TARIFAS = '2026-10-09';
export const FUENTE_TARIFAS = 'https://developers.openai.com/api/docs/pricing';

export type ProveedorIa = 'openai' | 'anthropic';

/** Cómo cobra el modelo las imágenes (y las páginas de un PDF, que se envían como imagen). */
export type ReglaImagen =
  /**
   * Parches de 32 px × multiplicador, con tope de parches en `detail: high`.
   * `ladoMaximoPx` es la reducción previa (2048 salvo gpt-6-astra, 65 535).
   */
  | { tipo: 'parches'; multiplicador: number; topeParches: number; publicada: boolean; ladoMaximoPx?: number }
  /** Mosaicos de 512 px: base + mosaicos × porMosaico (tras reducir a 2048 y lado corto 768). */
  | { tipo: 'mosaicos'; base: number; porMosaico: number };

/** Esfuerzos de razonamiento que admite la API (`reasoning.effort`). */
export type EsfuerzoRazonamiento = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const ESFUERZOS_RAZONAMIENTO: readonly EsfuerzoRazonamiento[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
];

export interface TarifaModelo {
  readonly id: string;
  readonly proveedor: ProveedorIa;
  readonly familia: string;
  readonly entradaUsdPorMillon: number;
  readonly entradaCacheUsdPorMillon: number;
  /** Recargo por escritura en caché (GPT‑5.6 y posteriores): 1,25 × entrada. 1 = sin recargo. */
  readonly factorEscrituraCache: number;
  readonly salidaUsdPorMillon: number;
  /** Batch y Flex: 50 % sobre Standard. */
  readonly descuentoLotePorcentaje: number;
  readonly razonador: boolean;
  /** Esfuerzos que el modelo acepta; vacío en modelos sin razonamiento. */
  readonly esfuerzos: readonly EsfuerzoRazonamiento[];
  readonly imagen: ReglaImagen;
  /** Fecha de retiro anunciada por el proveedor, si la hay. */
  readonly retiro: string | null;
  readonly recomendacion: 'principal' | 'alternativa' | 'escalamiento' | 'no_recomendado';
  readonly nota: string;
}

const PARCHES_12: ReglaImagen = { tipo: 'parches', multiplicador: 1.2, topeParches: 2500, publicada: true };
/** GPT‑6 Luna y GPT‑5.6: `none` a `max`, sin `minimal`. */
const ESF_LUNA: readonly EsfuerzoRazonamiento[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
/** GPT‑6 Astra y Sol: sin `none` ni `minimal` (HTTP 400). */
const ESF_SOL: readonly EsfuerzoRazonamiento[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** GPT‑5.4 y GPT‑5.5: `none` por defecto, hasta `xhigh`. */
const ESF_54: readonly EsfuerzoRazonamiento[] = ['none', 'low', 'medium', 'high', 'xhigh'];
/** GPT‑5: `minimal` a `high`, sin `none`. */
const ESF_5: readonly EsfuerzoRazonamiento[] = ['minimal', 'low', 'medium', 'high'];
const SIN_RAZONAMIENTO: readonly EsfuerzoRazonamiento[] = [];

export const TARIFAS_IA: readonly TarifaModelo[] = [
  {
    id: 'gpt-6-luna', proveedor: 'openai', familia: 'GPT-6',
    entradaUsdPorMillon: 0.1, entradaCacheUsdPorMillon: 0.01, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 0.5, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_LUNA,
    // OpenAI no publica el multiplicador de imagen de Luna; se asume el de la familia (1,2)
    // hasta calibrarlo con el `usage` real de las primeras lecturas.
    imagen: { tipo: 'parches', multiplicador: 1.2, topeParches: 2500, publicada: false },
    retiro: null, recomendacion: 'principal',
    nota: 'El más económico entre los modelos sin retiro anunciado (0,10 / 0,50). Lectura masiva de soportes con esfuerzo de razonamiento bajo.',
  },
  {
    id: 'gpt-5.6-luna', proveedor: 'openai', familia: 'GPT-5.6',
    entradaUsdPorMillon: 0.2, entradaCacheUsdPorMillon: 0.02, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 1.2, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_LUNA, imagen: PARCHES_12,
    retiro: null, recomendacion: 'alternativa',
    nota: 'Reemplazo oficial de gpt-5-mini y gpt-5-nano; regla de imagen publicada (1,2 × parches, tope 2 500).',
  },
  {
    id: 'gpt-5.6-terra', proveedor: 'openai', familia: 'GPT-5.6',
    entradaUsdPorMillon: 2, entradaCacheUsdPorMillon: 0.2, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 12, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_LUNA, imagen: PARCHES_12,
    retiro: null, recomendacion: 'escalamiento',
    nota: 'Segunda pasada para expedientes dudosos o contratos largos; diez veces el costo de Luna.',
  },
  {
    id: 'gpt-5.6-sol', proveedor: 'openai', familia: 'GPT-5.6',
    entradaUsdPorMillon: 4, entradaCacheUsdPorMillon: 0.4, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 20, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_LUNA, imagen: PARCHES_12,
    retiro: null, recomendacion: 'no_recomendado',
    nota: 'Precio promocional vigente al menos hasta el 21 de noviembre de 2026. Innecesario para leer soportes.',
  },
  {
    id: 'gpt-6.1-sol', proveedor: 'openai', familia: 'GPT-6',
    entradaUsdPorMillon: 2, entradaCacheUsdPorMillon: 0.1, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 10, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_SOL,
    imagen: { tipo: 'parches', multiplicador: 1.2, topeParches: 2500, publicada: false },
    retiro: null, recomendacion: 'escalamiento',
    nota: 'Veinte veces el precio de Luna. Solo como segunda pasada sobre casos complejos.',
  },
  {
    id: 'gpt-6-sol', proveedor: 'openai', familia: 'GPT-6',
    entradaUsdPorMillon: 2, entradaCacheUsdPorMillon: 0.2, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 10, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_SOL,
    imagen: { tipo: 'parches', multiplicador: 1.2, topeParches: 2500, publicada: false },
    retiro: null, recomendacion: 'no_recomendado',
    nota: 'Mismo precio que gpt-6.1-sol con caché más cara; sin ventaja para lectura documental.',
  },
  {
    id: 'gpt-6-astra', proveedor: 'openai', familia: 'GPT-6',
    entradaUsdPorMillon: 10, entradaCacheUsdPorMillon: 1, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 50, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_SOL, imagen: { tipo: 'parches', multiplicador: 1.2, topeParches: 2500, publicada: true, ladoMaximoPx: 65_535 },
    retiro: null, recomendacion: 'no_recomendado',
    nota: 'Cien veces el costo de Luna; injustificable para validación documental.',
  },
  {
    id: 'gpt-5.5', proveedor: 'openai', familia: 'GPT-5.5',
    entradaUsdPorMillon: 5, entradaCacheUsdPorMillon: 0.5, factorEscrituraCache: 1,
    salidaUsdPorMillon: 30, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_54, imagen: PARCHES_12,
    retiro: null, recomendacion: 'no_recomendado', nota: 'Cincuenta veces Luna.',
  },
  {
    id: 'gpt-5.4-mini', proveedor: 'openai', familia: 'GPT-5.4',
    entradaUsdPorMillon: 0.75, entradaCacheUsdPorMillon: 0.075, factorEscrituraCache: 1,
    salidaUsdPorMillon: 4.5, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_54, imagen: PARCHES_12,
    retiro: null, recomendacion: 'alternativa', nota: 'Intermedio; 7,5 veces el precio de entrada de Luna.',
  },
  {
    id: 'gpt-5.4-nano', proveedor: 'openai', familia: 'GPT-5.4',
    entradaUsdPorMillon: 0.2, entradaCacheUsdPorMillon: 0.02, factorEscrituraCache: 1,
    salidaUsdPorMillon: 1.25, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_54, imagen: PARCHES_12,
    retiro: '2027-04-01', recomendacion: 'no_recomendado', nota: 'Retiro anunciado; reemplazo oficial gpt-6-luna.',
  },
  {
    id: 'gpt-5.4', proveedor: 'openai', familia: 'GPT-5.4',
    entradaUsdPorMillon: 2.5, entradaCacheUsdPorMillon: 0.25, factorEscrituraCache: 1,
    salidaUsdPorMillon: 15, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_54, imagen: PARCHES_12,
    retiro: null, recomendacion: 'no_recomendado', nota: 'Sin ventaja frente a gpt-5.6-terra.',
  },
  {
    id: 'gpt-5.2', proveedor: 'openai', familia: 'GPT-5.2',
    entradaUsdPorMillon: 1.75, entradaCacheUsdPorMillon: 0.175, factorEscrituraCache: 1,
    salidaUsdPorMillon: 14, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_54,
    imagen: { tipo: 'parches', multiplicador: 1.2, topeParches: 6144, publicada: true },
    retiro: null, recomendacion: 'no_recomendado', nota: 'Caro y con presupuesto de parches mayor por página.',
  },
  {
    id: 'gpt-5.1', proveedor: 'openai', familia: 'GPT-5.1',
    entradaUsdPorMillon: 1.25, entradaCacheUsdPorMillon: 0.125, factorEscrituraCache: 1,
    salidaUsdPorMillon: 10, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ['none', 'low', 'medium', 'high'],
    imagen: { tipo: 'mosaicos', base: 70, porMosaico: 140 },
    retiro: '2027-04-01', recomendacion: 'no_recomendado', nota: 'Retiro anunciado.',
  },
  {
    id: 'gpt-5-mini', proveedor: 'openai', familia: 'GPT-5',
    entradaUsdPorMillon: 0.25, entradaCacheUsdPorMillon: 0.025, factorEscrituraCache: 1,
    salidaUsdPorMillon: 2, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_5,
    // La guía no publica sus límites; se usa el presupuesto de 6 144 parches de los deprecados.
    imagen: { tipo: 'parches', multiplicador: 1.2, topeParches: 6144, publicada: false },
    retiro: '2026-12-11', recomendacion: 'no_recomendado', nota: 'Se apaga el 11 de diciembre de 2026; reemplazo gpt-5.6-terra.',
  },
  {
    id: 'gpt-5-nano', proveedor: 'openai', familia: 'GPT-5',
    entradaUsdPorMillon: 0.05, entradaCacheUsdPorMillon: 0.005, factorEscrituraCache: 1,
    salidaUsdPorMillon: 0.4, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_5,
    imagen: { tipo: 'parches', multiplicador: 1.5, topeParches: 6144, publicada: false },
    retiro: '2026-12-11', recomendacion: 'no_recomendado', nota: 'Se apaga el 11 de diciembre de 2026; reemplazo gpt-5.6-luna.',
  },
  {
    id: 'gpt-5', proveedor: 'openai', familia: 'GPT-5',
    entradaUsdPorMillon: 1.25, entradaCacheUsdPorMillon: 0.125, factorEscrituraCache: 1,
    salidaUsdPorMillon: 10, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ESF_5,
    imagen: { tipo: 'mosaicos', base: 70, porMosaico: 140 },
    retiro: '2026-12-11', recomendacion: 'no_recomendado', nota: 'Se apaga el 11 de diciembre de 2026.',
  },
  {
    id: 'gpt-4.1-mini', proveedor: 'openai', familia: 'GPT-4.1',
    entradaUsdPorMillon: 0.4, entradaCacheUsdPorMillon: 0.1, factorEscrituraCache: 1,
    salidaUsdPorMillon: 1.6, descuentoLotePorcentaje: 50, razonador: false, esfuerzos: SIN_RAZONAMIENTO,
    imagen: { tipo: 'parches', multiplicador: 1.62, topeParches: 6144, publicada: true },
    retiro: null, recomendacion: 'alternativa',
    nota: 'Sin razonamiento (salida predecible), sin retiro anunciado; cada página cuesta unas siete veces más que con Luna.',
  },
  {
    id: 'gpt-4.1', proveedor: 'openai', familia: 'GPT-4.1',
    entradaUsdPorMillon: 2, entradaCacheUsdPorMillon: 0.5, factorEscrituraCache: 1,
    salidaUsdPorMillon: 8, descuentoLotePorcentaje: 50, razonador: false, esfuerzos: SIN_RAZONAMIENTO,
    imagen: { tipo: 'mosaicos', base: 85, porMosaico: 170 },
    retiro: null, recomendacion: 'no_recomendado', nota: 'Veinte veces el costo de Luna por página.',
  },
  {
    id: 'gpt-4.1-nano', proveedor: 'openai', familia: 'GPT-4.1',
    entradaUsdPorMillon: 0.1, entradaCacheUsdPorMillon: 0.025, factorEscrituraCache: 1,
    salidaUsdPorMillon: 0.4, descuentoLotePorcentaje: 50, razonador: false, esfuerzos: SIN_RAZONAMIENTO,
    imagen: { tipo: 'parches', multiplicador: 2.46, topeParches: 6144, publicada: false },
    retiro: '2026-10-23', recomendacion: 'no_recomendado', nota: 'Se apaga el 23 de octubre de 2026.',
  },
  {
    id: 'gpt-4o', proveedor: 'openai', familia: 'GPT-4o',
    entradaUsdPorMillon: 2.5, entradaCacheUsdPorMillon: 1.25, factorEscrituraCache: 1,
    salidaUsdPorMillon: 10, descuentoLotePorcentaje: 50, razonador: false, esfuerzos: SIN_RAZONAMIENTO,
    imagen: { tipo: 'mosaicos', base: 85, porMosaico: 170 },
    retiro: null, recomendacion: 'no_recomendado', nota: 'Legado; más caro que gpt-4.1 sin ventaja.',
  },
  {
    id: 'gpt-4o-mini', proveedor: 'openai', familia: 'GPT-4o',
    entradaUsdPorMillon: 0.15, entradaCacheUsdPorMillon: 0.075, factorEscrituraCache: 1,
    salidaUsdPorMillon: 0.6, descuentoLotePorcentaje: 50, razonador: false, esfuerzos: SIN_RAZONAMIENTO,
    imagen: { tipo: 'mosaicos', base: 2833, porMosaico: 5667 },
    retiro: null, recomendacion: 'no_recomendado',
    nota: 'Trampa de costo en imágenes: una página completa cuesta unos 25 500 tokens.',
  },
  // Referencia del adaptador de Anthropic ya existente (tarifa de referencia que usa el código).
  {
    id: 'claude-sonnet-5', proveedor: 'anthropic', familia: 'Claude',
    entradaUsdPorMillon: 3, entradaCacheUsdPorMillon: 0.3, factorEscrituraCache: 1.25,
    salidaUsdPorMillon: 15, descuentoLotePorcentaje: 50, razonador: true, esfuerzos: ['low', 'medium', 'high'],
    imagen: { tipo: 'parches', multiplicador: 1, topeParches: 1600, publicada: false },
    retiro: null, recomendacion: 'alternativa', nota: 'Proveedor alternativo; tarifa de referencia del adaptador.',
  },
];

export const MODELO_OPENAI_PREDETERMINADO = 'gpt-6-luna';

/**
 * Tarifa de respaldo para un modelo que no está en la tabla (el proveedor
 * devolvió otro identificador, o se configuró uno nuevo). Es deliberadamente
 * cara: vale más frenar el tope diario antes de tiempo que no frenarlo nunca.
 */
export const TARIFA_RESPALDO: TarifaModelo = {
  id: 'desconocido', proveedor: 'openai', familia: 'desconocida',
  entradaUsdPorMillon: 2, entradaCacheUsdPorMillon: 0.2, factorEscrituraCache: 1.25,
  salidaUsdPorMillon: 10, descuentoLotePorcentaje: 0, razonador: true, esfuerzos: ['low', 'medium', 'high'],
  imagen: PARCHES_12, retiro: null, recomendacion: 'no_recomendado',
  nota: 'Modelo sin tarifa registrada: se valora con una tarifa de respaldo conservadora hasta actualizar la tabla.',
};

/**
 * Esfuerzo que de verdad se envía: el pedido si el modelo lo admite; si no,
 * el vecino más cercano que sí (minimal→low, none→low o minimal…). Null en
 * modelos sin razonamiento.
 */
export function esfuerzoEfectivo(
  tarifa: TarifaModelo,
  pedido: string,
): { efectivo: EsfuerzoRazonamiento | null; degradado: boolean } {
  if (tarifa.esfuerzos.length === 0) return { efectivo: null, degradado: false };
  const admitidos = new Set<string>(tarifa.esfuerzos);
  if (admitidos.has(pedido)) return { efectivo: pedido as EsfuerzoRazonamiento, degradado: false };
  const orden = ESFUERZOS_RAZONAMIENTO;
  const indice = Math.max(0, orden.indexOf(pedido as EsfuerzoRazonamiento));
  // Primero hacia arriba (más razonamiento, nunca menos del pedido), luego hacia abajo.
  for (let i = indice; i < orden.length; i += 1) if (admitidos.has(orden[i])) return { efectivo: orden[i], degradado: true };
  for (let i = indice - 1; i >= 0; i -= 1) if (admitidos.has(orden[i])) return { efectivo: orden[i], degradado: true };
  return { efectivo: tarifa.esfuerzos[0], degradado: true };
}

/**
 * Tarifa de un modelo. Los identificadores con fecha (`gpt-6-luna-2026-09-22`)
 * y los alias se resuelven por el prefijo más largo que coincida.
 */
export function tarifaDe(modelo: string): { tarifa: TarifaModelo; exacta: boolean } | null {
  const id = modelo.trim().toLowerCase();
  const exacta = TARIFAS_IA.find((t) => t.id === id);
  if (exacta) return { tarifa: exacta, exacta: true };
  // Solo cuenta el prefijo seguido de guion y de una fecha de snapshot o
  // `latest`: `gpt-5.10` no es `gpt-5.1`, y las variantes `-pro`, `-codex` o
  // `-chat` tienen tarifa propia que no está en la tabla (mejor 0 con aviso
  // que un precio seis veces menor que el real).
  const candidatas = TARIFAS_IA
    .filter((t) => id.startsWith(`${t.id}-`) && /^-(\d{4}-\d{2}-\d{2}|latest)$/.test(id.slice(t.id.length)))
    .sort((a, b) => b.id.length - a.id.length);
  return candidatas.length > 0 ? { tarifa: candidatas[0], exacta: false } : null;
}

export interface UsoTokens {
  entrada: number;
  salida: number;
  /** Subconjunto de `entrada` leído desde caché. */
  cache?: number;
  /** Subconjunto de `entrada` escrito a caché (GPT-5.6 y posteriores). */
  escrituraCache?: number;
}

/** Costo en USD de una lectura, con la fórmula que publica la guía de caché del proveedor. */
export function costoDe(tarifa: TarifaModelo, uso: UsoTokens): number {
  const cache = Math.max(0, uso.cache ?? 0);
  const escritura = Math.max(0, uso.escrituraCache ?? 0);
  const normal = Math.max(0, uso.entrada - cache - escritura);
  const costo =
    (normal / 1e6) * tarifa.entradaUsdPorMillon +
    (cache / 1e6) * tarifa.entradaCacheUsdPorMillon +
    (escritura / 1e6) * tarifa.entradaUsdPorMillon * tarifa.factorEscrituraCache +
    (Math.max(0, uso.salida) / 1e6) * tarifa.salidaUsdPorMillon;
  // Seis decimales: una lectura con Luna cuesta milésimas de centavo.
  return Math.round(costo * 1e6) / 1e6;
}

/**
 * Tokens que cobra el modelo por una imagen (o una página de PDF) de esas
 * dimensiones en `detail: high`, según la regla publicada por el proveedor.
 */
export function tokensImagen(tarifa: TarifaModelo, anchoPx: number, altoPx: number): number {
  const regla = tarifa.imagen;
  if (regla.tipo === 'parches') {
    let ancho = Math.max(1, Math.floor(anchoPx)); let alto = Math.max(1, Math.floor(altoPx));
    // Reducción previa al lado máximo, manteniendo proporción.
    const ladoMaximo = regla.ladoMaximoPx ?? 2048;
    const lado = Math.max(ancho, alto);
    if (lado > ladoMaximo) { ancho = Math.floor((ancho * ladoMaximo) / lado); alto = Math.floor((alto * ladoMaximo) / lado); }
    let parches = Math.ceil(ancho / 32) * Math.ceil(alto / 32);
    if (parches > regla.topeParches) {
      // Regla publicada: reducir proporcionalmente hasta caber en el tope,
      // ajustando a múltiplos enteros de parche y redondeando hacia abajo.
      let r = Math.sqrt((32 * 32 * regla.topeParches) / (ancho * alto));
      const wr = (ancho * r) / 32; const hr = (alto * r) / 32;
      r *= Math.min(Math.floor(wr) / wr, Math.floor(hr) / hr);
      ancho = Math.max(1, Math.floor(ancho * r)); alto = Math.max(1, Math.floor(alto * r));
      parches = Math.min(regla.topeParches, Math.ceil(ancho / 32) * Math.ceil(alto / 32));
    }
    return Math.ceil(parches * regla.multiplicador);
  }
  // Mosaicos de 512 px: encajar en 2048, lado corto a 768 (la otra dimensión
  // se redondea hacia abajo), contar cuadros.
  let ancho = Math.max(1, Math.floor(anchoPx)); let alto = Math.max(1, Math.floor(altoPx));
  const lado = Math.max(ancho, alto);
  if (lado > 2048) { ancho = Math.floor((ancho * 2048) / lado); alto = Math.floor((alto * 2048) / lado); }
  const corto = Math.min(ancho, alto);
  if (corto > 768) {
    const factor = 768 / corto;
    ancho = Math.floor(ancho * factor); alto = Math.floor(alto * factor);
  }
  const mosaicos = Math.ceil(ancho / 512) * Math.ceil(alto / 512);
  return regla.base + mosaicos * regla.porMosaico;
}
