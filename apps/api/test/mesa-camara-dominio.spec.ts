import { QueryRunner } from 'typeorm';
import { ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona } from '../src/domain/entities/documento-empresarial';
import { EstadoDocumento } from '../src/domain/entities/documento.entity';
import { ConflictoDecisionRutError } from '../src/domain/services/decision-rut.domain-service';
import {
  MENSAJES_DEVOLUCION_CAMARA, MotivoDevolucionCamara, RecomendacionCamara, calcularPrioridadCamara, catalogoMotivosDevolucionCamara,
  esMotivoDevolucionCamara, estadoCamaraParaEstudiante, evaluarApartamientoCamara, mensajeDevolucionCamara, motivoCamaraAplicaA, recomendacionCamara,
  resumenHumanoCamara,
} from '../src/domain/services/mesa-camara.domain-service';
import { esSupervisorRevisionCamara, puedeOperarRevisionCamara, puedeVerEstadoCamaraPropio } from '../src/domain/value-objects/acceso-camara.vo';
import { puedeOperarRevisionRut } from '../src/domain/value-objects/acceso-rut.vo';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { MotivosDecisionCamara1756000021000 } from '../src/infrastructure/persistence/postgres/migrations/1756000021000-MotivosDecisionCamara';

const AHORA = new Date('2026-11-06T15:00:00.000Z');
const OK = { tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION, expectativa: 'coincide', lecturaDudosa: false, comparacion: { veredicto: 'consistente', hayDiscrepancia: false, discrepanciaImportante: false, senales: [] as string[] } };

describe('Cámara · recomendación del sistema (una recomendación, no una decisión)', () => {
  it.each([
    [{}, RecomendacionCamara.CONSISTENTE],
    [{ comparacion: { ...OK.comparacion, veredicto: 'discrepancia', hayDiscrepancia: true } }, RecomendacionCamara.DISCREPANCIA_CRITICA],
    [{ comparacion: { ...OK.comparacion, veredicto: 'revision_necesaria', discrepanciaImportante: true } }, RecomendacionCamara.REPRESENTANTE_DIFERENTE],
    [{ comparacion: { ...OK.comparacion, veredicto: 'discrepancia', hayDiscrepancia: true, senales: ['estado_registral_cancelado'] } }, RecomendacionCamara.MATRICULA_CANCELADA],
    [{ lecturaDudosa: true, comparacion: { ...OK.comparacion, veredicto: 'revision_necesaria' } }, RecomendacionCamara.LECTURA_DUDOSA],
    [{ comparacion: { ...OK.comparacion, veredicto: 'revision_necesaria' } }, RecomendacionCamara.INFORMACION_INSUFICIENTE],
    [{ expectativa: 'persona_distinta', comparacion: { ...OK.comparacion, veredicto: 'no_aplica' } }, RecomendacionCamara.PERSONA_DISTINTA],
    [{ tipoDetectado: C.DOCUMENTO_INCORRECTO, comparacion: null }, RecomendacionCamara.DOCUMENTO_INCORRECTO],
    [{ tipoDetectado: C.RUT_PERSONA_JURIDICA, comparacion: null }, RecomendacionCamara.TIPO_CERTIFICADO_DIFERENTE],
    [{ tipoDetectado: C.NO_DETERMINABLE, comparacion: null }, RecomendacionCamara.NO_DETERMINABLE],
    [{ tipoDetectado: null, comparacion: null }, RecomendacionCamara.NO_DETERMINABLE],
  ])('%j → %s', (sobre, esperada) => {
    expect(recomendacionCamara({ ...OK, ...sobre })).toBe(esperada);
  });

  it('una discrepancia crítica pesa más que una lectura dudosa, y la lectura dudosa más que un representante distinto', () => {
    expect(recomendacionCamara({ ...OK, lecturaDudosa: true, comparacion: { ...OK.comparacion, veredicto: 'discrepancia', hayDiscrepancia: true } })).toBe(RecomendacionCamara.DISCREPANCIA_CRITICA);
    expect(recomendacionCamara({ ...OK, lecturaDudosa: true, comparacion: { ...OK.comparacion, discrepanciaImportante: true } })).toBe(RecomendacionCamara.LECTURA_DUDOSA);
  });

  it('un comparación anterior al ajuste (sin los campos nuevos) se lee sin fallar', () => {
    expect(recomendacionCamara({ ...OK, comparacion: { veredicto: 'consistente', hayDiscrepancia: false } })).toBe(RecomendacionCamara.CONSISTENTE);
  });

  it('el resumen humano usa las etiquetas pedidas y nunca códigos internos', () => {
    const etiquetas = Object.values(RecomendacionCamara).map((r) => resumenHumanoCamara(r).etiqueta);
    expect([...new Set(etiquetas)].sort()).toEqual([
      'Consistente', 'Documento no corresponde', 'Información insuficiente', 'No determinable', 'Persona distinta', 'Revisión necesaria', 'Tipo de certificado diferente',
    ]);
    for (const r of Object.values(RecomendacionCamara)) {
      const h = resumenHumanoCamara(r);
      expect(`${h.etiqueta} ${h.problemaPrincipal ?? ''}`).not.toMatch(/_|CAMARA_|camara_|discrepancia_critica/);
    }
    expect(resumenHumanoCamara(RecomendacionCamara.CONSISTENTE)).toMatchObject({ nivel: 'ok', problemaPrincipal: null });
    expect(resumenHumanoCamara(RecomendacionCamara.MATRICULA_CANCELADA).nivel).toBe('alerta');
  });
});

describe('Cámara · justificación según la decisión', () => {
  it('aprobar un consistente: la mínima; aprobar cualquier otra cosa: 40', () => {
    expect(evaluarApartamientoCamara('aprobar', RecomendacionCamara.CONSISTENTE)).toMatchObject({ apartaDeRecomendacion: false, minimoJustificacion: 10 });
    for (const r of Object.values(RecomendacionCamara).filter((x) => x !== RecomendacionCamara.CONSISTENTE)) {
      expect(evaluarApartamientoCamara('aprobar', r)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: 40 });
    }
  });

  it('rechazar un consistente exige justificación ampliada; devolver nunca se aparta', () => {
    expect(evaluarApartamientoCamara('rechazar', RecomendacionCamara.CONSISTENTE)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: 40 });
    expect(evaluarApartamientoCamara('rechazar', RecomendacionCamara.DISCREPANCIA_CRITICA)).toMatchObject({ apartaDeRecomendacion: false, minimoJustificacion: 10 });
    for (const r of Object.values(RecomendacionCamara)) expect(evaluarApartamientoCamara('devolver', r).apartaDeRecomendacion).toBe(false);
  });
});

describe('Cámara · catálogo canónico de motivos de devolución', () => {
  it('trae los doce motivos pedidos, cada uno con título, mensaje al estudiante y si exige detalle', () => {
    const catalogo = catalogoMotivosDevolucionCamara();
    expect(catalogo).toHaveLength(12);
    expect(new Set(catalogo.map((c) => c.codigo))).toEqual(new Set(Object.values(MotivoDevolucionCamara)));
    for (const c of catalogo) {
      expect(c).toEqual(expect.objectContaining({ codigo: expect.any(String), titulo: expect.any(String), requiereDetalle: String(c.codigo) === 'otro' }));
      expect(c.mensajeEstudiante).toEqual({ que: expect.stringMatching(/\S/), hacer: expect.stringMatching(/\S/) });
      // Lo que lee el estudiante no lleva códigos internos.
      expect(`${c.mensajeEstudiante.que} ${c.mensajeEstudiante.hacer}`).not.toMatch(/_[a-z]|C[0-3]_|hash|confianza|OCR/);
    }
  });

  it('el motivo se valida por persona y se redacta con el detalle cuando es «otro»', () => {
    expect(esMotivoDevolucionCamara('representante_no_coincide')).toBe(true);
    expect(esMotivoDevolucionCamara('rut_no_corresponde')).toBe(false);
    expect(motivoCamaraAplicaA(MotivoDevolucionCamara.RAZON_SOCIAL_NO_COINCIDE, TipoPersona.NATURAL)).toBe(false);
    expect(motivoCamaraAplicaA(MotivoDevolucionCamara.NOMBRE_NO_COINCIDE, TipoPersona.JURIDICA)).toBe(false);
    expect(motivoCamaraAplicaA(MotivoDevolucionCamara.NIT_NO_COINCIDE, TipoPersona.NATURAL)).toBe(true);
    expect(motivoCamaraAplicaA(MotivoDevolucionCamara.NOMBRE_NO_COINCIDE, null)).toBe(true);
    expect(mensajeDevolucionCamara(MotivoDevolucionCamara.OTRO, 'Falta una página.')).toBe('Falta una página.');
    expect(mensajeDevolucionCamara(MotivoDevolucionCamara.ILEGIBLE, null)).toBe(MENSAJES_DEVOLUCION_CAMARA[MotivoDevolucionCamara.ILEGIBLE].que);
  });
});

describe('Cámara · prioridad y estado para el estudiante', () => {
  it('la prioridad es explicable: documento incorrecto > discrepancia > representante; el reenvío y la antigüedad suman', () => {
    const base = { version: 1, recibidaEn: null, fechaInicio: null };
    const p = (recomendacion: RecomendacionCamara, extra = {}) => calcularPrioridadCamara({ recomendacion, ...base, ...extra }, AHORA);
    expect(p(RecomendacionCamara.DOCUMENTO_INCORRECTO).puntaje).toBeGreaterThan(p(RecomendacionCamara.DISCREPANCIA_CRITICA).puntaje);
    expect(p(RecomendacionCamara.DISCREPANCIA_CRITICA).puntaje).toBeGreaterThan(p(RecomendacionCamara.REPRESENTANTE_DIFERENTE).puntaje);
    expect(p(RecomendacionCamara.CONSISTENTE).puntaje).toBe(0);
    const reenvio = p(RecomendacionCamara.CONSISTENTE, { version: 2, recibidaEn: new Date(AHORA.getTime() - 3 * 86_400_000) });
    expect(reenvio.puntaje).toBe(10 + 6);
    expect(reenvio.razones).toEqual(['Reenvío (versión 2)', '3 día(s) en bandeja']);
  });

  it('los seis estados humanos del estudiante, con «qué pasó» y «qué hacer»', () => {
    const e = (doc: Parameters<typeof estadoCamaraParaEstudiante>[0]['documento'], validacion: Parameters<typeof estadoCamaraParaEstudiante>[0]['validacion']) => estadoCamaraParaEstudiante({ documento: doc, validacion });
    const d = { estado: EstadoDocumento.EN_REVISION, motivoDevolucion: null };
    expect(e(null, null)).toMatchObject({ estado: 'pendiente', puedeReenviar: true });
    expect(e(d, { estado: Estado.PROCESANDO, motivoDecision: null })).toMatchObject({ estado: 'en_procesamiento', puedeReenviar: false });
    expect(e(d, { estado: Estado.REVISION, motivoDecision: null })).toMatchObject({ estado: 'en_revision', puedeReenviar: false });
    expect(e(d, { estado: Estado.ERROR, motivoDecision: null })).toMatchObject({ estado: 'en_revision' });
    expect(e(d, { estado: Estado.APROBADO_MANUAL, motivoDecision: null })).toMatchObject({ estado: 'aprobado', puedeReenviar: false });
    expect(e(d, { estado: Estado.RECHAZADO, motivoDecision: null })).toMatchObject({ estado: 'rechazado', puedeReenviar: true });
    expect(e({ ...d, estado: EstadoDocumento.DEVUELTO }, { estado: Estado.DEVUELTO, motivoDecision: 'matricula_cancelada' })).toMatchObject({
      estado: 'necesita_correccion', que: MENSAJES_DEVOLUCION_CAMARA[MotivoDevolucionCamara.MATRICULA_CANCELADA].que, hacer: MENSAJES_DEVOLUCION_CAMARA[MotivoDevolucionCamara.MATRICULA_CANCELADA].hacer,
    });
    expect(e({ estado: EstadoDocumento.ILEGIBLE, motivoDevolucion: null }, null)).toMatchObject({ estado: 'necesita_correccion' });
  });
});

describe('Cámara · roles: los mismos que ya decidían la Cámara y que operan el RUT', () => {
  it.each([[Rol.TUTOR, true, false], [Rol.COORDINADOR, true, true], [Rol.ADMINISTRADOR, true, true], [Rol.AUXILIAR, false, false], [Rol.EMPRESA, false, false], [Rol.EXTENSION, false, false], [Rol.ESTUDIANTE, false, false]])(
    '%s → opera=%s supervisa=%s', (rol, opera, supervisa) => {
      expect(puedeOperarRevisionCamara(rol)).toBe(opera);
      expect(esSupervisorRevisionCamara(rol)).toBe(supervisa);
      expect(puedeOperarRevisionCamara(rol)).toBe(puedeOperarRevisionRut(rol));
    },
  );

  it('solo el estudiante consulta el estado de su propia Cámara', () => {
    for (const rol of Object.values(Rol)) expect(puedeVerEstadoCamaraPropio(rol)).toBe(rol === Rol.ESTUDIANTE);
  });
});

describe('Decisión genérica de documentos empresariales: los mensajes nombran el documento', () => {
  it('por defecto dicen «RUT» (sin cambio) y con la Cámara dicen «certificado de Cámara»', () => {
    expect(new ConflictoDecisionRutError('version_vieja').message).toMatch(/versión más reciente del RUT/);
    expect(new ConflictoDecisionRutError('version_vieja', 'certificado de Cámara').message).toMatch(/versión más reciente del certificado de Cámara/);
    expect(new ConflictoDecisionRutError('no_revisable', 'certificado de Cámara').message).not.toMatch(/RUT/);
    expect(new ConflictoDecisionRutError('ya_decidida').message).toBe('El caso ya fue decidido');
  });
});

describe('Migración 21 · motivos de devolución de la Cámara (sin ejecutar)', () => {
  async function sqlDe(metodo: 'up' | 'down', filas = 0): Promise<{ sql: string[]; error?: Error }> {
    const emitido: string[] = [];
    const corredor = { query: (sql: string) => { emitido.push(sql.replace(/\s+/g, ' ').trim()); return Promise.resolve(/count\(\*\)/.test(sql) ? [{ n: filas }] : undefined); } };
    try {
      await new MotivosDecisionCamara1756000021000()[metodo](corredor as unknown as QueryRunner);
      return { sql: emitido };
    } catch (e) {
      return { sql: emitido, error: e as Error };
    }
  }

  it('está registrada al final, después de la decisión humana del RUT', () => {
    expect(MIGRACIONES[MIGRACIONES.length - 1]).toBe(MotivosDecisionCamara1756000021000);
    expect(MIGRACIONES[MIGRACIONES.length - 2].name).toBe('DecisionHumanaDocumentoEmpresarial1756000020000');
  });

  it('solo reemplaza el CHECK del motivo: no crea tablas ni columnas, no toca datos y conserva los motivos del RUT', async () => {
    const up = (await sqlDe('up')).sql.join('\n');
    expect(up).toMatch(/DROP CONSTRAINT IF EXISTS ck_vdemp_motivo/);
    expect(up).not.toMatch(/CREATE TABLE|ADD COLUMN|UPDATE |INSERT |DELETE |DROP TABLE|TRUNCATE/i);
    for (const motivo of ['documento_incorrecto', 'rut_no_corresponde', 'otro', 'tipo_certificado_incorrecto', 'representante_no_coincide', 'matricula_cancelada']) {
      expect(up).toContain(`'${motivo}'`);
    }
    // Todos los motivos del catálogo de la Cámara caben en el CHECK.
    for (const m of Object.values(MotivoDevolucionCamara)) expect(up).toContain(`'${m}'`);
  });

  it('la reversión se NIEGA si ya hay devoluciones con motivos de la Cámara; sin ellas, restaura el CHECK anterior', async () => {
    const conDatos = await sqlDe('down', 2);
    expect(conDatos.error?.message).toMatch(/No se revierte/);
    expect(conDatos.sql.join(' ')).not.toMatch(/DROP CONSTRAINT/);
    const limpia = await sqlDe('down', 0);
    expect(limpia.error).toBeUndefined();
    const restaurado = limpia.sql.filter((q) => /ADD CONSTRAINT/.test(q)).join('\n');
    expect(restaurado).not.toContain("'matricula_cancelada'");
    expect(restaurado).toContain("'rut_no_corresponde'");
  });
});
