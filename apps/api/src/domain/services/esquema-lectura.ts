import { camposDe } from '../entities/campos-extraccion';
import { TipoDocumento } from '../entities/documento.entity';

/**
 * Esquema JSON estricto de la respuesta de lectura (Structured Outputs).
 *
 * Todo objeto cierra `additionalProperties` y declara todas sus propiedades
 * como requeridas; lo opcional se modela como tipo nulo. Los nombres de campo
 * y los códigos de criterio solo pueden ser los del dominio, y
 * `tipo_detectado` solo un código del catálogo: el modelo no puede inventar.
 *
 * Vive en el dominio porque es la forma de la lectura, no un detalle del
 * proveedor; el estimador de costos lo usa para contar sus tokens.
 */
export function esquemaLectura(tipo: TipoDocumento, codigosCriterios: readonly string[]): Record<string, unknown> {
  const campos = camposDe(tipo);
  const nombreCampo: Record<string, unknown> = campos.length > 0
    ? { type: 'string', enum: [...campos] }
    : { type: 'string' };
  const codigoCriterio: Record<string, unknown> = codigosCriterios.length > 0
    ? { type: 'string', enum: [...codigosCriterios] }
    : { type: 'string' };
  return {
    type: 'object',
    properties: {
      tipo_detectado: { anyOf: [{ type: 'string', enum: Object.values(TipoDocumento) }, { type: 'null' }] },
      ilegible: { type: 'boolean' },
      motivo_ilegible: { type: ['string', 'null'] },
      campos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nombre: nombreCampo,
            valor: { type: ['string', 'null'] },
            confianza: { type: 'number' },
            evidencia: { type: ['string', 'null'] },
          },
          required: ['nombre', 'valor', 'confianza', 'evidencia'],
          additionalProperties: false,
        },
      },
      criterios: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            codigo: codigoCriterio,
            cumple: { type: 'string', enum: ['si', 'no', 'no_determinable'] },
            detalle: { type: ['string', 'null'] },
          },
          required: ['codigo', 'cumple', 'detalle'],
          additionalProperties: false,
        },
      },
      resumen: { type: 'string' },
    },
    required: ['tipo_detectado', 'ilegible', 'motivo_ilegible', 'campos', 'criterios', 'resumen'],
    additionalProperties: false,
  };
}

/** Tokens aproximados que ocupa el esquema en la petición (≈ 4 caracteres por token). */
export function tokensEsquemaAproximados(tipo: TipoDocumento, codigosCriterios: readonly string[]): number {
  return Math.ceil(JSON.stringify(esquemaLectura(tipo, codigosCriterios)).length / 4);
}
