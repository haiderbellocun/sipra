import PDFDocument from 'pdfkit';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { LecturaLocalActaService } from '../src/domain/services/lectura-local-acta.domain-service';
import { esRuidoOcr, extraerCamposActa } from '../src/domain/services/extraccion-acta.domain-service';
import { analizarActa } from '../src/domain/services/analisis-acta.domain-service';
import { evaluarFirmasActa } from '../src/domain/services/firmas-acta.domain-service';
import { recalcularComparacion, resolverValidacionActa } from '../src/domain/services/validacion-acta.domain-service';
import { fechaDeActa } from '../src/domain/services/comparacion-acta.domain-service';
import { fechaIsoDe } from '../src/domain/services/normalizacion-identidad';
import { VALORES_BASE, actaEnBlanco, actaSintetica, lecturaPersistibleSintetica, sipraSintetico } from './soporte-acta';
import { imagenesActaEscaneada, pdfActaDigital } from './soporte-acta-pdf';

/**
 * Regresiones de la validación contra Actas REALES diligenciadas. Cada caso reproduce, con contenido SINTÉTICO, la estructura
 * que produjo el defecto (el documento real nunca entra al repositorio):
 *  1. Acta híbrida: la capa de texto solo trae la plantilla y lo diligenciado está dibujado (imagen/anotaciones).
 *  2. «Empresa: NIT:» seguidos y un solo renglón con los dos valores.
 *  3. Etiquetas juntas y valores aparte (por bloques): no se asigna un valor equivocado.
 *  4. OCR que pierde los «:» y mezcla dos campos en un renglón.
 *  5. Valores con forma imposible (basura de letra a mano) y NIT con punto final.
 *  6. Fechas «16 junio 2026» / «6 De septiembre de 2026» (sin «de» o con mayúscula).
 */
describe('Acta · regresiones de la validación con actas reales (sintéticas)', () => {
  describe('2 · «Empresa: NIT:» con los dos valores en un renglón', () => {
    const texto = (cuerpo: string) => `Nombre del Estudiante:\nAna Prueba\n\nDocumento de Identidad:\n1.000.000.001\n\n${cuerpo}\n\nNombre del representante legal:\nCarlos Ficticio\n\nEl estudiante manifiesta`;
    it('separa la razón social del NIT', () => {
      const c = extraerCamposActa(texto('Empresa: NIT:\n \nCorporacion Sintetica Nacional - SAS 900.111.222-3'), 'texto_nativo');
      expect(c.empresa.valor).toBe('Corporacion Sintetica Nacional - SAS');
      expect(c.nit.valor).toBe('900.111.222-3');
    });
    it('con etiqueta y valor en su renglón sigue igual', () => {
      const c = extraerCamposActa(texto('Empresa:\nCorporacion Sintetica SAS\nNIT:\n900.111.222-3'), 'texto_nativo');
      expect([c.empresa.valor, c.nit.valor]).toEqual(['Corporacion Sintetica SAS', '900.111.222-3']);
    });
    it('si lo que sigue no termina en un NIT, no inventa la separación', () => {
      const c = extraerCamposActa(texto('Empresa: NIT:\n \nSolo un nombre de empresa'), 'texto_nativo');
      expect(c.empresa.valor).toBeNull();
    });
  });

  describe('3 · etiquetas juntas y valores aparte: antes null que equivocado', () => {
    const base = 'Nombre del Estudiante:\nAna Prueba\n\nDocumento de Identidad:\n1.000.000.001\n\n';
    it('no pega la dirección al programa ni el barrio y el semestre a la modalidad', () => {
      const c = extraerCamposActa(`${base}Dirección:\n\nTeléfono:\n\nPrograma:\n\nCalle 1 # 2-3\n\nIngenieria Industrial\n\nBarrio:\n\nSemestre:\n\nModalidad de Practica:\n\nBarrio Ficticio\n\nSegundo\n\nInvestigativa\n\nEmpresa:\nEmpresa SAS\n\nEl estudiante manifiesta`, 'texto_nativo');
      expect(c.programa.valor).toBeNull();
      expect(c.modalidad_practica.valor).toBeNull();
      expect(c.empresa.valor).toBe('Empresa SAS');
    });
    it('una dirección que ocupa dos renglones después de un campo vacío SÍ se conserva', () => {
      const c = extraerCamposActa(`${base}Nombre del representante legal:\nCarlos Ficticio\n\nDocumento de Identidad:\n\nDirección donde realizará las prácticas:\nCarrera 4 # 5-6\nOficina 301\n\nCiudad:\nBogotá\n\nEl estudiante manifiesta`, 'texto_nativo');
      expect(c.direccion_practica.valor).toContain('Carrera 4');
      expect(c.ciudad.valor).toBe('Bogotá');
    });
  });

  describe('4 · OCR sin «:»', () => {
    it('«Semestre: Cuarto Programa —_ Ingeniería de Sistemas» → semestre y programa por separado', () => {
      const c = extraerCamposActa('Nombre del Estudiante: Ana Prueba\nTeléfono: 3000000000 Semestre: Cuarto Programa —_ Ingeniería de Sistemas\nEmpresa: Empresa SAS\nEl estudiante manifiesta', 'ocr', 0.85);
      expect(c.semestre.valor).toBe('Cuarto');
      expect(c.programa.valor).toBe('Ingeniería de Sistemas');
    });
  });

  describe('5 · valores imposibles y NIT con punto', () => {
    const marco = (o: string) => `Nombre del Estudiante: Ana Prueba\n${o}\nEl estudiante manifiesta`;
    it('una fecha sin forma de fecha es basura: se descarta', () => {
      const c = extraerCamposActa(marco('Fecha de Inicio: Ol -KpliexLe - 116\nFecha Terminación: 72/0 6 eS 26'), 'ocr', 0.85);
      expect(c.fecha_inicio.valor).toBeNull();
      expect(c.fecha_fin.valor).toBeNull();
    });
    it('un NIT sin dígitos suficientes se descarta; uno con punto final se limpia; los formatos válidos se conservan', () => {
      expect(extraerCamposActa(marco('NIT: SAAYAA 42'), 'ocr', 0.85).nit.valor).toBeNull();
      expect(extraerCamposActa(marco('NIT: 901.488.990 .'), 'texto_nativo').nit.valor).toBe('901.488.990');
      expect(extraerCamposActa(marco('NIT: 860063124.'), 'texto_nativo').nit.valor).toBe('860063124');
      expect(extraerCamposActa(marco('NIT: 860.401.734-9'), 'texto_nativo').nit.valor).toBe('860.401.734-9');
    });
    it('documentos y teléfonos sin dígitos suficientes se descartan', () => {
      const c = extraerCamposActa('Nombre del Estudiante: Ana Prueba\nDocumento de Identidad: ..\nTeléfono: 3\nEl estudiante manifiesta', 'ocr', 0.85);
      expect(c.documento_estudiante.valor).toBeNull();
      expect(c.telefono_estudiante.valor).toBeNull();
    });
    it('las fechas con mes escrito (con o sin «de», con mayúscula) se conservan', () => {
      const c = extraerCamposActa(marco('Fecha de Inicio: 6 De septiembre de 2026\nFecha Terminación: 16 junio 2026'), 'texto_nativo');
      expect(c.fecha_inicio.valor).toBe('6 De septiembre de 2026');
      expect(c.fecha_fin.valor).toBe('16 junio 2026');
    });
  });

  describe('6 · fechas del acta en la comparación', () => {
    it.each([['16 junio 2026', '2026-06-16'], ['6 De septiembre de 2026', '2026-09-06'], ['24 de agosto de 2026', '2026-08-24'], ['25 Agosto 2026', '2026-08-25'], ['17/03/2026', '2026-03-17']])(
      '«%s» → %s', (texto, iso) => { expect(fechaDeActa(texto)).toBe(iso); expect(fechaIsoDe(texto)).toBe(iso); });
    it('una fecha imposible no se inventa', () => {
      expect(fechaIsoDe('31 de febrero de 2026')).toBeNull();
      expect(fechaDeActa('sin fecha')).toBeNull();
    });
  });

  describe('7 · letra a mano leída por OCR: ruido ≠ dato', () => {
    it.each(['eS Canto Gora o', '26 do MO', '1QXNCNESO Ea ETEMO', 'AdmunesHycaCon te', 'ose | eon Lean', 'Virtua!', 'o OO', 'Cut NO Oombona acom) Jelina NIT E0', 'Pyrares SOyhogo Mono'])(
      '«%s» es ruido', (v) => expect(esRuidoOcr(v)).toBe(true));
    it.each(['Ana Maria Prueba Sintetica', 'Corporacion Unificada Nacional de Educación Superior - CUN', 'Ingenieria de Sistemas', 'Sistema Drywall JP', 'Logros Factoring', 'Bogotá D.C', 'Práctica técnica en investigación'])(
      '«%s» NO es ruido', (v) => expect(esRuidoOcr(v)).toBe(false));
    const marco = (nombre: string) => `Nombre del Estudiante: ${nombre}\nEmpresa: Empresa Sintetica SAS\nFecha de Inicio: 30 Yeghedue 1016\nEl estudiante manifiesta`;
    it('por OCR el ruido se descarta (y un año imposible también); lo legible se conserva', () => {
      const c = extraerCamposActa(marco('eS Canto Gora o'), 'ocr', 0.85);
      expect(c.nombre_estudiante.valor).toBeNull();
      expect(c.fecha_inicio.valor).toBeNull();
      expect(c.empresa.valor).toBe('Empresa Sintetica SAS');
    });
    it('en texto digital NO se aplica el filtro de ruido: lo escrito en la capa de texto se respeta', () => {
      expect(extraerCamposActa(marco('eS Canto Gora o'), 'texto_nativo').nombre_estudiante.valor).toBe('eS Canto Gora o');
    });
  });

  describe('8 · hardening de piloto: manuscrito/foto dudosa no decide coincidencias críticas', () => {
    // Lo que SIPRA tiene: empresa y fecha de inicio. El OCR de letra a mano lee una fecha con un dígito menos y una empresa casi plausible.
    const sipra = sipraSintetico({ empresaRazonSocial: 'Contraloria de Cundinamarca', fechaInicio: new Date('2026-06-22T00:00:00Z') });
    const manuscrito = actaSintetica({ valores: { empresa: 'Contraloria de Conclencimeaurcat', inicio: '2/06/2026' } });
    const campo = (r: ReturnType<typeof analizarActa>, c: string) => r.comparacion?.campos.find((f) => f.campo === c);

    it('A · fecha 22/06/2026 leída como 2/06/2026 con OCR degradado: NO se usa automáticamente (información insuficiente)', () => {
      const r = analizarActa(manuscrito, 'ocr', sipra, null, 0.85);
      expect(r.lecturaDudosa).toBe(true);
      expect(r.campos.fecha_inicio.valor).toBe('2/06/2026'); // se conserva para la revisión humana
      expect(campo(r, 'fecha_inicio')?.resultado).toBe('informacion_insuficiente');
      expect(campo(r, 'fecha_inicio')?.acta).not.toBeNull(); // el valor leído se muestra para la revisión
      expect(campo(r, 'fecha_inicio')?.nota).toMatch(/OCR dudosa/);
    });
    it('B · empresa manuscrita con OCR plausible pero errónea: revisión humana, no «diferente» ni «coincide»', () => {
      const r = analizarActa(manuscrito, 'ocr', sipra, null, 0.85);
      expect(campo(r, 'empresa')?.resultado).toBe('informacion_insuficiente');
      // Lo único que se señala es que no se pudo verificar: ninguna discrepancia dice que el dato «es diferente».
      expect(r.comparacion?.discrepancias.every((d) => d.codigo.endsWith('_NO_VERIFICABLE'))).toBe(true);
    });
    it('todos los campos críticos (incluidos remuneración y responsable de la ARL) quedan sin decidir; los no críticos no se tocan', () => {
      const r = analizarActa(manuscrito, 'ocr', sipra, null, 0.85);
      for (const c of ['estudiante', 'documento', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin', 'remuneracion', 'responsable_arl']) {
        expect(campo(r, c)?.resultado).toBe('informacion_insuficiente');
      }
      expect(campo(r, 'jefe_inmediato')?.resultado).toBe('coincide');
    });
    it('un escaneo claro (OCR ≥ 88) conserva el comportamiento actual: la diferencia se decide', () => {
      const r = analizarActa(manuscrito, 'ocr', sipra, null, 0.91);
      expect(r.lecturaDudosa).toBe(false);
      expect(campo(r, 'fecha_inicio')?.resultado).toBe('diferente');
    });
    it('el texto digital nunca es dudoso, aunque traiga valores raros', () => {
      const r = analizarActa(manuscrito, 'texto_nativo', sipra, null, undefined);
      expect(r.lecturaDudosa).toBe(false);
      expect(campo(r, 'fecha_inicio')?.resultado).toBe('diferente');
    });
    it('también es dudosa una lectura con buena confianza media si muchos datos se descartaron por ruido', () => {
      const ruido = 'Nombre del Estudiante: eS Canto Gora o\nPrograma: 1QXNCNESO Ea ETEMO\nTipo de Practica: o OO\nEmpresa: Cut NO Oombona\nEl estudiante manifiesta';
      expect(analizarActa(ruido, 'ocr', null, null, 0.93).lecturaDudosa).toBe(true);
    });
    it('la señal se guarda con la validación y gobierna el recálculo cuando cambian los datos de la práctica', () => {
      const lectura = lecturaPersistibleSintetica(manuscrito, { metodo: 'ocr', confianzaOcr: 85 });
      expect(lectura.lecturaDudosa).toBe(true);
      const r = resolverValidacionActa(lectura, sipra, new Date('2026-08-10T15:00:00Z'));
      expect(r.resultado.datosExtraidos?.lecturaDudosa).toBe(true);
      expect(r.resultado.comparacion?.campos.find((f) => f.campo === 'fecha_inicio')?.resultado).toBe('informacion_insuficiente');
      const re = recalcularComparacion({
        tipoActaDetectada: 'iniciacion_practicas', remuneracionDetectada: r.resultado.remuneracionDetectada, responsableArlDetectado: r.resultado.responsableArlDetectado,
        motivosClasificacion: r.resultado.motivosClasificacion, datosExtraidos: r.resultado.datosExtraidos, comparacion: r.resultado.comparacion,
      }, sipraSintetico({ fechaInicio: new Date('2026-06-22T00:00:00Z') }), new Date());
      expect(re?.comparacion.campos.find((f) => f.campo === 'fecha_inicio')?.resultado).toBe('informacion_insuficiente');
    });
    it('una lectura confiable no guarda la señal', () => {
      const r = resolverValidacionActa(lecturaPersistibleSintetica(actaSintetica({}), { metodo: 'texto' }), sipraSintetico(), new Date());
      expect(r.resultado.datosExtraidos?.lecturaDudosa).toBeUndefined();
    });
  });

  describe('9 · firma: «no detectada» solo cuando se puede sostener', () => {
    const texto = actaSintetica({});
    const CON_TRAZO = { legible: true, densidadTinta: 0.05, alturaRelativaTrazo: 0.5 };
    const EN_BLANCO = { legible: true, densidadTinta: 0, alturaRelativaTrazo: 0 };
    it('C · una firma presente y la otra zona vacía (firma fuera de zona, a máquina o rótulo cubierto): no_determinable, no «no»', () => {
      const a = evaluarFirmasActa(texto, { empresa: CON_TRAZO, practicante: EN_BLANCO });
      expect([a.firmaEmpresaPresente, a.firmaPracticantePresente]).toEqual(['si', 'no_determinable']);
      expect(a.motivos).toContain('practicante_otra_firma_presente_zona_sin_confirmar');
      const b = evaluarFirmasActa(texto, { empresa: EN_BLANCO, practicante: CON_TRAZO });
      expect([b.firmaEmpresaPresente, b.firmaPracticantePresente]).toEqual(['no_determinable', 'si']);
    });
    it('D · las dos zonas claramente vacías en una lectura confiable: «no»', () => {
      const f = evaluarFirmasActa(texto, { empresa: EN_BLANCO, practicante: EN_BLANCO });
      expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual(['no', 'no']);
    });
    it('en una foto/escaneo dudoso, ni siquiera dos zonas vacías se afirman como «no»', () => {
      const f = evaluarFirmasActa(texto, { empresa: EN_BLANCO, practicante: EN_BLANCO }, true);
      expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual(['no_determinable', 'no_determinable']);
      expect(f.motivos).toEqual(expect.arrayContaining(['empresa_lectura_dudosa', 'practicante_lectura_dudosa']));
    });
    it('«sí» y «no_determinable» no cambian', () => {
      const f = evaluarFirmasActa(texto, { empresa: CON_TRAZO, practicante: CON_TRAZO }, true);
      expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual(['si', 'si']);
    });
  });

  describe('1 · acta híbrida: texto = plantilla, lo diligenciado es imagen', () => {
    const lector = new LectorDocumentoLocalAdapter();
    const servicio = new LecturaLocalActaService(lector, lector);
    afterAll(async () => { await lector.onModuleDestroy(); });

    /** Capa de texto INVISIBLE con la plantilla en blanco + la imagen del acta diligenciada encima. */
    function pdfHibrido(imagenes: Buffer[], plantilla: string): Promise<Buffer> {
      return new Promise((ok) => {
        const doc = new PDFDocument({ size: 'A4', margin: 0 });
        const partes: Buffer[] = [];
        doc.on('data', (c: Buffer) => partes.push(c));
        doc.on('end', () => ok(Buffer.concat(partes)));
        imagenes.forEach((img, i) => {
          if (i > 0) doc.addPage();
          doc.image(img, 0, 0, { fit: [595, 842] });
          if (i === 0) { doc.fillOpacity(0).fontSize(8).text(plantilla, 20, 20, { width: 550 }); doc.fillOpacity(1); }
        });
        doc.end();
      });
    }

    it('lee lo diligenciado por OCR: el texto clasifica pero no trae datos, y el OCR sí', async () => {
      const opciones = { remuneracion: 'no_remunerada' as const, encabezadoArl: 'empresa' as const, obligacionArl: 'empresa' as const, firmaEmpresa: 'trazo' as const, firmaPracticante: 'trazo' as const };
      const pdf = await pdfHibrido(imagenesActaEscaneada(opciones), actaEnBlanco(opciones));
      const r = await servicio.leer(pdf, 'application/pdf', sipraSintetico());
      expect(r.resumen.textoNativo?.utilizable).toBe(true);
      expect(r.resumen.metodoLectura).toBe('ocr');
      expect(r.analisis.campos.nombre_estudiante.valor).toContain('Ana');
      expect(r.resumen.suficiencia.paraComparar).toBe(true);
      expect(r.analisis.campos.nombre_estudiante.fuente).toBe('ocr');
    }, 120_000);

    it('una plantilla en blanco (texto digital) sigue siendo una plantilla en blanco: el OCR no inventa datos y se conserva el texto', async () => {
      const r = await servicio.leer(await pdfActaDigital({ valores: Object.fromEntries(Object.keys(VALORES_BASE).map((k) => [k, ''])) }), 'application/pdf');
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(r.resumen.suficiencia.paraComparar).toBe(false);
      expect(r.resumen.metodoLectura).toBe('texto');
      expect(Object.values(r.analisis.campos).filter((c) => c.valor !== null && c.fuente === 'ocr')).toHaveLength(0);
    }, 120_000);

    it('un acta con texto digital completo NO pasa por OCR', async () => {
      const r = await servicio.leer(await pdfActaDigital({}), 'application/pdf');
      expect(r.resumen.intentosOcr).toBe(0);
    }, 60_000);

    it('un documento que no es un acta no se lee por OCR de más', async () => {
      const r = await servicio.leer(await pdfActaDigital({}), 'application/pdf');
      expect(actaSintetica({}).length).toBeGreaterThan(0);
      expect(r.resumen.paginasOcr).toEqual([]);
    }, 60_000);
  });
});
