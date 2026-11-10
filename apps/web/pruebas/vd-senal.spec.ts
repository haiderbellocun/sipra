import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DocumentoDeExpediente, EstadoHumanoDocumento, ProgresoExpediente, ReservaDocumento } from '@core/models/validacion-documental.model';
import {
  ICONO_SENAL, ORDEN_ACCIONES, SENAL, UMBRAL_DESBORDE, abreviarNombre, animacionNodo, cambioAAprobado, chipReserva, construirRail, debeAnimar, duracionTransicion,
  enfasisDecision, fraccionFlujo, indiceActivo, indiceConTecla, modoRail, reservaCorta, resumenProgreso, senalDeDocumento, textoAprobados, tieneCandado, tonoDeClases,
} from '../src/app/features/validacion-documental/vd.senal';
import { textoReservaDocumento } from '../src/app/features/validacion-documental/vd.util';

const LIBRE: ReservaDocumento = { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
const doc = (tipo: string, sobre: Partial<DocumentoDeExpediente> = {}): DocumentoDeExpediente => ({
  documentoId: 'd-' + tipo, practicaId: 'p', estudianteId: 'e', tipoDocumento: tipo, nombreHumano: `Doc ${tipo}`, motor: 'general', version: 1, estadoInterno: null,
  estadoHumano: 'disponible_para_revision', estadoHumanoEtiqueta: 'Disponible para revisión', fechaCarga: null, problemaPrincipal: null, requiereRevision: true, criticidad: 'normal',
  informacionInsuficiente: false, esReenvio: false, versionesAnteriores: 0, reserva: LIBRE, validacionId: null, obligatorio: true, operable: true, puedeTomar: true, puedeDecidir: false, ...sobre,
});
const progreso = (s: Partial<ProgresoExpediente> = {}): ProgresoExpediente => ({
  total: 6, aprobados: 3, pendientesDeCargar: 2, requierenRevision: 1, necesitanCorreccion: 0, procesando: 0, rechazados: 0, errores: 0, completo: false, porcentaje: 50, ...s,
});

describe('Document Signal · estado humano → icono, color, etiqueta y animación', () => {
  const casos: [string, Partial<DocumentoDeExpediente>, keyof typeof SENAL][] = [
    ['aprobado', { estadoHumano: 'aprobado' }, 'aprobado'],
    ['necesita corrección', { estadoHumano: 'necesita_correccion' }, 'correccion'],
    ['rechazado', { estadoHumano: 'rechazado' }, 'rechazado'],
    ['error', { estadoHumano: 'error' }, 'rechazado'],
    ['pendiente de cargar', { estadoHumano: 'pendiente_de_cargar' }, 'pendiente'],
    ['no aplica', { estadoHumano: 'no_aplica' }, 'pendiente'],
    ['procesando', { estadoHumano: 'procesando' }, 'procesando'],
    ['en revisión (reservado)', { estadoHumano: 'en_revision', reserva: { ...LIBRE, estado: 'otro' } }, 'reservado'],
    ['disponible normal', {}, 'disponible'],
    ['disponible con atención', { criticidad: 'atencion' }, 'revision'],
    ['disponible con información insuficiente', { informacionInsuficiente: true }, 'revision'],
    ['disponible crítico', { criticidad: 'critico' }, 'critico'],
    ['en revisión pero crítico: lo crítico gana (el candado se dibuja aparte)', { estadoHumano: 'en_revision', criticidad: 'critico' }, 'critico'],
  ];
  for (const [nombre, sobre, clave] of casos) {
    it(`${nombre} → ${clave}`, () => assert.equal(senalDeDocumento(doc('x', sobre)).clave, clave));
  }

  it('toda señal tiene icono PROPIO (forma), color y etiqueta: el color nunca es el único canal', () => {
    const iconos = new Set<string>();
    for (const s of Object.values(SENAL)) {
      assert.ok(s.token.startsWith('--') && s.tokenTexto.startsWith('--') && s.etiqueta.length > 0 && ICONO_SENAL[s.icono].length > 0, s.clave);
      iconos.add(ICONO_SENAL[s.icono]);
    }
    assert.equal(iconos.size, Object.keys(SENAL).length, 'ningún par de estados comparte forma');
  });

  it('crítico = UN solo pulso inicial y luego estable (glow permanente solo en lo crítico); pendiente = sin glow ni animación', () => {
    assert.equal(SENAL.critico.animacion, 'pulso-unico');
    assert.equal(SENAL.critico.glow, true);
    assert.equal(SENAL.pendiente.animacion, 'ninguna');
    assert.equal(SENAL.pendiente.glow, false);
    for (const s of Object.values(SENAL)) if (s.clave !== 'critico') assert.equal(s.glow, false, s.clave);
  });

  it('animación por estado: aprobado barrido único, revisión y corrección pulso lento, reservado vivo sutil', () => {
    assert.equal(SENAL.aprobado.animacion, 'barrido-unico');
    assert.equal(SENAL.revision.animacion, 'pulso-lento');
    assert.equal(SENAL.correccion.animacion, 'pulso-lento');
    assert.equal(SENAL.reservado.animacion, 'vivo-sutil');
    assert.equal(SENAL.disponible.animacion, 'ninguna');
  });

  it('solo el nodo ACTIVO se anima (un elemento a la vez)', () => {
    assert.equal(animacionNodo(SENAL.revision, { activo: false, reducido: false }), 'ninguna');
    assert.equal(animacionNodo(SENAL.revision, { activo: true, reducido: false }), 'pulso-lento');
  });

  it('con prefers-reduced-motion nada se anima, sea cual sea el estado', () => {
    assert.equal(debeAnimar(true), false);
    assert.equal(debeAnimar(false), true);
    assert.equal(debeAnimar(undefined), true);
    for (const s of Object.values(SENAL)) assert.equal(animacionNodo(s, { activo: true, reducido: true }), 'ninguna', s.clave);
  });

  it('transiciones: devolver 250 ms (220–280), aprobar 350 ms, rechazar 140 ms; el resto 220', () => {
    assert.equal(duracionTransicion('correccion'), 250);
    assert.equal(duracionTransicion('aprobado'), 350);
    assert.equal(duracionTransicion('rechazado'), 140);
    assert.equal(duracionTransicion('revision'), 220);
  });

  it('el barrido de «aprobado» se dispara SOLO al pasar a aprobado (no al cargar ni si ya lo estaba)', () => {
    const antes = new Map([['a', 'disponible' as const], ['b', 'aprobado' as const], ['c', 'revision' as const]]);
    const ahora = new Map([['a', 'aprobado' as const], ['b', 'aprobado' as const], ['c', 'revision' as const]]);
    assert.deepEqual(cambioAAprobado(antes, ahora), ['a']);
    assert.deepEqual(cambioAAprobado(new Map(), ahora), []);
  });

  it('candado cuando alguien tiene el documento (usted u otra persona)', () => {
    assert.equal(tieneCandado({ estado: 'mia' }), true);
    assert.equal(tieneCandado({ estado: 'otro' }), true);
    assert.equal(tieneCandado({ estado: 'libre' }), false);
    assert.equal(tieneCandado({ estado: 'vencida' }), false);
  });
});

describe('Document Signal · generación del rail desde los datos reales', () => {
  const ESTADOS: EstadoHumanoDocumento[] = ['aprobado', 'disponible_para_revision', 'pendiente_de_cargar', 'necesita_correccion', 'en_revision'];
  const lista = (n: number) => Array.from({ length: n }, (_, i) => doc(`t${i}`, { estadoHumano: ESTADOS[i % ESTADOS.length], nombreHumano: `Documento ${i}`, version: i % 2 ? 2 : 1, esReenvio: i === 1 }));
  const rail = (n: number, activo: string | null = 't2') => construirRail(lista(n), activo, (r) => textoReservaDocumento(r));

  it('con 5 documentos: 5 nodos, en el orden recibido, modo lineal', () => {
    const r = rail(5);
    assert.equal(r.length, 5);
    assert.deepEqual(r.map((n) => n.tipo), ['t0', 't1', 't2', 't3', 't4']);
    assert.deepEqual(r.map((n) => n.indice), [0, 1, 2, 3, 4]);
    assert.equal(modoRail(5), 'lineal');
  });

  it('con 15 documentos: 15 nodos y desborde con botones (no se comprime ni se corta)', () => {
    const r = rail(15, 't14');
    assert.equal(r.length, 15);
    assert.equal(modoRail(15), 'desborde');
    assert.equal(modoRail(UMBRAL_DESBORDE), 'lineal');
    assert.equal(modoRail(UMBRAL_DESBORDE + 1), 'desborde');
    assert.equal(indiceActivo(r), 14);
  });

  it('cada nodo trae nombre, estado humano real, versión y reenvío de los datos (nada hardcodeado)', () => {
    const r = rail(5);
    assert.equal(r[1].nombre, 'Documento 1');
    assert.equal(r[1].etiquetaEstado, 'Disponible para revisión');
    assert.equal(r[1].version, 2);
    assert.equal(r[1].reenvio, true);
    assert.equal(r[0].reenvio, false);
    assert.equal(r[2].sinCargar, false);
  });

  it('un documento sin archivo se marca sinCargar y uno no obligatorio, adicional', () => {
    const r = construirRail([doc('a', { documentoId: null, estadoHumano: 'pendiente_de_cargar', obligatorio: false })], 'a', (x) => textoReservaDocumento(x));
    assert.equal(r[0].sinCargar, true);
    assert.equal(r[0].adicional, true);
    assert.equal(r[0].senal.clave, 'pendiente');
  });

  it('un expediente vacío da un rail vacío y el índice activo es 0', () => {
    assert.deepEqual(construirRail([], null, () => ''), []);
    assert.equal(indiceActivo([]), 0);
  });

  it('el reservado muestra candado y la reserva en texto completo y corto', () => {
    const r = construirRail([doc('a', { estadoHumano: 'en_revision', reserva: { estado: 'otro', por: 'Camila Rodríguez', hasta: null, minutosRestantes: 8 } })], 'a', (x) => textoReservaDocumento(x));
    assert.equal(r[0].candado, true);
    assert.equal(r[0].reservaTexto, 'Tomado por Camila Rodríguez · 8 min');
    assert.equal(r[0].reservaCorta, 'Camila R. · 8 min');
    assert.equal(reservaCorta({ estado: 'mia', por: null, minutosRestantes: 12 }), 'Tú · 12 min');
    assert.equal(reservaCorta(LIBRE), null);
  });

  it('flujo e indicador: la fracción va del primer nodo al activo', () => {
    assert.equal(fraccionFlujo(0, 6), 0);
    assert.equal(fraccionFlujo(5, 6), 1);
    assert.equal(fraccionFlujo(0, 1), 0);
    assert.ok(Math.abs(fraccionFlujo(3, 6) - 0.6) < 1e-9);
  });

  it('teclado: flechas, Inicio y Fin se mueven entre nodos sin salirse', () => {
    assert.equal(indiceConTecla('ArrowRight', 0, 5), 1);
    assert.equal(indiceConTecla('ArrowRight', 4, 5), 4);
    assert.equal(indiceConTecla('ArrowLeft', 0, 5), 0);
    assert.equal(indiceConTecla('ArrowLeft', 3, 5), 2);
    assert.equal(indiceConTecla('Home', 3, 5), 0);
    assert.equal(indiceConTecla('End', 1, 5), 4);
    assert.equal(indiceConTecla('Tab', 1, 5), null);
    assert.equal(indiceConTecla('ArrowRight', 0, 0), null);
  });

  it('abreviarNombre', () => {
    assert.equal(abreviarNombre('Camila Rodríguez Pérez'), 'Camila R.');
    assert.equal(abreviarNombre('Hernán'), 'Hernán');
    assert.equal(abreviarNombre(null), 'otra persona');
  });
});

describe('Progreso · texto «X de Y»', () => {
  it('«3 de 6 aprobados»', () => assert.equal(textoAprobados(progreso()), '3 de 6 aprobados'));
  it('resumen: solo lo que tiene valor, con plural correcto', () => {
    assert.deepEqual(resumenProgreso(progreso()), ['1 en revisión', '2 pendientes']);
    assert.deepEqual(resumenProgreso(progreso({ requierenRevision: 2, pendientesDeCargar: 1, necesitanCorreccion: 1 })), ['2 en revisión', '1 pendiente', '1 devuelto']);
    assert.deepEqual(resumenProgreso(progreso({ requierenRevision: 0, pendientesDeCargar: 0, aprobados: 6 })), []);
  });
});

describe('Barra de decisión · jerarquía y orden fijo', () => {
  it('orden FIJO: Rechazar | Devolver | Aprobar, sea cual sea la recomendación', () => {
    assert.deepEqual([...ORDEN_ACCIONES], ['rechazar', 'devolver', 'aprobar']);
  });
  it('con discrepancia o revisión (peligro/aviso): Devolver primario; consistente (ok): Aprobar primario', () => {
    assert.equal(enfasisDecision('peligro'), 'devolver');
    assert.equal(enfasisDecision('aviso'), 'devolver');
    assert.equal(enfasisDecision('ok'), 'aprobar');
  });
  it('sin recomendación clara se conserva Aprobar; Rechazar nunca es primario', () => {
    for (const t of ['info', 'neutra', null, undefined, '']) assert.equal(enfasisDecision(t), 'aprobar');
    for (const t of ['ok', 'aviso', 'peligro', 'info', null]) assert.notEqual(enfasisDecision(t) as string, 'rechazar');
  });
  it('el tono se lee de la clase rec--<tono> que ya pinta el motor', () => {
    assert.equal(tonoDeClases('rec rec--peligro ng-star'), 'peligro');
    assert.equal(tonoDeClases('rec rec--ok'), 'ok');
    assert.equal(tonoDeClases('rec'), null);
    assert.equal(tonoDeClases(null), null);
  });
});

describe('Encabezado · chip de reserva', () => {
  it('tuya, ajena, vencida y libre', () => {
    assert.deepEqual(chipReserva({ estado: 'mia', por: null, minutosRestantes: 12 }), { texto: 'Tu reserva · 12 min', tono: 'mia' });
    assert.deepEqual(chipReserva({ estado: 'otro', por: 'Camila Rodríguez', minutosRestantes: 8 }), { texto: 'Reservado · Camila R. · 8 min', tono: 'otro' });
    assert.equal(chipReserva({ estado: 'vencida', por: null, minutosRestantes: null })?.tono, 'vencida');
    assert.equal(chipReserva(LIBRE), null);
    assert.equal(chipReserva(null), null);
  });
});
