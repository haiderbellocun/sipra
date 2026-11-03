import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EstadoRegistral } from '../src/domain/entities/documento-empresarial';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { CRITERIOS_DOCUMENTALES } from '../src/domain/entities/criterios-documentales';
import {
  POLITICA_CAMARA_POR_DEFECTO, evaluarCamara, normalizarPoliticaCamara, vigenciaRut,
} from '../src/domain/services/vigencia-documento-empresarial.domain-service';
import { AHORA, datosCamara, datosRutPj, datosRutPn } from './soporte-documento-empresarial';

describe('Vigencia del RUT: indefinida', () => {
  it('la fecha de generación es un dato informativo; una fecha antigua NO vuelve vencido al RUT', () => {
    for (const fecha of ['2015-01-01', '2023-06-06', '2026-08-26', null]) {
      const v = vigenciaRut(datosRutPn({ fechaGeneracion: fecha }));
      expect(v.vigenciaIndefinida).toBe(true);
      expect(v.fechaGeneracion).toBe(fecha);
    }
    expect(vigenciaRut(datosRutPj({ fechaGeneracion: '2019-12-31' })).anioGeneracion).toBe(2019);
  });

  it('una fecha ilegible no inventa un año', () => {
    expect(vigenciaRut({ fechaGeneracion: '31/12/2019' })).toEqual({ vigenciaIndefinida: true, fechaGeneracion: null, anioGeneracion: null });
  });

  it('el resultado no trae ninguna bandera de vencimiento ni de «año en curso»', () => {
    expect(Object.keys(vigenciaRut(datosRutPn())).sort()).toEqual(['anioGeneracion', 'fechaGeneracion', 'vigenciaIndefinida']);
  });
});

describe('Cámara: estado registral, renovación, antigüedad y verificación son ejes separados', () => {
  it('sin política institucional (por defecto) la antigüedad NO bloquea: se informa sin decidir', () => {
    expect(POLITICA_CAMARA_POR_DEFECTO.camaraMaxDiasExpedicion).toBeNull();
    const e = evaluarCamara(datosCamara({ fechaExpedicion: '2023-08-15' }), AHORA);
    expect(e.antiguedad).toEqual({ fechaExpedicion: '2023-08-15', diasDesdeExpedicion: 1176, politicaDias: null, cumplePolitica: null });
  });

  it('con una política configurada, la antigüedad se compara con ESE valor (no con 30, 60, 90 ni 365 fijos)', () => {
    const datos = datosCamara({ fechaExpedicion: '2026-09-10' }); // 54 días antes de AHORA
    expect(evaluarCamara(datos, AHORA, { camaraMaxDiasExpedicion: 54 }).antiguedad.cumplePolitica).toBe(true);
    expect(evaluarCamara(datos, AHORA, { camaraMaxDiasExpedicion: 53 }).antiguedad.cumplePolitica).toBe(false);
    expect(evaluarCamara(datos, AHORA, { camaraMaxDiasExpedicion: 7 }).antiguedad.politicaDias).toBe(7);
  });

  it('la política solo acepta un entero positivo; cualquier otra cosa equivale a «sin política»', () => {
    expect(normalizarPoliticaCamara(45)).toEqual({ camaraMaxDiasExpedicion: 45 });
    expect(normalizarPoliticaCamara('45')).toEqual({ camaraMaxDiasExpedicion: 45 });
    for (const v of [undefined, null, 0, -5, 3.5, 'abc', '', NaN]) expect(normalizarPoliticaCamara(v)).toEqual({ camaraMaxDiasExpedicion: null });
  });

  it('sin fecha de expedición legible, o con una fecha futura, no hay días ni decisión', () => {
    expect(evaluarCamara(datosCamara({ fechaExpedicion: null }), AHORA, { camaraMaxDiasExpedicion: 30 }).antiguedad)
      .toMatchObject({ diasDesdeExpedicion: null, cumplePolitica: null });
    expect(evaluarCamara(datosCamara({ fechaExpedicion: '2027-01-01' }), AHORA, { camaraMaxDiasExpedicion: 30 }).antiguedad)
      .toMatchObject({ diasDesdeExpedicion: null, cumplePolitica: null });
  });

  it('el estado registral NO se deduce del último año renovado: sin estado explícito sigue no_determinable', () => {
    const e = evaluarCamara(datosCamara({ ultimoAnioRenovado: 2026, fechaRenovacion: '2026-03-31' }), AHORA);
    expect(e.estadoRegistral).toBe(EstadoRegistral.NO_DETERMINABLE);
    expect(e.ultimoAnioRenovado).toBe(2026);
    expect(evaluarCamara(datosCamara({ ultimoAnioRenovado: 2019 }), AHORA).estadoRegistral).toBe(EstadoRegistral.NO_DETERMINABLE);
  });

  it('un estado que el documento muestra de forma explícita se conserva', () => {
    expect(evaluarCamara(datosCamara({ estadoRegistral: EstadoRegistral.CANCELADO }), AHORA).estadoRegistral).toBe(EstadoRegistral.CANCELADO);
    expect(evaluarCamara(datosCamara({ estadoRegistral: EstadoRegistral.ACTIVO }), AHORA).estadoRegistral).toBe(EstadoRegistral.ACTIVO);
  });

  it('«verificación disponible hasta» sale de la expedición y de los días que declara el propio certificado, y no es vigencia', () => {
    const e = evaluarCamara(datosCamara({ fechaExpedicion: '2026-09-10', diasVerificacionDocumento: 60 }), AHORA, { camaraMaxDiasExpedicion: 365 });
    expect(e.verificacionDisponibleHasta).toBe('2026-11-09');
    // Aunque la verificación en línea ya haya vencido, la antigüedad y el estado registral no cambian por eso.
    expect(e.estadoRegistral).toBe(EstadoRegistral.NO_DETERMINABLE);
    expect(e.antiguedad.cumplePolitica).toBe(true);
    // Sin la declaración del certificado no se inventa.
    expect(evaluarCamara(datosCamara({ diasVerificacionDocumento: null }), AHORA).verificacionDisponibleHasta).toBeNull();
  });

  it('el resultado no tiene una bandera única «vigente»', () => {
    const e = evaluarCamara(datosCamara(), AHORA) as unknown as Record<string, unknown>;
    expect(Object.keys(e).some((k) => /^vigente$|^vigencia$|^vencido$/i.test(k))).toBe(false);
  });
});

describe('Legado «del año en curso» (documentado; se retira de forma controlada, no aquí)', () => {
  it('sigue vigente en el catálogo antiguo: este bloque NO lo cambió', () => {
    expect(CRITERIOS_DOCUMENTALES[TipoDocumento.RUT_NATURAL]?.delAnoEnCurso).toBe(true);
    expect(CRITERIOS_DOCUMENTALES[TipoDocumento.RUT_JURIDICO]?.delAnoEnCurso).toBe(true);
    expect(CRITERIOS_DOCUMENTALES[TipoDocumento.CAMARA_COMERCIO]?.delAnoEnCurso).toBe(true);
  });

  it('el dominio nuevo está desacoplado: no importa el catálogo antiguo ni la validación de ARL', () => {
    const dominio = join(__dirname, '..', 'src', 'domain');
    const archivos = [
      'entities/documento-empresarial.ts', 'entities/validacion-documento-empresarial.entity.ts',
      'services/clasificacion-documento-empresarial.domain-service.ts', 'services/vigencia-documento-empresarial.domain-service.ts',
      'services/comparacion-documento-empresarial.domain-service.ts', 'services/minimizacion-documento-empresarial.domain-service.ts',
      'services/autenticidad-documento-empresarial.domain-service.ts', 'services/control-nit.domain-service.ts',
      'services/duplicados-documento-empresarial.domain-service.ts',
    ];
    for (const a of archivos) {
      // Sin comentarios: el legado se NOMBRA en la documentación del módulo, pero no se usa en el código.
      const fuente = readFileSync(join(dominio, a), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const imports = fuente.split('\n').filter((l) => /^\s*(import|} from)/.test(l)).join('\n');
      expect(imports).not.toMatch(/criterios-documentales|validacion-arl|conocimiento-documental|solicitud-arl/);
      expect(fuente).not.toMatch(/RUT_NO_VIGENTE|CAMARA_NO_VIGENTE|delAnoEnCurso/);
    }
  });
});
