import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GestionarEmpresaUseCase } from '../src/application/use-cases/empresas/gestionar-empresa.use-case';
import { Empresa } from '../src/domain/entities/empresa.entity';
import { ambientePermiteRuesSimulado } from '../src/domain/services/politica-rues';
import { RuesNoDisponibleAdapter, RuesSimuladoAdapter } from '../src/infrastructure/adapters/externos/externos.adapter';

describe('RUES simulado: solo desarrollo y pruebas', () => {
  it.each([
    ['dev', undefined, true],
    ['dev', 'production', true],
    ['qa', undefined, false],
    ['pre', undefined, false],
    ['prod', undefined, false],
    // NODE_ENV=test solo vale cuando no se declaró ambiente: no abre qa, pre ni prod.
    [undefined, 'test', true],
    ['prod', 'test', false],
    ['pre', 'test', false],
    [undefined, undefined, false],
    ['', 'production', false],
  ])('ambiente=%s, NODE_ENV=%s → %s', (ambiente, nodeEnv, esperado) => {
    expect(ambientePermiteRuesSimulado(ambiente, nodeEnv)).toBe(esperado);
  });

  it('el adaptador simulado marca su origen; el de «no disponible» no devuelve ningún dato', async () => {
    expect(await new RuesSimuladoAdapter().consultarPorNit('901458772')).toMatchObject({ encontrado: true, fuente: 'simulada' });
    expect(await new RuesSimuladoAdapter().consultarPorNit('999999999')).toMatchObject({ encontrado: false, fuente: 'simulada' });
    // El NIT que el simulado SÍ conoce no produce nada en el adaptador de ambientes reales.
    expect(await new RuesNoDisponibleAdapter().consultarPorNit()).toEqual({
      encontrado: false, razonSocial: null, estadoMatricula: null, fechaMatricula: null, representanteLegal: null, fuente: 'no_disponible',
    });
  });

  it('el módulo decide por el ambiente: el proveedor de RUES ya no es una clase fija', () => {
    const modulo = readFileSync(join(__dirname, '..', 'src', 'infrastructure', 'modules', 'app.module.ts'), 'utf8');
    expect(modulo).not.toMatch(/provide:\s*RUES\s*,\s*useClass/);
    expect(modulo).toMatch(/provide:\s*RUES,[\s\S]*?ambientePermiteRuesSimulado\(config\.get<string>\('SIPRA_AMBIENTE'\)/);
  });
});

describe('Pre-verificación de empresas con RUES no disponible', () => {
  const dto = {
    razonSocial: 'Soluciones Logísticas Andinas S.A.S.', nit: '901458772-2', solicitanteNombre: 'Persona de prueba',
    solicitanteCorreo: 'prueba@empresa-demo.test',
  } as never;

  async function preverificar(rues: { consultarPorNit: (nit: string) => Promise<unknown> }) {
    const guardadas: Empresa[] = [];
    const repo = {
      buscarPorNit: async () => null,
      guardar: async (datos: Parameters<typeof Empresa.desde>[0]) => { const e = Empresa.desde(datos); guardadas.push(e); return e; },
    };
    const caso = new GestionarEmpresaUseCase(repo as never, {} as never, rues as never);
    await caso.registrarSolicitud(dto);
    return guardadas[guardadas.length - 1].senales.find((s) => s.codigo === 'RUES');
  }

  it('sin RUES real la señal es «no verificable» (advertencia), no «el NIT no aparece» (crítico) ni datos simulados', async () => {
    const senal = await preverificar(new RuesNoDisponibleAdapter());
    expect(senal).toEqual({ codigo: 'RUES', resultado: 'advertencia', detalle: 'RUES no disponible en este ambiente: no verificable' });
    expect(JSON.stringify(senal)).not.toMatch(/SOLUCIONES|matr[ií]cula activa/i);
  });

  it('con el simulado (solo dev/test) el comportamiento anterior no cambia', async () => {
    expect(await preverificar(new RuesSimuladoAdapter())).toMatchObject({ codigo: 'RUES', resultado: 'ok' });
  });
});
