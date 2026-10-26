import { EstadoDocumento, TipoDocumento } from '../entities/documento.entity';
import { ModalidadPractica, definicionModalidad } from '../entities/modalidad.entity';
import { PeriodoAcademico, diasHabilesEntre } from '../entities/periodo.entity';
import {
  CriterioEvaluado, DatosSolicitudArl, MotivoRechazoArl, REGIMENES_VERIFICACION_MANUAL, Recomendacion,
  ValidacionAutomaticaArl, aplicaSolicitudArl, documentosExigidosArl,
} from '../entities/solicitud-arl.entity';

/**
 * Validación automática de la solicitud de ARL (§9 del manual del portal).
 *
 * Lo que puede comprobarse con datos se comprueba aquí: modalidad cubierta,
 * fechas dentro del periodo y en días hábiles, anticipación, soportes
 * presentes y su veredicto en el pipeline, vigencia declarada de la EPS, del
 * RUT y de la Cámara. Lo que exige un ojo humano —que el jefe del acta sea
 * quien firma, las afiliaciones que ADRES no registra— queda marcado como
 * revisión manual. La recomendación no decide: el auxiliar decide.
 */
export interface ContextoValidacionArl {
  periodo: PeriodoAcademico | null;
  ahora: Date;
  diasHabilesAnticipacion: number;
  diasVigenciaEps: number;
}

const APROBADOS: readonly EstadoDocumento[] = [EstadoDocumento.APROBADO, EstadoDocumento.AUTO_APROBADO];
const PENDIENTES: readonly EstadoDocumento[] = [
  EstadoDocumento.RECIBIDO, EstadoDocumento.ANALIZANDO, EstadoDocumento.EN_REVISION,
];

const NOMBRE: Readonly<Partial<Record<TipoDocumento, string>>> = {
  [TipoDocumento.CERTIFICADO_EPS]: 'certificado de EPS',
  [TipoDocumento.CEDULA]: 'documento de identificación',
  [TipoDocumento.ACTA_INICIO]: 'acta de inicio',
  [TipoDocumento.RUT_NATURAL]: 'RUT de persona natural',
  [TipoDocumento.RUT_JURIDICO]: 'RUT de persona jurídica',
  [TipoDocumento.CAMARA_COMERCIO]: 'Cámara de Comercio',
};

export class ValidacionArlDomainService {
  validar(solicitud: DatosSolicitudArl, contexto: ContextoValidacionArl): ValidacionAutomaticaArl {
    const criterios: CriterioEvaluado[] = [];
    const agregar = (criterio: string, resultado: CriterioEvaluado['resultado'], detalle: string, motivo: MotivoRechazoArl | null = null) =>
      criterios.push({ criterio, resultado, detalle, motivo });

    // 1. Cobertura por modalidad.
    const cobertura = aplicaSolicitudArl(solicitud.modalidad);
    if (cobertura === 'si') agregar('Modalidad cubierta por la CUN', 'cumple', 'Práctica articulada o con ARL a cargo de la CUN.');
    else if (cobertura === 'segun_cobertura') {
      agregar('Modalidad cubierta por la CUN', 'revision_manual',
        'La cobertura depende del convenio con la organización (tercer sector u organización con acuerdo). Confirmar con jurídica.');
    } else {
      agregar('Modalidad cubierta por la CUN', 'no_cumple',
        'En esta modalidad la ARL la asume la organización receptora.', MotivoRechazoArl.MODALIDAD_NO_CUBIERTA);
    }

    // 2. Fechas dentro del periodo y sin fines de semana.
    if (!contexto.periodo) {
      agregar('Fechas dentro del periodo', 'no_cumple', `El periodo ${solicitud.periodoAcademico} no existe.`, MotivoRechazoArl.FECHAS_FUERA_DEL_PERIODO);
    } else {
      try {
        contexto.periodo.validarFechasDePractica(solicitud.fechaInicio, solicitud.fechaFin, {
          exigirDentroDelPeriodo: definicionModalidad(solicitud.modalidad).fechasDentroDelPeriodo,
        });
        agregar('Fechas dentro del periodo', 'cumple', `Del ${iso(solicitud.fechaInicio)} al ${iso(solicitud.fechaFin)}, dentro de ${contexto.periodo.codigo}.`);
      } catch (error) {
        agregar('Fechas dentro del periodo', 'no_cumple', (error as Error).message, MotivoRechazoArl.FECHAS_FUERA_DEL_PERIODO);
      }
    }

    // 3. Anticipación en días hábiles.
    const habiles = diasHabilesEntre(solicitud.radicadaEn, solicitud.fechaInicio);
    if (habiles >= contexto.diasHabilesAnticipacion) {
      agregar('Anticipación de la solicitud', 'cumple', `${habiles} día(s) hábil(es) antes del inicio.`);
    } else {
      agregar('Anticipación de la solicitud', 'no_cumple',
        `Se radicó con ${habiles} día(s) hábil(es) de anticipación; el mínimo es ${contexto.diasHabilesAnticipacion}.`,
        MotivoRechazoArl.ANTICIPACION_INSUFICIENTE);
    }

    // 4. Soportes presentes y su veredicto documental.
    for (const tipo of documentosExigidosArl(solicitud.modalidad)) {
      const nombre = NOMBRE[tipo] ?? tipo;
      const aportado = solicitud.documentos.find((d) => d.tipo === tipo);
      if (!aportado) {
        agregar(`Soporte: ${nombre}`, 'no_cumple', `No se cargó el ${nombre}.`, MotivoRechazoArl.DOCUMENTO_FALTANTE);
      } else if (APROBADOS.includes(aportado.estado)) {
        agregar(`Soporte: ${nombre}`, 'cumple', 'Aprobado en la revisión documental.');
      } else if (PENDIENTES.includes(aportado.estado)) {
        agregar(`Soporte: ${nombre}`, 'revision_manual', 'Pendiente de revisión documental.');
      } else if (aportado.estado === EstadoDocumento.ILEGIBLE) {
        agregar(`Soporte: ${nombre}`, 'no_cumple', 'Marcado como ilegible.',
          tipo === TipoDocumento.CEDULA ? MotivoRechazoArl.IDENTIFICACION_NO_LEGIBLE : MotivoRechazoArl.DOCUMENTO_BORROSO);
      } else {
        agregar(`Soporte: ${nombre}`, 'no_cumple', `Devuelto o rechazado en la revisión documental (${aportado.estado}).`, MotivoRechazoArl.OTRO);
      }
    }

    // 5. Vigencia del certificado de EPS.
    if (REGIMENES_VERIFICACION_MANUAL.includes(solicitud.epsRegimen)) {
      agregar('Vigencia y veracidad de la EPS', 'revision_manual',
        'Régimen especial o FOMAG: no registra en ADRES; verificación manual del auxiliar.');
    } else if (!solicitud.fechaExpedicionEps) {
      agregar('Vigencia y veracidad de la EPS', 'revision_manual', 'No se declaró la fecha de expedición del certificado.');
    } else {
      const dias = Math.floor((solicitud.radicadaEn.getTime() - solicitud.fechaExpedicionEps.getTime()) / 86_400_000);
      if (dias < 0) {
        agregar('Vigencia y veracidad de la EPS', 'revision_manual', 'La fecha de expedición declarada es posterior a la radicación.');
      } else if (dias <= contexto.diasVigenciaEps) {
        agregar('Vigencia y veracidad de la EPS', 'cumple', `Expedido hace ${dias} día(s); se contrasta en ADRES o RUAF.`);
      } else {
        agregar('Vigencia y veracidad de la EPS', 'no_cumple',
          `Expedido hace ${dias} días; el máximo es ${contexto.diasVigenciaEps}.`, MotivoRechazoArl.CERTIFICADO_VENCIDO);
      }
    }

    // 6. RUT y Cámara del año en curso (CUNbre).
    const anoActual = solicitud.radicadaEn.getUTCFullYear();
    const exigidos = documentosExigidosArl(solicitud.modalidad);
    if (exigidos.includes(TipoDocumento.RUT_NATURAL) || exigidos.includes(TipoDocumento.RUT_JURIDICO)) {
      this.anoEnCurso('RUT del año en curso', solicitud.fechaExpedicionRut, anoActual, MotivoRechazoArl.RUT_NO_VIGENTE, agregar);
    }
    if (exigidos.includes(TipoDocumento.CAMARA_COMERCIO)) {
      this.anoEnCurso('Cámara de Comercio del año en curso', solicitud.fechaExpedicionCamara, anoActual, MotivoRechazoArl.CAMARA_NO_VIGENTE, agregar);
    }

    // 7. Acta: el jefe inmediato debe ser quien firma (comparación humana).
    if (exigidos.includes(TipoDocumento.ACTA_INICIO)) {
      agregar('Acta: jefe inmediato coincide con la firma de la empresa', 'revision_manual',
        'Comparar el nombre del jefe inmediato con el firmante por la empresa; si difieren, se rechaza.');
    }

    const motivos = [...new Set(criterios.filter((c) => c.motivo !== null).map((c) => c.motivo as MotivoRechazoArl))];
    const recomendacion: Recomendacion = criterios.some((c) => c.resultado === 'no_cumple')
      ? 'rechazar'
      : criterios.some((c) => c.resultado === 'revision_manual') ? 'revision_manual' : 'aprobar';

    return { evaluadaEn: contexto.ahora.toISOString(), recomendacion, criterios, motivos };
  }

  private anoEnCurso(
    criterio: string, fecha: Date | null, ano: number, motivo: MotivoRechazoArl,
    agregar: (c: string, r: CriterioEvaluado['resultado'], d: string, m?: MotivoRechazoArl | null) => void,
  ): void {
    if (!fecha) agregar(criterio, 'revision_manual', 'No se declaró la fecha de expedición.');
    else if (fecha.getUTCFullYear() === ano) agregar(criterio, 'cumple', `Expedido en ${ano}.`);
    else agregar(criterio, 'no_cumple', `Expedido en ${fecha.getUTCFullYear()}; debe ser de ${ano}.`, motivo);
  }
}

/** Convierte a AAAA-MM-DD para los detalles. */
function iso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export { ModalidadPractica };
