import { DocumentoPdf } from '../ports/out/servicios-externos.port';
import { SnapshotCarta } from '../services/carta-presentacion.plantilla';

/**
 * Carta de presentación (SGP, «Paso 1» del proceso del estudiante).
 *
 * Desde la carta digital, cada carta emitida es un documento institucional INMUTABLE:
 *  - referencia única (no adivinable) y QR de verificación pública;
 *  - `snapshot` con los datos con que se emitió (nunca se recompone con datos posteriores);
 *  - el PDF emitido se guarda en el almacenamiento de SIPRA con su SHA-256 y se entrega siempre ese mismo archivo;
 *  - estado VIGENTE / REEMPLAZADA (una carta nueva del mismo estudiante, periodo y destinatario la reemplaza) /
 *    ANULADA (coordinación, con motivo). Nada se borra.
 * Las cartas anteriores a este modelo (sin referencia ni archivo) siguen consultables y se reimprimen desde su
 * `contenido`, como antes.
 */

export type ModalidadCarta = 'abierta' | 'con_empresa';
export type EstadoCarta = 'vigente' | 'reemplazada' | 'anulada';

export interface DatosCarta {
  id: string;
  numeroFur: number | null;
  practicaId: string | null;
  estudianteId: string;
  periodoAcademico: string;
  /** abierta = «A QUIEN CORRESPONDA»; con_empresa = organización vinculada a la práctica. */
  modalidadCarta: ModalidadCarta;
  empresaRazonSocial: string | null;
  /** Texto emitido (cartas digitales: el documento redactado; históricas: el contenido que se reimprime). */
  contenido: DocumentoPdf | Record<string, unknown>;
  /** Huella del contenido (histórico). En las cartas digitales, la del PDF va en `pdfSha256`. */
  hashSha256: string;
  generadaPor: string;
  generadaEn: Date;
  // ── Carta digital ──
  referencia: string | null;
  estado: EstadoCarta;
  reemplazadaPor: string | null;
  rutaArchivo: string | null;
  pdfSha256: string | null;
  snapshot: SnapshotCarta | null;
  /** Modalidad de práctica de la carta (código del catálogo). */
  modalidad: string | null;
  anuladaEn: Date | null;
  motivoAnulacion: string | null;
}

export class CartaPresentacion {
  private constructor(private readonly datos: DatosCarta) {}

  static desde(datos: DatosCarta): CartaPresentacion {
    return new CartaPresentacion({ ...datos });
  }

  get id(): string { return this.datos.id; }
  get estudianteId(): string { return this.datos.estudianteId; }
  get practicaId(): string | null { return this.datos.practicaId; }
  get contenido(): DocumentoPdf { return this.datos.contenido as DocumentoPdf; }
  get estado(): EstadoCarta { return this.datos.estado; }
  get esDigital(): boolean { return this.datos.rutaArchivo !== null && this.datos.referencia !== null; }

  instantanea(): DatosCarta {
    return { ...this.datos };
  }
}
