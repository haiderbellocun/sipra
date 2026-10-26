import { QueryRunner } from 'typeorm';
import { ValidacionEps1756000011000 } from '../src/infrastructure/persistence/postgres/migrations/1756000011000-ValidacionEps';
import { EvidenciaEpsOcr1756000012000 } from '../src/infrastructure/persistence/postgres/migrations/1756000012000-EvidenciaEpsOcr';
import { VerificacionEps1756000013000 } from '../src/infrastructure/persistence/postgres/migrations/1756000013000-VerificacionEps';
import { ConsultaAdres1756000014000 } from '../src/infrastructure/persistence/postgres/migrations/1756000014000-ConsultaAdres';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import {
  EvidenciaValidacionEpsOrm, ValidacionEpsOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-eps.orm-entity';
import { ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';

/**
 * La migración NO se ejecuta aquí: se captura el SQL que emitiría y se verifican
 * las garantías (ejes acotados, candidatura imposible sin criterios, evidencia
 * solo inserción, mínimo privilegio, sin purga). Su ejecución real contra un
 * PostgreSQL desechable se valida con `herramientas/verificar-concurrencia-pg.ts`.
 */

async function sqlDe(metodo: 'up' | 'down'): Promise<string[]> {
  const emitido: string[] = [];
  const corredor = { query: (sql: string) => { emitido.push(sql.replace(/\s+/g, ' ').trim()); return Promise.resolve(); } };
  await new ValidacionEps1756000011000()[metodo](corredor as unknown as QueryRunner);
  return emitido;
}

describe('Migración de validación de EPS (sin ejecutar)', () => {
  let up: string[];
  let todo: string;
  beforeAll(async () => { up = await sqlDe('up'); todo = up.join('\n'); });

  it('está registrada DESPUÉS de consentimiento, y sus entidades en el ORM', () => {
    const posicion = MIGRACIONES.indexOf(ValidacionEps1756000011000);
    expect(posicion).toBeGreaterThan(0);
    expect(MIGRACIONES[posicion - 1].name).toBe('ConsentimientoVersionado1756000010000');
    expect(ENTIDADES_ORM).toEqual(expect.arrayContaining([ValidacionEpsOrm, EvidenciaValidacionEpsOrm]));
  });

  it('una sola validación por documento y claves foráneas a documento, práctica y usuarios', () => {
    expect(todo).toMatch(/CONSTRAINT ux_validaciones_eps_documento UNIQUE \(documento_id\)/);
    expect(todo).toMatch(/documento_id uuid NOT NULL REFERENCES documentos\(id\)/);
    expect(todo).toMatch(/practica_id uuid NOT NULL REFERENCES practicas\(id\)/);
    expect(todo).toMatch(/estudiante_id uuid NOT NULL REFERENCES usuarios\(id\)/);
    expect(todo).toMatch(/asignado_a uuid REFERENCES usuarios\(id\)/);
    expect(todo).toMatch(/decidido_por uuid REFERENCES usuarios\(id\)/);
  });

  it('cada eje tiene su propio CHECK con valores cerrados y por defecto «sin evaluar»', () => {
    expect(todo).toMatch(/autenticidad varchar\(20\) NOT NULL DEFAULT 'no_evaluada'/);
    expect(todo).toMatch(/coincidencia varchar\(15\) NOT NULL DEFAULT 'no_evaluada'/);
    expect(todo).toMatch(/afiliacion varchar\(20\) NOT NULL DEFAULT 'no_contrastada'/);
    expect(todo).toMatch(/decision varchar\(30\) NOT NULL DEFAULT 'pendiente'/);
    for (const c of ['estado_procesamiento', 'autenticidad', 'coincidencia', 'afiliacion', 'ruta', 'decision', 'vigencia']) {
      expect(todo).toContain(`ck_veps_${c}`);
    }
  });

  it('candidatura y aprobación automática exigen procesado + autenticidad verificada + coincide + afiliación activa', () => {
    const regla = todo.match(/CONSTRAINT ck_veps_candidatura CHECK \((.*?)\)\) \)/)?.[0] ?? todo;
    expect(todo).toMatch(/ck_veps_candidatura CHECK \( decision NOT IN \('candidato_autoaprobacion','aprobado_automatico'\)/);
    for (const criterio of [
      "estado_procesamiento = 'procesado'", "autenticidad = 'verificada'", "coincidencia = 'coincide'", "afiliacion = 'activa'",
    ]) {
      expect(regla).toContain(criterio);
    }
  });

  it('una decisión humana exige quién y cuándo; la reserva es coherente (todo o nada)', () => {
    expect(todo).toMatch(/ck_veps_decision_humana CHECK \( decision NOT IN \('aprobado_manual','devuelto','rechazado'\) OR \(decidido_por IS NOT NULL AND decidido_en IS NOT NULL\)/);
    expect(todo).toMatch(/ck_veps_reserva CHECK/);
    expect(todo).toMatch(/reserva_hasta > reservado_en/);
  });

  it('versión optimista, error coherente y discrepancias como arreglo', () => {
    expect(todo).toMatch(/version integer NOT NULL DEFAULT 1/);
    expect(todo).toMatch(/CHECK \(version >= 1\)/);
    expect(todo).toMatch(/\(estado_procesamiento = 'error'\) = \(error_codigo IS NOT NULL\)/);
    expect(todo).toMatch(/jsonb_typeof\(discrepancias\) = 'array'/);
  });

  it('lo extraído y lo verificado son columnas distintas', () => {
    expect(todo).toMatch(/datos_extraidos\s+jsonb/);
    expect(todo).toMatch(/datos_verificados\s+jsonb/);
  });

  it('evidencia: coherencia tipo-fuente, revisión humana con funcionario, hash SHA-256', () => {
    expect(todo).toMatch(/ck_evidencias_eps_tipo_fuente CHECK/);
    expect(todo).toMatch(/tipo = 'texto_pdf' AND fuente = 'certificado'/);
    expect(todo).toMatch(/CHECK \(tipo <> 'revision_humana' OR verificado_por IS NOT NULL\)/);
    expect(todo).toMatch(/hash_evidencia ~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  it('evidencia: sin URLs con parámetros ni credenciales, sin secretos ni respuestas a CAPTCHA', () => {
    expect(todo).toMatch(/origen !~ '\[\?#\]'/);
    expect(todo).toMatch(/origen !~ '\/\/\[\^\/\]\*@'/);
    for (const prohibida of ['captcha', 'token', 'password', 'secreto', 'cookie', 'url_firmada', 'authorization']) {
      expect(todo).toContain(`'${prohibida}'`);
    }
  });

  it('evidencia: solo inserción, con el disparador de la auditoría (no se crea otra función)', () => {
    expect(todo).toMatch(/CREATE TRIGGER tg_evidencias_eps_inmutable BEFORE UPDATE OR DELETE ON evidencias_validacion_eps FOR EACH ROW EXECUTE FUNCTION auditoria_es_inmutable\(\)/);
    expect(todo).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
  });

  it('índices de bandeja, práctica, estudiante, reserva y evidencia por validación', () => {
    for (const indice of ['ix_veps_practica', 'ix_veps_estudiante', 'ix_veps_bandeja', 'ix_veps_asignado', 'ix_evidencias_eps_validacion']) {
      expect(todo).toContain(indice);
    }
  });

  it('mínimo privilegio: nunca DELETE ni TRUNCATE; evidencias sin UPDATE', () => {
    const grants = up.filter((s) => s.startsWith('GRANT'));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON TABLE validaciones_eps TO sipra_app',
      'GRANT SELECT, INSERT ON TABLE evidencias_validacion_eps TO sipra_app',
    ]);
    expect(grants.join(' ')).not.toMatch(/DELETE|TRUNCATE/);
  });

  it('retención pendiente: el campo existe vacío y no hay purga, borrado ni datos de prueba', () => {
    expect(todo).toMatch(/retencion_hasta\s+timestamptz/);
    expect(todo).not.toMatch(/INSERT INTO/i);
    expect(todo).not.toMatch(/DELETE FROM|TRUNCATE|DROP COLUMN/i);
  });

  it('down revierte lo creado y no toca la función de la auditoría', async () => {
    const down = (await sqlDe('down')).join('\n');
    expect(down).toMatch(/DROP TABLE IF EXISTS evidencias_validacion_eps/);
    expect(down).toMatch(/DROP TABLE IF EXISTS validaciones_eps/);
    expect(down).not.toMatch(/DROP FUNCTION/);
  });
});

describe('Migración de evidencia OCR (sin ejecutar)', () => {
  async function sql(metodo: 'up' | 'down'): Promise<string> {
    const emitido: string[] = [];
    const corredor = { query: (s: string) => { emitido.push(s.replace(/\s+/g, ' ').trim()); return Promise.resolve(); } };
    await new EvidenciaEpsOcr1756000012000()[metodo](corredor as unknown as QueryRunner);
    return emitido.join('\n');
  }

  it('está registrada justo después de la de validación de EPS', () => {
    const i = MIGRACIONES.indexOf(EvidenciaEpsOcr1756000012000);
    expect(i).toBeGreaterThan(0);
    expect(MIGRACIONES[i - 1].name).toBe('ValidacionEps1756000011000');
  });

  it('admite el tipo ocr SOLO con fuente certificado y conserva el resto de reglas', async () => {
    const up = await sql('up');
    expect(up).toMatch(/tipo IN \('texto_pdf','ocr','qr','respuesta_eps','adres','revision_humana'\)/);
    expect(up).toMatch(/tipo = 'ocr' AND fuente = 'certificado'/);
    expect(up).toMatch(/tipo = 'revision_humana' AND fuente = 'revision_humana'/);
  });

  it('no toca datos, disparadores ni privilegios', async () => {
    const todo = (await sql('up')) + (await sql('down'));
    expect(todo).not.toMatch(/INSERT|UPDATE evidencias|DELETE|TRUNCATE|GRANT|REVOKE|TRIGGER|DROP TABLE/i);
  });
});

describe('Migración de verificación oficial (sin ejecutar)', () => {
  async function sql(metodo: 'up' | 'down'): Promise<string> {
    const emitido: string[] = [];
    const corredor = { query: (s: string) => { emitido.push(s.replace(/\s+/g, ' ').trim()); return Promise.resolve(); } };
    await new VerificacionEps1756000013000()[metodo](corredor as unknown as QueryRunner);
    return emitido.join('\n');
  }

  it('está registrada justo después de la de evidencia OCR', () => {
    const i = MIGRACIONES.indexOf(VerificacionEps1756000013000);
    expect(i).toBeGreaterThan(0);
    expect(MIGRACIONES[i - 1].name).toBe('EvidenciaEpsOcr1756000012000');
  });

  it('agrega solo columnas nulas de verificación', async () => {
    const up = await sql('up');
    for (const c of ['verificador_codigo varchar(60)', 'verificacion_iniciada_en timestamptz', 'verificado_en timestamptz', 'verificacion_error varchar(40)']) {
      expect(up).toContain(c);
    }
    expect(up).not.toMatch(/NOT NULL DEFAULT|INSERT|DELETE|GRANT|REVOKE|DROP TABLE/i);
  });

  it('impide afirmar autenticidad o afiliación sin verificador y fecha', async () => {
    const up = await sql('up');
    expect(up).toMatch(/ck_veps_requiere_verificador CHECK \( \(autenticidad NOT IN \('verificada','invalida'\) AND afiliacion NOT IN \('activa','inactiva'\)\) OR \(verificador_codigo IS NOT NULL AND verificado_en IS NOT NULL\)/);
    expect(up).toMatch(/ck_veps_verificacion_coherente CHECK \( \(verificador_codigo IS NULL\) = \(verificado_en IS NULL\)/);
  });

  it('down quita lo agregado', async () => {
    const down = await sql('down');
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS ck_veps_requiere_verificador/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS verificador_codigo/);
  });
});

describe('Migración de consulta ADRES asistida (sin ejecutar)', () => {
  async function sql(metodo: 'up' | 'down'): Promise<string> {
    const emitido: string[] = [];
    const corredor = { query: (s: string) => { emitido.push(s.replace(/\s+/g, ' ').trim()); return Promise.resolve(); } };
    await new ConsultaAdres1756000014000()[metodo](corredor as unknown as QueryRunner);
    return emitido.join('\n');
  }

  it('está registrada justo después de la de verificación oficial', () => {
    const i = MIGRACIONES.indexOf(ConsultaAdres1756000014000);
    expect(i).toBeGreaterThan(0);
    expect(MIGRACIONES[i - 1].name).toBe('VerificacionEps1756000013000');
  });

  it('agrega el estado ADRES con valores cerrados y por defecto «no_requerido»', async () => {
    const up = await sql('up');
    expect(up).toContain("adres_estado varchar(20) NOT NULL DEFAULT 'no_requerido'");
    expect(up).toMatch(/ck_veps_adres_estado CHECK \(adres_estado IN \('no_requerido','pendiente','en_consulta','evidencia_recibida','procesado','error','no_determinable'\)\)/);
    expect(up).toMatch(/ck_veps_adres_recomendacion/);
  });

  it('el tipo de documento es de un catálogo y «confirmación humana» exige quién la dio', async () => {
    const up = await sql('up');
    expect(up).toMatch(/ck_veps_tipo_documento CHECK \(tipo_documento IS NULL OR tipo_documento IN \('CC','TI','CE','PA'\)\)/);
    expect(up).toMatch(/ck_veps_tipo_confirmacion CHECK \( tipo_documento_origen IS DISTINCT FROM 'confirmacion_humana' OR tipo_documento_confirmado_por IS NOT NULL\)/);
  });

  it('una consulta en curso exige su identificador y quién la preparó; la evidencia exige hash, quién y cuándo', async () => {
    const up = await sql('up');
    expect(up).toMatch(/ck_veps_adres_consulta CHECK \( adres_estado <> 'en_consulta' OR \(adres_consulta_id IS NOT NULL AND adres_consulta_vence_en IS NOT NULL AND adres_preparada_por IS NOT NULL AND tipo_documento IS NOT NULL\)\)/);
    expect(up).toMatch(/ck_veps_adres_evidencia CHECK \( adres_estado NOT IN \('evidencia_recibida','procesado'\) OR \(adres_evidencia_hash IS NOT NULL AND adres_cargada_por IS NOT NULL AND adres_cargada_en IS NOT NULL\)\)/);
  });

  it('la afiliación establecida exige una FUENTE: verificador oficial o ADRES procesado', async () => {
    const up = await sql('up');
    expect(up).toMatch(/afiliacion NOT IN \('activa','inactiva'\) OR afiliacion_fuente IS NOT NULL/);
    expect(up).toMatch(/afiliacion_fuente IS DISTINCT FROM 'adres_bdua' OR adres_estado = 'procesado'/);
    expect(up).toMatch(/afiliacion_fuente IS DISTINCT FROM 'verificador_oficial' OR \(verificador_codigo IS NOT NULL AND verificado_en IS NOT NULL\)/);
    // La autenticidad sigue exigiendo un verificador: ADRES no la establece.
    expect(up).toMatch(/autenticidad NOT IN \('verificada','invalida'\) OR \(verificador_codigo IS NOT NULL AND verificado_en IS NOT NULL\)/);
  });

  it('conserva la fuente de la afiliación ya establecida y marca lo pendiente; no guarda CAPTCHA, cookies ni sesiones', async () => {
    const up = await sql('up');
    expect(up).toMatch(/UPDATE validaciones_eps SET afiliacion_fuente = 'verificador_oficial'/);
    expect(up).toMatch(/UPDATE validaciones_eps SET adres_estado = 'pendiente'/);
    expect(up.toLowerCase()).not.toMatch(/captcha|cookie|token|sesion|session/);
    expect(up).not.toMatch(/DELETE FROM|TRUNCATE|DROP TABLE|GRANT|REVOKE/i);
  });

  it('indexa la bandeja y la búsqueda de evidencia por hash', async () => {
    const up = await sql('up');
    expect(up).toMatch(/ix_veps_adres ON validaciones_eps \(adres_estado, actualizada_en\) WHERE adres_estado <> 'no_requerido'/);
    expect(up).toMatch(/ix_evidencias_eps_hash ON evidencias_validacion_eps \(hash_evidencia\) WHERE tipo = 'adres'/);
  });

  it('down restaura la restricción anterior y quita lo agregado', async () => {
    const down = await sql('down');
    expect(down).toMatch(/ADD CONSTRAINT ck_veps_requiere_verificador CHECK \( \(autenticidad NOT IN \('verificada','invalida'\) AND afiliacion NOT IN \('activa','inactiva'\)\)/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS afiliacion_fuente/);
  });
});
