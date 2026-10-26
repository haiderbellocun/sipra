# CLAUDE.md — SIPRA PRÁCTICAS

Guía para trabajar este repositorio (`ironfuentes-netizen/sipra-practicas`,
independiente desde el 14 de octubre de 2026; antes vivió como carpeta
`sipra/` del repositorio Producto Académico, con el que no comparte nada).

## Qué es

**SIPRA PRÁCTICAS** — Sistema Integrado de Prácticas y Relacionamiento
Académico-Empresarial de la CUN. Automatiza la verificación documental del
proceso de prácticas y produce evidencia de cumplimiento normativo.

Monorepo de espacios de trabajo de npm: `apps/api` (NestJS) y `apps/web`
(Angular).

## Documentación

**`docs/DOCUMENTO-TECNICO.md` es el ÚNICO documento técnico del proyecto.**
Se actualiza en cada avance —incluida su bitácora de cambios— y reemplaza
cualquier versión anterior. No crear documentos paralelos: si algo merece
documentarse, va allí.

## Stack obligatorio (no negociable)

Definido por el manual *Estándares, Arquitectura y Stack Tecnológico* de la
Fábrica de Software CUN, versión 2.0. Ajustar el código al estándar sin
preguntar.

- **Backend:** NestJS 11+ con adaptador **Fastify**, arquitectura **hexagonal**
  estricta, principios SOLID, TypeORM, PostgreSQL, Swagger/OpenAPI v3,
  versionado en la URL (`/api/v1`), `@nestjs/config` con validación.
- **Frontend:** Angular 20+, componentes **standalone**, **signals**,
  `ChangeDetectionStrategy.OnPush`, carga perezosa de todas las features,
  presupuestos de tamaño en `angular.json`.
- **Datos:** PostgreSQL con migraciones (`synchronize` **prohibido**), Redis
  para caché, mínimo privilegio.
- **Observabilidad:** `prom-client` en `/metrics`, cuatro señales de oro más
  métricas de negocio.
- **Git:** GitHub Flow; `main` siempre desplegable.

## Reglas que el código hace cumplir

Estas no son convenciones: si se rompen, el lint o la base fallan.

- **Regla de dependencia.** `src/domain/**` no puede importar `@nestjs/*`,
  `typeorm`, `@google-cloud/*`, `fastify` ni `pg`. Lo impide
  `apps/api/eslint.config.mjs`. Si hace falta algo de afuera, se define un
  puerto en `domain/ports` y se implementa en `infrastructure/adapters`.
- **Compuerta ARL.** Vive en el dominio *y* como `CHECK` en la base. Ninguna
  configuración ni rol la omite.
- **Auditoría inmutable.** `auditoria` no admite `UPDATE` ni `DELETE`:
  disparador en el motor más revocación de permisos.
- **`OnPush` obligatorio** en todo componente de Angular.
- **Los catálogos incompletos bloquean los reportes** en `pre` y `prod`. No
  relajar esa comprobación ni declarar un catálogo `completo` sin el archivo
  oficial: el ingestor lo verifica y falla.
- **La cola en proceso está prohibida** en `pre` y `prod`; allí va Cloud Tasks.

## Ambientes y autenticación

Cuatro proyectos separados de Google Cloud: `dev`, `qa`, `pre`, `prod`.

`AUTH_MODO=abierto` habilita el ingreso por selección de perfil **sin
contraseña**, solo para desarrollo local: exige a la vez `SIPRA_AMBIENTE=dev`,
`AUTH_MODO=abierto` y `AUTH_ABIERTO_CONFIRMADO=true`. `AUTH_MODO` y
`SIPRA_AMBIENTE` no tienen valor por defecto. La validación de
`infrastructure/config/configuracion.ts` **rechaza el arranque** en cualquier
otro caso (`qa`, `pre`, `prod`, confirmación o variable ausente). No relajar
esa validación.

El flujo abierto y el OIDC emiten el mismo token: activar Google Workspace no
debe exigir tocar lógica de negocio.

## Convenciones

- Idioma **español (es-CO)** en código, comentarios, UI y mensajes de commit.
  Los identificadores del dominio son en español (`Practica`, `Obligacion`,
  `EstadoDocumento`); las APIs de terceros conservan su nombre original.
- Nomenclatura `feature.type.ts` en `kebab-case`.
- Datos de prueba **sintéticos**. Ningún dato personal real entra en
  desarrollo.
- **Nunca** versionar credenciales. Los secretos van a Secret Manager.

## Antes de dar algo por terminado

```bash
npm run lint              # debe pasar con 0 advertencias
npm test                  # 583 pruebas
npm run test:aislamiento  # condición de despliegue
npm run build
```

La prueba de aislamiento entre empresas es bloqueante en CI y en Cloud Build.
Si una empresa alcanza un solo registro de otra, no se despliega.
