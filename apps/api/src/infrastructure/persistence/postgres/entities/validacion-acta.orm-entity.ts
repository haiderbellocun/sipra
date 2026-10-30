import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Validación del acta de iniciación: el resultado interpretado de UN documento (una versión del acta). */
@Entity({ name: 'validaciones_acta_iniciacion' })
export class ValidacionActaOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') documento_id!: string;
  @Index() @Column('uuid') practica_id!: string;
  @Index() @Column('uuid') estudiante_id!: string;
  @Column({ type: 'varchar', length: 20 }) estado!: string;
  @Column({ type: 'integer' }) intentos!: number;
  @Column({ type: 'varchar', length: 60, nullable: true }) error_codigo!: string | null;
  @Column({ type: 'varchar', length: 25, nullable: true }) tipo_acta_detectada!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) remuneracion_detectada!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) responsable_arl_detectado!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) firma_empresa!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) firma_practicante!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) metodo_lectura!: string | null;
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true }) confianza!: string | null;
  @Column({ type: 'jsonb' }) motivos_clasificacion!: string[];
  @Column({ type: 'jsonb', nullable: true }) datos_extraidos!: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) comparacion!: Record<string, unknown> | null;
  @Column({ type: 'boolean' }) hay_discrepancia_critica!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) recibida_en!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) procesada_en!: Date | null;
  @Column({ type: 'uuid', nullable: true }) decidido_por!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) decidido_en!: Date | null;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'timestamptz' }) creada_en!: Date;
  @Column({ type: 'timestamptz' }) actualizada_en!: Date;
}

/** Evidencias de la validación: solo inserción (disparador y permisos lo imponen), idempotentes por (validación, intento, tipo). */
@Entity({ name: 'evidencias_validacion_acta' })
export class EvidenciaValidacionActaOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') validacion_acta_id!: string;
  @Column({ type: 'integer' }) intento!: number;
  @Column({ type: 'varchar', length: 30 }) tipo!: string;
  @Column({ type: 'varchar', length: 30 }) resultado!: string;
  @Column({ type: 'varchar', length: 60 }) metodo!: string;
  @Column({ type: 'timestamptz' }) fecha!: Date;
  @Column({ type: 'uuid', nullable: true }) actor_id!: string | null;
  @Column({ type: 'char', length: 64, nullable: true }) hash_documento!: string | null;
  @Column({ type: 'jsonb' }) datos!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 60, nullable: true }) error_codigo!: string | null;
  @Column({ type: 'timestamptz' }) creado_en!: Date;
}
