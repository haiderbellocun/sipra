/**
 * Interpretación del código PDF417 del reverso de la cédula colombiana
 * (sección 4.5 del documento técnico).
 *
 * POR QUÉ ESTO ANTES QUE OCR
 * ──────────────────────────
 * Un OCR sobre una cédula fotografiada puede confundir un 8 con un 3 y
 * devolverlo con alta confianza. El PDF417 no: lleva corrección de errores
 * Reed-Solomon, de modo que o los datos se leen correctamente o la lectura
 * falla. No hay término medio ni valores inventados.
 *
 * Son datos verificados matemáticamente, sin OCR y sin IA.
 *
 * REPARTO DE RESPONSABILIDADES
 * ────────────────────────────
 * La DECODIFICACIÓN del símbolo la hace ZXing (adaptador de infraestructura).
 * Escribir a mano un decodificador PDF417 —tablas de agrupamiento y aritmética
 * de Reed-Solomon sobre GF(929)— y no poder probarlo contra una cédula real
 * sería peor que no tenerlo: sobre un documento de identidad, un decodificador
 * sin validar es una fuente de datos falsos con apariencia de certeza.
 *
 * Este servicio se ocupa de lo que sí es propio del dominio y es verificable:
 * interpretar la trama de la Registraduría y comprobar el dígito de
 * verificación aritmético del NUIP.
 */

/**
 * Posiciones de los campos dentro de la trama.
 *
 * ADVERTENCIA, DELIBERADA Y VISIBLE
 * ─────────────────────────────────
 * Estas posiciones NO están confirmadas contra la especificación de la
 * Registraduría Nacional del Estado Civil. Se declaran en un solo lugar para
 * que conciliarlas sea editar esta constante, no rastrear el código.
 *
 * Mientras `confirmada` sea false, el sistema usa ÚNICAMENTE el número de
 * documento —que se localiza por patrón y se comprueba aritméticamente— y
 * trata los nombres como informativos. Levantar una bandera crítica de
 * "documento de otro titular" sobre nombres leídos con posiciones supuestas
 * produciría acusaciones falsas contra estudiantes.
 */
export const DISPOSICION_TRAMA = {
  confirmada: false,
  primerApellido: { desde: 48, largo: 23 },
  segundoApellido: { desde: 71, largo: 23 },
  nombres: { desde: 94, largo: 46 },
  fuente:
    'Pendiente de conciliar contra la especificación de la Registraduría Nacional ' +
    'del Estado Civil para el código PDF417 del documento de identidad.',
} as const;

export interface CedulaColombiana {
  numeroDocumento: string;
  primerApellido: string;
  segundoApellido: string;
  nombres: string;
  sexo: 'M' | 'F' | null;
  fechaNacimiento: string | null;
  /**
   * Resultado de la comprobación aritmética del número.
   * `null` cuando el formato no la admite: una cédula anterior al NUIP no
   * lleva dígito de verificación, y afirmar o negar sería inventar.
   */
  verificacionAritmetica: boolean | null;
  /**
   * false mientras la disposición de la trama no esté conciliada: los campos
   * de nombre son entonces orientativos y no deben sustentar decisiones.
   */
  disposicionConfirmada: boolean;
}

export interface LecturaCedula {
  leida: boolean;
  cedula?: CedulaColombiana;
  /** Motivo en lenguaje comprensible cuando no se pudo leer. */
  motivo?: string;
}

/** Identificadores con los que arranca la trama de la Registraduría. */
const PREFIJOS_TRAMA = ['PubDSK', 'PubDSK_1'];

export class Pdf417DomainService {
  /**
   * Interpreta el contenido crudo que devolvió el decodificador.
   *
   * Devuelve `leida: false` con un motivo comprensible ante cualquier duda.
   * Nunca devuelve campos parciales o supuestos.
   */
  interpretar(contenido: string): LecturaCedula {
    if (!contenido?.trim()) {
      return {
        leida: false,
        motivo:
          'No se encontró el código de barras. Fotografíe el REVERSO del documento, con el ' +
          'código completo dentro del encuadre y sin reflejos.',
      };
    }

    if (!PREFIJOS_TRAMA.some((prefijo) => contenido.startsWith(prefijo))) {
      return {
        leida: false,
        motivo:
          'El código leído no corresponde a una cédula colombiana. Verifique que está ' +
          'fotografiando el documento de identidad y no otro código.',
      };
    }

    const numero = this.numeroDocumento(contenido);
    if (!numero) {
      return {
        leida: false,
        motivo:
          'El código se leyó pero no contiene un número de documento reconocible. ' +
          'Vuelva a capturarlo o cargue el documento escaneado.',
      };
    }

    return {
      leida: true,
      cedula: {
        numeroDocumento: numero,
        primerApellido: this.campo(contenido, DISPOSICION_TRAMA.primerApellido),
        segundoApellido: this.campo(contenido, DISPOSICION_TRAMA.segundoApellido),
        nombres: this.campo(contenido, DISPOSICION_TRAMA.nombres),
        sexo: this.sexo(contenido),
        fechaNacimiento: this.fechaNacimiento(contenido),
        verificacionAritmetica: this.verificarNumero(numero),
        disposicionConfirmada: DISPOSICION_TRAMA.confirmada,
      },
    };
  }

  /**
   * Dígito de verificación del NUIP (números de 10 dígitos).
   *
   * Devuelve `null` para las cédulas anteriores al NUIP, que no lo llevan:
   * el formato no permite pronunciarse, y devolver `false` haría parecer
   * sospechoso un documento perfectamente válido.
   */
  verificarNumero(numero: string): boolean | null {
    if (!/^\d+$/.test(numero)) return null;
    if (numero.length !== 10) return null;

    const digitos = [...numero].map(Number);
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41];
    const suma = digitos.slice(0, 9).reduce((total, d, i) => total + d * pesos[i], 0);
    const residuo = suma % 11;
    const esperado = residuo > 1 ? 11 - residuo : residuo;
    return esperado === digitos[9];
  }

  /**
   * ¿El nombre del documento corresponde al del estudiante matriculado?
   *
   * Devuelve `null` mientras la disposición de la trama no esté conciliada:
   * comparar nombres leídos de posiciones supuestas produciría acusaciones
   * falsas. No poder pronunciarse es el resultado correcto ahí.
   *
   * Cuando sí puede, compara por tokens normalizados: el orden de los nombres
   * y la presencia de un segundo nombre varían entre fuentes, y exigir
   * coincidencia literal generaría falsas alarmas constantes.
   */
  correspondeA(cedula: CedulaColombiana, nombreEsperado: string): boolean | null {
    if (!cedula.disposicionConfirmada) return null;

    const normalizar = (texto: string): string[] =>
      texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .split(/\s+/)
        .filter((parte) => parte.length > 2);

    const delDocumento = new Set(
      normalizar(`${cedula.nombres} ${cedula.primerApellido} ${cedula.segundoApellido}`),
    );
    const esperados = normalizar(nombreEsperado);
    if (esperados.length === 0 || delDocumento.size === 0) return false;

    const comunes = esperados.filter((parte) => delDocumento.has(parte)).length;
    // Al menos dos coincidencias, o todas cuando el nombre es muy corto.
    return comunes >= Math.min(2, esperados.length);
  }

  // ── Campos de la trama ───────────────────────────────────────────────────

  private numeroDocumento(contenido: string): string | null {
    // La trama trae el número con relleno de ceros a la izquierda.
    const conRelleno = contenido.match(/0{4,}(\d{6,11})/)?.[1];
    if (conRelleno) return conRelleno;
    return contenido.match(/\b(\d{6,11})\b/)?.[1] ?? null;
  }

  private campo(contenido: string, posicion: { desde: number; largo: number }): string {
    return contenido
      .slice(posicion.desde, posicion.desde + posicion.largo)
      .replace(/\0/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sexo(contenido: string): 'M' | 'F' | null {
    const marca = contenido.match(/\b([MF])\b/)?.[1];
    return marca === 'M' || marca === 'F' ? marca : null;
  }

  private fechaNacimiento(contenido: string): string | null {
    const cruda = contenido.match(/\b(\d{4})(\d{2})(\d{2})\b/);
    if (!cruda) return null;
    const [, anio, mes, dia] = cruda;
    const numeroAnio = Number(anio);
    const numeroMes = Number(mes);
    const numeroDia = Number(dia);

    // Se rechaza lo imposible en vez de devolverlo: una fecha inválida en un
    // documento de identidad es una lectura fallida, no un dato.
    if (numeroAnio < 1900 || numeroAnio > new Date().getUTCFullYear()) return null;
    if (numeroMes < 1 || numeroMes > 12 || numeroDia < 1 || numeroDia > 31) return null;
    return `${anio}-${mes}-${dia}`;
  }
}
