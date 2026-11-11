import { definicionModalidad, documentosExigidos, ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { CIUDAD_CUN, INTERNAS, PERIODOS, TOTAL, generar } from '../herramientas/seed-reportes-1000.generador';

/**
 * Invariantes del dataset sintético reportes_seed_1000 (sin base de datos). Interna/externa se deriva de la regla del
 * dominio `definicionModalidad(m).articulada`; el generador no tiene otra fuente de verdad.
 */
const g = generar();
type Fila = { id: string; modalidad: string; empresaId: string | null; periodo: string; ciclo: string };
const practicas = g.practicas as unknown as Fila[];
const org = new Map(g.organizaciones.map((o) => [o.id, o]));
const cun = g.organizaciones.find((o) => o.ambito === 'cun');
const articulada = (m: string) => definicionModalidad(m as ModalidadPractica).articulada;

describe('reportes_seed_1000 · invariantes interna CUN / externa', () => {
  it('1.000 prácticas, todas con organización receptora', () => {
    expect(practicas).toHaveLength(TOTAL);
    expect(practicas.filter((p) => !p.empresaId || !org.has(p.empresaId))).toHaveLength(0);
  });

  it('articulada ⇒ CUN y no articulada ⇒ externa: 120 / 880 y 0 modalidades mal asignadas', () => {
    const internas = practicas.filter((p) => articulada(p.modalidad));
    const externas = practicas.filter((p) => !articulada(p.modalidad));
    expect(internas).toHaveLength(INTERNAS);
    expect(externas).toHaveLength(TOTAL - INTERNAS);
    expect(internas.filter((p) => p.empresaId !== cun?.id)).toHaveLength(0);
    expect(externas.filter((p) => p.empresaId === cun?.id)).toHaveLength(0);
    expect(new Set(internas.map((p) => p.modalidad)).size).toBe(7);
    expect(new Set(externas.map((p) => p.modalidad)).size).toBe(7);
  });

  it('una sola organización CUN (sector Educación por su CIIU, una sola ciudad: no se inventan sedes)', () => {
    expect(g.organizaciones.filter((o) => o.ambito === 'cun')).toHaveLength(1);
    expect(cun).toMatchObject({ seccion: 'P', ciiu: '8544', divipola: CIUDAD_CUN });
  });

  it('pasantía internacional ⇒ receptora internacional sin DIVIPOLA; nacionales siempre con municipio', () => {
    for (const p of practicas) {
      const o = org.get(p.empresaId as string)!;
      if (p.modalidad === String(ModalidadPractica.PASANTIA_INTERNACIONAL)) expect([o.ambito, o.divipola]).toEqual(['internacional', null]);
      else expect(o.divipola).not.toBeNull();
    }
    expect(g.organizaciones.filter((o) => o.ambito === 'internacional' && o.divipola !== null)).toHaveLength(0);
  });

  it('cada empresa externa nacional tiene un tamaño razonable (3–30) y las cuotas cierran', () => {
    const por = new Map<string, number>();
    for (const p of practicas) por.set(p.empresaId as string, (por.get(p.empresaId as string) ?? 0) + 1);
    const nacionales = g.organizaciones.filter((o) => o.ambito === 'nacional').map((o) => por.get(o.id) ?? 0);
    expect(Math.min(...nacionales)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...nacionales)).toBeLessThanOrEqual(30);
    expect(g.organizaciones.every((o) => o.libre === 0)).toBe(true);
  });

  it('solo periodos del catálogo y documentos de la matriz real de cada modalidad', () => {
    expect(new Set(practicas.map((p) => p.periodo))).toEqual(new Set(PERIODOS));
    const tiposPorPractica = new Map(practicas.map((p) => [p.id, new Set(documentosExigidos(p.modalidad as ModalidadPractica))]));
    expect(g.versiones.filter((v) => !tiposPorPractica.get(v.practica)?.has(v.tipo as never))).toHaveLength(0);
    expect(g.versiones.filter((v) => v.decidido !== null && v.decidido < v.cargado)).toHaveLength(0);
  });

  it('reproducible: dos generaciones son idénticas', () => {
    const otra = generar();
    expect(JSON.stringify(otra.practicas)).toBe(JSON.stringify(g.practicas));
    expect(JSON.stringify(otra.versiones.map((v) => [v.id, v.estado, v.cargado]))).toBe(JSON.stringify(g.versiones.map((v) => [v.id, v.estado, v.cargado])));
  });
});
