import { EstadoAdres, RecomendacionEps, adresInicial } from '../src/domain/entities/adres';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosValidacionEps, ValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { compararTriple } from '../src/domain/services/adres-resultado.domain-service';
import {
  ESTADOS_ADRES_ABIERTOS, JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA, MENSAJES_DEVOLUCION_EPS, MotivoDevolucionEps, PESOS_PRIORIDAD,
  calcularPrioridad, construirDiscrepancias, evaluarApartamiento, evaluarFrescuraAdres, mensajeDevolucion, recomendacionActual,
  tieneDiscrepanciaCriticaPersistida,
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
    const d = validacion({ adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE } });
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.PENDIENTE_ADRES);
  });

  it('una discrepancia crítica manda aunque falte ADRES', () => {
    const d = validacion({ adres: { ...adresInicial(), estado: EstadoAdres.PENDIENTE } });
    expect(recomendacionActual(d, true)).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
  });

  it('con todo en regla es candidato; sin autenticidad verificada, revisión documental', () => {
    const d = validacion({ afiliacion: AfiliacionEps.ACTIVA, afiliacionFuente: 'adres_bdua', autenticidad: AutenticidadEps.VERIFICADA });
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.CANDIDATO_AUTOAPROBACION);
    expect(recomendacionActual({ ...d, autenticidad: AutenticidadEps.NO_VERIFICABLE }, false)).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
  });

  it('afiliación inactiva: revisión / posible rechazo', () => {
    expect(recomendacionActual(validacion({ afiliacion: AfiliacionEps.INACTIVA, afiliacionFuente: 'adres_bdua' }), false)).toBe(RecomendacionEps.REVISION_RECHAZO);
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
      expect(evaluarFrescuraAdres(hace(400), dias as number | null, AHORA)).toEqual({ politicaDefinida: false, dias: null, vencida: null });
    }
  });

  it('con un plazo configurado (futuro), vence pasado el plazo; sin fecha de consulta no se concluye', () => {
    expect(evaluarFrescuraAdres(hace(10), 30, AHORA)).toEqual({ politicaDefinida: true, dias: 30, vencida: false });
    expect(evaluarFrescuraAdres(hace(31), 30, AHORA)).toEqual({ politicaDefinida: true, dias: 30, vencida: true });
    expect(evaluarFrescuraAdres(null, 30, AHORA)).toEqual({ politicaDefinida: true, dias: 30, vencida: null });
  });
});
