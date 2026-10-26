/**
 * Plantillas de notificación (M10).
 *
 * PRINCIPIO
 * ─────────
 * Toda notificación de devolución debe explicar en lenguaje comprensible qué
 * corregir. Un mensaje que solo dice "documento rechazado" genera una llamada
 * al conmutador, y traslada al estudiante el costo de averiguar qué pasó.
 *
 * Las plantillas viven en el dominio, no en el adaptador de correo: el texto
 * que recibe un estudiante es una decisión de producto, no de infraestructura.
 */

export enum EventoNotificable {
  DOCUMENTO_DEVUELTO = 'documento_devuelto',
  DOCUMENTO_ILEGIBLE = 'documento_ilegible',
  DOCUMENTO_APROBADO = 'documento_aprobado',
  OBLIGACION_POR_VENCER = 'obligacion_por_vencer',
  PRACTICA_ACTIVADA = 'practica_activada',
  EMPRESA_HABILITADA = 'empresa_habilitada',
  INVITACION_EMPRESA = 'invitacion_empresa',
  CERTIFICADO_EMITIDO = 'certificado_emitido',
  REGISTRO_CONFIRMADO = 'registro_confirmado',
  MENSAJE_BITACORA = 'mensaje_bitacora',
  PLAZO_SUBSANACION = 'plazo_subsanacion',
  PROCESO_CERRADO = 'proceso_cerrado',
  SOLICITUD_ARL_RADICADA = 'solicitud_arl_radicada',
  SOLICITUD_ARL_RECHAZADA = 'solicitud_arl_rechazada',
  CERTIFICADO_ARL_DISPONIBLE = 'certificado_arl_disponible',
  CONSOLIDADO_ARL = 'consolidado_arl',
  PQRS_RADICADA = 'pqrs_radicada',
  PQRS_RESPONDIDA = 'pqrs_respondida',
}

export interface MensajeCompuesto {
  asunto: string;
  /** Cuerpo en texto plano. Es el que se envía y el que queda en auditoría. */
  texto: string;
  /** Cuerpo en HTML, para clientes que lo admitan. */
  html: string;
}

export interface DatosNotificacion {
  nombreDestinatario: string;
  tipoDocumento?: string;
  motivo?: string;
  /** Indicaciones concretas de qué revisar, en lenguaje del estudiante. */
  guias?: readonly string[];
  obligacion?: string;
  norma?: string;
  diasRestantes?: number;
  empresa?: string;
  enlace?: string;
  modalidad?: string;
  periodo?: string;
  /** Documentos exigidos por momento, ya en lenguaje del estudiante. */
  documentosPorMomento?: readonly { momento: string; documentos: readonly string[] }[];
  /** Quién escribió en la bitácora y qué. */
  autor?: string;
  mensaje?: string;
  /** Fecha límite ya formateada (plazo de subsanación). */
  fechaLimite?: string;
  documentos?: readonly string[];
  nota?: number;
  aprobada?: boolean;
  /** Solicitud de ARL: consecutivo y motivos de rechazo en lenguaje del estudiante. */
  consecutivo?: number | null;
  motivos?: readonly string[];
  /** Consolidado diario: filas ya formateadas. */
  filas?: readonly string[];
  fecha?: string;
}

/**
 * Nombres legibles de los tipos documentales, con su género gramatical.
 *
 * El género no es un adorno: sin él, un mensaje sobre una planilla termina
 * diciendo «vuelva a cargarlo», y un correo institucional mal escrito resta
 * credibilidad a lo que dice.
 */
interface NombreDocumento {
  nombre: string;
  genero: 'm' | 'f';
}

const NOMBRES_DOCUMENTO: Record<string, NombreDocumento> = {
  cedula: { nombre: 'documento de identidad', genero: 'm' },
  carta_aceptacion: { nombre: 'carta de aceptación', genero: 'f' },
  certificado_arl: { nombre: 'certificado de afiliación a ARL', genero: 'm' },
  convenio_practica: { nombre: 'convenio de práctica', genero: 'm' },
  planilla_horas: { nombre: 'planilla de horas', genero: 'f' },
  plan_mejoramiento: { nombre: 'plan de mejoramiento', genero: 'm' },
  certificado_existencia: {
    nombre: 'certificado de existencia y representación legal',
    genero: 'm',
  },
  certificacion_laboral: { nombre: 'certificación laboral', genero: 'f' },
  planilla_aportes: { nombre: 'planilla de aportes', genero: 'f' },
  certificado_practica: { nombre: 'certificado de práctica', genero: 'm' },
  certificado_eps: { nombre: 'certificado de afiliación a EPS', genero: 'm' },
  acta_inicio: { nombre: 'acta de inicio', genero: 'f' },
  rut_natural: { nombre: 'RUT de persona natural', genero: 'm' },
  rut_juridico: { nombre: 'RUT de persona jurídica', genero: 'm' },
  camara_comercio: { nombre: 'certificado de Cámara de Comercio', genero: 'm' },
  contrato_aprendizaje: { nombre: 'contrato de aprendizaje', genero: 'm' },
  certificado_laboral_funciones: { nombre: 'certificado laboral con funciones', genero: 'm' },
  contrato_laboral: { nombre: 'contrato laboral', genero: 'm' },
  formato_seguimiento_final: { nombre: 'formato de seguimiento final PSO-F012', genero: 'm' },
  carta_finalizacion: { nombre: 'carta de finalización', genero: 'f' },
  avance_plan_mejoramiento: { nombre: 'avance del plan de mejoramiento', genero: 'm' },
  propuesta_articulo: { nombre: 'propuesta de artículo científico', genero: 'f' },
  constancia_publicacion: { nombre: 'constancia de publicación', genero: 'f' },
  soporte_aceptacion_cunbre: { nombre: 'soporte de aceptación de CUNbre', genero: 'm' },
  evaluacion_final_cunbre: { nombre: 'evaluación final de CUNbre', genero: 'f' },
  informe_1: { nombre: 'informe 1 de monitoría', genero: 'm' },
  informe_2: { nombre: 'informe 2 de monitoría', genero: 'm' },
  informe_final: { nombre: 'informe final de monitoría', genero: 'm' },
};

const DOCUMENTO_GENERICO: NombreDocumento = { nombre: 'documento', genero: 'm' };

export class PlantillasNotificacionDomainService {
  componer(evento: EventoNotificable, datos: DatosNotificacion): MensajeCompuesto {
    switch (evento) {
      case EventoNotificable.DOCUMENTO_DEVUELTO:
        return this.documentoDevuelto(datos);
      case EventoNotificable.DOCUMENTO_ILEGIBLE:
        return this.documentoIlegible(datos);
      case EventoNotificable.DOCUMENTO_APROBADO:
        return this.documentoAprobado(datos);
      case EventoNotificable.OBLIGACION_POR_VENCER:
        return this.obligacionPorVencer(datos);
      case EventoNotificable.PRACTICA_ACTIVADA:
        return this.practicaActivada(datos);
      case EventoNotificable.EMPRESA_HABILITADA:
        return this.empresaHabilitada(datos);
      case EventoNotificable.INVITACION_EMPRESA:
        return this.invitacionEmpresa(datos);
      case EventoNotificable.CERTIFICADO_EMITIDO:
        return this.certificadoEmitido(datos);
      case EventoNotificable.REGISTRO_CONFIRMADO:
        return this.registroConfirmado(datos);
      case EventoNotificable.MENSAJE_BITACORA:
        return this.mensajeBitacora(datos);
      case EventoNotificable.PLAZO_SUBSANACION:
        return this.plazoSubsanacion(datos);
      case EventoNotificable.PROCESO_CERRADO:
        return this.procesoCerrado(datos);
      case EventoNotificable.SOLICITUD_ARL_RADICADA:
        return this.solicitudArlRadicada(datos);
      case EventoNotificable.SOLICITUD_ARL_RECHAZADA:
        return this.solicitudArlRechazada(datos);
      case EventoNotificable.CERTIFICADO_ARL_DISPONIBLE:
        return this.certificadoArlDisponible(datos);
      case EventoNotificable.CONSOLIDADO_ARL:
        return this.consolidadoArl(datos);
      case EventoNotificable.PQRS_RADICADA:
        return this.pqrsRadicada(datos);
      case EventoNotificable.PQRS_RESPONDIDA:
        return this.pqrsRespondida(datos);
    }
  }

  private documentoDevuelto(datos: DatosNotificacion): MensajeCompuesto {
    const doc = this.nombreDocumento(datos.tipoDocumento);
    const lo = doc.genero === 'f' ? 'la' : 'lo';
    const cuerpo = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Su ${doc.nombre} necesita una corrección antes de que podamos aprobar${lo}.`,
      '',
      datos.motivo ?? `Revise el documento y vuelva a cargar${lo}.`,
      ...this.bloqueGuias(datos.guias),
      '',
      `Cuando ${lo} corrija, cárgue${lo} de nuevo desde la plataforma. No necesita`,
      'responder a este correo.',
    ];
    return this.armar(`Su ${doc.nombre} requiere una corrección`, cuerpo, datos);
  }

  private documentoIlegible(datos: DatosNotificacion): MensajeCompuesto {
    const doc = this.nombreDocumento(datos.tipoDocumento);
    const cuerpo = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `No pudimos leer su ${doc.nombre} con la certeza necesaria. Esto no es un rechazo:`,
      'solo necesitamos una captura más clara.',
      '',
      ...(datos.motivo ? [datos.motivo, ''] : []),
      'Para que salga bien a la primera:',
      '· Apoye el documento sobre una superficie plana, sin dobleces.',
      '· Busque luz pareja y evite el flash directo, que produce reflejos.',
      '· Acerque la cámara hasta que el documento llene el encuadre.',
      '· Espere a que la cámara enfoque antes de tomar la foto.',
      ...this.bloqueGuias(datos.guias),
    ];
    return this.armar(
      `Su ${doc.nombre} no se pudo leer — vuelva a cargar el archivo`,
      cuerpo,
      datos,
    );
  }

  private documentoAprobado(datos: DatosNotificacion): MensajeCompuesto {
    const doc = this.nombreDocumento(datos.tipoDocumento);
    const aprobado = doc.genero === 'f' ? 'aprobada' : 'aprobado';
    return this.armar(
      `Su ${doc.nombre} fue ${aprobado}`,
      [
        `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
        '',
        `Su ${doc.nombre} quedó ${aprobado}. No tiene que hacer nada más con este soporte.`,
      ],
      datos,
    );
  }

  private obligacionPorVencer(datos: DatosNotificacion): MensajeCompuesto {
    const dias = datos.diasRestantes ?? 0;
    const plazo =
      dias < 0
        ? `venció hace ${Math.abs(dias)} día(s)`
        : dias === 0
          ? 'vence hoy'
          : `vence en ${dias} día(s)`;
    return this.armar(
      `${datos.obligacion ?? 'Una obligación'} ${plazo}`,
      [
        `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
        '',
        `La obligación "${datos.obligacion ?? 'pendiente'}" ${plazo}.`,
        ...(datos.norma ? ['', `Fundamento normativo: ${datos.norma}.`] : []),
        '',
        'Ingrese a la plataforma para ver qué falta y quién debe atenderlo.',
      ],
      datos,
    );
  }

  private practicaActivada(datos: DatosNotificacion): MensajeCompuesto {
    return this.armar(
      'Su práctica quedó activa',
      [
        `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
        '',
        'Su práctica quedó activa: la documentación inicial está completa y su afiliación',
        'al Sistema General de Riesgos Laborales está verificada.',
        ...(datos.empresa ? ['', `Empresa: ${datos.empresa}.`] : []),
      ],
      datos,
    );
  }

  private empresaHabilitada(datos: DatosNotificacion): MensajeCompuesto {
    return this.armar(
      'Su empresa quedó habilitada',
      [
        `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
        '',
        `${datos.empresa ?? 'Su empresa'} quedó habilitada para recibir practicantes de la CUN.`,
        '',
        'Desde ahora puede consultar a sus practicantes y descargar sus certificados.',
      ],
      datos,
    );
  }

  private invitacionEmpresa(datos: DatosNotificacion): MensajeCompuesto {
    return this.armar(
      'Invitación para administrar su empresa en SIPRA',
      [
        `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
        '',
        `Le invitamos a administrar el perfil de ${datos.empresa ?? 'su empresa'} en la`,
        'plataforma de prácticas de la CUN.',
        '',
        'Esta invitación es de un solo uso y vence en 72 horas.',
      ],
      datos,
    );
  }

  private certificadoEmitido(datos: DatosNotificacion): MensajeCompuesto {
    return this.armar(
      'Su certificado de práctica está disponible',
      [
        `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
        '',
        'Su certificado de práctica ya está emitido y puede descargarlo desde la plataforma.',
        'Cualquier tercero puede verificar su autenticidad con el código que aparece en él.',
      ],
      datos,
    );
  }

  /**
   * Confirmación del Formulario Único de Registro. El manual del estudiante
   * pide que este correo traiga la lista de documentos de la modalidad y las
   * reglas de vigencia, para que la ruta quede clara desde el primer día.
   */
  private registroConfirmado(datos: DatosNotificacion): MensajeCompuesto {
    const lineas: string[] = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Su registro de práctica en la modalidad ${datos.modalidad ?? 'seleccionada'} para el ` +
        `periodo ${datos.periodo ?? 'vigente'} quedó creado correctamente.`,
      ...(datos.empresa ? [`Organización: ${datos.empresa}.`] : []),
      '',
      'Documentos que debe cargar en la plataforma:',
    ];
    for (const bloque of datos.documentosPorMomento ?? []) {
      lineas.push('', `${bloque.momento}:`);
      for (const doc of bloque.documentos) lineas.push(`· ${doc}`);
    }
    lineas.push(
      '',
      'Tenga en cuenta:',
      '· Todos los documentos van en PDF y sin contraseña.',
      '· Los certificados de EPS y ARL no pueden tener más de 30 días de expedición.',
      '· Cargue primero el certificado de EPS y el de ARL: sin ellos la práctica no inicia.',
      '· La modalidad y las fechas registradas no se pueden modificar.',
    );
    return this.armar('Su registro de práctica quedó creado', lineas, datos);
  }

  private mensajeBitacora(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `${datos.autor ?? 'Su contraparte'} dejó un mensaje en la bitácora de su práctica:`,
      '',
      `«${datos.mensaje ?? ''}»`,
      '',
      'Puede responder desde la bitácora en la plataforma. No necesita responder a este correo.',
    ];
    return this.armar('Nuevo mensaje en la bitácora de su práctica', lineas, datos);
  }

  private plazoSubsanacion(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      'Su expediente tiene documentación pendiente. Dispone de un plazo máximo de ocho (8) días',
      `calendario, hasta el ${datos.fechaLimite ?? 'plazo indicado'}, para cargar en la plataforma:`,
      ...(datos.documentos ?? []).map((d) => `· ${this.nombreDocumento(d).nombre}`),
      '',
      ...(datos.mensaje ? [`Observación del docente: ${datos.mensaje}`, ''] : []),
      'Recuerde que los documentos no se reciben por correo electrónico.',
    ];
    return this.armar('Documentación pendiente: plazo de ocho días', lineas, datos);
  }

  private procesoCerrado(datos: DatosNotificacion): MensajeCompuesto {
    const nota = datos.nota === undefined ? '' : datos.nota.toFixed(1).replace('.', ',');
    const lineas = datos.aprobada === false
      ? [
          `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
          '',
          `Su proceso de práctica del periodo ${datos.periodo ?? 'vigente'} cerró con calificación ${nota},`,
          'que no alcanza la nota mínima de aprobación (3,0). El estado de su registro es «Reprueba».',
          '',
          'Comuníquese con su docente facilitador o con la coordinación de prácticas para conocer',
          'las opciones de un nuevo registro.',
        ]
      : [
          `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
          '',
          `Su proceso de práctica del periodo ${datos.periodo ?? 'vigente'} quedó cerrado con`,
          `calificación ${nota}. ¡Felicitaciones!`,
          '',
          'La nota se reflejará en SINU una vez el docente la incorpore en el curso.',
        ];
    return this.armar('Su proceso de práctica cerró', lineas, datos);
  }

  private solicitudArlRadicada(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Recibimos su solicitud de afiliación a ARL${datos.consecutivo ? ` n.º ${datos.consecutivo}` : ''} ` +
        `para la práctica en modalidad ${datos.modalidad ?? 'registrada'} del periodo ${datos.periodo ?? 'vigente'}.`,
      '',
      'El auxiliar de prácticas validará sus soportes. Si todo está correcto, recibirá el certificado',
      'de afiliación en este correo entre tres y cinco días hábiles, y quedará cargado en su expediente.',
      '',
      'Recuerde que la afiliación debe existir antes del primer día de práctica: no inicie actividades',
      'sin el certificado.',
    ];
    return this.armar('Recibimos su solicitud de ARL', lineas, datos);
  }

  private solicitudArlRechazada(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Su solicitud de afiliación a ARL${datos.consecutivo ? ` n.º ${datos.consecutivo}` : ''} no fue aprobada por:`,
      ...(datos.motivos ?? []).map((m) => `· ${m}`),
      ...(datos.motivo ? ['', `Observación: ${datos.motivo}`] : []),
      '',
      'Corrija lo indicado y radique una nueva solicitud desde la plataforma. Tenga en cuenta que',
      'debe hacerlo con al menos cinco días hábiles de anticipación al inicio de la práctica.',
    ];
    return this.armar('Su solicitud de ARL no fue aprobada', lineas, datos);
  }

  private certificadoArlDisponible(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Su solicitud de afiliación a ARL${datos.consecutivo ? ` n.º ${datos.consecutivo}` : ''} fue aprobada.`,
      'El certificado de afiliación ya quedó cargado y aprobado en su expediente de práctica; no',
      'necesita volver a subirlo.',
      '',
      ...(datos.fechaLimite ? [`Cobertura desde: ${datos.fechaLimite}.`, ''] : []),
      'Puede descargarlo desde la plataforma en cualquier momento.',
    ];
    return this.armar('Su certificado de ARL está disponible', lineas, datos);
  }

  private consolidadoArl(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Consolidado de solicitudes de ARL del ${datos.fecha ?? 'día'}:`,
      ...(datos.filas && datos.filas.length > 0 ? datos.filas.map((f) => `· ${f}`) : ['· Sin movimientos.']),
      '',
      'Las aprobadas se trasladan a Capital Social para la afiliación. El detalle y el archivo',
      'descargable están en la plataforma.',
    ];
    return this.armar(`Consolidado ARL · ${datos.fecha ?? ''}`.trim(), lineas, datos);
  }

  private pqrsRadicada(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Recibimos su solicitud con el radicado n.º ${datos.consecutivo ?? '—'}${datos.autor ? ` (${datos.autor})` : ''}.`,
      ...(datos.mensaje ? [`Asunto: ${datos.mensaje}`] : []),
      '',
      'Le responderemos por este correo y en la plataforma. Si envía otra solicitud sobre el mismo',
      'tema, el sistema la unifica con este radicado para conservar la trazabilidad.',
    ];
    return this.armar(`Radicado n.º ${datos.consecutivo ?? ''} recibido`.replace('  ', ' '), lineas, datos);
  }

  private pqrsRespondida(datos: DatosNotificacion): MensajeCompuesto {
    const lineas = [
      `Hola, ${this.primerNombre(datos.nombreDestinatario)}.`,
      '',
      `Su solicitud con el radicado n.º ${datos.consecutivo ?? '—'} tiene respuesta:`,
      '',
      `«${datos.mensaje ?? ''}»`,
      '',
      'Si necesita algo más sobre este caso, responda desde la misma solicitud en la plataforma',
      'para conservar el historial; evite abrir una nueva sobre el mismo tema.',
    ];
    return this.armar(`Respuesta al radicado n.º ${datos.consecutivo ?? ''}`.replace('  ', ' '), lineas, datos);
  }

  // ── Armado ───────────────────────────────────────────────────────────────

  private armar(
    asunto: string,
    lineas: string[],
    datos: DatosNotificacion,
  ): MensajeCompuesto {
    const cierre = [
      '',
      '—',
      'SIPRA PRÁCTICAS · Dirección de Operaciones',
      'Corporación Unificada Nacional de Educación Superior',
    ];
    const conEnlace = datos.enlace ? ['', `Ingrese aquí: ${datos.enlace}`] : [];
    const texto = [...lineas, ...conEnlace, ...cierre].join('\n');

    return { asunto, texto, html: this.aHtml(asunto, lineas, conEnlace, datos) };
  }

  /**
   * HTML sobrio y con estilos en línea, que es lo único que respetan los
   * clientes de correo. Todo valor variable se escapa: un nombre con un
   * carácter de marcado no debe poder alterar el mensaje.
   */
  private aHtml(
    asunto: string,
    lineas: string[],
    conEnlace: string[],
    datos: DatosNotificacion,
  ): string {
    const parrafos = lineas
      .join('\n')
      .split('\n\n')
      .map((bloque) => bloque.trim())
      .filter(Boolean)
      .map((bloque) => {
        // Los cortes de línea del texto plano existen para que el correo se lea
        // bien en una terminal; convertirlos en saltos duros parte las frases a
        // la mitad. Solo se conserva el salto ANTES de un punto de lista.
        const contenido = bloque
          .split('\n')
          .reduce((acumulado, linea, indice) => {
            const escapada = this.escapar(linea);
            if (indice === 0) return escapada;
            return linea.trimStart().startsWith('·')
              ? `${acumulado}<br>${escapada}`
              : `${acumulado} ${escapada}`;
          }, '');
        const esLista = bloque.includes('·');
        return esLista
          ? `<p style="margin:0 0 14px;color:#3f3f52">${contenido}</p>`
          : `<p style="margin:0 0 14px">${contenido}</p>`;
      })
      .join('');

    const boton =
      conEnlace.length > 0 && datos.enlace
        ? `<p style="margin:22px 0"><a href="${this.escapar(datos.enlace)}" ` +
          'style="background:#4338CA;color:#fff;padding:11px 20px;border-radius:6px;' +
          'text-decoration:none;font-weight:600;display:inline-block">Ir a la plataforma</a></p>'
        : '';

    return [
      '<!doctype html><html lang="es-CO"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${this.escapar(asunto)}</title></head>`,
      '<body style="margin:0;padding:24px;background:#f6f6f9;',
      'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d26">',
      '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e1e1ea;',
      'border-radius:10px;padding:28px">',
      '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;',
      'color:#4338CA;font-weight:700;margin-bottom:6px">SIPRA Prácticas</div>',
      `<h1 style="font-size:19px;margin:0 0 18px;line-height:1.3">${this.escapar(asunto)}</h1>`,
      `<div style="font-size:15px;line-height:1.6">${parrafos}</div>`,
      boton,
      '<hr style="border:0;border-top:1px solid #e1e1ea;margin:24px 0 14px">',
      '<div style="font-size:12px;color:#7d7e92">Dirección de Operaciones · ',
      'Corporación Unificada Nacional de Educación Superior<br>',
      'Este mensaje es automático; no responda a este correo.</div>',
      '</div></body></html>',
    ].join('');
  }

  private bloqueGuias(guias?: readonly string[]): string[] {
    if (!guias?.length) return [];
    return ['', 'Qué revisar:', ...guias.map((guia) => `· ${guia}`)];
  }

  private nombreDocumento(tipo?: string): NombreDocumento {
    if (!tipo) return DOCUMENTO_GENERICO;
    return NOMBRES_DOCUMENTO[tipo] ?? { nombre: tipo.replace(/_/g, ' '), genero: 'm' };
  }

  /** Tratar a alguien por su primer nombre lee mejor que por su nombre completo. */
  private primerNombre(nombreCompleto: string): string {
    return nombreCompleto?.trim().split(/\s+/)[0] || 'estudiante';
  }

  private escapar(texto: string): string {
    return texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
