import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QueryRunner } from 'typeorm';
import { HistoricoCorrespondenciaPracticas1756000027000 } from '../src/infrastructure/persistence/postgres/migrations/1756000027000-HistoricoCorrespondenciaPracticas';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';

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

  it('Reportes V3 sigue sin conectarse a la capa unificada (H5)', () => {
    for (const f of todos.filter((x) => /reportes/i.test(x))) expect(importa(f, /analitica-unificada|domain\/analitica|historico/)).toBe(false);
  });

  it('ningún módulo Nest ni controlador registra todavía la analítica unificada', () => {
    for (const f of todos.filter((x) => /\.(module|controller)\.ts$/.test(x))) expect(importa(f, /analitica-unificada|domain\/analitica/)).toBe(false);
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

  it('es la última migración y solo crea una tabla en historico, sin FK a public', async () => {
    expect(MIGRACIONES[MIGRACIONES.length - 1]).toBe(HistoricoCorrespondenciaPracticas1756000027000);
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
