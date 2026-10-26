import { DocumentoPdf } from '../ports/out/servicios-externos.port';

/**
 * Carta de presentación (SGP, «Paso 1» del proceso del estudiante).
 *
 * La genera la plataforma cuando el estudiante tiene matriculada la asignatura
 * de práctica, para que se presente ante las organizaciones. Puede ser
 * «abierta» —a quien corresponda— o dirigida a una empresa concreta cuando ya
 * hay un registro de práctica. El reporte de cartas del manual de coordinación
 * la identifica por número de FUR, fecha, hora, modalidad de carta, estudiante
 * y empresa: esos son los datos que aquí se guardan.
 */

export type ModalidadCarta = 'abierta' | 'con_empresa';

export interface DatosCarta {
  id: string;
  numeroFur: number | null;
  practicaId: string | null;
  estudianteId: string;
  periodoAcademico: string;
  modalidadCarta: ModalidadCarta;
  empresaRazonSocial: string | null;
  /** El texto tal como se emitió: la carta se reimprime idéntica. */
  contenido: DocumentoPdf;
  hashSha256: string;
  generadaPor: string;
  generadaEn: Date;
}

export class CartaPresentacion {
  private constructor(private readonly datos: DatosCarta) {}

  static desde(datos: DatosCarta): CartaPresentacion {
    return new CartaPresentacion({ ...datos });
  }

  get id(): string { return this.datos.id; }
  get estudianteId(): string { return this.datos.estudianteId; }
  get practicaId(): string | null { return this.datos.practicaId; }
  get contenido(): DocumentoPdf { return this.datos.contenido; }

  instantanea(): DatosCarta {
    return { ...this.datos };
  }
}

export interface DatosParaCarta {
  estudianteNombre: string;
  estudianteDocumento: string | null;
  programa: string;
  ciclo: string;
  periodoAcademico: string;
  asignatura: string | null;
  modalidad: string | null;
  empresaRazonSocial: string | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  numeroFur: number | null;
  fecha: Date;
  consecutivo: string;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function fechaLarga(fecha: Date): string {
  return `${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]} de ${fecha.getUTCFullYear()}`;
}

const CICLO_LEGIBLE: Record<string, string> = {
  tecnico: 'Técnico Profesional',
  tecnologo: 'Tecnológico',
  profesional: 'Profesional',
};

/** Compone el texto de la carta. Sin dependencias: se puede probar palabra por palabra. */
export class CartaPresentacionDomainService {
  componer(d: DatosParaCarta): DocumentoPdf {
    const nivel = CICLO_LEGIBLE[d.ciclo] ?? d.ciclo;
    const identificacion = d.estudianteDocumento
      ? `, identificado(a) con documento número ${d.estudianteDocumento},`
      : ',';
    const destinatario = d.empresaRazonSocial
      ? `Señores\n${d.empresaRazonSocial}`
      : 'A quien corresponda';

    const parrafos: string[] = [
      `La CORPORACIÓN UNIFICADA NACIONAL DE EDUCACIÓN SUPERIOR — CUN se permite presentar a ` +
        `${d.estudianteNombre}${identificacion} estudiante del programa ${d.programa}, ` +
        `nivel ${nivel}, quien se encuentra matriculado(a) en el periodo académico ` +
        `${d.periodoAcademico}${d.asignatura ? ` en la asignatura ${d.asignatura}` : ''}.`,
    ];

    if (d.modalidad && d.empresaRazonSocial && d.fechaInicio && d.fechaFin) {
      parrafos.push(
        `El (la) estudiante desarrollará su práctica en la modalidad ${d.modalidad} en ` +
          `${d.empresaRazonSocial}, entre el ${fechaLarga(d.fechaInicio)} y el ` +
          `${fechaLarga(d.fechaFin)}, bajo el acompañamiento de un docente facilitador ` +
          `de la institución.`,
      );
    } else {
      parrafos.push(
        'El (la) estudiante se encuentra habilitado(a) para adelantar su práctica académica ' +
          'en una organización del sector productivo o social, en alguna de las modalidades ' +
          'reglamentadas por la institución, con el acompañamiento de un docente facilitador.',
      );
    }

    parrafos.push(
      'La práctica es un componente académico obligatorio para la obtención del título. ' +
        'Agradecemos el espacio formativo que su organización pueda brindar y quedamos ' +
        'atentos a cualquier información adicional que requieran.',
    );

    return {
      titulo: 'Carta de presentación',
      encabezado: [
        'Corporación Unificada Nacional de Educación Superior — CUN',
        'Dirección de Desarrollo Profesional · Área de Prácticas',
      ],
      fechaLugar: `Bogotá D. C., ${fechaLarga(d.fecha)}`,
      parrafos: [destinatario, ...parrafos, 'Cordialmente,'],
      firma: [
        'Dirección de Desarrollo Profesional',
        'Corporación Unificada Nacional de Educación Superior — CUN',
      ],
      pie: [
        `Carta ${d.consecutivo}${d.numeroFur ? ` · FUR n.º ${d.numeroFur}` : ''}`,
        'Documento generado por SIPRA PRÁCTICAS. Su autenticidad se verifica en la plataforma.',
      ],
    };
  }
}
