import {
  Bandera, DatosDocumento, Documento, EstadoDocumento, MetricasCalidadCaptura, TipoDocumento,
  BandaPuntaje,
} from '../../../../domain/entities/documento.entity';
import {
  DatosEmpresa, Empresa, EstadoEmpresa, SenalPreverificacion,
} from '../../../../domain/entities/empresa.entity';
import {
  DatosObligacion, EstadoObligacion, Obligacion, TipoObligacion,
} from '../../../../domain/entities/obligacion.entity';
import {
  CicloAcademico, DatosPractica, EstadoPractica, ModalidadPractica, OrigenRegistro, Practica,
  ResponsableArlPractica, TipoRemuneracion,
} from '../../../../domain/entities/practica.entity';
import {
  CartaPresentacion, DatosCarta, ModalidadCarta,
} from '../../../../domain/entities/carta-presentacion.entity';
import { DocumentoPdf } from '../../../../domain/ports/out/servicios-externos.port';
import {
  AutorBitacora, DatosEntradaBitacora, DetalleEntrada, EntradaBitacora, TipoEntradaBitacora,
} from '../../../../domain/entities/bitacora.entity';
import {
  DatosSolicitudArl, DocumentoAportadoArl, EstadoSolicitudArl, MotivoRechazoArl, RegimenEps, SolicitudArl,
  TipoIdentificacion, ValidacionAutomaticaArl,
} from '../../../../domain/entities/solicitud-arl.entity';
import { CategoriaPqrs, DatosPqrs, EstadoPqrs, SolicitudPqrs, TipoPqrs } from '../../../../domain/entities/pqrs.entity';
import { DatosUsuario, Usuario } from '../../../../domain/entities/usuario.entity';
import {
  DatosVacante, EstadoVacante, MarcoVacante, Vacante,
} from '../../../../domain/entities/vacante.entity';
import { Permiso, Rol } from '../../../../domain/value-objects/rol.vo';
import {
  CalendarioPeriodo, DatosPeriodo, PeriodoAcademico, TipoVentana, Ventana,
} from '../../../../domain/entities/periodo.entity';
import {
  CartaOrm, DocumentoOrm, EmpresaOrm, ObligacionOrm, PeriodoOrm, PracticaOrm, UsuarioOrm, VacanteOrm,
  BitacoraOrm, SolicitudArlOrm, PqrsOrm,
} from '../../../persistence/postgres/entities/todas.orm-entity';

/** Traducen entre entidades de persistencia y modelos de dominio. */

export const UsuarioMapper = {
  aDominio(orm: UsuarioOrm): Usuario {
    return Usuario.desde({
      id: orm.id,
      correo: orm.correo,
      nombre: orm.nombre,
      documento: orm.documento,
      rol: orm.rol as Rol,
      permiso: (orm.permiso ?? 'escritura') as Permiso,
      escuelas: orm.escuelas ?? [],
      empresaId: orm.empresa_id,
      programaId: orm.programa_id,
      activo: orm.activo,
      creadoEn: orm.creado_en,
      ultimoAccesoEn: orm.ultimo_acceso_en,
    });
  },
  aOrm(d: DatosUsuario): UsuarioOrm {
    const orm = new UsuarioOrm();
    orm.id = d.id;
    orm.correo = d.correo;
    orm.nombre = d.nombre;
    orm.documento = d.documento;
    orm.rol = d.rol;
    orm.permiso = d.permiso;
    orm.escuelas = d.escuelas;
    orm.empresa_id = d.empresaId;
    orm.programa_id = d.programaId;
    orm.activo = d.activo;
    orm.creado_en = d.creadoEn;
    orm.ultimo_acceso_en = d.ultimoAccesoEn;
    return orm;
  },
};

export const EmpresaMapper = {
  aDominio(orm: EmpresaOrm): Empresa {
    return Empresa.desde({
      id: orm.id,
      razonSocial: orm.razon_social,
      nitNumero: orm.nit_numero,
      nitDv: orm.nit_dv,
      ciiu: orm.ciiu,
      divipolaMunicipio: orm.divipola_municipio,
      direccion: orm.direccion,
      telefono: orm.telefono,
      solicitanteNombre: orm.solicitante_nombre,
      solicitanteCorreo: orm.solicitante_correo,
      solicitanteCargo: orm.solicitante_cargo,
      representanteLegal: orm.representante_legal,
      estado: orm.estado as EstadoEmpresa,
      senales: (orm.senales ?? []) as unknown as SenalPreverificacion[],
      decididaPor: orm.decidida_por,
      justificacionDecision: orm.justificacion_decision,
      solicitadaEn: orm.solicitada_en,
      actualizadaEn: orm.actualizada_en,
    });
  },
  aOrm(d: DatosEmpresa): EmpresaOrm {
    const orm = new EmpresaOrm();
    orm.id = d.id;
    orm.razon_social = d.razonSocial;
    orm.nit_numero = d.nitNumero;
    orm.nit_dv = d.nitDv;
    orm.ciiu = d.ciiu;
    orm.divipola_municipio = d.divipolaMunicipio;
    orm.direccion = d.direccion;
    orm.telefono = d.telefono;
    orm.solicitante_nombre = d.solicitanteNombre;
    orm.solicitante_correo = d.solicitanteCorreo;
    orm.solicitante_cargo = d.solicitanteCargo;
    orm.representante_legal = d.representanteLegal;
    orm.estado = d.estado;
    orm.senales = d.senales as unknown as Record<string, unknown>[];
    orm.decidida_por = d.decididaPor;
    orm.justificacion_decision = d.justificacionDecision;
    orm.solicitada_en = d.solicitadaEn;
    orm.actualizada_en = d.actualizadaEn;
    return orm;
  },
};

export const PracticaMapper = {
  aDominio(orm: PracticaOrm): Practica {
    return Practica.desde({
      id: orm.id,
      estudianteId: orm.estudiante_id,
      programaId: orm.programa_id,
      escuelaId: orm.escuela_id,
      ciclo: orm.ciclo as CicloAcademico,
      periodoAcademico: orm.periodo_academico,
      modalidad: orm.modalidad as ModalidadPractica,
      estado: orm.estado as EstadoPractica,
      tutorId: orm.tutor_id,
      empresaId: orm.empresa_id,
      numeroFur: orm.numero_fur === null || orm.numero_fur === undefined ? null : Number(orm.numero_fur),
      regional: orm.regional ?? null,
      asignatura: orm.asignatura ?? null,
      empresaRazonSocial: orm.empresa_razon_social ?? null,
      empresaNit: orm.empresa_nit ?? null,
      area: orm.area ?? null,
      cargo: orm.cargo,
      tipoRemuneracion: (orm.tipo_remuneracion ?? null) as TipoRemuneracion | null,
      salario: orm.salario === null || orm.salario === undefined ? null : Number(orm.salario),
      horario: orm.horario ?? null,
      jefeInmediatoNombre: orm.jefe_inmediato_nombre,
      jefeInmediatoCargo: orm.jefe_inmediato_cargo ?? null,
      jefeInmediatoCorreo: orm.jefe_inmediato_correo,
      jefeInmediatoTelefono: orm.jefe_inmediato_telefono ?? null,
      ciudad: orm.ciudad ?? null,
      funcionesRelevantes: orm.funciones_relevantes ?? null,
      terminosAceptadosEn: orm.terminos_aceptados_en ?? null,
      registradaPor: (orm.registrada_por ?? 'coordinacion') as OrigenRegistro,
      nota: orm.nota === null || orm.nota === undefined ? null : Number(orm.nota),
      cerradaEn: orm.cerrada_en ?? null,
      fechaInicio: orm.fecha_inicio,
      fechaFin: orm.fecha_fin,
      horasRegistradas: orm.horas_registradas,
      arlVerificada: orm.arl_verificada,
      arlFechaAfiliacion: orm.arl_fecha_afiliacion,
      responsableArlPractica: (orm.responsable_arl ?? null) as ResponsableArlPractica | null,
      ultimaActividad: orm.ultima_actividad,
      creadaEn: orm.creada_en,
      actualizadaEn: orm.actualizada_en,
    });
  },
  aOrm(d: DatosPractica): PracticaOrm {
    const orm = new PracticaOrm();
    orm.id = d.id;
    orm.estudiante_id = d.estudianteId;
    orm.programa_id = d.programaId;
    orm.escuela_id = d.escuelaId;
    orm.ciclo = d.ciclo;
    orm.periodo_academico = d.periodoAcademico;
    orm.modalidad = d.modalidad;
    orm.estado = d.estado;
    orm.tutor_id = d.tutorId;
    orm.empresa_id = d.empresaId;
    orm.regional = d.regional;
    orm.asignatura = d.asignatura;
    orm.empresa_razon_social = d.empresaRazonSocial;
    orm.empresa_nit = d.empresaNit;
    orm.area = d.area;
    orm.cargo = d.cargo;
    orm.tipo_remuneracion = d.tipoRemuneracion;
    orm.salario = d.salario === null ? null : String(d.salario);
    orm.horario = d.horario;
    orm.jefe_inmediato_nombre = d.jefeInmediatoNombre;
    orm.jefe_inmediato_cargo = d.jefeInmediatoCargo;
    orm.jefe_inmediato_correo = d.jefeInmediatoCorreo;
    orm.jefe_inmediato_telefono = d.jefeInmediatoTelefono;
    orm.ciudad = d.ciudad;
    orm.funciones_relevantes = d.funcionesRelevantes;
    orm.terminos_aceptados_en = d.terminosAceptadosEn;
    orm.registrada_por = d.registradaPor;
    orm.nota = d.nota === null ? null : d.nota.toFixed(1);
    orm.cerrada_en = d.cerradaEn;
    orm.fecha_inicio = d.fechaInicio;
    orm.fecha_fin = d.fechaFin;
    orm.horas_registradas = d.horasRegistradas;
    orm.arl_verificada = d.arlVerificada;
    orm.arl_fecha_afiliacion = d.arlFechaAfiliacion;
    orm.responsable_arl = d.responsableArlPractica;
    orm.ultima_actividad = d.ultimaActividad;
    orm.creada_en = d.creadaEn;
    orm.actualizada_en = d.actualizadaEn;
    return orm;
  },
};

export const DocumentoMapper = {
  aDominio(orm: DocumentoOrm): Documento {
    return Documento.desde({
      id: orm.id,
      practicaId: orm.practica_id,
      tipo: orm.tipo as TipoDocumento,
      version: orm.version,
      estado: orm.estado as EstadoDocumento,
      nombreOriginal: orm.nombre_original,
      mimeReal: orm.mime_real,
      tamanoBytes: Number(orm.tamano_bytes),
      hashSha256: orm.hash_sha256,
      hashPerceptual: orm.hash_perceptual,
      rutaAlmacenamiento: orm.ruta_almacenamiento,
      calidadCaptura: (orm.calidad_captura ?? null) as unknown as MetricasCalidadCaptura | null,
      banderas: (orm.banderas ?? []) as unknown as Bandera[],
      puntaje: orm.puntaje,
      banda: orm.banda as BandaPuntaje | null,
      extraccion: orm.extraccion ?? null,
      decididoPor: orm.decidido_por,
      justificacionDecision: orm.justificacion_decision,
      motivoDevolucion: orm.motivo_devolucion,
      cargadoEn: orm.cargado_en,
      actualizadoEn: orm.actualizado_en,
      purgarDespuesDe: orm.purgar_despues_de,
    });
  },
  aOrm(d: DatosDocumento): DocumentoOrm {
    const orm = new DocumentoOrm();
    orm.id = d.id;
    orm.practica_id = d.practicaId;
    orm.tipo = d.tipo;
    orm.version = d.version;
    orm.estado = d.estado;
    orm.nombre_original = d.nombreOriginal;
    orm.mime_real = d.mimeReal;
    orm.tamano_bytes = String(d.tamanoBytes);
    orm.hash_sha256 = d.hashSha256;
    orm.hash_perceptual = d.hashPerceptual;
    orm.ruta_almacenamiento = d.rutaAlmacenamiento;
    orm.calidad_captura = d.calidadCaptura as unknown as Record<string, unknown> | null;
    orm.banderas = d.banderas as unknown as Record<string, unknown>[];
    orm.puntaje = d.puntaje;
    orm.banda = d.banda;
    orm.extraccion = d.extraccion;
    orm.decidido_por = d.decididoPor;
    orm.justificacion_decision = d.justificacionDecision;
    orm.motivo_devolucion = d.motivoDevolucion;
    orm.cargado_en = d.cargadoEn;
    orm.actualizado_en = d.actualizadoEn;
    orm.purgar_despues_de = d.purgarDespuesDe;
    return orm;
  },
};

export const ObligacionMapper = {
  aDominio(orm: ObligacionOrm): Obligacion {
    return Obligacion.desde({
      id: orm.id,
      practicaId: orm.practica_id,
      tipo: orm.tipo as TipoObligacion,
      estado: orm.estado as EstadoObligacion,
      fechaLimite: orm.fecha_limite,
      cumplidaEn: orm.cumplida_en,
      evidenciaDocumentoId: orm.evidencia_documento_id,
      observacion: orm.observacion,
      creadaEn: orm.creada_en,
      actualizadaEn: orm.actualizada_en,
    });
  },
  aOrm(d: DatosObligacion): ObligacionOrm {
    const orm = new ObligacionOrm();
    orm.id = d.id;
    orm.practica_id = d.practicaId;
    orm.tipo = d.tipo;
    orm.estado = d.estado;
    orm.fecha_limite = d.fechaLimite;
    orm.cumplida_en = d.cumplidaEn;
    orm.evidencia_documento_id = d.evidenciaDocumentoId;
    orm.observacion = d.observacion;
    orm.creada_en = d.creadaEn;
    orm.actualizada_en = d.actualizadaEn;
    return orm;
  },
};

export const VacanteMapper = {
  aDominio(orm: VacanteOrm): Vacante {
    return Vacante.desde({
      id: orm.id,
      empresaId: orm.empresa_id,
      marco: orm.marco as MarcoVacante,
      titulo: orm.titulo,
      descripcion: orm.descripcion,
      funciones: orm.funciones,
      requisitos: orm.requisitos,
      codigoCno: orm.codigo_cno,
      codigoCiiu: orm.codigo_ciiu,
      divipolaMunicipio: orm.divipola_municipio,
      nivelEducativo: orm.nivel_educativo,
      vacantesDisponibles: orm.vacantes_disponibles,
      salarioMinimo: orm.salario_minimo === null ? null : Number(orm.salario_minimo),
      salarioMaximo: orm.salario_maximo === null ? null : Number(orm.salario_maximo),
      estado: orm.estado as EstadoVacante,
      publicadaEn: orm.publicada_en,
      vigenteHasta: orm.vigente_hasta,
      reportadaSpeEn: orm.reportada_spe_en,
      creadaEn: orm.creada_en,
      actualizadaEn: orm.actualizada_en,
    });
  },
  aOrm(d: DatosVacante): VacanteOrm {
    const orm = new VacanteOrm();
    orm.id = d.id;
    orm.empresa_id = d.empresaId;
    orm.marco = d.marco;
    orm.titulo = d.titulo;
    orm.descripcion = d.descripcion;
    orm.funciones = d.funciones;
    orm.requisitos = d.requisitos;
    orm.codigo_cno = d.codigoCno;
    orm.codigo_ciiu = d.codigoCiiu;
    orm.divipola_municipio = d.divipolaMunicipio;
    orm.nivel_educativo = d.nivelEducativo;
    orm.vacantes_disponibles = d.vacantesDisponibles;
    orm.salario_minimo = d.salarioMinimo === null ? null : String(d.salarioMinimo);
    orm.salario_maximo = d.salarioMaximo === null ? null : String(d.salarioMaximo);
    orm.estado = d.estado;
    orm.publicada_en = d.publicadaEn;
    orm.vigente_hasta = d.vigenteHasta;
    orm.reportada_spe_en = d.reportadaSpeEn;
    orm.creada_en = d.creadaEn;
    orm.actualizada_en = d.actualizadaEn;
    return orm;
  },
};

/** Las fechas de calendario viajan como `YYYY-MM-DD`; en el dominio son días UTC. */
/**
 * TypeORM entrega las columnas `date` como texto AAAA-MM-DD, pero los
 * elementos de un `date[]` llegan como Date del controlador de pg: se admiten
 * ambos y el día se toma siempre en UTC.
 */
function diaDesdeTexto(valor: string | Date): Date {
  if (valor instanceof Date) return new Date(`${valor.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(`${valor.slice(0, 10)}T00:00:00.000Z`);
}
function textoDesdeDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export const PeriodoMapper = {
  aDominio(orm: PeriodoOrm): PeriodoAcademico {
    const ventanas: Partial<Record<TipoVentana, Ventana>> = {};
    for (const [tipo, v] of Object.entries(orm.ventanas ?? {})) {
      ventanas[tipo as TipoVentana] = { desde: diaDesdeTexto(v.desde), hasta: diaDesdeTexto(v.hasta) };
    }
    return PeriodoAcademico.desde({
      codigo: orm.codigo,
      nombre: orm.nombre,
      calendario: orm.calendario as CalendarioPeriodo,
      fechaInicio: diaDesdeTexto(orm.fecha_inicio),
      fechaFin: diaDesdeTexto(orm.fecha_fin),
      ventanas,
      jornadasInduccion: (orm.jornadas_induccion ?? []).map((d) => diaDesdeTexto(d)),
      fechaCargueDocumentos: orm.fecha_cargue_documentos ? diaDesdeTexto(orm.fecha_cargue_documentos) : null,
      sincronizacionDocentes: orm.sincronizacion_docentes,
      modalidadesHabilitadas: (orm.modalidades_habilitadas ?? []) as ModalidadPractica[],
      activo: orm.activo,
      creadoEn: orm.creado_en,
      actualizadoEn: orm.actualizado_en,
    });
  },
  aOrm(d: DatosPeriodo): PeriodoOrm {
    const orm = new PeriodoOrm();
    orm.codigo = d.codigo;
    orm.nombre = d.nombre;
    orm.calendario = d.calendario;
    orm.fecha_inicio = textoDesdeDia(d.fechaInicio);
    orm.fecha_fin = textoDesdeDia(d.fechaFin);
    orm.jornadas_induccion = d.jornadasInduccion.map((f) => textoDesdeDia(f));
    orm.fecha_cargue_documentos = d.fechaCargueDocumentos ? textoDesdeDia(d.fechaCargueDocumentos) : null;
    orm.ventanas = Object.fromEntries(
      Object.entries(d.ventanas).map(([tipo, v]) => [
        tipo, { desde: textoDesdeDia(v.desde), hasta: textoDesdeDia(v.hasta) },
      ]),
    );
    orm.sincronizacion_docentes = d.sincronizacionDocentes;
    orm.modalidades_habilitadas = d.modalidadesHabilitadas;
    orm.activo = d.activo;
    orm.creado_en = d.creadoEn;
    orm.actualizado_en = d.actualizadoEn;
    return orm;
  },
};

export const CartaMapper = {
  aDominio(orm: CartaOrm): CartaPresentacion {
    return CartaPresentacion.desde({
      id: orm.id,
      numeroFur: orm.numero_fur === null ? null : Number(orm.numero_fur),
      practicaId: orm.practica_id,
      estudianteId: orm.estudiante_id,
      periodoAcademico: orm.periodo_academico,
      modalidadCarta: orm.modalidad_carta as ModalidadCarta,
      empresaRazonSocial: orm.empresa_razon_social,
      contenido: orm.contenido as unknown as DocumentoPdf,
      hashSha256: orm.hash_sha256,
      generadaPor: orm.generada_por,
      generadaEn: orm.generada_en,
    });
  },
  aOrm(d: DatosCarta): CartaOrm {
    const orm = new CartaOrm();
    orm.id = d.id;
    orm.numero_fur = d.numeroFur === null ? null : String(d.numeroFur);
    orm.practica_id = d.practicaId;
    orm.estudiante_id = d.estudianteId;
    orm.periodo_academico = d.periodoAcademico;
    orm.modalidad_carta = d.modalidadCarta;
    orm.empresa_razon_social = d.empresaRazonSocial;
    orm.contenido = d.contenido as unknown as Record<string, unknown>;
    orm.hash_sha256 = d.hashSha256;
    orm.generada_por = d.generadaPor;
    orm.generada_en = d.generadaEn;
    return orm;
  },
};

export const BitacoraMapper = {
  aDominio(orm: BitacoraOrm): EntradaBitacora {
    return EntradaBitacora.desde({
      id: orm.id,
      practicaId: orm.practica_id,
      tipo: orm.tipo as TipoEntradaBitacora,
      autor: orm.autor as AutorBitacora,
      autorId: orm.autor_id,
      mensaje: orm.mensaje,
      detalle: orm.detalle as DetalleEntrada | null,
      venceEl: orm.vence_el,
      creadaEn: orm.creada_en,
    });
  },
  aOrm(d: DatosEntradaBitacora): BitacoraOrm {
    const orm = new BitacoraOrm();
    orm.id = d.id;
    orm.practica_id = d.practicaId;
    orm.tipo = d.tipo;
    orm.autor = d.autor;
    orm.autor_id = d.autorId;
    orm.mensaje = d.mensaje;
    orm.detalle = d.detalle as Record<string, unknown> | null;
    orm.vence_el = d.venceEl;
    orm.creada_en = d.creadaEn;
    return orm;
  },
};

const fechaSql = (f: Date | null): string | null => (f ? f.toISOString().slice(0, 10) : null);
const fechaDominio = (s: string | null): Date | null => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`) : null);

export const SolicitudArlMapper = {
  aDominio(orm: SolicitudArlOrm): SolicitudArl {
    return SolicitudArl.desde({
      id: orm.id,
      consecutivo: orm.consecutivo === null ? null : Number(orm.consecutivo),
      practicaId: orm.practica_id,
      estudianteId: orm.estudiante_id,
      periodoAcademico: orm.periodo_academico,
      modalidad: orm.modalidad as ModalidadPractica,
      tipoIdentificacion: orm.tipo_identificacion as TipoIdentificacion,
      numeroIdentificacion: orm.numero_identificacion,
      fechaInicio: fechaDominio(orm.fecha_inicio) as Date,
      fechaFin: fechaDominio(orm.fecha_fin) as Date,
      epsNombre: orm.eps_nombre,
      epsRegimen: orm.eps_regimen as RegimenEps,
      fechaExpedicionEps: fechaDominio(orm.fecha_expedicion_eps),
      fechaExpedicionRut: fechaDominio(orm.fecha_expedicion_rut),
      fechaExpedicionCamara: fechaDominio(orm.fecha_expedicion_camara),
      documentos: orm.documentos as unknown as DocumentoAportadoArl[],
      validacion: orm.validacion as unknown as ValidacionAutomaticaArl | null,
      estado: orm.estado as EstadoSolicitudArl,
      motivosRechazo: orm.motivos_rechazo as MotivoRechazoArl[],
      observacion: orm.observacion,
      decididaPor: orm.decidida_por,
      decididaEn: orm.decidida_en,
      certificadoDocumentoId: orm.certificado_documento_id,
      certificadoEnviadoEn: orm.certificado_enviado_en,
      radicadaEn: orm.radicada_en,
      actualizadaEn: orm.actualizada_en,
    });
  },
  aOrm(d: DatosSolicitudArl): SolicitudArlOrm {
    const orm = new SolicitudArlOrm();
    orm.id = d.id;
    orm.practica_id = d.practicaId;
    orm.estudiante_id = d.estudianteId;
    orm.periodo_academico = d.periodoAcademico;
    orm.modalidad = d.modalidad;
    orm.tipo_identificacion = d.tipoIdentificacion;
    orm.numero_identificacion = d.numeroIdentificacion;
    orm.fecha_inicio = fechaSql(d.fechaInicio) as string;
    orm.fecha_fin = fechaSql(d.fechaFin) as string;
    orm.eps_nombre = d.epsNombre;
    orm.eps_regimen = d.epsRegimen;
    orm.fecha_expedicion_eps = fechaSql(d.fechaExpedicionEps);
    orm.fecha_expedicion_rut = fechaSql(d.fechaExpedicionRut);
    orm.fecha_expedicion_camara = fechaSql(d.fechaExpedicionCamara);
    orm.documentos = d.documentos as unknown as Record<string, unknown>[];
    orm.validacion = d.validacion as unknown as Record<string, unknown> | null;
    orm.estado = d.estado;
    orm.motivos_rechazo = [...d.motivosRechazo];
    orm.observacion = d.observacion;
    orm.decidida_por = d.decididaPor;
    orm.decidida_en = d.decididaEn;
    orm.certificado_documento_id = d.certificadoDocumentoId;
    orm.certificado_enviado_en = d.certificadoEnviadoEn;
    orm.radicada_en = d.radicadaEn;
    orm.actualizada_en = d.actualizadaEn;
    return orm;
  },
};

export const PqrsMapper = {
  aDominio(orm: PqrsOrm): SolicitudPqrs {
    return SolicitudPqrs.desde({
      id: orm.id,
      radicado: orm.radicado === null ? null : Number(orm.radicado),
      estudianteId: orm.estudiante_id,
      practicaId: orm.practica_id,
      tipo: orm.tipo as TipoPqrs,
      categoria: orm.categoria as CategoriaPqrs,
      asunto: orm.asunto,
      descripcion: orm.descripcion,
      estado: orm.estado as EstadoPqrs,
      respuesta: orm.respuesta,
      respondidaPor: orm.respondida_por,
      respondidaEn: orm.respondida_en,
      unificadaConId: orm.unificada_con_id,
      radicadaEn: orm.radicada_en,
      actualizadaEn: orm.actualizada_en,
    });
  },
  aOrm(d: DatosPqrs): PqrsOrm {
    const orm = new PqrsOrm();
    orm.id = d.id;
    orm.estudiante_id = d.estudianteId;
    orm.practica_id = d.practicaId;
    orm.tipo = d.tipo;
    orm.categoria = d.categoria;
    orm.asunto = d.asunto;
    orm.descripcion = d.descripcion;
    orm.estado = d.estado;
    orm.respuesta = d.respuesta;
    orm.respondida_por = d.respondidaPor;
    orm.respondida_en = d.respondidaEn;
    orm.unificada_con_id = d.unificadaConId;
    orm.radicada_en = d.radicadaEn;
    orm.actualizada_en = d.actualizadaEn;
    return orm;
  },
};
