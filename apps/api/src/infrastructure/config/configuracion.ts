import { plainToInstance } from 'class-transformer';
import {
  IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength,
  validateSync,
} from 'class-validator';

import { TARIFAS_IA, tarifaDe } from '../../domain/entities/tarifas-ia';

export enum Ambiente {
  DEV = 'dev',
  QA = 'qa',
  PRE = 'pre',
  PROD = 'prod',
}

export enum ModoAutenticacion {
  ABIERTO = 'abierto',
  OIDC = 'oidc',
}

/**
 * Validación de variables de entorno al arranque. Un ambiente mal configurado
 * debe fallar aquí, no en la primera petición de un usuario.
 */
export class VariablesEntorno {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  // Sin valor de fábrica: un ambiente sin declarar no puede arrancar «como dev»,
  // porque `dev` es justo el único donde se permite el ingreso abierto.
  @IsEnum(Ambiente, { message: 'SIPRA_AMBIENTE es obligatorio: dev, qa, pre o prod' })
  SIPRA_AMBIENTE!: Ambiente;

  @IsInt() @Min(1) @Max(65535)
  PORT = 3000;

  @IsString() API_PREFIJO = 'api';
  @IsString() API_VERSION = '1';
  @IsString() CORS_ORIGENES = 'http://localhost:4200';

  // La conexión se declara de una de dos formas: por campos sueltos —lo que
  // usan Cloud SQL y el entorno local— o por una sola cadena, que es como la
  // entregan los Postgres gestionados. `validarEntorno` exige una u otra.
  @IsOptional() @IsString() DB_URL?: string;
  @IsOptional() @IsString() DB_HOST?: string;
  @IsInt() DB_PORT = 5432;
  @IsOptional() @IsString() DB_USER?: string;
  @IsOptional() @IsString() DB_PASSWORD?: string;
  @IsOptional() @IsString() DB_NAME?: string;
  @IsBoolean() DB_SSL = false;
  @IsOptional() @IsString() DB_SOCKET_PATH?: string;

  @IsString() REDIS_HOST = 'localhost';
  @IsInt() REDIS_PORT = 6379;
  @IsInt() REDIS_TTL_SEGUNDOS = 300;

  // Sin valor de fábrica: omitirla no puede degradar el ambiente a ingreso abierto.
  @IsEnum(ModoAutenticacion, { message: 'AUTH_MODO es obligatorio: abierto u oidc' })
  AUTH_MODO!: ModoAutenticacion;

  /**
   * Segunda llave del ingreso abierto: `AUTH_MODO=abierto` solo arranca si,
   * además, esta bandera es `true` y el ambiente es `dev`.
   */
  @IsBoolean() AUTH_ABIERTO_CONFIRMADO = false;

  /**
   * Si es true, la carga de documentos exige que el estudiante haya aceptado la
   * política de tratamiento de datos vigente. Apagado de fábrica: se enciende solo
   * cuando Jurídica valide el texto y el proceso institucional.
   */
  @IsBoolean() CONSENTIMIENTO_BLOQUEA_CARGUE = false;

  @IsString() @MinLength(32, {
    message: 'JWT_SECRETO debe tener al menos 32 caracteres y ser distinto en cada ambiente',
  })
  JWT_SECRETO!: string;

  @IsString() JWT_EXPIRACION = '8h';
  @IsString() OIDC_ISSUER = 'https://accounts.google.com';
  @IsOptional() @IsString() OIDC_CLIENT_ID?: string;
  @IsOptional() @IsString() OIDC_CLIENT_SECRET?: string;
  @IsOptional() @IsString() OIDC_REDIRECT_URI?: string;
  @IsString() OIDC_DOMINIOS_PERMITIDOS = 'cun.edu.co';

  @IsIn(['local', 'gcs']) STORAGE_DRIVER: 'local' | 'gcs' = 'local';
  @IsString() STORAGE_RUTA_LOCAL = './.almacen';
  @IsOptional() @IsString() GCS_BUCKET?: string;
  @IsInt() @Min(1) @Max(60) GCS_ENLACE_FIRMADO_MINUTOS = 10;
  @IsInt() @Min(1) @Max(50) DOC_TAMANO_MAXIMO_MB = 10;

  // ── Cola de trabajo ──────────────────────────────────────────────────
  // `en_linea` procesa el trabajo antes de responder. Solo tiene sentido donde
  // el proceso se congela al terminar la petición (ambiente puente sin
  // servidor); pre y prod exigen `cloud_tasks` más abajo.
  @IsIn(['en_proceso', 'en_linea', 'cloud_tasks'])
  COLA_DRIVER: 'en_proceso' | 'en_linea' | 'cloud_tasks' = 'en_proceso';

  @IsOptional() @IsString() GCP_PROYECTO?: string;
  @IsString() GCP_REGION = 'us-central1';
  @IsOptional() @IsString() GCP_CUENTA_SERVICIO?: string;
  @IsOptional() @IsString() WORKER_URL?: string;

  // ── Lectura documental asistida (capa 2) ─────────────────────────────
  // `openai` es el proveedor previsto para operar; `simulado` opera sin llave
  // (lee la capa de texto de los PDF) y `anthropic` queda como alternativa.
  @IsIn(['simulado', 'anthropic', 'openai'])
  IA_DRIVER: 'simulado' | 'anthropic' | 'openai' = 'simulado';
  @IsOptional() @IsString() OPENAI_API_KEY?: string;
  @IsString() @MinLength(1) OPENAI_MODELO = 'gpt-6-luna';
  /**
   * Esfuerzo de razonamiento; `low` basta para leer soportes. Si el modelo no
   * admite el valor, el adaptador lo degrada al vecino válido y lo avisa.
   */
  @IsIn(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  OPENAI_ESFUERZO: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'low';
  @IsString() OPENAI_URL_BASE = 'https://api.openai.com/v1';
  @IsInt() @Min(5_000) @Max(600_000) OPENAI_TIEMPO_MAXIMO_MS = 120_000;
  @IsInt() @Min(500) @Max(32_000) OPENAI_MAX_TOKENS_SALIDA = 4_000;
  @IsOptional() @IsString() ANTHROPIC_API_KEY?: string;
  @IsString() IA_MODELO = 'claude-sonnet-5';
  /**
   * Se conserva por compatibilidad con despliegues anteriores. El tope vigente
   * es el parámetro operativo `ia.tope_diario_usd` (50 USD de fábrica), que
   * la administración cambia sin desplegar.
   */
  @IsInt() IA_TOPE_DIARIO_USD = 50;

  // ── Servicio Público de Empleo ───────────────────────────────────────
  @IsString() SPE_NIT_PRESTADOR = '000000000';
  /** Solo true cuando Extensión concilie la estructura contra el anexo técnico. */
  @IsBoolean() SPE_ANEXO_CONFIRMADO = false;

  @IsIn(['simulado', 'http']) SINU_DRIVER: 'simulado' | 'http' = 'simulado';
  @IsOptional() @IsString() SINU_BASE_URL?: string;
  @IsOptional() @IsString() SINU_API_KEY?: string;

  @IsIn(['consola', 'workspace']) CORREO_DRIVER: 'consola' | 'workspace' = 'consola';
  @IsString() CORREO_REMITENTE = 'practicas@cun.edu.co';
  @IsOptional() @IsString() WORKSPACE_CUENTA_SERVICIO?: string;
  @IsOptional() @IsString() WORKSPACE_CLAVE_PRIVADA?: string;

  @IsBoolean() METRICAS_HABILITADAS = true;
  @IsString() METRICAS_RUTA = '/metrics';
  /**
   * Credencial de `GET /api/v1/metrics` (Authorization: Bearer). Sin ella el
   * endpoint responde 404; fuera de `dev` es obligatoria si las métricas están
   * habilitadas.
   */
  @IsOptional() @IsString() @MinLength(32, {
    message: 'METRICAS_TOKEN debe tener al menos 32 caracteres',
  })
  METRICAS_TOKEN?: string;
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace']) LOG_NIVEL = 'info';
}

const BOOLEANOS = new Set([
  'DB_SSL', 'METRICAS_HABILITADAS', 'SPE_ANEXO_CONFIRMADO', 'AUTH_ABIERTO_CONFIRMADO',
  'CONSENTIMIENTO_BLOQUEA_CARGUE',
]);
const ENTEROS = new Set([
  'PORT', 'DB_PORT', 'REDIS_PORT', 'REDIS_TTL_SEGUNDOS',
  'GCS_ENLACE_FIRMADO_MINUTOS', 'DOC_TAMANO_MAXIMO_MB', 'IA_TOPE_DIARIO_USD',
  'OPENAI_TIEMPO_MAXIMO_MS', 'OPENAI_MAX_TOKENS_SALIDA',
]);

export function validarEntorno(bruto: Record<string, unknown>): VariablesEntorno {
  const normalizado: Record<string, unknown> = { ...bruto };
  // Una variable declarada vacía (`METRICAS_TOKEN=`) equivale a no declararla.
  if (typeof normalizado.METRICAS_TOKEN === 'string' && normalizado.METRICAS_TOKEN.trim() === '') {
    delete normalizado.METRICAS_TOKEN;
  }
  for (const clave of BOOLEANOS) {
    const valor = normalizado[clave];
    if (typeof valor === 'string') normalizado[clave] = valor.toLowerCase() === 'true';
    else if (typeof valor === 'boolean') normalizado[clave] = valor;
  }
  for (const clave of ENTEROS) {
    if (normalizado[clave] !== undefined && normalizado[clave] !== '') {
      normalizado[clave] = Number(normalizado[clave]);
    }
  }

  const config = plainToInstance(VariablesEntorno, normalizado, {
    enableImplicitConversion: false,
    excludeExtraneousValues: false,
  });

  const errores = validateSync(config, { skipMissingProperties: false });
  if (errores.length > 0) {
    const detalle = errores
      .map((e) => `  · ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${detalle}`);
  }

  aplicarReglasDeAmbiente(config);
  return config;
}

/** La documentación de la API (Swagger) existe únicamente en desarrollo. */
export function documentacionApiHabilitada(ambiente: unknown): boolean {
  return ambiente === Ambiente.DEV;
}

/**
 * ¿El ingreso abierto por selección de perfil está habilitado? Exige las tres
 * condiciones a la vez: modo `abierto`, confirmación explícita y ambiente `dev`.
 * Lo usan el arranque y el controlador, de modo que ambos decidan igual.
 */
export function ingresoAbiertoPermitido(config: {
  AUTH_MODO?: unknown; AUTH_ABIERTO_CONFIRMADO?: unknown; SIPRA_AMBIENTE?: unknown;
}): boolean {
  return (
    config.AUTH_MODO === ModoAutenticacion.ABIERTO &&
    config.AUTH_ABIERTO_CONFIRMADO === true &&
    config.SIPRA_AMBIENTE === Ambiente.DEV
  );
}

/**
 * Reglas que ningún despliegue puede saltarse.
 *
 * El ingreso abierto por selección de perfil existe únicamente para desarrollo
 * local: exige `SIPRA_AMBIENTE=dev`, `AUTH_MODO=abierto` y
 * `AUTH_ABIERTO_CONFIRMADO=true` a la vez. En cualquier otro ambiente, o con
 * cualquiera de las tres faltando, el arranque falla.
 */
function aplicarReglasDeAmbiente(config: VariablesEntorno): void {
  const errores: string[] = [];
  const ambientesCerrados: Ambiente[] = [Ambiente.PRE, Ambiente.PROD];

  if (config.AUTH_MODO === ModoAutenticacion.ABIERTO) {
    if (config.SIPRA_AMBIENTE !== Ambiente.DEV) {
      errores.push(
        `AUTH_MODO=abierto está prohibido en el ambiente "${config.SIPRA_AMBIENTE}". ` +
          'El ingreso sin contraseña solo existe en desarrollo local (SIPRA_AMBIENTE=dev).',
      );
    } else if (!config.AUTH_ABIERTO_CONFIRMADO) {
      errores.push(
        'AUTH_MODO=abierto exige AUTH_ABIERTO_CONFIRMADO=true: el ingreso sin contraseña ' +
          'debe habilitarse de forma explícita.',
      );
    }
  }

  // Una base mal declarada debe impedir el arranque, no descubrirse en la
  // primera consulta.
  if (config.DB_URL?.trim()) {
    if (!/^postgres(ql)?:\/\//.test(config.DB_URL.trim())) {
      errores.push('DB_URL debe ser una cadena de conexión postgres://');
    }
  } else {
    // En Cloud Run la conexión entra por el socket del conector de Cloud SQL,
    // donde no hay host ni puerto que declarar; fuera de él hace falta el host.
    if (!config.DB_HOST?.trim() && !config.DB_SOCKET_PATH?.trim()) {
      errores.push('Falta DB_HOST (o DB_SOCKET_PATH, o una DB_URL completa)');
    }
    for (const clave of ['DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const) {
      if (!config[clave]?.trim()) {
        errores.push(`Falta ${clave}: declare la conexión por campos sueltos o por DB_URL`);
      }
    }
  }

  if (config.AUTH_MODO === ModoAutenticacion.OIDC) {
    if (!config.OIDC_CLIENT_ID) errores.push('AUTH_MODO=oidc exige OIDC_CLIENT_ID');
    if (!config.OIDC_CLIENT_SECRET) errores.push('AUTH_MODO=oidc exige OIDC_CLIENT_SECRET');
    if (!config.OIDC_REDIRECT_URI) errores.push('AUTH_MODO=oidc exige OIDC_REDIRECT_URI');
    else if (!/^https?:\/\/\S+$/.test(config.OIDC_REDIRECT_URI)) {
      errores.push('OIDC_REDIRECT_URI debe ser una URL http(s) absoluta de la pantalla /ingreso/callback');
    }
  }

  if (ambientesCerrados.includes(config.SIPRA_AMBIENTE)) {
    if (config.STORAGE_DRIVER !== 'gcs') {
      errores.push(`STORAGE_DRIVER debe ser "gcs" en ${config.SIPRA_AMBIENTE}`);
    }
    const urlConTls = /sslmode=(require|verify-ca|verify-full)/.test(config.DB_URL ?? '');
    if (!config.DB_SSL && !config.DB_SOCKET_PATH && !urlConTls) {
      errores.push('La conexión a la base debe ir por TLS o por el socket de Cloud SQL');
    }
    if (config.JWT_SECRETO.includes('cambiar')) {
      errores.push('JWT_SECRETO conserva el valor de plantilla');
    }
  }

  // Las métricas revelan volumen, costo de IA y comportamiento: nunca quedan sin credencial.
  if (config.METRICAS_HABILITADAS && config.SIPRA_AMBIENTE !== Ambiente.DEV && !config.METRICAS_TOKEN) {
    errores.push(
      `METRICAS_HABILITADAS=true exige METRICAS_TOKEN en el ambiente "${config.SIPRA_AMBIENTE}" ` +
        '(o METRICAS_HABILITADAS=false)',
    );
  }

  if (config.STORAGE_DRIVER === 'gcs' && !config.GCS_BUCKET) {
    errores.push('STORAGE_DRIVER=gcs exige GCS_BUCKET');
  }
  if (config.COLA_DRIVER === 'cloud_tasks') {
    for (const clave of ['GCP_PROYECTO', 'GCP_CUENTA_SERVICIO', 'WORKER_URL'] as const) {
      if (!config[clave]) errores.push(`COLA_DRIVER=cloud_tasks exige ${clave}`);
    }
  }
  // El pico de cierre de periodo no se absorbe en proceso: son 40.000 a 50.000
  // documentos en dos semanas y el servicio escala a cero entre picos.
  if (ambientesCerrados.includes(config.SIPRA_AMBIENTE) && config.COLA_DRIVER !== 'cloud_tasks') {
    errores.push(
      `COLA_DRIVER debe ser "cloud_tasks" en ${config.SIPRA_AMBIENTE}: la cola en proceso no ` +
        'absorbe el pico de cierre de periodo',
    );
  }
  if (config.CORREO_DRIVER === 'workspace') {
    if (!config.WORKSPACE_CUENTA_SERVICIO) {
      errores.push('CORREO_DRIVER=workspace exige WORKSPACE_CUENTA_SERVICIO');
    }
    if (!config.WORKSPACE_CLAVE_PRIVADA) {
      errores.push('CORREO_DRIVER=workspace exige WORKSPACE_CLAVE_PRIVADA (desde Secret Manager)');
    }
  }
  // En producción el estudiante tiene que recibir de verdad la explicación de
  // qué corregir: escribirla en el registro del servidor no le sirve de nada.
  if (config.SIPRA_AMBIENTE === Ambiente.PROD && config.CORREO_DRIVER !== 'workspace') {
    errores.push(
      'CORREO_DRIVER debe ser "workspace" en producción: los avisos por consola no llegan ' +
        'al destinatario',
    );
  }
  if (config.IA_DRIVER === 'anthropic' && !config.ANTHROPIC_API_KEY) {
    errores.push('IA_DRIVER=anthropic exige ANTHROPIC_API_KEY (inyectada desde Secret Manager)');
  }
  if (config.IA_DRIVER === 'openai' && !config.OPENAI_API_KEY) {
    errores.push('IA_DRIVER=openai exige OPENAI_API_KEY (inyectada desde Secret Manager)');
  }
  // Un modelo sin tarifa se valoraría con la de respaldo y el tope diario
  // perdería precisión: mejor negarse a arrancar que aproximar a ciegas.
  if (config.IA_DRIVER === 'openai' && !tarifaDe(config.OPENAI_MODELO)) {
    const conocidos = TARIFAS_IA.filter((t) => t.proveedor === 'openai' && !t.retiro).map((t) => t.id).join(', ');
    errores.push(`OPENAI_MODELO="${config.OPENAI_MODELO}" no está en la tabla de tarifas (tarifas-ia.ts). Modelos con tarifa: ${conocidos}`);
  }
  // La llave solo viaja cifrada. Se tolera http únicamente hacia la propia
  // máquina, para probar el adaptador contra un simulador local.
  if (
    config.IA_DRIVER === 'openai' &&
    !/^https:\/\//.test(config.OPENAI_URL_BASE) &&
    !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(config.OPENAI_URL_BASE)
  ) {
    errores.push('OPENAI_URL_BASE debe ser una URL https (http solo hacia localhost)');
  }

  if (errores.length > 0) {
    throw new Error(
      `Configuración incompatible con el ambiente:\n${errores.map((e) => `  · ${e}`).join('\n')}`,
    );
  }
}
