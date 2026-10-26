# SIPRA PRÁCTICAS

**Sistema Integrado de Prácticas y Relacionamiento Académico-Empresarial**
Corporación Unificada Nacional de Educación Superior · Dirección de Operaciones

Plataforma institucional que automatiza la verificación documental del proceso
de prácticas profesionales, produce evidencia de cumplimiento normativo
verificable e integra la bolsa de empleo institucional.

> **Documentación completa:** [`docs/DOCUMENTO-TECNICO.md`](docs/DOCUMENTO-TECNICO.md)
> Es el **único** documento técnico del proyecto y se mantiene actualizado.

---

## Ambiente de pruebas en la nube

Ambiente **permanente** en Google Cloud (proyecto de desarrollo), con datos
sintéticos e ingreso sin contraseña. No caduca: los servicios de Cloud Run y la
base de datos son fijos; solo la sesión del navegador vence a las ocho horas.

| Recurso | URL |
|---|---|
| Aplicación | https://sipra-web-dev-62q7xac77q-uc.a.run.app |
| API · estado | https://sipra-api-dev-62q7xac77q-uc.a.run.app/api/v1/salud |

En el ingreso cada perfil es una tarjeta; si tiene varias personas, el
desplegable «Entrar como» permite elegirla. Usuarios de prueba:

| Perfil | Persona | Correo | Alcance |
|---|---|---|---|
| Practicante | Andrés Felipe Mora Castaño | andres.mora@estudiante.cun.edu.co | pasantía en validación y monitoría inscrita |
| Practicante | Laura Sofía Ramírez Ortiz | laura.ramirez@estudiante.cun.edu.co | pasantía activa con ARL |
| Practicante | Valentina Ochoa Ruiz | valentina.ochoa@estudiante.cun.edu.co | proyección social inscrita |
| Docente facilitador | Hernán Darío Salcedo Rojas | tutor.negocios@cun.edu.co | Negocios y Comunicación |
| Coordinación | Adriana Lucía Rojas Beltrán | coordinacion.practicas@cun.edu.co | Área de Prácticas, escritura |
| Coordinación | Patricia Elena Cárdenas Nieto | coordinacion.ingenierias@cun.edu.co | Escuela de Ingenierías |
| Coordinación | Sandra Milena Quintero Páez | analista.practicas@cun.edu.co | Área de Prácticas, solo consulta |
| Auxiliar de prácticas | Julián Andrés Torres Vega | auxiliar.practicas@cun.edu.co | portal de ARL |
| Administrador | Marcela Ovalle Pineda | admin.practicas@cun.edu.co | acceso total y auditoría |
| Dirección de Extensión | Ricardo Alberto Peláez Mora | extension.bolsa@cun.edu.co | bolsa de empleo y SPE |
| Empresa habilitada | Camila Restrepo Duarte | camila.restrepo@logisticasandinas.com.co | Soluciones Logísticas Andinas |

Para publicar una nueva versión en ese ambiente: `bash infra/gcp/desplegar.sh`
desde Cloud Shell, en la raíz del repositorio.

### Validación automática de documentos con OpenAI

El ambiente arranca con el lector **simulado** (sin costo: lee la capa de
texto de los PDF). Para que la validación la haga OpenAI, guarde la llave en
Secret Manager y despliegue con el driver activo:

```bash
printf '%s' 'sk-…' | gcloud secrets create sipra-dev-openai --replication-policy=automatic --data-file=-
IA_DRIVER=openai bash infra/gcp/desplegar.sh
```

El guion comprueba la llave al final («lectura asistida: Llave válida; modelo
gpt-6-luna disponible»). Qué pasa con cada documento:

- Se lee bien y cumple los criterios del manual → se aprueba solo.
- Es de otro tipo, incumple un criterio, falla el proveedor o el tipo exige
  revisión → **«Revisión manual requerida»** en el expediente; el docente
  decide. Nunca hay rechazo automático.
- Borroso, oscuro o en blanco → **ilegible**: se pide un nuevo cargue con el
  motivo; el docente también puede decidir.

La página **Costos de IA** (administración y coordinación) muestra tarifas,
costo estimado por estudiante y modalidad, comparativa de modelos y el gasto
real por periodo, modelo, tipo y estudiante, con conversión a pesos. El tope
diario de gasto se cambia en Parámetros (`ia.tope_diario_usd`, 50 USD de
fábrica); en el ambiente de pruebas, que no pide contraseña, ese tope nunca
supera los 50 USD fijados en el despliegue, y cada práctica tiene un límite de
40 lecturas automáticas por día. Para medir el modelo con un corpus sintético:
`OPENAI_API_KEY=sk-… npm run ia:evaluar -- --driver=openai`.

## Transferencia del proyecto

Quien reciba el proyecto debe empezar por la **sección 20 del documento
técnico** (`docs/DOCUMENTO-TECNICO.md`, «Guía de transferencia») y seguir con
la sección 15 (estado por módulo y backlog verificado). Todo lo demás de este
README es la guía rápida de arranque.

## Arrancar en local

```bash
cp .env.example .env          # ajustar JWT_SECRETO
npm install
npm run infra:up              # PostgreSQL y Redis por Docker
npm run migration:run
npm run catalogos:cargar      # catálogos oficiales del DANE
npm run seed                  # datos sintéticos
npm run dev                   # API en :3000 · web en :4200
```

Abra http://localhost:4200 y **elija un perfil**: en el ambiente de pruebas el
ingreso no pide contraseña.

| Recurso | URL |
|---|---|
| Aplicación | http://localhost:4200 |
| API | http://localhost:3000/api/v1 |
| OpenAPI | http://localhost:3000/docs/dev-only/swagger |
| Métricas | http://localhost:3000/api/v1/metrics |

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | API y frontend en paralelo |
| `npm test` | 583 pruebas de dominio y aplicación |
| `npm run test:aislamiento` | Aislamiento entre empresas — **condición de despliegue** |
| `npm run ia:evaluar` | Evalúa la lectura documental sobre un corpus sintético (`--driver=openai` con llave) |
| `npm run lint` | ESLint en ambos espacios de trabajo |
| `npm run build` | Compila API y frontend para producción |
| `npm run migration:run` | Aplica las migraciones pendientes |
| `npm run seed` | Carga datos sintéticos |
| `npm run catalogos:cargar` | Carga los catálogos oficiales, verificando completitud |
| `npm run catalogos:estado` | Informe de cobertura de los catálogos |

## Estructura

```
apps/api/     NestJS · hexagonal (domain / application / infrastructure)
apps/web/     Angular · standalone + signals + OnPush + lazy loading
infra/docker/ Entorno local y observabilidad
infra/gcp/    Cloud Build y aprovisionamiento de los cuatro ambientes
docs/         Documento técnico único
```

## Stack

NestJS 11 sobre Fastify · Angular 20 · PostgreSQL · TypeORM · Redis ·
Prometheus · Docker · Google Cloud Platform.

Conforme al manual *Estándares, Arquitectura y Stack Tecnológico* de la
Fábrica de Software CUN, versión 2.0. El detalle del cumplimiento, punto por
punto, está en la sección 14 del documento técnico.

## Ambientes

Cuatro **proyectos separados** de Google Cloud: `dev`, `qa`, `pre` y `prod`.

En `dev` y `qa` el ingreso es por selección de perfil, sin contraseña. En `pre`
y `prod` la validación de configuración **rechaza el arranque** con
`AUTH_MODO=abierto`: allí solo hay ingreso institucional con Google Workspace.
Activarlo no exige cambiar lógica de negocio.

## Antes de producción

Tres gestiones no dependen del desarrollo y tienen plazos propios:

1. **Modificación de la autorización ante la Unidad del SPE** — bloquea la bolsa
   de empleo.
2. **Validación jurídica** de tratamiento de datos y transferencia internacional.
3. **Definición del método de acceso a SINU** con la Dirección de Tecnología.
4. **Archivos oficiales del DANE** (CNO, CIIU, DIVIPOLA completos) y
   **conciliación del anexo técnico del SPE** con Extensión — sin ellos los
   reportes regulatorios no son radicables y el sistema los bloquea.

## Seguridad

- Ninguna credencial en el repositorio. Los secretos viven en Secret Manager.
- `.env` está en `.gitignore` y la integración continua lo verifica.
- Los datos de las semillas son **sintéticos**: ningún dato personal real entra
  en desarrollo.

## Licencia

Uso interno exclusivo de la CUN. No se comercializa a terceros.
