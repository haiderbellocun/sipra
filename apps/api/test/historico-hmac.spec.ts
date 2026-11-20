import { ClaveHistoricoAusenteError, SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { normalizarDocumentoSgp } from '../src/domain/historico/normalizacion-sgp';
import { configuracionHistorico } from '../src/infrastructure/historico/configuracion-historico';

/** Secretos SINTÉTICOS construidos en tiempo de prueba (ningún secreto real ni literal en el repositorio). */
const SECRETO_A = 'prueba-sintetica-a-'.padEnd(48, 'a');
const SECRETO_B = 'prueba-sintetica-b-'.padEnd(48, 'b');
const huella = (k: string | null): string => (k ? `${k.slice(0, 6)}…` : 'null'); // nunca se imprime una clave completa

describe('Histórico SGP · claves HMAC seudónimas', () => {
  const s = SeudonimizadorHistorico.desdeSecreto(SECRETO_A, 'v1');
  const doc = (v: string | number): string | null => s.clave('student', normalizarDocumentoSgp(v).normalizado);

  it('mismo documento → misma student_key (determinística)', () => {
    expect(doc(1012345678)).toBe(doc(1012345678));
    expect(doc(1012345678)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el mismo documento como docente da una clave DISTINTA (prefijo de propósito)', () => {
    const n = normalizarDocumentoSgp(1012345678).normalizado;
    expect(s.clave('teacher', n)).not.toBe(s.clave('student', n));
    expect(s.clave('organization', n)).not.toBe(s.clave('student', n));
  });

  it('documentos equivalentes tras normalizar → misma clave (número, texto con puntos, ceros a la izquierda)', () => {
    const k = doc(1012345678);
    expect(huella(doc('1.012.345.678'))).toBe(huella(k));
    expect(doc('1.012.345.678')).toBe(k);
    expect(doc(' 1012345678 ')).toBe(k);
    expect(doc('001012345678')).toBe(k);
  });

  it('secreto distinto → clave distinta', () => {
    const otro = SeudonimizadorHistorico.desdeSecreto(SECRETO_B, 'v1');
    expect(otro.clave('student', '1012345678')).not.toBe(s.clave('student', '1012345678'));
  });

  it('sin valor no hay clave', () => {
    expect(s.clave('student', null)).toBeNull();
  });

  it('fail-closed: sin secreto, con marcador de plantilla, corto o sin versión, NO hay seudonimizador', () => {
    expect(() => SeudonimizadorHistorico.desdeSecreto(undefined, 'v1')).toThrow(ClaveHistoricoAusenteError);
    expect(() => SeudonimizadorHistorico.desdeSecreto('', 'v1')).toThrow(/no está definida/);
    expect(() => SeudonimizadorHistorico.desdeSecreto('<secret-required-for-historical-import>', 'v1')).toThrow(/marcador/);
    expect(() => SeudonimizadorHistorico.desdeSecreto('corto', 'v1')).toThrow(/al menos 32/);
    expect(() => SeudonimizadorHistorico.desdeSecreto(SECRETO_A, undefined)).toThrow(/VERSION/);
    expect(() => SeudonimizadorHistorico.desdeSecreto(SECRETO_A, '1')).toThrow(/VERSION/);
  });

  it('APPLY sin secreto: fail-closed (sin respaldo ni clave de desarrollo)', () => {
    expect(() => configuracionHistorico({ HISTORICO_IMPORT_APPLY: 'true' }, 'apply')).toThrow(ClaveHistoricoAusenteError);
  });

  it('simulacro sin secreto: clave EFÍMERA, marcada como tal y no comparable', () => {
    const c = configuracionHistorico({}, 'dry-run');
    expect(c.seudonimizador.efimera).toBe(true);
    expect(c.compuertaApply).toBe(false);
    const otra = configuracionHistorico({}, 'dry-run');
    expect(c.seudonimizador.clave('student', '1')).not.toBe(otra.seudonimizador.clave('student', '1'));
  });

  it('la compuerta solo se abre con HISTORICO_IMPORT_APPLY=true', () => {
    const entorno = { HISTORICO_HMAC_KEY: SECRETO_A, HISTORICO_HMAC_KEY_VERSION: 'v1' };
    expect(configuracionHistorico({ ...entorno, HISTORICO_IMPORT_APPLY: 'false' }, 'apply').compuertaApply).toBe(false);
    expect(configuracionHistorico({ ...entorno, HISTORICO_IMPORT_APPLY: '1' }, 'apply').compuertaApply).toBe(false);
    expect(configuracionHistorico({ ...entorno, HISTORICO_IMPORT_APPLY: 'true' }, 'apply').compuertaApply).toBe(true);
  });
});
