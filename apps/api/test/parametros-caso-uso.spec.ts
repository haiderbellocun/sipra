import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import {
  ParametroNormativoError, ValorParametroInvalidoError,
} from '../src/domain/entities/parametro.entity';
import {
  ParametroRepositoryPort, SobrescrituraParametro,
} from '../src/domain/ports/out/repositorios.port';

class RepositorioEnMemoria implements ParametroRepositoryPort {
  filas = new Map<string, SobrescrituraParametro>();
  lecturas = 0;
  falla = false;

  async listarSobrescrituras(): Promise<SobrescrituraParametro[]> {
    this.lecturas += 1;
    if (this.falla) throw new Error('base no disponible');
    return [...this.filas.values()];
  }
  async guardar(s: Omit<SobrescrituraParametro, 'actualizadoEn'>): Promise<void> {
    this.filas.set(s.clave, { ...s, actualizadoEn: new Date() });
  }
  async restaurar(clave: string): Promise<void> {
    this.filas.delete(clave);
  }
}

describe('M12 · parámetros en operación', () => {
  let repo: RepositorioEnMemoria;
  let caso: ParametrosUseCase;

  beforeEach(() => {
    repo = new RepositorioEnMemoria();
    caso = new ParametrosUseCase(repo);
  });

  it('sin sobrescritura devuelve el valor de fábrica', async () => {
    expect(await caso.numero('pipeline.umbral_verde')).toBe(85);
  });

  it('un cambio queda vigente de inmediato, sin desplegar nada', async () => {
    await caso.cambiar({
      clave: 'pipeline.umbral_verde', valor: 92,
      motivo: 'Calibración con la muestra del piloto de septiembre', actorId: 'admin-1',
    });
    expect(await caso.numero('pipeline.umbral_verde')).toBe(92);
  });

  it('devuelve el valor anterior y el nuevo, para poder auditarlos', async () => {
    const r = await caso.cambiar({
      clave: 'acompanamiento.dias_sin_actividad', valor: 21,
      motivo: 'La Dirección pidió menos ruido en la bandeja del tutor', actorId: 'admin-1',
    });
    expect(r).toEqual({ anterior: 15, nuevo: 21 });
  });

  it('no consulta la base en cada lectura', async () => {
    await caso.numero('pipeline.umbral_verde');
    await caso.numero('pipeline.umbral_amarillo');
    await caso.numero('auditoria.consultas_por_hora');
    expect(repo.lecturas).toBe(1);
  });

  it('si la base no responde sigue con el último valor conocido', async () => {
    await caso.cambiar({
      clave: 'documentos.tamano_maximo_mb', valor: 25,
      motivo: 'Las fotos de los teléfonos nuevos superan el límite anterior', actorId: 'admin-1',
    });
    expect(await caso.numero('documentos.tamano_maximo_mb')).toBe(25);
    repo.falla = true;
    caso.invalidar();
    expect(await caso.numero('documentos.tamano_maximo_mb')).toBe(25);
  });

  describe('lo que no deja hacer', () => {
    it('no cambia un parámetro que fija la norma', async () => {
      await expect(caso.cambiar({
        clave: 'vacantes.vigencia_maxima_meses', valor: 12,
        motivo: 'Nos gustaría tenerlas publicadas más tiempo', actorId: 'admin-1',
      })).rejects.toThrow(ParametroNormativoError);
    });

    it('no deja que los umbrales del pipeline se crucen', async () => {
      await expect(caso.cambiar({
        clave: 'pipeline.umbral_verde', valor: 50,
        motivo: 'Queremos aprobar más rápido durante el cierre', actorId: 'admin-1',
      })).rejects.toThrow(/revisión humana/);
      // El valor rechazado no quedó guardado.
      expect(await caso.numero('pipeline.umbral_verde')).toBe(85);
    });

    it('tampoco al revés: subir el de revisión por encima del de aprobación', async () => {
      await expect(caso.cambiar({
        clave: 'pipeline.umbral_amarillo', valor: 95,
        motivo: 'Queremos ser más estrictos con lo que pasa solo', actorId: 'admin-1',
      })).rejects.toThrow(ValorParametroInvalidoError);
    });

    it('no guarda un valor fuera de rango', async () => {
      await expect(caso.cambiar({
        clave: 'plan_mejoramiento.dias_plazo', valor: 2,
        motivo: 'Prueba de un plazo muy corto', actorId: 'admin-1',
      })).rejects.toThrow(ValorParametroInvalidoError);
      expect(repo.filas.size).toBe(0);
    });
  });

  it('restaurar devuelve el valor de fábrica y borra la sobrescritura', async () => {
    await caso.cambiar({
      clave: 'plan_mejoramiento.dias_plazo', valor: 28,
      motivo: 'Ampliación a cuatro semanas para reducir la carga del tutor', actorId: 'admin-1',
    });
    expect(await caso.numero('plan_mejoramiento.dias_plazo')).toBe(28);
    const r = await caso.restaurar('plan_mejoramiento.dias_plazo');
    expect(r).toEqual({ anterior: 28, nuevo: 14 });
    expect(repo.filas.size).toBe(0);
  });

  it('el listado distingue lo cambiado de lo que sigue de fábrica', async () => {
    await caso.cambiar({
      clave: 'pipeline.umbral_verde', valor: 90,
      motivo: 'Calibración con la muestra del piloto de septiembre', actorId: 'admin-1',
    });
    const lista = await caso.listar();
    const verde = lista.find((p) => p.clave === 'pipeline.umbral_verde');
    const amarillo = lista.find((p) => p.clave === 'pipeline.umbral_amarillo');
    expect(verde).toMatchObject({ valor: 90, valorPorDefecto: 85, personalizado: true });
    expect(amarillo).toMatchObject({ valor: 60, personalizado: false });
  });

  it('el listado muestra los normativos con su norma, para que se entienda por qué no se tocan', async () => {
    const lista = await caso.listar();
    const arl = lista.find((p) => p.clave === 'arl.exige_afiliacion_previa');
    expect(arl?.naturaleza).toBe('normativo');
    expect(arl?.norma).toContain('Decreto 055 de 2015');
  });
});
