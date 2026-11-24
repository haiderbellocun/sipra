import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QueryRunner } from 'typeorm';
import { HistoricoCorrespondenciaPracticas1756000027000 } from '../src/infrastructure/persistence/postgres/migrations/1756000027000-HistoricoCorrespondenciaPracticas';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { HistoricoServingAnalitico1756000028000 } from '../src/infrastructure/persistence/postgres/migrations/1756000028000-HistoricoServingAnalitico';

const SRC = join(__dirname, '..', 'src');
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : r.endsWith('.ts') ? [r] : [];
  });
}
const todos = archivos(SRC);
const importa = (archivo: string, patron: RegExp): boolean =>
  [...readFileSync(archivo, 'utf8').matchAll(/from\s+'([^']+)'/g)].some((m) => patron.test(m[1]));

describe('Arquitectura · el histórico no entra en la operación (H4)', () => {
  it('Cumplimiento V3 (y todo lo de obligaciones) no importa el histórico ni la analítica unificada', () => {
    const cumplimiento = todos.filter((f) => /cumplimiento|obligacion/i.test(f));
    expect(cumplimiento.length).toBeGreaterThan(3);
    for (const f of cumplimiento) expect(importa(f, /historico|analitica-unificada|domain\/analitica/)).toBe(false);
  });

  it('H5: la analítica OPERATIVA de Reportes (expediente) no lee el histórico; solo la ruta por fuentes lo hace', () => {
    for (const f of todos.filter((x) => /reportes-analitica\.(use-case|adapter)\.ts$|reportes-sgp|reportes\.adapter/.test(x))) {
      expect(importa(f, /historico|analitica-unificada|serving/)).toBe(false);
    }
    expect(todos.some((f) => /reportes-fuentes\.use-case\.ts$/.test(f) && importa(f, /serving-analitico/))).toBe(true);
  });

  it('H5: ningún controlador de Cumplimiento u obligaciones registra el serving o la analítica unificada', () => {
    for (const f of todos.filter((x) => /(cumplimiento|obligacion).*\.controller\.ts$/.test(x))) expect(importa(f, /analitica|historico|serving/)).toBe(false);
  });

  it('el dominio analítico no depende de infraestructura ni de SQL', () => {
    for (const f of todos.filter((x) => /[\\/]domain[\\/]analitica[\\/]/.test(x))) {
      expect(importa(f, /infrastructure|typeorm|@nestjs|^pg$/)).toBe(false);
    }
  });
});

describe('Migración 27 · correspondencias de práctica SGP ↔ SIPRA (sin ejecutar)', () => {
  async function sql(metodo: 'up' | 'down', filas = 0): Promise<{ sql: string; error?: Error }> {
    const emitido: string[] = [];
    const corredor = { query: (q: string) => { emitido.push(q.replace(/\s+/g, ' ').trim()); return Promise.resolve(/count\(\*\)/.test(q) ? [{ n: filas }] : undefined); } };
    try {
      await new HistoricoCorrespondenciaPracticas1756000027000()[metodo](corredor as unknown as QueryRunner);
      return { sql: emitido.join('\n') };
    } catch (e) {
      return { sql: emitido.join('\n'), error: e as Error };
    }
  }

  it('va antes de la 28 y solo crea una tabla en historico, sin FK a public', async () => {
    expect(MIGRACIONES[MIGRACIONES.indexOf(HistoricoCorrespondenciaPracticas1756000027000) + 1]).toBe(HistoricoServingAnalitico1756000028000);
    const { sql: s } = await sql('up');
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS historico\.practica_correspondencia/);
    expect(s).not.toMatch(/REFERENCES|\bpublic\.|ALTER TABLE|INSERT |UPDATE /);
  });

  it('nunca por parecido; confirmada con revisor; una confirmada por registro y por práctica', async () => {
    const { sql: s } = await sql('up');
    expect(s).toMatch(/method IN \('sgp_id', 'manual'\)/);
    expect(s).toMatch(/status = 'propuesta' OR \(reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL\)/);
    expect(s).toMatch(/ux_hcorr_registro_confirmado ON historico\.practica_correspondencia \(source_system, source_record_id\) WHERE status = 'confirmada'/);
    expect(s).toMatch(/ux_hcorr_practica_confirmada ON historico\.practica_correspondencia \(practica_id\) WHERE status = 'confirmada'/);
    expect(s).toMatch(/REVOKE ALL ON TABLE historico\.practica_correspondencia FROM sipra_app/);
  });

  it('down se niega con correspondencias registradas', async () => {
    expect((await sql('down', 2)).error?.message).toMatch(/hay correspondencias/);
    expect((await sql('down', 0)).sql).toMatch(/DROP TABLE IF EXISTS historico\.practica_correspondencia/);
  });
});

describe('Migración 28 · serving analítico del histórico (sin ejecutar)', () => {
  async function sql28(metodo: 'up' | 'down'): Promise<string> {
    const emitido: string[] = [];
    const corredor = { query: (q: string) => { emitido.push(q.replace(/\s+/g, ' ').trim()); return Promise.resolve(undefined); } };
    await new HistoricoServingAnalitico1756000028000()[metodo](corredor as unknown as QueryRunner);
    return emitido.join('\n');
  }

  it('es la última migración y solo crea tablas derivadas en historico', async () => {
    expect(MIGRACIONES[MIGRACIONES.length - 1]).toBe(HistoricoServingAnalitico1756000028000);
    const s = await sql28('up');
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS historico\.serving_publicacion/);
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS historico\.serving_practicas/);
    expect(s).not.toMatch(/\bpublic\.|ALTER TABLE|REFERENCES/);
  });

  it('mínimo privilegio: sipra_app solo SELECT sobre el serving, su puntero y las correspondencias; nunca escribir', async () => {
    const s = await sql28('up');
    expect(s).toMatch(/GRANT USAGE ON SCHEMA historico TO sipra_app/);
    expect(s).toMatch(/GRANT SELECT ON TABLE historico\.serving_practicas, historico\.serving_publicacion, historico\.practica_correspondencia TO sipra_app/);
    expect(s).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)/);
    expect(s).not.toMatch(/historico\.practicas\b(?!_)|historico\.importaciones|historico\.organizaciones/);
  });

  it('el serving no tiene columnas personales directas', async () => {
    const s = await sql28('up');
    expect(s).not.toMatch(/\b(documento|email|correo|telefono|nombre_estudiante|nombre_docente|jefe|funciones|teacher_key|organization_key)\b/i);
  });

  it('down retira tablas derivadas y permisos', async () => {
    const s = await sql28('down');
    expect(s).toMatch(/REVOKE ALL ON SCHEMA historico FROM sipra_app/);
    expect(s).toMatch(/DROP TABLE IF EXISTS historico\.serving_practicas/);
  });
});
