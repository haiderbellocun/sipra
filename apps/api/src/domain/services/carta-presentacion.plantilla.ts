import { DefinicionModalidad, ModalidadPractica, definicionModalidad } from '../entities/modalidad.entity';

/**
 * Carta de presentación digital · ÚNICA fuente de la redacción (dominio puro: sin Nest, sin PDF).
 *
 * Fuente: las cartas institucionales vigentes (Monitoría y Pasantía, en PDF; Contrato de aprendizaje, en la plantilla
 * DOCX) firmadas por la Coordinación de Desarrollo Profesional. Se conserva su estructura y su texto, con tres ajustes:
 *  - destinatario genérico ÚNICO: «A QUIEN CORRESPONDA» (las cartas alternaban con «A QUIEN INTERESE»);
 *  - el párrafo de ARL ya NO es fijo: refleja el responsable REAL de la práctica (G3/G5). Las cartas decían siempre
 *    «La empresa deberá afiliar…», también en Monitoría;
 *  - correcciones de redacción («esta carta», «de acuerdo con el Decreto…», singular del estudiante).
 * El texto para «CUN afilia» y para la carta genérica sin práctica (responsable aún no definido) NO estaba en las
 * fuentes: se redactó como reflejo literal del dato de SIPRA y queda PENDIENTE DE RATIFICACIÓN institucional.
 */

export type ResponsableArlCarta = 'empresa' | 'cun' | null;

export const DESTINATARIO_GENERICO = 'A QUIEN CORRESPONDA';
export const CORREO_VERIFICACION = 'practicas@cun.edu.co';

export const ENCABEZADO_INSTITUCIONAL: readonly string[] = [
  'CORPORACIÓN UNIFICADA NACIONAL DE EDUCACIÓN SUPERIOR',
  'FORMACIÓN POR CICLOS PROPEDÉUTICOS',
  'Personería Jurídica 1379/83 M.E.N. · Registro I.C.F.E.S. Código 4813 · N.I.T. 860.401.734-9',
];

const NUMEROS: Readonly<Record<number, string>> = { 1: 'un', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis', 12: 'doce' };
const meses = (n: number): string => `${NUMEROS[n] ?? String(n)} ${n === 1 ? 'mes' : 'meses'}`;

/**
 * Frase de vigencia por modalidad. Donde la carta institucional tiene una redacción propia, se usa esa (es la fuente);
 * en las demás, se deriva del catálogo de modalidades (duración mínima/máxima) sin inventar plazos.
 */
const VIGENCIA_INSTITUCIONAL: Partial<Record<ModalidadPractica, string>> = {
  [ModalidadPractica.MONITORIA]: 'con una duración mínima de un mes y máxima de dos meses a partir de la generación de esta carta',
  [ModalidadPractica.PASANTIA]: 'con una duración mínima de un mes y máxima de tres meses a partir de la generación de esta carta',
  [ModalidadPractica.CONTRATO_APRENDIZAJE]: 'a partir de la firma del contrato',
};

export function fraseVigencia(def: Pick<DefinicionModalidad, 'modalidad' | 'duracionMesesMinima' | 'duracionMesesMaxima'>): string {
  const propia = VIGENCIA_INSTITUCIONAL[def.modalidad];
  if (propia) return propia;
  const { duracionMesesMinima: min, duracionMesesMaxima: max } = def;
  if (min && max) return `con una duración mínima de ${meses(min)} y máxima de ${meses(max)} a partir de la generación de esta carta`;
  if (min) return `con una duración mínima de ${meses(min)} a partir de la generación de esta carta`;
  return 'con la duración establecida para la modalidad, a partir de la generación de esta carta';
}

/** Párrafo de ARL según el responsable REAL; nunca «la empresa deberá afiliar» si afilia la CUN. */
export function parrafoArl(responsable: ResponsableArlCarta): string {
  switch (responsable) {
    case 'empresa':
      return 'La empresa deberá afiliar al estudiante ante la Administradora de Riesgos Laborales (ARL), de acuerdo con el Decreto 055 de 2015.';
    case 'cun':
      return 'La afiliación del estudiante ante la Administradora de Riesgos Laborales (ARL) estará a cargo de la Corporación ' +
        'Unificada Nacional de Educación Superior – CUN, de acuerdo con el Decreto 055 de 2015.';
    default:
      return 'La afiliación del estudiante ante la Administradora de Riesgos Laborales (ARL) se definirá al formalizar el ' +
        'registro de la práctica, de acuerdo con el Decreto 055 de 2015.';
  }
}

const NIVEL: Readonly<Record<string, string>> = { tecnico: 'TÉCNICO', tecnologo: 'TECNOLÓGICO', profesional: 'PROFESIONAL' };
export function nivelLegible(ciclo: string): string {
  return NIVEL[ciclo] ?? ciclo.toUpperCase();
}

const TIPO_DOCUMENTO: Readonly<Record<string, string>> = { CC: 'C.C.', TI: 'T.I.', CE: 'C.E.', PA: 'pasaporte', PPT: 'P.P.T.' };
export function tipoDocumentoLegible(tipo: string | null | undefined): string {
  return (tipo && TIPO_DOCUMENTO[tipo.trim().toUpperCase()]) ?? 'documento de identidad';
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Fecha de expedición en el calendario de Colombia (UTC−5, sin horario de verano): «viernes 13 de noviembre de 2026». */
export function fechaColombia(fecha: Date): { iso: string; texto: string } {
  const local = new Date(fecha.getTime() - 5 * 3600 * 1000);
  const iso = local.toISOString().slice(0, 10);
  const texto = `${DIAS[local.getUTCDay()]} ${local.getUTCDate()} de ${MESES[local.getUTCMonth()]} de ${local.getUTCFullYear()}`;
  return { iso, texto };
}

/** Datos con los que se emite la carta (se guardan tal cual: la carta nunca se recompone con datos posteriores). */
export interface SnapshotCarta {
  referencia: string;
  estudianteNombre: string;
  tipoDocumento: string | null;
  documento: string;
  programa: string;
  ciclo: string;
  nivel: string;
  periodoAcademico: string;
  modalidad: ModalidadPractica;
  modalidadEtiqueta: string;
  destinatario: { tipo: 'generica' | 'empresa'; nombre: string };
  responsableArl: ResponsableArlCarta;
  practicaId: string | null;
  /** Escuela del estudiante al emitir: acota quién (además de él) consulta la carta. */
  escuelaId: string | null;
  fechaExpedicion: string;
  fechaTexto: string;
  firmante: { nombre: string; cargo: string; dependencia: string };
}

/** Texto final de la carta, listo para maquetar. */
export interface DocumentoCarta {
  encabezado: readonly string[];
  fechaLugar: string;
  destinatario: readonly string[];
  saludo: string;
  parrafos: readonly string[];
  notaVerificacion: string;
  despedida: string;
  firmante: readonly string[];
  referencia: string;
}

export function redactarCarta(s: SnapshotCarta): DocumentoCarta {
  const def = definicionModalidad(s.modalidad);
  const identificacion = `${tipoDocumentoLegible(s.tipoDocumento)} N.º ${s.documento}`;
  return {
    encabezado: ENCABEZADO_INSTITUCIONAL,
    fechaLugar: `Bogotá, ${s.fechaTexto}`,
    destinatario: ['SEÑORES:', s.destinatario.nombre],
    saludo: 'Respetuoso saludo.',
    parrafos: [
      `Le presentamos a nuestro(a) estudiante ${s.estudianteNombre.toUpperCase()}, identificado(a) con ${identificacion}, ` +
        `quien aplica para ingresar a realizar sus prácticas empresariales bajo la modalidad de ${s.modalidadEtiqueta.toUpperCase()} ` +
        `${fraseVigencia(def)}, según el acuerdo establecido entre la empresa y el estudiante.`,
      `La realización de las prácticas empresariales forma parte de los requisitos de grado establecidos en el pensum académico ` +
        `del programa de ${s.programa.toUpperCase()}, correspondiente al nivel ${s.nivel}.`,
      'El (la) estudiante deberá soportar ante la empresa su afiliación al sistema de salud y contar con el seguro estudiantil de accidentes.',
      parrafoArl(s.responsableArl),
      'En caso de que la empresa requiera los servicios del (de la) estudiante por un tiempo superior al inicialmente estipulado, ' +
        'deberá tramitar una solicitud formal de extensión ante la Coordinación de Prácticas para su respectiva validación.',
    ],
    notaVerificacion: `* Para verificar la información y la veracidad de esta carta de presentación puede escribir al correo ` +
      `${CORREO_VERIFICACION} o consultar su referencia en SIPRA.`,
    despedida: 'Quedamos atentos a su pronta respuesta.',
    firmante: [s.firmante.nombre, s.firmante.cargo, s.firmante.dependencia, 'Corporación Unificada Nacional de Educación Superior CUN']
      .filter((l) => l.trim().length > 0),
    referencia: s.referencia,
  };
}

/** Documento enmascarado para la verificación pública: solo los cuatro últimos dígitos. */
export function enmascararDocumento(documento: string): string {
  const limpio = documento.replace(/\s/g, '');
  return limpio.length <= 4 ? '••••' : `${'•'.repeat(Math.min(limpio.length - 4, 6))}${limpio.slice(-4)}`;
}

/** Nombre de archivo seguro: solo letras/dígitos/guion; nunca rutas. */
export function nombreArchivoCarta(documento: string, fechaIso: string): string {
  const doc = documento.replace(/[^0-9A-Za-z]/g, '').slice(0, 20) || 'estudiante';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaIso) ? fechaIso : 'fecha';
  return `Carta_presentacion_${doc}_${fecha}.pdf`;
}

const ALFABETO_REFERENCIA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Referencia visible: 10 símbolos sin ambiguos (≈ 8·10^14 combinaciones), con guion al medio. `azar(n)` ∈ [0, n). */
export function construirReferencia(azar: (n: number) => number): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += ALFABETO_REFERENCIA[azar(ALFABETO_REFERENCIA.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
export const PATRON_REFERENCIA = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/;
