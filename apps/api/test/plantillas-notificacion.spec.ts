import {
  EventoNotificable, PlantillasNotificacionDomainService,
} from '../src/domain/services/plantillas-notificacion.domain-service';

const plantillas = new PlantillasNotificacionDomainService();

const estudiante = { nombreDestinatario: 'Laura Sofía Ramírez Ortiz' };

describe('Devolución de un documento', () => {
  const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_DEVUELTO, {
    ...estudiante,
    tipoDocumento: 'certificado_arl',
    motivo: 'Falta la fecha de afiliación.',
    guias: ['Verifique que aparezca la fecha de afiliación completa.'],
  });

  it('nombra el documento en lenguaje del estudiante, no en código interno', () => {
    expect(mensaje.asunto).toContain('certificado de afiliación a ARL');
    expect(mensaje.texto).not.toContain('certificado_arl');
  });

  it('trata al estudiante por su primer nombre', () => {
    expect(mensaje.texto).toContain('Hola, Laura.');
  });

  it('explica qué corregir: es lo que evita la llamada al conmutador', () => {
    expect(mensaje.texto).toContain('Falta la fecha de afiliación.');
    expect(mensaje.texto).toContain('Qué revisar:');
    expect(mensaje.texto).toContain('· Verifique que aparezca la fecha de afiliación completa.');
  });

  it('nunca dice solo "documento rechazado"', () => {
    expect(mensaje.texto.toLowerCase()).not.toContain('rechazado');
  });
});

describe('Documento ilegible', () => {
  const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_ILEGIBLE, {
    ...estudiante,
    tipoDocumento: 'planilla_horas',
  });

  it('aclara que no es un rechazo', () => {
    // `ilegible` y `rechazado` son estados distintos, y el correo tiene que
    // dejarlo claro: no es una decisión negativa sobre el estudiante.
    expect(mensaje.texto).toContain('no es un rechazo');
  });

  it('da instrucciones concretas de captura', () => {
    expect(mensaje.texto).toContain('superficie plana');
    expect(mensaje.texto).toContain('flash directo');
    expect(mensaje.texto).toContain('enfoque');
  });
});

describe('Obligación por vencer', () => {
  it('dice cuántos días faltan', () => {
    const mensaje = plantillas.componer(EventoNotificable.OBLIGACION_POR_VENCER, {
      ...estudiante, obligacion: 'Afiliación a ARL', norma: 'Decreto 055 de 2015', diasRestantes: 3,
    });
    expect(mensaje.asunto).toContain('vence en 3 día(s)');
    expect(mensaje.texto).toContain('Decreto 055 de 2015');
  });

  it('distingue lo que vence hoy de lo que ya venció', () => {
    const hoy = plantillas.componer(EventoNotificable.OBLIGACION_POR_VENCER, {
      ...estudiante, obligacion: 'Afiliación a ARL', diasRestantes: 0,
    });
    const vencida = plantillas.componer(EventoNotificable.OBLIGACION_POR_VENCER, {
      ...estudiante, obligacion: 'Afiliación a ARL', diasRestantes: -5,
    });
    expect(hoy.asunto).toContain('vence hoy');
    expect(vencida.asunto).toContain('venció hace 5 día(s)');
  });
});

describe('Todos los eventos', () => {
  it.each(Object.values(EventoNotificable))('%s produce asunto, texto y HTML', (evento) => {
    const mensaje = plantillas.componer(evento, { ...estudiante, empresa: 'Logística Andina' });
    expect(mensaje.asunto.length).toBeGreaterThan(5);
    expect(mensaje.texto.length).toBeGreaterThan(40);
    expect(mensaje.html).toContain('<!doctype html>');
  });

  it.each(Object.values(EventoNotificable))('%s firma como la Dirección de Operaciones', (evento) => {
    expect(plantillas.componer(evento, estudiante).texto).toContain('Dirección de Operaciones');
  });
});

describe('Concordancia de género', () => {
  // Un correo institucional que dice «vuelva a cargarlo» de una planilla resta
  // credibilidad a lo que está diciendo.
  it('concuerda en femenino con una planilla', () => {
    const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_DEVUELTO, {
      ...estudiante, tipoDocumento: 'planilla_horas',
    });
    expect(mensaje.texto).toContain('aprobarla');
    expect(mensaje.texto).toContain('cárguela');
    expect(mensaje.texto).not.toContain('cargarlo');
  });

  it('concuerda en masculino con un certificado', () => {
    const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_DEVUELTO, {
      ...estudiante, tipoDocumento: 'certificado_arl',
    });
    expect(mensaje.texto).toContain('aprobarlo');
    expect(mensaje.texto).toContain('cárguelo');
  });

  it('concuerda también al aprobar', () => {
    const femenino = plantillas.componer(EventoNotificable.DOCUMENTO_APROBADO, {
      ...estudiante, tipoDocumento: 'carta_aceptacion',
    });
    const masculino = plantillas.componer(EventoNotificable.DOCUMENTO_APROBADO, {
      ...estudiante, tipoDocumento: 'convenio_practica',
    });
    expect(femenino.asunto).toContain('fue aprobada');
    expect(masculino.asunto).toContain('fue aprobado');
  });

  it('evita el pronombre en el asunto de un documento ilegible', () => {
    const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_ILEGIBLE, {
      ...estudiante, tipoDocumento: 'planilla_horas',
    });
    expect(mensaje.asunto).toContain('vuelva a cargar el archivo');
  });
});

describe('Seguridad del HTML', () => {
  it('escapa el marcado que venga en un nombre', () => {
    // Un nombre con caracteres de marcado no puede alterar el mensaje.
    const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_APROBADO, {
      nombreDestinatario: '<script>alert(1)</script> Pérez',
      tipoDocumento: 'planilla_horas',
    });
    expect(mensaje.html).not.toContain('<script>');
    expect(mensaje.html).toContain('&lt;script&gt;');
  });

  it('escapa el enlace antes de ponerlo en el botón', () => {
    const mensaje = plantillas.componer(EventoNotificable.INVITACION_EMPRESA, {
      ...estudiante, enlace: 'https://sipra.cun.edu.co/x?a=1&b="2"',
    });
    expect(mensaje.html).toContain('&amp;b=&quot;2&quot;');
  });

  it('usa un saludo neutro cuando no hay nombre', () => {
    const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_APROBADO, {
      nombreDestinatario: '',
    });
    expect(mensaje.texto).toContain('Hola, estudiante.');
  });
});

describe('Cortes de línea en el HTML', () => {
  const mensaje = plantillas.componer(EventoNotificable.DOCUMENTO_ILEGIBLE, {
    ...estudiante,
    tipoDocumento: 'planilla_horas',
    guias: ['La imagen está fuera de foco.'],
  });

  it('no parte una frase a la mitad', () => {
    // Los cortes del texto plano existen para la terminal; en HTML el párrafo
    // debe fluir y ajustarse al ancho del cliente de correo.
    expect(mensaje.html).toContain('Esto no es un rechazo: solo necesitamos');
    expect(mensaje.html).not.toContain('rechazo:<br>solo');
  });

  it('conserva el salto antes de cada punto de lista', () => {
    expect(mensaje.html).toContain('<br>· Apoye el documento');
    expect(mensaje.html).toContain('<br>· La imagen está fuera de foco.');
  });
});
