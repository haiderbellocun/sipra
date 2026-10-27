import {
  CoincidenciaEps, DatosExtraidosEps, DiscrepanciaEps, VigenciaCertificado,
} from '../entities/validacion-eps.entity';
import { inicioDelDiaEnColombia } from './fechas-colombia';
import {
  claveEps, compararDocumentos, compararNombres, fechaIsoDe, normalizarDocumento,
  normalizarEstadoReportado, normalizarRegimen, normalizarTexto,
} from './normalizacion-identidad';

/**
 * Comparación INTERNA del certificado de EPS contra lo que SIPRA sabe del
 * estudiante. No consulta a nadie: contrasta datos que ya están en el sistema.
 *
 * Qué responde y qué NO:
 *  · responde si el certificado CORRESPONDE al estudiante (documento y nombre)
 *    y si su fecha está dentro de la vigencia institucional;
 *  · NO dice si el certificado es auténtico ni si la persona está afiliada hoy:
 *    eso exige una fuente oficial y vive en otros ejes de `ValidacionEps`.
 *  · EPS y régimen solo se normalizan y se revisa su consistencia interna.
 */

/** Por debajo de esta confianza, una lectura no se usa para decidir identidad. */
export const CONFIANZA_MINIMA_COMPARACION = 0.7;

export interface CampoLeido {
  valor: string | null;
  confianza: number;
  /** Cómo se leyó el dato (lectura local). Ausente en lecturas de otro origen. */
  fuente?: 'texto_nativo' | 'ocr' | 'qr' | null;
}

/**
 * Instantánea NORMALIZADA de lo que dice el certificado, a partir de la lectura.
 * Una lectura poco confiable cuenta como «no leída»: comparar con ella sería
 * decidir una identidad sobre un dato dudoso.
 */
export function construirDatosExtraidosEps(campos: Readonly<Record<string, CampoLeido>>): DatosExtraidosEps {
  const leer = (nombre: string): string | null => {
    const campo = campos[nombre];
    if (!campo || campo.valor === null || campo.confianza < CONFIANZA_MINIMA_COMPARACION) return null;
    const texto = campo.valor.replace(/\s+/g, ' ').trim();
    return texto.length > 0 ? texto : null;
  };
  const documento = normalizarDocumento(leer('documento_afiliado'));
  const regimen = normalizarRegimen(leer('regimen'));
  const eps = leer('entidad_emisora');
  const fuentes: Record<string, 'texto_nativo' | 'ocr' | 'qr'> = {};
  for (const [nombre, campo] of Object.entries(campos)) {
    if (campo.fuente && leer(nombre) !== null) fuentes[nombre] = campo.fuente;
  }
  return {
    tipoDocumento: documento.tipo,
    numeroDocumento: documento.numero,
    nombre: leer('nombre_afiliado'),
    eps,
    epsClave: claveEps(eps),
    regimen: regimen.regimen,
    tipoAfiliado: regimen.tipoAfiliado ?? normalizarRegimen(leer('tipo_afiliado')).tipoAfiliado,
    estadoReportadoCertificado: normalizarEstadoReportado(leer('estado_afiliacion')),
    fechaExpedicion: fechaIsoDe(leer('fecha_expedicion')),
    ...(Object.keys(fuentes).length > 0 ? { fuentes } : {}),
  };
}

/** Lo que SIPRA sabe del estudiante (usuario / SINU). */
export interface IdentidadEsperada {
  numeroDocumento: string | null;
  nombre: string | null;
}

export interface ContextoComparacionEps {
  ahora: Date;
  /** Vigencia institucional del certificado, en días (parámetro `arl.dias_vigencia_eps`). */
  diasVigencia: number;
}

export interface ResultadoComparacionEps {
  coincidencia: CoincidenciaEps;
  discrepancias: DiscrepanciaEps[];
  vigencia: VigenciaCertificado;
}

/**
 * Días completos entre la fecha de expedición y hoy (día de Colombia). `null` si no hay fecha, no se
 * entiende o es futura (dato inconsistente). Es la fecha de EXPEDICIÓN/GENERACIÓN del certificado:
 * nunca la fecha de ingreso a la EPS.
 */
export function diasDesdeExpedicion(fechaExpedicion: string | null, ahora: Date): number | null {
  if (!fechaExpedicion) return null;
  const expedicion = Date.parse(`${fechaExpedicion}T00:00:00Z`);
  if (Number.isNaN(expedicion)) return null;
  const dias = Math.floor((inicioDelDiaEnColombia(ahora).getTime() - expedicion) / 86_400_000);
  return dias < 0 ? null : dias;
}

export function evaluarVigenciaCertificado(
  fechaExpedicion: string | null,
  ahora: Date,
  diasVigencia: number,
): VigenciaCertificado {
  const dias = diasDesdeExpedicion(fechaExpedicion, ahora);
  if (dias === null) return 'no_determinada';
  return dias <= diasVigencia ? 'vigente' : 'vencido';
}

/**
 * Coincidencia:
 *  · `discrepancia`: el documento O el nombre son claramente distintos.
 *  · `coincide`: el documento es IGUAL y el nombre es igual o compatible. El nombre
 *    solo no basta: la prueba principal de identidad es el número de documento.
 *  · `insuficiente`: falta información para afirmar una cosa u otra.
 */
export function compararCertificadoEps(
  extraidos: DatosExtraidosEps,
  esperado: IdentidadEsperada,
  contexto: ContextoComparacionEps,
): ResultadoComparacionEps {
  const discrepancias: DiscrepanciaEps[] = [];

  const documento = compararDocumentos(esperado.numeroDocumento, extraidos.numeroDocumento);
  if (documento !== 'igual') {
    discrepancias.push({
      campo: 'numero_documento',
      esperado: normalizarDocumento(esperado.numeroDocumento).numero,
      observado: extraidos.numeroDocumento,
      resultado: documento,
    });
  }

  const nombre = compararNombres(esperado.nombre, extraidos.nombre);
  if (nombre === 'diferente' || nombre === 'insuficiente') {
    discrepancias.push({
      campo: 'nombre',
      esperado: normalizarTexto(esperado.nombre) || null,
      observado: normalizarTexto(extraidos.nombre) || null,
      resultado: nombre,
    });
  }

  const vigencia = evaluarVigenciaCertificado(extraidos.fechaExpedicion, contexto.ahora, contexto.diasVigencia);
  if (vigencia === 'vencido') {
    discrepancias.push({
      campo: 'fecha_expedicion',
      esperado: `no más de ${contexto.diasVigencia} días`,
      observado: extraidos.fechaExpedicion,
      resultado: 'vencido',
    });
  } else if (vigencia === 'no_determinada') {
    discrepancias.push({
      campo: 'fecha_expedicion', esperado: null, observado: extraidos.fechaExpedicion, resultado: 'ausente',
    });
  }

  // Consistencia interna de EPS y régimen: solo se señala lo que falta.
  if (!extraidos.epsClave) {
    discrepancias.push({ campo: 'eps', esperado: null, observado: null, resultado: 'ausente' });
  }
  if (!extraidos.regimen) {
    discrepancias.push({ campo: 'regimen', esperado: null, observado: null, resultado: 'ausente' });
  }

  let coincidencia: CoincidenciaEps;
  if (documento === 'diferente' || nombre === 'diferente') coincidencia = CoincidenciaEps.DISCREPANCIA;
  else if (documento === 'igual' && (nombre === 'igual' || nombre === 'compatible')) coincidencia = CoincidenciaEps.COINCIDE;
  else coincidencia = CoincidenciaEps.INSUFICIENTE;

  return { coincidencia, discrepancias, vigencia };
}
