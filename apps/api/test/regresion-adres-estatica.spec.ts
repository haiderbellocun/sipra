import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { VERIFICADORES_EPS_OFICIALES } from '../src/domain/services/registro-verificadores-eps';

/**
 * Regresión ESTÁTICA de las restricciones de ADRES y del flujo EPS: el código no puede
 * automatizar el portal, resolver CAPTCHA, usar endpoints privados, guardar cookies ni
 * mandar certificados a una IA externa. Si alguien lo intenta, esta prueba falla.
 */

const RAIZ = join(__dirname, '..');
const SRC = join(RAIZ, 'src');
const WEB = join(RAIZ, '..', 'web', 'src');

function archivos(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p, ext) : ext.test(n) ? [p] : [];
  });
}
const todos = [...archivos(SRC, /\.ts$/), ...archivos(WEB, /\.(ts|html)$/)];
const texto = new Map(todos.map((f) => [f, readFileSync(f, 'utf8')]));
const rel = (f: string): string => relative(join(RAIZ, '..', '..'), f).replace(/\\/g, '/');
const con = (re: RegExp): string[] => [...texto].filter(([, t]) => re.test(t)).map(([f]) => rel(f));
/** Quita comentarios para que una advertencia escrita («no usa cookies») no cuente como uso. */
const sinComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('Regresión · ADRES asistido y EPS local', () => {
  it('no hay automatización de navegador en dependencias ni en código', () => {
    const pkgs = ['package.json', 'apps/api/package.json', 'apps/web/package.json'].map((p) => readFileSync(join(RAIZ, '..', '..', p), 'utf8')).join('\n');
    expect(pkgs).not.toMatch(/puppeteer|playwright|selenium|chromedriver|webdriver/i);
    expect(con(/from ['"](puppeteer|playwright|selenium-webdriver)/)).toEqual([]);
  });

  it('ningún código (fuera de comentarios) toca cookies, reCAPTCHA, ni resuelve CAPTCHA', () => {
    const malos = [...texto]
      .filter(([f]) => !/redaccion-logs|migrations\//.test(f))
      .filter(([, t]) => /document\.cookie|set-cookie|recaptcha|resolverCaptcha|solveCaptcha|2captcha|anticaptcha/i.test(sinComentarios(t)))
      .map(([f]) => rel(f));
    expect(malos).toEqual([]);
  });

  it('el único lugar que nombra el dominio de ADRES es el de la consulta asistida, y solo como enlace para la persona', () => {
    const lugares = con(/adres\.gov\.co/);
    expect(lugares.filter((l) => !l.includes('consulta-adres.use-case.ts'))).toEqual([]);
    const caso = sinComentarios(texto.get(join(SRC, 'application/use-cases/documentos/consulta-adres.use-case.ts')) ?? '');
    expect(caso).not.toMatch(/\bfetch\(|ClienteHttpSeguro|https?\.request|axios/);
  });

  it('ningún archivo que habla de ADRES hace llamadas HTTP salientes', () => {
    const conHttp = [...texto]
      .filter(([f]) => f.startsWith(SRC) && /adres/i.test(f))
      .filter(([, t]) => /\bfetch\(|https?\.request|axios|ClienteHttpSeguro/.test(sinComentarios(t)))
      .map(([f]) => rel(f));
    expect(conHttp).toEqual([]);
  });

  it('el flujo EPS no usa OpenAI ni Anthropic: la lectura es local', () => {
    for (const f of ['application/use-cases/documentos/validacion-eps.use-case.ts', 'application/use-cases/documentos/mesa-eps.use-case.ts',
      'application/use-cases/documentos/consulta-adres.use-case.ts', 'application/use-cases/documentos/verificacion-eps.use-case.ts', 'infrastructure/adapters/lectura-local/lector-documento-local.adapter.ts']) {
      expect(sinComentarios(texto.get(join(SRC, f)) ?? '')).not.toMatch(/openai|anthropic|OPENAI_API_KEY|ANTHROPIC_API_KEY/i);
    }
  });

  it('sin verificadores oficiales aprobados: el inventario está VACÍO (cero salida HTTP hacia EPS)', () => {
    expect(VERIFICADORES_EPS_OFICIALES).toEqual([]);
  });

  it('la extensión de Chrome NO existe en el repositorio', () => {
    expect(con(/chrome\.(runtime|tabs|webRequest|scripting)/)).toEqual([]);
    expect(todos.filter((f) => /manifest\.json$/.test(f))).toEqual([]);
  });
});

describe('Regresión · retención EPS (política pendiente de definición institucional)', () => {
  it('la única purga automática por tipo es la de la cédula: el certificado EPS, ADRES y la auditoría no se borran solos', () => {
    const fuente = texto.get(join(SRC, 'application/use-cases/documentos/gestionar-documento.use-case.ts')) ?? '';
    const bloque = /const DIAS_PURGA[^=]*=\s*\{([^}]*)\}/.exec(fuente)?.[1] ?? '';
    expect(bloque).toContain('TipoDocumento.CEDULA');
    expect(bloque).not.toMatch(/CERTIFICADO_EPS|ADRES|EPS/);
    expect(bloque.split(',').filter((l) => /TipoDocumento\./.test(l))).toHaveLength(1);
  });

  it('EPS_RETENCION_DIAS es solo configuración: ningún código la lee para purgar nada (todavía)', () => {
    const lectores = [...texto].filter(([f, t]) => !/configuracion\.ts$/.test(f) && /EPS_RETENCION_DIAS/.test(sinComentarios(t))).map(([f]) => rel(f));
    expect(lectores).toEqual([]);
  });

  it('ninguna sentencia de código borra filas de las tablas EPS ni de la auditoría', () => {
    const borrados = [...texto]
      .filter(([f]) => f.startsWith(SRC) && !/migrations\//.test(f))
      .filter(([, t]) => /DELETE\s+FROM\s+(validaciones_eps|evidencias_validacion_eps|auditoria)\b|TRUNCATE\s+(TABLE\s+)?(validaciones_eps|evidencias_validacion_eps|auditoria)\b/i.test(t))
      .map(([f]) => rel(f));
    expect(borrados).toEqual([]);
  });
});
