import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CargueEstudiante } from '@core/models/modelos';
import {
  ROTULO_ESTADO_CARGUE, avisoFechaPasada, bannerCargue, estudiantePuedeCargarTipo, fechaCorta, fechaLarga, hoyColombiaIso, motivoBloqueo,
  problemaVentana, subsanacionDe, sugerenciaVentana,
} from '@shared/utils/cargue-estudiante';

// G2 · la interfaz MUESTRA el estado que calcula el servidor; no recalcula reglas de ventana.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const plantillaDe = (texto: string) => /template: `([\s\S]*?)`,\n\}\)/.exec(texto)?.[1] ?? '';
const exp = plantillaDe(src('features', 'practicas', 'expediente.component.ts'));
const per = plantillaDe(src('features', 'gestion', 'periodos.component.ts'));

const proy = (o: Partial<CargueEstudiante>): CargueEstudiante => ({
  permitido: false, estado: 'abierto', desde: '2027-02-01', hasta: '2027-05-30', mensaje: 'm', subsanaciones: [], ...o,
});

describe('G2 · expediente del estudiante: banner por estado', () => {
  it('abierto: «Cargue habilitado» y la fecha límite', () => {
    const b = bannerCargue(proy({ permitido: true, estado: 'abierto' }));
    assert.equal(b.titulo, 'Cargue habilitado');
    assert.equal(b.detalle, 'Puedes cargar documentos hasta el 30 de mayo de 2027.');
    assert.equal(b.tono, 'ok');
  });

  it('aún no abre: «Cargue disponible próximamente» con ambas fechas', () => {
    const b = bannerCargue(proy({ estado: 'aun_no_abre' }));
    assert.equal(b.titulo, 'Cargue disponible próximamente');
    assert.equal(b.detalle, 'Podrás cargar documentos del 1 de febrero de 2027 al 30 de mayo de 2027.');
  });

  it('cerrado: «Cargue cerrado», la fecha de fin y que puede consultar lo existente', () => {
    const b = bannerCargue(proy({ estado: 'cerrado_por_fecha' }));
    assert.equal(b.titulo, 'Cargue cerrado');
    assert.match(b.detalle, /finalizó el 30 de mayo de 2027/);
    assert.match(b.detalle, /Puedes consultar tus documentos existentes/);
  });

  it('inhabilitado: decisión operativa, no «error»', () => {
    const b = bannerCargue(proy({ estado: 'inhabilitado' }));
    assert.equal(b.titulo, 'Cargue temporalmente inhabilitado');
    assert.equal(b.detalle, 'El Área de Prácticas ha restringido el cargue para este período.');
    for (const estado of Object.keys(ROTULO_ESTADO_CARGUE)) {
      assert.doesNotMatch(bannerCargue(proy({ estado: estado as CargueEstudiante['estado'] })).titulo + bannerCargue(proy({ estado: estado as CargueEstudiante['estado'] })).detalle, /error/i);
    }
  });

  it('sin proyección: falla cerrada con mensaje operativo', () => {
    assert.equal(bannerCargue(null).titulo, 'Cargue no disponible');
    assert.equal(estudiantePuedeCargarTipo(null, 'rut_natural'), false);
  });

  it('tooltip de los botones deshabilitados', () => {
    assert.equal(motivoBloqueo(proy({ estado: 'aun_no_abre' })), 'El período de cargue aún no inicia.');
    assert.equal(motivoBloqueo(proy({ estado: 'cerrado_por_fecha' })), 'El período de cargue finalizó.');
  });
});

describe('G2 · subsanación: solo sobre el documento correspondiente', () => {
  const cerrado = proy({ estado: 'cerrado_por_fecha', subsanaciones: [{ tipo: 'rut_natural', vence: '2027-06-08', origen: 'devolucion' }] });
  it('RUT habilitado hasta su fecha; EPS sigue bloqueado', () => {
    assert.equal(estudiantePuedeCargarTipo(cerrado, 'rut_natural'), true);
    assert.equal(estudiantePuedeCargarTipo(cerrado, 'certificado_eps'), false);
    assert.deepEqual(subsanacionDe(cerrado, 'rut_natural'), { tipo: 'rut_natural', vence: '2027-06-08', origen: 'devolucion' });
    assert.equal(subsanacionDe(cerrado, 'certificado_eps'), null);
    assert.equal(fechaLarga('2027-06-08'), '8 de junio de 2027');
  });
  it('el expediente muestra «Corrección habilitada hasta» solo dentro del bloque de devolución de ese documento', () => {
    assert.ok(exp.includes('@if (subsanacion(d.tipo); as sub) { <p class="subsana"><span class="rotulo">Corrección habilitada hasta:</span> {{ larga(sub.vence) }}</p> }'));
  });
});

describe('G2 · expediente: botones y zona deshabilitados (no ocultos), mensajes asociados', () => {
  it('«Cargar» y «Subir nueva versión» se deshabilitan por tipo, con tooltip y aria-describedby', () => {
    assert.ok(exp.includes('[disabled]="!puedeCargarTipo(d.tipo)" [attr.title]="puedeCargarTipo(d.tipo) ? null : bloqueo()" [attr.aria-describedby]="puedeCargarTipo(d.tipo) ? null : \'cargue-estado\'" (click)="tipoSeleccionado.set(d.tipo)">Cargar</button>'));
    assert.ok(exp.includes('(click)="corregir(d.tipo)">Subir nueva versión</button>'));
    assert.match(exp, /\[disabled\]="!puedeCargarTipo\(d\.tipo\)"[^>]*\(click\)="corregir\(d\.tipo\)">Subir nueva versión/);
  });
  it('la zona de carga queda deshabilitada (aria-disabled) con el motivo asociado', () => {
    assert.ok(exp.includes('[disabled]="zonaBloqueada()" [attr.aria-disabled]="zonaBloqueada()" [attr.aria-describedby]="zonaBloqueada() ? \'zona-bloqueo\' : null"'));
  });
  it('los motores del estudiante (Acta, RUT, Cámara) reciben el permiso POR TIPO', () => {
    assert.ok(exp.includes('[puedeCargar]="puedeCargarTipo(\'acta_inicio\')"'));
    assert.equal((exp.match(/\[puedeCargar\]="puedeCargarTipo\(d\.tipo\)"/g) ?? []).length, 2);
  });
  it('los documentos ya cargados se siguen mostrando (no se ocultan con el cargue cerrado)', () => {
    assert.ok(exp.includes('@if (ultimoDe(d.tipo); as ult) {'));
  });
});

describe('G2 · gestión de periodos', () => {
  it('fechas compactas y rótulos de estado (no dependen solo del color)', () => {
    assert.equal(fechaCorta('2027-02-01'), '1 feb');
    assert.equal(fechaCorta('2027-06-30', true), '30 jun 2027');
    assert.deepEqual(
      [ROTULO_ESTADO_CARGUE.abierto, ROTULO_ESTADO_CARGUE.aun_no_abre, ROTULO_ESTADO_CARGUE.cerrado_por_fecha, ROTULO_ESTADO_CARGUE.inhabilitado],
      ['Abierto', 'Programado', 'Cerrado', 'Inhabilitado'],
    );
  });

  it('la sugerencia es visible y editable: inicio → dos semanas antes del cierre', () => {
    assert.deepEqual(sugerenciaVentana('2027-01-20', '2027-06-30'), { desde: '2027-01-20', hasta: '2027-06-16' });
    assert.equal(sugerenciaVentana('2027-06-30', '2027-01-20'), null);
  });

  it('validación previa: «hasta» < «desde» y fuera del periodo', () => {
    assert.match(problemaVentana('2027-05-30', '2027-02-01', '2027-01-20', '2027-06-30') ?? '', /anterior a «desde»/);
    assert.match(problemaVentana('2027-01-02', '2027-02-01', '2027-01-20', '2027-06-30') ?? '', /dentro de las fechas del periodo/);
    assert.equal(problemaVentana('2027-02-01', '2027-05-30', '2027-01-20', '2027-06-30'), null);
  });

  it('aviso previo de una fecha ya pasada (día de Colombia)', () => {
    const ahora = new Date('2027-03-10T17:00:00Z');
    assert.equal(hoyColombiaIso(new Date('2027-03-11T03:00:00Z')), '2027-03-10'); // 10 p. m. en Colombia
    assert.equal(avisoFechaPasada('2027-03-01', ahora), 'Esta fecha ya pasó. Al guardar, el cargue quedará cerrado inmediatamente.');
    assert.equal(avisoFechaPasada('2027-03-10', ahora), null);
  });

  it('switch con etiqueta real, role="switch", confirmación al inhabilitar y «Guardar ventana de cargue»', () => {
    assert.match(per, /<label class="interruptor">\s*<input type="checkbox" role="switch"/);
    assert.ok(per.includes('Cargue de estudiantes'));
    assert.ok(per.includes('(change)="alternarCargue(p, $event)"'));
    assert.ok(per.includes('>Guardar ventana de cargue</button>'));
    assert.ok(per.includes('<legend>Cargue de documentos del estudiante</legend>'));
    assert.ok(!per.includes('cargue_estudiante'), 'el Director no ve el término interno TipoVentana.CARGUE_ESTUDIANTE');
  });

  it('resumen compacto: estado del periodo, cargue y ventana', () => {
    for (const t of ['Estado del periodo', 'Cargue estudiante', 'Ventana']) assert.ok(per.includes(`<dt>${t}</dt>`), t);
  });

  it('Gestión de periodos sigue siendo solo de administrador y director (menú y ruta)', () => {
    assert.match(src('app.routes.ts'), /path: 'gestion\/periodos',[\s\S]*?rolGuard\('administrador', 'director'\)/);
    assert.ok(src('layout', 'navegacion.ts').includes("{ ruta: '/gestion/periodos', etiqueta: 'Gestión de periodos', icono: 'sipra-calendario', roles: ['administrador', 'director'] }"));
  });
});
