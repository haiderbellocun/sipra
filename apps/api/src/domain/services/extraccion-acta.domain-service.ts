import {
  CAMPOS_ACTA, CampoActa, CampoLeidoActa, CamposActaLeidos, FuenteLecturaActa,
} from '../entities/acta-iniciacion';
import { esRelleno, frase, plegar, sinSeparadoresDeValor } from './normalizacion-acta';

/**
 * Extracción de los campos del acta por ETIQUETA, sobre texto nativo u OCR.
 *
 * Método: se ubican las etiquetas conocidas dentro del bloque de datos (entre
 * «Nombre del Estudiante» y «El estudiante manifiesta») y el valor de cada una es lo que
 * hay entre ella y la etiqueta siguiente. Así no importa si el lector entrega cada fragmento
 * en su línea ni si dos etiquetas comparten renglón. Las etiquetas que se repiten
 * («Documento de Identidad», «Teléfono») se asignan por el contexto en que aparecen.
 *
 * Reglas de diseño:
 *  · Un valor ausente es `null`; jamás se inventa ni se rellena con un valor «probable».
 *  · Los formatos nombran distinto lo mismo («Tipo de Práctica» / «Modalidad de Práctica»;
 *    «funciones» / «actividades»): aquí caen en el mismo campo de dominio.
 *  · Un valor desmedido para un dato corto indica que el diseño de la página se rompió; se
 *    descarta antes que mostrar basura como si fuera un dato.
 */

export const CONFIANZA_TEXTO_NATIVO_ACTA = 0.95;
export const CONFIANZA_OCR_ACTA = 0.75;
/** Techo de la confianza de un dato leído por OCR: el OCR se equivoca de otra manera que el texto digital. */
export const CONFIANZA_MAXIMA_OCR_ACTA = 0.85;
/** Por debajo de esta confianza una lectura no se usa para comparar. */
export const CONFIANZA_MINIMA_ACTA = 0.7;

const LARGO_MAXIMO_VALOR = 160;
const LARGO_MAXIMO_FUNCIONES = 1500;

type Contexto = 'estudiante' | 'representante' | 'jefe';

interface Etiqueta {
  /** Campo directo, o una clave de contexto que se resuelve por posición. */
  clave: CampoActa | 'documento_ctx' | 'telefono_ctx';
  patron: string;
}

/** Colon obligatorio en palabras sueltas: sin él «EMPRESA» o «DIRECCIÓN» confundirían con el texto corrido. */
const DOS_PUNTOS = '\\s*[:;.]';

const ETIQUETAS: readonly Etiqueta[] = [
  { clave: 'nombre_estudiante', patron: `${frase('NOMBRE DEL ESTUDIANTE')}\\s*[:;.]?` },
  { clave: 'documento_ctx', patron: `${frase('DOCUMENTO DE IDENTIDAD')}\\s*[:;.]?` },
  { clave: 'lugar_expedicion', patron: `${frase('LUGAR EXPEDICION')}\\s*[:;.]?|${frase('LUGAR DE EXPEDICION')}\\s*[:;.]?` },
  { clave: 'direccion_estudiante', patron: `\\bDIRECCION${DOS_PUNTOS}` },
  { clave: 'barrio', patron: `\\bBARRIO${DOS_PUNTOS}` },
  { clave: 'telefono_ctx', patron: `\\bTELEFONO${DOS_PUNTOS}` },
  { clave: 'semestre', patron: `\\bSEMESTRE${DOS_PUNTOS}` },
  { clave: 'programa', patron: `\\bPROGRAMA${DOS_PUNTOS}` },
  { clave: 'modalidad_practica', patron: `${frase('TIPO DE PRACTICA')}\\s*[:;.]?|${frase('MODALIDAD DE PRACTICA')}\\s*[:;.]?` },
  { clave: 'empresa', patron: `\\bEMPRESA${DOS_PUNTOS}` },
  { clave: 'nit', patron: `\\bNIT${DOS_PUNTOS}` },
  { clave: 'representante_legal', patron: `${frase('NOMBRE DEL REPRESENTANTE LEGAL')}\\s*[:;.]?` },
  { clave: 'direccion_practica', patron: `${frase('DIRECCION DONDE REALIZARA LAS PRACTICAS')}\\s*[:;.]?` },
  { clave: 'ciudad', patron: `\\bCIUDAD${DOS_PUNTOS}` },
  { clave: 'departamento', patron: `\\bDEPARTAMENTO${DOS_PUNTOS}` },
  { clave: 'jefe_inmediato', patron: `${frase('NOMBRE JEFE INMEDIATO')}\\s*,?\\s*(?:${frase('TUTOR')})?\\s*[:;.]?` },
  { clave: 'fecha_inicio', patron: `${frase('FECHA DE INICIO')}\\s*(?:${frase('DE LA PRACTICA')})?\\s*[:;.]?` },
  { clave: 'fecha_fin', patron: `${frase('FECHA TERMINACION')}\\s*[:;.]?|${frase('FECHA DE TERMINACION')}\\s*[:;.]?` },
  { clave: 'docente_monitor', patron: `${frase('DOCENTE MONITOR')}\\s*(?:${frase('ASIGNADO')})?\\s*[:;.]?` },
];

const FIN_BLOQUE = new RegExp(`${frase('EL ESTUDIANTE MANIFIESTA')}|${frase('OBLIGACIONES DEL ESTUDIANTE')}`);
const INICIO_BLOQUE = new RegExp(frase('NOMBRE DEL ESTUDIANTE'));
const INICIO_FUNCIONES = new RegExp(`(?:${frase('FUNCIONES')}|${frase('ACTIVIDADES')})\\s*${frase('LAS CUALES DESARROLLARA DURANTE SUS PRACTICAS')}\\s*[:;.]?`);

interface Hallazgo { clave: Etiqueta['clave']; inicio: number; fin: number }

function hallar(plegado: string, desde: number, hasta: number): Hallazgo[] {
  const crudos: Hallazgo[] = [];
  for (const { clave, patron } of ETIQUETAS) {
    const re = new RegExp(patron, 'g');
    for (const m of plegado.slice(desde, hasta).matchAll(re)) {
      if (m[0].length === 0) continue;
      const inicio = desde + (m.index ?? 0);
      crudos.push({ clave, inicio, fin: inicio + m[0].length });
    }
  }
  // Una etiqueta no puede empezar dentro de otra ya aceptada; ante empate gana la más larga.
  crudos.sort((a, b) => a.inicio - b.inicio || b.fin - b.inicio - (a.fin - a.inicio));
  const aceptados: Hallazgo[] = [];
  for (const h of crudos) {
    const previo = aceptados[aceptados.length - 1];
    if (previo && h.inicio < previo.fin) continue;
    aceptados.push(h);
  }
  return aceptados;
}

function vacio(): Record<CampoActa, CampoLeidoActa> {
  const salida = {} as Record<CampoActa, CampoLeidoActa>;
  for (const c of CAMPOS_ACTA) salida[c] = { valor: null, confianza: 0, fuente: null };
  return salida;
}

function limpiar(valor: string): string | null {
  const limpio = sinSeparadoresDeValor(valor);
  if (limpio.length === 0 || esRelleno(limpio)) return null;
  return limpio;
}

/** Quita de un texto largo los renglones de relleno («_____»). */
function limpiarTextoLargo(valor: string): string | null {
  const sinRelleno = valor
    .split(/\n/)
    .map((linea) => linea.replace(/[_.\-–—|]{3,}/g, ' ').trim())
    .filter((linea) => linea.length > 0)
    .join(' ');
  const limpio = sinSeparadoresDeValor(sinRelleno);
  return limpio.replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/g, '').length >= 3 ? limpio : null;
}

function resolverContexto(hallazgos: readonly Hallazgo[]): { campo: CampoActa; hallazgo: Hallazgo }[] {
  let dueno: Contexto | null = null;
  let pasoPorUbicacion = false;
  const salida: { campo: CampoActa; hallazgo: Hallazgo }[] = [];
  for (const h of hallazgos) {
    if (h.clave === 'nombre_estudiante') dueno = 'estudiante';
    else if (h.clave === 'representante_legal') dueno = 'representante';
    else if (h.clave === 'jefe_inmediato') dueno = 'jefe';
    else if (h.clave === 'ciudad' || h.clave === 'departamento' || h.clave === 'direccion_practica') pasoPorUbicacion = true;

    if (h.clave === 'documento_ctx') {
      if (dueno === 'estudiante') salida.push({ campo: 'documento_estudiante', hallazgo: h });
      else if (dueno === 'representante') salida.push({ campo: 'documento_representante', hallazgo: h });
      else if (dueno === 'jefe') salida.push({ campo: 'documento_jefe', hallazgo: h });
      else salida.push({ campo: 'documento_estudiante', hallazgo: { ...h, clave: 'documento_ctx' } });
    } else if (h.clave === 'telefono_ctx') {
      salida.push({ campo: pasoPorUbicacion ? 'telefono_empresa' : 'telefono_estudiante', hallazgo: h });
    } else {
      salida.push({ campo: h.clave, hallazgo: h });
    }
  }
  return salida;
}

/**
 * `texto`: texto del documento, páginas unidas. `fuente`: de dónde salió (la confianza de un dato
 * leído por OCR es menor que la de uno de la capa de texto del PDF). `confianzaOcr`: confianza media
 * del motor de OCR (0–1), si se conoce.
 */
export function extraerCamposActa(texto: string, fuente: FuenteLecturaActa, confianzaOcr?: number): CamposActaLeidos {
  const salida = vacio();
  // Con OCR, la confianza que reportó el motor (0–1) manda, con techo; sin ella, la de respaldo.
  const confianza = fuente === 'texto_nativo'
    ? CONFIANZA_TEXTO_NATIVO_ACTA
    : confianzaOcr === undefined ? CONFIANZA_OCR_ACTA : Math.max(0, Math.min(CONFIANZA_MAXIMA_OCR_ACTA, confianzaOcr));
  const poner = (campo: CampoActa, valor: string | null): void => {
    if (valor === null) return;
    salida[campo] = { valor, confianza, fuente };
  };
  const plegado = plegar(texto);

  // Formato (encabezado de cada página).
  const codigo = plegado.match(/C[O0]DIG[O0]\s*[:;.]\s*(DPE\s*-?\s*F[O0]\s*\d{2})/);
  if (codigo) poner('codigo_formato', codigo[1].replace(/\s+/g, '').replace(/^DPE-?F[O0]/, 'DPE-FO'));
  const version = plegado.match(/VERSION\s*[:;.]\s*(\d{1,3})\b/);
  if (version) poner('version_formato', version[1]);
  const fechaFormato = plegado.match(/\bFECHA\s*[:;.]\s*(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4})/);
  if (fechaFormato) poner('fecha_formato', fechaFormato[1].replace(/\s+/g, ''));

  // Bloque de datos.
  const ini = plegado.search(INICIO_BLOQUE);
  const desde = ini >= 0 ? ini : 0;
  const finRelativo = plegado.slice(desde).search(FIN_BLOQUE);
  const hasta = finRelativo >= 0 ? desde + finRelativo : plegado.length;

  const resueltos = resolverContexto(hallar(plegado, desde, hasta));
  resueltos.forEach(({ campo, hallazgo }, i) => {
    const siguiente = resueltos[i + 1]?.hallazgo.inicio ?? hasta;
    const valor = limpiar(texto.slice(hallazgo.fin, siguiente));
    if (valor === null || valor.length > LARGO_MAXIMO_VALOR) return;
    // Una etiqueta repetida no pisa al primer valor leído.
    if (salida[campo].valor === null) poner(campo, valor);
  });

  // Funciones o actividades: texto libre entre su rótulo y las obligaciones del estudiante.
  const f = plegado.match(INICIO_FUNCIONES);
  if (f && f.index !== undefined) {
    const inicio = f.index + f[0].length;
    const fin = plegado.slice(inicio).search(new RegExp(frase('OBLIGACIONES DEL ESTUDIANTE')));
    const crudo = texto.slice(inicio, fin >= 0 ? inicio + fin : Math.min(plegado.length, inicio + LARGO_MAXIMO_FUNCIONES));
    const limpio = limpiarTextoLargo(crudo);
    if (limpio && limpio.length <= LARGO_MAXIMO_FUNCIONES) poner('funciones', limpio);
  }

  return salida;
}

/** Une el texto de las páginas de una lectura en el orden del documento. */
export function unirPaginas(paginas: readonly { texto: string }[]): string {
  return paginas.map((p) => p.texto).join('\n\n');
}
