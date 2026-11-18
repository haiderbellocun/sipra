import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Rol, UsuarioAdministrativo } from '@core/models/modelos';
import {
  AYUDA_PERMISO, ETIQUETA_PERFIL, FILTROS_VACIOS, cuerpoCreacion, cuerpoEdicion, filtrarUsuarios, formularioDesde, formularioVacio,
  hayFiltros, metricasUsuarios, modoAlcance, nombreCortoEscuela, perfilesGestionables, perfilesVisibles, problemasFormulario,
  puedeGestionar, textoAlcance,
} from '../src/app/features/gestion/usuarios.util';

// G4 · Gestión de usuarios V3. Consume G1 (no la redefine): el backend sigue autorizando.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const comp = src('features', 'gestion', 'usuarios.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(comp)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(comp)?.[1] ?? '';

const CATALOGO = [
  { codigo: 'ESC-ING', nombre: 'Escuela de Ingenierías' },
  { codigo: 'ESC-NEG', nombre: 'Escuela de Ciencias Administrativas y Contables' },
];
const u = (o: Partial<UsuarioAdministrativo>): UsuarioAdministrativo => ({
  id: 'u1', correo: 'a@cun.edu.co', nombre: 'Ana Pérez', documento: '1234', rol: 'coordinador', rolEtiqueta: 'x',
  permiso: 'escritura', escuelas: [], activo: true, creadoEn: '2026-01-01T00:00:00Z', ultimoAccesoEn: null, ...o,
});

describe('G4 · perfiles según quién gestiona (espejo de G1)', () => {
  it('el administrador ve y gestiona todos los perfiles administrativos', () => {
    assert.deepEqual([...perfilesGestionables('administrador')], ['administrador', 'director', 'coordinador', 'analista', 'auxiliar', 'tutor', 'extension']);
  });

  it('el director NO ve administrador ni director como opciones para crear', () => {
    const p = perfilesGestionables('director');
    assert.deepEqual([...p], ['coordinador', 'analista', 'auxiliar', 'tutor', 'extension']);
    assert.ok(!p.includes('administrador') && !p.includes('director'));
  });

  it('el director no tiene acciones sobre administradores ni directores (no se ofrece algo que daría 403)', () => {
    assert.equal(puedeGestionar('director', u({ rol: 'administrador' })), false);
    assert.equal(puedeGestionar('director', u({ rol: 'director' })), false);
    assert.equal(puedeGestionar('director', u({ rol: 'analista' })), true);
    assert.equal(puedeGestionar('administrador', u({ rol: 'director' })), true);
  });

  it('ningún otro perfil gestiona usuarios (coordinador, analista, auxiliar, docente…)', () => {
    for (const r of ['coordinador', 'analista', 'auxiliar', 'tutor', 'extension', 'estudiante', 'empresa'] as Rol[]) {
      assert.deepEqual([...perfilesGestionables(r)], [], r);
    }
  });

  it('estudiante y empresa nunca aparecen como perfiles del módulo', () => {
    for (const actor of ['administrador', 'director'] as Rol[]) {
      for (const lista of [perfilesGestionables(actor), perfilesVisibles(actor)]) {
        assert.ok(!lista.includes('estudiante') && !lista.includes('empresa'));
      }
    }
    assert.doesNotMatch(plantilla, /Crear estudiante|value="estudiante"|value="empresa"/);
  });

  it('etiquetas: Analista de prácticas (independiente), Docente facilitador (internamente `tutor`), Director', () => {
    assert.equal(ETIQUETA_PERFIL['analista'], 'Analista de prácticas');
    assert.equal(ETIQUETA_PERFIL['coordinador'], 'Coordinador de prácticas');
    assert.equal(ETIQUETA_PERFIL['tutor'], 'Docente facilitador');
    assert.equal(ETIQUETA_PERFIL['director'], 'Director');
    assert.doesNotMatch(comp, /\(y analista\)/);
  });
});

describe('G4 · alcance', () => {
  it('administrador, director, auxiliar y extensión: siempre institucional (sin selector)', () => {
    for (const r of ['administrador', 'director', 'auxiliar', 'extension'] as Rol[]) {
      assert.equal(modoAlcance(r), 'institucional');
      assert.equal(textoAlcance(u({ rol: r, escuelas: ['ESC-ING'] }), CATALOGO), 'Institucional');
    }
  });

  it('coordinador y analista: institucional (sin escuelas) o escuelas específicas', () => {
    assert.equal(modoAlcance('analista'), 'coordinacion');
    assert.equal(textoAlcance(u({ rol: 'analista' }), CATALOGO), 'Institucional');
    assert.equal(textoAlcance(u({ rol: 'analista', escuelas: ['ESC-ING'] }), CATALOGO), 'Ingenierías');
    assert.equal(textoAlcance(u({ rol: 'coordinador', escuelas: ['ESC-ING', 'ESC-NEG'] }), CATALOGO), '2 escuelas');
  });

  it('docente facilitador: semántica actual (sus asignados; opcionalmente escuelas)', () => {
    assert.equal(textoAlcance(u({ rol: 'tutor' }), CATALOGO), 'Sus estudiantes asignados');
    assert.equal(textoAlcance(u({ rol: 'tutor', escuelas: ['ESC-ING'] }), CATALOGO), 'Asignados + Ingenierías');
  });

  it('no se inventan nombres: sin catálogo se muestra el código', () => {
    assert.equal(nombreCortoEscuela('ESC-XYZ', CATALOGO), 'ESC-XYZ');
  });

  it('las escuelas se eligen con casillas (ya no se escriben códigos separados por comas)', () => {
    assert.ok(plantilla.includes('<input type="checkbox" [name]="\'esc-\' + e.codigo"'));
    assert.doesNotMatch(plantilla, /separados por coma/);
  });

  it('se envían escuelas solo para los perfiles que las usan; institucional = []', () => {
    const coord = { ...formularioVacio(), nombre: 'Ana Pérez', correo: 'ana@cun.edu.co', documento: '1234', rol: 'coordinador' as Rol };
    assert.deepEqual(cuerpoCreacion({ ...coord, alcance: 'institucional' })['escuelas'], []);
    assert.deepEqual(cuerpoCreacion({ ...coord, alcance: 'especificas', escuelas: ['ESC-ING'] })['escuelas'], ['ESC-ING']);
    assert.equal('escuelas' in cuerpoCreacion({ ...coord, rol: 'auxiliar' }), false);
    assert.equal('escuelas' in cuerpoEdicion({ ...coord, rol: 'director' }), false);
  });
});

describe('G4 · creación, edición y validación', () => {
  it('validación con mensajes para quien llena el formulario (correo institucional, documento, perfil, escuelas)', () => {
    const p = problemasFormulario({ ...formularioVacio(), nombre: 'A', correo: 'ana@gmail.com', documento: '12.345', alcance: 'especificas', escuelas: [] }, true);
    assert.equal(p.correo, 'Usa el correo institucional (@cun.edu.co).');
    assert.ok(p.nombre && p.documento && p.rol && p.escuelas);
    assert.deepEqual(problemasFormulario({ ...formularioVacio(), nombre: 'Ana Pérez', correo: 'ana@cun.edu.co', documento: '1234', rol: 'tutor' }, true), {});
  });

  it('creación: correo en minúsculas y estado elegido', () => {
    const c = cuerpoCreacion({ ...formularioVacio(), nombre: ' Ana ', correo: 'Ana@CUN.edu.co', documento: '1234', rol: 'tutor', alcance: 'asignados', activo: false });
    assert.deepEqual(c, { nombre: 'Ana', correo: 'ana@cun.edu.co', documento: '1234', rol: 'tutor', permiso: 'escritura', activo: false, escuelas: [] });
  });

  it('edición: ni correo ni perfil ni estado viajan (el backend no los admite al editar)', () => {
    const e = cuerpoEdicion(formularioDesde(u({ rol: 'analista', escuelas: ['ESC-ING'] })));
    assert.deepEqual(Object.keys(e).sort(), ['documento', 'escuelas', 'nombre', 'permiso']);
    assert.ok(plantilla.includes('[readonly]="!!editando()"'));
    assert.ok(plantilla.includes('el perfil no se cambia al editar'));
  });

  it('permiso: consulta / escritura con su explicación; nunca amplía el perfil', () => {
    assert.equal(AYUDA_PERMISO.consulta, 'Puede visualizar dentro de su alcance.');
    assert.equal(AYUDA_PERMISO.escritura, 'Puede realizar las acciones habilitadas para su perfil.');
    assert.ok(plantilla.includes('El permiso nunca amplía lo que permite el perfil.'));
  });
});

describe('G4 · inhabilitar / reactivar y menú de acciones', () => {
  it('inhabilitar con confirmación accesible y el texto acordado (no «Eliminar»)', () => {
    assert.ok(plantilla.includes('Inhabilitar a {{ porInhabilitar()?.nombre }}'));
    assert.ok(plantilla.includes('El usuario dejará de poder acceder a SIPRA. Su historial y las acciones registradas se conservarán.'));
    assert.doesNotMatch(plantilla, />\s*Eliminar\s*</);
    assert.doesNotMatch(comp, /confirm\(|alert\(/);
  });

  it('reactivar usa la actualización existente (activo = true), sin crear otro usuario', () => {
    assert.ok(comp.includes('this.api.actualizarUsuario(u.id, { activo: true })'));
    assert.ok(plantilla.includes('Reactivar usuario'));
  });

  it('menú ⋯ accesible: aria-haspopup, aria-expanded, role=menu/menuitem, flechas y Esc', () => {
    assert.ok(plantilla.includes('aria-haspopup="menu"') && plantilla.includes('[attr.aria-expanded]="menuAbierto() === u.id"'));
    assert.ok(plantilla.includes('role="menu"') && plantilla.includes('role="menuitem"'));
    assert.match(comp, /evento\.key === 'ArrowDown'[\s\S]*evento\.key === 'Escape'/);
  });

  it('protección propia: no se ofrece inhabilitarse a sí mismo y se explica', () => {
    assert.ok(plantilla.includes('No puedes inhabilitar tu propio usuario.'));
  });

  it('sin acciones permitidas, no hay menú (solo una marca con explicación)', () => {
    assert.ok(plantilla.includes('@if (gestionable(u)) {'));
    assert.ok(plantilla.includes('Sin acciones disponibles para su perfil'));
  });
});

describe('G4 · filtros, cifras, inspector, móvil y tema', () => {
  const lista = [
    u({ id: '1', nombre: 'Ana Pérez', correo: 'ana@cun.edu.co', documento: '111', rol: 'tutor', escuelas: ['ESC-ING'] }),
    u({ id: '2', nombre: 'José Ñúñez', correo: 'jose@cun.edu.co', documento: '222', rol: 'analista', activo: false }),
    u({ id: '3', nombre: 'Luz Mora', correo: 'luz@cun.edu.co', documento: '333', rol: 'analista' }),
  ];

  it('busca por nombre (sin tildes), correo o documento y filtra por perfil, estado y escuela', () => {
    assert.deepEqual(filtrarUsuarios(lista, { ...FILTROS_VACIOS, texto: 'nunez' }).map((x) => x.id), ['2']);
    assert.deepEqual(filtrarUsuarios(lista, { ...FILTROS_VACIOS, texto: 'luz@' }).map((x) => x.id), ['3']);
    assert.deepEqual(filtrarUsuarios(lista, { ...FILTROS_VACIOS, texto: '111' }).map((x) => x.id), ['1']);
    assert.deepEqual(filtrarUsuarios(lista, { ...FILTROS_VACIOS, perfil: 'analista', estado: 'activo' }).map((x) => x.id), ['3']);
    assert.deepEqual(filtrarUsuarios(lista, { ...FILTROS_VACIOS, escuela: 'ESC-ING' }).map((x) => x.id), ['1']);
    assert.equal(hayFiltros(FILTROS_VACIOS), false);
  });

  it('cifras sobre todos los usuarios (no sobre el filtro)', () => {
    assert.deepEqual(metricasUsuarios(lista), { activos: 2, docentes: 1, analistas: 1, inhabilitados: 1 });
  });

  it('filtros en el cliente: cambiar un filtro no recarga del servidor', () => {
    assert.match(comp, /filtrar\(campo: keyof FiltrosUsuarios, valor: string\): void \{ this\.filtros\.update/);
    assert.ok(comp.includes('this.api.listarUsuarios({})'));
  });

  it('inspector lateral: <dialog> modal con título; cerrar devuelve el foco', () => {
    assert.ok(plantilla.includes('<dialog #inspector class="inspector" aria-labelledby="ins-titulo" (close)="alCerrarInspector()">'));
    assert.match(estilos, /dialog\.inspector \{ margin:0 0 0 auto; height:100dvh;[^}]*width:min\(460px, 100vw\)/);
    assert.ok(comp.includes('alCerrarInspector(): void { this.origenFoco?.focus();'));
  });

  it('móvil: filas compactas (sin desplazamiento horizontal de tabla)', () => {
    assert.match(estilos, /@media \(width < 760px\)/);
    assert.ok(estilos.includes('.usuarios td.c-alcance, .usuarios td.c-permiso, .usuarios td.c-acceso, .usuarios .doc { display:none; }'));
  });

  it('solo tokens del sistema (Signal Dark / Arctic Light): sin colores fijos', () => {
    assert.doesNotMatch(estilos, /#[0-9a-fA-F]{3,8}\b/);
  });

  it('estado con texto + señal (no solo color)', () => {
    assert.ok(plantilla.includes("{{ u.activo ? 'Activo' : 'Inhabilitado' }}"));
  });

  it('no regresión G1: la ruta y el menú siguen siendo de administrador y director', () => {
    assert.match(src('app.routes.ts'), /path: 'gestion\/usuarios',[\s\S]*?rolGuard\('administrador', 'director'\)/);
  });
});
