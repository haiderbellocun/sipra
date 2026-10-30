import { analizarActa } from '../src/domain/services/analisis-acta.domain-service';
import { compararActaConSipra, fechaDeActa, modalidadDeTexto } from '../src/domain/services/comparacion-acta.domain-service';
import { clasificarActa } from '../src/domain/services/clasificacion-acta.domain-service';
import { extraerCamposActa } from '../src/domain/services/extraccion-acta.domain-service';
import { CampoComparableActa } from '../src/domain/entities/acta-iniciacion';
import { actaEnBlanco, actaSintetica, sipraSintetico, TEXTO_CERTIFICADO_EPS } from './soporte-acta';

const comparar = (texto: string, cambiosSipra = {}, fuente: 'texto_nativo' | 'ocr' = 'texto_nativo') =>
  analizarActa(texto, fuente, sipraSintetico(cambiosSipra)).comparacion!;
const fila = (c: ReturnType<typeof comparar>, campo: CampoComparableActa) => c.campos.find((f) => f.campo === campo)!;

describe('Acta de iniciación · extracción por etiqueta', () => {
  it('extrae estudiante, práctica, empresa y formato con la etiqueta de dominio', () => {
    const c = extraerCamposActa(actaSintetica(), 'texto_nativo');
    expect(c.nombre_estudiante.valor).toBe('Ana Maria Prueba Sintetica');
    expect(c.documento_estudiante.valor).toBe('C.C. 1.000.000.001');
    expect(c.lugar_expedicion.valor).toBe('Bogota');
    expect(c.direccion_estudiante.valor).toBe('Calle 1 # 2-3');
    expect(c.barrio.valor).toBe('Barrio Ficticio');
    expect(c.telefono_estudiante.valor).toBe('3000000000');
    expect(c.semestre.valor).toBe('7');
    expect(c.programa.valor).toBe('Administracion de Empresas');
    expect(c.empresa.valor).toBe('Empresa Sintetica S.A.S.');
    expect(c.nit.valor).toBe('900.123.456-8');
    expect(c.representante_legal.valor).toBe('Carlos Representante Ficticio');
    expect(c.direccion_practica.valor).toBe('Carrera 4 # 5-6');
    expect(c.ciudad.valor).toBe('Bogota');
    expect(c.departamento.valor).toBe('Cundinamarca');
    expect(c.jefe_inmediato.valor).toBe('Laura Jefe Ficticia');
    expect(c.fecha_inicio.valor).toBe('17/03/2026');
    expect(c.fecha_fin.valor).toBe('17/09/2026');
    expect(c.docente_monitor.valor).toBe('Pedro Monitor Ficticio');
    expect(c.codigo_formato.valor).toBe('DPE-FO03');
    expect(c.version_formato.valor).toBe('00');
    expect(c.fecha_formato.valor).toBe('17/07/2019');
  });

  it('«Documento de Identidad» y «Teléfono» se asignan por el contexto en que aparecen', () => {
    const c = extraerCamposActa(actaSintetica(), 'texto_nativo');
    expect(c.documento_estudiante.valor).toBe('C.C. 1.000.000.001');
    expect(c.documento_representante.valor).toBe('1.000.000.002');
    expect(c.documento_jefe.valor).toBe('1.000.000.003');
    expect(c.telefono_estudiante.valor).toBe('3000000000');
    expect(c.telefono_empresa.valor).toBe('6010000000');
  });

  it('«Tipo de Práctica» y «Modalidad de Práctica» son el mismo campo; «funciones» y «actividades» también', () => {
    for (const etiquetaTipo of ['Tipo de Practica', 'Modalidad de Practica'] as const) {
      for (const rotuloFunciones of ['funciones', 'actividades'] as const) {
        const c = extraerCamposActa(actaSintetica({ etiquetaTipo, rotuloFunciones }), 'texto_nativo');
        expect(c.modalidad_practica.valor).toBe('Contrato de aprendizaje');
        expect(c.funciones.valor).toBe('Apoyo en gestion documental y atencion de solicitudes internas');
      }
    }
  });

  it('tolera etiquetas en mayúsculas, sin tildes y con el valor en el mismo renglón', () => {
    const texto = 'NOMBRE DEL ESTUDIANTE: ANA PRUEBA SINTETICA DOCUMENTO DE IDENTIDAD: 1000000001 LUGAR EXPEDICION: BOGOTA\nEmpresa: ACME SINTETICA NIT: 900123456\nEL ESTUDIANTE MANIFIESTA';
    const c = extraerCamposActa(texto, 'texto_nativo');
    expect(c.nombre_estudiante.valor).toBe('ANA PRUEBA SINTETICA');
    expect(c.documento_estudiante.valor).toBe('1000000001');
    expect(c.empresa.valor).toBe('ACME SINTETICA');
    expect(c.nit.valor).toBe('900123456');
  });

  it('una etiqueta partida en dos líneas se reconoce', () => {
    const texto = 'Nombre del\nEstudiante:\nANA PRUEBA\nDocumento de\nIdentidad:\n1000000001\nEL ESTUDIANTE MANIFIESTA';
    const c = extraerCamposActa(texto, 'texto_nativo');
    expect(c.nombre_estudiante.valor).toBe('ANA PRUEBA');
    expect(c.documento_estudiante.valor).toBe('1000000001');
  });

  it('14 · un formulario en blanco no inventa nada: todo `null`, solo se lee el encabezado del formato', () => {
    const c = extraerCamposActa(actaEnBlanco(), 'texto_nativo');
    const conValor = Object.entries(c).filter(([, v]) => v.valor !== null).map(([k]) => k).sort();
    expect(conValor).toEqual(['codigo_formato', 'fecha_formato', 'version_formato']);
  });

  it('los rellenos «_____» no cuentan como actividades', () => {
    const c = extraerCamposActa(actaSintetica({ rotuloFunciones: 'actividades', valores: { funciones: '____________\n____________' } }), 'texto_nativo');
    expect(c.funciones.valor).toBeNull();
  });

  it('la lectura por OCR tiene menos confianza que la del texto nativo, pero sigue siendo utilizable', () => {
    const nativo = extraerCamposActa(actaSintetica(), 'texto_nativo');
    const ocr = extraerCamposActa(actaSintetica(), 'ocr');
    expect(ocr.nombre_estudiante.confianza).toBeLessThan(nativo.nombre_estudiante.confianza);
    expect(ocr.nombre_estudiante.fuente).toBe('ocr');
    expect(ocr.nombre_estudiante.confianza).toBeGreaterThanOrEqual(0.7);
  });
});

describe('Acta de iniciación · normalización', () => {
  it('fechas: numérica, ISO y larga dentro de un valor más largo', () => {
    expect(fechaDeActa('17/03/2026')).toBe('2026-03-17');
    expect(fechaDeActa('2026-03-17')).toBe('2026-03-17');
    expect(fechaDeActa('17 de marzo de 2026')).toBe('2026-03-17');
    expect(fechaDeActa('desde el 17 / 03 / 2026 hasta')).toBe('2026-03-17');
    expect(fechaDeActa('sin fecha')).toBeNull();
    expect(fechaDeActa('31/02/2026')).toBeNull();
  });

  it('modalidad: reconoce la etiqueta del catálogo con tildes y mayúsculas, y distingue pasantía de pasantía internacional', () => {
    expect(modalidadDeTexto('CONTRATO DE APRENDIZAJE')).toBe('contrato_aprendizaje');
    expect(modalidadDeTexto('Pasantía')).toBe('pasantia');
    expect(modalidadDeTexto('Pasantía internacional')).toBe('pasantia_internacional');
    expect(modalidadDeTexto('Práctica profesional genérica')).toBeNull();
    expect(modalidadDeTexto('')).toBeNull();
  });
});

describe('Acta de iniciación · comparación contra SIPRA', () => {
  it('todo coincide (con diferencias solo de formato) → consistente, sin discrepancias', () => {
    const c = comparar(actaSintetica({ remuneracion: 'no_remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa' }));
    expect(c.campos.filter((f) => ['estudiante', 'documento', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin', 'modalidad', 'remuneracion', 'responsable_arl'].includes(f.campo)).map((f) => f.resultado))
      .toEqual(Array(9).fill('coincide'));
    expect(c.discrepancias).toEqual([]);
    expect(c.veredicto).toBe('consistente');
  });

  it('los campos salen en el orden de la revisión: estudiante, documento, empresa, NIT, fechas, modalidad, remuneración, ARL', () => {
    const c = comparar(actaSintetica());
    expect(c.campos.slice(0, 9).map((f) => f.campo)).toEqual([
      'estudiante', 'documento', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin', 'modalidad', 'remuneracion', 'responsable_arl',
    ]);
  });

  it('11 · empresa o NIT diferente → discrepancia crítica', () => {
    const empresa = comparar(actaSintetica(), { empresaRazonSocial: 'Otra Compañía Distinta SAS' });
    expect(fila(empresa, 'empresa')).toMatchObject({ resultado: 'diferente', criticidad: 'critica' });
    expect(empresa.veredicto).toBe('revision_necesaria');
    const nit = comparar(actaSintetica(), { empresaNit: '800765432-1' });
    expect(fila(nit, 'nit')).toMatchObject({ resultado: 'diferente', criticidad: 'critica' });
    expect(nit.discrepancias.find((d) => d.campo === 'nit')).toMatchObject({ severidad: 'critica' });
  });

  it('el NIT con o sin dígito de verificación, y con puntos, es el mismo NIT', () => {
    expect(fila(comparar(actaSintetica(), { empresaNit: '900123456' }), 'nit').resultado).toBe('coincide');
    expect(fila(comparar(actaSintetica(), { empresaNit: '9001234568' }), 'nit').resultado).toBe('coincide');
    expect(fila(comparar(actaSintetica(), { empresaNit: '900123456-5' }), 'nit').resultado).toBe('diferente');
  });

  it('la razón social se compara sin formas jurídicas ni puntuación (SAS = S.A.S.)', () => {
    expect(fila(comparar(actaSintetica(), { empresaRazonSocial: 'EMPRESA SINTETICA' }), 'empresa').resultado).toBe('coincide');
  });

  it('12 · responsable ARL diferente → crítica y SIPRA no se modifica', () => {
    const c = comparar(actaSintetica({ encabezadoArl: 'empresa', obligacionArl: 'empresa' }), { responsableArlEsperado: 'cun' });
    expect(fila(c, 'responsable_arl')).toMatchObject({ sipra: 'CUN', acta: 'Empresa', resultado: 'diferente', criticidad: 'critica' });
    expect(c.discrepancias.find((d) => d.codigo === 'RESPONSABLE_ARL_DIFERENTE')?.mensaje).toContain('no coincide');
    expect(c.veredicto).toBe('revision_necesaria');
  });

  it('13 · remuneración diferente → crítica', () => {
    const c = comparar(actaSintetica({ remuneracion: 'remunerada' }), { remuneracionEsperada: 'no_remunerada' });
    expect(fila(c, 'remuneracion')).toMatchObject({ sipra: 'No remunerada', acta: 'Remunerada', resultado: 'diferente', criticidad: 'critica' });
  });

  it('estudiante o documento diferentes → críticas', () => {
    const c = comparar(actaSintetica(), { estudianteNombre: 'Persona Totalmente Distinta', estudianteDocumento: '2000000002' });
    expect(fila(c, 'estudiante')).toMatchObject({ resultado: 'diferente', criticidad: 'critica' });
    expect(fila(c, 'documento')).toMatchObject({ resultado: 'diferente', criticidad: 'critica' });
  });

  it('el nombre incompleto del acta es compatible, con nota; no se marca diferente', () => {
    const c = comparar(actaSintetica({ valores: { nombre: 'Ana Prueba' } }), { estudianteNombre: 'Ana Maria Prueba Sintetica' });
    expect(fila(c, 'estudiante').resultado).toBe('coincide');
    expect(fila(c, 'estudiante').nota).toContain('compatibles');
  });

  it('las fechas distintas generan discrepancia visible (alta), no crítica', () => {
    const c = comparar(actaSintetica({ valores: { fin: '30/09/2026' } }));
    expect(fila(c, 'fecha_fin')).toMatchObject({ resultado: 'diferente', criticidad: 'alta' });
    expect(c.discrepancias.find((d) => d.campo === 'fecha_fin')?.severidad).toBe('alta');
    expect(c.veredicto).toBe('revision_necesaria');
  });

  it('la modalidad distinta es discrepancia alta; una modalidad no reconocida es información insuficiente', () => {
    expect(fila(comparar(actaSintetica({ valores: { tipo: 'Pasantía' } })), 'modalidad')).toMatchObject({ resultado: 'diferente', criticidad: 'alta' });
    const rara = fila(comparar(actaSintetica({ valores: { tipo: 'Modalidad inventada' } })), 'modalidad');
    expect(rara.resultado).toBe('informacion_insuficiente');
    expect(rara.nota).toContain('no corresponde');
  });

  describe('14 · un dato ausente nunca coincide', () => {
    it('acta en blanco: todos los campos son información insuficiente y no hay veredicto de consistencia', () => {
      const c = comparar(actaEnBlanco());
      expect(c.campos.filter((f) => f.resultado === 'coincide').map((f) => f.campo)).toEqual(['remuneracion', 'responsable_arl']);
      for (const f of c.campos.filter((x) => !['remuneracion', 'responsable_arl'].includes(x.campo))) {
        expect(f.resultado).toBe('informacion_insuficiente');
        expect(f.acta).toBeNull();
      }
      expect(c.veredicto).toBe('revision_necesaria');
      expect(c.discrepancias.some((d) => d.codigo === 'NIT_NO_VERIFICABLE')).toBe(true);
    });

    it('SIPRA sin el dato → insuficiente, y lo dice', () => {
      const c = comparar(actaSintetica(), { responsableArlEsperado: null, empresaNit: null });
      expect(fila(c, 'responsable_arl').resultado).toBe('informacion_insuficiente');
      expect(fila(c, 'nit').resultado).toBe('informacion_insuficiente');
      expect(c.discrepancias.find((d) => d.codigo === 'NIT_NO_VERIFICABLE')?.mensaje).toContain('SIPRA no tiene');
      expect(c.veredicto).toBe('revision_necesaria');
    });

    it('responsable ARL no determinable en el acta → insuficiente (no «coincide» con nada)', () => {
      const c = comparar(actaSintetica({ encabezadoArl: 'cun', obligacionArl: 'empresa' }), { responsableArlEsperado: 'cun' });
      expect(fila(c, 'responsable_arl').resultado).toBe('informacion_insuficiente');
      expect(c.discrepancias.some((d) => d.codigo === 'ARL_ENCABEZADO_VS_OBLIGACIONES' && d.severidad === 'critica')).toBe(true);
      expect(c.veredicto).toBe('revision_necesaria');
    });

    it('una lectura por debajo de la confianza mínima se trata como no leída', () => {
      const analisis = analizarActa(actaSintetica(), 'texto_nativo', null);
      const campos = { ...analisis.campos, nit: { valor: '900123456-8', confianza: 0.4, fuente: 'ocr' as const } };
      const c = compararActaConSipra({ clasificacion: analisis.clasificacion, campos }, sipraSintetico());
      expect(fila(c, 'nit').resultado).toBe('informacion_insuficiente');
    });
  });

  it('un documento que no es acta no se compara: nada de lo «extraído» cuenta y hay discrepancia crítica', () => {
    const c = comparar(TEXTO_CERTIFICADO_EPS);
    expect(c.campos.every((f) => f.resultado === 'informacion_insuficiente')).toBe(true);
    expect(c.discrepancias[0]).toMatchObject({ campo: 'documento_acta', codigo: 'TIPO_ACTA_NO_CONFIRMADO', severidad: 'critica' });
    expect(c.veredicto).toBe('revision_necesaria');
  });

  it('la comparación no muta ni a SIPRA ni a la clasificación (el acta no establece valores)', () => {
    const sipra = sipraSintetico({ responsableArlEsperado: 'cun' });
    const copia = JSON.stringify(sipra);
    const clasificacion = clasificarActa(actaSintetica({ encabezadoArl: 'empresa', obligacionArl: 'empresa' }));
    const antes = JSON.stringify(clasificacion);
    compararActaConSipra({ clasificacion, campos: extraerCamposActa(actaSintetica(), 'texto_nativo') }, sipra);
    expect(JSON.stringify(sipra)).toBe(copia);
    expect(JSON.stringify(clasificacion)).toBe(antes);
  });

  it('texto OCR degradado: los datos siguen comparándose con la confianza del OCR', () => {
    const c = comparar(actaSintetica(), {}, 'ocr');
    expect(fila(c, 'documento').resultado).toBe('coincide');
    expect(c.veredicto).toBe('consistente');
  });
});
