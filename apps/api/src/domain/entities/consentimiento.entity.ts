/**
 * Consentimiento de tratamiento de datos, versionado y trazable.
 *
 * Una política (`PoliticaConsentimiento`) es un texto con versión que aporta la
 * institución; un consentimiento (`Consentimiento`) es un EVENTO append-only
 * que dice «esta persona aceptó (o revocó) esta versión, por este canal, en
 * este momento». El historial nunca se edita: revocar es registrar otro evento.
 *
 * El sistema no contiene ni asume texto jurídico: el contenido de cada política
 * lo publica el responsable institucional.
 */
export enum TipoConsentimiento {
  TRATAMIENTO_DATOS = 'tratamiento_datos',
}

export enum CanalConsentimiento {
  /** La propia persona, desde la plataforma. */
  WEB = 'web',
  /** Registrado por un tercero autorizado en nombre de la persona. */
  ASISTIDO = 'asistido',
}

export interface DatosPolitica {
  id: string;
  tipo: TipoConsentimiento;
  /** Entero creciente por tipo. */
  version: number;
  titulo: string;
  /** Para qué se tratan los datos; se copia a cada consentimiento. */
  finalidad: string;
  /** Texto o referencia a él; lo define quien publica la política. */
  contenido: string;
  /** SHA-256 de `contenido`: prueba qué se mostró. */
  textoSha256: string;
  vigenteDesde: Date;
  vigenteHasta: Date | null;
  activa: boolean;
  publicadaPor: string;
  creadaEn: Date;
}

export class PoliticaConsentimiento {
  private constructor(private readonly datos: DatosPolitica) {}

  static desde(datos: DatosPolitica): PoliticaConsentimiento {
    return new PoliticaConsentimiento({ ...datos });
  }

  get id(): string { return this.datos.id; }
  get tipo(): TipoConsentimiento { return this.datos.tipo; }
  get version(): number { return this.datos.version; }
  get titulo(): string { return this.datos.titulo; }
  get finalidad(): string { return this.datos.finalidad; }
  get contenido(): string { return this.datos.contenido; }
  get vigenteDesde(): Date { return this.datos.vigenteDesde; }
  get vigenteHasta(): Date | null { return this.datos.vigenteHasta; }

  instantanea(): DatosPolitica { return { ...this.datos }; }

  /** Vigente: marcada activa y dentro de su ventana. Una política vencida o retirada no se acepta. */
  vigenteEn(fecha: Date): boolean {
    return (
      this.datos.activa &&
      this.datos.vigenteDesde.getTime() <= fecha.getTime() &&
      (this.datos.vigenteHasta === null || fecha.getTime() < this.datos.vigenteHasta.getTime())
    );
  }
}

export interface DatosConsentimiento {
  id: string;
  usuarioId: string;
  practicaId: string | null;
  tipo: TipoConsentimiento;
  finalidad: string;
  politicaId: string;
  aceptado: boolean;
  canal: CanalConsentimiento;
  /** Quién ejecutó el registro; coincide con `usuarioId` cuando la persona acepta por sí misma. */
  registradoPor: string;
  ip: string | null;
  agenteUsuario: string | null;
  creadoEn: Date;
}

export class Consentimiento {
  private constructor(private readonly datos: DatosConsentimiento) {}

  static desde(datos: DatosConsentimiento): Consentimiento {
    return new Consentimiento({ ...datos });
  }

  get id(): string { return this.datos.id; }
  get usuarioId(): string { return this.datos.usuarioId; }
  get practicaId(): string | null { return this.datos.practicaId; }
  get tipo(): TipoConsentimiento { return this.datos.tipo; }
  get politicaId(): string { return this.datos.politicaId; }
  get aceptado(): boolean { return this.datos.aceptado; }
  get creadoEn(): Date { return this.datos.creadoEn; }

  instantanea(): DatosConsentimiento { return { ...this.datos }; }
}
