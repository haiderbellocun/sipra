import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Políticas de consentimiento versionadas. El texto de una versión publicada no cambia (disparador). */
@Entity({ name: 'politicas_consentimiento' })
export class PoliticaConsentimientoOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 40 }) tipo!: string;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'varchar', length: 200 }) titulo!: string;
  @Column({ type: 'varchar', length: 500 }) finalidad!: string;
  @Column({ type: 'text' }) contenido!: string;
  @Column({ type: 'char', length: 64 }) texto_sha256!: string;
  @Column({ type: 'timestamptz' }) vigente_desde!: Date;
  @Column({ type: 'timestamptz', nullable: true }) vigente_hasta!: Date | null;
  @Column({ type: 'boolean' }) activa!: boolean;
  @Column('uuid') publicada_por!: string;
  @Column({ type: 'timestamptz' }) creada_en!: Date;
}

/** Eventos de consentimiento: solo inserción (disparador y permisos lo imponen). */
@Entity({ name: 'consentimientos' })
@Index(['usuario_id', 'tipo', 'creado_en'])
export class ConsentimientoOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') usuario_id!: string;
  @Index() @Column({ type: 'uuid', nullable: true }) practica_id!: string | null;
  @Column({ type: 'varchar', length: 40 }) tipo!: string;
  @Column({ type: 'varchar', length: 500 }) finalidad!: string;
  @Index() @Column('uuid') politica_id!: string;
  @Column({ type: 'boolean' }) aceptado!: boolean;
  @Column({ type: 'varchar', length: 20 }) canal!: string;
  @Column('uuid') registrado_por!: string;
  @Column({ type: 'varchar', length: 60, nullable: true }) ip!: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) agente_usuario!: string | null;
  @Column({ type: 'timestamptz' }) creado_en!: Date;
}
