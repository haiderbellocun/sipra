# SIPRA PRÁCTICAS — Documento técnico

**Sistema Integrado de Prácticas y Relacionamiento Académico-Empresarial**
Corporación Unificada Nacional de Educación Superior · Dirección de Operaciones

| Campo | Valor |
|---|---|
| Versión del documento | 0.17.3 |
| Fecha | 26 de octubre de 2026 |
| Estado del desarrollo | Proceso base del SGP (0.12), mejoras del Área de Prácticas (0.13), diseño SIPRA (0.14), movimiento de la interfaz (0.15), lectura documental con OpenAI y costos (0.16), paquete de transferencia (0.17) y repositorio independiente (0.17.1) |
| Commit de referencia | `161ef40` y siguientes de `main` (es el `4fff78f` del repositorio original: el historial se reescribió al separar la carpeta con `git subtree split`) |
| Repositorio | `ironfuentes-netizen/sipra-practicas` (repositorio privado independiente desde el 14 de octubre de 2026; antes vivió como carpeta `sipra/` del repositorio `Productoacademico`, rama `claude/sipra-practicas-setup-l0zasi`) |
| Rama principal | `main` |

> **Este es el único documento técnico del proyecto.** Se actualiza en cada
> avance y reemplaza cualquier versión anterior. No se generan documentos
> paralelos: lo que no está aquí, no está documentado.

---

## Índice

1. [Qué se construyó](#1-qué-se-construyó)
2. [Arquitectura](#2-arquitectura)
3. [Modelo de datos](#3-modelo-de-datos)
4. [Catálogo de estados y transiciones](#4-catálogo-de-estados-y-transiciones)
5. [Matriz de roles y permisos](#5-matriz-de-roles-y-permisos)
6. [Modelo de seguridad](#6-modelo-de-seguridad)
7. [Pipeline de validación documental](#7-pipeline-de-validación-documental)
8. [Cumplimiento normativo](#8-cumplimiento-normativo)
9. [Autenticación y el modo abierto de pruebas](#9-autenticación-y-el-modo-abierto-de-pruebas)
10. [Despliegue en Google Cloud](#10-despliegue-en-google-cloud)
11. [Observabilidad](#11-observabilidad)
12. [Operación local](#12-operación-local)
13. [Pruebas](#13-pruebas)
14. [Cumplimiento del estándar de la Fábrica de Software](#14-cumplimiento-del-estándar-de-la-fábrica-de-software)
15. [Estado por módulo y trabajo pendiente](#15-estado-por-módulo-y-trabajo-pendiente)
16. [Decisiones tomadas y su justificación](#16-decisiones-tomadas-y-su-justificación)
17. [Proceso base del SGP: paridad con la plataforma actual](#17-proceso-base-del-sgp-paridad-con-la-plataforma-actual)
18. [Sistema de diseño SIPRA](#18-sistema-de-diseño-sipra)
19. [Lectura documental asistida con OpenAI y costos](#19-lectura-documental-asistida-con-openai-y-costos)
20. [Guía de transferencia](#20-guía-de-transferencia)
21. [Bitácora de cambios](#21-bitácora-de-cambios)

---

## 1. Qué se construyó

Una plataforma institucional que automatiza la verificación documental del
proceso de prácticas profesionales, produce evidencia de cumplimiento
normativo verificable y libera capacidad de acompañamiento docente.

El problema no es la ausencia de un sistema. Es una desproporción aritmética:
cada tutor acompaña cerca de 1.000 estudiantes y el proceso genera entre 90.000
y 125.000 documentos por semestre. Revisar 56 documentos diarios además de la
carga docente no es materialmente posible. El objetivo del pipeline es reducir
del 100 % a un rango del 10 % al 15 % la proporción de documentos que requieren
revisión humana.

**Lo que hoy funciona de extremo a extremo y está verificado:**

| Capacidad | Verificación |
|---|---|
| Ingreso por selección de perfil, sin contraseña | Seis perfiles operativos en el ambiente de pruebas |
| Alcance de visibilidad por rol | El estudiante ve 1 expediente; la empresa, 2; el administrador, 3 |
| Compuerta de afiliación a ARL | Bloquea sin afiliación, con afiliación del mismo día y con afiliación posterior |
| Verificación de tipo real por firma binaria | Un `.txt` renombrado a `.pdf` se rechaza |
| Forense de PDF | Un certificado con productor `Microsoft Word` cae a banda roja y cortocircuita antes de consumir IA |
| Filtro antidiscriminación | Bloquea con la norma citada; el bloqueo queda en auditoría |
| Auditoría inmutable | `UPDATE` y `DELETE` rechazados por el motor, incluso ante SQL directo |
| Aislamiento entre empresas | 10 pruebas automatizadas; condición de despliegue |
| Formulario Único de Registro | Un registro vigente por estudiante y periodo; modalidad y fechas fijas; ventana del periodo; sin fines de semana; correo con los documentos por momento |
| Carta de presentación | PDF idéntico en cada reimpresión; ventana de un mes antes del periodo al cierre del FUR |
| Bitácora y cierre | El proceso cierra solo cuando concurren el 100 % aprobado, «Evalúa tu proceso» y la calificación; 3,0 aprueba |
| Solicitud de ARL | Validación automática del manual del portal con recomendación; el auxiliar decide; el certificado queda en el expediente |
| Reportes del SGP | Prácticas, bitácoras (cuatro tipos) y cartas en Excel con las columnas del manual; el libro generado se abre en la prueba |

---

## 2. Arquitectura

### 2.1 Decisión de estructura

El proyecto es un repositorio propio (`ironfuentes-netizen/sipra-practicas`),
organizado como monorepo de espacios de trabajo de npm. Hasta el 13 de octubre
de 2026 vivió como carpeta `sipra/` del repositorio de *Producto Académico*; esa
aplicación sigue publicándose en Netlify desde su repositorio y no comparte
código, datos ni despliegue con esta.

```
sipra-practicas/
├── .github/workflows/          ci.yml (integración continua) · desplegar.yml
├── apps/
│   ├── api/                    NestJS · arquitectura hexagonal
│   │   └── src/
│   │       ├── domain/         Modelos y reglas de negocio puras
│   │       ├── application/    Casos de uso y DTO
│   │       └── infrastructure/ Adaptadores, controladores, persistencia
│   └── web/                    Angular · componentes standalone y signals
├── infra/
│   ├── docker/                 Entorno local y observabilidad
│   └── gcp/                    Cloud Build y aprovisionamiento
└── docs/DOCUMENTO-TECNICO.md   Este documento
```

### 2.2 Arquitectura hexagonal (puertos y adaptadores)

La regla de dependencia es la garantía central: **las dependencias de código
fuente solo apuntan hacia adentro.** El dominio no conoce NestJS, ni TypeORM,
ni Google Cloud.

```
   ┌─────────────────────────────────────────────────────────────┐
   │  infrastructure/  (adaptadores)                             │
   │  ┌───────────────────────────────────────────────────────┐  │
   │  │  application/  (casos de uso)                         │  │
   │  │  ┌─────────────────────────────────────────────────┐  │  │
   │  │  │  domain/                                        │  │  │
   │  │  │  entidades · servicios de dominio · PUERTOS     │  │  │
   │  │  └─────────────────────────────────────────────────┘  │  │
   │  └───────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────┘
              ▲ las flechas de dependencia apuntan hacia adentro
```

Esta regla **no es una convención de estilo: la hace cumplir el linter.**
`apps/api/eslint.config.mjs` prohíbe que `src/domain/**` importe `@nestjs/*`,
`typeorm`, `@google-cloud/*`, `fastify` o `pg`. Un intento rompe el lint y con
él la integración continua.

Consecuencia práctica: cambiar de proveedor de IA, de almacenamiento o de
fuente de RUES es cambiar **una línea** en `app.module.ts`.

### 2.3 Puertos definidos por el dominio

| Puerto | Adaptadores disponibles |
|---|---|
| `UsuarioRepositoryPort`, `PracticaRepositoryPort`, `DocumentoRepositoryPort`, `EmpresaRepositoryPort`, `ObligacionRepositoryPort`, `VacanteRepositoryPort`, `AuditoriaRepositoryPort` | PostgreSQL vía TypeORM |
| `AlmacenamientoPort` | Disco local · Cloud Storage |
| `ExtraccionIaPort` | Simulado determinístico (capa de texto del PDF) · **OpenAI (Responses API, salida JSON estricta)** · API de Anthropic |
| `CoherenciaCruzadaPort` | Determinístico sobre extracciones |
| `RuesPort` | Simulado (pendiente el convenio de acceso real) |
| `SinuPort` | Simulado (pendiente la definición de Tecnología) |
| `NotificacionPort` | Consola · Google Workspace (adaptador construido; la cuenta de servicio con delegación no se ha activado en ningún ambiente) |

### 2.4 Stack tecnológico

Corresponde al manual *Estándares, Arquitectura y Stack Tecnológico* de la
Fábrica de Software CUN, versión 2.0.

| Capa | Tecnología | Versión |
|---|---|---|
| Backend | NestJS con adaptador **Fastify** | 11.1.6+ |
| Arquitectura backend | Hexagonal (puertos y adaptadores) + SOLID | — |
| ORM | TypeORM, esquema gobernado por migraciones | 0.3.27+ |
| Base de datos | PostgreSQL (Cloud SQL) | 16/18 |
| Caché | Redis (Memorystore) | 7 |
| Frontend | Angular, componentes standalone, signals, `OnPush` | 20.3+ |
| Documentación de API | OpenAPI v3 vía `@nestjs/swagger` | — |
| Observabilidad | `prom-client` → Prometheus → Grafana | — |
| Contenedores | Docker multi-etapa | — |
| Control de versiones | GitHub Flow | — |

---

## 3. Modelo de datos

### 3.1 Diccionario de tablas

| Tabla | Propósito | Notas |
|---|---|---|
| `usuarios` | Identidad y alcance | `rol` restringido por `CHECK`; `escuelas` es `text[]` |
| `empresas` | Registro único para prácticas y bolsa | `nit_numero` único; `senales` en `jsonb` |
| `practicas` | Expediente de práctica | Lleva la compuerta ARL como `CHECK`; desde 0.12 guarda el FUR (`numero_fur` por identidad, empresa como texto, vacante, nota, cierre) y un registro no anulado por estudiante y periodo |
| `documentos` | Soportes versionados | `hash_sha256` indexado; `banderas` y `extraccion` en `jsonb` |
| `obligaciones` | Obligaciones normativas con vencimiento | Única por `(practica_id, tipo)` |
| `vacantes` | Bolsa de empleo | Llaves foráneas a los cuatro catálogos oficiales |
| `postulaciones` | Postulaciones del estudiante | Única por `(vacante_id, estudiante_id)` |
| `habilitaciones_bolsa` | Habilitación **con vigencia**, no atributo del estudiante | Permite suspender o extender a egresados sin tocar el modelo |
| `auditoria` | Registro inmutable | Sin `UPDATE` ni `DELETE` |
| `parametros` | Sobrescrituras de los parámetros operativos (M12) | El catálogo vive en el código |
| `periodos_academicos` | Periodos con sus ventanas (`jsonb`), cronograma (jornadas de inducción, fecha de cargue), modalidades ofertadas y sincronización | Tres calendarios: presencial, virtual y 335; la ventana `solicitud_arl` se deriva del límite de dos meses |
| `cartas_presentacion` | Cartas generadas, con el contenido y su hash | Reimpresión idéntica; reporte de cartas |
| `bitacora_entradas` | Bitácora de la práctica | Solo `SELECT` e `INSERT` para `sipra_app`; «Evalúa tu proceso» único por práctica |
| `solicitudes_arl` | Solicitudes de ARL del portal | Una viva (radicada o aprobada) por práctica; `CHECK` de motivos y de certificado |
| `pqrs` | Peticiones, quejas, reclamos y sugerencias del estudiante | Radicado secuencial; `CHECK` de categoría (las dieciséis de la ayuda), tipo y estado; la unificada apunta al radicado inicial |

### 3.2 Catálogos oficiales

El modelo **no admite texto libre** en ocupación, actividad económica,
ubicación ni nivel educativo. Son tablas de referencia con llave foránea:

| Tabla | Catálogo |
|---|---|
| `cat_cno` | CNO / CIUO-08 A.C. |
| `cat_ciiu` | CIIU Rev. 4 A.C. |
| `cat_divipola` | DIVIPOLA (DANE) |
| `cat_nivel_educativo` | Lista tasada de niveles educativos |
| `cat_escuela` | Escuelas de la CUN |

Los catálogos se cargan con un **ingestor con verificación de completitud**
(`npm run catalogos:cargar`), no con semillas sueltas. El manifiesto
`catalogos/manifiesto.json` declara para cada catálogo su fuente oficial, su URL
y su **estado real**, y el ingestor **falla** si un catálogo se declara
`completo` y el conteo no coincide.

| Catálogo | Estado | Cobertura |
|---|---|---|
| DIVIPOLA — departamentos | completo | 33 de 33 |
| DIVIPOLA — municipios | **parcial** | 81 de 1.122 |
| CIIU Rev. 4 A.C. | **parcial** | 21 de 21 secciones · 90 de 525 clases |
| CNO / CIUO-08 A.C. | **parcial** | 10 de 10 grandes grupos · 106 de 436 ocupaciones |
| Niveles educativos | completo | 11 de 11 |

**Por qué están parciales y no inventados.** Los archivos del DANE no son
alcanzables desde el entorno de construcción, y el único espejo público
disponible no trae los códigos oficiales. Fabricar 1.122 códigos DIVIPOLA de
memoria habría producido un catálogo que se ve completo y está mal: sobre él se
construyen reportes que se radican ante una entidad y quedan en firme.

La decisión fue **construir el mecanismo y declarar la carencia**, no simularla.
Reemplazar un catálogo es sustituir su CSV, ajustar el manifiesto y volver a
ejecutar el ingestor.

### 3.3 Restricciones que viven en la base

La aplicación no es la única línea de defensa. El motor rechaza:

```sql
-- Una práctica activa sin afiliación anterior al inicio no puede existir.
CONSTRAINT ck_practicas_compuerta_arl CHECK (
  estado <> 'activa'
  OR modalidad IN ('validacion_experiencia', 'combinacion_funciones')
  OR (arl_verificada
      AND arl_fecha_afiliacion IS NOT NULL
      AND fecha_inicio IS NOT NULL
      AND arl_fecha_afiliacion::date < fecha_inicio::date)
)

-- Una decisión sin justificación no es una decisión.
CONSTRAINT ck_documentos_justificacion CHECK (
  estado NOT IN ('aprobado','rechazado') OR justificacion_decision IS NOT NULL
)

-- Vigencia máxima de seis meses (Resolución 2605 de 2014).
CONSTRAINT ck_vacantes_vigencia CHECK (
  vigente_hasta IS NULL OR publicada_en IS NULL
  OR vigente_hasta <= publicada_en + interval '6 months'
)
```

### 3.4 El estado de los catálogos bloquea los reportes

`cat_estado` no es metadata decorativa. El módulo M9 la consulta antes de emitir
cualquier archivo para la Unidad del SPE:

- En `dev` y `qa` genera igual, con **advertencias** y marcado como borrador,
  para poder trabajar el formato.
- En `pre` y `prod` **se niega a generar** mientras un catálogo requerido —CNO,
  CIIU, DIVIPOLA de municipios, niveles educativos— siga incompleto.

Un archivo con códigos fuera de la nomenclatura oficial se radica, queda en
firme y luego hay que corregirlo ante la entidad. Es más barato no emitirlo.

```bash
npm run catalogos:estado   # informe de cobertura; sale con código 1 si falta alguno
```

### 3.5 Migraciones

`synchronize: true` está **prohibido**. El esquema se gobierna exclusivamente
por migraciones numeradas y ejecutables en secuencia:

| Migración | Contenido |
|---|---|
| `1756000000000-EsquemaInicial` | Catálogos, tablas operativas, índices, restricciones y disparador de inmutabilidad |
| `1756000001000-RolAplicacionMinimoPrivilegio` | Rol `sipra_app` con los permisos estrictamente necesarios |
| `1756000002000-CatalogosYEstado` | Departamentos, jerarquía de CNO y CIIU, y la tabla `cat_estado` que gobierna el bloqueo de reportes |
| `1756000003000-ParametrosOperativos` | Tabla `parametros` (M12) |
| `1756000004000-ModalidadesRealesYEtapas` | Modalidades vigentes de la CUN y etapas del expediente |
| `1756000005000-ProcesoBaseSgp` | `permiso` en usuarios, rol `auxiliar`, estados `anulada` y `reprobada`, tabla `periodos_academicos` |
| `1756000006000-FormularioUnicoRegistro` | Columnas del FUR, consecutivo `numero_fur`, unicidad por periodo, tabla `cartas_presentacion` |
| `1756000007000-BitacoraYCierre` | Tabla `bitacora_entradas` (solo agregar), «Evalúa tu proceso» único, coherencia del cierre |
| `1756000008000-SolicitudesArl` | Tabla `solicitudes_arl` con una solicitud viva por práctica |
| `1756000009000-CronogramaYPqrs` | Calendario `335`, columnas de cronograma en periodos, ventana `solicitud_arl` derivada del registro FUR, cuatro tipos documentales nuevos, tabla `pqrs` |

---

## 4. Catálogo de estados y transiciones

### 4.1 Práctica

```
  inscrita ──► documentacion ──► en_validacion ──►[ARL]──► activa ──► finalizada ──► certificada
     │              │                  │                      │
     │              │                  │                      ▼
     │              │                  │                 suspendida ──► activa
     │              │                  │                      │
     └──────────────┴──────────────────┴──────────────────────┴──► cancelada
     │
     └──► finalizada   (arista prevista para modalidades sin afiliación nueva;
                        hoy ningún caso de uso la invoca: ver sección 15)
```

`[ARL]` marca la compuerta: el paso de `en_validacion` a `activa` exige
afiliación verificada con fecha **anterior** al inicio. Ninguna configuración
ni rol la omite. Las únicas exenciones son la validación de experiencia
laboral y la combinación de funciones, porque la persona ya está afiliada por
su empleador y no hay afiliación nueva que verificar.

Estados terminales: `certificada` y `cancelada`.

### 4.2 Documento

```
  recibido ──► analizando ──┬──► auto_aprobado ──► aprobado
                            ├──► en_revision   ──► aprobado | rechazado
                            ├──► ilegible      ──► (reenvío)
                            └──► devuelto      ──► (reenvío)
```

**`ilegible` y `rechazado` son estados distintos.** Un documento ilegible se
devuelve para reenvío con motivo en lenguaje comprensible; no constituye una
decisión negativa sobre el estudiante. La distinción es normativa, no cosmética.

### 4.3 Empresa

```
  solicitud_recibida ──► en_verificacion ──┬──► habilitada ──► suspendida ──► habilitada
                              ▲            ├──► requiere_info ──┘
                              └────────────┴──► rechazada  (terminal)
```

### 4.4 Vacante y postulación

```
  Vacante:      borrador ──► en_validacion ──► publicada ──► reportada_spe ──► cerrada | vencida
  Postulación:  postulado ──► en_revision_empresa ──► preseleccionado ──► remitido ──► colocado | descartado
```

`remitido` y `colocado` son los únicos eventos que alimentan el informe mensual
al SPE. El resto es operación interna.

---

## 5. Matriz de roles y permisos

| Operación | Estudiante | Docente facilitador (tutor) | Coordinador | Auxiliar | Administrador | Empresa | Extensión |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Ver su propio expediente | ✓ | — | — | — | — | — | — |
| Ver expedientes de su escuela | — | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Ver expedientes de sus practicantes | — | — | — | — | — | ✓ | — |
| Registrar la práctica (FUR) | ✓ | — | ✓ (administrativo) | — | ✓ | — | — |
| Generar carta de presentación | ✓ (en ventana) | ✓ | ✓ | ✓ | ✓ | — | — |
| Editar la vacante (no modalidad ni fechas) | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Cargar documentos | ✓ | ✓ | ✓ | — | ✓ | — | — |
| Decidir sobre documentos | — | ✓ | ✓ | — | ✓ | — | — |
| Aprobar el plan de mejoramiento | — | ✓ | ✓ | — | — | — | — |
| Escribir en la bitácora | mensaje, «Evalúa tu proceso» | todos los tipos | mensaje, plazo, calificación | — | mensaje, plazo, calificación | — | — |
| Calificar y cerrar | — | ✓ (asignado) | ✓ | — | ✓ | — | — |
| Radicar solicitud de ARL | ✓ | — | ✓ | ✓ | ✓ | — | — |
| Decidir solicitud de ARL | — | ✓ | ✓ | ✓ | ✓ | — | — |
| Remitir certificado de ARL | — | — | ✓ | ✓ | ✓ | — | — |
| Ver puntaje y banderas internas | — | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Cambiar el estado de la práctica | — | ✓ | ✓ | — | ✓ | — | — |
| Registrar afiliación a ARL | — | — | ✓ | ✓ | ✓ | — | — |
| Asignar tutor / sincronizar docentes | — | — | ✓ (área) | — | ✓ | — | — |
| Gestión de usuarios y de periodos | — | — | ✓ (área) | — | ✓ | — | — |
| Reportes del SGP | — | ✓ (su alcance) | ✓ | ✓ | ✓ | — | — |
| Habilitar empresas | — | — | — | — | ✓ | — | — |
| Publicar vacantes | — | — | — | — | ✓ | ✓ | ✓ |
| Consultar la auditoría | — | — | — | — | ✓ | — | — |

Además del rol, cada usuario administrativo lleva un **permiso** de `consulta` o
`escritura` (SGP, gestión de usuarios). El permiso viaja en el token y una guardia
global (`permiso-escritura.guard.ts`) rechaza toda operación de escritura de un
usuario de consulta, sin importar la ruta.

**Alcance de visibilidad** (`domain/value-objects/rol.vo.ts`):

| Rol | Alcance |
|---|---|
| Estudiante | Solo el expediente cuyo `estudiante_id` coincide con su identidad |
| Empresa | Solo expedientes cuyo `empresa_id` coincide con su organización |
| Tutor | Sus asignados más las escuelas de su alcance |
| Coordinador | Las escuelas de su alcance; **sin escuelas es la coordinación del Área de Prácticas**, con alcance institucional |
| Auxiliar, Administrador, Extensión | Institucional |

---

## 6. Modelo de seguridad

### 6.1 Principios aplicados

**La identidad se resuelve siempre desde el token de sesión, nunca desde un
parámetro del cliente.** `JwtAuthGuard` construye el actor exclusivamente a
partir del JWT verificado; no existe forma de pedir «actuar como otro».

**El alcance se aplica acotando la consulta, no filtrando resultados.**
`PracticaRepositoryAdapter.condiciones()` traduce el alcance a condiciones SQL:
un expediente fuera del alcance nunca sale de la base.

**El filtrado de columnas ocurre en el servidor.** El estudiante no recibe el
puntaje de riesgo ni las banderas internas porque no se le envían — no se le
ocultan en la interfaz.

**Errores genéricos.** Un expediente fuera de alcance devuelve `404 Expediente
no encontrado`, idéntico al de un expediente inexistente: la respuesta no
confirma la existencia del registro. El intento queda en auditoría.

### 6.2 Defensa en profundidad

| Control | Aplicación | Base de datos |
|---|:--:|:--:|
| Compuerta ARL | `Practica.verificarCompuertaArl()` | `CHECK ck_practicas_compuerta_arl` |
| Decisión con justificación | `DecisionSinJustificacionError` | `CHECK ck_documentos_justificacion` |
| Auditoría inmutable | Solo se escribe hacia adelante | Disparador + revocación de `UPDATE`/`DELETE` |
| Catálogos sin texto libre | Validación de DTO | Llaves foráneas |
| Vigencia de vacantes | `Vacante.publicar()` | `CHECK ck_vacantes_vigencia` |

Verificación ejecutada contra la base real, incluso como superusuario:

```
UPDATE auditoria  → ERROR: La tabla auditoria es inmutable: no admite UPDATE
DELETE FROM auditoria → ERROR: La tabla auditoria es inmutable: no admite DELETE
INSERT práctica activa sin ARL → ERROR: viola ck_practicas_compuerta_arl
```

### 6.3 Mínimo privilegio en la base

El rol `sipra_app` recibe:

| Objeto | Permisos |
|---|---|
| Tablas operativas | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| Catálogos | `SELECT` |
| `auditoria` | `SELECT`, `INSERT` — **nunca** `UPDATE` ni `DELETE` |

### 6.4 Superficie pública

**Política de acceso obligatoria (0.17.3).** Toda ruta declara exactamente una de
`@Publico()`, `@Autenticado()` (cualquier sesión) o `@Roles(...)`. `RolesGuard`
**rechaza** la ruta que no declare ninguna: olvidar `@Roles` ya no abre el acceso.
`test/autorizacion-rutas.spec.ts` recorre todos los controladores y falla ante
una ruta sin política o ante una ruta pública nueva que no se haya decidido allí.

Rutas sin sesión (las únicas): `auth/modo`, `auth/perfiles` y `auth/ingresar`
(solo con el ingreso abierto de `dev`), `auth/oidc/inicio` y `auth/oidc/callback`,
`empresas/solicitudes`, `empresas/nit/verificar`, `salud`, `documentos/descarga`
(la firma es la credencial, §6.5), `trabajos/procesar` (solo con `cloud_tasks`,
token de servicio) y `metrics` (token de scraping).

- **`/metrics`** existe solo con `METRICAS_HABILITADAS=true` **y** `METRICAS_TOKEN`
  (≥ 32 caracteres, `Authorization: Bearer`, comparación en tiempo constante); si
  falta cualquiera responde 404. Fuera de `dev` el token es obligatorio al arrancar
  (o `METRICAS_HABILITADAS=false`). nginx tampoco lo publica por el origen web.
- **`/trabajos/procesar`** solo responde con `COLA_DRIVER=cloud_tasks`, y exige un
  id_token de la cuenta de servicio emitido para `WORKER_URL`. Con la cola en
  proceso el trabajo corre dentro del servicio y el endpoint no existe (404).
- **Swagger** (`/docs/dev-only/swagger`) solo con `SIPRA_AMBIENTE=dev`.

**El formulario de solicitud de empresa es la superficie expuesta sin
autenticación que recibe datos.** Realiza una sola operación: insertar una solicitud. Protegido
con campo trampa (`sitioWebAlterno`) y validación de NIT.

La respuesta es **idéntica en todos los casos, incluso cuando el NIT ya está
registrado**. Confirmarlo convertiría el formulario en un verificador público
de qué empresas trabajan con la institución y permitiría enumerarlas.

Una solicitud no es una organización: mientras el administrador no apruebe, no
hay tenant, ni usuario, ni acceso.

### 6.5 Documentos

- Verificación del tipo real por **firma binaria**, no por extensión ni por
  encabezado declarado.
- Ruta de almacenamiento **no adivinable**: 16 bytes aleatorios por documento.
- Enlaces firmados de vigencia corta (10 minutos por defecto), **siempre por la
  API** (ya no se usa la URL firmada nativa del bucket, que no podría auditarse).
  El enlace firma `documento + usuario + vencimiento` con una **clave derivada y
  exclusiva** (no `JWT_SECRETO` directo), se verifica con `timingSafeEqual` y no
  lleva la ruta de almacenamiento. Al descargar se vuelve a comprobar el estado
  actual del usuario y su acceso al documento.
- Buckets privados con `--public-access-prevention` verificado en el
  aprovisionamiento.
- **Generar el enlace ≠ descargar:** emitirlo audita `documento_visualizado`
  (`etapa: enlace_generado`); la entrega real audita `documento_descargado`, con el
  usuario del enlace, la IP y el agente. Si el archivo no se entrega, no hay
  descarga registrada.
- La firma y la ruta se **redactan** de los registros (`observability/redaccion-logs.ts`).
- **Acceso por función** (`domain/value-objects/acceso-documental.vo.ts`), además de la
  visibilidad de la práctica:

  | Rol | Documentos |
  |---|---|
  | Estudiante, docente, coordinación, administración | Todos los de su alcance |
  | Auxiliar | Solo `certificado_eps`, `cedula`, `acta_inicio`, `rut_natural`, `rut_juridico`, `camara_comercio`, `certificado_arl` (el resto responde 404) |
  | Empresa, extensión | Ninguno |

  Cargan documentos: estudiante, docente, coordinación y administración.

### 6.6 Protección de datos personales

**La medida de protección más eficaz es no conservar el dato.** Las imágenes de
documentos de identidad se purgan a los 30 días de validadas; se conservan
únicamente el hash y el resultado de la validación. La purga la ejecuta un
proceso programado (`TareasProgramadasService.purgarPorRetencion`).

Ningún dato personal real entra en desarrollo: las semillas son sintéticas y
así queda declarado en el propio archivo.

---

## 7. Pipeline de validación documental

### 7.1 Premisa que gobierna el diseño

**La inteligencia artificial no detecta documentos falsos.** Un modelo al que
se le pregunta si un certificado es auténtico responde con seguridad y con
frecuencia se equivoca, en ambas direcciones. La alteración no reside en los
píxeles: reside en los metadatos y en el contraste con fuentes externas.

Lo que la IA hace bien es **extraer** información y **razonar coherencia**. La
detección de irregularidades la realizan capas determinísticas.

### 7.2 Capas implementadas

| Capa | Qué hace | Usa IA |
|:--:|---|:--:|
| 0 | Hash SHA-256, tipo real por firma binaria, DV del NIT, métricas de captura | No |
| 1 | Metadatos del PDF: productor, `%%EOF` múltiples, tipografías, capa de texto | No |
| 2 | Extracción estructurada con confianza por campo y evidencia textual | Sí |
| 3 | Coherencia cruzada entre documentos de una misma práctica | No |
| 4 | Verificación externa: RUES por NIT | No |
| 5 | Puntaje 0–100 en tres bandas y decisión humana | No |

**Una bandera crítica cortocircuita el pipeline antes de la capa 2: no se
consumen tokens.** Ejemplo verificado: un certificado de ARL cuyo productor
declarado es `Microsoft Word 2019` obtiene puntaje 30, banda roja y `en_revision`
sin llamar al modelo.

### 7.3 Bandas y decisión

| Banda | Puntaje | Resultado |
|---|---|---|
| Verde | ≥ 85 | `auto_aprobado` — sin intervención humana |
| Amarillo | 60–84 | `en_revision` |
| Rojo | < 60 | `en_revision` con bloqueo |

**Nunca hay rechazo automático.** La banda roja escala a revisión humana; no
rechaza por sí sola.

### 7.4 La cola de trabajo y el pico de cierre

El sistema **no se dimensiona por promedio sino por pico**: 40.000 a 50.000
documentos en las dos últimas semanas del periodo.

El cargue ya no ejecuta el pipeline en línea: lo **encola**. Y son dos colas
separadas, no una con prioridades:

| Cola | Qué atiende | Por qué separada |
|---|---|---|
| `interactiva` | El cargue en curso, con una persona esperando | Cloud Tasks no ordena por prioridad dentro de una cola: la separación es la única forma real de que el estudiante que carga el último día no quede detrás del lote nocturno |
| `lote` | Procesamiento diferido, purgas, reportes | — |

| Ambiente | Adaptador |
|---|---|
| `dev`, `qa` | Cola en proceso, con las mismas dos prioridades y reintentos con espera creciente |
| `pre`, `prod` | **Cloud Tasks obligatorio** — la validación de configuración rechaza el arranque con la cola en proceso |

El worker (`POST /api/v1/trabajos/procesar`) no lo llama un usuario: lo llama la
cola con un **id_token OIDC de la cuenta de servicio**, que se verifica contra
las claves de Google antes de ejecutar nada.

Ambos caminos —cola en proceso y Cloud Tasks— entran por el mismo caso de uso,
que es lo que hace que el comportamiento observado en local sea el mismo que en
Google Cloud.

**Consecuencia de diseño que costó un ajuste.** Al encolar, el aviso al
estudiante ya no puede emitirse en el cargue: en ese momento todavía no se sabe
si el documento quedará devuelto o ilegible. El aviso vive ahora al **final** del
pipeline, donde el resultado existe. La interfaz consulta con espera creciente
hasta ver el estado real, en vez de mostrar uno supuesto.

### 7.5 Hash perceptual: la planilla reutilizada

El hash criptográfico detecta el **mismo archivo**. Basta recomprimir la foto o
recortarle un borde para burlarlo.

El hash perceptual detecta la **misma imagen**: es un dHash de **128 bits** —64
del gradiente horizontal y 64 del vertical—. Solo el horizontal sería frágil con
documentos de líneas horizontales, como una planilla rayada, donde casi todos
los vecinos laterales son iguales y el hash degenera en ceros.

**Guarda de entropía.** Un hash con muy pocos bits en 1 corresponde a una hoja
casi en blanco y se parecería a cualquier otra igual de vacía. Esos hashes se
descartan: sin la guarda, dos escaneos vacíos se acusarían mutuamente de
reutilización.

Verificado de extremo a extremo: la misma planilla cargada por dos estudiantes
distintos, reescalada a la mitad y aclarada —archivo distinto, SHA-256
distinto—, se detecta con **distancia perceptual 2 de 128**, se marca como
bandera crítica y cae a banda roja. Un documento genuinamente distinto no se
marca.

Las imágenes se decodifican sin dependencias nativas: PNG completo, y JPEG
mediante un decodificador **de solo coeficientes DC**, que da un píxel por cada
bloque de 8×8 sin necesidad de la transformada inversa del coseno. Es
exactamente la resolución que el hash necesita.

### 7.6 Saneamiento de PDF

Un PDF puede llevar JavaScript, acciones que se ejecutan al abrirlo, archivos
embebidos y formularios que envían datos a un servidor externo. Guardar eso en
un repositorio institucional y servirlo después a un tutor es exponerlo.

Se neutralizan: `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch`,
`/EmbeddedFile`, `/EmbeddedFiles`, `/SubmitForm` y `/RichMedia`.

Dos decisiones que hacen que esto sea seguro de aplicar:

1. **Se reemplaza el nombre de la clave conservando su longitud**, para no
   invalidar las tablas de referencias cruzadas del PDF, que son
   desplazamientos absolutos en bytes.
2. **El hash criptográfico se calcula sobre el ORIGINAL**, antes de sanear. El
   valor probatorio se preserva en ese hash; lo que se almacena y se sirve es la
   copia neutralizada. Qué se neutralizó queda en la auditoría del cargue.

### 7.7 El tercer resultado

El pipeline tiene **tres** resultados, no dos. Cuando la extracción no alcanza
confianza suficiente, el resultado es `ilegible` con solicitud de reenvío.

**No se emplea IA generativa para mejorar o reconstruir un documento ilegible.**
Los modelos de super-resolución no recuperan información: la generan. Un dígito
borroso se convierte en otro dígito con plena confianza visual. Sobre un
documento con valor probatorio, eso es fabricación de evidencia.

En su lugar, en orden de efectividad, y los tres ya implementados:

1. **Prevención en la captura.** `CapturaGuiadaService` calcula en el navegador
   la varianza del Laplaciano, la luminancia media, el porcentaje de píxeles
   saturados y la resolución. Una imagen fuera de foco se detiene en el
   dispositivo, sin consumir ancho de banda ni tiempo de revisión.
2. **Preprocesamiento determinístico** (sección 7.12).
3. **Lectura del PDF417 de la cédula** (sección 7.13).

El servidor vuelve a evaluar las métricas de captura: la validación en el
dispositivo es una comodidad para el estudiante, no un control de seguridad.

### 7.8 Prompt de extracción

El prompt (`construirPrompt`) prohíbe explícitamente:

1. Emitir juicio sobre autenticidad, validez o legitimidad.
2. Inferir caracteres por probabilidad o parecido visual — si no se lee con
   certeza, `valor: null` y `confianza: 0`.
3. Completar, corregir o normalizar valores que no aparezcan literalmente.
4. Usar conocimiento externo para rellenar campos ausentes.

La salida es estructurada, con confianza por campo y **evidencia textual** que
indica dónde se encontró cada dato.

### 7.9 Límite explícito de la automatización

**El plan de mejoramiento lo aprueba el tutor académico. La IA no lo aprueba ni
lo rechaza en ninguna circunstancia.** El límite se declara expresamente porque
constituye el supuesto de decisión automatizada que la normativa de protección
de datos obliga a controlar, y se hace cumplir en
`GestionarDocumentoUseCase.decidir()`.

La función de la IA aquí es **preparar la lectura, no sustituirla**.

### 7.10 Reglas de coherencia cruzada implementadas

| Código | Regla | Severidad |
|---|---|---|
| `C3_NIT_INCONSISTENTE` | El NIT difiere entre documentos | Alta |
| `C3_NIT_NO_CORRESPONDE_EMPRESA` | El NIT leído no corresponde a la empresa registrada | Alta |
| `C3_ARL_NO_ANTERIOR_AL_INICIO` | La afiliación no es anterior al inicio | **Crítica** |
| `C3_FIRMANTE_DISCREPANTE` | El firmante de la planilla no es el jefe declarado | Media |
| `C3_AFILIADO_NO_CORRESPONDE` | El afiliado no es el estudiante matriculado | Alta |
| `C3_CERTIFICADO_EXISTENCIA_VENCIDO` | Certificado de existencia con más de 90 días | Media |

### 7.12 Preprocesamiento determinístico: el segundo intento

Antes de devolverle un documento al estudiante, el pipeline agota el recurso
determinístico. Sobre una **copia** —el original queda intacto— aplica, en este
orden:

| Operación | Qué resuelve |
|---|---|
| **Enderezamiento** | Busca el ángulo que maximiza la varianza del perfil de proyección: en un documento derecho los renglones producen picos marcados, y al inclinarse se difuminan |
| **Recorte de bordes** | Elimina el margen sin contenido. Solo si gana más del 5 %, para que la operación sea idempotente y no se coma el documento en cada pasada |
| **Ecualización adaptativa** | Corrige la foto con sombra en una esquina. Por regiones con límite de amplificación, porque la ecualización global sube el ruido de la zona clara para compensar la oscura |
| **Binarización local** | Umbral por media de vecindad. El umbral global deja media hoja en negro cuando la iluminación es despareja |

**Cada paso registra sus parámetros exactos**, de modo que la operación es
reproducible y auditable. Si el segundo intento tampoco alcanza, el documento se
devuelve con la bandera `C2_LEGIBLE_TRAS_PREPROCESO` ausente: el sistema no se
atribuye un éxito que no tuvo.

Esto **no es super-resolución**. Reorganiza píxeles existentes; no genera
ninguno. La distinción es la que separa el preprocesamiento legítimo de la
fabricación de evidencia.

### 7.13 El código PDF417 de la cédula

Un OCR sobre una cédula fotografiada puede confundir un 8 con un 3 y devolverlo
con alta confianza. El PDF417 no: lleva corrección de errores Reed-Solomon, de
modo que o los datos se leen correctamente o la lectura falla.

Cuando el documento es una cédula y trae su código legible, **el pipeline
termina ahí**: no llama a la IA. Los datos salen con confianza 1 y la evidencia
declara su procedencia.

**Reparto de responsabilidades.** La decodificación la hace **ZXing** compilado
a WebAssembly. Escribir a mano un decodificador PDF417 —tablas de agrupamiento
y aritmética de Reed-Solomon sobre GF(929)— sin poder probarlo contra cédulas
reales habría sido una fuente de datos falsos con apariencia de certeza. Sobre
un documento de identidad eso es inaceptable. La prueba de ida y vuelta genera
un PDF417 real y lo lee: el camino completo está verificado.

> **Incógnita declarada.** Las **posiciones de los campos** dentro de la trama
> de la Registraduría no están confirmadas. Viven en una sola constante,
> `DISPOSICION_TRAMA`, con `confirmada: false`.
>
> Mientras siga así, el sistema usa **únicamente el número de documento** —que
> se localiza por patrón y se comprueba con el dígito NUIP— y entrega los
> nombres con **confianza 0**. La comparación con el estudiante matriculado
> devuelve `null` en vez de `false`: acusar a alguien de presentar la cédula de
> otro, con nombres leídos de posiciones supuestas, sería mucho peor que no
> comprobar nada.

### 7.14 Documentos de mayor riesgo

Dos documentos concentran el riesgo, y ambos por la misma razón: los producen
partes interesadas y no tienen contraste externo.

**La planilla de horas** se entrega al final del periodo, firmada por el jefe de
área, sin evidencia intermedia que la respalde. El control de mayor efectividad
esperada es puramente determinístico: detección de planillas repetidas entre
estudiantes, vía `C0_HASH_DUPLICADO` para el archivo idéntico y
`C0_IMAGEN_REUTILIZADA` para la misma imagen reeditada (sección 7.5).

**La certificación laboral para homologación** es el punto de mayor riesgo de
fraude del sistema: el estudiante puede producir tanto la certificación como la
planilla de aportes.

---

## 8. Cumplimiento normativo

### 8.1 El motor de obligaciones

**Una obligación no es una validación sobre un documento: es un estado con
fecha límite que puede estar vencido sin que nadie haya cargado nada.** El
sistema las crea automáticamente al abrirse la práctica.

| Obligación | Norma | Responsable | Vencimiento | Efecto |
|---|---|---|---|---|
| Afiliación a ARL | Decreto 055 de 2015 | CUN | Inicio menos un día | **Bloquea `activa`** |
| Certificación de práctica | Ley 2043 de 2020 | Empresa | 30 días tras finalizar | Bloquea `certificada` |
| Reporte de plaza de práctica | Ley 1780 de 2016, art. 17 | CUN | Diario | Alerta |
| Autorización de tratamiento | Ley 1581 de 2012 | Estudiante | Al registrarse | Bloquea el cargue |

Semáforo del tablero: vencida · crítica (≤3 días) · alerta (≤10 días) ·
vigente · cumplida.

### 8.2 La particularidad de la ARL en la CUN

La afiliación y el pago los realiza la institución, no la empresa. El
certificado de ARL **no es un documento susceptible de falsificación externa**:
es un documento generado internamente.

El riesgo se desplaza de fraude a **omisión** — practicantes que inician sin
afiliación, o afiliados el mismo día — y por eso el control es una compuerta, no
una validación documental.

### 8.3 Filtro antidiscriminación

**Es un bloqueo, no una advertencia.** Ocho categorías con su norma:

| Categoría | Norma |
|---|---|
| Edad | Ley 931 de 2004 |
| Sexo | Ley 1496 de 2011 · Ley 823 de 2003 |
| Fotografía | Resolución 2605 de 2014 |
| Raza | Ley 1482 de 2011 |
| Religión | Constitución Política, art. 19 |
| Origen, estado civil, apariencia | Constitución Política, art. 13 |

Cada bloqueo se registra en auditoría como evidencia de la validación aplicada.

### 8.4 Separación de marcos en la bolsa

Una única tabla de vacantes con un campo que distingue el marco aplicable:

- **`practica`**: requisito académico. No constituye intermediación laboral y
  **no entra** en el reporte de vacantes.
- **`laboral`**: intermediación laboral. Entra en el reporte diario al SPE.

Esta distinción acota la obligación regulatoria mediante un campo, sin
fragmentar la arquitectura.

### 8.5 Dependencia bloqueante

> **El módulo de bolsa de empleo queda construido pero NO debe activarse
> públicamente sin el acto administrativo de modificación de la autorización
> ante la Unidad del Servicio Público de Empleo.**

El componente tecnológico hace parte del expediente de autorización. La
sustitución de la plataforma actual por desarrollo propio exige radicar la
solicitud de modificación. **Esta gestión debe iniciarse en paralelo al
desarrollo, no al final.** Responsables: Extensión y Jurídica.

### 8.6 Reportes al Servicio Público de Empleo (M9)

Archivos planos con separador `|$$|`, generados desde
`GET /api/v1/reportes/spe/vacantes` y `/plazas`.

| Archivo | Contenido | Norma |
|---|---|---|
| Vacantes | Solo marco **laboral**; el marco práctica no constituye intermediación y no se reporta | Resolución 2605 de 2014 |
| Plazas de práctica | Prácticas ya iniciadas | Ley 1780 de 2016, art. 17 |

Cuatro decisiones que sostienen este módulo:

**El orden y la composición de los campos viven en una sola lista.**
`CAMPOS_VACANTE` y `CAMPOS_PLAZA` son el punto único a conciliar contra el
anexo técnico, de modo que ajustarlo sea editar una lista y no reescribir el
módulo.

**Un archivo no conciliado se marca por dentro.** Mientras
`SPE_ANEXO_CONFIRMADO=false`, el archivo lleva en su cabecera
`# BORRADOR_SIN_ANEXO_CONFIRMADO` y la advertencia de no radicar. Si alguien lo
radica por error, la marca queda visible para la entidad receptora. La respuesta
además viaja con `x-sipra-radicable: false`.

**Las vacantes no se marcan como reportadas sobre un borrador.** Hacerlo haría
que esa vacante nunca volviera a salir en el archivo definitivo.

**El separador se sanea en los valores.** Un `|$$|` incrustado en una
descripción partiría la fila y desplazaría todas las columnas siguientes en el
sistema receptor. También se eliminan saltos de línea y tabuladores.

Cada generación queda en la auditoría con el **hash SHA-256 del archivo
producido**, que es lo que se conserva junto al acuse para poder demostrar
después qué se envió exactamente.

> **Dependencia declarada.** La estructura exacta la fija el anexo técnico
> vigente aplicable a prestadores con plataforma propia, que conserva la
> Dirección de Extensión. Hasta que se concilie, lo generado es un **borrador
> verificable, no un radicable**.

### 8.7 Notificaciones (M10)

Las plantillas viven en el **dominio**, no en el adaptador de correo: el texto
que recibe un estudiante es una decisión de producto, no de infraestructura.

| Ambiente | Canal |
|---|---|
| `dev`, `qa` | Consola: el aviso se escribe en el registro |
| `pre` | Google Workspace, opcional |
| `prod` | **Google Workspace obligatorio** — la validación de configuración rechaza el arranque con el canal de consola, porque un aviso en el registro del servidor no le sirve de nada al estudiante |

El envío usa la **API de Gmail con cuenta de servicio y delegación en todo el
dominio**, que permite enviar «como» la cuenta institucional sin conocer su
contraseña. El JWT se firma con `node:crypto`: son treinta líneas frente al SDK
completo de Google, cuya superficie excede con mucho lo que este servicio
necesita.

**Cada intento de envío queda en la auditoría**, haya salido bien o mal. Ante un
reclamo hay que poder decir si se avisó al estudiante y cuándo. Que el correo
falle nunca tumba la operación que lo originó: el documento ya se procesó y su
estado es correcto.

Ocho eventos con plantilla: documento devuelto, documento ilegible, documento
aprobado, obligación por vencer, práctica activada, empresa habilitada,
invitación de empresa y certificado emitido.

**Dos detalles que hacen la diferencia en el texto:**

*La devolución explica qué corregir.* Un mensaje que solo dice «documento
rechazado» genera una llamada al conmutador y traslada al estudiante el costo de
averiguar qué pasó. El aviso de ilegible además **aclara que no es un rechazo**,
porque `ilegible` y `rechazado` son estados distintos y el correo tiene que
reflejarlo.

*Concordancia de género.* Los tipos documentales llevan su género gramatical.
Sin eso, un mensaje sobre una planilla termina diciendo «vuelva a cargarlo», y
un correo institucional mal escrito resta credibilidad a lo que dice.

### 8.8 Auditoría

Registro inmutable de: cada visualización y descarga con identificación del
actor; cada decisión con su justificación; cada emisión de certificado; cada
validación antidiscriminación aplicada a una vacante; cada acceso fuera de
alcance.

Detección de uso anómalo: alerta cuando un usuario consulta más de 40
expedientes en una hora. **No bloquea: notifica.**

---

## 9. Autenticación y el modo abierto de pruebas

### 9.1 La decisión

En **desarrollo local** el ingreso puede hacerse **eligiendo un perfil, sin
contraseña**, para probar el sistema completo sin fricción. Desde 0.17.2 es el
**único** ambiente donde existe: `qa`, `pre` y `prod` solo admiten el ingreso
institucional (si `qa` aún no tiene credenciales OIDC, no arranca con
autenticación funcional antes que abrirse).

El riesgo de ese modo es que viaje a otro ambiente por descuido, o que se active
por una variable omitida. **El diseño lo impide.**

El modo abierto exige **las tres condiciones a la vez**:

```
SIPRA_AMBIENTE=dev
AUTH_MODO=abierto
AUTH_ABIERTO_CONFIRMADO=true
```

`SIPRA_AMBIENTE` y `AUTH_MODO` **no tienen valor por defecto**: si falta
cualquiera de las dos, el arranque falla. No hay ningún respaldo implícito a
`dev` ni a `abierto`. `ingresoAbiertoPermitido()` aplica la misma regla en el
arranque y en `AuthController` (`perfiles`, `ingresar` y `GET /auth/modo`).

### 9.2 Cómo se impide

`infrastructure/config/configuracion.ts` valida el entorno al arranque y
**rechaza el arranque** si:

- `AUTH_MODO=abierto` en cualquier ambiente distinto de `dev`, o en `dev` sin
  `AUTH_ABIERTO_CONFIRMADO=true`;
- `AUTH_MODO` o `SIPRA_AMBIENTE` sin declarar;
- `STORAGE_DRIVER` no es `gcs` en `pre` o `prod`;
- la conexión a la base no va por TLS ni por el socket de Cloud SQL;
- el `JWT_SECRETO` conserva el valor de la plantilla;
- `AUTH_MODO=oidc` sin `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` o `OIDC_REDIRECT_URI`.

Un ambiente mal configurado falla al arrancar, no en la primera petición de un
usuario.

### 9.3 Por qué activar OIDC no cuesta nada

`IngresarAbiertoUseCase` y el flujo OIDC **emiten exactamente el mismo token**.
El resto del sistema —guards, alcance, auditoría, casos de uso— no distingue
entre ambos. Activar Google Workspace es cambiar `AUTH_MODO` y cargar el
cliente OIDC: **no exige tocar una sola línea de lógica de negocio**, ni en el
backend ni en el frontend.

El frontend consulta `GET /auth/modo` y muestra el selector de perfil o el botón
de Workspace según lo que responda **el servidor**. No hay bandera del cliente
que pueda cambiarlo.

### 9.4 OIDC contra Google Workspace

Implementado en `OidcService`, sin dependencias adicionales: verificación RS256
con `node:crypto` contra las claves publicadas por Google. Valida emisor,
audiencia, vencimiento, `nonce` (obligatorio), correo verificado y **dominio
institucional**. El perfil se resuelve contra la base, no contra el token: una
cuenta de Workspace sin perfil activo en SIPRA no entra.

El retiro de un usuario del directorio revoca su acceso automáticamente **en el
siguiente ingreso**: la sesión ya emitida vive hasta su vencimiento (ver §9.7).

#### Flujo (0.17.2)

```
SPA /ingreso ── GET /auth/oidc/inicio ──▶ API: {url, state firmado}
SPA guarda el state completo en sessionStorage ── redirige a Google
Google ── GET /ingreso/callback?code&state ──▶ SPA (IngresoCallbackComponent)
SPA: compara state recibido == guardado · borra code/state de la URL
SPA ── POST /auth/oidc/callback {code, state} ──▶ API
API: verifica firma y vigencia del state · canjea el código · exige el nonce
API ──▶ SPA: SesionDto · establecer() · borra el state temporal · /inicio
```

`OIDC_REDIRECT_URI` apunta al **frontend** (`/ingreso/callback`) y debe estar
registrada tal cual en el cliente OAuth.

### 9.5 El `state` firmado

`state = base64url(carga) . base64url(HMAC-SHA256)`, con la carga
`{ csrf, nonce, exp }`: `csrf` y `nonce` son aleatorios **independientes** de
256 bits cada uno y `exp` vence a los 10 minutos. La clave del HMAC se deriva de
`JWT_SECRETO` con una etiqueta propia; la carga no contiene secretos ni datos
personales. El servidor no guarda nada (sin Redis ni tabla).

El cliente conserva el `state` completo y lo compara al regresar; el servidor
verifica firma y vigencia, recupera el `nonce` y exige que el `id_token` lo
traiga idéntico (comparación en tiempo constante). El `code` y el `state`
viajan por POST, así que no quedan en la URL de la API ni en sus registros.

**Límite aceptado:** el `state` firmado puede reutilizarse dentro de sus 10
minutos por quien posea a la vez el `state` y un `code` válido. El uso único
estricto (invalidar el `state` al consumirlo, con Redis) queda como **mejora
futura**, fuera de P0-A.

### 9.6 Qué está probado y qué no

- **Implementado y probado con simulaciones:** `oidc-service.spec.ts` (state,
  nonce, `id_token`, canje), `auth-controller.spec.ts` (callback, usuarios,
  DTO, matriz del ingreso abierto) y `configuracion-entorno.spec.ts`. Google se
  simula con `fetch` y un par de claves RSA generado en la prueba.
- **Validado contra un proveedor OIDC real: pendiente.** Requiere
  `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` y el URI de retorno registrado.
- **Frontend:** verificado con compilación, tipos, lint y revisión estática.
  **Deuda técnica:** no existe infraestructura de pruebas del frontend (la
  comparación del `state` en el cliente no tiene prueba automatizada); será un
  bloque propio.

### 9.7 Sesión: pendientes conocidos (fuera de P0-A)

El JWT (HS256, `JWT_EXPIRACION`, 8 h por defecto) se guarda en `localStorage`;
no hay cierre de sesión en el servidor, lista de revocación ni consulta del
estado del usuario en cada petición, y el cliente no lee `exp`.

---

## 10. Despliegue en Google Cloud

### 10.1 Los cuatro ambientes

> La solicitud a la Dirección de Tecnología es de **cuatro proyectos separados**
> de Google Cloud —dev, qa, pre y prod—, **no** de cuatro carpetas ni cuatro
> buckets dentro del mismo proyecto. De otro modo se pierde el aislamiento de
> permisos, facturación, secretos y riesgo.

| Ambiente | Datos | Cloud SQL | Autenticación | Almacenamiento |
|---|---|---|---|---|
| `dev` | Sintéticos | `db-g1-small`, zonal | Abierta | Local o GCS |
| `qa` | Anonimizados | `db-g1-small`, zonal | Abierta | GCS |
| `pre` | Anonimizados | `db-custom-2-7680`, zonal | **OIDC** | **GCS** |
| `prod` | Reales, auditados | `db-custom-4-15360`, **regional**, PITR | **OIDC** | **GCS** |

### 10.2 Componentes

| Capa | Servicio | Configuración |
|---|---|---|
| API | Cloud Run | `--no-allow-unauthenticated`, `--ingress=internal-and-cloud-load-balancing`, escala a cero fuera de prod |
| Base de datos | Cloud SQL for PostgreSQL | Sin IP pública, TLS obligatorio, conector por socket |
| Almacenamiento | Cloud Storage | Buckets privados con prevención de acceso público, versionado |
| Frontend | Cloud Storage + CDN | Sin servidor de aplicación que mantener |
| Secretos | Secret Manager | Inyectados como variables; jamás en el código |
| Procesos por lote | Cloud Run Jobs + Cloud Scheduler | Zona horaria `America/Bogota` |
| Cola de trabajo | Cloud Tasks | Absorbe el pico de cierre de periodo |
| Observabilidad | Cloud Logging y Cloud Monitoring | Endpoint `/metrics` compatible con Prometheus |
| IA | API de OpenAI (Responses API; Anthropic como alternativa) | Único componente externo al ecosistema; llave en Secret Manager |

### 10.3 Aprovisionamiento

```bash
cd infra/gcp
./aprovisionar-ambiente.sh dev  cun-sipra-dev  <cuenta-facturacion>
./aprovisionar-ambiente.sh qa   cun-sipra-qa   <cuenta-facturacion>
./aprovisionar-ambiente.sh pre  cun-sipra-pre  <cuenta-facturacion>
./aprovisionar-ambiente.sh prod cun-sipra-prod <cuenta-facturacion>

./tareas-programadas.sh dev cun-sipra-dev
```

El script crea proyecto, APIs, Artifact Registry, Cloud SQL, buckets privados,
secretos, cuenta de servicio de mínimo privilegio y cola de Cloud Tasks. Al
terminar **verifica explícitamente que los buckets no sean públicos**.

Las contraseñas se generan con `openssl rand` y se cargan directamente en
Secret Manager: **no se envían por correo ni quedan en el historial de la
terminal**.

### 10.4 Despliegue

```bash
gcloud builds submit --config infra/gcp/cloudbuild.yaml \
  --substitutions=_AMBIENTE=qa,_REGION=us-central1
```

Diez pasos: dependencias → lint → pruebas → **aislamiento** → imagen →
publicación → frontend → migraciones → API → web.

**Sin pruebas verdes no se construye imagen. Sin la prueba de aislamiento en
verde no hay despliegue.**

Las migraciones corren como Cloud Run Job antes del despliegue, usando el
conector de Cloud SQL y los secretos, sin abrir la base a la red.

### 10.5 Cuenta de servicio

Roles concedidos, y solo estos:

`cloudsql.client` · `secretmanager.secretAccessor` · `logging.logWriter` ·
`monitoring.metricWriter` · `cloudtrace.agent` · `cloudtasks.enqueuer`

El acceso a Storage se concede **sobre el bucket de documentos únicamente**, no
sobre todo Storage del proyecto.

### 10.6 Dimensionamiento

El sistema **no se dimensiona por promedio sino por pico**. La carga se
concentra en las últimas dos semanas del periodo, con 40.000 a 50.000
documentos.

En consecuencia: procesamiento asíncrono por cola, escalado automático,
procesamiento nocturno en lote y **prioridad para el cargue en curso**, de modo
que un estudiante que carga el último día no quede detrás de miles de trabajos.

Una infraestructura dimensionada al promedio falla en el cierre de periodo.

### 10.7 Respaldo y recuperación

Respaldo diario con retención de 30 días. Recuperación a un punto en el tiempo
en producción. Versionado en el bucket de documentos. Objetivo de recuperación:
4 horas. Punto objetivo de recuperación: 1 hora. Prueba de restauración
semestral documentada.

### 10.8 Transferencia internacional

Google Cloud no dispone de región en Colombia; las más próximas están en Brasil
y Chile. **El alojamiento fuera del territorio nacional constituye transferencia
internacional de datos personales y debe documentarse.** Corresponde a la
Dirección Jurídica verificar la situación de las jurisdicciones efectivamente
utilizadas contra la Circular Externa 005 de 2017 de la Superintendencia.

---

### 10.9 Puesta en marcha: una sola acción manual

El proyecto se aprovisiona con `infra/gcp/arranque-unico.sh`, que se ejecuta una
vez desde Cloud Shell —ya autenticado— y es idempotente. Crea servicios, Cloud
SQL, bucket privado, secretos, colas, la identidad de la aplicación con mínimo
privilegio y la autorización de despliegue para GitHub.

**Sin claves descargables.** GitHub Actions no guarda un archivo de credenciales:
se autentica por federación de identidades contra Google, y la confianza queda
atada por condición a un único repositorio. Ningún otro repositorio, propio o
ajeno, puede pedir credenciales de este proyecto; y revocar el acceso es quitar
un vínculo en la nube, no perseguir una clave que ya circuló.

**Cambio de repositorio (14 de octubre de 2026).** El proveedor de identidades
de `dev` se creó cuando el código vivía en `ironfuentes-netizen/Productoacademico`,
y tanto la condición del proveedor como el `principalSet` llevan ese nombre.
`arranque-unico.sh` usa ya `ironfuentes-netizen/sipra-practicas` por defecto y,
si el proveedor existe, actualiza su condición al volver a ejecutarse. A mano
equivale a:

```bash
gcloud iam workload-identity-pools providers update-oidc github \
  --location=global --workload-identity-pool=github \
  --attribute-condition="assertion.repository=='ironfuentes-netizen/sipra-practicas'"
gcloud iam service-accounts add-iam-policy-binding \
  sipra-despliegue@cun-it-fab-contenido-practicas.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<número del proyecto>/locations/global/workloadIdentityPools/github/attribute.repository/ironfuentes-netizen/sipra-practicas"
```

Y, para que el repositorio antiguo deje de poder desplegar,
`remove-iam-policy-binding` con el mismo rol y el `principalSet` de
`ironfuentes-netizen/Productoacademico`.

De ahí en adelante todo despliegue sale de `git push`: el flujo corre lint,
la suite completa de pruebas (583) y la de aislamiento entre empresas —bloqueante— antes de tocar
la nube, publica las dos imágenes, aplica migraciones y catálogos como paso
propio, despliega y comprueba que la plataforma responde.

**El frontend expone la API bajo su mismo origen.** El contenedor de nginx
recibe la URL del servicio de la API y la sirve bajo `/api`, así que el paquete
de Angular sigue llamando a rutas relativas: sin host embebido, sin CORS y sin
balanceador. La misma imagen sirve para cualquier ambiente.

> **Sobre los ambientes.** El primer despliegue va a `cun-it-fab-contenido-practicas`,
> el proyecto asignado a prácticas, como ambiente `dev`. El estándar pide cuatro
> proyectos separados —dev, qa, pre y prod— para no compartir facturación,
> permisos ni radio de impacto entre ambientes; el script recibe proyecto,
> región y ambiente como parámetros, así que sumar los otros tres es el mismo
> comando con otros argumentos, no otro trabajo.


### 10.10 Cloud SQL por IP privada: por qué no se usa el conector

Aprovisionar y conceder son capacidades distintas. La cuenta que puso en
marcha el ambiente tiene `roles/iam.admin` y `roles/iam.serviceAccountAdmin`
sobre el proyecto y hereda lo necesario para crear recursos, pero **no puede
modificar la política de IAM del proyecto**. Y el conector de Cloud SQL —el
socket `/cloudsql/…` que usan Cloud Run y Cloud Build— exige que la cuenta de
servicio tenga `roles/cloudsql.client`, un rol que Google Cloud solo permite
conceder a nivel de proyecto: no existe política de IAM sobre una instancia.

En lugar de esperar una autorización, se elimina la necesidad del rol. La
aplicación llega a la base **por IP privada dentro de una VPC del proyecto**:

| Pieza | Recurso | Lo crea |
|---|---|---|
| Red | `sipra-red` (modo personalizado) | `infra/gcp/red-privada.sh` |
| Subred | `sipra-subred-<región>`, `10.10.0.0/24`, acceso privado a APIs de Google | ídem |
| Rango para servicios de Google | `sipra-rango-servicios`, `/20`, propósito `VPC_PEERING` | ídem |
| Emparejamiento | `servicenetworking.googleapis.com` ↔ `sipra-red` | ídem |
| Instancia | `sipra-<ambiente>` adherida a la red, **sin IP pública** | ídem |
| Salida de Cloud Run | *Direct VPC egress*, solo rangos privados | `desplegar.sh` |

Nada de esto pasa por IAM del proyecto: es red, y la red la administra quien
crea recursos. `desplegar.sh` detecta si la instancia tiene IP privada y elige
el modo: con ella, `--network/--subnet` y `DB_HOST`; sin ella, el conector y
`DB_SOCKET_PATH`. El código de la aplicación no distingue uno del otro.

**Y es la configuración correcta, no un rodeo.** Google recomienda IP privada
para Cloud SQL: la instancia deja de tener superficie en internet y solo la
alcanza lo que vive en la VPC. El conector resuelve un problema —llegar a una
base con IP pública sin abrirla— que la red privada no tiene. La conexión va
además cifrada (`DB_SSL=true`).

**Lo que sí sigue exigiendo IAM de proyecto** y queda pendiente para cuando
alguien con `roles/resourcemanager.projectIamAdmin` lo conceda a
`sipra-app-<ambiente>`: `roles/logging.logWriter` y
`roles/monitoring.metricWriter`. Sin ellos la plataforma funciona —Cloud Run
recoge la salida estándar del contenedor por su cuenta— pero la aplicación no
puede escribir registros estructurados ni métricas propias en Cloud
Monitoring. `infra/gcp/permisos.sh` lo intenta en cada despliegue y, mientras
falle, imprime la orden exacta.

**Alternativas descartadas.** Abrir la IP pública de Cloud SQL a `0.0.0.0/0`
con contraseña y certificado, o sacar la base de desarrollo fuera del
proyecto. Ambas resuelven el bloqueo hoy y ambas cambian la postura de
seguridad del ambiente; la red privada lo resuelve sin cambiarla.

---

## 11. Observabilidad

Endpoint `/api/v1/metrics` en formato Prometheus, protegido con `METRICAS_TOKEN`
(`Authorization: Bearer`; ver §6.4). En local, `infra/docker/prometheus.yml` lo
consulta con `credentials_file` (`infra/docker/metricas.token`, fuera de git).

### 11.1 Cuatro señales de oro

| Métrica | Alerta |
|---|---|
| `http_requests_total` | Tráfico y tasa de errores 5xx > 1 % durante 5 min |
| `http_request_duration_seconds` | P95 > 500 ms durante 10 min |
| Saturación (`sipra_*` por defecto) | CPU > 80 % sostenido 15 min |

### 11.2 Métricas de negocio

| Métrica | Para qué |
|---|---|
| `sipra_documentos_procesados_total` | Volumen por tipo, banda y estado |
| `sipra_documentos_auto_aprobados_total` | **Tasa de auto-aprobación: el indicador clave del proyecto** |
| `sipra_pipeline_duracion_seconds` | Latencia del pipeline, con y sin cortocircuito |
| `sipra_ia_costo_usd_total` | Consumo real contra el tope presupuestal |
| `sipra_practicas_bloqueadas_arl` | Prácticas detenidas por la compuerta |
| `sipra_obligaciones_vencidas` | Obligaciones vencidas por tipo |
| `sipra_vacantes_bloqueadas_antidiscriminacion_total` | Evidencia del filtro |
| `sipra_accesos_fuera_de_alcance_total` | Detección de uso anómalo |

**Alerta destacada:** si la auto-aprobación cae por debajo del 60 %, el cuello
de botella del tutor reaparece. La regla está en
`infra/docker/alertas.yml` y su descripción lo explica.

---

## 12. Operación local

```bash
git clone https://github.com/ironfuentes-netizen/sipra-practicas.git
cd sipra-practicas
cp .env.example .env          # ajustar JWT_SECRETO

npm install
npm run infra:up              # PostgreSQL 18 y Redis por Docker
npm run migration:run
npm run catalogos:cargar      # catálogos oficiales, con verificación de completitud
npm run catalogos:estado      # informe de cobertura
npm run seed                  # datos sintéticos

npm run dev                   # API en :3000 · web en :4200
```

| Recurso | URL |
|---|---|
| Aplicación | http://localhost:4200 |
| API | http://localhost:3000/api/v1 |
| Documentación OpenAPI (solo `dev`) | http://localhost:3000/docs/dev-only/swagger |
| Métricas (con `METRICAS_TOKEN`) | http://localhost:3000/api/v1/metrics |
| Grafana (perfil `observabilidad`) | http://localhost:3001 |

### 12.1 Perfiles sembrados

| Perfil | Correo | Qué demuestra |
|---|---|---|
| Estudiante | `laura.ramirez@estudiante.cun.edu.co` | Ve solo su expediente, sin señal interna |
| Estudiante | `andres.mora@estudiante.cun.edu.co` | Práctica detenida por la compuerta ARL |
| Tutor | `tutor.negocios@cun.edu.co` | Bandeja de estudiantes por señal de riesgo |
| Coordinador de prácticas | `coordinacion.practicas@cun.edu.co` | Área de Prácticas: registro FUR administrativo, usuarios, periodos, sincronización (es el que ofrece el selector) |
| Analista | `analista.practicas@cun.edu.co` | Coordinación con permiso de **consulta**: ve todo, no escribe |
| Coordinador de escuela | `coordinacion.ingenierias@cun.edu.co` | Alcance limitado a `ESC-ING` |
| Auxiliar | `auxiliar.practicas@cun.edu.co` | Portal de ARL: valida, decide y remite el certificado |
| Administrador | `admin.practicas@cun.edu.co` | Alcance institucional, auditoría, empresas |
| Empresa | `camila.restrepo@logisticasandinas.com.co` | Solo sus practicantes |
| Extensión | `extension.bolsa@cun.edu.co` | Bolsa de empleo y reportes |

---

## 13. Pruebas

373 pruebas en veintinueve suites, todas en verde.

| Suite | Qué prueba |
|---|---|
| `nit.spec.ts` | Algoritmo DIAN del dígito de verificación |
| `cronograma-periodo.spec.ts` | Regla de dos meses, inducción en la segunda semana, cargue dos semanas antes del cierre, ejemplo 26V04 del documento |
| `plazo-cargue.spec.ts` | Ocho días calendario tras el fin de la práctica; la devolución reabre el plazo |
| `ayuda-y-pqrs.spec.ts` | Las 123 preguntas en dieciséis categorías, búsqueda sin tildes, radicado, unificación, respuesta y alcance por rol |
| `compuerta-arl.spec.ts` | Los tres modos de fallo de la compuerta y la exención de homologación |
| `aislamiento-empresas.spec.ts` | **Aislamiento entre empresas y por rol** |
| `antidiscriminacion.spec.ts` | Las ocho categorías del filtro |
| `forense.spec.ts` | Firma binaria, metadatos de PDF, puntaje y bandas |
| `hash-perceptual.spec.ts` | Reescalado, brillo, recorte, guarda de entropía |
| `saneamiento-pdf.spec.ts` | Neutralización de objetos activos y conservación de longitud |
| `reportes-spe.spec.ts` | Separador, saneamiento de valores, marca de borrador |
| `reporte-bloqueado.spec.ts` | **El bloqueo por catálogos incompletos en `pre` y `prod`** |
| `preprocesamiento.spec.ts` | Enderezamiento, recorte idempotente, ecualización, binarización |
| `pipeline-preproceso.spec.ts` | Que el pipeline reintente y no se atribuya éxitos ajenos |
| `pdf417.spec.ts` | Trama, dígito NUIP y la negativa a pronunciarse sobre el titular |
| `pdf417-adaptador.spec.ts` | **Ida y vuelta real: se genera un PDF417 y se lee** |
| `plantillas-notificacion.spec.ts` | Texto, concordancia de género y escapado del HTML |
| `parametros.spec.ts`, `parametros-caso-uso.spec.ts` | Parámetros operativos y normativos (M12) |
| `requisitos-por-etapa.spec.ts` | Documentos exigidos por etapa y modalidad |
| `proceso-sgp-catalogo.spec.ts` | Las quince modalidades del selector del SGP, momentos, criterios documentales y estados equivalentes |
| `periodo-academico.spec.ts`, `periodos-gestion.spec.ts` | Ventanas, fines de semana, fechas dentro del periodo; gestión de periodos |
| `registro-fur.spec.ts` | Todas las reglas del Formulario Único de Registro |
| `avance-y-carta.spec.ts` | Porcentajes cargado y aprobado por momento; composición de la carta |
| `bitacora-y-cierre.spec.ts` | Tipos de entrada, «Evalúa tu proceso», calificación 0,0–5,0 y el cierre automático |
| `solicitud-arl.spec.ts` | Validación automática del portal de ARL, decisión, certificado y consolidado |
| `usuarios-y-sincronizacion.spec.ts` | Gestión de usuarios administrativos, vistas SINU y sincronizador de docentes |
| `reportes-sgp.spec.ts` | Los tres reportes del SGP; **abre el libro Excel generado** |

### 13.1 La prueba de aislamiento

```bash
npm run test:aislamiento
```

**Condición de despliegue.** Si una empresa alcanza un solo registro de otra, la
construcción falla. No es un check informativo: está en la integración continua
y en Cloud Build, antes de que se construya la imagen.

Incluye el caso adverso de que un usuario de empresa y el estudiante de una
práctica ajena compartan identificador por error.

### 13.2 Verificaciones en la integración continua

Además de lint, pruebas y compilación, el flujo de GitHub Actions:

1. Ejecuta las migraciones contra PostgreSQL real y carga las semillas.
2. **Intenta** un `UPDATE` y un `DELETE` sobre `auditoria` y falla si alguno
   tiene éxito.
3. **Intenta** insertar una práctica activa sin afiliación a ARL y falla si el
   motor lo permite.
4. Escanea el árbol en busca de credenciales y de archivos `.env` versionados.

Las garantías se verifican, no se asumen.

---

## 14. Cumplimiento del estándar de la Fábrica de Software

Contra el manual *Estándares, Arquitectura y Stack Tecnológico*, versión 2.0.

| Estándar | Sección | Cumplimiento |
|---|---|---|
| Principios SOLID en TypeScript | 2.0 | ✔ SRP por caso de uso; DIP vía puertos; OCP en los adaptadores intercambiables |
| Arquitectura hexagonal estricta | 3.1 | ✔ **Con la regla de dependencia impuesta por el linter** |
| Estructura de directorios `domain/application/infrastructure` | 3.2 | ✔ |
| Swagger / OpenAPI v3 obligatorio | 3.3 | ✔ En `/docs/dev-only/swagger`, con `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiProperty` |
| Versionado en la URL (`/api/v1`) | 3.3 | ✔ |
| `@nestjs/config` con validación por `class-validator` | 3.4 | ✔ Y con reglas adicionales por ambiente |
| `.env` fuera de Git | 3.4 | ✔ En `.gitignore` y verificado por el escaneo de secretos |
| **Fastify** como adaptador HTTP | 3.5 | ✔ |
| `removeComments: true`, `sourceMap: false` | 3.5 | ✔ |
| Docker multi-etapa | 3.5 | ✔ Con usuario sin privilegios y `HEALTHCHECK` |
| Angular con componentes standalone y signals | 4.0 | ✔ |
| Estructura `core/features/shared/layout` | 4.1 | ✔ |
| `ChangeDetectionStrategy.OnPush` obligatorio | 4.2 | ✔ **Impuesto por regla de ESLint** |
| ESLint compartido y versionado | 4.3 | ✔ |
| Nomenclatura `feature.type.ts` en `kebab-case` | 4.3 | ✔ |
| Carga perezosa de todas las features | 4.4 | ✔ Diez fragmentos separados |
| `aot: true`, `optimization: true` | 4.4 | ✔ |
| **Presupuestos de tamaño** | 4.4 | ✔ 600 kB de advertencia, 1 MB de error — actual: **314 kB / 90 kB comprimido** |
| TypeORM como ORM estándar | 6.1 | ✔ |
| Esquema por migraciones; `synchronize` prohibido | 6.1 | ✔ |
| Índices en columnas de `WHERE` y `JOIN` | 6.1 | ✔ |
| Redis para caché | 6.2 | ◐ Provisto en la infraestructura; sin uso aún |
| Mínimo privilegio en la base | 6.3 | ✔ Rol `sipra_app` |
| TLS obligatorio en tránsito | 6.3 | ✔ Exigido por la validación de configuración |
| `pgcrypto` para datos sensibles en reposo | 6.3 | ◐ Extensión habilitada; sin columnas cifradas aún |
| Respaldo y PITR | 6.3 | ✔ En el aprovisionamiento |
| Endpoint `/metrics` con `prom-client` | 7.1 | ✔ |
| Cuatro señales de oro | 7.2 | ✔ |
| Métricas de negocio instrumentadas | 7.3 | ✔ Ocho métricas propias |
| GitHub Flow, `main` siempre desplegable | 8.1 | ✔ |
| CI en cada Pull Request | 8.1 | ✔ |
| Pirámide de pruebas | 8.3 | ◐ Base unitaria sólida; integración y E2E pendientes |

Leyenda: ✔ cumplido · ◐ parcial, con el pendiente identificado.

**Desviaciones deliberadas, con justificación:**

| Desviación | Justificación |
|---|---|
| PostgreSQL 16 en local, 18 en `docker-compose` | El estándar pide 18. Cloud SQL ofrece 16 como versión estable soportada; la migración del esquema es compatible. Se documenta para que Tecnología decida. |
| Prometheus autogestionado vs. Cloud Monitoring | El endpoint `/metrics` es el mismo. Tecnología elige el recolector sin cambiar la aplicación. |
| Sin NgRx | El estado es local por vista y los signals bastan. El manual exige justificación del Tech Lead para introducir NgRx, no para omitirlo. |

---

## 15. Estado por módulo y trabajo pendiente

Esta sección es el backlog del proyecto. Lo construyeron seis revisiones
independientes del repositorio y lo contrastaron cuatro verificadores contra
el código (13 de octubre de 2026, commit `4fff78f` del repositorio original, `161ef40` aquí); cada ítem cita su
evidencia. El mismo contenido se entrega en el paquete de transferencia como
`04-pendientes/PENDIENTES.md` y `pendientes.csv`.

**Alcance verificado:** la verificación se hizo el 13 de octubre de 2026 sobre el repositorio original (`Productoacademico`, rama `claude/sipra-practicas-setup-l0zasi`, commit `4fff78f` del 9 de octubre de 2026): la carpeta `sipra/` más los flujos `.github/workflows/sipra-*.yml` que entonces vivían en la raíz de ese repositorio. Desde el 14 de octubre de 2026 ese mismo código es este repositorio independiente: el commit `4fff78f` equivale aquí a `161ef40` (el historial se reescribió con `git subtree split`) y los flujos pasaron a `.github/workflows/ci.yml` y `desplegar.yml`. Las rutas con `../` en la columna de evidencia aluden a la raíz del repositorio original; P-59 y P-67 quedaron resueltos con la separación. Este documento reemplaza al backlog inicial de 58 ítems: cuatro verificadores contrastaron cada ítem con el código, con `docs/DOCUMENTO-TECNICO.md` y con la API de GitHub. Resultado: ocho ítems **inexactos** corregidos (P-03, P-04, P-19, P-34, P-37, P-47, P-52, P-55), cuatro filas de la tabla de módulos corregidas (M1, M4b, M10, M12), el resto ampliado con la evidencia nueva, y **20 ítems añadidos (P-59 a P-78)** que el backlog inicial omitió. La suite de la API se ejecutó de nuevo: **37 suites, 583 pruebas en verde**; cobertura medida con `jest --coverage`: 42,0 % de sentencias (dominio 83,7 %, aplicación 53,1 %, infraestructura 15,8 %).

### 15.1 Estado por módulo

Símbolos: ✔ completo · ◐ parcial. La columna «0.16» es el estado que declaraba la versión anterior de este documento; «0.17» es el estado según la verificación del código.

| Módulo | 0.16 | 0.17 | Falta | Ítems |
|---|:--:|:--:|---|---|
| M1 · Identidad, perfiles y permisos | ✔ | ◐ | Flujo OIDC de extremo a extremo (`nonce` inerte, `state` sin validar, sin ruta de retorno, variables no inyectadas); alta de estudiantes (hoy nadie podría entrar en producción); JWT de 8 h sin refresco ni revocación; sincronización desde SINU; invitaciones de un solo uso; guards y OIDC sin pruebas | P-01, P-60, P-19, P-13, P-69 |
| M2 · Gestión de prácticas | ✔ | ✔ | Flujo propio de validación de experiencia (comité, acta, cruce PILA); etiqueta y textos con el nombre antiguo `homologacion_experiencia` | P-34, P-49 |
| M3 · Gestión documental | ✔ | ✔ | Decodificación JPEG progresivo para el hash perceptual; HEIC y orientación EXIF; descarga firmada sin auditar; firma de descarga en la URL | P-41, P-40, P-73 |
| M4 · Validación e IA | ◐ | ◐ | Calibración con documentos reales; reglas de capa 3 que no operan (NIT en `null`, jefe del FUR); segunda pasada de escalamiento; costos reales; DPA con OpenAI | P-17, P-65, P-27, P-25, P-11 |
| M4b · Cola de trabajo | ✔ | ◐ | Cloud Tasks nunca ejercitado en ningún ambiente; sin pruebas del adaptador ni del *worker*; *worker* sin idempotencia y tiempos incoherentes; prueba de carga | P-05, P-70, P-16 |
| M5 · Cumplimiento y obligaciones | ✔ | ✔ | Afiliación en lote y novedades PILA; consentimiento de tratamiento sin flujo de aceptación y `BLOQUEA_CARGUE` sin aplicar; aviso previo de vencimiento; barrido, purga y consolidado dependen de `@Cron` sin garantía en Cloud Run (estado en nube «no probado») | P-23, P-62, P-61, P-06 |
| M6 · Empresas | ✔ | ✔ | RUES real; invitación de 72 h y creación del usuario `empresa`; verificación antibots; formulario público de solicitud ausente en la web; alta provisional para el piloto | P-20, P-35, P-64, P-60 |
| M7 · Bolsa de empleo | ◐ | ◐ | Postulaciones; ciclo de vida de la vacante; ocultación del lado del servidor; **activación sujeta al acto administrativo del SPE** | P-29, P-66, P-12 |
| M8 · Acompañamiento y señales | ✔ | ✔ | Decisión pendiente sobre el pulso mensual de dos toques | P-36 |
| M9 · Reportes regulatorios | ◐ | ◐ | Catálogos completos; anexo técnico y NIT del prestador; informe estadístico mensual; plantillas SNIES | P-08, P-09, P-31 |
| M10 · Notificaciones | ✔ | ◐ | Google Workspace nunca activado en ningún ambiente (`CORREO_DRIVER=consola`; `prod` no arranca así; §2.3 lo marca «pendiente»); seis plantillas sin emisor; notificación dentro de la plataforma; WhatsApp (requiere celular del estudiante) | P-07, P-61, P-32, P-54 |
| M11 · Auditoría | ✔ | ✔ | Uso anómalo evaluado solo al listar prácticas; descarga no auditada; alerta por correo | P-40 |
| M12 · Administración | ✔ | ◐ | Sin pantalla de Parámetros en la web (solo Swagger/`curl`); 4 de 13 parámetros declarados sin lector; historial por parámetro | P-30, P-55, P-33 |
| M13 · Proceso base del SGP (sección 17) | ✔ | ✔ | Firmas digitales certificadas; acta de inicio digital; nota a C-Digital; certificado de práctica no emitido | P-38, P-37, P-21, P-63 |

### 15.2 Hallazgos de la verificación que cambian el panorama

Lo que el siguiente ingeniero debe saber antes de leer el detalle:

- **SIPRA no existe en `main`.** `origin/main` solo contiene Producto Académico; la rama de trabajo está 56 commits adelante y 0 atrás (`git rev-list --left-right --count origin/main...HEAD` → `0 56`), y el `netlify.toml` de la raíz publica `.` sin exclusiones, así que fusionar sin más expondría `sipra/**` en el sitio público (P-59). **Resuelto el 14 de octubre de 2026** con el repositorio independiente: aquí `main` es la rama principal y Netlify no interviene.
- **El flujo de despliegue de GitHub Actions nunca ha desplegado nada.** 37 ejecuciones al 13 de octubre de 2026, las recientes todas en `failure` en el paso `google-github-actions/auth@v2`, porque `NUMERO_PROYECTO`, `CONEXION_SQL` y `BUCKET` siguen en `PENDIENTE`; `sipra-ci.yml` nunca se había ejecutado en el repositorio original (solo se disparaba en `main` o PR); `dev` se publica a mano con `desplegar.sh` desde Cloud Shell; y ambos workflows vivían fuera de `sipra/` (P-03, P-67; lo segundo quedó resuelto el 14 de octubre de 2026: en este repositorio son `.github/workflows/ci.yml` y `desplegar.yml`). `ci.yml` ya corrió en verde en este repositorio; `desplegar.yml` sigue fallando en la autenticación con Google en cada push a `main` hasta que se complete o se retire (P-03).
- **El guion «oficial» de aprovisionamiento y `cloudbuild.yaml` nunca se han ejecutado.** `dev` se creó con `arranque-unico.sh`; `aprovisionar-ambiente.sh` arrastra `--require-ssl` (causa documentada de un fallo) y hay **seis familias de nombres divergentes** (SA, secretos incluidos los de IA, buckets, base, colas, frontend); `cloudbuild.yaml` no inyecta `DB_USER`/`DB_NAME`, cola, correo ni OIDC, así que no puede producir un `pre`/`prod` que arranque (P-02, P-04).
- **OIDC no cierra de extremo a extremo.** `nonce` llega `undefined` y la comprobación se omite cuando es falsy, `state` nunca se valida, el SPA no tiene ruta de retorno y ningún despliegue inyecta `OIDC_CLIENT_ID`/`OIDC_REDIRECT_URI` (`oidc.service.ts:112`, `auth.controller.ts:95-118`) (P-01).
- **En producción ningún estudiante podría entrar.** No existe ninguna vía para dar de alta estudiantes (ni desde SINU ni por cargue); OIDC rechaza toda cuenta sin perfil activo y el modo abierto está prohibido en `pre`/`prod` (`gestionar-usuarios.use-case.ts:18-19`, `auth.controller.ts:109-114`) (P-60, P-19).
- **Cloud Tasks nunca se ha ejercitado y no tiene pruebas.** Todos los despliegues usan `en_proceso`; el *worker* reprocesa sin comprobar el estado terminal (cada reintento vuelve a gastar en IA) y el `dispatchDeadline` de 300 s supera el `--timeout=120` del servicio (`cola.adapter.ts:161`, `procesar-trabajo.use-case.ts:41-59`) (P-05, P-70).
- **Las tareas programadas no corren en la nube.** No existen los Cloud Run Jobs que `tareas-programadas.sh` invoca, la SA de Scheduler no tiene permiso de ejecutar jobs y los `@Cron` dependen de una instancia viva con `--min-instances=0` (P-06).
- **El consentimiento de datos no se recoge en la plataforma.** La obligación `AUTORIZACION_TRATAMIENTO` se crea vencida en cada práctica, nadie puede cumplirla, `BLOQUEA_CARGUE` no se aplica y no hay pantalla de aceptación (`obligaciones.domain-service.ts:22, 36, 44`) (P-62).
- **Seis plantillas de notificación no tienen emisor y el correo real nunca se ha activado.** `OBLIGACION_POR_VENCER`, `DOCUMENTO_APROBADO`, `PRACTICA_ACTIVADA`, `EMPRESA_HABILITADA`, `INVITACION_EMPRESA` y `CERTIFICADO_EMITIDO` tienen plantilla y cero usos; `CORREO_DRIVER=consola` en todos los despliegues y `prod` no arranca así (P-61, P-07).
- **Cuatro de los trece parámetros operativos no los lee nadie y no hay pantalla.** `documentos.similitud_maxima`, `documentos.tamano_maximo_mb`, `auditoria.consultas_por_hora` y `plan_mejoramiento.dias_plazo` se cambian con motivo, quedan en auditoría y no surten efecto; «ampliar el plan de mejoramiento a 4 semanas» no es un cambio de 0 días (P-55, P-30).
- **Superficie expuesta que el backlog no veía.** `/api/v1/metrics` es público; la sonda de salud responde 200 con la base caída; la firma de descarga viaja en la URL y queda en Cloud Logging; el JWT se guarda en `localStorage`; las cabeceras de seguridad de nginx no se aplican a `index.html` ni a los estáticos por herencia de `add_header` (P-71, P-72, P-73, P-13).
- **583 pruebas en verde no significan cobertura.** 42 % de sentencias; `infrastructure` 15,8 %; los tres guards y `oidc.service.ts` no tienen ninguna prueba; `npm audit --omit=dev` reporta 16 vulnerabilidades (7 altas); `main` no tiene protección de rama y el plan actual de GitHub no permite activarla (P-69, P-51, P-68).

### 15.3 Cómo leer el backlog y resumen por grupo

> Nota sobre las referencias: en la evidencia, `§15.1` y `§15.2` remiten a la
> numeración de la versión 0.16 del documento técnico; hoy corresponden al
> estado por módulo (15.1) y a la ruta crítica institucional (15.6).

| Campo | Convención |
|---|---|
| ID | `P-01` … `P-58` conservan la numeración del backlog inicial; `P-59` … `P-78` son los hallazgos de la verificación, numerados por grupo |
| Evidencia | `archivo:línea` relativo a la raíz de este repositorio (hasta el 14 de octubre de 2026, la carpeta `sipra/`); `../.github/...` y `../netlify.toml` aluden a la raíz del repositorio original `Productoacademico`, donde vivían los flujos (hoy `.github/workflows/ci.yml` y `desplegar.yml` aquí); `§n` del documento técnico (`§15.1`, con línea cuando el verificador la dio); «GitHub API» = consulta directa a la API de GitHub Actions |
| Prioridad | **Bloqueante** = sin esto no hay producción (o no hay entrega, o no hay piloto, según se indique) · **Alta** · **Media** · **Baja** |
| Estimación | Días de un ingeniero sénior, rango; excluye los tiempos de gestión institucional. En los ítems corregidos o nuevos se usa la cifra del verificador |
| Dependencia externa | Qué área o tercero debe entregar algo antes de poder cerrar el ítem |
| Fuente | Cuando el backlog inicial y un verificador discrepan, prevalece el verificador (leyó el código después). Cada ítem nuevo cita la evidencia del verificador que lo encontró |

| Grupo | Ítems | Estimación técnica (días sénior) | Dependen de un tercero |
|---|:--:|:--:|:--:|
| A · Bloqueantes para salir a producción | 19 (P-01 a P-17, P-59 ✔, P-60) | 44 – 72 | 13 de 19 |
| B · Integraciones reales pendientes | 11 (P-18 a P-28) | 31 – 52 | 9 de 11 |
| C · Funcionalidad faltante del proceso | 20 (P-29 a P-42, P-61 a P-66) | 52 – 86 | 8 de 20 |
| D · Calidad, pruebas y operación | 23 (P-43 a P-53, P-67 ✔, P-68 a P-78) | 32 – 50 | 4 de 23 |
| E · Mejoras y evoluciones | 5 (P-54 a P-58) | 11 – 18 | 2 de 5 |
| **Total** | **78** (2 resueltos) | **≈ 168 – 278** | **36 de 78** |

> ✔ = resuelto el 14 de octubre de 2026 con la migración al repositorio independiente (P-59 y P-67); sus días se descontaron de los totales y las filas conservan el hallazgo original como historial.

> Las tres gestiones de la sección 15.6 (autorización ante el SPE, validación jurídica, acceso a SINU) siguen abiertas y son la ruta crítica institucional. La verificación añade una ruta crítica **técnica** previa a cualquier ambiente nuevo: P-04 → P-06 → P-05 → P-03 (P-59, que la encabezaba, ya está resuelto), y P-60 antes de P-01.

---

### 15.4 Backlog detallado

#### A) Bloqueantes para salir a producción

| ID · Área | Título y descripción | Evidencia | Qué se necesita | Dep. externa | Prioridad | Días | Riesgo si no se hace |
|---|---|---|---|---|:--:|:--:|---|
| **P-01** · Autenticación | **Cerrar el flujo OIDC de extremo a extremo.** `GET auth/oidc/callback` devuelve JSON (`SesionDto`) y lee `code` y `nonce` por *query string*; Google devuelve `code` y `state`, así que `nonce` llega `undefined` y `verificarIdToken` **omite** la comprobación cuando `nonceEsperado` es falsy: la protección anti-repetición está inerte, no solo mal ubicada. `state` se genera pero nunca se valida. El SPA guarda el nonce en `sessionStorage`, redirige a Google y no tiene ruta de retorno (`grep -rn oidc apps/web/src` → solo `sesion.service.ts:64` y `modelos.ts`). Ningún camino de despliegue inyecta `OIDC_CLIENT_ID` ni `OIDC_REDIRECT_URI` (`configuracion.ts:208-212` rechaza el arranque en `oidc` sin ellos) y el secreto `sipra-oidc-secret-<amb>` se crea con el marcador `PENDIENTE-CARGAR-CLIENTE-OIDC`. | `infrastructure/controllers/auth.controller.ts:95-118` · `infrastructure/auth/oidc.service.ts:35-54, 56-74, 112` · `apps/web/src/app/core/auth/sesion.service.ts:61-69` · `apps/web/src/app/app.routes.ts:8-130` (sin ruta de retorno) · `infrastructure/config/configuracion.ts:208-212` · `infra/gcp/cloudbuild.yaml:106, 122` · `infra/gcp/aprovisionar-ambiente.sh:106-107` · `.env.example:37-41` | Ruta de retorno en el SPA (o redirección de la API con código de un solo uso), validar `state`, llevar el nonce del cliente al canje y hacer obligatoria su comprobación, inyectar `OIDC_CLIENT_ID`/`OIDC_REDIRECT_URI` en `desplegar.sh`, `cloudbuild.yaml` y el workflow, registrar el cliente OAuth en Google Cloud Console con el dominio real, cargar el secreto real, prueba manual con cuenta `@cun.edu.co`. Requiere P-60 para que existan perfiles de estudiante que admitir. | Sí — Tecnología (Workspace, Cloud Console, dominio) | Bloqueante | 3 – 5 | `pre`/`prod` rechazan `AUTH_MODO=abierto` (`configuracion.ts:182-187`) y con `oidc` nadie puede ingresar. |
| **P-02** · Infraestructura | **Aprovisionar `qa`, `pre` y `prod` como proyectos separados.** Solo `dev` está en línea (`cun-it-fab-contenido-practicas`) y **no** se creó con `aprovisionar-ambiente.sh` sino con `arranque-unico.sh` + `red-privada.sh` (DT §10.9, bitácora 0.10): el guion que DT §10.3 indica para los cuatro ambientes **nunca se ha ejecutado** y arrastra dos decisiones ya descartadas en la práctica: `--require-ssl` (causa documentada del fallo «connection requires a valid client certificate») y `--no-assign-ip` sin `--network`. | `§10.1, §10.3, §10.9` (909-921, 937-955, 1012-1040) · bitácora 0.10 (DT 2233-2270) · `infra/gcp/aprovisionar-ambiente.sh:29-38, 60-72, 110-113` · `infra/gcp/arranque-unico.sh:17-28, 66-68, 102` · `README.md:15-24, 43-44` | Decidir el guion canónico y corregirlo (P-04) **antes** de aprovisionar; cuatro proyectos con facturación propia; ejecutar aprovisionamiento, `red-privada.sh` y `permisos.sh` por ambiente; verificar buckets privados con versionado, VPC y Cloud SQL (`REGIONAL` + PITR en `prod`). | Sí — Dirección de Tecnología (proyectos, IAM, facturación) | Bloqueante | 5 – 8 | No existe ruta física a producción. |
| **P-03** · CI/CD | **Pipeline multiambiente que realmente despliegue, con promoción y aprobación.** Corrección al backlog inicial: `sipra-desplegar.yml` (hoy `.github/workflows/desplegar.yml` en este repositorio) **nunca ha completado un despliegue**. GitHub registra 37 ejecuciones de «SIPRA · desplegar en Google Cloud», las recientes todas en `failure`; en la última (run 37989027205, commit `4fff78f`) pasan Lint, Pruebas y Aislamiento y falla el paso 8 `google-github-actions/auth@v2` porque `NUMERO_PROYECTO`, `CONEXION_SQL` y `BUCKET` siguen en `PENDIENTE` y el proveedor de identidad queda `projects/PENDIENTE/...`. `dev` se publica a mano con `bash infra/gcp/desplegar.sh` desde Cloud Shell. El workflow además despliega la API nueva **antes** de correr las migraciones (al revés de `cloudbuild.yaml` y `desplegar.sh`), ejecuta `npm run seed` en cada despliegue y fija `AUTH_MODO=abierto`, `COLA_DRIVER=en_proceso`, `IA_DRIVER=simulado`, `CORREO_DRIVER=consola`. `sipra-ci.yml` (hoy `ci.yml`) **nunca se había ejecutado** (se disparaba solo en `main` o PR y el proyecto nunca estuvo en `main` del repositorio original, ver P-59); en este repositorio corrió por primera vez el 14 de octubre de 2026 y está en verde. `cloudbuild.yaml` está parametrizado por `_AMBIENTE` pero no lo invoca nadie. **Añadido el 14 de octubre:** el proveedor de identidades de `dev` se creó con `REPO_GITHUB=ironfuentes-netizen/Productoacademico`, así que, aunque se rellenen los valores `PENDIENTE`, Google rechazará los tokens del repositorio `sipra-practicas` hasta actualizar la condición del proveedor y el `principalSet` (§10.9). | `../.github/workflows/sipra-desplegar.yml:13-16, 23-30, 59-64, 78-106` · `../.github/workflows/sipra-ci.yml:6-11` · `infra/gcp/cloudbuild.yaml:11-15, 82-124` · `infra/gcp/desplegar.sh:198-214` · `README.md:43-44` · GitHub API: `actions/workflows` (2 workflows), `actions/workflows/355038450/runs` (37 ejecuciones, últimas 8 `failure`), `actions/runs/37989027205/jobs` (paso 8 `failure`, 9-16 `skipped`) | Completar o retirar el workflow actual (valores reales, migraciones antes del despliegue, semillas solo en `dev`), *Environments* de GitHub con aprobación manual para `pre`/`prod`, matriz por ambiente o disparador de Cloud Build, etiquetas de imagen inmutables (`SIPRA_ETIQUETA`), procedimiento de *rollback* (hoy no existe `update-traffic` ni manejo de revisiones en ningún guion). P-59 quedó resuelto con el repositorio independiente; depende de P-04 (`cloudbuild.yaml` arrancable). Antes de probar el flujo: volver a ejecutar `infra/gcp/arranque-unico.sh` (ya apunta a `sipra-practicas` y actualiza el proveedor existente) o aplicar a mano los dos comandos de §10.9, y retirar el `principalSet` del repositorio antiguo. | No | Bloqueante | 3 – 4 | Despliegues manuales no reproducibles; producción con configuración de pruebas; la afirmación «todo despliegue sale de `git push`» (DT §10.9) no es cierta. |
| **P-04** · Infraestructura | **Unificar nombres, guion canónico y variables de despliegue entre scripts.** Corrección: no son dos convenciones ni cinco archivos, sino **seis familias de nombres divergentes**. (1) **SA**: `sipra-api-<amb>` (aprovisionar, cloudbuild) vs `sipra-app-<amb>` (arranque-unico, desplegar.sh, workflow). (2) **Secretos**: `sipra-db-password-<amb>` / `sipra-jwt-<amb>` / `sipra-oidc-secret-<amb>` (cloudbuild) vs `sipra-<amb>-db-pass` / `sipra-<amb>-jwt` (resto); y los de IA: `aprovisionar-ambiente.sh` crea `sipra-anthropic-<amb>` y **ningún** secreto de OpenAI, mientras `desplegar.sh`, `permisos.sh`, README y `cloudbuild.yaml:108` exigen `sipra-<amb>-openai` y `cloudbuild.yaml:109` espera `sipra-<amb>-anthropic`. (3) **Buckets**: `sipra-<amb>-documentos` vs `<proyecto>-sipra-<amb>-docs` vs `BUCKET=PENDIENTE`. (4) **Base de datos**: `sipra` vs `sipra_<amb>`; `cloudbuild.yaml` no declara `DB_NAME`, así que `opciones-datasource.ts:33` caería a `sipra_dev`. (5) **Colas**: el adaptador exige `sipra-documentos-<amb>` y `sipra-lote-<amb>`; aprovisionar crea solo la primera; arranque-unico crea `sipra-interactiva` y `sipra-lote` sin sufijo. (6) **Frontend**: bucket `sipra-<amb>-web` (cloudbuild) vs nginx en Cloud Run (desplegar.sh, workflow). Además **roles**: `logging.logWriter`, `monitoring.metricWriter`, `cloudtrace.agent` se conceden a `sipra-api-<amb>`, pero `dev` corre con `sipra-app-dev`. Y `cloudbuild.yaml` **no puede producir un `pre`/`prod` que arranque** aunque se corrijan los nombres: el paso `desplegar-api` no fija `DB_USER` ni `DB_NAME` (`configuracion.ts:201-205` rechaza), ni `COLA_DRIVER=cloud_tasks` con `GCP_PROYECTO`/`GCP_CUENTA_SERVICIO`/`WORKER_URL`, ni `CORREO_DRIVER=workspace` con `WORKSPACE_*`, ni `OIDC_CLIENT_ID`/`OIDC_REDIRECT_URI`; el job de migraciones tampoco declara `DB_USER`/`DB_NAME`. | `infra/gcp/aprovisionar-ambiente.sh:63, 69-70, 73-74, 82, 101-105, 110-118, 127-129` · `infra/gcp/cloudbuild.yaml:93-95, 106-109, 117, 122-123, 134-137` · `infra/gcp/arranque-unico.sh:23, 25, 66-68, 78, 102, 124-127` · `infra/gcp/desplegar.sh:28, 59-67, 119, 202-203, 217-218, 226-230` · `infra/gcp/permisos.sh:18-22` · `../.github/workflows/sipra-desplegar.yml:29, 82, 84-85` · `infrastructure/adapters/cola/cola.adapter.ts:124-130` · `infrastructure/persistence/postgres/opciones-datasource.ts:31-33` · `infrastructure/config/configuracion.ts:201-258` · `README.md:53` · `apps/web/Dockerfile:1-2` · `§10.2-§10.4` (930, 939-971) | Elegir **un** guion de aprovisionamiento (`aprovisionar-ambiente.sh` corregido o `arranque-unico.sh` generalizado) y retirar el otro; una sola convención de SA, secretos (incluidos OpenAI/Anthropic), buckets, base, colas y frontend aplicada a todos los archivos; completar variables y secretos de `cloudbuild.yaml` para `pre`/`prod`; corregir DT §10.2-§10.4, que describen `cloudbuild.yaml` y «Cloud Storage + CDN» cuando lo que funciona es `desplegar.sh` + nginx; probar `cloudbuild.yaml` en `qa`. | No | Bloqueante | 3 – 5 | El primer despliegue con el guion oficial falla por SA, secreto, cola o bucket inexistente; `IA_DRIVER=openai` falla en el primer despliegue de `qa`/`pre`/`prod`; quien siga el documento técnico no llega a un ambiente que arranque. |
| **P-05** · Cola de trabajo | **Cloud Tasks nunca se ha ejercitado y el *worker* no es idempotente.** El adaptador y el *worker* existen, pero `COLA_DRIVER=en_proceso` en los tres caminos de despliegue; `GCP_CUENTA_SERVICIO` y `WORKER_URL` no aparecen en ningún guion ni workflow (`configuracion.ts:230-242` los exige y obliga a `cloud_tasks` en `pre`/`prod`). Tres riesgos que el backlog inicial no recogía: (a) **tiempos incoherentes**: `dispatchDeadline` de 300 s frente a `--timeout=120` del servicio, `proxy_read_timeout 120s` de nginx y `OPENAI_TIEMPO_MAXIMO_MS=120000`; una lectura con segundo intento (DT §19.4, `intentos: 2`) supera los 120 s, Cloud Run corta y Cloud Tasks reintenta; (b) **sin idempotencia**: `procesar-trabajo.use-case.ts` y `pipeline-validacion.use-case.ts` reprocesan sin comprobar el estado terminal del documento, así que con `--max-attempts=5` cada reintento vuelve a gastar en IA; (c) los nombres de cola que crean los guiones no coinciden con los que espera el adaptador (ver P-04). Sin pruebas unitarias del adaptador ni del *worker* (P-70). | `infrastructure/adapters/cola/cola.adapter.ts:117-185` (nombres `:128-129`, `dispatchDeadline` `:161`) · `infrastructure/controllers/trabajos.controller.ts:35-57, 77-88` · `infrastructure/config/configuracion.ts:102, 230-242` · `application/use-cases/documentos/procesar-trabajo.use-case.ts:41-59` · `application/use-cases/documentos/pipeline-validacion.use-case.ts:67-72` · `infra/gcp/desplegar.sh:217, 220` · `infra/gcp/cloudbuild.yaml:121-122` · `infra/gcp/aprovisionar-ambiente.sh:127-129` · `../.github/workflows/sipra-desplegar.yml:84, 87` · `apps/web/nginx.conf:39` · `.env.example:84-95` | Crear las colas con el nombre exacto, SA con `cloudtasks.enqueuer`, API sin acceso anónimo con la SA como invocadora, comprobación de estado al inicio del *worker* (o clave de idempotencia por `documentoId` + versión), `--timeout` ≥ 300 s en el servicio que atiende `/trabajos/procesar`, prueba de reintentos y duplicados en `qa`. | Sí — GCP del ambiente | Bloqueante | 4 – 7 | `pre`/`prod` no arrancan; cada reintento duplica el gasto en IA; el pico de 40 000–50 000 documentos (`§7.4`) no se absorbe. |
| **P-06** · Procesos por lote | **Los Cloud Run Jobs de las tareas programadas no existen y Cloud Scheduler no podría ejecutarlos.** `tareas-programadas.sh` crea trabajos de Cloud Scheduler que invocan `sipra-<nombre>-<amb>:run` para `obligaciones`, `purga`, `vacantes`, `reporte-spe` y `sinu`, pero el único job que se despliega es `sipra-migraciones-<amb>` y la API no tiene entrada de proceso para ellos (`apps/api/src` solo tiene `main.ts`, `crear-aplicacion.ts`, `migrar.ts`). `ScheduleModule.forRoot()` está registrado, así que los `@Cron` corren solo mientras haya instancia viva (`--min-instances=0`). Desalineaciones: el servicio tiene `consolidado-arl` a las 7:00 que el `.sh` no programa; el `.sh` programa `reporte-spe` y `sinu` sin método ni job detrás (el `sinu` del servicio es `sincronizarDocentes`); y la cuenta `sipra-api-<amb>` que usa Scheduler como `--oauth-service-account-email` **no recibe** `roles/run.invoker` ni `roles/run.developer` en ningún guion. El comentario `tareas-programadas.service.ts:15` remite a un `infra/gcp/README.md` inexistente. | `infra/gcp/tareas-programadas.sh:9, 13-22, 26-38` · `infra/gcp/desplegar.sh:198-205, 220` · `infra/gcp/cloudbuild.yaml:88-96` · `infra/gcp/aprovisionar-ambiente.sh:116-118` · `infrastructure/modules/tareas-programadas.service.ts:13-17, 35, 47, 55, 66, 89` · `infrastructure/modules/app.module.ts:176` | Entrada `tareas.ts <nombre>` que invoque cada método (incluidos el consolidado de ARL y el reporte diario al SPE), `gcloud run jobs deploy` por tarea en `desplegar.sh`/`cloudbuild.yaml`, permiso de ejecución de jobs a la SA de Scheduler, o bien `min-instances=1` + cerrojo para no duplicar entre instancias; alinear nombres entre el `.sh` y el servicio. | No | Bloqueante | 2,5 – 4,5 | Obligaciones nunca vencen, la purga de cédulas a 30 días no corre (Ley 1581), las vacantes no vencen, el consolidado de ARL no sale. |
| **P-07** · Correo | **Activar Google Workspace (cuenta de servicio con delegación en todo el dominio).** El adaptador está completo (JWT firmado con `node:crypto`, alcance `gmail.send`, suplantación del remitente). Todos los despliegues van con `consola`; `cloudbuild.yaml` ni siquiera declara `CORREO_DRIVER` ni monta `WORKSPACE_*`; `prod` rechaza el arranque sin `workspace`. Nunca se ha enviado un correo real. No hay procesamiento de rebotes (búsqueda de «rebote» y «bounce» → 0): cada intento queda en auditoría con `enviado`, `referencia` y `motivo`, nada más. Advertencia para Tecnología: la delegación exige una **clave privada descargable** de la SA, lo que choca con el principio «sin claves descargables» de DT §10.9 y debe quedar explícito. | `infrastructure/adapters/externos/workspace.adapter.ts:19-25, 33-70, 117-163` · `infrastructure/config/configuracion.ts:122-125, 243-258` · `infrastructure/modules/notificaciones.service.ts:49-76` · `infra/gcp/desplegar.sh:217` · `infra/gcp/cloudbuild.yaml:106-123` · `../.github/workflows/sipra-desplegar.yml:84` | SA con delegación y alcance `gmail.send`, clave privada en Secret Manager (`WORKSPACE_CLAVE_PRIVADA`) con la excepción documentada, remitente institucional, SPF/DKIM, `CORREO_DRIVER`/`WORKSPACE_*` en los tres caminos de despliegue, prueba de entregabilidad, manejo de rebotes. | Sí — Tecnología (administración de Workspace) | Bloqueante | 2 – 3 | `prod` no arranca; el estudiante no recibe devoluciones ni plazos. |
| **P-08** · Catálogos | **Cargar los archivos oficiales completos del DANE y del SENA.** Conteos verificados sobre los CSV: municipios 81 de 1 122; CIIU 21 secciones + 90 clases de 525; CNO 10 grandes grupos + 106 ocupaciones de 436. El manifiesto declara `parcial` con las `url_oficial` y las instrucciones de reemplazo; el ingestor verifica conteos; `GenerarReporteSpeUseCase` bloquea los reportes en `pre`/`prod` mientras siga `parcial` y la CI comprueba que un `completo` falso sea rechazado. | `infrastructure/persistence/postgres/catalogos/manifiesto.json:16-86` · `catalogos/*.csv` (`wc -l`: 82, 112, 117 con encabezado) · `test/reporte-bloqueado.spec.ts:1-60` · `../.github/workflows/sipra-ci.yml:105-127` · `§3.2, §3.4` (182-262) | Descargar de las URL oficiales, exportar CSV con las mismas columnas, marcar `completo` en el manifiesto, `npm run catalogos:cargar` (falla si el conteo no coincide). | Sí — acceso a los archivos oficiales (gestión) | Bloqueante para M9 | 1 – 2 | Reportes al SPE no radicables; vacantes sin ocupaciones ni municipios reales. |
| **P-09** · Reportes SPE | **Conciliar el anexo técnico del SPE y registrar el NIT del prestador.** `SPE_ANEXO_CONFIRMADO=false` y `SPE_NIT_PRESTADOR='000000000'` por defecto; los archivos llevan `# BORRADOR_SIN_ANEXO_CONFIRMADO` en cabecera y el controlador calcula `x-sipra-radicable` como `!esBorrador && advertencias.length === 0`. `CAMPOS_VACANTE`/`CAMPOS_PLAZA` son el punto único a conciliar. | `configuracion.ts:113-116` · `.env.example:97-103` · `domain/services/reportes-spe.domain-service.ts:19-22, 57-60, 136-160` · `infrastructure/controllers/reportes.controller.ts:77-95` · `§8.6, §15.1` (769-807, 1303-1305) | Lista de campos del anexo vigente para prestadores con plataforma propia (Extensión), ajustar `CAMPOS_VACANTE`/`CAMPOS_PLAZA`, NIT real, actualizar `test/reportes-spe.spec.ts`. | Sí — Dirección de Extensión | Bloqueante para M9 | 1 – 3 | Radicación manual; archivos solo como borrador. |
| **P-10** · Jurídica | **Validación de tratamiento de datos y transferencia internacional.** Región `us-central1` fija en seis lugares (`configuracion.ts`, los cuatro guiones de `infra/gcp` y el workflow); no hay región en Colombia (Circular Externa 005 de 2017). DT §10.8 declara la transferencia y remite a Jurídica; el pie del documento advierte que las referencias normativas requieren validación jurídica. La decisión automatizada del pipeline y la retención de 30 días existen como se describe. El texto de la autorización es insumo de P-62: hoy el consentimiento **no se recoge** en la plataforma. | `§10.8, §15.2 (2), §6.6, §7.9` (454-465, 1002-1008, 1341-1342) · `configuracion.ts:84` · `infra/gcp/aprovisionar-ambiente.sh:20` · `infra/gcp/arranque-unico.sh:18` · `infra/gcp/desplegar.sh:17` · `infra/gcp/cloudbuild.yaml:17` · `../.github/workflows/sipra-desplegar.yml:26` · `infrastructure/modules/tareas-programadas.service.ts:61-86` | Documento de transferencia, aviso de privacidad y texto de la autorización (obligación «Autorización de tratamiento», `§8.1`), política de retención (30 días cédulas), análisis de decisión automatizada (`GestionarDocumentoUseCase.decidir`), decisión sobre región (Chile/Brasil). | Sí — Dirección Jurídica | Bloqueante | 0,5 – 1 (técnico) | No se puede encender con datos reales. |
| **P-11** · Jurídica / IA | **Acuerdo de tratamiento con OpenAI (DPA, retención cero).** El adaptador envía el PDF (`input_file`, base64) o la imagen (`input_image`) completos y la lectura (campos, evidencias, resumen) se guarda en `documentos.extraccion` (`jsonb`). Mitigaciones ya presentes que conviene citar en la gestión: las peticiones van con `store: false` y la purga por retención reduce la lectura guardada a modelo/tokens/costo. Nada de eso sustituye el acuerdo contractual. | `infrastructure/adapters/ia/openai.adapter.ts:185, 201-223, 253` · `infrastructure/persistence/postgres/entities/todas.orm-entity.ts:117` · `application/use-cases/documentos/procesar-trabajo.use-case.ts:112-146` · `§19.4, §10.2` (1728-1748) | DPA con OpenAI, *zero data retention* si está disponible, inventario de datos enviados, decisión sobre documentos de identidad (hoy el PDF417 evita la IA cuando se lee). | Sí — Jurídica | Bloqueante | 0,5 | Transferencia a un tercero sin base contractual. |
| **P-12** · Bolsa de empleo | **Acto administrativo ante la Unidad del SPE y ocultar la bolsa hasta entonces, del lado del servidor.** La ruta `/bolsa` no tiene `canActivate`, pero `rolGuard` se declara expresamente «NO un control de seguridad»: la ocultación debe ser en la API. `GET /bolsa/vacantes` no tiene `@Roles` (cualquier sesión lista vacantes) y no existe ninguna bandera de ambiente para la bolsa (`grep -i bolsa` en `configuracion.ts` y `.env.example` → 0). El controlador documenta la dependencia del acto administrativo. | `§8.5, §15.2 (1)` (758-767, 1339-1340) · `apps/web/src/app/app.routes.ts:100-105` · `apps/web/src/app/core/guards/sesion.guard.ts:12-24` · `infrastructure/controllers/bolsa.controller.ts:15-22, 42-53` | Gestión de Extensión y Jurídica; bandera de ambiente evaluada en la API (y `@Roles` en el listado) para no exponer vacantes en marco `laboral` hasta la autorización; guard en la ruta web. | Sí — Unidad del SPE | Bloqueante para M7 | 0,5 (técnico) | Intermediación laboral sin autorización. |
| **P-13** · Seguridad de red y sesión | **Endurecer la exposición de la API, el frontend y la sesión del navegador.** En `dev` API y web se despliegan `--allow-unauthenticated`; `cloudbuild.yaml` ya usa `--no-allow-unauthenticated --ingress=internal-and-cloud-load-balancing`, pero el proxy de nginx no adjunta ningún token de identidad, así que esa configuración produciría 403 sin balanceador o IAP delante: endurecer la API obliga a rediseñar el camino web→API, no solo a cambiar una bandera. No hay *rate limiting* (sin `@fastify/rate-limit` ni `@nestjs/throttler`), la CSP de la API está desactivada, el JWT dura 8 h sin revocación ni *refresh* y `salir()` solo borra el almacenamiento local (no hay cierre de sesión en el servidor). **Frontend:** el JWT completo se guarda en `localStorage` (expuesto a cualquier XSS); los `add_header` de seguridad de `nginx.conf` están a nivel de `server`, pero los bloques `location` de estáticos y de `index.html` declaran su propio `add_header Cache-Control` y nginx **no hereda** en ese caso: el documento principal y los artefactos se sirven **sin** `X-Frame-Options`, `nosniff`, `Referrer-Policy` ni `X-Robots-Tag`; no hay `Content-Security-Policy`, `Strict-Transport-Security` ni `Permissions-Policy` en ninguna parte del frontend. | `infra/gcp/desplegar.sh:219, 229` · `infra/gcp/cloudbuild.yaml:115-116` · `../.github/workflows/sipra-desplegar.yml:86, 120` · `apps/api/src/crear-aplicacion.ts:29-32` · `infrastructure/config/configuracion.ts:63` · `apps/web/nginx.conf:8-11, 20-26, 32-41` · `apps/web/src/app/core/auth/sesion.service.ts:71-80` · `apps/api/package.json` (sin `@fastify/rate-limit` ni `@nestjs/throttler`) · `§10.2` | Balanceador HTTPS con dominio institucional y certificado (o IAP) y token de identidad en el camino nginx→API, Cloud Armor o `@fastify/rate-limit` (formulario público de empresas, `§6.4`), lista de revocación o rotación de `JWT_SECRETO` y cierre de sesión en servidor, token fuera de `localStorage` (cookie `HttpOnly` o memoria), repetir las cabeceras en cada `location` o moverlas a un `include`, definir CSP, HSTS y Permissions-Policy. | Sí — Tecnología (dominio, certificados) | Bloqueante | 4 – 6 | Superficie pública abusable; sesiones no revocables; la página se sirve sin ninguna cabecera de seguridad. |
| **P-14** · Respaldo | **Runbook y ensayo de restauración.** `aprovisionar-ambiente.sh` activa PITR y `REGIONAL` solo en `prod` y retiene 30 respaldos, pero `arranque-unico.sh` (el que sí creó `dev`) solo fija `--backup-start-time`; el versionado del bucket de documentos existe únicamente en `aprovisionar-ambiente.sh`, no en `arranque-unico.sh`. DT §10.7 promete RTO 4 h, RPO 1 h y «prueba de restauración semestral documentada», que no existe. | `infra/gcp/aprovisionar-ambiente.sh:29-38, 60-72, 88-89` · `infra/gcp/arranque-unico.sh:77-80, 103-105` · `§10.7` (995-1000) | Procedimiento de restauración (clon/PITR de Cloud SQL + versionado del bucket), activar versionado en `dev`, ensayo en `qa`, registro con tiempos medidos. | No | Alta | 1 – 2 | RTO/RPO no demostrables ante una pérdida. |
| **P-15** · Observabilidad | **Alertas en Cloud Monitoring y roles de métricas.** Las seis reglas (`TasaDeErroresAlta`, `LatenciaP95Alta`, `TasaAutoAprobacionBaja`, `ObligacionesArlVencidas`, `AccesosFueraDeAlcance`, `CostoIaSobreTope`) existen solo para el Prometheus local; en GCP no hay políticas, canal ni recolección de `/metrics` en ningún guion; `permisos.sh` intenta `logging.logWriter` y `monitoring.metricWriter` y, si falla, imprime la orden; DT §10.10 los declara pendientes para `sipra-app-<amb>`. | `infra/docker/alertas.yml:1-57` · `infra/docker/prometheus.yml:1-19` · `infra/gcp/permisos.sh:24, 67-88` · `§10.10` (1076-1083), `§11` (1092-1122) | Políticas equivalentes (uptime de `/api/v1/salud`, 5xx > 1 %, P95 > 500 ms, auto-aprobación < 60 %, costo IA, ARL vencidas), canal de correo/chat, recolección de `/metrics` con Managed Prometheus desde la red interna (ver P-71), conceder los dos roles a la SA que realmente corre. | Sí — IAM de proyecto (Tecnología) | Alta | 2 – 3 | Incidentes y caída de la auto-aprobación sin aviso. |
| **P-16** · Rendimiento | **Prueba de carga con el volumen de pico.** Nunca se ha medido el cierre de periodo; no hay herramienta ni guion (`k6`, `artillery`, `autocannon`, `locust` → solo coincidencias casuales en `package-lock.json`). | `§7.4, §10.6, §15` (M4b) (505-536, 983-993, 1285) · búsqueda en `sipra/` sin resultados en código | Guion (k6 o artillery) contra `qa` con Cloud Tasks real: cargue concurrente, profundidad de cola, P95, `max-instances`, costo de IA por hora. | No (requiere P-05) | Alta | 3 – 5 | Colapso en las dos últimas semanas del periodo. |
| **P-17** · Lectura con IA | **Calibrar el pipeline con documentos reales durante el piloto.** El arnés `ia:evaluar` genera un corpus sintético con pdfkit y solo instancia `simulado` u `openai`; es el único archivo de `herramientas/` (y queda fuera del lint, P-76). La tasa de auto-aprobación (indicador del proyecto) no se puede afirmar. Los umbrales son parámetros operativos `pipeline.umbral_verde` / `pipeline.umbral_amarillo` con validación de coherencia; la regla `TasaAutoAprobacionBaja` fija el 60 % como alarma. | `apps/api/herramientas/evaluar-lectura.ts:1-40, 250-266` · `application/use-cases/administracion/parametros.use-case.ts:107-108, 148-150` · `infra/docker/alertas.yml:25-36` · `§15.1` («Calibración del pipeline»), `§19.2` (1284, 1312-1314) | Muestra anonimizada por tipo documental (con aval jurídico), corrida `ia:evaluar --driver=openai` extendida a corpus real, matriz de confusión por tipo y criterio, ajuste de umbrales y de `CRITERIOS_DOCUMENTALES`, medición de la banda amarilla. | Sí — datos reales (Jurídica, Área de Prácticas) | Alta (bloqueante para escalar más allá del piloto) | 5 – 8 | Devoluciones falsas o aprobaciones indebidas; el objetivo del 10–15 % de revisión humana no se demuestra. |
| **P-59** · Entrega / repositorio | **Resuelto el 14 de octubre de 2026: SIPRA tiene repositorio propio.** Hallazgo original: SIPRA no existía en `main` del repositorio `Productoacademico` (`git ls-tree origin/main` solo mostraba la app Producto Académico y la rama `claude/sipra-practicas-setup-l0zasi` estaba **56 commits adelante y 0 atrás**), de modo que `sipra-ci.yml` nunca había corrido y fusionar habría publicado `sipra/**` en `productoacademico.netlify.app` (`netlify.toml` con `publish = "."` sin exclusiones). Resolución: la carpeta `sipra/` se separó con `git subtree split` a este repositorio privado, `ironfuentes-netizen/sipra-practicas`, conservando los 57 commits de historial; la rama principal es `main`; los flujos de GitHub Actions pasaron a `.github/workflows/`; Netlify no interviene. | `git subtree split --prefix=sipra` (57 commits) · `git log --oneline main` en este repositorio · `.github/workflows/ci.yml:6-8` · GitHub Actions: ejecución 38628704343 de «SIPRA · integración continua» en verde (14 de octubre de 2026) | Queda decidir si la carpeta `sipra/` del repositorio Producto Académico se retira o se deja como historial (decisión del propietario). | No | Resuelto | 0 | Ninguno, siempre que no se sigan haciendo cambios en la copia antigua: desde ahora todo cambio de SIPRA se hace aquí. |
| **P-60** · Identidad / piloto | **Cargue inicial de estudiantes del periodo y alta provisional de usuarios `empresa` y `estudiante`.** No hay código que cree usuarios `estudiante` desde SINU ni desde un cargue: `gestionar-usuarios.use-case.ts:18-19` lo delega a «la matrícula (SINU)» sin implementarlo y todos los usos de `sinu.buscarPorDocumento` son de solo consulta. `CrearUsuarioDto.rol` está restringido a `ROLES_ADMINISTRATIVOS` (sin `empresa` ni `estudiante`) y el caso de uso fija `empresaId: null`; los estudiantes y el único usuario `empresa` del sistema provienen de las semillas. Con OIDC obligatorio en `pre`/`prod` y el rechazo de cuentas sin perfil activo, **ningún estudiante podría entrar** al piloto hasta cargar sus perfiles, independientemente de P-18. | `application/use-cases/administracion/gestionar-usuarios.use-case.ts:18-19, 48, 54-72` · `application/dtos/usuario.dto.ts:13` · `domain/value-objects/rol.vo.ts:37-43` · `application/use-cases/practicas/registrar-practica.use-case.ts:120` · `application/use-cases/administracion/vistas-sinu.use-case.ts:73, 112` · `infrastructure/controllers/auth.controller.ts:108-114` · `infrastructure/config/configuracion.ts:182-187` · `infrastructure/persistence/postgres/seeds/ejecutar-semillas.ts:205-218` | Cargue inicial de estudiantes del periodo (CSV del listado de matriculados o desde el simulado de SINU) y alta manual provisional por administrador de usuarios `empresa` (con `empresaId`) y `estudiante` (con `programaId`) mientras llegan P-19 y P-35; debe estar listo **antes** de encender OIDC (P-01). | Sí — Registro / Área de Prácticas (listado de matriculados); arranca con el simulado | Bloqueante para el piloto | 3 – 4 | El piloto en `pre` no puede empezar; en `qa`/`pre` no hay forma de incorporar estudiantes ni empresas sin tocar la base a mano. |

---

#### B) Integraciones reales pendientes

| ID · Área | Título y descripción | Evidencia | Qué se necesita | Dep. externa | Prioridad | Días | Riesgo si no se hace |
|---|---|---|---|---|:--:|:--:|---|
| **P-18** · SINU | **Adaptador HTTP real de SINU (matrícula y asignación docente).** La configuración admite `SINU_DRIVER=http`, `SINU_BASE_URL`, `SINU_API_KEY`, pero `app.module.ts` enlaza **siempre** el simulado y no existe ninguna clase HTTP (`grep 'class .*Sinu'` → solo el simulado). El diagnóstico de administración reporta ese driver como si tuviera efecto, lo que induce a error. `.env.example:73` declara `SINU_VENTANA_SINCRONIZACION_CRON`, variable que ningún archivo de `src` lee (el cron está fijo en `tareas-programadas.service.ts:35`); `CORREO_DRIVER` aparece dos veces en `.env.example` (`:76` y `:108`). | `configuracion.ts:118-120` · `infrastructure/modules/app.module.ts:253-254` · `infrastructure/adapters/externos/externos.adapter.ts:57-129` · `domain/ports/out/servicios-externos.port.ts:91-126` · `infrastructure/controllers/administracion.controller.ts:81` · `.env.example:69-76, 108` · `§15.2 (3)` (1320-1324, 1343-1344) | Método de acceso (`§15.2 (3)`: API, vista o réplica), adaptador que implemente los tres métodos de `SinuPort`, mapeo de `MatriculaSinu`, factoría por driver en `app.module.ts`, pruebas de contrato; mientras tanto, retirar o conectar las variables muertas y corregir el diagnóstico. | Sí — Tecnología / SINU | Alta | 5 – 10 | Matrícula, docentes y vistas SINU con datos sintéticos; sincronizador sin efecto real; variables que prometen lo que no hacen. |
| **P-19** · Identidad | **Alta y sincronización de estudiantes desde SINU e invitaciones de un solo uso (M1).** Corrección: «los usuarios se crean a mano» era impreciso. Los **docentes** ya se crean y asignan automáticamente desde SINU (simulado) en la sincronización diaria; los **administrativos** sí se crean a mano; lo que **no existe** es ninguna vía para dar de alta **estudiantes** (P-60 cubre el cargue inicial del piloto; este ítem, la sincronización permanente). Las invitaciones de un solo uso no existen (`grep -i invitac` → solo la plantilla de correo). | `application/use-cases/administracion/vistas-sinu.use-case.ts:153-206` · `application/use-cases/administracion/gestionar-usuarios.use-case.ts:18-19, 48` · `infrastructure/modules/tareas-programadas.service.ts:35` · `infrastructure/controllers/auth.controller.ts:108-114` · `domain/services/plantillas-notificacion.domain-service.ts:268-277` · `§15` (M1) (1281) | Tarea de sincronización de estudiantes (alta/baja por periodo) sobre `SinuPort`, que puede empezar con el simulado antes de P-18 y cerrarse con el adaptador real; tokens de un solo uso con vencimiento para administrativos y docentes. | Sí — P-18 para datos reales (arranca con el simulado) | Alta | 3 – 5 | Gestión manual de cientos de estudiantes cada periodo; sin P-60 ni esto, nadie entra en producción. |
| **P-20** · RUES | **Consulta real al RUES por NIT.** `RuesSimuladoAdapter` responde tres NIT fijos; `app.module.ts:253` lo enlaza sin factoría; el caso de uso ya tolera la indisponibilidad (el `catch` deja señal `advertencia`). No hay otra implementación de `RuesPort`. | `infrastructure/adapters/externos/externos.adapter.ts:8-55` · `infrastructure/modules/app.module.ts:253` · `application/use-cases/empresas/gestionar-empresa.use-case.ts:102-147` · `domain/ports/out/servicios-externos.port.ts:77-89` · `§2.3, §15` (M6) (134, 1287) | Convenio o servicio (Confecámaras/RUES), adaptador con caché (si se conserva Redis, ver P-47), factoría por driver. | Sí — convenio de acceso (Tecnología/Jurídica) | Alta | 3 – 5 | Habilitación de empresas sin contraste externo. |
| **P-21** · C-Digital | **Carga de la nota en C-Digital tras el cierre.** `cierre.domain-service.ts` calcula la aprobación con `nota` y `NOTA_MINIMA_APROBACION`; no hay puerto ni adaptador hacia C-Digital (la única mención en `src` es una pregunta frecuente). La carga sigue manual. | `domain/services/cierre.domain-service.ts:1-48` · `domain/entities/preguntas-frecuentes.ts:441` · `§15.1` («Nota a C-Digital»), `§17.4` (1326-1328, 1528-1536) | Mismo método de acceso que SINU; puerto nuevo; registro en auditoría del envío. | Sí — Tecnología | Media | 3 – 5 | Doble digitación del docente. |
| **P-22** · EPS | **Verificación de afiliación a EPS en ADRES o RUAF.** El servicio de dominio deja la EPS como `revision_manual` cuando el régimen es especial/FOMAG o falta fecha y, cuando cumple la vigencia, solo anota «se contrasta en ADRES o RUAF» sin consulta alguna. No existe puerto para ADRES/RUAF. | `domain/services/validacion-arl.domain-service.ts:9-18, 100-115` · `§17.4` (1322-1324, 1530) | Acceso (BDUA de ADRES o RUAF por convenio), puerto y adaptador, mantener «revisión manual» como respaldo. | Sí — ADRES/RUAF | Media | 3 – 6 | Carga del auxiliar en cada solicitud de ARL. |
| **P-23** · ARL | **Archivo de afiliación en lote y novedades PILA (M5).** El consolidado diario se envía por correo a las 7:00 (`enviarConsolidadoDiario`); Capital Social expide el certificado y el auxiliar lo remite a mano. No hay archivo de afiliación en lote ni novedades/retiros (`lote`, `pila` en el caso de uso → 0). | `infrastructure/modules/tareas-programadas.service.ts:43-52` · `application/use-cases/practicas/solicitud-arl.use-case.ts:219-295, 314-321` · `§15` (M5), `§15.1` (1286, 1321-1322) | Formato que acepte Capital Social/ARL, generación por lote desde las aprobadas, registro de retiros (novedades). | Sí — Capital Social / ARL | Media | 4 – 6 | Afiliaciones una a una. |
| **P-24** · Cédula (PDF417) | **Confirmar la disposición de la trama con la Registraduría.** `DISPOSICION_TRAMA.confirmada = false` con posiciones supuestas; el pipeline entrega nombres y apellidos con confianza 0 mientras no se confirme y la comparación de titular queda en `null` (DT §7.13). Existen `test/pdf417.spec.ts` y `test/pdf417-adaptador.spec.ts`. | `domain/services/pdf417.domain-service.ts:30-50` · `application/use-cases/documentos/pipeline-validacion.use-case.ts:538-566` · `test/pdf417.spec.ts` · `§7.13, §15.1` (659-686, 1307-1310) | Especificación oficial o muestra controlada con consentimiento; ajustar la constante; ampliar `test/pdf417.spec.ts`. | Sí — Registraduría / consentimientos | Media | 0,5 – 1 | No se detecta la cédula de otra persona. |
| **P-25** · Costos de IA | **Recalibrar el estimador con `usage` real.** `gpt-6-luna` lleva `publicada: false` en su regla de imagen: se asume el multiplicador de la familia. Los supuestos están en `SUPUESTOS_PREDETERMINADOS`. El arnés `ia:evaluar` ya reporta tokens y costo reales, así que la recalibración tiene herramienta. | `domain/entities/tarifas-ia.ts:17-18, 71-80` · `domain/services/costos-ia.domain-service.ts:59-83` · `apps/api/herramientas/evaluar-lectura.ts:1-19` · `§19.5` (1766-1775) | Primeras 200 lecturas reales, comparar tokens estimados vs reales por tipo, ajustar los supuestos. | Sí — llave de OpenAI | Media | 1 – 2 | Presupuesto por estudiante errado. |
| **P-26** · Costos de IA | **Batch API o `service_tier: flex` para el lote nocturno (−50 %).** El descuento es solo un campo informativo (`descuentoLotePorcentaje`); el adaptador llama `POST {urlBase}/responses` de forma síncrona y no envía `service_tier` ni usa la Batch API; la cola `lote` existe en ambos adaptadores. | `domain/entities/tarifas-ia.ts:47-48` · `infrastructure/adapters/ia/openai.adapter.ts:178, 322` · `infrastructure/adapters/cola/cola.adapter.ts:24, 124-130` · `§19.5` (1750-1799) | Adaptador de lote (JSONL, sondeo de resultados) o `flex` como alternativa simple; decidir qué va a lote (reprocesos, segunda pasada). | No | Media | 4 – 6 | Costo doble en lote (hoy ≈ 13 USD por 1 000 estudiantes: impacto bajo). |
| **P-27** · Lectura con IA | **Segunda pasada con modelo mayor para casos dudosos.** `gpt-5.6-terra` y `gpt-6.1-sol` llevan `recomendacion: 'escalamiento'`, pero `escalamiento` no aparece en `src` fuera de `tarifas-ia.ts`: ningún camino del pipeline hace una segunda lectura con otro modelo; `OPENAI_MODELO_ESCALAMIENTO` no existe en `configuracion.ts`. El acumulado `gastoPrevioUsd` (DT §19.4) ya sumaría una segunda pasada. | `domain/entities/tarifas-ia.ts:55, 88-94, 102-109` · `infrastructure/config/configuracion.ts:88-105` · `§19.5` (1733-1735, 1761-1762) | Regla en `PipelineValidacionUseCase` (banda amarilla + criterios no determinables → segunda lectura con `OPENAI_MODELO_ESCALAMIENTO`), parámetro operativo, acumulación con `gastoPrevioUsd`. | No | Media | 3 – 4 | Más documentos a revisión humana de los necesarios. |
| **P-28** · Lectura con IA | **Verificar el adaptador de Anthropic con llave real.** Modelo por defecto `claude-sonnet-5`, URL `api.anthropic.com/v1/messages`, cabecera `anthropic-version: 2023-06-01`, salida JSON libre con limpieza de cercas, `max_tokens: 2048`; a diferencia del de OpenAI, **no tiene** tiempo máximo (`AbortSignal`), ni reintento, ni clasificación de errores. El arnés solo construye simulado u OpenAI. Si el identificador de modelo y la tarifa son vigentes no puede determinarse desde el repositorio. | `infrastructure/adapters/ia/extraccion.adapter.ts:218-300` · `infrastructure/config/configuracion.ts:104-105, 259-261` · `domain/entities/tarifas-ia.ts:222-229` · `apps/api/herramientas/evaluar-lectura.ts:250-266` | Confirmar modelo y tarifa vigentes, salida estructurada, tiempo máximo y reintentos como en OpenAI, extender el arnés a `--driver=anthropic`. | Sí — llave | Baja | 1 – 2 | La alternativa de proveedor no está probada. |

---

#### C) Funcionalidad faltante del proceso

| ID · Área | Título y descripción | Evidencia | Qué se necesita | Dep. externa | Prioridad | Días | Riesgo si no se hace |
|---|---|---|---|---|:--:|:--:|---|
| **P-29** · Bolsa de empleo | **Postulaciones: casos de uso, API y pantalla.** Existen la entidad, los estados, las tablas `postulaciones` y `habilitaciones_bolsa` y un DTO, pero no hay puerto de repositorio, caso de uso, ruta ni interfaz. Más amplio de lo descrito: `habilitaciones_bolsa` no tiene entidad ORM (`todas.orm-entity.ts` solo declara `PostulacionOrm`) y `listar()` para estudiante no comprueba habilitación alguna; la pantalla web solo lista vacantes y valida texto (no hay formulario para crear ni publicar: `api.service.ts` tiene `publicarVacante` sin uso y no existe `crearVacante`); la única prueba del módulo es `antidiscriminacion.spec.ts` y `GestionarVacanteUseCase` no tiene pruebas. | `domain/entities/vacante.entity.ts:20-33` · `application/dtos/vacante.dto.ts:43-46` · `application/use-cases/vacantes/gestionar-vacante.use-case.ts:34-139` · `infrastructure/controllers/bolsa.controller.ts:29-84` (validar-texto, listar, crear, publicar) · `infrastructure/persistence/postgres/migrations/1756000000000-EsquemaInicial.ts:253-280` · `infrastructure/persistence/postgres/entities/todas.orm-entity.ts:165-175` (sin `HabilitacionBolsaOrm`) · `domain/ports/out/repositorios.port.ts:128-134` · `apps/web/src/app/features/bolsa/bolsa.component.ts:104-128` · `apps/web/src/app/core/services/api.service.ts:278-292` · `§4.4, §15` (M7) | Puerto y adaptador (incluida la entidad de habilitaciones), casos de uso (postular, cambiar estado, listar por empresa y estudiante), habilitación con vigencia comprobada en `listar()`, pantallas para estudiante, empresa y Extensión (incluido crear/publicar vacante), notificaciones, auditoría y pruebas. Requiere P-66 (ciclo de la vacante). | Sí — P-12 para activar | Alta | 6 – 10 | M7 inoperante aun con la autorización del SPE. |
| **P-30** · Administración | **Pantalla de Parámetros (M12) en la web.** La API expone `GET/PUT/DELETE administracion/parametros` (líneas 105-168; el `DELETE` va en 148-168), pero en la web no hay ruta `parametros`, ni entrada de menú en `shell.component.ts`, ni modelo en `modelos.ts`, ni método en `api.service.ts` (`grep -i parametro apps/web/src/app` → 0); hoy la Dirección solo podría cambiarlos por Swagger o `curl`. | `infrastructure/controllers/administracion.controller.ts:105-168` · `apps/web/src/app/app.routes.ts:8-130` (sin `parametros`) · `apps/web/src/app/core/services/api.service.ts` (sin `parametros`) · `apps/web/src/app/layout/shell.component.ts` (sin entrada) · bitácora 0.8 | Componente con lista, naturaleza (operativo/normativo con norma citada), edición con motivo ≥ 10 caracteres, restauración a fábrica; servicio en `api.service.ts`; junto con P-55 para que cada cambio surta efecto. | No | Alta | 2 – 3 | El beneficio central de M12 («parametrizar sin desplegar») no llega al usuario. |
| **P-31** · Reportes SPE | **Informe estadístico mensual (remitidos/colocados) y plantillas SNIES.** Solo existen `GET reportes/spe/vacantes`, `GET reportes/spe/plazas` (diarios) y `GET reportes/catalogos`; «SNIES» aparece únicamente en el documento técnico. `ESTADOS_REPORTABLES_SPE` (`remitido`, `colocado`) está definida y no la usa ningún archivo de `src` ni de `test`; el informe mensual depende además de P-29 (sin postulaciones no hay remitidos ni colocados que contar). | `infrastructure/controllers/reportes.controller.ts:24-68` · `domain/entities/vacante.entity.ts:29-33` · `§15` (M9) (1290, 326-337) · `grep -rn ESTADOS_REPORTABLES_SPE apps/api/src apps/api/test` → solo la definición | Formato del informe mensual (Extensión) y plantillas SNIES (Registro/Planeación), casos de uso y exportación. | Sí — Extensión / Registro | Media | 4 – 6 | Reportes manuales mes a mes. |
| **P-32** · Notificaciones | **Bandeja de notificaciones dentro de la plataforma.** `NotificacionPort` solo tiene `enviar()` (correo); no hay tabla `notificaciones`, ni entidad ORM (14 entidades, ninguna de notificaciones), ni servicio ni componente de bandeja/campana en la web. | `domain/ports/out/servicios-externos.port.ts:146-149` · `infrastructure/persistence/postgres/entities/todas.orm-entity.ts` · `§15` (M10), `§17.4` (1287, 1535) | Tabla `notificaciones`, puerto, marcar leído, campana en `layout/shell.component`, sondeo o SSE. | No | Media | 4 – 6 | Dependencia total del correo. |
| **P-33** · Administración | **Historial de cambios por parámetro.** La auditoría guarda valor anterior, nuevo, autor y motivo, pero se registra con `entidad: 'parametro'` y `entidadId: null`; la clave viaja solo en `metadatos.clave` y `AuditoriaRepositoryPort.listar` no filtra por metadatos: el historial por clave exige ampliar el puerto y el adaptador (consulta sobre `metadatos->>'clave'`) además del endpoint y la vista. | `infrastructure/controllers/administracion.controller.ts:138-141, 160-163` · `domain/ports/out/repositorios.port.ts:136-147` · `§15` (M12) · bitácora 0.8 | Filtro por metadatos en puerto y adaptador, endpoint `GET parametros/:clave/historial` y vista (junto con P-30). | No | Baja | 1 – 2 | Trazabilidad solo por la auditoría general. |
| **P-34** · Prácticas | **Flujo propio de validación de experiencia laboral: comité, acta y cruce con PILA.** Corrección: la modalidad **no** «pasa directo a `finalizada`». El grafo permite `inscrita → finalizada` para las modalidades sin afiliación nueva, pero ningún caso de uso ni controlador invoca esa transición (arista muerta); en la práctica sigue el flujo normal y lo que se exime es la compuerta ARL (`verificarCompuertaArl` retorna de inmediato para `SIN_AFILIACION_NUEVA`), exención que cubre también `combinacion_funciones`. Sí hay controles documentales (certificado laboral con funciones y contrato en formalización, ARL en inicio, plan en avance, formato de seguimiento final en cierre). El mensaje de error aún habla de «homologación» (nombre anterior; ver P-49). Lo que realmente falta: flujo de comité/decisión con acta y el cruce certificación laboral vs planilla de aportes (PILA), señalado como el mayor riesgo de fraude. | `domain/entities/practica.entity.ts:3-7, 162-166, 233-236, 256-268` · `domain/entities/modalidad.entity.ts:39, 360-384` · `domain/services/obligaciones.domain-service.ts:25` · migración `1756000004000-ModalidadesRealesYEtapas.ts:20` · `§4.1` (285-304), `§7.14` (697-700), `§15` (M2) | Definición con el Área de Prácticas (documentos, decisión, actas), transiciones de comité, cruce certificación laboral vs PILA, retirar la arista muerta o usarla, corregir el mensaje. | Sí — Área de Prácticas | Media | 4 – 6 | Fraude no controlado en la modalidad más sensible. |
| **P-35** · Empresas | **Invitación de administrador de empresa de un solo uso (72 h), creación del usuario `empresa` y verificación antibots.** La plantilla promete «un solo uso y vence en 72 horas», pero `EventoNotificable.INVITACION_EMPRESA` tiene cero emisores y **no existe ninguna vía en operación para crear un usuario con rol `empresa`**: `CrearUsuarioDto.rol` está restringido a `ROLES_ADMINISTRATIVOS` y el caso de uso fija `empresaId: null`; el único usuario `empresa` lo crea la semilla. Habilitar una empresa (`decidir → habilitar`) no crea usuario ni envía invitación. El formulario público tiene solo el campo trampa `sitioWebAlterno` (dos rutas públicas: `POST empresas/solicitudes` y `POST empresas/nit/verificar`). | `domain/services/plantillas-notificacion.domain-service.ts:137-138, 268-281` · `application/dtos/usuario.dto.ts:13` · `domain/value-objects/rol.vo.ts:37-43` · `application/use-cases/administracion/gestionar-usuarios.use-case.ts:72` · `application/use-cases/empresas/gestionar-empresa.use-case.ts:38, 170-200` · `infrastructure/controllers/empresas.controller.ts:24-25, 46-47` · `infrastructure/persistence/postgres/seeds/ejecutar-semillas.ts:215-218` · `§6.4, §15` (M6) (431-443) | Tabla de invitaciones (hash del token, vencimiento), emisión al habilitar, endpoint de aceptación que crea el usuario `empresa` con `empresaId`, reCAPTCHA/Turnstile en el formulario público (ajustar CSP del frontend, P-13), *rate limit*; el formulario público en sí es P-64. | No (cuenta de Turnstile/reCAPTCHA) | Alta | 3 – 5 | Empresas habilitadas sin usuario para operar; abuso del formulario público. |
| **P-36** · Acompañamiento | **Pulso mensual de dos toques.** `AcompanamientoDomainService.evaluar` solo usa reenvíos, estados de documentos, obligaciones, respuesta de la empresa y cierre de periodo; «pulso» no aparece en `apps/api/src` ni `apps/web/src`. Decisión pendiente de la Dirección. | `domain/services/acompanamiento.domain-service.ts:5-40` · `grep -rni pulso` → 0 · `§15` (M8), `§15.1` (1286, 1314-1316) | Decisión; luego formulario de dos preguntas, recordatorio y alimentación de la señal. | Sí — Dirección | Baja | 2 – 4 | Sin información entre inicio y cierre. |
| **P-37** · Proceso SGP | **Acta de inicio digital generada desde la plataforma.** Corrección: la evidencia del backlog inicial era solo documental y mezclaba dos trabajos. La comparación «jefe del FUR vs firmante del acta» cuesta 0,5–1 día y va en P-65 (los insumos ya existen). Lo que falta por completo es el **acta de inicio digital con campos**: hoy el acta se carga como documento externo y la regla `C3_FIRMANTE_DISCREPANTE` compara `planilla_horas.nombre_firmante` contra `carta_aceptacion.firma_representante`, no el acta. | `infrastructure/adapters/ia/extraccion.adapter.ts:336-340, 387-397` · `domain/entities/campos-extraccion.ts:23-26` · `domain/entities/criterios-documentales.ts:86-100` · `§17.4, §7.10` (626-636, 1530-1531) | Formulario del acta (partes, jefe inmediato, fechas, funciones), generación PDF con el patrón de `cartas_presentacion`, aceptación de la empresa, registro como documento del expediente. | No | Media | 3 – 5 | Revisión manual del auxiliar en cada acta; doble digitación. |
| **P-38** · Documentos | **Firmas digitales certificadas.** Los criterios exigen «Firma digital del jefe inmediato; el nombre escrito no es firma» y `FIRMA_VALIDA`, pero la única verificación es el campo `firmas_presentes` que el modelo rellena visualmente; no hay validación PAdES/CMS ni lista de certificadoras (`pades`, `pkcs`, `certificadora`, `ONAC` → 0). | `domain/entities/criterios-documentales.ts:40, 157` · `domain/entities/campos-extraccion.ts:25, 43, 73, 81, 89, 119` · `§15` (M13), `§17.4, §17.5, §7.1` (1291, 1532) | Validación de firmas PAdES/CMS en PDF, lista de certificadoras acreditadas, resultado como bandera determinística. | Sí — ONAC / certificadoras | Baja | 4 – 6 | Firma falsa no detectable. |
| **P-39** · Matriz documental | **Ratificar las matrices de pasantía investigativa, Estado Joven y asesoría/asistencia técnica.** Las tres llevan `matrizPendienteDeRatificar: true` y el servicio de requisitos lo expone como `requiereRatificacion` al expediente; el documento institucional no las describe. | `domain/entities/modalidad.entity.ts:135, 270-281, 447-458, 461-472` · `domain/services/requisitos.domain-service.ts:36-37` · `test/proceso-sgp-catalogo.spec.ts` · `§17.5` último párrafo (1525-1527) | Confirmación del Área de Prácticas; ajustar matriz y `test/proceso-sgp-catalogo.spec.ts`. | Sí — Área de Prácticas | Media | 0,5 – 1 | Exigir documentos equivocados en tres modalidades. |
| **P-40** · Auditoría | **Detección de uso anómalo: evaluarla donde ocurre, auditar la descarga y avisar por correo.** `verificarUsoAnomalo` solo escribe un `warn` y tiene un **único** llamador, `GET /practicas` (listado), cuyo resultado booleano se descarta; `GET /practicas/:id`, `GET /documentos/:id/enlace` y `GET /documentos/descarga` no la invocan: quien recorra expedientes o descargue documentos directamente nunca dispara la alerta. Además el contador suma `expediente_consultado`, `documento_visualizado` y `documento_descargado`, pero `DOCUMENTO_DESCARGADO` **nunca se registra**: `GET documentos/descarga` es `@Publico()`, verifica la firma y sirve el archivo sin auditar (la auditoría ocurre solo al generar el enlace), pese a que DT §8.8 promete «cada visualización y descarga». | `infrastructure/modules/auditoria.service.ts:64-76` · `infrastructure/controllers/practicas.controller.ts:70` (único llamador) · `infrastructure/controllers/documentos.controller.ts:111-114, 141-166` · `application/use-cases/documentos/gestionar-documento.use-case.ts:227` · `infrastructure/adapters/persistence/postgres/repositorios.adapter.ts:370-379` · `domain/entities/auditoria.entity.ts:56` · `infrastructure/observability/metricas.service.ts:80` · `§8.8, §15` (M11) (852-854) | Registrar `DOCUMENTO_DESCARGADO` al servir (con la ruta como `entidadId`), mover la verificación a un interceptor o invocarla en los tres endpoints, evento notificable al administrador con plantilla (la métrica `sipra_accesos_fuera_de_alcance_total` ya existe), pruebas unitarias. | No | Media | 2 – 2,5 | La alerta no llega a nadie y no se dispara en los accesos que importan; la auditoría subestima las descargas. |
| **P-41** · Cargue desde celular | **Fotos de teléfono: HEIC, orientación EXIF y JPEG progresivo.** Firmas binarias solo PDF/JPEG/PNG; el `<input>` del expediente acepta solo esos tres MIME (y la pista dice «PDF sin contraseña» aunque admite imágenes); el adaptador de OpenAI rechaza HEIC/TIFF/BMP con «no hay conversión posible»; el decodificador local devuelve `null` ante JPEG progresivo (SOF2), por lo que no hay hash perceptual para esas fotos (planilla reutilizada sin detectar); «exif», «orientation» y «heic» no aparecen en `src`. | `domain/services/forense.domain-service.ts:9-13` · `apps/web/src/app/features/practicas/expediente.component.ts:210-211` · `infrastructure/adapters/ia/openai.adapter.ts:39-40, 210-214` · `infrastructure/adapters/imagen/decodificador.adapter.ts:185-193, 233-234` · `§15` (M3) (1282) | Conversión HEIC→JPEG (o rechazo claro en la captura guiada), rotación por EXIF, decodificación progresiva o conversión previa, pruebas con fotos reales de varios teléfonos. | No | Alta | 3 – 5 | Rechazos masivos de fotos de iPhone; planillas repetidas sin detectar. |
| **P-42** · Datos | **Migración de datos históricos del SGP actual (por confirmar).** Ni el documento ni el código mencionan carga inicial, datos históricos ni migración desde el SGP actual; la única referencia a la «plataforma actual» es la sección 17 (paridad funcional). La única carga existente son las semillas sintéticas. | `grep -ni 'históric'`, «carga inicial», «migración de datos», «SGP actual» en `docs/`, `README.md` → solo líneas 38, 765, 1413 (sección 17) · `apps/api/src` → 0 · `infrastructure/persistence/postgres/seeds/ejecutar-semillas.ts` | Definir si hay carga inicial (prácticas activas del periodo, usuarios, empresas), formato de exportación del SGP, guion de carga idempotente. P-46 depende de esta definición. | Sí — Área de Prácticas / dueño del SGP | Media (alta si hay corte de periodo) | 5 – 10 | Arranque en vacío a mitad de periodo. |
| **P-61** · Notificaciones | **Seis plantillas de notificación sin emisor.** De los dieciocho `EventoNotificable`, `DOCUMENTO_APROBADO`, `OBLIGACION_POR_VENCER`, `PRACTICA_ACTIVADA`, `EMPRESA_HABILITADA`, `INVITACION_EMPRESA` y `CERTIFICADO_EMITIDO` tienen plantilla pero cero usos fuera de `plantillas-notificacion.domain-service.ts` (los otros doce sí se emiten). DT §8.7 afirma que los ocho eventos originales se notifican. El más grave es `OBLIGACION_POR_VENCER`: el motor solo marca vencidas, nunca avisa antes. | `domain/services/plantillas-notificacion.domain-service.ts:14-45, 125-159` · `infrastructure/modules/tareas-programadas.service.ts:54-59` · `grep -rn 'EventoNotificable.<EVENTO>' apps/api/src` por evento · `§8.7` (830-832) | Emitir cada evento desde su caso de uso (aprobación de documento, activación de práctica, habilitación de empresa, aviso previo de vencimiento con ventana parametrizable); `INVITACION_EMPRESA` con P-35 y `CERTIFICADO_EMITIDO` con P-63; prueba que recorra el catálogo y falle ante una plantilla sin emisor. | No | Alta | 1 – 2 | El estudiante no recibe aviso antes de vencer una obligación ni confirmación de aprobación; el documento promete notificaciones que no salen. |
| **P-62** · Datos personales / Cumplimiento | **Autorización de tratamiento de datos sin flujo de aceptación.** La obligación `AUTORIZACION_TRATAMIENTO` se crea en cada práctica con `fechaLimite: ahora` y efecto `BLOQUEA_CARGUE`, pero ningún caso de uso la cumple (el único `cumplir()` del sistema es el de ARL), `BLOQUEA_CARGUE` no se aplica en ninguna parte de `application/` ni `infrastructure/`, `AccionAuditada.AUTORIZACION_TRATAMIENTO` no se usa y no hay pantalla ni endpoint de aceptación. Resultado: toda práctica muestra una obligación vencida que nadie puede cerrar y el consentimiento de la Ley 1581 **no se recoge en la plataforma**. Lo mismo ocurre con `REPORTE_PLAZA_PRACTICA` y `CERTIFICACION_PRACTICA`: se crean y nunca pasan a `cumplida`. | `domain/services/obligaciones.domain-service.ts:22, 36, 44` · `domain/entities/obligacion.entity.ts:62-68, 114-116` · `application/use-cases/practicas/gestionar-practica.use-case.ts:247` (único `cumplir()`) · `infrastructure/controllers/cumplimiento.controller.ts:22-47` (solo consultas) | Pantalla y endpoint de aceptación con el texto aprobado por Jurídica (P-10), registro auditado (`AUTORIZACION_TRATAMIENTO` con fecha y versión del texto), aplicar `BLOQUEA_CARGUE` en el cargue de documentos, cumplir `REPORTE_PLAZA_PRACTICA` al generar el reporte y `CERTIFICACION_PRACTICA` al emitir el certificado (P-63). | Sí — Jurídica (texto de la autorización) | Alta | 2 – 3 | Sin consentimiento registrado no se puede operar con datos reales; obligaciones «vencidas» permanentes que confunden al estudiante y al tutor. |
| **P-63** · Certificación | **El certificado de práctica no se emite.** El estado `certificada` se alcanza en el cierre sin generar documento alguno; no hay caso de uso, PDF ni código de verificación público, aunque la plantilla promete «Cualquier tercero puede verificar su autenticidad con el código» y DT §8.8 dice que cada emisión queda auditada. `AccionAuditada.CERTIFICADO_EMITIDO` y `EventoNotificable.CERTIFICADO_EMITIDO` no tienen uso. | `application/use-cases/practicas/bitacora.use-case.ts:265-298` · `domain/services/plantillas-notificacion.domain-service.ts:283-291` · `grep -rn CERTIFICADO_EMITIDO apps/api/src` → solo definiciones · `§8.8` (848-850) | Caso de uso de emisión (reutilizando `infrastructure/adapters/pdf/pdfkit.adapter.ts` y el patrón de `cartas_presentacion`), código de verificación y endpoint público de consulta, auditoría y notificación, cumplimiento de `CERTIFICACION_PRACTICA` (P-62). | No | Media | 2 – 4 | El estudiante termina sin certificado; la promesa de verificación por terceros es falsa. |
| **P-64** · Empresas | **El formulario público de solicitud de empresa no existe en la web.** `POST empresas/solicitudes` es `@Publico()` y DT §6.4 lo describe como «la única superficie expuesta sin autenticación», pero ningún componente de Angular lo invoca: `api.service.ts` solo consume `empresas/nit/verificar` y `grep -rn 'solicitudes' apps/web/src` no devuelve ninguna llamada de empresa; no hay ruta pública. Una empresa solo puede pedir su registro por Swagger o `curl`. | `infrastructure/controllers/empresas.controller.ts:24-45` · `apps/web/src/app/core/services/api.service.ts:252` · `apps/web/src/app/app.routes.ts` (sin ruta pública) · `§6.4` (431-443) | Ruta pública en el SPA con el formulario (NIT, razón social, contacto, campo trampa), llamadas a `empresas/nit/verificar` y `empresas/solicitudes`, mensajes de resultado; antibots y *rate limit* junto con P-35. | No | Alta | 1 – 2 | El canal de entrada de empresas descrito en el documento no existe para el usuario. |
| **P-65** · Validación (capa 3) | **Dos reglas de coherencia cruzada que no operan: NIT de empresa en `null` y jefe del FUR fuera del contexto.** (1) `C3_NIT_NO_CORRESPONDE_EMPRESA` figura como implementada en DT §7.10 y el adaptador la contiene, pero el pipeline pasa siempre `nitEmpresa: null` al contexto de la capa 3 aunque la práctica guarda `empresaNit`: el cruce NIT leído vs empresa registrada nunca se dispara. (2) El FUR guarda `jefeInmediatoNombre` y la extracción del acta devuelve `nombre_responsable`, `cargo_responsable` y `firmas_presentes`, pero el contexto solo recibe `nitEmpresa`, `fechaInicio` y `nombreEstudiante`: la comparación jefe-del-acta vs firmante sigue siendo manual (desglosado de P-37). | `application/use-cases/documentos/pipeline-validacion.use-case.ts:266-285` · `infrastructure/adapters/ia/extraccion.adapter.ts:336-340, 360-371, 387-397` · `domain/entities/practica.entity.ts:82-85, 108` · `domain/entities/campos-extraccion.ts:23-26` · `§7.10` (626-636) | Pasar `empresaNit` y `jefeInmediatoNombre` al contexto de la capa 3, añadir la regla jefe vs firmante, pruebas unitarias de ambas reglas. | No | Media | 1 – 1,5 | Un documento de otra empresa o firmado por otra persona pasa la capa 3 sin alerta. |
| **P-66** · Bolsa de empleo | **Ciclo de vida de la vacante incompleto.** `EstadoVacante.EN_VALIDACION` y `CERRADA` no los usa ningún caso de uso ni ruta (el grafo `borrador → en_validacion → publicada` de DT §4.4 no existe: se publica desde borrador); no hay endpoint para cerrar ni editar una vacante; la tarea `vencerVacantes` recorre `listarPendientesReporteSpe()`, que filtra `marco: 'laboral'`, así que las vacantes de marco `practica` nunca pasan a `vencida`; no hay pruebas de `GestionarVacanteUseCase` ni del vencimiento. | `infrastructure/modules/tareas-programadas.service.ts:88-100` · `infrastructure/adapters/persistence/postgres/repositorios.adapter.ts:330-336` · `domain/ports/out/repositorios.port.ts:128-134` · `EstadoVacante.EN_VALIDACION` y `EstadoVacante.CERRADA` en `application/` y `controllers/` → 0 · `§4.4` (329) | Transición de validación (Extensión) antes de publicar, endpoints de edición y cierre, consulta propia para el vencimiento sin filtro de marco, pruebas del caso de uso y de la tarea. Antes o junto con P-29. | No | Media | 1 – 2 | Vacantes de práctica que nunca vencen; publicación sin validación de Extensión. |

---

#### D) Calidad, pruebas y operación

| ID · Área | Título y descripción | Evidencia | Qué se necesita | Dep. externa | Prioridad | Días | Riesgo si no se hace |
|---|---|---|---|---|:--:|:--:|---|
| **P-43** · Web · pruebas | **Pruebas unitarias de Angular (hoy 0) y target `test`.** No existe ningún `*.spec.ts` bajo `apps/web`. El script `test` usa banderas de Karma (`ng test --watch=false --browsers=ChromeHeadless`), pero `angular.json` solo define `build` y `serve`, y en `package-lock.json` no hay `karma`, `jasmine-core` ni `vitest`: `npm test --workspace=@sipra/web` falla de inmediato. El `npm test` de la raíz delega solo en la API, y la CI y Cloud Build ejecutan ese mismo script. | `find apps/web -name '*.spec.ts'` = 0 · `apps/web/package.json:13` · `apps/web/angular.json` (targets `build`, `serve`) · `package.json:20` · `../.github/workflows/sipra-ci.yml:40-41` · `infra/gcp/cloudbuild.yaml:41-45` · `package-lock.json` (sin karma/jasmine/vitest) | Vitest o Karma con el builder de Angular 20, pruebas de `SesionService`, `sesionGuard`/`rolGuard`, `sesionInterceptor`, `CapturaGuiadaService`, expediente y registro; agregar el target a CI. | No | Alta | 4 – 6 | Regresiones de interfaz sin detección. |
| **P-44** · E2E | **Pruebas de extremo a extremo automatizadas.** No hay carpeta `e2e` ni referencia a Playwright o Cypress fuera de `node_modules`, ni paso E2E en `sipra-ci.yml` o `cloudbuild.yaml`; los recorridos de las bitácoras 0.12/0.13/0.16 fueron manuales. El job `migraciones` de la CI ya levanta `postgres:18-alpine` con migraciones, catálogos y semillas: un flujo Playwright puede colgarse de ese mismo job sin infraestructura nueva. | `§14` (1263), bitácoras (1969) · `../.github/workflows/sipra-ci.yml:63-102` · búsqueda de `e2e`, `playwright`, `cypress` → 0 | Playwright con PostgreSQL en CI: ingreso abierto, FUR, cargue → pipeline, decisión docente, solicitud de ARL, PQRS. | No | Alta | 5 – 8 | Regresiones de flujo. |
| **P-45** · API · pruebas | **Pruebas de integración de repositorios contra PostgreSQL.** Las 37 suites (583 pruebas) usan dobles: ningún archivo de `apps/api/test` importa `DataSource`, `typeorm`, `pg` ni Testcontainers; `aislamiento-empresas.spec.ts` solo importa el dominio. Cobertura de líneas: `infrastructure/persistence` 0 de 770 líneas (0 %), `adapters` 21,1 %, `controllers` 7,3 %, frente a `domain` 83,7 % y `application` 53,1 %. La CI verifica contra PostgreSQL real solo migraciones, catálogos, semillas, el rechazo del manifiesto alterado, la inmutabilidad de `auditoria` y el `CHECK` de ARL; el `condiciones()` del alcance por empresa nunca se ejecuta sobre SQL real. Prioridad subida a Alta por recomendación del verificador: el aislamiento entre empresas es «condición de despliegue» y hoy solo se prueba en memoria. | búsqueda de `DataSource`, `typeorm` y `testcontainers` en `apps/api/test` → 0 · `apps/api/test/aislamiento-empresas.spec.ts:1-4` · `../.github/workflows/sipra-ci.yml:95-152` · `apps/api/coverage/lcov.info` por capa · `§13.1` (1198-1222) | Suite de integración con Testcontainers o el servicio de CI: `condiciones()` del alcance, índices únicos, `CHECK`, `date[]`. | No | Alta | 3 – 5 | El aislamiento entre empresas no se prueba sobre SQL real. |
| **P-46** · Datos de prueba | **Procedimiento de anonimización para `qa` y `pre`.** DT §10.1 declara datos «Anonimizados» para esos ambientes, pero el único mecanismo existente son las semillas sintéticas; no hay guion, SQL ni documento («anonimiz», «enmascar», «seudonim» → solo la tabla de §10.1). Depende de P-42 (no está definido de dónde saldría la exportación a anonimizar). | `§10.1` (916-921) · `infrastructure/persistence/postgres/seeds/` (solo `catalogos.ts` y `ejecutar-semillas.ts`) | Guion de anonimización (hash de cédulas, nombres sintéticos, fechas desplazadas) desde una exportación, con aval jurídico. | Sí — Jurídica / fuente de datos | Media | 2 – 4 | `pre` no representa producción. |
| **P-47** · Caché | **Redis declarado sin uso y sin instancia en la nube: decidir si se retira.** Corrección: no está «aprovisionado». Ningún archivo de `src` importa `cache-manager`, `ioredis`, `redis` ni `CacheModule`; en Google Cloud **no existe ninguna instancia de Memorystore** (`aprovisionar-ambiente.sh` solo habilita la API `redis.googleapis.com`; ningún guion crea la instancia ni el conector VPC); el único Redis real es el contenedor local. El uso sugerido para las claves JWK de Google ya está resuelto en memoria con caché de una hora por instancia (`clavesCache`). Memorystore no es un tercero sino un recurso del propio proyecto. DT §14 también exagera («Provisto en la infraestructura»). | `infrastructure/config/configuracion.ts:51-53, 136` · `apps/api/package.json:48` · `infra/docker/docker-compose.yml:35-45` · `infra/gcp/aprovisionar-ambiente.sh:52` (única mención en `infra/gcp`) · `infrastructure/auth/oidc.service.ts:182-189` · `§14` (1253) | Decidir usos reales (parámetros, RUES) y entonces crear Memorystore con *VPC egress*, o retirar variables, contenedor y dependencia con justificación en §14 como desviación deliberada (opción más barata). | No | Baja | 2 – 3 | Costo y complejidad sin beneficio; documento que afirma lo que no existe. |
| **P-48** · Datos en reposo | **Cifrado de columnas sensibles con `pgcrypto`.** La única referencia es `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` y su único uso efectivo es `gen_random_uuid()` en dos claves primarias; no hay `pgp_sym_encrypt`, `createCipheriv` ni columnas cifradas en las diez migraciones (los usos de `crypto` en `src` son hashes y HMAC). Agrega peso que `documentos.extraccion` guarda la lectura completa de la IA con datos personales. | migración `1756000000000-EsquemaInicial.ts:15, 271, 286` · búsqueda de `pgp_sym`, `createCipheriv` y `encrypt(` en `apps/api/src` → 0 · `§14` (1256) | Definir columnas con P-10 (documento, teléfono, `extraccion`), cifrado en el adaptador o en columna, claves en Secret Manager/KMS. | No | Media | 3 – 5 | Desviación del estándar 6.3. |
| **P-49** · Documentación | **Pasada de coherencia al documento técnico y a las referencias muertas.** Verificado una a una: encabezado 0.15.2 / 5 de octubre con bitácora 0.16 del 9 de octubre; índice con «19. Bitácora» cuando §19 es OpenAI y §20 la bitácora (sin entrada 20); §7.10 salta a §7.12; §17.5 antes de §17.4; §10.2 «Frontend: Cloud Storage + CDN»; §2.3 Workspace «pendiente» vs §15 M10 ✔; §13 «373 pruebas en veintinueve suites» (tabla que omite 8 suites) y «175 pruebas» en §10.9 línea 1026 (real: 583/37); `infra/gcp/README.md` citado en `tareas-programadas.service.ts:15` y `.env.example:4` sin existir. Adiciones del verificador: bitácora desordenada (0.13 antes de 0.12); §14 cita 314 kB / 90 kB y la compilación da 327,87 kB / 93,16 kB; §14 línea 1271 es autocontradictoria («PostgreSQL 16 en local, 18 en docker-compose»); §14 afirma «usuario sin privilegios y HEALTHCHECK» (cierto solo en la API); `apps/web/Dockerfile:1` y `cloudbuild.yaml:127-138` publican el frontend a un bucket; `crear-aplicacion.ts:14` cita `infra/netlify` (no existe); §3.3, §4.1 y la fila M2 de §15 citan `homologacion_experiencia` (renombrada a `validacion_experiencia`) y `etiquetas.pipe.ts:77` conserva la etiqueta muerta; `SINU_VENTANA_SINCRONIZACION_CRON` y `CORREO_DRIVER` duplicado en `.env.example`; DT §10.3-§10.4 describen un camino de despliegue que no es el real (ver P-04); y el backlog inicial fechaba el commit `4fff78f` el 13 de octubre cuando `git log` lo registra el 9. | `docs/DOCUMENTO-TECNICO.md:8-12, 20-42, 138, 227, 295-300, 626-637, 930, 939-971, 1026, 1166-1196, 1241, 1249, 1271, 1282, 1516-1528, 1655, 1826-1828, 2292, 2320` · `infrastructure/modules/tareas-programadas.service.ts:15` · `.env.example:4, 73, 76, 108` · `apps/web/Dockerfile:1, 19-25` · `infra/gcp/cloudbuild.yaml:127-138` · `apps/api/src/crear-aplicacion.ts:14, 74` · `apps/web/src/app/shared/pipes/etiquetas.pipe.ts:77` · `git log --date=iso -1` → 2026-10-09 | Actualizar encabezado, índice, numeración, cifras y bitácora; corregir §2.3, §10.2-§10.4, §14 y §15; retirar referencias muertas en código y `.env.example`; crear la sección de operación (P-50) en el mismo documento. | No | Alta (entrega) | 1 – 2 | El siguiente ingeniero se guía por datos obsoletos o sigue un camino de despliegue que falla. |
| **P-50** · Operación | **Runbooks de operación y procedimiento de *rollback*.** Lo único escrito es README («`bash infra/gcp/desplegar.sh` desde Cloud Shell»), DT §10.3, §10.4 y §12. No existe procedimiento para rotación de `JWT_SECRETO`/contraseña de BD (la rotación de la llave de OpenAI es apenas un mensaje en `desplegar.sh:59-67`), tope de IA alcanzado, incidente de fuga, purga fallida, reproceso de un documento ni restauración (P-14). Agravantes: la única ruta de despliegue que funciona es manual; no hay comando de *rollback* (`update-traffic`, revisiones → 0 en los tres caminos); `desplegar.sh` no ejecuta lint ni pruebas antes de desplegar. Prioridad subida a Alta por el verificador. | `README.md:43-44` · `§10.3-§10.4, §10.9, §12` (937-971, 1012-1028, 1123-1145) · `infra/gcp/desplegar.sh` (280 líneas; sin `rollback`, `traffic`, `revisi`, `npm test`) · `infra/gcp/desplegar.sh:59-67` | Sección de operación en el documento técnico con comandos exactos y responsables: despliegue y *rollback* por revisión, rotación de secretos, tope de IA, fuga, purga fallida, reproceso, restauración. | No | Alta | 1 – 2 | Operación dependiente de una persona; sin vuelta atrás ante un despliegue malo. |
| **P-51** · Seguridad | **`npm audit`, actualización de dependencias y *pentest*.** `npm audit --omit=dev` del 13 de octubre de 2026 reporta **16 vulnerabilidades en dependencias de producción (7 altas, 9 moderadas, 0 críticas)**, con severidad alta en `fastify`, `@nestjs/platform-fastify`, `@fastify/static`, `@grpc/grpc-js`, `@angular/router`, `brace-expansion` y `fast-uri`. No existe `.github/dependabot.yml` ni `renovate.json`; la CI solo escanea patrones de credenciales y archivos `.env`; ningún script, workflow ni `cloudbuild.yaml` invoca `audit`. | `npm audit --omit=dev --json` (13-oct-2026): total 16, high 7, moderate 9 · `../.github/workflows/sipra-ci.yml:154-177` · `../.github/` (solo dos workflows) · `package-lock.json` | `npm audit --omit=dev` en CI, Dependabot, corrección de las 7 altas (sumar 1–2 días si exige actualización mayor de Fastify), pentest externo sobre formulario público, descarga de documentos y *worker*. | Sí — proveedor de pentest | Alta | 1 – 3 | Vulnerabilidades conocidas en producción sin aviso. |
| **P-52** · Base de datos | **Versión de PostgreSQL: tres versiones distintas (18 local/CI, 17 en `dev`, 16 en el guion oficial).** Corrección: no son dos. `docker-compose` y la CI usan `postgres:18-alpine`; `aprovisionar-ambiente.sh` crea Cloud SQL con `POSTGRES_16`; `arranque-unico.sh` (el que realmente creó `dev`) lo crea con `POSTGRES_17`. El único ambiente vivo corre 17, el guion «oficial» crearía 16 y las pruebas se hacen sobre 18. DT §14 lo describe al revés. Prioridad subida a Media. | `infra/docker/docker-compose.yml:7` · `../.github/workflows/sipra-ci.yml:68` · `infra/gcp/aprovisionar-ambiente.sh:63` · `infra/gcp/arranque-unico.sh:78` · `§14` (1271), `§10.9` (1014, 1035) | Decisión de Tecnología y alineación de `docker-compose`, `sipra-ci.yml` y los dos guiones con la versión de Cloud SQL (junto con P-04). | Sí — Tecnología | Media | 0,5 | Diferencias sutiles (`date[]`, colación) no cubiertas por CI; `qa`/`pre`/`prod` en una versión distinta de `dev`. |
| **P-53** · Costos de IA | **Mantenimiento de la tabla de tarifas y retiros de modelos.** Retiros registrados: `gpt-4.1-nano` 2026-10-23; `gpt-5`, `gpt-5-mini`, `gpt-5-nano` 2026-12-11; `gpt-5.4-nano` y `gpt-5.1` 2027-04-01. Precisión al riesgo: el arranque **no** rechaza un modelo retirado; solo rechaza un `OPENAI_MODELO` que no esté en la tabla (y al listar los conocidos excluye los que tienen `retiro`). Un modelo retirado que siga en la tabla pasa la validación y falla en tiempo de llamada (la lectura cae a revisión manual). No hay comparación de `retiro` con la fecha actual ni aviso previo. | `domain/entities/tarifas-ia.ts:141, 161, 169, 176, 183, 205` · `infrastructure/config/configuracion.ts:265-270` · `README.md:60-65` · `§19.5` | Revisión trimestral de precios y retiros; verificación `retiro < hoy` al arranque con aviso previo; prueba en `tarifas-ia.spec.ts` que falle cuando un modelo recomendado haya pasado su fecha. | No | Baja (recurrente) | 0,5 por revisión | Estimaciones y tope diario desfasados; lecturas que caen a revisión manual sin aviso cuando el modelo se retira. |
| **P-67** · Repositorio | **Resuelto el 14 de octubre de 2026: los flujos de GitHub Actions viven dentro del repositorio.** Hallazgo original: `sipra-ci.yml` y `sipra-desplegar.yml` estaban en `.github/workflows` de la raíz de `Productoacademico`, fuera de `sipra/`, y en ese repositorio quedó registrado un workflow huérfano (`sipra-sonda-puente.yml`, 3 ejecuciones el 9 de septiembre de 2026, ya borrado del código). Resolución: en este repositorio son `.github/workflows/ci.yml` y `.github/workflows/desplegar.yml`, se ejecutan desde la raíz y sin filtros `paths`. | `ls .github/workflows` → `ci.yml`, `desplegar.yml` | El workflow huérfano sigue registrado en GitHub para el repositorio original; se borra solo desde allí (o deja de importar si se retira `sipra/` de ese repositorio). | No | Resuelto | 0 | Ninguno. |
| **P-68** · Gobierno del repositorio | **Sin protección de rama en `main` y sin forma de activarla en el plan actual.** `GET /repos/.../branches/main/protection` responde 403 «Upgrade to GitHub Pro or make this repository public»: repositorio privado en plan gratuito, sin reglas de PR obligatorio, revisión ni checks requeridos. `sipra-ci.yml:2-3` declara «todo cambio entra por Pull Request con revisión» y DT §14 afirma «CI en cada Pull Request», pero nada lo impone; `sipra-desplegar.yml` dispara el despliegue en cualquier `push`. No hay `CODEOWNERS` ni plantilla de PR. | GitHub API `branches/main/protection` → 403 · `../.github/workflows/sipra-ci.yml:2-3` · `../.github/workflows/sipra-desplegar.yml:14-15` · `../.github/` (solo los dos workflows) · `§14` (1262) | Decisión de Tecnología (plan GitHub Team u organización institucional, o repositorio propio), reglas de protección con checks requeridos (`sipra-ci`), `CODEOWNERS` y plantilla de PR. | Sí — Tecnología (plan GitHub / organización) | Alta | 0,5 (técnico) | «`main` siempre desplegable» no está garantizado; cualquier push despliega. |
| **P-69** · API · pruebas | **Cobertura sin umbral y guards/OIDC sin ninguna prueba.** `jest --coverage` de hoy: 42,0 % sentencias, 34,3 % ramas, 43,0 % líneas; por capa `domain` 83,7 %, `application` 53,1 %, `infrastructure` 15,8 % (`controllers` 7,3 %, `auth` 6,7 %, `persistence` 0 %, `adapters` 21,1 %, `dtos` 7,8 %). La configuración de Jest no define `coverageThreshold` y ni la CI ni Cloud Build ejecutan `test:cov`. `jwt-auth.guard.ts`, `roles.guard.ts`, `permiso-escritura.guard.ts` y `oidc.service.ts` no tienen ninguna prueba (ningún `*.spec.ts` los referencia), pese a ser la autorización del sistema. | `apps/api/package.json:82-107` (Jest sin `coverageThreshold`) · `apps/api/coverage/lcov.info` agregada por capa · `apps/api/test/*.spec.ts` (sin referencia a los guards ni a `oidc.service`) · `../.github/workflows/sipra-ci.yml` y `infra/gcp/cloudbuild.yaml` (sin `test:cov`) | Umbral por capa en Jest y `test:cov` en CI; pruebas de los tres guards y de `OidcService` con tokens firmados (incluida la comprobación de `nonce`/`state` que P-01 debe hacer obligatoria). | No | Alta | 3 – 4 | La autorización del sistema puede romperse sin que ninguna prueba lo detecte. |
| **P-70** · Cola de trabajo · pruebas | **El adaptador de Cloud Tasks y el *worker* no tienen pruebas unitarias.** Ningún archivo de `apps/api/test` menciona `CloudTasks`, `ColaPort` ni `encolar`, pese a que `ColaCloudTasksAdapter` es obligatorio en `pre`/`prod` y `POST /trabajos/procesar` es la entrada del *worker*. P-45 cubre repositorios y P-05 la puesta en marcha real; este ítem cubre la cobertura unitaria. | `infrastructure/adapters/cola/cola.adapter.ts:118-185` · `infrastructure/controllers/trabajos.controller.ts:36` · `infrastructure/config/configuracion.ts:237-242` · `apps/api/test/*.ts` (sin `CloudTasks`, `ColaPort`, `encolar`) | Pruebas del adaptador (nombres de cola, `oidcToken`, `dispatchDeadline`, cuerpo de la tarea) con el cliente de Cloud Tasks doblado, y del *worker* ante reintentos y duplicados (idempotencia de P-05). | No | Alta | 1 – 2 | El componente obligatorio de producción es el único sin pruebas; una regresión se descubre en `pre`. |
| **P-71** · Observabilidad / seguridad | **`/api/v1/metrics` es público.** `salud.controller.ts` marca el endpoint con `@Publico()` y lo oculta de Swagger; con `--allow-unauthenticated` cualquiera en Internet lee `sipra_ia_costo_usd_total`, `sipra_documentos_*`, `sipra_accesos_fuera_de_alcance_total` y el tráfico por ruta. DT §11 no lo menciona. | `infrastructure/controllers/salud.controller.ts:39-47` · `infra/gcp/desplegar.sh:219` · `../.github/workflows/sipra-desplegar.yml:86` · `§11` | Token de *scraping*, restricción por IP o ingreso interno; con Managed Prometheus (P-15) la recolección puede hacerse desde la propia red. | No | Media | 0,5 | Métricas de negocio y de costo expuestas a terceros. |
| **P-72** · Operación | **La sonda de salud responde 200 con la base caída y reporta siempre la versión `0.1.0`.** `salud.controller.ts` devuelve HTTP 200 con `estado: 'degradado'` cuando `SELECT 1` falla; el `HEALTHCHECK` de la imagen (`r.ok`), las comprobaciones finales de `desplegar.sh` y del workflow solo miran el código 200, así que ninguna detecta una pérdida de conectividad con Cloud SQL. `@nestjs/terminus` está declarado pero no se importa en ningún archivo. `version` lee `npm_package_version`, que no existe al arrancar con `node dist/main.js`. | `infrastructure/controllers/salud.controller.ts:23-36` · `apps/api/Dockerfile:42-45` · `infra/gcp/desplegar.sh:261-262` · `../.github/workflows/sipra-desplegar.yml:128-131` · `apps/api/package.json:46` | 503 en `degradado`, usar Terminus o retirar la dependencia, versión inyectada en la imagen por `--build-arg` (ver P-74). | No | Media | 0,5 | Un despliegue sin base se da por bueno; no se sabe qué versión corre. |
| **P-73** · Seguridad | **La firma de descarga viaja en la URL, queda en los registros y reutiliza `JWT_SECRETO`.** `almacenamiento.adapter.ts` construye `/api/v1/documentos/descarga?ruta=…&expira=…&firma=…`; `app.module.ts:157` solo redacta `authorization` y `cookie`, y `pino-http` registra `req.url` completo: cada enlace firmado (válido mientras no venza) termina en Cloud Logging junto con la ruta del documento. La clave del HMAC reutiliza `JWT_SECRETO`, lo que acopla la rotación de sesiones con la validez de los enlaces. | `infrastructure/adapters/storage/almacenamiento.adapter.ts:14-19, 39` · `infrastructure/modules/app.module.ts:157` | Redactar `req.url`/`req.query.firma` en el logger (o pasar la firma por cabecera) y derivar una clave propia para los enlaces. | No | Media | 0,5 – 1 | Quien lea los logs descarga documentos de estudiantes; rotar el JWT invalida todos los enlaces. |
| **P-74** · Versionado | **No hay versionado del producto ni correlación entre imagen desplegada y documento.** No existen etiquetas de git (`git tag` vacío); `package.json`, `apps/api/package.json` y `apps/web/package.json` declaran `0.1.0`; Swagger fija `setVersion('0.1.0')`; el documento técnico va por 0.15.2/0.16 y las imágenes se etiquetan solo con `SHORT_SHA`/`GITHUB_SHA`. Quien reciba el proyecto no puede saber qué versión del documento corresponde a lo que está en `dev`. | `git tag` → vacío · `package.json:3` · `apps/api/package.json` · `apps/web/package.json` · `apps/api/src/crear-aplicacion.ts:74` · `infra/gcp/cloudbuild.yaml` (`SHORT_SHA`) · `../.github/workflows/sipra-desplegar.yml` (`GITHUB_SHA`) | Etiquetas semver desde la bitácora, `version` propagada a `/salud` y a Swagger por `--build-arg`, etiqueta de imagen = versión + SHA. | No | Media | 0,5 | Imposible correlacionar incidentes, documento y despliegue. |
| **P-75** · Contenedores | **La imagen del frontend corre como root y sin `HEALTHCHECK`.** `apps/web/Dockerfile` usa `nginx:alpine` sin crear usuario ni `USER` y no define `HEALTHCHECK`, al contrario que la API; DT §14 afirma «usuario sin privilegios y HEALTHCHECK» para Docker en general. | `apps/web/Dockerfile:19-25` · `apps/api/Dockerfile:30-43` · `§14` (1241) | `nginx-unprivileged` o usuario propio, `HEALTHCHECK` sobre `/index.html`, corregir §14. | No | Baja | 0,5 | Desviación del estándar y del propio documento. |
| **P-76** · Calidad estática | **`apps/api/herramientas/` queda fuera del lint y de la verificación de tipos.** El script `lint` cubre `{src,test}/**/*.ts` y `tsconfig.json` solo incluye `src` y `test`; `herramientas/evaluar-lectura.ts` (el arnés `ia:evaluar`, pieza clave de P-17 y P-25) solo se compila al ejecutarse con `ts-node`, así que `npm run lint` y `npm run build` pasan aunque esté roto. | `apps/api/package.json:19` · `apps/api/tsconfig.json:28` · `apps/api/herramientas/evaluar-lectura.ts` | Incluir `herramientas` en `lint` y en un `tsconfig` de verificación (`tsc --noEmit`). | No | Baja | 0,25 | El arnés de calibración se rompe sin aviso justo cuando se necesite (P-17). |
| **P-77** · Pruebas | **Suites que dependen de la fecha real del sistema.** 9 de las 37 suites usan `new Date()` y solo 1 fija el reloj (`useFakeTimers`/`setSystemTime`); la salida de hoy genera, por ejemplo, `860013779_VACANTES_20261013.txt` con la fecha corriente en `reportes-spe`. Riesgo de pruebas intermitentes en cambios de periodo, mes o año (ventanas del cronograma, plazos de cargue, vencimientos). | `apps/api/test/*.spec.ts` (9 con `new Date()`, 1 con `setSystemTime`) · salida de `npm test` del 13 de octubre de 2026 | Reloj inyectable o `jest.useFakeTimers` en esas suites. | No | Baja | 1 | Suite roja en un cambio de año o cierre de periodo sin cambio de código. |
| **P-78** · Observabilidad local | **Grafana sin tableros aprovisionados e imágenes `latest` sin versión fija.** `docker-compose.yml` define `grafana` bajo el perfil `observabilidad`, pero `infra/docker/` solo contiene `alertas.yml`, `docker-compose.yml` y `prometheus.yml`: no hay `provisioning/` de fuentes de datos ni JSON de dashboards, así que las ocho métricas de negocio de §11.2 no tienen visualización lista (P-15 cubre alertas, P-57 la vista en la aplicación). Además `prom/prometheus:latest` y `grafana/grafana:latest` no fijan versión, frente a `postgres:18-alpine` y `redis:7-alpine`. | `infra/docker/docker-compose.yml:48, 56-64` · `ls infra/docker` · `§11.2` (1104-1120) | Datasource Prometheus y un dashboard versionado con las métricas `sipra_*`; fijar versiones de ambas imágenes. | No | Baja | 0,5 | El tablero local arranca vacío; el entorno de observabilidad puede dejar de funcionar sin cambio en el repositorio. |

---

#### E) Mejoras y evoluciones

| ID · Área | Título y descripción | Evidencia | Qué se necesita | Dep. externa | Prioridad | Días | Riesgo si no se hace |
|---|---|---|---|---|:--:|:--:|---|
| **P-54** · Notificaciones | **WhatsApp como canal adicional.** WhatsApp aparece una sola vez en todo el repositorio (fila M10 de §15); no existe adaptador, plantilla ni configuración. `NotificacionPort` es el punto de extensión correcto (dos adaptadores: consola y Workspace). Prerrequisito de datos que faltaba: la tabla `usuarios` **no tiene columna de teléfono** (solo `empresas.telefono` y `practicas.jefe_inmediato_telefono`); cualquier canal distinto del correo institucional exige capturar el celular en el FUR con consentimiento explícito registrado (P-10, P-62). | `§15` (M10) (1291, única mención) · `domain/ports/out/servicios-externos.port.ts:146` · `infrastructure/adapters/externos/externos.adapter.ts:133` · `workspace.adapter.ts:27` · migración `1756000000000-EsquemaInicial.ts:79` · migración `1756000006000-FormularioUnicoRegistro.ts:26` | Columna de celular en `usuarios` y captura en el FUR con consentimiento; cuenta de WhatsApp Business/Meta, plantillas aprobadas, adaptador sobre `NotificacionPort`. | Sí — Meta Business | Baja | 4 – 6 | Ninguno operativo; menor alcance al estudiante. |
| **P-55** · Administración / Operación | **Conectar los cuatro parámetros declarados sin lector e implementar el plazo del plan de mejoramiento.** Corrección: «ya es un parámetro, no exige despliegue, 0 días» es falso. De los 13 parámetros operativos, **4 se declaran, se pueden cambiar con motivo y quedan en auditoría, pero nadie los lee**: `documentos.similitud_maxima` (el pipeline usa la constante `UMBRAL_SIMILITUD = 16`), `documentos.tamano_maximo_mb` (se usa la variable `DOC_TAMANO_MAXIMO_MB` fijada al arrancar como límite de multipart), `auditoria.consultas_por_hora` (constante `UMBRAL_CONSULTAS_POR_HORA = 40`) y `plan_mejoramiento.dias_plazo` (ninguna lógica calcula un plazo del plan de mejoramiento: en `domain/services` la palabra solo aparece en la tabla de páginas del estimador de costos y en `gestionar-documento.use-case.ts:243-250` solo se restringe quién lo aprueba). Las 11 lecturas reales están en `pipeline-validacion:384, 399`, `gestionar-documento:289`, `costos-ia:105, 137`, `bitacora:317`, `gestionar-practica:354-356`, `registrar-practica:97`, `solicitud-arl:379-380`. Cambiar 14 → 28 desde Swagger hoy queda auditado y **no produce ningún efecto**. | `domain/entities/parametro.entity.ts:102-113, 140-146, 179-184` · `domain/services/hash-perceptual.domain-service.ts:22, 112-114` · `application/use-cases/documentos/pipeline-validacion.use-case.ts:630` · `infrastructure/config/configuracion.ts:74` · `infrastructure/controllers/documentos.controller.ts:78` · `apps/api/src/crear-aplicacion.ts:35` · `domain/entities/auditoria.entity.ts:56` · `infrastructure/modules/auditoria.service.ts:68` · `domain/services/costos-ia.domain-service.ts:35, 45` · `test/parametros-caso-uso.spec.ts:100-113` · `§15.1` (1328-1333), bitácora 0.8 (2206-2210) | Conectar cada clave a su consumidor (el tamaño máximo leído por petición, dejando el límite de Fastify como techo); definir con el Área de Prácticas el hito de referencia del plan de mejoramiento, crear la obligación o fecha límite y leer `plan_mejoramiento.dias_plazo`; prueba que recorra `CATALOGO_PARAMETROS` y falle ante una clave operativa sin lector; después, la decisión de la Dirección (14 → 28) con motivo desde P-30. | Sí — Dirección / Área de Prácticas (hito y ventana) | Media | 2 – 4 | Un cambio auditado que no surte efecto mina la confianza en M12; la ventana del plan de mejoramiento no se controla. |
| **P-56** · Código | **Retirar los restos del «ambiente puente».** Inventario exacto: el modo `en_linea` en la validación de configuración y en el adaptador de cola (`enLinea`, `drenar()` síncrono, campo `ejecutadoEnLinea` del puerto); el comentario de `crear-aplicacion.ts:12-15` que remite a `infra/netlify`, **carpeta que no existe** (`infra/` solo contiene `docker/` y `gcp/`); el comentario «contenedor sin servidor» del transporte de pino; las líneas de `.env.example`; la entrada «Netlify (ambiente puente)» de `.gitignore`; las bitácoras 0.4–0.6. Conservar el `export sembrar()` (lo usa `migrar.ts`). Ninguna prueba referencia `en_linea`: retirarlo no rompe la suite. | `infrastructure/config/configuracion.ts:76-81` · `infrastructure/adapters/cola/cola.adapter.ts:30-37, 48-53` · `domain/ports/out/servicios-externos.port.ts:176` · `apps/api/src/crear-aplicacion.ts:12-15` · `infrastructure/modules/app.module.ts:148-152` · `infrastructure/persistence/postgres/seeds/ejecutar-semillas.ts:383-384` · `apps/api/src/migrar.ts:40` · `.env.example:86-88` · `.gitignore:19-20` · `DT` bitácoras 0.4–0.6 (2059-2149) | Eliminar el modo y sus ramas, el comentario de `infra/netlify`, actualizar `.env.example`, `.gitignore` y el documento. | No | Baja | 0,5 – 1 | Complejidad, una opción de configuración confusa y una referencia a una carpeta que el siguiente ingeniero buscará sin encontrarla. |
| **P-57** · Dirección | **Tablero de indicadores dentro de la aplicación.** Dentro de la aplicación solo hay dos vistas con cifras: el tablero de obligaciones (`TableroCumplimiento`) y «Costos de IA». La tasa de auto-aprobación («indicador clave» según §11.2) solo se incrementa como contador de Prometheus en el procesador de trabajos; ningún endpoint ni componente la expone, y no hay series por periodo o escuela. Incluso el tablero local de Grafana arranca vacío (P-78). | `infra/docker/prometheus.yml` · `infra/docker/docker-compose.yml:45-64` · `application/use-cases/obligaciones/tablero-cumplimiento.use-case.ts:26-30` · `infrastructure/controllers/costos-ia.controller.ts:77` · `application/use-cases/documentos/procesar-trabajo.use-case.ts:70-71` · `apps/web/src/app/features/costos/costos-ia.component.ts` · `apps/web/src/app/features/inicio/inicio.component.ts:184, 235` · `§11.2` (1104-1120) | Vista para Dirección con series por periodo y escuela a partir de `auditoria` y `documentos`, incluida la tasa de auto-aprobación. | No | Baja | 3 – 5 | Decisiones sin datos en la propia herramienta. |
| **P-58** · Accesibilidad | **Auditoría formal WCAG 2.1 AA.** §18.4 declara botones de 44 px, foco visible de 3 px, error en texto y `prefers-reduced-motion`, y el código lo respalda (`:focus-visible` con `outline: 3px`, medios de movimiento reducido, `lang="es-CO"`, 41 atributos `aria-*`/`role`). Pero no hay ninguna verificación: ni axe, Lighthouse o pa11y en `package.json`/`angular.json`, ni paso de accesibilidad en `sipra-ci.yml`, ni enlace «saltar al contenido»; las bitácoras 0.14/0.15 registran solo «lint, compilación y recorrido con capturas». | `§18.4` (1598-1605), bitácoras 0.14/0.15 (1903-1927) · `apps/web/src/estilos.css:126-128, 288-309` · `apps/web/src/index.html:2` · `apps/web/package.json`, `apps/web/angular.json` (sin axe/lighthouse) · `../.github/workflows/sipra-ci.yml` (sin paso de accesibilidad) | Lighthouse/axe en CI, enlace «saltar al contenido», revisión con lector de pantalla, corrección de hallazgos (no estimable hasta correrla). | No | Baja | 1 – 2 | Barreras para estudiantes con discapacidad. |

---

### 15.5 Ruta sugerida

1. **Semana 0 — entrega limpia** (antes de cualquier otra cosa): P-59 y P-67 quedaron resueltos el 14 de octubre de 2026 con el repositorio independiente y `ci.yml` ya corre en verde en `main` (ejecuciones 38628704343 y 38629565838); restan P-49 y P-74.
2. **Semana 1 — destrabar gestiones** (no cuestan código): P-02, P-07, P-08, P-09, P-10 (incluye el texto de la autorización que necesita P-62), P-11, P-12, P-18 (método de acceso), P-24, P-68 (plan de GitHub). Iniciarlas en paralelo porque sus plazos son institucionales.
3. **Semanas 1–2 — coherencia de infraestructura**: P-04 (guion canónico, nombres, `cloudbuild.yaml` arrancable, P-52 de paso) → P-06 → P-05 + P-70 → P-03 → P-02 (aprovisionar `qa`). Sin esto ningún ambiente nuevo arranca igual que `dev`.
4. **Semanas 2–3 — identidad y exposición**: P-60 (alta de estudiantes) **antes** de P-01 → P-13 (incluye cabeceras y sesión) → P-71, P-72, P-73 → P-15 → P-14 → P-69.
5. **Semanas 3–5 — piloto en `qa`**: P-46, P-17, P-25, P-41, P-16; funcionalidad que el piloto expone de inmediato: P-62, P-61, P-64, P-65; abrir P-30 + P-55 para que la Dirección mueva umbrales sin Swagger y los cambios surtan efecto.
6. **Después del piloto**: integraciones (P-18 a P-23), bolsa (P-66, P-29 tras P-12), certificado (P-63), pruebas (P-43, P-44, P-45) y el resto por prioridad.

### 15.6 Ruta crítica que no depende del desarrollo

Tres gestiones tienen plazos propios y deben estar en curso:

1. **Modificación de la autorización ante la Unidad del SPE.** Bloquea la bolsa
   de empleo. Responsables: Extensión y Jurídica.
2. **Validación jurídica de tratamiento de datos y transferencia internacional.**
   Requiere semanas. Responsable: Jurídica.
3. **Definición del método de acceso a SINU.** Determina el diseño de la
   sincronización. Responsable: Tecnología.

Iniciar el desarrollo sin estas tres gestiones en curso significa terminar la
aplicación y no poder encenderla.


### 15.7 Supuestos de la estimación

- Un ingeniero sénior con el repositorio ya corriendo en local (`npm run infra:up`, migraciones, semillas) y acceso al proyecto `dev` de GCP.
- Las estimaciones no incluyen esperas de terceros (convenios, proyectos de GCP, decisiones de la Dirección) ni la revisión jurídica.
- Los ítems con «Sí» en dependencia externa pueden empezar por la parte técnica (puerto, adaptador con simulador) y cerrarse cuando llegue el insumo.
- Los ítems P-59 a P-78 y las estimaciones recalculadas usan la cifra del verificador; cuando dio una sola cifra se toma como mínimo y máximo. Los totales por grupo suman los mínimos y los máximos de cada ítem, redondeados al entero; el total general se redondea desde la suma exacta (168,25 – 277,75 días), por lo que puede diferir en uno o dos días de la suma de las filas.
- P-42 está marcado «por confirmar»: si la Dirección decide arrancar en vacío al inicio de un periodo, se descarta (y P-46 cambia de fuente).

---

## 16. Decisiones tomadas y su justificación

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Repositorio propio `ironfuentes-netizen/sipra-practicas` (desde el 14 de octubre de 2026) | Seguir como carpeta `sipra/` del repositorio de *Producto Académico* | Son dos productos sin nada en común (código, datos, despliegue); compartir repositorio mezclaba historiales, obligaba a filtros de rutas en la CI y arriesgaba publicar `sipra/**` en Netlify. La decisión inicial de montarlo como subcarpeta fue un error de arranque que se corrigió conservando el historial completo |
| Compuerta ARL en el dominio **y** como `CHECK` | Solo en la aplicación | Una regla que la institución no puede permitirse omitir no debe depender de que la aplicación esté bien escrita |
| Auditoría inmutable por disparador **y** por permisos | Solo por convención | Ante una inspección, «no la modificamos» vale menos que «no se puede modificar» |
| `AUTH_MODO` decidido por el servidor | Bandera del cliente | El cliente no debe poder elegir cómo se autentica |
| Modo abierto prohibido en `pre` y `prod` por validación de arranque | Confiar en el despliegue | El descuido es la vía más probable de que el modo de pruebas llegue a producción |
| Regla de dependencia impuesta por el linter | Documentarla y confiar | Una arquitectura que no se verifica se erosiona en el primer sprint con prisa |
| Extracción simulada como driver por defecto | Exigir la clave de API desde el día uno | El equipo puede construir y probar sin depender del habilitante T4 de la semana 1 |
| Adaptadores `async` aunque hoy resuelvan síncronamente | Firmas síncronas | Sustituir el simulado por el real no cambia una línea del caso de uso |
| Prueba de aislamiento como paso bloqueante de Cloud Build | Prueba informativa | Una fuga entre empresas es un incidente de protección de datos, no un defecto |
| Sin IA generativa para reconstruir documentos ilegibles | Super-resolución | Sobre un documento con valor probatorio, generar píxeles es fabricar evidencia |
| Catálogos parciales declarados como tales | Completar los códigos de memoria | Un catálogo que se ve completo y está mal produce reportes que se radican y quedan en firme |
| El estado del catálogo bloquea el reporte en `pre` y `prod` | Advertir y dejar pasar | Corregir un archivo ya radicado ante la entidad cuesta más que no emitirlo |
| Dos colas separadas en vez de una con prioridades | Una cola con campo de prioridad | Cloud Tasks no ordena por prioridad dentro de una cola: sería una prioridad de mentira |
| Hash perceptual de 128 bits con guarda de entropía | dHash de 64 bits | Con 64 bits una planilla rayada degenera en ceros; sin la guarda, dos hojas en blanco se acusan entre sí |
| El hash criptográfico se calcula antes de sanear | Sanear y luego hashear | El valor probatorio es del documento recibido, no de la copia que guardamos |
| Marcar el borrador dentro del propio archivo | Marcarlo solo en la interfaz | Si se radica por error, la marca tiene que viajar con el archivo |
| ZXing para decodificar el PDF417 | Decodificador propio | Un decodificador sin validar contra cédulas reales es una fuente de datos falsos con apariencia de certeza |
| La comparación de titular devuelve `null`, no `false` | Comparar igual con las posiciones supuestas | Acusar a un estudiante de presentar la cédula de otro, con nombres leídos de posiciones inventadas, es peor que no comprobar nada |
| Preprocesar y reintentar antes de devolver | Devolver al primer intento fallido | Cada devolución cuesta un ciclo del estudiante; el recurso determinístico es gratis |
| Plantillas de correo en el dominio | Plantillas en el adaptador | Lo que lee un estudiante es una decisión de producto, no de infraestructura |
| Los documentos sintéticos llevan NUIP válido | Números ficticios cualesquiera | Un dato de prueba que no supera las propias validaciones enseña al equipo a ignorar las banderas |

---

### 16.1 Por qué NestJS y Angular, y no Python con React

La especificación consolidada de septiembre propone en su sección 8 «frontend
React/TypeScript, API y worker Python en Cloud Run». Está enunciada como
**propuesta técnica**, no como mandato, y se decide no adoptarla. Tres razones,
en orden de peso:

1. **El estándar institucional ya eligió.** El manual *Estándares, Arquitectura
   y Stack Tecnológico* de la Fábrica de Software CUN v2.0 fija NestJS con
   Fastify y Angular. Un proyecto que se aparta del estándar obliga a la
   institución a mantener dos ecosistemas, dos cadenas de dependencias y dos
   conjuntos de personas que sepan operarlos.
2. **Lo construido funciona y está comprobado.** Reescribir en otro lenguaje no
   traslada las 583 pruebas ni las garantías que sostienen: la compuerta de ARL
   en el motor de base de datos, la auditoría inmutable, el aislamiento entre
   empresas. Se volverían a escribir, y algunas se perderían por el camino.
3. **Nada de lo que la especificación exige depende del lenguaje.** OpenAI se
   consume por HTTP; Cloud Run ejecuta contenedores; Cloud Tasks y Cloud SQL son
   agnósticos. Lo que la propuesta pedía se cumple igual.

Lo que sí se adopta de esa sección es todo lo demás: Cloud Run, Cloud SQL,
almacenamiento privado, colas, Secret Manager, cuatro ambientes y OpenAI como
proveedor de extracción documental.

**Perfiles.** La especificación pide exactamente cuatro. Se conservan los seis
vigentes: coordinador de escuela y Dirección de Extensión no son variantes
administrativas sino alcances distintos —Extensión opera la bolsa de empleo y
los reportes al Servicio Público de Empleo, y el coordinador ve su escuela y no
la institución entera—. Fundirlos en un superadministrador obligaría a repartir
ese alcance con permisos sueltos, que es precisamente lo que la matriz de roles
evita.

---

## 17. Proceso base del SGP: paridad con la plataforma actual

La versión 0.12 implementa, paso a paso, el proceso que hoy corre en el
Sistema de Gestión de Prácticas (SGP) y en el portal de gestión de ARL, tal
como lo describen los cuatro manuales institucionales (estudiante, docente
facilitador, coordinación y portal de ARL). Es la **base** sobre la que se
harán las mejoras: primero se reproduce lo que existe, con sus reglas exactas,
y sobre eso se decide qué cambiar.

### 17.1 Correspondencia con el SGP

| SGP / portal de ARL | SIPRA | Dónde vive la regla |
|---|---|---|
| Actores: administrador, coordinador y analista, auxiliar, docente, practicante | Roles `administrador`, `coordinador` (sin escuelas = Área de Prácticas), `auxiliar`, `tutor`, `estudiante`; permiso `consulta`/`escritura` | `rol.vo.ts`, `permiso-escritura.guard.ts` |
| Estados Inscrito · En práctica · Cerrado · Anulado · Reprueba | Equivalencia sobre los estados de SIPRA (`EQUIVALENCIA_SGP`); `anulada` y `reprobada` nuevos y finales | `practica.entity.ts` |
| Quince modalidades del selector | Matriz `MATRIZ_MODALIDADES` con `etiquetaSgp`, articulada o externa, documentos por momento, duración y condiciones | `modalidad.entity.ts` |
| Tres momentos documentales | `MomentoExpediente`; el avance se calcula sobre la matriz | `avance-documental.domain-service.ts` |
| Gestión de periodos: ventanas, sincronización, modalidades ofertadas | `PeriodoAcademico` con ventanas por tipo y cronograma; tres calendarios (presencial, virtual, 335) | `periodo.entity.ts`, `GestionarPeriodosUseCase` |
| Carta de presentación | Composición en el dominio, PDF con pdfkit, hash y reimpresión idéntica | `carta-presentacion.entity.ts`, `CartaPresentacionUseCase` |
| Formulario Único de Registro | `RegistrarPracticaUseCase` con todas las reglas del manual | `registrar-practica.use-case.ts` |
| Botón de edición (vacante) | `actualizarVacante`: nunca modalidad ni fechas | `practica.entity.ts` |
| Bitácora, tipos de mensaje, Evalúa tu proceso, calificación docente | `EntradaBitacora` (solo se agrega), `BitacoraUseCase`, cierre automático | `bitacora.entity.ts`, `cierre.domain-service.ts` |
| Plazo de ocho días para subsanar | Anotación automática al devolver un documento y correo al estudiante | `documentos.dias_subsanacion` |
| Portal de ARL: solicitud, validación, decisión, certificado, consolidado | `SolicitudArl`, `ValidacionArlDomainService`, `SolicitudArlUseCase`, tarea diaria | `solicitud-arl.entity.ts` |
| Gestión de usuarios | `GestionarUsuariosUseCase` (eliminar = inhabilitar) | `gestionar-usuarios.use-case.ts` |
| Vistas y sincronizador prácticas–docente | `VistasSinuUseCase`; SINU solo se lee | `vistas-sinu.use-case.ts` |
| Reportes de prácticas, bitácoras y cartas | `ReportesSgpUseCase` con las columnas del manual; Excel con exceljs | `reportes-sgp.use-case.ts` |
| Preguntas y respuestas de Desarrollo Profesional; tickets de soporte | Centro de ayuda (`PREGUNTAS_FRECUENTES`, 123 entradas) y PQRS con radicado, unificación y respuesta en el radicado inicial | `preguntas-frecuentes.ts`, `pqrs.entity.ts`, `PqrsUseCase` |

### 17.2 Reglas que el código hace cumplir

- **Un registro vigente por estudiante y periodo.** Índice único parcial
  `ux_practicas_registro_por_periodo` que excluye las anuladas: anular es la
  forma de habilitar un registro nuevo, como en el SGP.
- **Modalidad y fechas inmutables.** No existe método de dominio que las cambie
  después de registrar. Las fechas caen dentro del periodo (salvo el contrato
  de aprendizaje) y nunca en sábado ni domingo.
- **Ventanas del periodo.** El estudiante registra y genera la carta solo en su
  ventana; coordinación puede registrar en periodos cerrados solo si el
  parámetro `registro.coordinacion_periodos_cerrados` lo permite.
- **Cierre por concurrencia de tres condiciones.** 100 % de documentos
  aprobados, «Evalúa tu proceso» respondido y calificación registrada. Se
  comprueba cada vez que una condición cambia; no hay botón que lo fuerce. La
  base exige nota y fecha de cierre en toda práctica cerrada o reprobada.
- **Calificación de 0,0 a 5,0 con un decimal; aprueba desde 3,0.** Solo con el
  100 % aprobado y solo por el docente asignado o coordinación. Es una regla
  institucional: no es parámetro.
- **La bitácora no se corrige.** El rol de aplicación solo tiene `SELECT` e
  `INSERT` sobre `bitacora_entradas`. «Evalúa tu proceso» es único por práctica
  por índice.
- **Solicitud de ARL.** Solo modalidades cubiertas por la CUN (articuladas; la
  pasantía del tercer sector según convenio), con cinco días hábiles de
  anticipación (`arl.dias_habiles_anticipacion`), EPS de máximo treinta días
  (`arl.dias_vigencia_eps`), RUT y Cámara del año en curso, soportes tomados
  del expediente. Lo que exige ojo humano queda como *revisión manual*; la
  recomendación no decide.
- **El certificado de ARL no se vuelve a cargar.** Al remitirlo queda aprobado
  en el expediente, la compuerta se verifica antes de guardar y la práctica
  registra la afiliación.
- **El alcance acota la consulta.** Bandeja, bitácora, solicitudes de ARL y
  reportes aplican el alcance del actor en el servidor.
- **Cronograma del proceso (0.13).** Al crear un periodo, el límite para
  registrar y solicitar la ARL es dos meses después del inicio, la inducción
  cae en la segunda semana y la fecha de cargue de documentos dos semanas antes
  del cierre; coordinación puede ajustar cada fecha dentro del periodo. El
  estudiante no radica la solicitud de ARL fuera de la ventana `solicitud_arl`.
- **Plazo de cargue del estudiante (0.13).** Cerrada la fecha de cargue y
  pasados ocho días calendario desde el fin de la práctica, el cargue se
  cierra; una devolución del docente reabre el plazo de subsanación.
- **Matriz documental oficial (0.13).** La pasantía dura de uno a tres meses
  (la extensión la pide la empresa y la registra coordinación, con marca en la
  auditoría); el segundo contrato de aprendizaje exige subir de nivel en la
  cadena de formación y nunca hay un tercero por registro del estudiante; los
  semilleros entregan artículo científico o reporte de semilleros; la pasantía
  internacional sustituye EPS y ARL por el correo de aprobación y el seguro
  médico internacional.
- **PQRS (0.13).** Solo el estudiante radica; un segundo requerimiento abierto
  en la misma categoría se unifica con el radicado inicial, sin nuevo correo;
  responden coordinación, auxiliares y administración; la respuesta se puede
  complementar hasta el cierre; cada estudiante solo ve las suyas.

### 17.3 Ruta del estudiante en la interfaz

1. **Registrar mi práctica**: carta de presentación (paso 1) y Formulario Único
   de Registro (paso 2), con la matriz documental de la modalidad elegida.
2. **Solicitud de ARL** (solo modalidades cubiertas por la CUN): radicar con
   los soportes ya cargados; seguimiento del estado y de los motivos.
3. **Gestionar la práctica**: documentos por momento con porcentajes cargado y
   aprobado, bitácora con el docente, condiciones de cierre, datos de la
   práctica y edición de la vacante.
4. **Cronograma del periodo** en Inicio, en el registro y en la solicitud de
   ARL: inicio, jornadas de inducción, último día para registrar y solicitar la
   ARL (con los días que faltan), fecha de cargue y cierre.
5. **Centro de ayuda**: las 123 preguntas de Desarrollo Profesional por
   categoría, con búsqueda y enlaces contextuales desde las pantallas.
6. **PQRS**: radicar, ver el radicado y la respuesta, cerrar conforme; al
   radicar se sugieren las preguntas de la ayuda que podrían resolver el caso.

Coordinación, docente y auxiliar usan las mismas pantallas con las acciones que
les corresponden, más gestión de prácticas con los filtros del manual, portal
de ARL, gestión de usuarios y de periodos (con el cronograma editable), vistas
SINU, reportes y la bandeja de PQRS.

### 17.5 Recursos institucionales incorporados en 0.13

| Recurso | Qué aportó | Dónde quedó |
|---|---|---|
| *Periodos académicos y cronograma del proceso de prácticas* | Tres calendarios (presencial 2026A–D, virtual 26V01–06, 335 26P01–06); dos meses desde el inicio para registrar y solicitar la ARL; dos jornadas de inducción en la segunda semana; fecha de cargue de documentos antes del cierre | `PeriodoAcademico.ventanasHabituales`, `cronograma()`, semillas con nueve periodos, tarjeta de cronograma en la interfaz |
| *PQRS Desarrollo Profesional* (123 preguntas) | Catálogo de ayuda en dieciséis categorías con las rutas del SGP traducidas a SIPRA; reglas de trámite (unificación de tickets, nota a SINU en 10–15 días hábiles, ocho días para cargar pendientes, máximo dos contratos de aprendizaje, extensión de pasantía) | `preguntas-frecuentes.ts`, `pqrs.entity.ts`, `PqrsUseCase`, reglas en `RegistrarPracticaUseCase` y `GestionarDocumentoUseCase` |
| *Documentación a cargar para cada tipo de práctica* | Lista oficial de documentos por modalidad y sus criterios de revisión (firma digital del jefe, membrete, fechas que coinciden, 15 % de IA en el plan, etc.); pasantía de uno a tres meses; pasantía internacional ratificada | `MATRIZ_MODALIDADES`, `criterios-documentales.ts`, cuatro tipos documentales nuevos |

Quedan por ratificar con el Área de Prácticas las matrices de pasantía
investigativa, Estado Joven y asesoría y asistencia técnica, que el documento
no describe.

### 17.4 Lo que se difiere a la fase de mejoras

- Acta de inicio digital con campos y validación automática del jefe frente a
  la firma (§9.3 del manual del portal): hoy revisión manual.
- Consulta a ADRES o RUAF para la EPS y firmas digitales certificadas.
- Carga de la nota en C-Digital y sincronización real con SINU (depende del
  método de acceso, sección 15.2).
- Notificación dentro de la plataforma además del correo.

---

## 18. Sistema de diseño SIPRA

La versión 0.14 aplica a la interfaz el **paquete de diseño oscuro SIPRA v1.0**
aprobado por la institución (fondo carbón, verde esmeralda y objetos
ilustrados; sin fotografías ni personas). El paquete es la fuente del diseño;
aquí se documenta cómo se trasladó al código.

### 18.1 Identidad

- Nombre **SIPRA** con el descriptor **Prácticas y empleo CUN**. La sigla no
  se explica en la interfaz; el nombre completo del sistema queda en la
  descripción del documento HTML y en la pantalla de ingreso.
- Símbolo de conexión en SVG (`assets/marca/`), incrustado con `currentColor`
  en el panel lateral y en el ingreso para que tome el verde del tema. Favicon
  e iconos de aplicación (192 y 512 px) del paquete; `manifest.webmanifest`
  con nombre, colores e iconos.
- El logo institucional de la CUN no se reproduce: el paquete lo deja como
  descriptor en texto.

### 18.2 Tokens

Los tokens del paquete (`SIPRA-Tokens.json`) se exponen en `estilos.css` con
los nombres estables que ya usaban los componentes, así ningún componente
cambió para adoptar el diseño:

| Paquete | Token de la aplicación | Oscuro (aprobado) | Claro (derivado) |
|---|---|---|---|
| fondo | `--bg` | `#0B0F14` | `#F2F6F4` |
| superficie | `--superficie` | `#18232B` | `#FFFFFF` |
| elevada | `--superficie-2` | `#203039` | `#E7EFEB` |
| borde | `--borde` | `#415A63` | `#C7D5CF` |
| texto / secundario | `--texto` / `--texto-tenue` | `#F5F7F6` / `#B6C5BE` | `#0B0F14` / `#4B625C` |
| verde (acciones) | `--marca`, `--ok` | `#32D69B` | `#0A6E5A` / `#0A7A58` |
| bosque | `--acento`, degradado `--hero` | `#0A6E5A` | `#32D69B` |
| aviso / error / info | `--aviso` / `--peligro` / `--info` | `#F6C76B` / `#FF8E98` / `#72C8FF` | `#8A5B00` / `#B42836` / `#0B5E9E` |
| radios control / tarjeta / hero | `--r-sm` / `--r-md` / `--r-lg` | 12 / 18 / 20 px | igual |
| espaciado | `--sp-1…7` | 4, 8, 12, 16, 24, 32, 48 | igual |

El tema oscuro es el predeterminado porque es el diseño aprobado; el
conmutador del encabezado alterna con un tema claro que conserva la misma
paleta con el verde bosque como color de acción (contraste AA sobre blanco).
La preferencia se guarda en el navegador.

### 18.3 Tipografía, iconos e ilustraciones

- **DejaVu Sans** (incluida y licenciada en el paquete) como `SipraSans`, en
  regular y negrita, recortada a Latín con `fonttools` y servida como WOFF2
  (unos 30 KB por peso) desde `assets/fuentes/`, con la licencia al lado y
  respaldo `system-ui, Segoe UI, Arial`. Cuerpo 16/24, etiquetas 14/20,
  sección 24/32 y título 40/48 en el ingreso; el texto funcional no baja de
  14 px.
- El **sprite de 24 iconos** del paquete (retícula 24, trazo 1.8,
  `currentColor`) se incrusta en el shell y reemplaza los iconos propios del
  menú; cada entrada usa el icono del paquete que corresponde a su función.
- Las **ilustraciones** (objetos geométricos en verde, SVG escalable) van en
  el ingreso y en los estados vacíos de inicio, prácticas, ayuda, PQRS y
  solicitud de ARL, siempre con el mensaje en texto y una acción para
  continuar (ficha 12).

### 18.4 Componentes y accesibilidad

Botones de 44 px mínimos con radio 12 (primario relleno esmeralda, secundario
con borde, deshabilitado en gris de borde); campos con etiqueta visible,
fondo carbón y error en texto además del color; estados como pastilla con
punto, color y texto (ficha 11); foco visible de 3 px; `prefers-reduced-motion`
respetado. Las reglas del proceso no cambian con el diseño: los estados
visuales reflejan lo que decide el dominio.

### 18.5 Movimiento y respuesta (0.15)

El diseño estático se completó con una capa de movimiento corta (150 a 300 ms)
que responde a lo que la persona hace, nunca decorativa, y que se apaga por
completo con `prefers-reduced-motion`:

- **Avisos flotantes.** `AvisosService` (`core/ui`) y el anfitrión
  `sipra-avisos` en el shell reemplazan las franjas fijas de éxito y error de
  todas las pantallas: entran por abajo, se leen con `aria-live`, llevan una
  barra de tiempo y se cierran solos (5 s el éxito, 9 s el error) o con el
  botón. Un aviso idéntico al anterior no se repite. El ingreso, que vive
  fuera del shell, conserva su aviso en línea.
- **Esqueletos de carga.** `sipra-esqueleto` (filas, tarjetas, cifras o
  bloque) ocupa el lugar del contenido en inicio, prácticas, expediente,
  ayuda, bolsa, empresas, cumplimiento, auditoría y reportes, para que la
  pantalla no salte al llegar los datos.
- **Entrada escalonada.** Tarjetas, avisos y vacíos aparecen con un fundido y
  un desplazamiento de 10 px; dentro de un contenedor `.escalonado` (cifras,
  listas, cronograma, categorías de ayuda, radicados) lo hacen en cascada de
  40 ms.
- **Transiciones entre vistas.** Sobre las View Transitions del enrutador, el
  contenido nuevo sube y aparece mientras el anterior se desvanece; el panel
  lateral, la barra superior, la barra inferior y la cinta de pruebas tienen
  nombre de transición propio y no se mueven.
- **Cambio de tema.** El botón, ahora con icono de sol o luna, revela el tema
  nuevo con un círculo que crece desde el punto donde se hizo clic
  (`startViewTransition`); sin soporte o con movimiento reducido, cambia en
  seco.
- **Tacto.** Los botones se elevan al pasar y se comprimen al presionar; el
  primario proyecta un halo del verde de acción; filas de bandeja y tabla se
  iluminan y se desplazan 2 px; las barras de porcentaje del expediente crecen
  desde cero y animan sus cambios.
- **Pestañas del expediente.** Indicador que crece desde el centro y panel que
  entra con fundido al cambiar.
- **Formularios.** El botón primario muestra un indicador giratorio mientras
  guarda (`.boton.cargando`, con `pointer-events` apagados); la PQRS valida
  asunto y descripción mientras se escribe, con el error en texto y en el
  borde y el contador de caracteres.

### 18.6 Lo que no entra al repositorio

Las 17 fichas (PNG y SVG), el catálogo HTML del paquete y las tipografías TTF
completas quedan en el paquete de diseño que custodia la institución; el
repositorio lleva solo lo que la aplicación sirve. Cualquier cambio de marca
se hace sobre el paquete y se vuelve a trasladar aquí, versionado.

---

## 19. Lectura documental asistida con OpenAI y costos

La capa 2 del pipeline (sección 4) lee cada documento cargado con un modelo
de OpenAI y devuelve **lo que el documento dice**, si **cumple los criterios
del manual** y si es **legible**. No decide: la decisión sigue siendo del
puntaje de la capa 5 y, cuando este no alcanza, de una persona. Un documento
nunca se rechaza solo.

### 19.1 Arquitectura

| Pieza | Dónde | Qué hace |
|---|---|---|
| `campos-extraccion.ts` | dominio | Campos a leer por tipo documental y su semántica (qué es «fecha de expedición» frente a «fecha de afiliación», cómo se escribe un NIT, qué cuenta como firma). |
| `ConocimientoDocumentalDomainService` | dominio | Construye la instrucción institucional por tipo a partir de `CRITERIOS_DOCUMENTALES` (manual del docente facilitador y del portal de ARL): origen, vigencia, firmas, criterios, causales de devolución, reglas generales de cargue y el catálogo completo de tipos. |
| `ExtraccionOpenAiAdapter` | infraestructura | Llama a `POST /v1/responses` con el PDF o la imagen en base64, exige salida `json_schema` estricta (campos y criterios solo de la lista permitida, `tipo_detectado` solo del catálogo), reintenta una vez los fallos transitorios (429 de ritmo, 5xx, tiempo agotado) y valora cada lectura con la tarifa vigente a partir del `usage` real. |
| `tarifas-ia.ts` | dominio | Tabla de tarifas verificada el 9 de octubre de 2026, reglas de tokens por imagen (parches de 32 px o mosaicos de 512 px según familia) y fórmula de costo con caché. |
| `CostosIaDomainService` | dominio | Estimación por estudiante: matriz documental de cada modalidad × páginas típicas × tokens por página × tarifa. |
| `CostosIaUseCase` + `CostosIaController` | aplicación / infraestructura | `GET /costos-ia/{configuracion,tarifas,estimacion,comparativa,resumen}` para administración y coordinación. |
| `ia.tope_diario_usd` | parámetro operativo (M12) | Tope de gasto por día (hora de Colombia). Alcanzado, los documentos nuevos van a revisión humana sin lectura automática. Cero lo desactiva. En el ambiente abierto (ingreso sin contraseña) nunca supera el techo `IA_TOPE_DIARIO_USD` del despliegue: allí cualquiera puede tomar el perfil administrador, y el techo solo lo cambia quien despliega. |
| `ia.lecturas_por_practica_dia` | parámetro operativo (M12) | Lecturas automáticas por práctica y día (40 de fábrica). Frena cargues en bucle; lo que pase del límite entra igual y lo revisa una persona. |

`IA_DRIVER` elige el adaptador: `simulado` (sin llave; lee la capa de texto de
los PDF, incluidos los flujos comprimidos), `openai` o `anthropic`. Cambiar de
proveedor es cambiar una variable: el dominio no sabe cuál está detrás.

### 19.2 El «entrenamiento»: base de conocimiento, no afinamiento

No se afina (fine-tuning) ningún modelo. Afinar exigiría documentos reales de
estudiantes —prohibido por la regla de datos sintéticos— y ningún proveedor
garantiza que un modelo afinado lea mejor un certificado colombiano que uno
instruido con precisión. El entrenamiento consiste en:

1. **Instrucción por tipo documental**, generada desde los mismos datos del
   dominio que alimentan la lista de chequeo del revisor. Si el manual cambia,
   cambia una sola vez. Incluye: prohibiciones absolutas (no juzgar
   autenticidad, no inferir caracteres, no completar con conocimiento externo),
   convenciones de lectura de documentos colombianos (fechas, NIT con dígito de
   verificación, cédulas, firmas válidas), ficha del tipo esperado, reglas
   generales de cargue, campos con su significado, criterios a responder con
   código estable (`CRIT_n`, `NOACEPTA_n`, `FIRMAS`, `VIGENCIA`,
   `ANO_EN_CURSO`) y catálogo de tipos para `tipo_detectado`.
2. **Esquema de salida estricto**: el modelo no puede inventar nombres de
   campo, códigos de criterio ni tipos.
3. **Arnés de evaluación** (`npm run ia:evaluar`): corpus sintético de
   documentos buenos, de tipo equivocado (planilla PILA por certificado de
   ARL, consulta del Sisbén por certificado de EPS), vencidos e ilegibles, con
   los valores esperados conocidos. Mide exactitud por campo, detección de
   tipo, ilegibilidad, criterios en «no», tokens, costo y tiempo. Con el
   driver simulado comprueba el arnés (26/26 campos, 10/10 tipos); con
   `--driver=openai` mide al modelo y entrega los `usage` reales con los que
   se recalibra el estimador.

### 19.3 Tres resultados y revisión manual

| Lo que pasa | Bandera | Severidad | Resultado |
|---|---|---|---|
| Lectura limpia, criterios en «sí», tipo correcto | — | — | Puntaje ≥ umbral verde → `auto_aprobado` |
| Documento de otro tipo | `C2_TIPO_INCORRECTO` | alta | `en_revision` |
| Un criterio del manual en «no» | `C2_CRITERIO_<código>` | alta | `en_revision` |
| Criterios no determinables con el documento | `C2_CRITERIOS_NO_DETERMINABLES` | informativa | No pesa; se anota para el revisor |
| Tipo sin campos de extracción (informes, entregables, formatos de cierre) | `C2_REVISION_HUMANA_OBLIGATORIA` | alta | `en_revision`; la lectura solo orienta |
| El proveedor falla, rehúsa, se corta o la llave no sirve | `C2_EXTRACCION_NO_DISPONIBLE` | alta | `en_revision` (antes era media y el documento podía aprobarse solo: corregido) |
| Tope diario alcanzado | `C2_TOPE_DIARIO_ALCANZADO` | alta | `en_revision` sin gastar |
| Límite de lecturas de la práctica alcanzado | `C2_LIMITE_LECTURAS_PRACTICA` | alta | `en_revision` sin gastar |
| Nada leído y tipo sin detectar | `C2_SIN_LECTURA_AUTOMATICA` | alta | `en_revision` |
| Borroso, oscuro, recortado, en blanco | — | — | `ilegible`: se pide nuevo cargue con el motivo detectado; el docente también puede decidir |

En el expediente, `en_revision` e `ilegible` se muestran como **«Revisión
manual requerida»**, y los roles internos ven la **lectura asistida**
(resumen, tipo detectado, criterios respondidos, campos con confianza, tokens
y costo). El estudiante no recibe nada de eso: solo el mensaje comprensible de
cada bandera.

### 19.4 Trazabilidad del gasto

Cada lectura se guarda en `documentos.extraccion` con `modelo`, `proveedor`,
`tokensEntrada`, `tokensSalida`, `tokensCache`, `tokensRazonamiento`,
`costoUsd` (tarifa vigente al leer; no se recalcula), `leidoEn`, `intentos`
(2 cuando hubo segunda lectura sobre la copia preprocesada: ambas se suman) y
`gastoPrevioUsd` (lo gastado por lecturas anteriores del mismo documento si
el pipeline se vuelve a ejecutar; nada se pierde del acumulado). Una respuesta
inservible del proveedor (incompleta, rehusada, inválida) se guarda como
lectura `fallida` con sus tokens y costo. Un modelo fuera de la tabla no vale
cero: se valora con una tarifa de respaldo conservadora y queda marcado
`tarifaDesconocida` (y la validación de entorno rechaza arrancar con un
`OPENAI_MODELO` sin tarifa). Al purgar el archivo por retención, la lectura se
reduce a lo que sostiene los costos (modelo, tokens, costo, fecha): campos,
evidencias, resumen y detalles se van con el documento. De ahí
salen el tope diario, la métrica `sipra_ia_costo_usd_total{modelo}` y la
página **Costos de IA** (gasto por periodo, modelo, tipo, modalidad y
estudiante; la coordinación de una escuela solo ve a sus estudiantes, y la
página no muestra cédulas). El diagnóstico de administración comprueba la
llave, el modelo y los parámetros con una petición mínima real (unos veinte
tokens), y el guion de despliegue lo informa.

### 19.5 Costos

Tarifas Standard de OpenAI, USD por millón de tokens, verificadas el
9 de octubre de 2026 en la página oficial de precios (lote y Flex: −50 %):

| Modelo | Entrada | En caché | Salida | Estado |
|---|---|---|---|---|
| **gpt-6-luna** (predeterminado) | 0,10 | 0,01 | 0,50 | Vigente; el más económico del catálogo |
| gpt-5.6-luna | 0,20 | 0,02 | 1,20 | Vigente; regla de imagen publicada |
| gpt-5.4-mini | 0,75 | 0,075 | 4,50 | Vigente |
| gpt-4.1-mini | 0,40 | 0,10 | 1,60 | Vigente, sin razonamiento |
| gpt-5.6-terra | 2,00 | 0,20 | 12,00 | Escalamiento para casos dudosos |
| gpt-6.1-sol | 2,00 | 0,10 | 10,00 | Escalamiento |
| gpt-5-mini / gpt-5-nano / gpt-5 | 0,25 / 0,05 / 1,25 | | 2 / 0,4 / 10 | Se apagan el 11 de diciembre de 2026 |
| gpt-4.1-nano | 0,10 | 0,025 | 0,40 | Se apaga el 23 de octubre de 2026 |

Supuestos del estimador (todos ajustables en la página y por consulta):
página carta escaneada a 200 ppp (1700 × 2200 px) en `detail: high`
(≈ 2 890 tokens de imagen por página en la familia GPT‑6/5.6: reducción
proporcional al tope de 2 500 parches × 1,2), 500 tokens de capa de texto por
página, instrucción de ≈ 2 000 tokens por tipo más ≈ 500 del esquema JSON y
40 del mensaje, 400 tokens de respuesta más 300 de razonamiento con esfuerzo
bajo, y factor de reenvíos 1,25 (documentos devueltos, ilegibles o
reintentados tras preproceso). OpenAI no publica el multiplicador de imagen
de gpt‑6‑luna: se asume el de su familia hasta calibrarlo con el `usage` de
las primeras lecturas.

Costo estimado **por estudiante** con gpt‑6‑luna (una práctica completa,
todos los documentos de la matriz, con reenvíos):

| Modalidad | Documentos | Páginas | USD | COP (TRM 4 000) |
|---|---|---|---|---|
| Pasantía, combinación de funciones, práctica social, Estado Joven, asesoría | 6 | 14 | 0,0105 | ≈ 42 |
| Pasantía internacional | 6 | 15 | 0,011 | ≈ 43 |
| Contrato de aprendizaje, práctica técnica en investigación | 6 | 16 | 0,011 | ≈ 45 |
| Validación de experiencia laboral | 6 | 17 | 0,012 | ≈ 47 |
| Práctica investigativa / pasantía investigativa | 6 | 20 | 0,013 | ≈ 52 |
| Monitoría (tres informes largos) | 6 | 32 | 0,018 | ≈ 72 |
| CUNbre naciente | 13 | 24 | 0,020 | ≈ 78 |
| CUNbre consolidado | 14 | 28 | 0,022 | ≈ 88 |
| **Promedio** | | | **0,013** | **≈ 52** |
| **Por 1 000 estudiantes** | | | **≈ 13,1** | **≈ 52 000** |

Comparativa (promedio por estudiante, mismos supuestos): gpt‑6‑luna 0,013 ·
gpt‑5.6‑luna 0,027 · gpt‑4.1‑mini 0,067 · gpt‑5.4‑mini 0,103 · gpt‑6.1‑sol
0,261 · gpt‑5.6‑terra 0,274 · gpt‑6‑astra 1,307 USD. gpt‑5‑nano saldría más
barato (0,010) pero se apaga el 11 de diciembre de 2026: la comparativa
ordena primero los modelos sin retiro anunciado y deja al final los que no se
recomiendan. El tope diario de fábrica (50 USD) cubre unas 3 800 lecturas
diarias con gpt‑6‑luna.

### 19.6 Activación

```bash
# 1. Guardar la llave en Secret Manager (nunca en el repositorio):
printf '%s' 'sk-…' | gcloud secrets create sipra-dev-openai --replication-policy=automatic --data-file=-
# 2. Desplegar con el driver activo:
IA_DRIVER=openai bash infra/gcp/desplegar.sh            # OPENAI_MODELO y OPENAI_ESFUERZO opcionales
# 3. Comprobar: el guion imprime «lectura asistida: Llave válida; modelo gpt-6-luna disponible».
```

`validarEntorno` rechaza `IA_DRIVER=openai` sin `OPENAI_API_KEY`, con un
`OPENAI_MODELO` vacío o sin tarifa registrada, y con `OPENAI_URL_BASE` que no
sea https (salvo localhost, para el simulador local). Variables:
`OPENAI_MODELO` (gpt‑6‑luna), `OPENAI_ESFUERZO` (`low`; `none` cuando la
calidad lo permita; si el modelo no admite el valor, el adaptador lo degrada
al vecino válido y lo avisa), `OPENAI_URL_BASE`, `OPENAI_TIEMPO_MAXIMO_MS`
(120 000), `OPENAI_MAX_TOKENS_SALIDA` (4 000), `IA_TOPE_DIARIO_USD` (techo
absoluto del tope en el ambiente abierto). El tope diario y el límite por
práctica se administran en Parámetros, sin desplegar. `desplegar.sh` valida
driver, esfuerzo y secreto antes de construir, rechaza el secreto con el
texto de ejemplo, y despliega la API con `--no-cpu-throttling`: con la cola
en proceso la lectura corre después de responder la petición y necesita CPU
asignada; en pre y prod la cola es Cloud Tasks. Cloud Build arranca con
`_IA_DRIVER=simulado` y usa el mismo nombre de secreto.

## 20. Guía de transferencia

Esta sección existe para que otro ingeniero tome el proyecto sin depender de
quien lo construyó. Dice qué se entrega, qué accesos pedir, cómo arrancar el
primer día, dónde vive cada cosa, cómo se hacen los cambios habituales y qué
decisiones siguen abiertas. El detalle de cada tema está en la sección que se
cita; aquí está el mapa.

### 20.1 Qué se entrega

| Pieza | Dónde | Estado |
|---|---|---|
| Código fuente completo (API, web, infraestructura, pruebas) | Repositorio privado `ironfuentes-netizen/sipra-practicas`, rama `main`, con el historial completo del desarrollo. Copia en el paquete de entrega: `02-codigo/sipra-fuente/` | Compila; lint sin advertencias; 583 pruebas en verde |
| Este documento técnico | `docs/DOCUMENTO-TECNICO.md` (también en Word y PDF dentro del paquete) | Al día con el código (versión 0.17.1) |
| Guía rápida y ambiente de pruebas | `README.md`; `01-documentacion/guia-ambiente-de-pruebas.html` | Al día |
| Reglas para trabajar con asistentes de código | `CLAUDE.md` | Al día |
| Especificación de la API | `01-documentacion/openapi-sipra.json` (72 rutas, 86 operaciones); en vivo en `/docs/dev-only/swagger` | Generada desde el código |
| Esquema de base de datos | `03-base-de-datos/esquema.sql` (DDL exacto), `diccionario-de-datos-generado.md`, `modelo-entidad-relacion.svg` (15 tablas operativas; los 7 catálogos `cat_*` se omiten del diagrama por legibilidad y están en el diccionario) | Generados desde las migraciones aplicadas |
| Datos sintéticos de prueba | `03-base-de-datos/datos-sinteticos-semilla.sql` y `apps/api/src/infrastructure/persistence/postgres/seeds/` | Ningún dato real |
| Capturas de pantalla de toda la interfaz | `01-documentacion/capturas-de-pantalla/` | 43 pantallas |
| Backlog detallado | Sección 15 de este documento y `04-pendientes/` del paquete | Verificado contra el código |
| Ambiente de pruebas en la nube | Proyecto `cun-it-fab-contenido-practicas`, servicios `sipra-api-dev` y `sipra-web-dev` en Cloud Run (us-central1), Cloud SQL `sipra-dev`, bucket `cun-it-fab-contenido-practicas-sipra-dev-docs` | Operando con ingreso abierto y lector simulado; OpenAI se activa con el secreto `sipra-dev-openai` |

No se entregan credenciales de ningún tipo: la llave de OpenAI, las
contraseñas de la base y el secreto JWT viven en Secret Manager del proyecto
de Google Cloud; el repositorio solo contiene la llave pública de ejemplo
`.env.example`.

### 20.2 Accesos que debe solicitar quien recibe

| Acceso | Para qué | A quién pedirlo |
|---|---|---|
| Escritura en el repositorio de GitHub `ironfuentes-netizen/sipra-practicas` | Continuar el desarrollo | Dueño del repositorio (`ironfuentes-netizen`) |
| Rol de editor (o los roles mínimos: Cloud Run Admin, Cloud SQL Admin, Secret Manager Admin, Storage Admin, Cloud Build Editor, Service Account User) en `cun-it-fab-contenido-practicas` | Desplegar, leer registros, rotar secretos | Administrador de Google Cloud de la CUN |
| Llave de OpenAI (o permiso para crearla en la organización de la CUN) | Lectura documental asistida; la llave actual vive en el secreto `sipra-dev-openai` | Quien administre la cuenta de OpenAI institucional |
| Contacto de Tecnología para SINU | Definir el método de acceso (API, vista de base o archivo) y sustituir el adaptador simulado | Dirección de Tecnología |
| Contacto de Extensión y Jurídica | Autorización del SPE, anexo técnico, tratamiento de datos y transferencia internacional | Dirección de Extensión; Jurídica |
| Archivos oficiales del DANE (CIIU, CNO, Divipola) | Completar los catálogos; sin ellos los reportes regulatorios quedan bloqueados en pre y prod | Área que custodie los archivos; descarga oficial del DANE |
| Cuenta de servicio de Google Workspace con delegación | Correo real (`CORREO_DRIVER=workspace`) y OIDC en pre y prod | Administrador de Workspace de la CUN |

### 20.3 El primer día: arrancar, probar, construir

Requisitos: Node 22, npm 10, Docker (o PostgreSQL 16+ local), Git.

```bash
git clone https://github.com/ironfuentes-netizen/sipra-practicas.git
cd sipra-practicas
cp .env.example .env            # ajustar JWT_SECRETO (32+ caracteres) y DB_*
npm install
npm run infra:up                # PostgreSQL y Redis por Docker (infra/docker)
npm run migration:run           # 10 migraciones, en orden
npm run seed                    # 11 usuarios, prácticas, empresas y periodos sintéticos
npm run dev                     # API en :3000, web en :4200
```

Después, antes de tocar nada, confirmar que la base de partida está sana:

```bash
npm run lint                    # 0 advertencias en API y web
npm test                        # 583 pruebas
npm run test:aislamiento        # condición de despliegue
npm run build                   # API (nest) y web (angular, con presupuestos)
npm run ia:evaluar              # arnés de lectura documental con el lector simulado
```

Recorrido mínimo en la interfaz (http://localhost:4200): entrar como
practicante (`laura.ramirez@estudiante.cun.edu.co`), cargar un PDF en el
expediente, cambiar a docente facilitador y ver el documento con sus banderas,
decidir; entrar como administración y abrir Costos de IA, Parámetros
(`/administracion/parametros` por API) y Auditoría.

Sin Docker: instalar PostgreSQL, crear usuario y base `sipra`, ajustar `.env`
y omitir `npm run infra:up` (Redis es opcional en local).

### 20.4 Mapa del código

**API (`apps/api/src`)**, arquitectura hexagonal estricta (sección 2):

| Carpeta | Qué contiene | Regla |
|---|---|---|
| `domain/entities` | Entidades con sus reglas (`Practica`, `Documento`, `Empresa`, `Periodo`, `Pqrs`, `SolicitudArl`, `Parametro`…), enums de estado, matriz de modalidades (`modalidad.entity.ts`), criterios documentales del manual, campos de extracción, tarifas de IA | No importa nada de NestJS, TypeORM, Google Cloud, Fastify ni pg: lo impide `eslint.config.mjs` |
| `domain/services` | Reglas que cruzan entidades: forense, hash perceptual, preprocesamiento, PDF417, requisitos por etapa, obligaciones, cierre, acompañamiento, antidiscriminación, plantillas de notificación, base de conocimiento documental, estimador de costos | Puro TypeScript; se prueba sin base ni red |
| `domain/ports/out` | Contratos hacia afuera: repositorios y servicios externos (almacenamiento, IA, coherencia, RUES, SINU, notificación, cola, PDF417, PDF, hojas de cálculo) | Cada símbolo `Symbol('…')` se inyecta en `app.module.ts` |
| `application/use-cases` | Casos de uso por módulo (prácticas, documentos, empresas, vacantes, obligaciones, reportes, administración, auth) y `dtos/` | Orquestan dominio y puertos; no saben de HTTP |
| `infrastructure/controllers` | Controladores HTTP (`/api/v1`): uno por recurso | Solo traducen HTTP ↔ casos de uso; `@Roles` decide quién entra |
| `infrastructure/auth` | Guardias JWT y de roles, permiso de escritura, OIDC | `AUTH_MODO` abierto u OIDC emiten el mismo token |
| `infrastructure/adapters` | Implementaciones de los puertos: PostgreSQL (TypeORM), almacenamiento local/GCS, IA (simulado, OpenAI, Anthropic), externos (RUES/SINU simulados, correo consola/Workspace), cola (en proceso, en línea, Cloud Tasks), PDF417, pdfkit, exceljs | Cambiar de proveedor es cambiar una línea en `app.module.ts` |
| `infrastructure/persistence/postgres` | Entidades ORM (`todas.orm-entity.ts`), migraciones, semillas, ingestor de catálogos, `data-source.ts` | `synchronize` prohibido: todo cambio de esquema es una migración |
| `infrastructure/config` | `configuracion.ts`: variables de entorno validadas y reglas por ambiente | Rechaza el arranque ante combinaciones peligrosas |
| `infrastructure/observability` | Métricas Prometheus e interceptor | `/api/v1/metrics` |
| `infrastructure/modules` | `app.module.ts` (cableado), auditoría, notificaciones, tareas programadas | — |
| `herramientas/` | `evaluar-lectura.ts`, arnés de evaluación de la lectura documental | `npm run ia:evaluar` |
| `test/` | 37 suites de jest sobre dominio, aplicación y adaptadores con dobles | `npm test` |

**Web (`apps/web/src/app`)**, Angular 20 standalone con signals y `OnPush`:

| Carpeta | Qué contiene |
|---|---|
| `features/` | Una carpeta por pantalla: ingreso, inicio, registro (FUR), practicas (lista y expediente), arl, bolsa, empresas, cumplimiento, reportes, vistas (SINU), gestion (usuarios, periodos), pqrs, ayuda, auditoria, costos (Costos de IA) |
| `layout/shell.component.ts` | Panel lateral, menú por rol, tema oscuro/claro, avisos flotantes |
| `core/services/api.service.ts` | Cliente único de la API; los componentes no arman URLs |
| `core/models/modelos.ts` | Tipos de la API en el cliente |
| `core/auth`, `core/guards`, `core/interceptors` | Sesión (token en memoria y almacenamiento local), guardias por rol, cabecera de autorización |
| `core/ui/avisos.service.ts` | Avisos flotantes (éxito, error, información) |
| `shared/components`, `shared/pipes`, `shared/utils` | Esqueletos de carga, estados, cronograma, etiquetas en español, formato de moneda |
| `src/estilos.css`, `src/assets` | Sistema de diseño SIPRA (sección 18): tokens, tipografía, iconos, ilustraciones |

**Infraestructura (`infra/`)**: `gcp/desplegar.sh` (despliegue desde Cloud
Shell, el que se usa hoy), `gcp/cloudbuild.yaml` (flujo de integración
continua para los cuatro ambientes), `gcp/aprovisionar-ambiente.sh`,
`permisos.sh`, `red-privada.sh`, `tareas-programadas.sh`, `nube-imagen.yaml`;
`docker/` para el entorno local. **Flujos de GitHub Actions** en
`.github/workflows/` (`ci.yml`, `desplegar.yml`), ya dentro del repositorio.

### 20.5 Cómo se hacen los cambios habituales

| Quiero… | Toco, en este orden |
|---|---|
| Agregar un endpoint | DTO en `application/dtos` → método en el caso de uso → ruta en el controlador con `@Roles` → método en `apps/web/.../api.service.ts` y modelo en `modelos.ts` → prueba en `test/` |
| Agregar una tabla o columna | Entidad ORM en `todas.orm-entity.ts` → migración nueva en `migrations/` (nombre con marca de tiempo; registrarla en `todas.migracion.ts`) → `npm run migration:run` → mapper en `adapters/persistence/postgres/mappers.ts` → puerto y adaptador si hace falta → reflejarlo en la sección 3 de este documento |
| Agregar una pantalla | Componente standalone `OnPush` en `features/<nombre>/` → ruta perezosa en `app.routes.ts` con `rolGuard` → entrada en el menú de `shell.component.ts` → etiquetas en `etiquetas.pipe.ts` |
| Agregar un parámetro operativo | Entrada en `CATALOGO_PARAMETROS` (`domain/entities/parametro.entity.ts`) → leerlo con `ParametrosUseCase.numero/booleano` donde se use; queda editable desde la API de administración sin desplegar |
| Agregar un tipo documental | Enum `TipoDocumento` → ficha en `criterios-documentales.ts` (criterios del manual) → campos en `campos-extraccion.ts` → matriz de modalidades (`modalidad.entity.ts`) → páginas típicas en `costos-ia.domain-service.ts` → etiqueta en la web |
| Sustituir un adaptador simulado por uno real (SINU, RUES, correo) | Nueva clase que implemente el puerto en `infrastructure/adapters/externos` → variable `*_DRIVER` en `configuracion.ts` → factoría en `app.module.ts` → prueba con dobles del cliente HTTP |
| Cambiar un umbral del pipeline | No se despliega: `PUT /administracion/parametros/pipeline.umbral_verde` con motivo (sección 7.3 y M12) |
| Cambiar precios o modelos de IA | Tabla `TARIFAS_IA` y `VIGENCIA_TARIFAS` en `domain/entities/tarifas-ia.ts`; `OPENAI_MODELO` por variable de entorno |
| Publicar en el ambiente de pruebas | `bash infra/gcp/desplegar.sh` desde Cloud Shell en la raíz del repositorio; con OpenAI: `IA_DRIVER=openai bash infra/gcp/desplegar.sh` (sección 19.6) |

Toda regla que el manual institucional fije va al dominio con sus palabras y
con una prueba; lo que el manual no dice, no se inventa.

### 20.6 Flujos de negocio de punta a punta

1. **Registro de la práctica** (sección 17): el estudiante diligencia el
   Formulario Único de Registro dentro de las ventanas del periodo; se genera
   la carta de presentación con consecutivo; coordinación puede registrar en
   nombre del estudiante.
2. **Expediente documental** (secciones 4, 7 y 19): la matriz de modalidades
   dice qué documentos exige cada etapa; cada cargue pasa por el pipeline
   (forense → PDF417 → lectura asistida → coherencia cruzada → puntaje) y
   termina en `auto_aprobado`, `en_revision` o `ilegible`; nunca se rechaza
   solo. El docente facilitador decide con justificación; toda decisión queda
   en la auditoría inmutable.
3. **Compuerta de ARL** (secciones 8.1 y 8.2): la práctica no puede iniciar
   sin afiliación vigente anterior a la fecha de inicio; en las modalidades
   articuladas la CUN afilia y el auxiliar gestiona la solicitud desde el
   portal de ARL.
4. **Acompañamiento y cierre** (secciones 8 y 17): bitácora, señales de
   riesgo, obligaciones con vencimiento, nota del docente y cierre.
5. **Empresas y bolsa** (secciones 4.3, 4.4 y 8.4): verificación de NIT,
   habilitación por administración, vacantes con filtro antidiscriminación;
   la bolsa espera el acto administrativo del SPE.
6. **Reportes** (sección 8.6 y 17): reportes de prácticas, bitácoras y cartas
   en Excel; reportes regulatorios bloqueados hasta completar catálogos.
7. **PQRS y ayuda** (0.13): centro de ayuda con 123 preguntas y solicitudes
   con trazabilidad.
8. **Costos de IA** (sección 19.5): tarifas, estimación por estudiante y
   gasto real.

### 20.7 Operación y diagnóstico

- `GET /api/v1/salud` (estado y base) y `GET /api/v1/metrics` (Prometheus).
- `GET /api/v1/administracion/diagnostico` (administrador): almacenamiento
  (escribe, lee y borra un objeto) y lectura asistida (llave, modelo y una
  petición mínima real). `desplegar.sh` lo ejecuta al final e imprime el
  resultado.
- Registros: Cloud Logging del servicio `sipra-api-<ambiente>`; en local, la
  consola de la API (nivel con `LOG_NIVEL`).
- Si un documento queda en `recibido` sin avanzar: la cola en proceso perdió
  el trabajo (instancia apagada); se reprocesa con `POST /trabajos/procesar`
  (ver `trabajos.controller.ts`; `GET /trabajos/profundidad` muestra la cola),
  o se pasa a Cloud Tasks (obligatorio en pre y prod).
- Si todo va a revisión humana con `C2_EXTRACCION_NO_DISPONIBLE`: el
  proveedor de IA falla; mirar el diagnóstico y el detalle de la bandera.
- Tope diario de IA y límite por práctica: Parámetros (`ia.tope_diario_usd`,
  `ia.lecturas_por_practica_dia`); en el ambiente abierto el tope no supera
  `IA_TOPE_DIARIO_USD`.
- Respaldos: Cloud SQL con copias automáticas (sección 10.7); los documentos
  con purga programada (sección 6.6) se eliminan del almacenamiento a las
  2:00 a. m. por una tarea programada, y su lectura asistida se reduce a lo
  que sostiene los costos.

### 20.8 Decisiones abiertas que no son de código

| Decisión | Quién | Qué bloquea |
|---|---|---|
| Autorización del SPE para la bolsa de empleo | Extensión y Jurídica | Activar postulaciones y reportes al SPE |
| Validación jurídica del tratamiento de datos y de la transferencia internacional (los documentos de los estudiantes, incluidas cédulas, se envían al proveedor de IA en Estados Unidos) | Jurídica y protección de datos | Activar la lectura asistida con datos reales en producción |
| Método de acceso a SINU | Tecnología | Sincronización real de matrícula y docentes; nota a C-Digital |
| Archivos oficiales del DANE | Área responsable de catálogos | Reportes regulatorios en pre y prod |
| Pulso mensual de dos toques | Dirección de Operaciones | Alcance de la señal de acompañamiento |
| Calibración de umbrales con documentos reales durante el piloto | Área de Prácticas con el equipo técnico | Tasa de aprobación automática confiable |
| Modelo y tope de gasto de IA definitivos | Dirección de Operaciones | Presupuesto; hoy gpt‑6‑luna, 50 USD diarios |

### 20.9 Glosario mínimo

| Término | Significado |
|---|---|
| FUR | Formulario Único de Registro de la práctica |
| SGP | Sistema de Gestión de Prácticas actual, cuyo proceso base replica SIPRA (sección 17) |
| SINU | Sistema académico de matrícula de la CUN; fuente única de verdad, solo lectura |
| ARL / EPS | Administradora de riesgos laborales / entidad promotora de salud |
| RUES | Registro Único Empresarial y Social (verificación de NIT) |
| SPE | Servicio Público de Empleo (autorización de la bolsa y reportes) |
| PILA | Planilla integrada de liquidación de aportes |
| PDF417 | Código de barras del reverso de la cédula colombiana |
| Modo abierto | Ingreso por selección de perfil sin contraseña; solo dev y qa |
| Capa 0‑5 | Etapas del pipeline documental: forense, calidad, lectura asistida, coherencia, verificación externa, decisión |
| Banda verde / amarilla / roja | Puntaje del pipeline: aprobación automática, revisión humana, revisión prioritaria; nunca rechazo automático |

---

## 21. Bitácora de cambios

### 0.17.3 — 26 de octubre de 2026

Fase 3 · P0-B1, autorización y superficie de seguridad:

- **Política de acceso explícita:** `@Autenticado()` nuevo; `RolesGuard` falla
  cerrado; meta-prueba de todas las rutas (§6.4).
- **Empresas:** `GET /empresas` y `/:id` solo para administración, coordinación,
  extensión y la propia empresa (controlador y caso de uso). Estudiantes, docentes
  y auxiliares reciben la empresa de su práctica dentro del expediente.
- **Documentos:** acceso por función (§6.5). `POST documentos/practica/:id` ya no
  admite empresa, extensión ni auxiliar (empresa y extensión podían cargar si veían
  la práctica). El expediente del frontend tolera la ausencia de documentos y de
  bitácora.
- **Bitácora:** auxiliar y extensión ya no la leen (controlador y caso de uso).
- **Cartas:** extensión deja de generarlas y consultarlas (DT §5).
- **Worker, métricas, Swagger, enlaces firmados y nginx** (§6.4 y §6.5); en nginx las
  cabeceras de seguridad se repiten en los bloques con `add_header` propio.
- **`verificarTokenDeServicio`** exige la audiencia (`WORKER_URL`) y no falla con 500
  ante un token ilegible.
- `cloudbuild.yaml` fija `METRICAS_HABILITADAS=false` hasta que exista el token en
  Secret Manager.
- **Pendientes conocidos (fuera de P0-B1):** `/vistas/sinu/estudiante` y
  `/vistas/sinu/matriculas` no acotan por escuela (falta el mapeo programa–escuela);
  cartas y consolidado de ARL tampoco acotan por escuela; la proyección de práctica
  para `empresa` incluye `nota` y `avance`; consentimiento de datos (P0-B2); cookie
  HttpOnly, CSRF y revocación de sesión; CSP; límite de peticiones.

### 0.17.2 — 26 de octubre de 2026

Fase 3 · P0-A, autenticación (rama `fase3/p0-a-autenticacion`):

- **OIDC de extremo a extremo.** El callback devolvía JSON al navegador y el SPA
  nunca recibía la sesión. Ahora Google regresa al frontend
  (`/ingreso/callback`, `IngresoCallbackComponent`), que reenvía `code` y
  `state` por `POST /auth/oidc/callback`; el SPA usa `establecer()`.
- **`state` firmado** con `csrf` y `nonce` independientes y vencimiento (§9.5);
  el cliente lo compara y el servidor lo verifica. **`nonce` obligatorio**: antes
  la comprobación se omitía porque Google no devuelve `nonce` en la URL.
- **Modo abierto solo en `dev` y con tres llaves** (§9.1). `AUTH_MODO` y
  `SIPRA_AMBIENTE` pierden su valor por defecto; nueva variable
  `AUTH_ABIERTO_CONFIRMADO`. `qa` deja de admitirlo. `cloudbuild.yaml`,
  `desplegar.sh`, `desplegar.yml`, `ci.yml`, `aprovisionar-ambiente.sh` y
  `.env.example` se ajustaron.
- Pruebas: `oidc-service.spec.ts` y `auth-controller.spec.ts` nuevos; la matriz
  del modo abierto en `configuracion-entorno.spec.ts`.
- **Pendiente:** validación contra Google real (§9.6); uso único del `state`
  con Redis (§9.5); pruebas del frontend; sesión (§9.7).

### 0.17.1 — 14 de octubre de 2026

Repositorio independiente:

- SIPRA PRÁCTICAS deja de ser la carpeta `sipra/` del repositorio
  `Productoacademico` y pasa al repositorio privado
  `ironfuentes-netizen/sipra-practicas`, con su historial completo (57
  commits, separados con `git subtree split`); la rama principal es `main`.
- Los flujos de GitHub Actions entran al repositorio como
  `.github/workflows/ci.yml` y `.github/workflows/desplegar.yml` (antes
  `sipra-ci.yml` y `sipra-desplegar.yml` en la raíz del repositorio original),
  sin filtros de rutas y ejecutándose desde la raíz.
- Referencias actualizadas en el encabezado, §15 (P-59 y P-67 resueltos,
  totales descontados), §16 (decisión del repositorio), §20 (acceso,
  clonación, ubicación de los flujos), README y CLAUDE.md. El commit de
  referencia `4fff78f` del repositorio original equivale aquí a `161ef40`.
- La primera ejecución de `ci.yml` en la historia del proyecto destapó una
  verificación vacía: el paso «Verificar que la auditoría sea inmutable»
  hacía `UPDATE auditoria` sobre una tabla sin filas (las semillas no
  escriben auditoría) y, como la protección es un disparador por fila, el
  `UPDATE` de 0 filas «pasaba» y el paso fallaba al revés. Ahora inserta una
  fila de prueba y exige que el rechazo venga del disparador; la compuerta
  ARL exige que el `INSERT` falle por `ck_practicas_compuerta_arl` y no por
  otro error. Ambos pasos se probaron en local contra una copia de la base,
  incluido el caso negativo (sin disparador, el paso falla). Con el arreglo,
  la integración continua quedó en verde (ejecución 38628704343: lint, pruebas
  y compilación; aislamiento; migraciones; escaneo de secretos). El flujo de
  despliegue sigue fallando en la autenticación con Google por los valores
  `PENDIENTE` (P-03).
- Correcciones tras una revisión cruzada del repositorio independiente (cinco
  revisores y dos refutadores por hallazgo): §2.1, §10.3, §12 y §20.1 dejan de
  suponer la carpeta `sipra/`; §10.9 documenta cómo volver a atar el proveedor
  de identidades de Google al repositorio nuevo y `arranque-unico.sh` lo hace
  solo (valor por defecto de `REPO_GITHUB` y actualización del proveedor si ya
  existe); la verificación de la compuerta ARL en `ci.yml` usa una modalidad
  vigente (`pasantia`) en lugar de la retirada `empresarial`; `.env.example`
  define `CORREO_DRIVER` una sola vez; la semilla nombra a la coordinadora de
  consulta igual que el README y el ambiente de pruebas; cifras de pruebas
  (175 y 225 → 583) y totales por grupo recalculados desde los ítems (A 44 – 72,
  D 32 – 50); el volcado de datos sintéticos del paquete incluye `obligaciones`
  y `vacantes`.
- Fuera de eso no hay cambios funcionales: el código de la aplicación es el
  mismo del último commit del repositorio original (`5ec8936`, aquí `4617479`).

### 0.17 — 13 de octubre de 2026

Paquete de transferencia del proyecto a otro ingeniero:

- Sección 20, **Guía de transferencia**: qué se entrega, accesos que pedir,
  primer día, mapa del código, cómo se hacen los cambios habituales, flujos de
  punta a punta, operación y diagnóstico, decisiones abiertas y glosario.
- Sección 15 reescrita como **backlog verificado contra el código**: 78
  ítems en cinco grupos, construidos por seis revisiones independientes del
  repositorio y contrastados por cuatro verificadores; estados por módulo
  corregidos (M1, M4b, M10 y M12 pasan a parciales) y doce hallazgos que
  cambian el panorama (SIPRA no está en `main`, el flujo de despliegue de
  GitHub Actions nunca ha funcionado, OIDC no cierra de extremo a extremo,
  Cloud Tasks nunca se ha ejercitado, el consentimiento de datos no tiene
  flujo de aceptación, entre otros).
- Coherencia documental: la restricción de la compuerta ARL cita las
  modalidades reales (`validacion_experiencia`, `combinacion_funciones`); la
  transición a `finalizada` queda marcada como arista sin uso; el índice
  incluye las secciones 19 y 20; la etiqueta muerta `homologacion_experiencia`
  sale de la web.
- Paquete exportado fuera del repositorio: documentación en Markdown, Word y
  PDF (técnico, resumen ejecutivo, anexo de inventario, pendientes), código
  fuente y flujos de GitHub Actions, esquema SQL exacto, diccionario de datos
  generado, diagrama entidad‑relación, datos sintéticos, especificación
  OpenAPI y 43 capturas de pantalla.

### 0.16 — 9 de octubre de 2026

Lectura documental asistida con OpenAI (sección 19):

- Driver `IA_DRIVER=openai` sobre la Responses API: PDF o imagen en base64,
  salida JSON estricta, reintento único de fallos transitorios, costo por
  lectura a partir del `usage` real y la tabla de tarifas vigente.
- Base de conocimiento documental (`ConocimientoDocumentalDomainService`):
  la instrucción por tipo sale de los criterios del manual; los campos por
  tipo pasan al dominio (`campos-extraccion.ts`) con su semántica. Se amplían
  los campos de contrato de aprendizaje, certificado laboral con funciones,
  contrato laboral, carta de finalización, PSO‑F012 y seguro internacional.
- Pipeline: los criterios en «no» se convierten en banderas altas; los tipos
  sin campos van siempre a revisión humana; una falla del proveedor ya no
  deja el documento en banda verde (antes bandera media → auto‑aprobado);
  tope diario de gasto como parámetro operativo `ia.tope_diario_usd`; la
  lectura se guarda con `leidoEn` y se conserva aunque el documento resulte
  ilegible; el motivo de ilegibilidad llega al estudiante.
- Costos: tarifas verificadas, estimador por estudiante y modalidad,
  comparativa de modelos, gasto real agrupado (`/costos-ia/*`) y página
  **Costos de IA** (administración y coordinación) con conversión a pesos.
- Expediente: distintivo «Revisión manual requerida» y bloque de lectura
  asistida para roles internos; DTO con `lectura`.
- Diagnóstico de administración comprueba llave y modelo; `desplegar.sh`
  acepta `IA_DRIVER=openai` y exige el secreto `sipra-<ambiente>-openai`;
  Cloud Build parametriza `_IA_DRIVER` y `_OPENAI_MODELO`.
- Lector simulado: descomprime los flujos Flate y lee cadenas hexadecimales,
  con lo que extrae campos de PDF generados por pdfkit y similares; más
  patrones de tipo. El adaptador de Anthropic comparte la base de
  conocimiento y devuelve los mismos hallazgos que el de OpenAI.
- Robustez del adaptador: respeta `Retry-After`, baja el esfuerzo de
  razonamiento si el modelo lo rechaza, reintenta sin `detail` si la API no lo
  admite, registra el gasto de respuestas inservibles (incompletas,
  rehusadas) como lectura fallida y deja como «no determinable» todo criterio
  que el modelo omita. Las variantes `-pro`/`-codex` no heredan la tarifa del
  modelo base.
- Arnés `npm run ia:evaluar` con corpus sintético; pruebas nuevas del
  adaptador, la base de conocimiento, el estimador y el pipeline.
- Revisión adversaria (98 agentes, 18 hallazgos confirmados) y correcciones:
  techo del tope diario en el ambiente abierto, límite de lecturas por
  práctica y día, alcance por escuela y sin cédulas en Costos de IA, modelo
  sin tarifa valorado con tarifa de respaldo y rechazado al arrancar, esfuerzo
  de razonamiento resuelto por modelo y salvaguarda que lee `error.param`,
  petición mínima real en el diagnóstico, saneamiento de llaves en mensajes
  de error, parámetros de consulta validados, lectura minimizada al purgar,
  reglas de tokens por imagen corregidas (reducción proporcional, lado máximo
  de Astra, redondeo en mosaicos, presupuesto de los modelos deprecados),
  esquema y mensaje en el estimador, validación temprana en `desplegar.sh`,
  `--no-cpu-throttling` y Cloud Build con `simulado` por defecto. 122
  pruebas más (583 en total); la configuración de Costos de IA muestra el
  esfuerzo efectivo y las fechas sin hora del filtro se interpretan como
  días de Colombia.

### 0.15.2 — 7 de octubre de 2026

Preparación del ambiente de pruebas para las auditorías:

- El selector de ingreso del ambiente abierto lista **todas** las personas de
  cada perfil («Entrar como»), con lo que las distingue; la API devuelve
  `usuarios` por perfil.
- El guion de despliegue **crea el bucket privado de documentos** si no
  existe: en dev no existía y cada carga fallaba con un 500. La API responde
  ahora con un 503 explícito cuando el almacenamiento no está disponible.
- Enlaces de documentos en Cloud Storage: si la identidad no puede firmar URL
  del bucket, el enlace lo firma la API y el archivo se sirve a través de
  ella; la ruta de descarga ya no es exclusiva del almacenamiento local.
- El extractor simulado (`IA_DRIVER=simulado`) deja de marcar como ilegibles
  los PDF escaneados o sin los campos esperados: pasan a **revisión humana**
  con los campos ausentes señalados. «Ilegible» queda para archivos vacíos o
  truncados. Así el ambiente de pruebas no devuelve documentos válidos.
  Un documento del que no se leyó nada recibe la bandera
  `C2_SIN_LECTURA_AUTOMATICA` (severidad alta): nunca se aprueba solo.
- Dockerfiles con reintentos de npm; nginx sirve el manifiesto con su tipo.
- README: ambiente de pruebas en la nube, enlaces y usuarios.

### 0.15 — 5 de octubre de 2026

Capa de movimiento y respuesta de la interfaz (sección 18.5): avisos
flotantes con `AvisosService` en lugar de franjas fijas en todas las
pantallas; esqueletos de carga; entrada escalonada de tarjetas y listas;
transiciones entre vistas con marco estable; cambio de tema con revelado
circular e icono; respuesta al tacto en botones, filas y barras de avance;
pestañas animadas en el expediente; botones con indicador de guardado y
validación en vivo del formulario de PQRS. Sin cambios en la API.
Verificación: lint y compilación de producción, recorrido local con capturas
y prueba de interacción del aviso flotante.

### 0.14 — 5 de octubre de 2026

Paquete de diseño oscuro SIPRA v1.0 aplicado a la interfaz (sección 18):
tokens de color, radios y espaciado; DejaVu Sans como `SipraSans` en WOFF2;
símbolo y descriptor «Prácticas y empleo CUN» en el panel lateral y el ingreso;
favicon, iconos de aplicación y manifiesto; sprite de 24 iconos en el menú;
ilustraciones en el ingreso y en los estados vacíos; botones, campos,
etiquetas y foco según las fichas 10 y 11; tema oscuro predeterminado con
alternativa clara derivada. Sin cambios en la API ni en las reglas del
proceso. Verificación: lint y compilación de producción de la web, recorrido
local con capturas de escritorio y móvil.


### 0.1 — 28 de agosto de 2026

Fundación del proyecto. Corresponde a las semanas 1 a 3 del plan de ocho
semanas (gobierno y arquitectura, modelo de datos y seguridad, prácticas y
cumplimiento), con adelantos de las semanas 4 a 7.

**Arquitectura y base**
- Monorepo con espacios de trabajo de npm.
- Backend NestJS 11 sobre Fastify, arquitectura hexagonal, regla de dependencia
  impuesta por ESLint.
- Frontend Angular 20 con componentes standalone, signals, `OnPush` y carga
  perezosa de todas las features.
- Dos migraciones de TypeORM: esquema inicial y rol de mínimo privilegio.

**Dominio**
- Entidades: `Practica`, `Documento`, `Empresa`, `Obligacion`, `Usuario`,
  `Vacante`, auditoría.
- Servicios de dominio: obligaciones, acompañamiento, antidiscriminación,
  forense.
- Objeto de valor `Nit` con el algoritmo DIAN.

**Seguridad**
- Compuerta ARL en dominio y en base.
- Auditoría inmutable por disparador y por permisos.
- Alcance aplicado en la consulta; filtrado de columnas en el servidor.
- Validación de configuración que prohíbe el modo abierto en `pre` y `prod`.

**Pipeline**
- Capas 0, 1, 2, 3 y 5 implementadas. Cortocircuito ante bandera crítica.
- Captura guiada en el navegador con varianza del Laplaciano.
- Tres resultados: aprobado, en revisión e ilegible.

**Infraestructura**
- Dockerfiles multi-etapa con usuario sin privilegios.
- Cloud Build de diez pasos para los cuatro ambientes.
- Script de aprovisionamiento de GCP y de tareas programadas.
- GitHub Actions con verificación de las garantías del motor y escaneo de
  secretos.

**Verificación**
- 48 pruebas en verde, incluidas 10 de aislamiento.
- Flujos probados de extremo a extremo contra PostgreSQL real y en navegador.

### 0.2 — 28 de agosto de 2026

Semana 4 del plan, con adelantos de la 5 y la 7.

**Catálogos oficiales**
- Ingestor con validación estructural y verificación de completitud; declarar
  `completo` sin demostrarlo hace fallar la carga.
- Manifiesto con procedencia, URL oficial y estado real de cada catálogo.
- Tabla `cat_estado` y bloqueo de los reportes regulatorios en `pre` y `prod`
  mientras un catálogo requerido siga incompleto.

**Cola de trabajo**
- Puerto `ColaPort` con adaptador en proceso y adaptador de Cloud Tasks.
- Dos colas separadas: la interactiva atiende el cargue en curso.
- Endpoint worker que verifica el id_token OIDC de la cuenta de servicio.
- El aviso al estudiante se movió al final del pipeline, que es donde el
  resultado existe.

**Gestión documental**
- Hash perceptual dHash de 128 bits con guarda de entropía.
- Decodificador PNG completo y decodificador JPEG de solo coeficientes DC, sin
  dependencias nativas.
- Detección de imagen reutilizada entre expedientes.
- Saneamiento de PDF conservando la longitud y el hash del original.

**Reportes regulatorios (M9)**
- Archivos planos de vacantes y de plazas con separador `|$$|`.
- Marca de borrador dentro del archivo mientras el anexo no esté conciliado.
- Hash del archivo en la auditoría y en la respuesta.
- Vista de reportes con el estado de los catálogos.

**Correcciones**
- La zona de carga de documentos era un `div` con manejador de clic: no era
  alcanzable por teclado. Ahora es un botón.
- `cat_cno.nivel` significaba nivel ocupacional; la jerarquía del catálogo pasó
  a columna propia para no cargar dos sentidos en el mismo nombre.

**Verificación**
- 93 pruebas en verde.
- Flujos probados contra PostgreSQL real y en navegador.

### 0.3 — 8 de septiembre de 2026

Semana 5 del plan, con adelantos de la 6 y la 7.

**Preprocesamiento determinístico**
- Enderezamiento por proyección, recorte idempotente de bordes, ecualización
  adaptativa con límite de amplificación y binarización por umbral local.
- El pipeline reintenta la extracción sobre la copia preprocesada antes de
  devolver el documento; si tampoco alcanza, no se atribuye el éxito.
- Cada paso registra sus parámetros: la operación es reproducible y auditable.

**Lectura del PDF417 de la cédula**
- Decodificación con ZXing en WebAssembly, con prueba de ida y vuelta real.
- Cuando el código se lee, el pipeline termina ahí: sin OCR y sin IA, con los
  datos en confianza 1.
- Las posiciones de los campos de nombre quedan declaradas como no conciliadas,
  y el sistema se abstiene de usarlas para acusar a nadie.

**Notificaciones por Google Workspace**
- API de Gmail con cuenta de servicio y delegación en todo el dominio; el JWT se
  firma con `node:crypto`.
- Ocho plantillas en el dominio, con concordancia de género y escapado del HTML.
- Cada intento de envío queda en auditoría, haya salido bien o mal.
- El canal de consola queda prohibido en producción.

**Correcciones de fallos encontrados al construir**
- El umbral de Otsu marca el último valor de la clase oscura: la comparación
  `<` dejaba fuera la tinta de su propia clase y el recorte veía la imagen
  vacía.
- El adaptador resolvía el WASM por `zxing-wasm/package.json`, que el paquete no
  expone en su mapa de `exports`: habría fallado también en Node.
- Los números de documento sintéticos no tenían dígito NUIP válido y levantaban
  una falsa alarma en cada ejecución.
- Los avisos decían «vuelva a cargarlo» de una planilla: faltaba la concordancia
  de género.

**Verificación**
- 175 pruebas en verde.
- Cédula con PDF417 cargada de extremo a extremo: auto-aprobada con 98/100,
  leída del código sin OCR ni IA.

---

*Documento elaborado por la Dirección de Operaciones. Las referencias
normativas requieren validación de la Dirección Jurídica antes de la radicación
definitiva.*

### 0.4 — 9 de septiembre de 2026

Puesta en marcha de un ambiente navegable.

**Ambiente puente**
- `main.ts` se dividió: `crearAplicacion()` construye la aplicación y `main.ts`
  abre el puerto. Cloud Run sigue usando exactamente el mismo camino.
- Adaptador sin servidor que inyecta las peticiones en la misma aplicación Nest,
  sin lógica de negocio y sin tocar el dominio.
- `COLA_DRIVER=en_linea`: donde el proceso se congela al responder, el trabajo
  se atiende antes de contestar. Prohibido en preproducción y producción por la
  validación de configuración, igual que el modo de autenticación abierto.

**Verificación**
- 175 pruebas en verde, lint y compilación limpios.
- Recorrido de punta a punta a través del adaptador contra PostgreSQL real:
  selector de perfiles, emisión de token, listado de prácticas y de empresas,
  carga de documento por multipart y ejecución completa del pipeline en la misma
  petición. El alcance por rol se comporta igual que en el servidor: 401 sin
  token, 403 al estudiante sobre el tablero de cumplimiento.

**Lo que el puente no resuelve**
- Sigue faltando lo que depende de terceros: los cuatro proyectos de Google
  Cloud y su facturación, el anexo técnico del SPE, los archivos oficiales del
  DANE, la disposición de la trama PDF417 de la Registraduría y el método de
  acceso a SINU.

### 0.5 — 9 de septiembre de 2026

Ambiente puente listo para desplegar.

**Base de datos**
- La conexión admite ahora una sola cadena (`DB_URL`) además de los campos
  sueltos que usan Cloud SQL y el entorno local; así la entregan los Postgres
  gestionados. `validarEntorno` exige una forma u otra y rechaza el arranque si
  falta, en lugar de descubrirlo en la primera consulta.
- El adaptador del puente prepara la base en el primer arranque —migraciones,
  catálogos y semillas— bajo cerrojo consultivo, de forma idempotente.

**Dos huecos que el empaquetado dejó a la vista**
- Las migraciones se resolvían por comodín sobre el disco, dependiendo de
  `__dirname`. Un empaquetador reescribe esa ruta y las migraciones no fallan:
  simplemente no corren, que es peor. Ahora se declaran una a una en
  `migrations/todas.migracion.ts`, igual que las entidades.
- `nest build` no copiaba los archivos de catálogo (CSV y manifiesto) a `dist`,
  y la imagen de Docker copia solo `dist`. El cargador habría fallado también
  en Cloud Run. Corregido en `nest-cli.json`, no en el puente.

**Verificación**
- 175 pruebas más las 10 de aislamiento entre empresas, lint y compilación
  limpios.
- El paquete que produce el empaquetador de la plataforma —no el código suelto—
  se ejecutó contra una base vacía: migró, cargó catálogos, sembró y quedó
  sirviendo en 2,0 s. Selector de perfiles, emisión de token, prácticas,
  cumplimiento y empresas correctos; 403 donde el rol no alcanza.

### 0.6 — 9 de septiembre de 2026

Primer despliegue del ambiente puente, y lo que enseñó.

**El fallo**
- La API respondía 502: `Cannot find module 'dotenv'`. La pantalla de ingreso,
  además, lo presentaba como si faltara configurar Google Workspace.
- Causa: el adaptador importaba la API por ruta relativa a `dist/`. Así el
  empaquetador incrusta el código pero deja sueltos los `require` de Nest,
  TypeORM, Fastify y el resto, que en ejecución no resuelve nadie. `dotenv` era
  solo el primero de la lista.
- Corrección: la API se declara con `exports` y se importa por nombre de
  paquete. El empaquetador la copia entera con sus dependencias.

**Lo que el fallo dejó a la vista**
- La pantalla de ingreso caía al bloque de Google Workspace —el último `@else`—
  cuando `/auth/modo` no respondía, y el usuario terminaba pulsando un botón
  inútil en lugar de enterarse del problema real. Ahora distingue ambos casos y,
  sin respuesta del servidor, no ofrece ninguna forma de ingreso.
- Una excepción al construir la aplicación tumbaba el proceso y la respuesta
  llegaba vacía. El adaptador la envuelve y responde JSON con el motivo en dev
  y qa; fuera de ahí, genérico. Ese cambio fue lo que permitió identificar la
  causa sin acceso a los registros.
- El formateo legible de la bitácora quedó condicionado a que haya terminal.
  Donde no la hay se registra JSON, que es lo que esperan Cloud Logging y
  cualquier recolector.

**Verificación**
- 175 pruebas más las 10 de aislamiento, lint y compilación limpios.
- El paquete producido por el empaquetador se ejecutó **sin ninguna ayuda de
  resolución de módulos**, que es la condición que antes ocultaba el error:
  base vacía, migrada, sembrada y sirviendo en 1,6 s, con el alcance por rol
  intacto.

### 0.7 — 10 de septiembre de 2026

Traslado a Google Cloud.

**Aprovisionamiento en una sola pasada**
- `infra/gcp/arranque-unico.sh`: servicios, Cloud SQL sin redes autorizadas,
  bucket con prevención de acceso público, secretos generados en el momento,
  colas, identidad de aplicación de mínimo privilegio y federación de
  identidades para GitHub. Idempotente.
- Despliegue continuo por `git push`, con lint, pruebas y aislamiento entre
  empresas como condición previa a tocar la nube.

**Correcciones que el traslado dejó ver**
- La validación de entorno exigía `DB_HOST` incluso cuando la conexión entra
  por el socket del conector de Cloud SQL, que es como conecta Cloud Run: el
  arranque habría fallado allí. Ahora acepta host, socket o cadena completa.
- El contenedor del frontend no sabía servir la API. Ahora la expone bajo su
  mismo origen por plantilla de nginx, de modo que el paquete de Angular
  conserva sus rutas relativas.

**Lo que sigue pendiente de terceros**
- Los otros tres proyectos de Google Cloud y su separación de facturación.
- El anexo técnico del SPE, los archivos oficiales del DANE, la disposición de
  la trama PDF417 de la Registraduría y el método de acceso a SINU.

### 0.8 — 10 de septiembre de 2026

M12 · Administración: parametrizar sin desplegar.

**Qué resuelve.** La tasa de aprobación automática es el indicador del proyecto
y solo se puede afirmar calibrando los umbrales contra documentos reales
durante el piloto. Con los valores compilados, cada ajuste era un despliegue.
Ahora son un cambio registrado que surte efecto de inmediato.

**La distinción que define el módulo.** No todo umbral es negociable. Los
parámetros **operativos** los mueve la Dirección según lo que observe; los
**normativos** los fija una norma, el sistema los muestra con la norma citada y
se niega a cambiarlos. Permitir que una pantalla de administración relajara la
compuerta de ARL o la vigencia de una vacante convertiría el incumplimiento en
un descuido de dos clics.

**Diseño.** El catálogo —clave, tipo, rango, unidad, naturaleza y para qué
sirve— vive en el código; la base guarda solo lo que se apartó del valor de
fábrica. Una clave que nadie declaró no se puede escribir y una fila huérfana no
altera el comportamiento. La lectura se sirve de un mapa en memoria con ventana
de refresco, porque se consulta en cada validación; si la base no responde se
continúa con el último valor conocido, que es preferible a una validación que no
ocurre.

**Barreras comprobadas contra la base real**
- Un parámetro normativo no se cambia, y el error cita la norma.
- Los dos umbrales del pipeline no pueden cruzarse: dejaría sin efecto la banda
  de revisión humana.
- Un valor fuera de rango o de otro tipo se rechaza antes de escribirse.
- Un cambio sin motivo escrito de al menos diez caracteres no se acepta, ni en
  la API ni en el motor.
- Solo el rol administrador entra: coordinador recibe 403.
- Cada cambio queda en la auditoría inmutable con valor anterior, valor nuevo,
  autor y motivo. Ese registro no admite UPDATE ni como superusuario.

**Consumidores conectados.** El pipeline lee sus umbrales al validar; el
acompañamiento, su ventana de silencio y su anticipación ante vencimientos. El
dominio no consulta la base por su cuenta: recibe los valores vigentes de quien
lo invoca, y así sigue siendo puro y comprobable.

**Verificación**
- 204 pruebas —29 nuevas— más las 10 de aislamiento, lint y compilación limpios.
- Recorrido completo contra PostgreSQL: cambio en caliente, efecto inmediato sin
  reiniciar el servicio, restauración a fábrica y rastro auditado.

### 0.9 — 15 de septiembre de 2026

Decisiones de arquitectura ante la especificación consolidada.

- Se conserva NestJS con Fastify y Angular. La propuesta de Python con React
  viene enunciada como propuesta, no como mandato, y apartarse del estándar de
  la Fábrica de Software obligaría a la institución a sostener dos ecosistemas
  sin ganar nada que la especificación exija: OpenAI se consume por HTTP y Cloud
  Run ejecuta contenedores, sea cual sea el lenguaje.
- Se conservan los seis perfiles. Coordinador de escuela y Dirección de
  Extensión son alcances distintos, no variantes administrativas.
- Se adopta el resto de la sección 8: Cloud Run, Cloud SQL, almacenamiento
  privado, colas, Secret Manager, cuatro ambientes y OpenAI para extracción.

### 0.10 — 15 de septiembre de 2026

Puesta en marcha en `cun-it-fab-contenido-practicas`.

- Construcción de imágenes por archivo de configuración de Cloud Build:
  `gcloud builds submit --tag` no admite un Dockerfile fuera de la raíz del
  contexto, y aquí hay dos imágenes que necesitan el monorepo completo porque
  su `npm ci` lee el `package-lock.json` de la raíz. Ambas imágenes construidas
  y publicadas en Artifact Registry.
- `infra/gcp/permisos.sh`: concede lo mínimo a la cuenta de servicio
  distinguiendo lo que se da sobre el recurso de lo que solo existe a nivel de
  proyecto, y nombra lo que falta en vez de fallar más adelante.
- `desplegar.sh` prefiere la cuenta de mínimo privilegio `sipra-app-<ambiente>`
  y acepta `SIPRA_ETIQUETA` para reutilizar imágenes ya construidas.
- El proyecto tiene desactivadas las concesiones automáticas de IAM —la cuenta
  de cómputo por defecto no tiene ningún rol— y la cuenta que despliega no
  puede modificar la política del proyecto, así que `roles/cloudsql.client` no
  se puede conceder. Diagnóstico confirmado con `add-iam-policy-binding`
  fallando de forma reproducible.
- `infra/gcp/red-privada.sh`: VPC propia, rango reservado, emparejamiento con
  Service Networking e instancia adherida sin IP pública. `desplegar.sh`
  detecta la IP privada y conecta por *Direct VPC egress* con TLS, sin conector
  y sin el rol. Sección 10.10 reescrita: pasa de bloqueo a decisión de diseño.
- `permisos.sh` concede además `serviceAccountUser` sobre la cuenta de la
  aplicación a quien despliega: Cloud Run exige poder actuar como ella.
- La instancia se había creado con `--require-ssl`, que en Cloud SQL exige
  certificado de cliente, no solo cifrado; la aplicación fallaba con
  "connection requires a valid client certificate". Se pasa a
  `ENCRYPTED_ONLY`: TLS obligatorio sin certificado de cliente.
- **Ambiente `dev` en línea** el 17 de septiembre de 2026, tras conceder
  Tecnología los roles de IAM y de Service Networking: base por IP privada
  sin IP pública, identidad `sipra-app-dev`, migraciones, catálogos y datos
  sintéticos aplicados como Cloud Run Job, API y frontend en Cloud Run.
  - Plataforma: `https://sipra-web-dev-62q7xac77q-uc.a.run.app`
  - API: `https://sipra-api-dev-62q7xac77q-uc.a.run.app`
  - Comprobación: `/api/v1/salud`, `/api/v1/auth/modo` y
    `/api/v1/auth/perfiles` responden 200 a través del frontend.

### 0.11 — 22 de septiembre de 2026

El frontend adopta la identidad visual del prototipo.

- `estilos.css` reescrito con la identidad *corporativo sobrio*: azul
  institucional CUN como marca (`oklch(38% .098 254)` en claro), escala
  tipográfica fluida (`--fs-*`), espaciado en pasos de 4 px (`--sp-*`),
  radios y sombras del prototipo, etiquetas de estado con punto, tablas y
  formularios con altura táctil. Los nombres de token se conservan: los nueve
  componentes mejoran sin tocar su lógica.
- Armazón nuevo: panel lateral fijo con iconos en escritorio, barra inferior
  en móvil, barra superior con el título de la vista y conmutador de tema
  (automático / claro / oscuro, guardado en el navegador). La cinta de
  «ambiente de pruebas» queda fija en escritorio y el panel descuenta su alto.
- Ingreso con sello de marca y rejilla de perfiles; inicio con encabezado de
  rol, fecha, tarjetas de cifra con borde de tono y lista «a quién llamar hoy».
- `desplegar.sh` acepta `SIPRA_ETIQUETA_API` para reconstruir solo el frontend
  cuando el cambio es visual.
- Verificación: compilación y lint limpios; capturas en claro, oscuro y móvil
  contra un servidor simulado con datos sintéticos.

### 0.13 — 5 de octubre de 2026

Primeras mejoras sobre la base del SGP, a partir de tres recursos del Área de
Prácticas (sección 17.5):

- **Cronograma por periodo**: calendario `335`, límite de registro y de
  solicitud de ARL dos meses después del inicio, jornadas de inducción y fecha
  de cargue de documentos; ventana `solicitud_arl` propia; gestión de periodos
  con el cronograma editable; tarjeta de cronograma en Inicio, registro y
  solicitud de ARL; semillas con nueve periodos en los tres calendarios.
- **Matriz documental oficial**: pasantía de uno a tres meses con extensión
  solo por coordinación; máximo dos contratos de aprendizaje con cadena de
  formación; artículo científico y reporte de semilleros; pasantía
  internacional con correo de aprobación y seguro médico; criterios de revisión
  actualizados; plazo de cargue de ocho días tras el fin de la práctica.
- **Centro de ayuda**: las 123 preguntas de Desarrollo Profesional en dieciséis
  categorías, con búsqueda sin tildes y enlaces contextuales.
- **PQRS**: tabla `pqrs`, radicado, unificación de duplicados en el radicado
  inicial, respuesta con correo al estudiante, bandeja para coordinación,
  auxiliares y administración; eventos `pqrs_radicada` y `pqrs_respondida`
  en notificaciones y auditoría.
- Corrección: los elementos de un `date[]` llegan como `Date` desde pg; el
  mapeador de periodos los admite.
- Verificación: 373 pruebas en 29 suites, lint sin advertencias en API y web,
  compilación de producción, recorrido local (periodos en tres calendarios,
  creación y ajuste del cronograma, ayuda, PQRS con unificación y respuesta) y
  capturas de escritorio y móvil sin errores de consola.

### 0.12 — 28 de septiembre de 2026

Proceso base del SGP y del portal de ARL, implementado a partir de los cuatro
manuales institucionales (sección 17). Ocho entregas en la rama:

- **Catálogo base**: rol `auxiliar`, permiso `consulta`/`escritura` con guardia
  global, estados `anulada` y `reprobada`, las quince modalidades del selector
  del SGP con su matriz por momentos, criterios documentales del manual,
  periodos académicos con ventanas y dos calendarios.
- **Formulario Único de Registro, carta de presentación y avance documental**:
  todas las reglas del FUR, un registro vigente por periodo, número de FUR por
  identidad, carta en PDF con reimpresión idéntica, porcentajes cargado y
  aprobado por momento.
- **Bitácora, «Evalúa tu proceso», calificación docente y cierre**: tipos de
  mensaje del manual, plazo de ocho días al devolver, cierre automático por
  concurrencia de las tres condiciones, bitácora de solo agregar.
- **Solicitud de ARL**: portal de ARL dentro de SIPRA con la validación
  automática del manual, decisión del auxiliar con motivos, certificado que
  queda en el expediente y consolidado diario para Capital Social.
- **Usuarios administrativos, vistas SINU y sincronizador de docentes**.
- **Reportes del SGP** en Excel: prácticas (siete bloques), bitácoras (cuatro
  tipos) y cartas; exceljs como dependencia nueva.
- **Gestión de periodos y catálogo del proceso** por API.
- **Frontend**: registro y cartas, gestionar la práctica (momentos, bitácora,
  cierre, vacante), solicitud de ARL, gestión de prácticas con filtros,
  usuarios, periodos, vistas SINU y reportes; menú por perfil.
- Semilla nueva: coordinación del Área de Prácticas con escritura; el selector
  del ambiente abierto prefiere el perfil que puede operar el proceso.
- Verificación: 346 pruebas en 26 suites, lint sin advertencias en API y web,
  aislamiento entre empresas en verde, compilación de producción; recorrido
  completo contra PostgreSQL local con las semillas (registro FUR, bitácora,
  «Evalúa tu proceso», periodos, sincronización, reportes en Excel, carta en
  PDF) y capturas de las pantallas en escritorio y móvil sin errores de consola.
