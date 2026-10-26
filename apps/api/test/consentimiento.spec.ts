import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash } from 'node:crypto';
import { PublicarPoliticaDto, RegistrarConsentimientoDto } from '../src/application/dtos/consentimiento.dto';
import { ConsentimientoUseCase } from '../src/application/use-cases/consentimientos/consentimiento.use-case';
import { AccionAuditada, RegistroAuditoria } from '../src/domain/entities/auditoria.entity';
import {
  CanalConsentimiento, Consentimiento, DatosConsentimiento, DatosPolitica, PoliticaConsentimiento,
  TipoConsentimiento,
} from '../src/domain/entities/consentimiento.entity';
import {
  DatosObligacion, EstadoObligacion, Obligacion, TipoObligacion,
} from '../src/domain/entities/obligacion.entity';
import {
  ConsentimientoRepositoryPort, PoliticaConsentimientoRepositoryPort,
} from '../src/domain/ports/out/consentimiento.port';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, practicaDe, usuarioDe } from './soporte-autorizacion';

/**
 * Consentimiento versionado. Los repositorios en memoria imitan lo que la base
 * impone (versión única, una activa por tipo, solo inserción) para probar las
 * reglas del caso de uso. El texto que se usa es SINTÉTICO y no jurídico.
 */

const TEXTO_V1 = 'POLITICA_DE_PRUEBA_NO_JURIDICA · versión 1 · texto sintético';
const TEXTO_V2 = 'POLITICA_DE_PRUEBA_NO_JURIDICA · versión 2 · texto sintético distinto';
const TIPO = TipoConsentimiento.TRATAMIENTO_DATOS;

class PoliticasEnMemoria implements PoliticaConsentimientoRepositoryPort {
  datos: DatosPolitica[] = [];
  buscarPorId(id: string) {
    const d = this.datos.find((p) => p.id === id);
    return Promise.resolve(d ? PoliticaConsentimiento.desde(d) : null);
  }
  buscarPorTipoYVersion(tipo: TipoConsentimiento, version: number) {
    const d = this.datos.find((p) => p.tipo === tipo && p.version === version);
    return Promise.resolve(d ? PoliticaConsentimiento.desde(d) : null);
  }
  buscarActiva(tipo: TipoConsentimiento) {
    const d = this.datos.find((p) => p.tipo === tipo && p.activa);
    return Promise.resolve(d ? PoliticaConsentimiento.desde(d) : null);
  }
  ultimaVersion(tipo: TipoConsentimiento) {
    return Promise.resolve(Math.max(0, ...this.datos.filter((p) => p.tipo === tipo).map((p) => p.version)));
  }
  publicar(nueva: DatosPolitica) {
    if (this.datos.some((p) => p.tipo === nueva.tipo && p.version === nueva.version)) {
      return Promise.reject(new ConflictException('versión duplicada'));
    }
    for (const p of this.datos) {
      if (p.tipo === nueva.tipo && p.activa) { p.activa = false; p.vigenteHasta = nueva.vigenteDesde; }
    }
    this.datos.push({ ...nueva });
    return Promise.resolve(PoliticaConsentimiento.desde(nueva));
  }
}

class ConsentimientosEnMemoria implements ConsentimientoRepositoryPort {
  eventos: DatosConsentimiento[] = [];
  agregar(datos: DatosConsentimiento) {
    this.eventos.push({ ...datos });
    return Promise.resolve(Consentimiento.desde(datos));
  }
  ultimo(usuarioId: string, tipo: TipoConsentimiento, practicaId: string | null) {
    const e = [...this.eventos].reverse()
      .find((x) => x.usuarioId === usuarioId && x.tipo === tipo && x.practicaId === practicaId);
    return Promise.resolve(e ? Consentimiento.desde(e) : null);
  }
  ultimoAplicable(usuarioId: string, tipo: TipoConsentimiento, practicaId: string) {
    const e = [...this.eventos].reverse().find((x) =>
      x.usuarioId === usuarioId && x.tipo === tipo && (x.practicaId === practicaId || x.practicaId === null));
    return Promise.resolve(e ? Consentimiento.desde(e) : null);
  }
  listarPorUsuario(usuarioId: string, limite: number) {
    return Promise.resolve(
      [...this.eventos].reverse().filter((x) => x.usuarioId === usuarioId).slice(0, limite).map((e) => Consentimiento.desde(e)),
    );
  }
}

const ESTUDIANTE = actorDe(Rol.ESTUDIANTE, { id: 'estudiante-1', ip: '10.0.0.5', agenteUsuario: 'agente-de-prueba' });
const ADMIN = actorDe(Rol.ADMINISTRADOR);

function obligacion(practicaId: string, estado = EstadoObligacion.PENDIENTE): DatosObligacion {
  const ahora = new Date('2026-01-01T00:00:00Z');
  return {
    id: `obl-${practicaId}`, practicaId, tipo: TipoObligacion.AUTORIZACION_TRATAMIENTO, estado,
    fechaLimite: ahora, cumplidaEn: null, evidenciaDocumentoId: null, observacion: null,
    creadaEn: ahora, actualizadaEn: ahora,
  };
}

function montar(entorno: Record<string, unknown> = {}) {
  const politicas = new PoliticasEnMemoria();
  const eventos = new ConsentimientosEnMemoria();
  const auditoria: RegistroAuditoria[] = [];
  const obligaciones = new Map<string, DatosObligacion>([
    ['practica-1', obligacion('practica-1')], ['practica-2', obligacion('practica-2')],
  ]);
  const guardadas: DatosObligacion[] = [];
  const practicasRepo = {
    buscarPorId: jest.fn((id: string) => Promise.resolve(
      id === 'practica-1' ? practicaDe({ id: 'practica-1', estudianteId: 'estudiante-1' })
        : id === 'practica-2' ? practicaDe({ id: 'practica-2', estudianteId: 'estudiante-1' })
          : id === 'practica-ajena' ? practicaDe({ id: 'practica-ajena', estudianteId: 'otro-estudiante' })
            : null)),
    listar: jest.fn((f: { estudianteId?: string }) => Promise.resolve(
      f.estudianteId === 'estudiante-1'
        ? [practicaDe({ id: 'practica-1' }), practicaDe({ id: 'practica-2' })] : [])),
  };
  const obligacionesRepo = {
    listarPorPractica: jest.fn((id: string) => Promise.resolve(
      obligaciones.has(id) ? [Obligacion.desde(obligaciones.get(id)!)] : [])),
    guardar: jest.fn((d: DatosObligacion) => {
      obligaciones.set(d.practicaId, { ...d }); guardadas.push({ ...d });
      return Promise.resolve(Obligacion.desde(d));
    }),
  };
  const usuarios = {
    buscarPorId: jest.fn((id: string) => Promise.resolve(id === 'estudiante-1' ? usuarioDe(Rol.ESTUDIANTE, { id }) : null)),
  };
  const casoDeUso = new ConsentimientoUseCase(
    politicas, eventos, practicasRepo as never, obligacionesRepo as never, usuarios as never,
    { registrar: (r: RegistroAuditoria) => { auditoria.push(r); return Promise.resolve(); } } as never,
    new ConfigService(entorno),
  );
  const publicar = (version: number, contenido = version === 1 ? TEXTO_V1 : TEXTO_V2, ahora = new Date(`2026-02-0${version}T10:00:00Z`)) =>
    casoDeUso.publicarPolitica(
      { tipo: TIPO, version, titulo: `Política de prueba v${version}`, finalidad: 'Finalidad sintética de prueba', contenido },
      ADMIN, ahora,
    );
  return { casoDeUso, politicas, eventos, auditoria, obligaciones, guardadas, obligacionesRepo, practicasRepo, publicar };
}

const ahora = (minutos = 0): Date => new Date(Date.UTC(2026, 2, 1, 12, minutos));

// ── Políticas ──────────────────────────────────────────────────────────────

describe('Consentimiento · políticas', () => {
  it('crea una versión: queda vigente y guarda el SHA-256 de su texto', async () => {
    const { publicar, politicas, casoDeUso } = montar();
    const dto = await publicar(1);
    expect(dto).toMatchObject({ tipo: TIPO, version: 1, titulo: 'Política de prueba v1', contenido: TEXTO_V1 });
    expect(politicas.datos[0].textoSha256).toBe(createHash('sha256').update(TEXTO_V1, 'utf8').digest('hex'));
    expect(politicas.datos[0]).toMatchObject({ activa: true, publicadaPor: ADMIN.id, vigenteHasta: null });
    await expect(casoDeUso.politicaVigente(TIPO, new Date('2026-02-02T00:00:00Z'))).resolves.toMatchObject({ version: 1 });
  });

  it('la política vigente no expone metadatos administrativos', async () => {
    const { publicar, casoDeUso } = montar();
    await publicar(1);
    const dto = await casoDeUso.politicaVigente(TIPO, new Date('2026-02-02T00:00:00Z'));
    expect(Object.keys(dto).sort()).toEqual(
      ['contenido', 'finalidad', 'tipo', 'titulo', 'version', 'vigenteDesde', 'vigenteHasta']);
  });

  it('versión duplicada → rechazada (409)', async () => {
    const { publicar } = montar();
    await publicar(1);
    await expect(publicar(1, TEXTO_V2)).rejects.toThrow(ConflictException);
  });

  it('una versión menor o igual a la última → rechazada', async () => {
    const { publicar } = montar();
    await publicar(2);
    await expect(publicar(1)).rejects.toThrow(/mayor que la última/);
  });

  it('una sola política activa por tipo: publicar la v2 retira la v1', async () => {
    const { publicar, politicas } = montar();
    await publicar(1);
    await publicar(2);
    expect(politicas.datos.filter((p) => p.activa).map((p) => p.version)).toEqual([2]);
    expect(politicas.datos.find((p) => p.version === 1)).toMatchObject({ activa: false });
    expect(politicas.datos.find((p) => p.version === 1)?.vigenteHasta).toEqual(politicas.datos.find((p) => p.version === 2)?.vigenteDesde);
  });

  it('el texto de una versión publicada no se modifica: no existe operación de edición, solo una versión nueva', async () => {
    const { publicar, politicas } = montar();
    await publicar(1);
    const antes = politicas.datos[0].textoSha256;
    await publicar(2);
    expect(politicas.datos.find((p) => p.version === 1)?.contenido).toBe(TEXTO_V1);
    expect(politicas.datos.find((p) => p.version === 1)?.textoSha256).toBe(antes);
    // El puerto solo permite publicar: ninguna operación reescribe el texto.
    expect(Object.getOwnPropertyNames(PoliticasEnMemoria.prototype).filter((n) => /actualizar|editar|modificar/i.test(n))).toEqual([]);
  });

  it('solo administración publica políticas', async () => {
    const { casoDeUso } = montar();
    for (const rol of [Rol.COORDINADOR, Rol.TUTOR, Rol.ESTUDIANTE, Rol.AUXILIAR, Rol.EMPRESA, Rol.EXTENSION]) {
      await expect(casoDeUso.publicarPolitica(
        { tipo: TIPO, version: 1, titulo: 't', finalidad: 'f', contenido: 'c' }, actorDe(rol),
      )).rejects.toThrow(ForbiddenException);
    }
  });

  it('un contenido en blanco se rechaza', async () => {
    const { publicar } = montar();
    await expect(publicar(1, '   ')).rejects.toThrow(BadRequestException);
  });

  it('sin política publicada → 404 al consultar la vigente', async () => {
    await expect(montar().casoDeUso.politicaVigente(TIPO)).rejects.toThrow(NotFoundException);
  });

  it('política vencida (retirada) → ya no es la vigente', async () => {
    const { publicar, casoDeUso, politicas } = montar();
    await publicar(1);
    politicas.datos[0].activa = false;
    politicas.datos[0].vigenteHasta = new Date('2026-02-15T00:00:00Z');
    await expect(casoDeUso.politicaVigente(TIPO, new Date('2026-03-01T00:00:00Z'))).rejects.toThrow(NotFoundException);
  });

  it('publicar audita sin registrar el texto', async () => {
    const { publicar, auditoria } = montar();
    await publicar(1);
    expect(auditoria[0]).toMatchObject({
      accion: AccionAuditada.POLITICA_CONSENTIMIENTO_PUBLICADA, actorId: ADMIN.id, metadatos: { tipo: TIPO, version: 1 },
    });
    expect(JSON.stringify(auditoria)).not.toContain('texto sintético');
  });
});

// ── Consentimientos ────────────────────────────────────────────────────────

describe('Consentimiento · aceptación', () => {
  it('aceptación correcta: persona de la sesión, versión, finalidad, canal, IP y agente', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    const resultado = await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora());
    expect(resultado.registrado).toBe(true);
    expect(resultado.consentimiento).toMatchObject({
      tipo: TIPO, politicaVersion: 1, aceptado: true, practicaId: null, canal: CanalConsentimiento.WEB,
      finalidad: 'Finalidad sintética de prueba', politicaTitulo: 'Política de prueba v1',
    });
    expect(eventos.eventos[0]).toMatchObject({
      usuarioId: 'estudiante-1', registradoPor: 'estudiante-1', ip: '10.0.0.5', agenteUsuario: 'agente-de-prueba',
      creadoEn: ahora(),
    });
  });

  it('el usuario sale del token: un usuarioId en el cuerpo no cambia a quién se registra', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    const cuerpo = { tipo: TIPO, politicaVersion: 1, aceptado: true, usuarioId: 'otra-persona', registradoPor: 'otra-persona' };
    await casoDeUso.registrar(cuerpo, ESTUDIANTE, ahora());
    expect(eventos.eventos[0].usuarioId).toBe('estudiante-1');
    expect(eventos.eventos[0].registradoPor).toBe('estudiante-1');
  });

  it('el DTO rechaza cualquier campo de usuario (el ValidationPipe global usa forbidNonWhitelisted)', () => {
    const errores = (cuerpo: Record<string, unknown>) =>
      validateSync(plainToInstance(RegistrarConsentimientoDto, cuerpo), { whitelist: true, forbidNonWhitelisted: true });
    expect(errores({ tipo: TIPO, politicaVersion: 1, aceptado: true })).toEqual([]);
    expect(errores({ tipo: TIPO, politicaVersion: 1, aceptado: true, usuarioId: 'x' }).map((e) => e.property)).toContain('usuarioId');
    expect(errores({ tipo: TIPO, politicaVersion: 1, aceptado: true, registradoPor: 'x' }).map((e) => e.property)).toContain('registradoPor');
    expect(errores({ tipo: 'otro', politicaVersion: 1, aceptado: true }).length).toBeGreaterThan(0);
    expect(errores({ tipo: TIPO, politicaVersion: 0, aceptado: true }).length).toBeGreaterThan(0);
    expect(errores({ tipo: TIPO, politicaVersion: 1 }).length).toBeGreaterThan(0);
  });

  it('el DTO de publicación exige título, finalidad y contenido', () => {
    const vacio = validateSync(plainToInstance(PublicarPoliticaDto, { tipo: TIPO, version: 1 }));
    expect(vacio.map((e) => e.property).sort()).toEqual(['contenido', 'finalidad', 'titulo']);
  });

  it('política inexistente → 404, sin registrar nada', async () => {
    const { casoDeUso, eventos } = montar();
    await expect(casoDeUso.registrar({ tipo: TIPO, politicaVersion: 9, aceptado: true }, ESTUDIANTE)).rejects.toThrow(NotFoundException);
    expect(eventos.eventos).toHaveLength(0);
  });

  it('aceptar una versión que no es la vigente → 409 e indica la vigente', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    await publicar(2);
    await expect(casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, new Date('2026-03-01T00:00:00Z')))
      .rejects.toThrow(/la vigente es la 2/);
    await expect(casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, new Date('2026-03-01T00:00:00Z')))
      .rejects.toThrow(ConflictException);
    expect(eventos.eventos).toHaveLength(0);
  });

  it('aceptar una política vencida → 409', async () => {
    const { casoDeUso, publicar, politicas } = montar();
    await publicar(1);
    politicas.datos[0].activa = false;
    politicas.datos[0].vigenteHasta = new Date('2026-02-10T00:00:00Z');
    await expect(casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, new Date('2026-03-01T00:00:00Z')))
      .rejects.toThrow(ConflictException);
  });

  it('práctica inexistente → rechazo; práctica de otro estudiante → el mismo rechazo', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    for (const practicaId of ['00000000-0000-4000-8000-000000000000', 'practica-ajena']) {
      await expect(casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, practicaId, aceptado: true }, ESTUDIANTE, ahora()))
        .rejects.toThrow(NotFoundException);
    }
    expect(eventos.eventos).toHaveLength(0);
  });

  it('quien no es el estudiante dueño no asocia el consentimiento a una práctica', async () => {
    const { casoDeUso, publicar } = montar();
    await publicar(1);
    await expect(casoDeUso.registrar(
      { tipo: TIPO, politicaVersion: 1, practicaId: 'practica-1', aceptado: true }, actorDe(Rol.COORDINADOR), ahora(),
    )).rejects.toThrow(NotFoundException);
  });

  it('con práctica propia el evento queda asociado a ella', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, practicaId: 'practica-1', aceptado: true }, ESTUDIANTE, ahora());
    expect(eventos.eventos[0].practicaId).toBe('practica-1');
  });
});

describe('Consentimiento · historial, revocación e idempotencia', () => {
  it('historial propio: solo los eventos de la persona de la sesión, del más reciente al más antiguo', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora(1));
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: false }, ESTUDIANTE, ahora(2));
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, actorDe(Rol.ESTUDIANTE, { id: 'estudiante-2' }), ahora(3));

    const mios = await casoDeUso.misConsentimientos(ESTUDIANTE);
    expect(mios.map((m) => m.aceptado)).toEqual([false, true]);
    expect(eventos.eventos).toHaveLength(3);
    const del2 = await casoDeUso.misConsentimientos(actorDe(Rol.ESTUDIANTE, { id: 'estudiante-2' }));
    expect(del2).toHaveLength(1);
  });

  it('el historial no revela IP, agente ni quién registró', async () => {
    const { casoDeUso, publicar } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora());
    const [item] = await casoDeUso.misConsentimientos(ESTUDIANTE);
    expect(Object.keys(item).sort()).toEqual(
      ['aceptado', 'canal', 'creadoEn', 'finalidad', 'id', 'politicaTitulo', 'politicaVersion', 'practicaId', 'tipo']);
  });

  it('un usuario no consulta el historial ajeno; solo administración y el Área de Prácticas', async () => {
    const { casoDeUso, publicar } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora());
    for (const actor of [
      actorDe(Rol.ESTUDIANTE, { id: 'estudiante-2' }), actorDe(Rol.TUTOR), actorDe(Rol.AUXILIAR),
      actorDe(Rol.EMPRESA), actorDe(Rol.EXTENSION), actorDe(Rol.COORDINADOR, { escuelas: ['ESC-NEG'] }),
    ]) {
      await expect(casoDeUso.consultarDeUsuario('estudiante-1', actor)).rejects.toThrow(ForbiddenException);
    }
    await expect(casoDeUso.consultarDeUsuario('estudiante-1', ADMIN)).resolves.toHaveLength(1);
    await expect(casoDeUso.consultarDeUsuario('estudiante-1', actorDe(Rol.COORDINADOR))).resolves.toHaveLength(1);
    await expect(casoDeUso.consultarDeUsuario('no-existe', ADMIN)).rejects.toThrow(NotFoundException);
  });

  it('la revocación genera un NUEVO registro y no toca el anterior', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora(1));
    const primero = { ...eventos.eventos[0] };
    const revocado = await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: false }, ESTUDIANTE, ahora(2));
    expect(revocado.registrado).toBe(true);
    expect(eventos.eventos).toHaveLength(2);
    expect(eventos.eventos[0]).toEqual(primero);
    expect(eventos.eventos[1]).toMatchObject({ aceptado: false, creadoEn: ahora(2) });
  });

  it('aceptar → revocar → aceptar deja tres eventos (la posterior aceptación NO se confunde con un duplicado)', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    for (const [i, aceptado] of [true, false, true].entries()) {
      await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado }, ESTUDIANTE, ahora(i));
    }
    expect(eventos.eventos.map((e) => e.aceptado)).toEqual([true, false, true]);
  });

  it('idempotencia: el mismo evento consecutivo no se duplica ni se audita de nuevo', async () => {
    const { casoDeUso, publicar, eventos, auditoria } = montar();
    await publicar(1);
    const primero = await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora(1));
    const repetido = await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora(2));
    expect(repetido.registrado).toBe(false);
    expect(repetido.consentimiento.id).toBe(primero.consentimiento.id);
    expect(eventos.eventos).toHaveLength(1);
    expect(auditoria.filter((a) => a.accion === AccionAuditada.CONSENTIMIENTO_ACEPTADO)).toHaveLength(1);
  });

  it('alcance distinto, evento distinto: general y por práctica no se confunden', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora(1));
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, practicaId: 'practica-1', aceptado: true }, ESTUDIANTE, ahora(2));
    expect(eventos.eventos).toHaveLength(2);
  });

  it('se puede revocar una versión anterior aunque ya haya otra vigente', async () => {
    const { casoDeUso, publicar, eventos } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, new Date('2026-02-01T12:00:00Z'));
    await publicar(2);
    const r = await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: false }, ESTUDIANTE, new Date('2026-03-01T12:00:00Z'));
    expect(r).toMatchObject({ registrado: true, consentimiento: { aceptado: false, politicaVersion: 1 } });
    expect(eventos.eventos).toHaveLength(2);
  });
});

describe('Consentimiento · auditoría', () => {
  it('aceptar audita CONSENTIMIENTO_ACEPTADO con usuario, tipo, versión, práctica y resultado', async () => {
    const { casoDeUso, publicar, auditoria } = montar();
    await publicar(1);
    const { consentimiento } = await casoDeUso.registrar(
      { tipo: TIPO, politicaVersion: 1, practicaId: 'practica-1', aceptado: true }, ESTUDIANTE, ahora());
    const registro = auditoria.find((a) => a.accion === AccionAuditada.CONSENTIMIENTO_ACEPTADO);
    expect(registro).toMatchObject({
      actorId: 'estudiante-1', actorRol: Rol.ESTUDIANTE, entidad: 'consentimiento', entidadId: consentimiento.id,
      metadatos: { tipo: TIPO, version: 1, practicaId: 'practica-1', aceptado: true, resultado: 'registrado' },
    });
    expect(registro?.ocurridoEn).toBeInstanceOf(Date);
  });

  it('revocar audita CONSENTIMIENTO_REVOCADO', async () => {
    const { casoDeUso, publicar, auditoria } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora(1));
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: false }, ESTUDIANTE, ahora(2));
    expect(auditoria.filter((a) => a.accion === AccionAuditada.CONSENTIMIENTO_REVOCADO)).toHaveLength(1);
  });

  it('la auditoría no contiene el texto de la política ni tokens', async () => {
    const { casoDeUso, publicar, auditoria } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora());
    const todo = JSON.stringify(auditoria);
    expect(todo).not.toContain('texto sintético');
    expect(todo).not.toMatch(/bearer|token/i);
  });
});

// ── Obligación AUTORIZACION_TRATAMIENTO ────────────────────────────────────

describe('Consentimiento · obligación AUTORIZACION_TRATAMIENTO', () => {
  it('aceptar para una práctica cumple su obligación y lo audita', async () => {
    const { casoDeUso, publicar, obligaciones, auditoria } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, practicaId: 'practica-1', aceptado: true }, ESTUDIANTE, ahora());
    expect(obligaciones.get('practica-1')).toMatchObject({ estado: EstadoObligacion.CUMPLIDA, cumplidaEn: ahora() });
    expect(obligaciones.get('practica-2')?.estado).toBe(EstadoObligacion.PENDIENTE);
    expect(auditoria.some((a) => a.accion === AccionAuditada.OBLIGACION_CUMPLIDA && a.entidadId === 'practica-1')).toBe(true);
  });

  it('aceptar en general cumple la obligación de todas las prácticas del estudiante', async () => {
    const { casoDeUso, publicar, obligaciones } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora());
    expect([...obligaciones.values()].map((o) => o.estado)).toEqual([EstadoObligacion.CUMPLIDA, EstadoObligacion.CUMPLIDA]);
  });

  it('una obligación ya cumplida no se vuelve a guardar', async () => {
    const { casoDeUso, publicar, obligacionesRepo, obligaciones } = montar();
    obligaciones.set('practica-1', obligacion('practica-1', EstadoObligacion.CUMPLIDA));
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, practicaId: 'practica-1', aceptado: true }, ESTUDIANTE, ahora());
    expect(obligacionesRepo.guardar).not.toHaveBeenCalled();
  });

  it('revocar o rechazar no cumple ninguna obligación', async () => {
    const { casoDeUso, publicar, obligacionesRepo } = montar();
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: false }, ESTUDIANTE, ahora());
    expect(obligacionesRepo.guardar).not.toHaveBeenCalled();
  });
});

describe('Consentimiento · compuerta de carga (CONSENTIMIENTO_BLOQUEA_CARGUE)', () => {
  it('apagada (valor de fábrica): no bloquea y ni siquiera consulta la base', async () => {
    for (const entorno of [{}, { CONSENTIMIENTO_BLOQUEA_CARGUE: false }, { CONSENTIMIENTO_BLOQUEA_CARGUE: 'true' }]) {
      const m = montar(entorno);
      await expect(m.casoDeUso.exigirParaCargar('estudiante-1', 'practica-1')).resolves.toBeUndefined();
    }
    const sinPolitica = montar();
    await sinPolitica.casoDeUso.exigirParaCargar('estudiante-1', 'practica-1');
    expect(sinPolitica.practicasRepo.buscarPorId).not.toHaveBeenCalled();
  });

  it('el consentimiento se registra y la obligación se cumple aunque la compuerta esté apagada', async () => {
    const { casoDeUso, publicar, obligaciones } = montar({ CONSENTIMIENTO_BLOQUEA_CARGUE: false });
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, ahora());
    expect(obligaciones.get('practica-1')?.estado).toBe(EstadoObligacion.CUMPLIDA);
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-1')).resolves.toBeUndefined();
  });

  const ENCENDIDA = { CONSENTIMIENTO_BLOQUEA_CARGUE: true };

  it('encendida y sin política publicada → no se carga', async () => {
    await expect(montar(ENCENDIDA).casoDeUso.exigirParaCargar('estudiante-1', 'practica-1', new Date('2026-03-01T00:00:00Z')))
      .rejects.toThrow(ForbiddenException);
  });

  it('encendida y sin consentimiento → no se carga', async () => {
    const { casoDeUso, publicar } = montar(ENCENDIDA);
    await publicar(1);
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-1', new Date('2026-03-01T00:00:00Z')))
      .rejects.toThrow(/Debe aceptar la política/);
  });

  it('encendida y con la política vigente aceptada → se carga (general o de la práctica)', async () => {
    const { casoDeUso, publicar } = montar(ENCENDIDA);
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, new Date('2026-02-02T00:00:00Z'));
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-1', new Date('2026-03-01T00:00:00Z'))).resolves.toBeUndefined();
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-2', new Date('2026-03-01T00:00:00Z'))).resolves.toBeUndefined();
  });

  it('encendida y revocado → no se carga', async () => {
    const { casoDeUso, publicar } = montar(ENCENDIDA);
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, new Date('2026-02-02T00:00:00Z'));
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: false }, ESTUDIANTE, new Date('2026-02-03T00:00:00Z'));
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-1', new Date('2026-03-01T00:00:00Z'))).rejects.toThrow(ForbiddenException);
  });

  it('encendida y con una versión anterior aceptada → exige aceptar la nueva', async () => {
    const { casoDeUso, publicar } = montar(ENCENDIDA);
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, ESTUDIANTE, new Date('2026-02-01T12:00:00Z'));
    await publicar(2);
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-1', new Date('2026-03-01T00:00:00Z'))).rejects.toThrow(ForbiddenException);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 2, aceptado: true }, ESTUDIANTE, new Date('2026-03-01T00:00:00Z'));
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-1', new Date('2026-03-02T00:00:00Z'))).resolves.toBeUndefined();
  });

  it('el consentimiento de otra persona no habilita a este estudiante', async () => {
    const { casoDeUso, publicar } = montar(ENCENDIDA);
    await publicar(1);
    await casoDeUso.registrar({ tipo: TIPO, politicaVersion: 1, aceptado: true }, actorDe(Rol.ESTUDIANTE, { id: 'estudiante-2' }), new Date('2026-02-02T00:00:00Z'));
    await expect(casoDeUso.exigirParaCargar('estudiante-1', 'practica-1', new Date('2026-03-01T00:00:00Z'))).rejects.toThrow(ForbiddenException);
  });
});
