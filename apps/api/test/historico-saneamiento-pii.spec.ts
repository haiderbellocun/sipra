import { FilaSgp, RegistroHistorico, transformarFilaSgp } from '../src/domain/historico/registro-historico';
import { esSalarioConPii, patronesPii, sanearTextoLibre } from '../src/domain/historico/saneamiento-pii-historico';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { filasFixtureSgp } from './soporte-historico-sgp';

// Todos los valores son SINTÉTICOS: dominios reservados (example.*), números de prueba sin titular.
const seud = SeudonimizadorHistorico.desdeSecreto('prueba-sintetica-saneamiento-'.padEnd(48, 's'), 'v1');
const transformar = (celdas: FilaSgp): RegistroHistorico => transformarFilaSgp({ filaOrigen: 2, celdas }, 'SGP_SINTETICO', seud);
const base = (): FilaSgp => ({ ...filasFixtureSgp(1)[40], 'Ciudad': 'Bogotá D.C.', 'Cargo Estudiante': 'Auxiliar administrativo', 'Horario': 'Lunes a viernes 8:00 a 17:00', 'Área': 'Contabilidad', 'Salario': 1_300_000 });

describe('Histórico SGP · saneamiento de datos personales (§31) · regla', () => {
  it.each([
    ['correo', 'persona.sintetica@example.com', ['CORREO']],
    ['correo dentro de una cadena mayor', 'Contacto: usuario_prueba@example.org (oficina)', ['CORREO']],
    ['correo con espacios alrededor de la arroba', 'usuario @ example.co', ['CORREO']],
    ['celular continuo', '3000000000', ['CELULAR', 'DIGITOS_CONTINUOS']],
    ['celular agrupado', 'Tel 300 000 0000', ['CELULAR']],
    ['celular con guiones', '300-000-0000', ['CELULAR']],
    ['7 dígitos continuos', '1234567', ['DIGITOS_CONTINUOS']],
    ['documento con texto', 'CC 1000000000 Bogotá', ['DIGITOS_CONTINUOS']],
    ['NIT con dígito de verificación', '900000000-1', ['DIGITOS_CONTINUOS']],
  ])('detecta %s', (_caso, texto, esperado) => {
    expect(patronesPii(texto)).toEqual(esperado);
  });

  it.each([
    ['ciudad', 'Bogotá D.C.'],
    ['ciudad con departamento', 'Medellín (Antioquia)'],
    ['cargo', 'Auxiliar contable II'],
    ['horario estándar', 'Lunes a viernes 8:00 a 17:00'],
    ['horario sin espacios', 'lunes 7:00 a 17:00'],
    ['horario con varios bloques', 'L-V 7:00-12:00 y 14:00-18:00; sábados 8:00-12:00'],
    ['seis dígitos (límite inferior)', 'Código 123456'],
    ['dígitos separados que concatenados serían 8', '1234 5678'],
    ['fecha', '2024-01-15'],
    ['número de 10 dígitos que no empieza por 3', 'Ref 20 24 01 15'],
    ['arroba como «a» en un horario', '8:00 @ 17:00'],
    ['arroba como «a» con am/pm', '7am @ 5pm. 2pm@6pm.'],
    ['arroba como sufijo inclusivo', 'Auxiliar@ comercial'],
  ])('NO elimina un valor normal: %s', (_caso, texto) => {
    expect(patronesPii(texto)).toEqual([]);
    expect(sanearTextoLibre(texto)).toEqual({ valor: texto, saneado: false });
  });

  it('un campo contaminado se anula ENTERO (no se rescata la parte limpia)', () => {
    expect(sanearTextoLibre('Bogotá - usuario@example.com')).toEqual({ valor: null, saneado: true });
    expect(sanearTextoLibre(null)).toEqual({ valor: null, saneado: false });
  });

  it('salario: los montos de 7+ dígitos son legítimos; solo correo y celular lo anulan', () => {
    expect(esSalarioConPii('1300000')).toBe(false);
    expect(esSalarioConPii('1.300.000')).toBe(false);
    expect(esSalarioConPii('25000000')).toBe(false);
    expect(esSalarioConPii('3000000000')).toBe(true);
    expect(esSalarioConPii('usuario@example.com')).toBe(true);
    expect(esSalarioConPii(null)).toBe(false);
  });
});

describe('Histórico SGP · saneamiento de datos personales (§31) · transformación', () => {
  it('valores normales se conservan y no generan marcas PII', () => {
    const r = transformar(base());
    expect(r.ciudadOriginal).toBe('Bogotá D.C.');
    expect(r.ciudadNormalizada).not.toBeNull();
    expect(r.cargoEstudiante).toBe('Auxiliar administrativo');
    expect(r.horario).toBe('Lunes a viernes 8:00 a 17:00');
    expect(r.area).toBe('Contabilidad');
    expect(r.salarioNormalizado).toBe(1_300_000);
    expect(r.qualityFlags.filter((m) => m.startsWith('PII_'))).toEqual([]);
  });

  it('ciudad contaminada: original Y normalizada en NULL, con su marca', () => {
    const r = transformar({ ...base(), 'Ciudad': 'persona.sintetica@example.com' });
    expect(r.ciudadOriginal).toBeNull();
    expect(r.ciudadNormalizada).toBeNull();
    expect(r.qualityFlags).toContain('PII_SUSPECT_CITY');
    expect(r.qualityStatus).toBe('observed');
  });

  it('cargo, horario, área y salario contaminados quedan en NULL con su marca', () => {
    const r = transformar({ ...base(), 'Cargo Estudiante': '3000000000', 'Horario': '1234567', 'Área': 'Ext. 300 000 0000', 'Salario': 3_000_000_000 });
    expect([r.cargoEstudiante, r.horario, r.area, r.salarioOriginal, r.salarioNormalizado]).toEqual([null, null, null, null, null]);
    expect(r.qualityFlags).toEqual(expect.arrayContaining(['PII_SUSPECT_STUDENT_POSITION', 'PII_SUSPECT_SCHEDULE', 'PII_SUSPECT_AREA', 'PII_SUSPECT_SALARY']));
    expect(r.qualityFlags).not.toContain('SALARY_OUTLIER');
    expect(r.qualityFlags).not.toContain('SALARY_UNPARSEABLE');
  });

  it('ningún fragmento del valor contaminado llega al registro (ni JSON ni marcas)', () => {
    const r = transformar({ ...base(), 'Ciudad': 'usuario_prueba@example.org', 'Cargo Estudiante': 'Auxiliar 3000000000', 'Horario': '1234567' });
    const texto = JSON.stringify(r);
    for (const fragmento of ['usuario_prueba', 'example.org', 'EXAMPLE', '3000000000', '1234567']) expect(texto).not.toContain(fragmento);
  });

  it('el content_hash no depende del valor anulado (no se puede revertir por fuerza bruta)', () => {
    const a = transformar({ ...base(), 'Ciudad': '3000000000' });
    const b = transformar({ ...base(), 'Ciudad': '3111111111' });
    const c = transformar({ ...base(), 'Ciudad': 'otro@example.com' });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toBe(c.contentHash);
    expect(a.contentHash).not.toBe(transformar(base()).contentHash);
  });
});
