import { Repository } from 'typeorm';
import { camposDe } from '../src/domain/entities/campos-extraccion';
import { SeveridadBandera, TipoDocumento } from '../src/domain/entities/documento.entity';
import { CampoExtraido, ResultadoExtraccion } from '../src/domain/ports/out/servicios-externos.port';
import { fusionarLecturas } from '../src/domain/services/fusion-lecturas';
import {
  UsoRescate, banderasDeRescate, clasificarResultadoRescate, decidirLegibilidadTrasRescate, esLecturaIaReal, incorporarRescate,
} from '../src/domain/services/resultado-rescate-ia';
import { DocumentoOrm } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import { DocumentoRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';

/** Datos sintéticos. Tipo: certificado de EPS (entidad_emisora, nombre_afiliado, documento_afiliado, fecha_expedicion, estado_afiliacion, regimen). */
const EPS = TipoDocumento.CERTIFICADO_EPS;
const c = (valor: string | null, confianza = 0.95, fuente?: CampoExtraido['fuente']): CampoExtraido =>
  ({ valor, confianza, evidencia: null, ...(fuente ? { fuente } : {}) });

function base(cambios: Record<string, CampoExtraido> = {}, extra: Partial<ResultadoExtraccion> = {}): ResultadoExtraccion {
  const campos: Record<string, CampoExtraido> = {};
  for (const n of camposDe(EPS)) campos[n] = c(`local-${n}`, 0.95, 'texto_nativo');
  return {
    tipoDetectado: EPS, campos: { ...campos, ...cambios }, ilegible: false, modelo: 'local-determinista', tokensEntrada: 0,
    tokensSalida: 0, costoUsd: 0, proveedor: 'local', hallazgos: [], resumen: 'r', ...extra,
  };
}

const USO: UsoRescate = {
  modelo: 'gpt-6-luna-2026-09-22', proveedor: 'openai', tokensEntrada: 3_000, tokensSalida: 120, tokensCache: 1_000,
  tokensRazonamiento: 40, costoUsd: 0.0021, duracionMs: 850,
};

describe('Resultado del rescate (dominio, 1.5)', () => {
  describe('clasificación', () => {
    const f = (r: string[], co: string[] = []) => ({ camposRescatados: r, camposCorroborados: co });
    it('recuperado cuando se llenan todos los pedidos; parcial si algo útil; sin_datos si nada', () => {
      expect(clasificarResultadoRescate(2, f(['a', 'b']))).toBe('recuperado');
      expect(clasificarResultadoRescate(2, f(['a']))).toBe('parcial');
      expect(clasificarResultadoRescate(2, f([], ['a']))).toBe('parcial');
      expect(clasificarResultadoRescate(2, f([]))).toBe('sin_datos');
      expect(clasificarResultadoRescate(0, f([]))).toBe('sin_datos');
    });
  });

  describe('regla de ilegibilidad (una sola función)', () => {
    it('no ilegible → sin cambio; ilegible + datos útiles → continuar con revisión; ilegible sin datos → se mantiene', () => {
      expect(decidirLegibilidadTrasRescate(false, 0)).toBe('sin_cambio');
      expect(decidirLegibilidadTrasRescate(false, 3)).toBe('sin_cambio');
      expect(decidirLegibilidadTrasRescate(true, 1)).toBe('continuar_con_revision');
      expect(decidirLegibilidadTrasRescate(true, 6)).toBe('continuar_con_revision');
      expect(decidirLegibilidadTrasRescate(true, 0)).toBe('mantener_ilegible');
    });
  });

  describe('incorporarRescate', () => {
    const rescatar = (lectura: ResultadoExtraccion, ia: Record<string, { valor: string | null; confianza?: number }>) => {
      const fusion = fusionarLecturas(EPS, lectura, ia);
      return incorporarRescate(lectura, {
        camposSolicitados: Object.keys(ia), resultado: clasificarResultadoRescate(Object.keys(ia).length, fusion),
        invocado: true, uso: USO, fusion,
      });
    };

    it('llena solo los campos vacíos, sin escribir `fuente` ia_rescate, y no toca el resto ni lo que la lectura base traía', () => {
      const extra = { lecturaLocal: { marca: 'x' }, hallazgos: [{ codigo: 'H' }] } as unknown as Partial<ResultadoExtraccion>;
      const { lectura, metadatos } = rescatar(base({ regimen: c(null, 0, 'ocr') }, extra), { regimen: { valor: 'Contributivo', confianza: 0.8 } });
      expect(lectura.campos.regimen).toEqual({ valor: 'Contributivo', confianza: 0.8, evidencia: null });
      expect(lectura.campos.entidad_emisora).toMatchObject({ valor: 'local-entidad_emisora', fuente: 'texto_nativo' });
      expect(metadatos.fuentesFinales.regimen).toBe('ia_rescate');
      expect((lectura as unknown as { lecturaLocal: unknown }).lecturaLocal).toEqual({ marca: 'x' });
      expect(lectura.hallazgos).toHaveLength(1);
      expect(lectura.tipoDetectado).toBe(EPS);
    });

    it('suma el gasto una sola vez y atribuye el costo al modelo que lo facturó; el modelo base queda en la metadata', () => {
      const { lectura, metadatos } = rescatar(base({ regimen: c(null, 0) }, { costoUsd: 0.001, tokensEntrada: 100, duracionMs: 10 }), { regimen: { valor: 'X' } });
      expect(lectura).toMatchObject({
        costoUsd: 0.0031, tokensEntrada: 3_100, tokensSalida: 120, tokensCache: 1_000, tokensRazonamiento: 40, duracionMs: 860,
        modelo: 'gpt-6-luna-2026-09-22', proveedor: 'openai',
      });
      expect(metadatos).toMatchObject({ modeloBase: 'local-determinista', proveedorBase: 'local', costoUsd: 0.0021 });
    });

    it('sin respuesta (tiempo agotado) no inventa gasto ni cambia el modelo', () => {
      const { lectura, metadatos } = incorporarRescate(base({ regimen: c(null, 0) }), {
        camposSolicitados: ['regimen'], resultado: 'timeout', invocado: true, uso: null, fusion: null,
      });
      expect(lectura).toMatchObject({ costoUsd: 0, modelo: 'local-determinista', proveedor: 'local' });
      expect(metadatos).toMatchObject({ invocado: true, resultado: 'timeout', costoUsd: 0, modelo: null });
    });

    it('una lectura ilegible con datos recuperados deja de serlo; sin datos sigue ilegible', () => {
      const ilegible = base({}, { ilegible: true, motivoIlegible: 'borroso', campos: Object.fromEntries(camposDe(EPS).map((n) => [n, c(null, 0)])) });
      const con = rescatar(ilegible, { regimen: { valor: 'Contributivo' } });
      expect(con.legibilidad).toBe('continuar_con_revision');
      expect(con.lectura.ilegible).toBe(false);
      expect(con.lectura.motivoIlegible).toBeNull();
      const sin = rescatar(ilegible, { regimen: { valor: null } });
      expect(sin.legibilidad).toBe('mantener_ilegible');
      expect(sin.lectura.ilegible).toBe(true);
    });

    it('no muta la lectura base', () => {
      const original = base({ regimen: c(null, 0) });
      const copia = JSON.stringify(original);
      rescatar(original, { regimen: { valor: 'Contributivo' } });
      expect(JSON.stringify(original)).toBe(copia);
    });

    it('la metadata y las banderas no llevan valores', () => {
      const lectura = base({ nombre_afiliado: c('Nombre Local', 0.92, 'ocr'), regimen: c(null, 0) });
      const { metadatos } = rescatar(lectura, { regimen: { valor: 'Contributivo' }, nombre_afiliado: { valor: 'Otro Nombre' } });
      const texto = JSON.stringify([metadatos, banderasDeRescate(metadatos)]);
      for (const prohibido of ['Contributivo', 'Nombre Local', 'Otro Nombre']) expect(texto).not.toContain(prohibido);
      expect(metadatos.requiereRevisionHumana).toBe(true);
    });
  });

  describe('banderas', () => {
    const meta = (resultado: Parameters<typeof incorporarRescate>[1]['resultado'], invocado = true) =>
      incorporarRescate(base({ regimen: c(null, 0) }), { camposSolicitados: ['regimen'], resultado, invocado, uso: null, fusion: null }).metadatos;

    it('presupuesto, error y timeout → NO_DISPONIBLE (ALTA); sin_datos → informativa', () => {
      for (const r of ['presupuesto', 'error', 'timeout'] as const) {
        const b = banderasDeRescate(meta(r, r !== 'presupuesto'));
        expect(b.map((x) => x.codigo)).toEqual(['C2_RESCATE_IA_NO_DISPONIBLE']);
        expect(b[0].severidad).toBe(SeveridadBandera.ALTA);
      }
      expect(banderasDeRescate(meta('sin_datos')).map((x) => [x.codigo, x.severidad])).toEqual([['C2_RESCATE_IA_SIN_DATOS', SeveridadBandera.INFORMATIVA]]);
    });
  });

  describe('esLecturaIaReal y su SQL', () => {
    it('la definición de dominio', () => {
      expect(esLecturaIaReal({ proveedor: 'local' })).toBe(false);
      expect(esLecturaIaReal({ proveedor: 'openai' })).toBe(true);
      expect(esLecturaIaReal({ proveedor: 'local', rescateIa: { invocado: true } })).toBe(true);
    });

    it('el repositorio cuenta solo IA real (proveedor externo o rescate invocado), por práctica y desde la fecha', async () => {
      const query = jest.fn().mockResolvedValue([{ total: '3' }]);
      const repo = { manager: { query } } as unknown as Repository<DocumentoOrm>;
      const total = await new DocumentoRepositoryAdapter(repo).contarLecturasIaRealesDesde('practica-1', new Date('2026-11-27T05:00:00Z'));
      expect(total).toBe(3);
      const [sql, parametros] = query.mock.calls[0] as [string, unknown[]];
      const plano = sql.replace(/\s+/g, ' ');
      expect(plano).toContain("extraccion->>'proveedor' IN ('openai', 'anthropic')");
      expect(plano).toContain("extraccion->'rescateIa'->>'invocado' = 'true'");
      expect(plano).toContain('practica_id = $1');
      expect(plano).toContain('>= $2');
      // Una lectura local (proveedor `local`, `pdf417`, `simulado`) no cumple ninguno de los dos predicados.
      expect(plano).not.toMatch(/'local'|'pdf417'|'simulado'/);
      expect(parametros).toEqual(['practica-1', new Date('2026-11-27T05:00:00Z')]);
    });

    it('el conteo general existente no se modificó (sigue contando cualquier lectura)', async () => {
      const query = jest.fn().mockResolvedValue([{ total: '9' }]);
      const repo = { manager: { query } } as unknown as Repository<DocumentoOrm>;
      await new DocumentoRepositoryAdapter(repo).contarLecturasDesde('p', new Date());
      const plano = (query.mock.calls[0][0] as string).replace(/\s+/g, ' ');
      expect(plano).toContain('extraccion IS NOT NULL');
      expect(plano).not.toContain('rescateIa');
      expect(plano).not.toContain("'openai'");
    });
  });
});
