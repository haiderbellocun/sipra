import { EstadoAdres, RecomendacionEps, adresInicial } from '../src/domain/entities/adres';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosValidacionEps, ValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { compararTriple } from '../src/domain/services/adres-resultado.domain-service';
import {
  ESTADOS_ADRES_ABIERTOS, JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA, MENSAJES_DEVOLUCION_EPS, MotivoDevolucionEps, PESOS_PRIORIDAD,
  calcularPrioridad, camposClaveFaltantes, condicionesRecomendacion, construirDiscrepancias, evaluarApartamiento, evaluarFrescuraAdres,
  explicacionVencido, mensajeDevolucion, recomendacionActual, tieneDiscrepanciaCriticaPersistida, veredictoCertificadoVsSipra,
} from '../src/domain/services/mesa-eps.domain-service';

/** Prioridad, discrepancias legibles, recomendación, justificación reforzada, motivos y frescura de la Mesa de EPS. Dominio puro. */

const AHORA = new Date('2026-10-26T15:00:00Z');
const DIA = 86_400_000;
const hace = (dias: number): Date => new Date(AHORA.getTime() - dias * DIA);
const en = (dias: number): Date => new Date(AHORA.getTime() + dias * DIA);
const base = { recibidaEn: AHORA, fechaInicioPractica: null, version: 1, discrepanciaCritica: false, adresPendiente: false };

describe('Prioridad operativa: reglas transparentes', () => {
  it('un caso recién llegado y sin otra señal no tiene puntos ni razones', () => {
    expect(calcularPrioridad(base, AHORA)).toEqual({ puntaje: 0, razones: [] });
  });

  it('antigüedad: un punto por día completo, con tope', () => {
    expect(calcularPrioridad({ ...base, recibidaEn: hace(1) }, AHORA).puntaje).toBe(1);
    expect(calcularPrioridad({ ...base, recibidaEn: hace(12.9) }, AHORA).puntaje).toBe(12);
    expect(calcularPrioridad({ ...base, recibidaEn: hace(400) }, AHORA).puntaje).toBe(PESOS_PRIORIDAD.antiguedadMaxDias);
    expect(calcularPrioridad({ ...base, recibidaEn: en(2) }, AHORA).puntaje).toBe(0); // fecha futura: no resta
  });

  it('inicio de la práctica: suma si empieza dentro de 15 días o ya empezó; no si falta más', () => {
    expect(calcularPrioridad({ ...base, fechaInicioPractica: en(15) }, AHORA).puntaje).toBe(PESOS_PRIORIDAD.inicioPractica);
    expect(calcularPrioridad({ ...base, fechaInicioPractica: hace(30) }, AHORA).puntaje).toBe(PESOS_PRIORIDAD.inicioPractica);
    expect(calcularPrioridad({ ...base, fechaInicioPractica: en(16) }, AHORA).puntaje).toBe(0);
    expect(calcularPrioridad({ ...base, fechaInicioPractica: null }, AHORA).puntaje).toBe(0);
  });

  it('reenvío, discrepancia crítica y ADRES pendiente suman cada uno lo suyo', () => {
    expect(calcularPrioridad({ ...base, version: 2 }, AHORA).puntaje).toBe(PESOS_PRIORIDAD.reenvio);
    expect(calcularPrioridad({ ...base, discrepanciaCritica: true }, AHORA).puntaje).toBe(PESOS_PRIORIDAD.discrepanciaCritica);
    expect(calcularPrioridad({ ...base, adresPendiente: true }, AHORA).puntaje).toBe(PESOS_PRIORIDAD.adresPendiente);
  });

  it('se puede explicar: cada regla que sumó deja su razón con los puntos', () => {
    const p = calcularPrioridad({ recibidaEn: hace(10), fechaInicioPractica: en(3), version: 3, discrepanciaCritica: true, adresPendiente: true }, AHORA);
    expect(p.puntaje).toBe(10 + 20 + 10 + 10 + 5);
    expect(p.razones).toEqual([
      'Antigüedad: 10 días (+10)', 'La práctica inicia pronto o ya inició (+20)', 'El estudiante volvió a cargar el certificado (+10)',
      'Tiene una discrepancia crítica (+10)', 'Falta contrastar la afiliación con ADRES (+5)',
    ]);
    expect(p.razones.length).toBe(5);
  });

  it('el orden resultante es el esperado: más antiguo y con práctica próxima va primero', () => {
    const casos = [
      { id: 'a', e: { ...base, recibidaEn: hace(2) } },
      { id: 'b', e: { ...base, recibidaEn: hace(2), fechaInicioPractica: en(5) } },
      { id: 'c', e: { ...base, recibidaEn: hace(20) } },
      { id: 'd', e: { ...base, recibidaEn: hace(1), version: 2, adresPendiente: true } },
    ];
    const orden = casos.sort((x, y) => calcularPrioridad(y.e, AHORA).puntaje - calcularPrioridad(x.e, AHORA).puntaje).map((c) => c.id);
    expect(orden).toEqual(['b', 'c', 'd', 'a']);
  });

  it('los estados ADRES «abiertos» son los que todavía tienen trabajo', () => {
    expect([...ESTADOS_ADRES_ABIERTOS].sort()).toEqual([
      EstadoAdres.ERROR, EstadoAdres.EN_CONSULTA, EstadoAdres.EVIDENCIA_RECIBIDA, EstadoAdres.NO_DETERMINABLE, EstadoAdres.PENDIENTE,
    ].sort());
  });
});

// ── Discrepancias y recomendación ───────────────────────────────────────────

function validacion(cambio: Partial<DatosValidacionEps> = {}): DatosValidacionEps {
  const v = ValidacionEps.pendiente({ id: 'v', documentoId: 'd', practicaId: 'p', estudianteId: 'e', ahora: AHORA }).instantanea();
  return { ...v, estadoProcesamiento: 'procesado' as never, coincidencia: CoincidenciaEps.COINCIDE, vigenciaCertificado: 'vigente', adres: adresInicial(), ...cambio };
}
const SIPRA = { tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'Laura Sofía Ramírez Ortiz' };
const CERT = {
  tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS Sintetica', epsClave: 'SINTETICA',
  regimen: 'contributivo', tipoAfiliado: null, estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
};
const ADRES = {
  tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS SINTETICA', regimen: 'CONTRIBUTIVO',
  estadoAfiliacion: 'ACTIVO', fechaAfiliacion: null, fechaFinalizacion: null, fechaConsulta: null, fuenteActualizadaEn: null,
};

describe('Discrepancias en lenguaje claro', () => {
  it('sin diferencias no hay discrepancias', () => {
    const d = validacion({ datosExtraidos: CERT });
    expect(construirDiscrepancias(d, compararTriple(ADRES, SIPRA, CERT))).toEqual([]);
  });

  it('separa CRÍTICAS e informativas, y cada una explica qué fuentes chocan', () => {
    const d = validacion({ datosExtraidos: CERT });
    const lista = construirDiscrepancias(d, compararTriple({ ...ADRES, numeroDocumento: '999888777', regimen: 'SUBSIDIADO' }, SIPRA, CERT));
    const critica = lista.find((x) => x.campo === 'numero_documento');
    expect(critica).toMatchObject({ severidad: 'critica', titulo: 'Diferencia en el número de documento' });
    expect(critica?.explicacion).toBe("SIPRA y ADRES no coinciden en el número de documento.");
    expect(lista.find((x) => x.campo === 'regimen')?.severidad).toBe('informativa');
  });

  it('EPS distinta entre certificado y ADRES: crítica', () => {
    const lista = construirDiscrepancias(validacion({ datosExtraidos: CERT }), compararTriple({ ...ADRES, eps: 'OTRA ENTIDAD' }, SIPRA, CERT));
    expect(lista.find((x) => x.campo === 'eps')).toMatchObject({ severidad: 'critica' });
  });

  it('afiliación inactiva, certificado inválido y bandera crítica: críticas con texto legible', () => {
    const lista = construirDiscrepancias(
      validacion({ datosExtraidos: CERT, afiliacion: AfiliacionEps.INACTIVA, afiliacionFuente: 'adres_bdua', autenticidad: AutenticidadEps.INVALIDA, hayBanderaCritica: true }),
      compararTriple(ADRES, SIPRA, CERT),
    );
    expect(lista.map((x) => x.titulo)).toEqual(expect.arrayContaining(['Afiliación no vigente', 'Certificado no auténtico', 'Alerta crítica del documento']));
    expect(lista.find((x) => x.titulo === 'Afiliación no vigente')?.explicacion).toBe('ADRES indica que la afiliación del estudiante no está vigente.');
    expect(lista.filter((x) => x.severidad === 'critica').length).toBe(3);
  });

  it('certificado vencido y lecturas distintas (texto vs OCR): informativas', () => {
    const lista = construirDiscrepancias(
      validacion({ datosExtraidos: CERT, vigenciaCertificado: 'vencido', discrepancias: [{ campo: 'nombre', esperado: null, observado: null, resultado: 'fuentes_distintas' }] }),
      compararTriple(ADRES, SIPRA, CERT),
    );
    expect(lista.map((x) => [x.titulo, x.severidad])).toEqual(expect.arrayContaining([
      ['Certificado vencido', 'informativa'], ['Lecturas distintas del mismo documento', 'informativa'],
    ]));
  });

  it('ningún texto es un código técnico suelto', () => {
    const lista = construirDiscrepancias(validacion({ datosExtraidos: CERT, afiliacion: AfiliacionEps.INACTIVA }), compararTriple({ ...ADRES, nombre: 'OTRO NOMBRE' }, SIPRA, CERT));
    for (const x of lista) expect(`${x.titulo} ${x.explicacion}`).not.toMatch(/_vs_|sipra_|oficial_|\b[a-z]+_[a-z]+\b/);
  });
});

describe('Recomendación vigente del sistema', () => {
  it('afiliación sin contrastar con ADRES por hacer: «pendiente de ADRES»', () => {
    const d = validacion({ datosExtraidos: CERT, adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE } });
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.PENDIENTE_ADRES);
  });

  it('una discrepancia crítica manda aunque falte ADRES', () => {
    const d = validacion({ adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE } });
    expect(recomendacionActual(d, true)).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
  });

  it('con todo en regla es candidato; sin autenticidad verificada, revisión documental', () => {
    const d = validacion({ datosExtraidos: CERT, afiliacion: AfiliacionEps.ACTIVA, afiliacionFuente: 'adres_bdua', autenticidad: AutenticidadEps.VERIFICADA });
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.CANDIDATO_AUTOAPROBACION);
    expect(recomendacionActual({ ...d, autenticidad: AutenticidadEps.NO_VERIFICABLE }, false)).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
  });

  it('afiliación inactiva: revisión / posible rechazo', () => {
    expect(recomendacionActual(validacion({ datosExtraidos: CERT, afiliacion: AfiliacionEps.INACTIVA, afiliacionFuente: 'adres_bdua' }), false)).toBe(RecomendacionEps.REVISION_RECHAZO);
  });

  it('es una recomendación, no una decisión: nunca produce un valor de decisión', () => {
    const valores = Object.values(RecomendacionEps) as string[];
    expect(valores).not.toContain('aprobado_automatico');
    expect(valores).not.toContain('aprobado');
  });

  it('la discrepancia crítica PERSISTIDA (la que usa la prioridad) mira solo lo guardado', () => {
    expect(tieneDiscrepanciaCriticaPersistida(validacion())).toBe(false);
    expect(tieneDiscrepanciaCriticaPersistida(validacion({ coincidencia: CoincidenciaEps.DISCREPANCIA }))).toBe(true);
    expect(tieneDiscrepanciaCriticaPersistida(validacion({ autenticidad: AutenticidadEps.INVALIDA }))).toBe(true);
    expect(tieneDiscrepanciaCriticaPersistida(validacion({ afiliacion: AfiliacionEps.INACTIVA }))).toBe(true);
    expect(tieneDiscrepanciaCriticaPersistida(validacion({ hayBanderaCritica: true }))).toBe(true);
    const conTriple = validacion({ adres: { ...adresInicial(), comparacion: [{ campo: 'eps', sipra: null, certificado: 'A', adres: 'B', resultado: 'diferente', conflictos: ['certificado_vs_adres'], critico: true }] } });
    expect(tieneDiscrepanciaCriticaPersistida(conTriple)).toBe(true);
  });
});

describe('Justificación reforzada al apartarse de la recomendación', () => {
  it.each([RecomendacionEps.DISCREPANCIA_CRITICA, RecomendacionEps.REVISION_RECHAZO])('aprobar contra «%s»: aparta y exige 40 caracteres', (r) => {
    expect(evaluarApartamiento('aprobar', r)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA });
  });

  it('rechazar un candidato que cumple todo: aparta', () => {
    expect(evaluarApartamiento('rechazar', RecomendacionEps.CANDIDATO_AUTOAPROBACION)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA });
  });

  it.each([
    ['aprobar', RecomendacionEps.CANDIDATO_AUTOAPROBACION], ['aprobar', RecomendacionEps.REVISION_DOCUMENTAL], ['aprobar', RecomendacionEps.PENDIENTE_ADRES],
    ['devolver', RecomendacionEps.DISCREPANCIA_CRITICA], ['devolver', RecomendacionEps.CANDIDATO_AUTOAPROBACION],
    ['rechazar', RecomendacionEps.REVISION_RECHAZO], ['rechazar', RecomendacionEps.DISCREPANCIA_CRITICA],
  ] as const)('%s con «%s»: no aparta', (decision, r) => {
    expect(evaluarApartamiento(decision, r)).toMatchObject({ apartaDeRecomendacion: false, minimoJustificacion: JUSTIFICACION_MINIMA, motivo: null });
  });
});

describe('Motivos de devolución', () => {
  it('cada motivo tiene un mensaje comprensible para el estudiante (dice qué hacer)', () => {
    for (const motivo of Object.values(MotivoDevolucionEps)) {
      const m = MENSAJES_DEVOLUCION_EPS[motivo];
      expect(m.length).toBeGreaterThan(30);
      expect(m).toMatch(/certificado/i);
      expect(m).not.toMatch(/_|error|exception/i);
    }
  });

  it('el detalle del funcionario se agrega al mensaje del catálogo', () => {
    expect(mensajeDevolucion(MotivoDevolucionEps.VENCIDO, null)).toBe(MENSAJES_DEVOLUCION_EPS[MotivoDevolucionEps.VENCIDO]);
    expect(mensajeDevolucion(MotivoDevolucionEps.OTRO, ' Falta la firma. ')).toBe(`${MENSAJES_DEVOLUCION_EPS[MotivoDevolucionEps.OTRO]} Falta la firma.`);
  });

  it('el catálogo cubre los motivos operativos esperados', () => {
    expect(Object.values(MotivoDevolucionEps).sort()).toEqual(
      ['certificado_incorrecto', 'certificado_vencido', 'datos_no_coinciden', 'documento_ilegible', 'falta_informacion', 'otro'],
    );
  });
});

describe('Frescura de la consulta ADRES (sin política definida)', () => {
  it('sin plazo configurado NADA se marca vencido', () => {
    for (const dias of [null, undefined, 0, -3, Number.NaN]) {
      // Sin política: se informa cuántos días pasaron, pero NUNCA se declara vencida una consulta.
      expect(evaluarFrescuraAdres(hace(400), dias as number | null, AHORA)).toEqual({ politicaDefinida: false, dias: null, vencida: null, diasDesdeConsulta: 400 });
    }
    expect(evaluarFrescuraAdres(null, null, AHORA)).toEqual({ politicaDefinida: false, dias: null, vencida: null, diasDesdeConsulta: null });
  });

  it('con un plazo configurado (futuro), vence pasado el plazo; sin fecha de consulta no se concluye', () => {
    expect(evaluarFrescuraAdres(hace(10), 30, AHORA)).toEqual({ politicaDefinida: true, dias: 30, vencida: false, diasDesdeConsulta: 10 });
    expect(evaluarFrescuraAdres(hace(31), 30, AHORA)).toEqual({ politicaDefinida: true, dias: 30, vencida: true, diasDesdeConsulta: 31 });
    expect(evaluarFrescuraAdres(null, 30, AHORA)).toEqual({ politicaDefinida: true, dias: 30, vencida: null, diasDesdeConsulta: null });
  });

  it('una consulta con fecha futura (reloj desfasado) no da días negativos', () => {
    expect(evaluarFrescuraAdres(new Date(AHORA.getTime() + 86_400_000), null, AHORA).diasDesdeConsulta).toBe(0);
  });
});

// ── Certificado con datos faltantes, de otra persona y vencido (prueba manual con un certificado antiguo) ──────────

const OTRA_PERSONA = { ...CERT, tipoDocumento: 'RC', numeroDocumento: '1099887766', nombre: 'SAMUEL ANDRES FICTICIO PRUEBA', fechaExpedicion: '2014-01-13' };
const CTX = { ahora: AHORA, diasVigencia: 30 };

describe('Datos faltantes: información insuficiente, nunca «coincide»', () => {
  it('procesado sin ningún dato leído: tres faltantes explícitos y recomendación de información insuficiente', () => {
    const d = validacion({ datosExtraidos: null, coincidencia: CoincidenciaEps.INSUFICIENTE, adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE } });
    expect(camposClaveFaltantes(d)).toEqual(['numero_documento', 'nombre', 'fecha_expedicion']);
    const lista = construirDiscrepancias(d, compararTriple(ADRES, SIPRA, null), CTX);
    expect(lista.map((x) => x.severidad)).toEqual(['insuficiente', 'insuficiente', 'insuficiente']);
    expect(lista.map((x) => x.campo)).toEqual(['numero_documento', 'nombre', 'fecha_expedicion']);
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.INFORMACION_INSUFICIENTE); // y ADRES pendiente NO lo oculta
  });

  it('solo falta el documento: se señala ese campo y no se declara coincidencia', () => {
    const d = validacion({ datosExtraidos: { ...CERT, numeroDocumento: null, tipoDocumento: null }, coincidencia: CoincidenciaEps.INSUFICIENTE });
    expect(camposClaveFaltantes(d)).toEqual(['numero_documento']);
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.INFORMACION_INSUFICIENTE);
  });

  it('antes de procesar no se afirma que falte algo (todavía no se sabe qué se leyó)', () => {
    const d = validacion({ datosExtraidos: null, estadoProcesamiento: 'pendiente' as never });
    expect(camposClaveFaltantes(d)).toEqual([]);
    expect(construirDiscrepancias(d, compararTriple(ADRES, SIPRA, null), CTX)).toEqual([]);
  });

  it('el veredicto «certificado vs SIPRA»: ausente = insuficiente; igual = coincide; distinto = diferente', () => {
    const fila = (campo: 'numero_documento' | 'nombre' | 'eps', cert: typeof CERT | null) => compararTriple(ADRES, SIPRA, cert).find((f) => f.campo === campo)!;
    expect(veredictoCertificadoVsSipra(fila('numero_documento', null))).toBe('insuficiente');
    expect(veredictoCertificadoVsSipra(fila('numero_documento', CERT))).toBe('coincide');
    expect(veredictoCertificadoVsSipra(fila('numero_documento', OTRA_PERSONA))).toBe('diferente');
    expect(veredictoCertificadoVsSipra(fila('nombre', OTRA_PERSONA))).toBe('diferente');
    expect(veredictoCertificadoVsSipra(fila('eps', CERT))).toBeNull(); // SIPRA no conoce la EPS del estudiante
  });
});

describe('Certificado de otra persona y vencido', () => {
  const d = validacion({ datosExtraidos: OTRA_PERSONA, coincidencia: CoincidenciaEps.DISCREPANCIA, vigenciaCertificado: 'vencido', adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE } });
  const triple = compararTriple(ADRES, SIPRA, OTRA_PERSONA);

  it('documento y nombre distintos son discrepancias CRÍTICAS', () => {
    const criticas = construirDiscrepancias(d, triple, CTX).filter((x) => x.severidad === 'critica');
    expect(criticas.map((x) => x.campo)).toEqual(expect.arrayContaining(['numero_documento', 'nombre']));
  });

  it('el vencimiento muestra fecha de expedición, antigüedad y la regla institucional, sin volverse crítico', () => {
    const v = construirDiscrepancias(d, triple, CTX).find((x) => x.titulo === 'Certificado vencido')!;
    expect(v.severidad).toBe('informativa');
    expect(v.explicacion).toContain('13/01/2014');
    expect(v.explicacion).toContain('hace 4669 días');
    expect(v.explicacion).toContain('no más de 30 días');
    expect(v.explicacion).toContain('no se rechaza automáticamente');
  });

  it('sin contexto, el texto del vencimiento sigue siendo claro (no inventa cifras)', () => {
    expect(explicacionVencido('2014-01-13')).toBe('La fecha de expedición del certificado supera la vigencia institucional.');
    expect(explicacionVencido('2014-01-13', { ahora: AHORA, diasVigencia: null })).not.toContain('regla institucional exige');
  });

  it('la recomendación respeta el orden y muestra AMBAS condiciones; ADRES no oculta nada', () => {
    expect(recomendacionActual(d, true)).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
    expect(condicionesRecomendacion(d, true)).toEqual([RecomendacionEps.DISCREPANCIA_CRITICA, RecomendacionEps.CERTIFICADO_VENCIDO]);
  });
});

describe('Orden de la recomendación', () => {
  const ok = validacion({ datosExtraidos: CERT, adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE } });

  it('1) documento incorrecto > 2) discrepancia crítica > 3) vencido > 4) insuficiente > 5) autenticidad > 6) ADRES', () => {
    const todo = validacion({
      datosExtraidos: null, coincidencia: CoincidenciaEps.INSUFICIENTE, vigenciaCertificado: 'vencido',
      autenticidad: AutenticidadEps.INVALIDA, adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE },
    });
    expect(condicionesRecomendacion(todo, true, { tipoIncorrecto: true })).toEqual([
      RecomendacionEps.DOCUMENTO_INCORRECTO, RecomendacionEps.DISCREPANCIA_CRITICA, RecomendacionEps.CERTIFICADO_VENCIDO,
      RecomendacionEps.INFORMACION_INSUFICIENTE, RecomendacionEps.REVISION_RECHAZO,
    ]);
    expect(recomendacionActual(todo, true, { tipoIncorrecto: true })).toBe(RecomendacionEps.DOCUMENTO_INCORRECTO);
    expect(recomendacionActual(todo, true)).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
    expect(recomendacionActual(todo, false)).toBe(RecomendacionEps.CERTIFICADO_VENCIDO);
    expect(recomendacionActual({ ...todo, vigenciaCertificado: 'vigente' }, false)).toBe(RecomendacionEps.INFORMACION_INSUFICIENTE);
    expect(recomendacionActual({ ...todo, vigenciaCertificado: 'vigente', datosExtraidos: CERT, coincidencia: CoincidenciaEps.COINCIDE }, false)).toBe(RecomendacionEps.REVISION_RECHAZO);
  });

  it('un certificado vencido manda sobre «falta ADRES»; vigente y completo sí queda en ADRES', () => {
    expect(recomendacionActual({ ...ok, vigenciaCertificado: 'vencido' }, false)).toBe(RecomendacionEps.CERTIFICADO_VENCIDO);
    expect(recomendacionActual(ok, false)).toBe(RecomendacionEps.PENDIENTE_ADRES);
  });

  it('aprobar contra «documento incorrecto» exige justificación reforzada; el vencido no rechaza solo', () => {
    expect(evaluarApartamiento('aprobar', RecomendacionEps.DOCUMENTO_INCORRECTO)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA });
    expect(evaluarApartamiento('aprobar', RecomendacionEps.CERTIFICADO_VENCIDO).apartaDeRecomendacion).toBe(false);
  });
});
