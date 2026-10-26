import { ForbiddenException } from '@nestjs/common';
import {
  GenerarReporteSpeUseCase, ReporteBloqueadoError,
} from '../src/application/use-cases/reportes/generar-reporte-spe.use-case';
import {
  CatalogoRepositoryPort, EstadoCatalogo, ReporteRepositoryPort,
} from '../src/domain/ports/out/repositorios.port';
import { AuditoriaRepositoryPort } from '../src/domain/ports/out/repositorios.port';
import { Rol } from '../src/domain/value-objects/rol.vo';

/**
 * Un archivo con códigos fuera de la nomenclatura oficial se radica, queda en
 * firme y luego hay que corregirlo ante la entidad. Estas pruebas fijan que el
 * sistema se niegue a producirlo en los ambientes donde eso podría ocurrir.
 */

const CATALOGO_COMPLETO: EstadoCatalogo = {
  nombre: 'cno', estado: 'completo', filasCargadas: 446, filasEsperadas: 446,
  fuente: null, urlOficial: null, justificacion: null,
};

function catalogos(estados: EstadoCatalogo[]): CatalogoRepositoryPort {
  return { estados: () => Promise.resolve(estados) };
}

const reportesVacios: ReporteRepositoryPort = {
  vacantesPendientesReporte: () => Promise.resolve([]),
  plazasPendientesReporte: () => Promise.resolve([]),
  marcarVacantesReportadas: () => Promise.resolve(),
};

const auditoriaMuda: AuditoriaRepositoryPort = {
  registrar: () => Promise.resolve(),
  contarConsultasRecientes: () => Promise.resolve(0),
  listar: () => Promise.resolve([]),
};

function configuracion(valores: Record<string, string>): {
  get: (clave: string) => string | undefined;
} {
  return { get: (clave: string) => valores[clave] };
}

function casoDeUso(
  ambiente: string,
  estados: EstadoCatalogo[],
  anexoConfirmado = 'false',
): GenerarReporteSpeUseCase {
  return new GenerarReporteSpeUseCase(
    reportesVacios,
    catalogos(estados),
    auditoriaMuda,
    configuracion({
      SIPRA_AMBIENTE: ambiente,
      SPE_ANEXO_CONFIRMADO: anexoConfirmado,
      SPE_NIT_PRESTADOR: '860013779',
    }) as never,
  );
}

const extension = {
  id: 'u-1', correo: 'extension.bolsa@cun.edu.co', rol: Rol.EXTENSION, permiso: 'escritura' as const,
  escuelas: [] as string[], empresaId: null,
};

const catalogosIncompletos: EstadoCatalogo[] = [
  { ...CATALOGO_COMPLETO },
  {
    nombre: 'divipola_municipio', estado: 'parcial', filasCargadas: 81,
    filasEsperadas: 1122, fuente: 'DANE', urlOficial: null, justificacion: null,
  },
];

describe('Bloqueo del reporte por catálogos incompletos', () => {
  it.each(['pre', 'prod'])(
    'se niega a emitir en el ambiente %s con un catálogo parcial',
    async (ambiente) => {
      const uso = casoDeUso(ambiente, catalogosIncompletos);
      await expect(uso.vacantes(extension)).rejects.toBeInstanceOf(ReporteBloqueadoError);
    },
  );

  it('el error nombra el catálogo culpable y el ambiente', async () => {
    const uso = casoDeUso('prod', catalogosIncompletos);
    await expect(uso.vacantes(extension)).rejects.toThrow(/divipola_municipio está parcial/);
    await expect(uso.vacantes(extension)).rejects.toThrow(/"prod"/);
  });

  it.each(['dev', 'qa'])(
    'en el ambiente %s emite con advertencia en vez de bloquear',
    async (ambiente) => {
      const { esBorrador, advertencias } = await casoDeUso(ambiente, catalogosIncompletos)
        .vacantes(extension);
      expect(advertencias.some((a) => a.includes('divipola_municipio'))).toBe(true);
      expect(advertencias.some((a) => a.includes('no es radicable'))).toBe(true);
      expect(esBorrador).toBe(true);
    },
  );

  it('con catálogos completos y anexo confirmado, el archivo es radicable', async () => {
    const completos: EstadoCatalogo[] = [
      { ...CATALOGO_COMPLETO, nombre: 'cno' },
      { ...CATALOGO_COMPLETO, nombre: 'ciiu' },
      { ...CATALOGO_COMPLETO, nombre: 'divipola_municipio' },
      { ...CATALOGO_COMPLETO, nombre: 'nivel_educativo' },
    ];
    const { esBorrador, advertencias, archivo } = await casoDeUso('prod', completos, 'true')
      .vacantes(extension);
    expect(advertencias).toHaveLength(0);
    expect(esBorrador).toBe(false);
    expect(archivo.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un catálogo que el reporte no usa no bloquea nada', async () => {
    const estados: EstadoCatalogo[] = [
      { ...CATALOGO_COMPLETO, nombre: 'cno' },
      { ...CATALOGO_COMPLETO, nombre: 'ciiu' },
      { ...CATALOGO_COMPLETO, nombre: 'divipola_municipio' },
      { ...CATALOGO_COMPLETO, nombre: 'nivel_educativo' },
      { ...CATALOGO_COMPLETO, nombre: 'divipola_departamento', estado: 'parcial' },
    ];
    await expect(casoDeUso('prod', estados, 'true').vacantes(extension)).resolves.toBeDefined();
  });
});

describe('Quién puede generar reportes regulatorios', () => {
  it.each([Rol.ESTUDIANTE, Rol.TUTOR, Rol.EMPRESA, Rol.COORDINADOR])(
    'el perfil %s no puede generarlos',
    async (rol) => {
      const uso = casoDeUso('dev', [CATALOGO_COMPLETO]);
      await expect(uso.vacantes({ ...extension, rol })).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each([Rol.EXTENSION, Rol.ADMINISTRADOR])('el perfil %s sí puede', async (rol) => {
    const uso = casoDeUso('dev', [CATALOGO_COMPLETO]);
    await expect(uso.vacantes({ ...extension, rol })).resolves.toBeDefined();
  });
});
