import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Validación de un documento empresarial (RUT o Cámara): el resultado interpretado de UN documento (una versión). */
@Entity({ name: 'validaciones_documento_empresarial' })
export class ValidacionDocumentoEmpresarialOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') documento_id!: string;
  @Index() @Column('uuid') practica_id!: string;
  @Index() @Column('uuid') estudiante_id!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) tipo_esperado!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) familia_documento!: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) tipo_detectado!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) tipo_persona!: string | null;
  @Column({ type: 'varchar', length: 25, nullable: true }) expectativa!: string | null;
  @Column({ type: 'varchar', length: 20 }) estado!: string;
  @Column({ type: 'integer' }) intentos!: number;
  @Column({ type: 'varchar', length: 60, nullable: true }) error_codigo!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) metodo_lectura!: string | null;
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true }) confianza!: string | null;
  @Column({ type: 'boolean' }) lectura_dudosa!: boolean;
  @Column({ type: 'char', length: 64, nullable: true }) hash_documento!: string | null;
  @Column({ type: 'uuid', nullable: true }) duplicado_de_documento_id!: string | null;
  @Column({ type: 'jsonb', nullable: true }) datos_extraidos!: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) comparacion!: Record<string, unknown> | null;
  @Column({ type: 'varchar', length: 20 }) autenticidad_estado!: string;
  @Column({ type: 'jsonb' }) autenticidad!: Record<string, unknown>;
  @Column({ type: 'timestamptz', nullable: true }) recibida_en!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) procesada_en!: Date | null;
  @Column({ type: 'uuid', nullable: true }) decidido_por!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) decidido_en!: Date | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) motivo_decision!: string | null;
  @Column({ type: 'uuid', nullable: true }) asignado_a!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reservado_en!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) reserva_hasta!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) datos_sipra_cambiaron_en!: Date | null;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'timestamptz' }) creada_en!: Date;
  @Column({ type: 'timestamptz' }) actualizada_en!: Date;
}

/** Evidencias de la validación: solo inserción (disparador y permisos lo imponen), idempotentes por (validación, intento, tipo). */
@Entity({ name: 'evidencias_validacion_doc_empresarial' })
export class EvidenciaValidacionDocEmpresarialOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') validacion_id!: string;
  @Column({ type: 'integer' }) intento!: number;
  @Column({ type: 'varchar', length: 30 }) tipo!: string;
  @Column({ type: 'varchar', length: 40 }) resultado!: string;
  @Column({ type: 'varchar', length: 60 }) metodo!: string;
  @Column({ type: 'timestamptz' }) fecha!: Date;
  @Column({ type: 'uuid', nullable: true }) actor_id!: string | null;
  @Column({ type: 'char', length: 64, nullable: true }) hash_documento!: string | null;
  @Column({ type: 'jsonb' }) datos!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 60, nullable: true }) error_codigo!: string | null;
  @Column({ type: 'timestamptz' }) creado_en!: Date;
}
