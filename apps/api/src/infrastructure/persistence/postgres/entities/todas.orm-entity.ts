import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { ConsentimientoOrm, PoliticaConsentimientoOrm } from './consentimiento.orm-entity';
import { EvidenciaValidacionEpsOrm, ValidacionEpsOrm } from './validacion-eps.orm-entity';

/**
 * Entidades de persistencia (TypeORM). Viven en infraestructura y NO se filtran
 * al dominio: los mappers traducen. Migraciones gestionadas exclusivamente por
 * TypeORM; `synchronize` está prohibido fuera de las pruebas.
 */

@Entity({ name: 'usuarios' })
export class UsuarioOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 180 }) correo!: string;
  @Column({ type: 'varchar', length: 180 }) nombre!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) documento!: string | null;
  @Index() @Column({ type: 'varchar', length: 30 }) rol!: string;
  @Column({ type: 'varchar', length: 12, default: 'escritura' }) permiso!: string;
  @Column({ type: 'text', array: true, default: () => "'{}'" }) escuelas!: string[];
  @Index() @Column({ type: 'uuid', nullable: true }) empresa_id!: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) programa_id!: string | null;
  @Column({ default: true }) activo!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) creado_en!: Date;
  @Column({ type: 'timestamptz', nullable: true }) ultimo_acceso_en!: Date | null;
}

@Entity({ name: 'empresas' })
export class EmpresaOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 200 }) razon_social!: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 20 }) nit_numero!: string;
  @Column({ type: 'smallint' }) nit_dv!: number;
  @Column({ type: 'varchar', length: 10, nullable: true }) ciiu!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) divipola_municipio!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) direccion!: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) telefono!: string | null;
  @Column({ type: 'varchar', length: 150 }) solicitante_nombre!: string;
  @Column({ type: 'varchar', length: 180 }) solicitante_correo!: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) solicitante_cargo!: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) representante_legal!: string | null;
  @Index() @Column({ type: 'varchar', length: 30 }) estado!: string;
  @Column({ type: 'jsonb', default: () => "'[]'" }) senales!: Record<string, unknown>[];
  @Column({ type: 'uuid', nullable: true }) decidida_por!: string | null;
  @Column({ type: 'text', nullable: true }) justificacion_decision!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) solicitada_en!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) actualizada_en!: Date;
}

@Entity({ name: 'practicas' })
@Index(['escuela_id', 'estado'])
@Index(['tutor_id', 'estado'])
export class PracticaOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') estudiante_id!: string;
  @Column({ type: 'varchar', length: 60 }) programa_id!: string;
  @Index() @Column({ type: 'varchar', length: 60 }) escuela_id!: string;
  @Column({ type: 'varchar', length: 20 }) ciclo!: string;
  @Index() @Column({ type: 'varchar', length: 12 }) periodo_academico!: string;
  @Column({ type: 'varchar', length: 40 }) modalidad!: string;
  @Index() @Column({ type: 'varchar', length: 20 }) estado!: string;
  @Index() @Column({ type: 'uuid', nullable: true }) tutor_id!: string | null;
  @Index() @Column({ type: 'uuid', nullable: true }) empresa_id!: string | null;
  @ManyToOne(() => EmpresaOrm, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: EmpresaOrm | null;
  // ── Formulario Único de Registro (SGP) ──
  /** Lo asigna la base (identidad); no se envía en el INSERT. */
  @Column({ type: 'bigint', nullable: true, insert: false, update: false }) numero_fur!: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) regional!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) asignatura!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) empresa_razon_social!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) empresa_nit!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) area!: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) cargo!: string | null;
  @Column({ type: 'varchar', length: 15, nullable: true }) tipo_remuneracion!: string | null;
  @Column({ type: 'bigint', nullable: true }) salario!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) horario!: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) jefe_inmediato_nombre!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) jefe_inmediato_cargo!: string | null;
  @Column({ type: 'varchar', length: 180, nullable: true }) jefe_inmediato_correo!: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) jefe_inmediato_telefono!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) ciudad!: string | null;
  @Column({ type: 'text', nullable: true }) funciones_relevantes!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) terminos_aceptados_en!: Date | null;
  @Column({ type: 'varchar', length: 15, default: 'coordinacion' }) registrada_por!: string;
  @Column({ type: 'numeric', precision: 3, scale: 1, nullable: true }) nota!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) cerrada_en!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) fecha_inicio!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) fecha_fin!: Date | null;
  @Column({ type: 'int', nullable: true }) horas_registradas!: number | null;
  @Column({ default: false }) arl_verificada!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) arl_fecha_afiliacion!: Date | null;
  @Column({ type: 'timestamptz' }) ultima_actividad!: Date;
  @CreateDateColumn({ type: 'timestamptz' }) creada_en!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) actualizada_en!: Date;
}

@Entity({ name: 'documentos' })
@Index(['practica_id', 'tipo', 'version'], { unique: true })
export class DocumentoOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') practica_id!: string;
  @Column({ type: 'varchar', length: 40 }) tipo!: string;
  @Column({ type: 'int' }) version!: number;
  @Index() @Column({ type: 'varchar', length: 20 }) estado!: string;
  @Column({ type: 'varchar', length: 200 }) nombre_original!: string;
  @Column({ type: 'varchar', length: 60 }) mime_real!: string;
  @Column({ type: 'bigint' }) tamano_bytes!: string;
  @Index() @Column({ type: 'varchar', length: 64 }) hash_sha256!: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) hash_perceptual!: string | null;
  @Column({ type: 'varchar', length: 300 }) ruta_almacenamiento!: string;
  @Column({ type: 'jsonb', nullable: true }) calidad_captura!: Record<string, unknown> | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) banderas!: Record<string, unknown>[];
  @Column({ type: 'int', nullable: true }) puntaje!: number | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) banda!: string | null;
  @Column({ type: 'jsonb', nullable: true }) extraccion!: Record<string, unknown> | null;
  @Column({ type: 'uuid', nullable: true }) decidido_por!: string | null;
  @Column({ type: 'text', nullable: true }) justificacion_decision!: string | null;
  @Column({ type: 'text', nullable: true }) motivo_devolucion!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) cargado_en!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) actualizado_en!: Date;
  @Index() @Column({ type: 'timestamptz', nullable: true }) purgar_despues_de!: Date | null;
}

@Entity({ name: 'obligaciones' })
@Index(['practica_id', 'tipo'], { unique: true })
export class ObligacionOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') practica_id!: string;
  @Column({ type: 'varchar', length: 40 }) tipo!: string;
  @Index() @Column({ type: 'varchar', length: 20 }) estado!: string;
  @Index() @Column({ type: 'timestamptz' }) fecha_limite!: Date;
  @Column({ type: 'timestamptz', nullable: true }) cumplida_en!: Date | null;
  @Column({ type: 'uuid', nullable: true }) evidencia_documento_id!: string | null;
  @Column({ type: 'text', nullable: true }) observacion!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) creada_en!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) actualizada_en!: Date;
}

@Entity({ name: 'vacantes' })
export class VacanteOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') empresa_id!: string;
  @Index() @Column({ type: 'varchar', length: 20 }) marco!: string;
  @Column({ type: 'varchar', length: 200 }) titulo!: string;
  @Column({ type: 'text' }) descripcion!: string;
  @Column({ type: 'text' }) funciones!: string;
  @Column({ type: 'text' }) requisitos!: string;
  @Column({ type: 'varchar', length: 10 }) codigo_cno!: string;
  @Column({ type: 'varchar', length: 10 }) codigo_ciiu!: string;
  @Column({ type: 'varchar', length: 10 }) divipola_municipio!: string;
  @Column({ type: 'varchar', length: 60 }) nivel_educativo!: string;
  @Column({ type: 'int' }) vacantes_disponibles!: number;
  @Column({ type: 'bigint', nullable: true }) salario_minimo!: string | null;
  @Column({ type: 'bigint', nullable: true }) salario_maximo!: string | null;
  @Index() @Column({ type: 'varchar', length: 20 }) estado!: string;
  @Column({ type: 'timestamptz', nullable: true }) publicada_en!: Date | null;
  @Index() @Column({ type: 'timestamptz', nullable: true }) vigente_hasta!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) reportada_spe_en!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) creada_en!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) actualizada_en!: Date;
}

@Entity({ name: 'postulaciones' })
@Index(['vacante_id', 'estudiante_id'], { unique: true })
export class PostulacionOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') vacante_id!: string;
  @Index() @Column('uuid') estudiante_id!: string;
  @Index() @Column({ type: 'varchar', length: 30 }) estado!: string;
  @Column({ type: 'text', nullable: true }) observacion!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) postulada_en!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) actualizada_en!: Date;
}

/**
 * M11 — Auditoría inmutable. La migración revoca UPDATE y DELETE sobre esta
 * tabla al rol de aplicación: ninguna función puede modificar el histórico.
 */
@Entity({ name: 'auditoria' })
@Index(['actor_id', 'ocurrido_en'])
@Index(['entidad', 'entidad_id'])
export class AuditoriaOrm {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid', nullable: true }) actor_id!: string | null;
  @Column({ type: 'varchar', length: 180, nullable: true }) actor_correo!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) actor_rol!: string | null;
  @Index() @Column({ type: 'varchar', length: 60 }) accion!: string;
  @Column({ type: 'varchar', length: 40 }) entidad!: string;
  @Column({ type: 'uuid', nullable: true }) entidad_id!: string | null;
  @Column({ type: 'text', nullable: true }) justificacion!: string | null;
  @Column({ type: 'jsonb', nullable: true }) metadatos!: Record<string, unknown> | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) ip!: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) agente_usuario!: string | null;
  @Index() @Column({ type: 'timestamptz' }) ocurrido_en!: Date;
}

/** M12. Solo las sobrescrituras; el catálogo vive en el dominio. */
@Entity({ name: 'parametros' })
export class ParametroOrm {
  @PrimaryColumn({ type: 'varchar', length: 80 }) clave!: string;
  @Column({ type: 'jsonb' }) valor!: { v: number | boolean };
  @Column({ type: 'text' }) motivo!: string;
  @Column({ type: 'uuid' }) actualizado_por!: string;
  @Column({ type: 'timestamptz' }) actualizado_en!: Date;
}

/** Periodos académicos de prácticas y sus ventanas de habilitación (SGP). */
@Entity({ name: 'periodos_academicos' })
export class PeriodoOrm {
  @PrimaryColumn({ type: 'varchar', length: 12 }) codigo!: string;
  @Column({ type: 'varchar', length: 80 }) nombre!: string;
  @Index() @Column({ type: 'varchar', length: 12 }) calendario!: string;
  @Column({ type: 'date' }) fecha_inicio!: string;
  @Column({ type: 'date' }) fecha_fin!: string;
  @Column({ type: 'jsonb', default: () => "'{}'" }) ventanas!: Record<string, { desde: string; hasta: string }>;
  @Column({ type: 'date', array: true, default: () => "'{}'" }) jornadas_induccion!: string[];
  @Column({ type: 'date', nullable: true }) fecha_cargue_documentos!: string | null;
  @Column({ default: true }) sincronizacion_docentes!: boolean;
  @Column({ type: 'text', array: true, default: () => "'{}'" }) modalidades_habilitadas!: string[];
  @Index() @Column({ default: true }) activo!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) creado_en!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) actualizado_en!: Date;
}

/** Cartas de presentación emitidas (reporte de cartas del SGP). */
@Entity({ name: 'cartas_presentacion' })
@Index(['estudiante_id', 'periodo_academico'])
export class CartaOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'bigint', nullable: true }) numero_fur!: string | null;
  @Index() @Column({ type: 'uuid', nullable: true }) practica_id!: string | null;
  @Column('uuid') estudiante_id!: string;
  @Column({ type: 'varchar', length: 12 }) periodo_academico!: string;
  @Column({ type: 'varchar', length: 20 }) modalidad_carta!: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) empresa_razon_social!: string | null;
  @Column({ type: 'jsonb' }) contenido!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 64 }) hash_sha256!: string;
  @Column('uuid') generada_por!: string;
  @Index() @Column({ type: 'timestamptz' }) generada_en!: Date;
}

/**
 * Entradas de la bitácora. El rol de aplicación solo tiene SELECT e INSERT
 * sobre la tabla (ver migración): la trazabilidad no se reescribe.
 */
@Entity({ name: 'bitacora_entradas' })
export class BitacoraOrm {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') practica_id!: string;
  @Column({ type: 'varchar', length: 30 }) tipo!: string;
  @Column({ type: 'varchar', length: 15 }) autor!: string;
  @Column({ type: 'uuid', nullable: true }) autor_id!: string | null;
  @Column({ type: 'text' }) mensaje!: string;
  @Column({ type: 'jsonb', nullable: true }) detalle!: Record<string, unknown> | null;
  @Column({ type: 'timestamptz', nullable: true }) vence_el!: Date | null;
  @Index() @Column({ type: 'timestamptz' }) creada_en!: Date;
}

@Entity({ name: 'solicitudes_arl' })
export class SolicitudArlOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'bigint', nullable: true, insert: false, update: false }) consecutivo!: string | null;
  @Index() @Column('uuid') practica_id!: string;
  @Index() @Column('uuid') estudiante_id!: string;
  @Column({ type: 'varchar', length: 12 }) periodo_academico!: string;
  @Column({ type: 'varchar', length: 40 }) modalidad!: string;
  @Column({ type: 'varchar', length: 2 }) tipo_identificacion!: string;
  @Column({ type: 'varchar', length: 30 }) numero_identificacion!: string;
  @Column({ type: 'date' }) fecha_inicio!: string;
  @Column({ type: 'date' }) fecha_fin!: string;
  @Column({ type: 'varchar', length: 120 }) eps_nombre!: string;
  @Column({ type: 'varchar', length: 20 }) eps_regimen!: string;
  @Column({ type: 'date', nullable: true }) fecha_expedicion_eps!: string | null;
  @Column({ type: 'date', nullable: true }) fecha_expedicion_rut!: string | null;
  @Column({ type: 'date', nullable: true }) fecha_expedicion_camara!: string | null;
  @Column({ type: 'jsonb' }) documentos!: Record<string, unknown>[];
  @Column({ type: 'jsonb', nullable: true }) validacion!: Record<string, unknown> | null;
  @Index() @Column({ type: 'varchar', length: 25 }) estado!: string;
  @Column({ type: 'jsonb' }) motivos_rechazo!: string[];
  @Column({ type: 'text', nullable: true }) observacion!: string | null;
  @Column({ type: 'uuid', nullable: true }) decidida_por!: string | null;
  @Index() @Column({ type: 'timestamptz', nullable: true }) decidida_en!: Date | null;
  @Column({ type: 'uuid', nullable: true }) certificado_documento_id!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) certificado_enviado_en!: Date | null;
  @Index() @Column({ type: 'timestamptz' }) radicada_en!: Date;
  @Column({ type: 'timestamptz' }) actualizada_en!: Date;
}

@Entity({ name: 'pqrs' })
export class PqrsOrm {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'bigint', nullable: true, insert: false, update: false }) radicado!: string | null;
  @Index() @Column('uuid') estudiante_id!: string;
  @Column({ type: 'uuid', nullable: true }) practica_id!: string | null;
  @Column({ type: 'varchar', length: 12 }) tipo!: string;
  @Index() @Column({ type: 'varchar', length: 60 }) categoria!: string;
  @Column({ type: 'varchar', length: 200 }) asunto!: string;
  @Column({ type: 'text' }) descripcion!: string;
  @Index() @Column({ type: 'varchar', length: 15 }) estado!: string;
  @Column({ type: 'text', nullable: true }) respuesta!: string | null;
  @Column({ type: 'uuid', nullable: true }) respondida_por!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) respondida_en!: Date | null;
  @Column({ type: 'uuid', nullable: true }) unificada_con_id!: string | null;
  @Index() @Column({ type: 'timestamptz' }) radicada_en!: Date;
  @Column({ type: 'timestamptz' }) actualizada_en!: Date;
}

export const ENTIDADES_ORM = [
  ConsentimientoOrm, PoliticaConsentimientoOrm, ValidacionEpsOrm, EvidenciaValidacionEpsOrm,
  UsuarioOrm, EmpresaOrm, PracticaOrm, DocumentoOrm,
  ObligacionOrm, VacanteOrm, PostulacionOrm, AuditoriaOrm, ParametroOrm, PeriodoOrm, CartaOrm,
  BitacoraOrm, SolicitudArlOrm, PqrsOrm,
];
