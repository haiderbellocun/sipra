/**
 * M9 — Generación de los archivos planos para la Unidad del Servicio Público
 * de Empleo.
 *
 * ADVERTENCIA DE ALCANCE, DELIBERADA Y VISIBLE
 * ────────────────────────────────────────────
 * La estructura exacta de estos archivos la fija el anexo técnico vigente
 * aplicable a prestadores con plataforma propia, que conserva la Dirección de
 * Extensión. Lo que hay aquí implementa el formato conocido —registros
 * delimitados por `|$$|`— y deja el ORDEN Y LA COMPOSICIÓN DE LOS CAMPOS
 * declarados en un solo lugar (`CAMPOS_VACANTE`, `CAMPOS_PLAZA`), de modo que
 * conciliar contra el anexo sea editar una lista y no reescribir el módulo.
 *
 * Hasta que Extensión confirme el anexo, los archivos generados son un
 * borrador verificable, no un radicable. El caso de uso lo marca así en la
 * cabecera del archivo y en la auditoría.
 */

export const SEPARADOR = '|$$|';

/** Marca que acompaña a todo archivo generado sin anexo confirmado. */
export const MARCA_BORRADOR = 'BORRADOR_SIN_ANEXO_CONFIRMADO';

export interface RegistroVacanteSpe {
  identificadorVacante: string;
  nitEmpresa: string;
  razonSocial: string;
  cargo: string;
  descripcion: string;
  funciones: string;
  requisitos: string;
  codigoCno: string;
  codigoCiiu: string;
  divipolaMunicipio: string;
  nivelEducativo: string;
  numeroVacantes: number;
  salarioMinimo: number | null;
  salarioMaximo: number | null;
  fechaPublicacion: Date;
  fechaVencimiento: Date;
}

export interface RegistroPlazaSpe {
  identificadorPlaza: string;
  nitEmpresa: string;
  razonSocial: string;
  documentoEstudiante: string;
  programa: string;
  nivelFormacion: string;
  divipolaMunicipio: string;
  codigoCno: string;
  fechaInicio: Date;
  fechaFin: Date | null;
  modalidad: string;
}

/** Definición de columnas: es el punto único a conciliar contra el anexo. */
type Campo<T> = { nombre: string; valor: (r: T) => string };

export const CAMPOS_VACANTE: readonly Campo<RegistroVacanteSpe>[] = [
  { nombre: 'IDENTIFICADOR_VACANTE', valor: (r) => r.identificadorVacante },
  { nombre: 'NIT_EMPRESA', valor: (r) => r.nitEmpresa },
  { nombre: 'RAZON_SOCIAL', valor: (r) => r.razonSocial },
  { nombre: 'CARGO', valor: (r) => r.cargo },
  { nombre: 'DESCRIPCION', valor: (r) => r.descripcion },
  { nombre: 'FUNCIONES', valor: (r) => r.funciones },
  { nombre: 'REQUISITOS', valor: (r) => r.requisitos },
  { nombre: 'CODIGO_CNO', valor: (r) => r.codigoCno },
  { nombre: 'CODIGO_CIIU', valor: (r) => r.codigoCiiu },
  { nombre: 'CODIGO_DIVIPOLA', valor: (r) => r.divipolaMunicipio },
  { nombre: 'NIVEL_EDUCATIVO', valor: (r) => r.nivelEducativo },
  { nombre: 'NUMERO_VACANTES', valor: (r) => String(r.numeroVacantes) },
  { nombre: 'SALARIO_MINIMO', valor: (r) => (r.salarioMinimo === null ? '' : String(r.salarioMinimo)) },
  { nombre: 'SALARIO_MAXIMO', valor: (r) => (r.salarioMaximo === null ? '' : String(r.salarioMaximo)) },
  { nombre: 'FECHA_PUBLICACION', valor: (r) => aFecha(r.fechaPublicacion) },
  { nombre: 'FECHA_VENCIMIENTO', valor: (r) => aFecha(r.fechaVencimiento) },
];

export const CAMPOS_PLAZA: readonly Campo<RegistroPlazaSpe>[] = [
  { nombre: 'IDENTIFICADOR_PLAZA', valor: (r) => r.identificadorPlaza },
  { nombre: 'NIT_EMPRESA', valor: (r) => r.nitEmpresa },
  { nombre: 'RAZON_SOCIAL', valor: (r) => r.razonSocial },
  { nombre: 'DOCUMENTO_PRACTICANTE', valor: (r) => r.documentoEstudiante },
  { nombre: 'PROGRAMA', valor: (r) => r.programa },
  { nombre: 'NIVEL_FORMACION', valor: (r) => r.nivelFormacion },
  { nombre: 'CODIGO_DIVIPOLA', valor: (r) => r.divipolaMunicipio },
  { nombre: 'CODIGO_CNO', valor: (r) => r.codigoCno },
  { nombre: 'FECHA_INICIO', valor: (r) => aFecha(r.fechaInicio) },
  { nombre: 'FECHA_FIN', valor: (r) => (r.fechaFin ? aFecha(r.fechaFin) : '') },
  { nombre: 'MODALIDAD', valor: (r) => r.modalidad },
];

export interface ArchivoPlano {
  nombre: string;
  contenido: string;
  registros: number;
  /** Hash del contenido: se guarda con el acuse para poder demostrar qué se envió. */
  hash: string;
}

export class ReportesSpeDomainService {
  /**
   * Un valor con el separador dentro rompería el archivo en el sistema receptor
   * y desplazaría todas las columnas siguientes. Se sanea aquí, no al leer.
   */
  sanearValor(valor: string): string {
    return (valor ?? '')
      .replace(/\|\$\$\|/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private fila<T>(campos: readonly Campo<T>[], registro: T): string {
    return campos.map((c) => this.sanearValor(c.valor(registro))).join(SEPARADOR);
  }

  private cabecera<T>(campos: readonly Campo<T>[]): string {
    return campos.map((c) => c.nombre).join(SEPARADOR);
  }

  generarVacantes(
    registros: readonly RegistroVacanteSpe[],
    opciones: { anexoConfirmado: boolean; fecha: Date; nitPrestador: string },
  ): Omit<ArchivoPlano, 'hash'> {
    return this.generar(CAMPOS_VACANTE, registros, 'VACANTES', opciones);
  }

  generarPlazas(
    registros: readonly RegistroPlazaSpe[],
    opciones: { anexoConfirmado: boolean; fecha: Date; nitPrestador: string },
  ): Omit<ArchivoPlano, 'hash'> {
    return this.generar(CAMPOS_PLAZA, registros, 'PLAZAS', opciones);
  }

  private generar<T>(
    campos: readonly Campo<T>[],
    registros: readonly T[],
    tipo: 'VACANTES' | 'PLAZAS',
    opciones: { anexoConfirmado: boolean; fecha: Date; nitPrestador: string },
  ): Omit<ArchivoPlano, 'hash'> {
    const lineas: string[] = [];

    // Un archivo no conciliado se marca dentro del propio archivo. Si alguien
    // lo radica por error, la marca queda visible para la entidad receptora.
    if (!opciones.anexoConfirmado) {
      lineas.push(`# ${MARCA_BORRADOR}`);
      lineas.push(
        '# La estructura de este archivo no ha sido conciliada contra el anexo ' +
          'técnico vigente del Servicio Público de Empleo. No radicar.',
      );
    }

    lineas.push(this.cabecera(campos));
    for (const registro of registros) lineas.push(this.fila(campos, registro));

    const marca = aFechaCompacta(opciones.fecha);
    return {
      nombre: `${opciones.nitPrestador}_${tipo}_${marca}.txt`,
      contenido: `${lineas.join('\n')}\n`,
      registros: registros.length,
    };
  }
}

/** Formato de fecha AAAA-MM-DD, estable e independiente de la zona horaria. */
function aFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function aFechaCompacta(fecha: Date): string {
  return fecha.toISOString().slice(0, 10).replace(/-/g, '');
}
