import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Validación del certificado de EPS: ejes separados, reserva y versión optimista. */
@Entity({ name: 'validaciones_eps' })
export class ValidacionEpsOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') documento_id!: string;
  @Index() @Column('uuid') practica_id!: string;
  @Index() @Column('uuid') estudiante_id!: string;
  @Column({ type: 'varchar', length: 12 }) estado_procesamiento!: string;
  @Column({ type: 'varchar', length: 20 }) autenticidad!: string;
  @Column({ type: 'varchar', length: 15 }) coincidencia!: string;
  @Column({ type: 'varchar', length: 20 }) afiliacion!: string;
  @Column({ type: 'varchar', length: 20 }) ruta!: string;
  @Column({ type: 'varchar', length: 30 }) decision!: string;
  @Column({ type: 'varchar', length: 15 }) vigencia_certificado!: string;
  @Column({ type: 'boolean' }) hay_bandera_critica!: boolean;
  @Column({ type: 'jsonb', nullable: true }) datos_extraidos!: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) datos_verificados!: Record<string, unknown> | null;
  @Column({ type: 'jsonb' }) discrepancias!: Record<string, unknown>[];
  @Column({ type: 'varchar', length: 60, nullable: true }) error_codigo!: string | null;
  @Column({ type: 'uuid', nullable: true }) asignado_a!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reservado_en!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) reserva_hasta!: Date | null;
  @Column({ type: 'uuid', nullable: true }) decidido_por!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) decidido_en!: Date | null;
  /** POLÍTICA DE RETENCIÓN EPS PENDIENTE DE DEFINICIÓN INSTITUCIONAL: nadie lo llena. */
  @Column({ type: 'timestamptz', nullable: true }) retencion_hasta!: Date | null;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'timestamptz' }) creada_en!: Date;
  @Column({ type: 'timestamptz' }) actualizada_en!: Date;
}

/** Evidencias de la validación: solo inserción (disparador y permisos lo imponen). */
@Entity({ name: 'evidencias_validacion_eps' })
export class EvidenciaValidacionEpsOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') validacion_eps_id!: string;
  @Column({ type: 'varchar', length: 20 }) tipo!: string;
  @Column({ type: 'varchar', length: 20 }) fuente!: string;
  @Column({ type: 'varchar', length: 60 }) metodo!: string;
  @Column({ type: 'varchar', length: 30 }) resultado!: string;
  @Column({ type: 'timestamptz' }) fecha_verificacion!: Date;
  @Column({ type: 'char', length: 64, nullable: true }) hash_evidencia!: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) origen!: string | null;
  @Column({ type: 'jsonb' }) datos_obtenidos!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 60, nullable: true }) error_codigo!: string | null;
  @Column({ type: 'uuid', nullable: true }) verificado_por!: string | null;
  @Column({ type: 'timestamptz' }) creado_en!: Date;
}
