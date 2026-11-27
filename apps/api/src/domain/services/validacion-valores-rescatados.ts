import { camposDe } from '../entities/campos-extraccion';
import { TipoDocumento } from '../entities/documento.entity';
import { Nit } from '../value-objects/nit.vo';
import { controlarNitLeido } from './control-nit.domain-service';
import { esRelleno } from './normalizacion-acta';
import { fechaIsoDe, normalizarDocumento } from './normalizacion-identidad';

/**
 * Validación determinística de un valor candidato (IA de rescate · subfase 1.2, dominio puro).
 *
 * Responde si un valor PUEDE ocupar un campo del esquema de un tipo documental y lo devuelve
 * normalizado. Solo reutiliza reglas que SIPRA ya tiene:
 *  · NIT: `Nit` (pesos oficiales DIAN) y `controlarNitLeido`;
 *  · documento de identidad: `normalizarDocumento`;
 *  · fecha: `fechaIsoDe` (fecha real, salida AAAA-MM-DD);
 *  · texto: sin vacíos ni relleno de formulario (`esRelleno`).
 *
 * No valida autenticidad, no determina afiliación ni vigencia y no decide aprobación. Un valor
 * válido aquí solo es un valor bien formado.
 */

export type ClaseCampo = 'nit' | 'documento_identidad' | 'fecha' | 'texto';

export type MotivoValorInvalido =
  | 'campo_fuera_de_esquema'
  | 'valor_ausente'
  | 'valor_vacio'
  | 'valor_de_relleno'
  | 'nit_formato_invalido'
  | 'nit_dv_no_coincide'
  | 'documento_formato_invalido'
  | 'fecha_invalida';

export interface ResultadoValidacionValor {
  valido: boolean;
  /** Valor listo para guardar; `null` cuando no es válido. */
  valorNormalizado: string | null;
  /** Código del motivo (nunca el valor); `null` cuando es válido. */
  motivo: MotivoValorInvalido | null;
}

export interface ContextoValidacionValor {
  /** Dígito de verificación leído aparte, si lo hay. Se contrasta con el NIT. */
  digitoVerificacionNit?: string | number | null;
}

/** Campos del esquema cuyo valor es un NIT sin dígito de verificación (`campos-extraccion.ts`). */
const CAMPOS_NIT: ReadonlySet<string> = new Set(['nit', 'nit_empresa']);

/** Campos del esquema cuyo valor es un número de documento de identidad. */
const CAMPOS_DOCUMENTO: ReadonlySet<string> = new Set([
  'numero_documento', 'documento_afiliado', 'documento_aprendiz', 'documento_asegurado',
]);

/** Campos del esquema que el catálogo declara en AAAA-MM-DD. */
const CAMPOS_FECHA: ReadonlySet<string> = new Set([
  'fecha_expedicion', 'fecha_inicio', 'fecha_fin', 'fecha_generacion', 'fecha_matricula', 'fecha_ingreso',
  'fecha_retiro', 'fecha_afiliacion', 'vigencia_desde', 'vigencia_hasta', 'periodo_desde', 'periodo_hasta',
]);

/**
 * Clase de validación de un campo. Lo que no es NIT, documento ni fecha se trata como texto:
 * `periodo` (AAAA-MM), `ibc`, `total_horas`, `vigente`, `estado_afiliacion` o `regimen` no tienen
 * todavía una regla de formato reutilizable en el dominio y no se inventa una aquí.
 */
export function claseDeCampo(campo: string): ClaseCampo {
  if (CAMPOS_NIT.has(campo)) return 'nit';
  if (CAMPOS_DOCUMENTO.has(campo)) return 'documento_identidad';
  if (CAMPOS_FECHA.has(campo)) return 'fecha';
  return 'texto';
}

const valido = (valorNormalizado: string): ResultadoValidacionValor => ({ valido: true, valorNormalizado, motivo: null });
const invalido = (motivo: MotivoValorInvalido): ResultadoValidacionValor => ({ valido: false, valorNormalizado: null, motivo });

/**
 * NIT del esquema: solo dígitos, sin DV. Acepta separadores de miles y, si trae `-DV`, lo verifica con el algoritmo
 * DIAN y lo quita (el campo se define sin DV). Nunca corrige un NIT para que cuadre con su DV.
 */
function validarNit(texto: string, contexto: ContextoValidacionValor): ResultadoValidacionValor {
  let base: string;
  const conDv = texto.match(/^([\d.\s]+?)\s*-\s*(\d)$/);
  if (conDv) {
    base = conDv[1].replace(/[.\s]/g, '');
    if (!/^\d{5,15}$/.test(base)) return invalido('nit_formato_invalido');
    if (!Nit.esValido(base, Number(conDv[2]))) return invalido('nit_dv_no_coincide');
  } else {
    base = texto.replace(/[.\s,]/g, '');
    // Mismos límites que `Nit.crear`: al menos 6 dígitos sin DV y a lo sumo 15 (pesos DIAN).
    if (!/^\d{6,15}$/.test(base)) return invalido('nit_formato_invalido');
  }
  const dv = contexto.digitoVerificacionNit;
  if (dv !== undefined && dv !== null && String(dv).trim() !== '' && !controlarNitLeido(base, dv).confiable) {
    return invalido('nit_dv_no_coincide');
  }
  return valido(base);
}

export function validarValorRescatado(
  tipo: TipoDocumento,
  campo: string,
  valor: string | null | undefined,
  contexto: ContextoValidacionValor = {},
): ResultadoValidacionValor {
  if (!camposDe(tipo).includes(campo)) return invalido('campo_fuera_de_esquema');
  if (valor === null || valor === undefined || typeof valor !== 'string') return invalido('valor_ausente');
  // Solo se colapsan espacios: no se cambian mayúsculas, tildes ni contenido.
  const texto = valor.replace(/\s+/g, ' ').trim();
  if (!texto) return invalido('valor_vacio');
  if (esRelleno(texto)) return invalido('valor_de_relleno');

  switch (claseDeCampo(campo)) {
    case 'nit':
      return validarNit(texto, contexto);
    case 'documento_identidad': {
      const { numero } = normalizarDocumento(texto);
      return numero ? valido(numero) : invalido('documento_formato_invalido');
    }
    case 'fecha': {
      const iso = fechaIsoDe(texto);
      return iso ? valido(iso) : invalido('fecha_invalida');
    }
    default:
      return valido(texto);
  }
}
