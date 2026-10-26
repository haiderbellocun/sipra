import { CAMPOS_POR_TIPO, camposDe } from '../src/domain/entities/campos-extraccion';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  ConocimientoDocumentalDomainService,
} from '../src/domain/services/conocimiento-documental.domain-service';

/**
 * La base de conocimiento documental es el «entrenamiento» de la lectura
 * asistida: la instrucción que acompaña a cada documento sale de los mismos
 * datos del dominio que alimentan la lista de chequeo del revisor. Estas
 * pruebas fijan que la instrucción diga lo que el manual dice, que prohíba lo
 * que el diseño prohíbe y que los criterios lleven códigos estables.
 */

const servicio = new ConocimientoDocumentalDomainService();

describe('Base de conocimiento documental · instrucción por tipo', () => {
  const instruccion = servicio.instruccionesPara(TipoDocumento.CERTIFICADO_EPS, new Date('2026-10-09T12:00:00Z'));

  it('incluye las causales de devolución del manual (Sisbén, vigencia de 30 días)', () => {
    expect(instruccion).toContain('Sisbén');
    expect(instruccion).toContain('30 días');
  });

  it('enumera todos los campos a extraer del tipo', () => {
    for (const campo of CAMPOS_POR_TIPO[TipoDocumento.CERTIFICADO_EPS] ?? []) {
      expect(instruccion).toContain(`· ${campo}:`);
    }
    expect(camposDe(TipoDocumento.CERTIFICADO_EPS).length).toBeGreaterThan(0);
  });

  it('trae el catálogo completo de tipos para «tipo_detectado»', () => {
    for (const codigo of Object.values(TipoDocumento)) {
      expect(instruccion).toContain(`· ${codigo}:`);
    }
  });

  it('prohíbe el juicio de autenticidad y la invención de datos', () => {
    expect(instruccion).toContain('NO emitas juicio');
    expect(instruccion).toContain('NO infieras caracteres');
    expect(instruccion).toContain('NO uses conocimiento externo');
  });

  it('fija la fecha de hoy que recibe el modelo', () => {
    expect(instruccion).toContain('Fecha de hoy: 2026-10-09.');
  });

  it('lleva el nombre y el código del documento esperado', () => {
    expect(instruccion).toContain('Certificado de afiliación a EPS');
    expect(instruccion).toContain(`(código "${TipoDocumento.CERTIFICADO_EPS}")`);
  });

  it('para un tipo sin ficha dice que no hay criterios declarados', () => {
    const sinFicha = servicio.instruccionesPara(TipoDocumento.SOPORTE_RELACION_LABORAL);
    expect(sinFicha).toContain('No hay criterios declarados');
    // Sus campos sí se piden: el tipo tiene esquema de extracción aunque no tenga ficha.
    for (const campo of camposDe(TipoDocumento.SOPORTE_RELACION_LABORAL)) {
      expect(sinFicha).toContain(`· ${campo}:`);
    }
  });

  it('para un tipo sin campos pide «campos: []»', () => {
    const sinCampos = servicio.instruccionesPara(TipoDocumento.INFORME_1);
    expect(camposDe(TipoDocumento.INFORME_1)).toHaveLength(0);
    expect(sinCampos).toContain('devuelve "campos": []');
  });
});

describe('Base de conocimiento documental · criterios evaluables', () => {
  it('el certificado de EPS tiene códigos únicos, causales de devolución y vigencia', () => {
    const criterios = servicio.criteriosEvaluables(TipoDocumento.CERTIFICADO_EPS);
    const codigos = criterios.map((c) => c.codigo);

    expect(new Set(codigos).size).toBe(codigos.length);
    expect(criterios.length).toBeGreaterThan(0);

    const noAcepta = criterios.filter((c) => c.codigo.startsWith('NOACEPTA_'));
    expect(noAcepta.length).toBeGreaterThan(0);
    expect(noAcepta.every((c) => c.causalDevolucion)).toBe(true);
    expect(noAcepta.some((c) => c.enunciado.includes('Sisbén'))).toBe(true);

    const vigencia = criterios.find((c) => c.codigo === 'VIGENCIA');
    expect(vigencia).toBeDefined();
    expect(vigencia!.enunciado).toContain('30 días');
    expect(vigencia!.causalDevolucion).toBe(false);

    // Los criterios de aprobación del manual van en orden y con código CRIT_n.
    expect(codigos.slice(0, 3)).toEqual(['CRIT_1', 'CRIT_2', 'CRIT_3']);
  });

  it('el acta de inicio exige firmas y lo declara como causal de devolución', () => {
    const criterios = servicio.criteriosEvaluables(TipoDocumento.ACTA_INICIO);
    const firmas = criterios.find((c) => c.codigo === 'FIRMAS');
    expect(firmas).toBeDefined();
    expect(firmas!.causalDevolucion).toBe(true);
    expect(firmas!.enunciado).toContain('Estudiante');
  });

  it('el RUT exige ser del año en curso', () => {
    const criterios = servicio.criteriosEvaluables(TipoDocumento.RUT_NATURAL);
    expect(criterios.some((c) => c.codigo === 'ANO_EN_CURSO' && c.causalDevolucion)).toBe(true);
  });

  it('un tipo sin ficha no tiene criterios', () => {
    expect(servicio.criteriosEvaluables(TipoDocumento.SOPORTE_RELACION_LABORAL)).toEqual([]);
  });

  it('todos los códigos de todos los tipos son únicos dentro de su tipo', () => {
    for (const tipo of Object.values(TipoDocumento)) {
      const codigos = servicio.criteriosEvaluables(tipo).map((c) => c.codigo);
      expect(new Set(codigos).size).toBe(codigos.length);
    }
  });
});

describe('Base de conocimiento documental · nombres, tokens y cobertura', () => {
  it('nombreDe devuelve un nombre legible aunque el tipo no tenga ficha', () => {
    const nombre = servicio.nombreDe(TipoDocumento.SOPORTE_RELACION_LABORAL);
    expect(nombre).not.toBe(TipoDocumento.SOPORTE_RELACION_LABORAL);
    expect(nombre).toMatch(/relación laboral/i);
  });

  it('ningún tipo del catálogo se queda con su código como nombre', () => {
    for (const { codigo, nombre } of servicio.catalogoTipos()) {
      expect(nombre).not.toBe(codigo);
      expect(nombre.trim().length).toBeGreaterThan(0);
    }
    expect(servicio.catalogoTipos()).toHaveLength(Object.values(TipoDocumento).length);
  });

  it('los ocho entregables de mentoría se numeran', () => {
    expect(servicio.nombreDe(TipoDocumento.ENTREGABLE_MENTORIA_3)).toMatch(/mentoría.*3$/i);
  });

  it('la instrucción del certificado de ARL pesa más de 500 tokens', () => {
    expect(servicio.tokensInstruccionAproximados(TipoDocumento.CERTIFICADO_ARL)).toBeGreaterThan(500);
  });

  it('la estimación de tokens no depende de la fecha de hoy', () => {
    const a = servicio.tokensInstruccionAproximados(TipoDocumento.CERTIFICADO_ARL);
    const b = servicio.tokensInstruccionAproximados(TipoDocumento.CERTIFICADO_ARL);
    expect(a).toBe(b);
  });

  it('tiposConConocimiento incluye fichas sin campos y campos sin ficha', () => {
    const tipos = servicio.tiposConConocimiento();
    // Ficha sin campos de extracción.
    expect(tipos).toContain(TipoDocumento.INFORME_1);
    // Campos de extracción sin ficha.
    expect(tipos).toContain(TipoDocumento.PLANILLA_HORAS);
  });
});
