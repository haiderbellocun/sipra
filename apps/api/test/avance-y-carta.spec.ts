import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica, MomentoExpediente } from '../src/domain/entities/modalidad.entity';
import { CicloAcademico, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { AvanceDocumentalDomainService } from '../src/domain/services/avance-documental.domain-service';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const servicio = new AvanceDocumentalDomainService();
const doc = (tipo: TipoDocumento, estado: EstadoDocumento, version = 1) => ({ tipo, version, estado });

describe('Porcentajes de documentos cargados y aprobados (SGP)', () => {
  it('sin documentos, 0 % y el primer momento es el actual', () => {
    const a = servicio.calcular(ModalidadPractica.PASANTIA, []);
    expect(a.porcentajeCargado).toBe(0);
    expect(a.porcentajeAprobado).toBe(0);
    expect(a.momentoActual).toBe(MomentoExpediente.INICIALES);
    // EPS, acta de inicio, ARL, plan de mejoramiento, seguimiento final y carta de finalización.
    expect(a.exigidos).toBe(6);
  });

  it('cargado no es aprobado: 100 % cargado puede ser 50 % aprobado', () => {
    const a = servicio.calcular(ModalidadPractica.MONITORIA, [
      doc(TipoDocumento.CERTIFICADO_EPS, EstadoDocumento.APROBADO),
      doc(TipoDocumento.ACTA_INICIO, EstadoDocumento.APROBADO),
      doc(TipoDocumento.CERTIFICADO_ARL, EstadoDocumento.AUTO_APROBADO),
      doc(TipoDocumento.INFORME_1, EstadoDocumento.EN_REVISION),
      doc(TipoDocumento.INFORME_2, EstadoDocumento.EN_REVISION),
      doc(TipoDocumento.INFORME_FINAL, EstadoDocumento.RECIBIDO),
    ]);
    expect(a.porcentajeCargado).toBe(100);
    expect(a.porcentajeAprobado).toBe(50);
    expect(a.momentoActual).toBe(MomentoExpediente.AVANCE);
  });

  it('un documento devuelto deja de contar como cargado hasta que se reenvíe', () => {
    const a = servicio.calcular(ModalidadPractica.MONITORIA, [
      doc(TipoDocumento.CERTIFICADO_EPS, EstadoDocumento.DEVUELTO, 1),
    ]);
    expect(a.cargados).toBe(0);
    const b = servicio.calcular(ModalidadPractica.MONITORIA, [
      doc(TipoDocumento.CERTIFICADO_EPS, EstadoDocumento.DEVUELTO, 1),
      doc(TipoDocumento.CERTIFICADO_EPS, EstadoDocumento.APROBADO, 2),
    ]);
    expect(b.aprobados).toBe(1);
  });

  it('listo para cerrar solo con el 100 % aprobado', () => {
    const todos = [
      TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO, TipoDocumento.CERTIFICADO_ARL,
      TipoDocumento.INFORME_1, TipoDocumento.INFORME_2, TipoDocumento.INFORME_FINAL,
    ].map((t) => doc(t, EstadoDocumento.APROBADO));
    expect(servicio.listoParaCerrar(ModalidadPractica.MONITORIA, todos)).toBe(true);
    expect(servicio.listoParaCerrar(ModalidadPractica.MONITORIA, todos.slice(1))).toBe(false);
  });
});

describe('Edición posterior al registro', () => {
  const practica = Practica.desde({
    id: 'p', numeroFur: 12, estudianteId: 'e', programaId: 'ADM', escuelaId: 'ESC-NEG', regional: null,
    asignatura: null, ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2026C',
    modalidad: ModalidadPractica.PASANTIA, estado: EstadoPractica.INSCRITA, tutorId: null, empresaId: null,
    empresaRazonSocial: 'X', empresaNit: '1', area: 'Ventas', cargo: 'Practicante', tipoRemuneracion: null,
    salario: null, horario: null, jefeInmediatoNombre: 'Ana', jefeInmediatoCargo: null,
    jefeInmediatoCorreo: null, jefeInmediatoTelefono: null, ciudad: null, funcionesRelevantes: null,
    fechaInicio: dia('2026-08-10'), fechaFin: dia('2026-11-27'), horasRegistradas: null, arlVerificada: false,
    responsableArlPractica: null, arlFechaAfiliacion: null, terminosAceptadosEn: null, registradaPor: 'estudiante', nota: null,
    cerradaEn: null, ultimaActividad: new Date(), creadaEn: new Date(), actualizadaEn: new Date(),
  });

  it('actualiza la vacante sin tocar modalidad ni fechas', () => {
    const cambios = { cargo: 'Analista junior', ciudad: 'Medellín', fechaInicio: dia('2026-09-01'), modalidad: 'monitoria' };
    practica.actualizarVacante(cambios);
    const d = practica.instantanea();
    expect(d.cargo).toBe('Analista junior');
    expect(d.ciudad).toBe('Medellín');
    expect(d.fechaInicio).toEqual(dia('2026-08-10'));
    expect(d.modalidad).toBe(ModalidadPractica.PASANTIA);
  });
});

// La carta de presentación digital (redacción, PDF, referencia, verificación) se prueba en carta-presentacion-digital.spec.ts.
