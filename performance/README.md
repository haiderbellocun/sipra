# SIPRA · Performance y pruebas de carga (local)

Pruebas de carga **locales** sobre una base y una API **separadas** (`sipra_performance`, puerto 3100). Responden si el
software mantiene integridad y estabilidad con concurrencia; **no** certifican capacidad de producción (eso se repite
en GCP con los mismos scripts). Datos 100 % sintéticos; nunca se usa `sipra_dev` ni el histórico SGP.

## Estructura

| Ruta | Qué es |
|---|---|
| `herramientas/entorno.sh` | Entorno exclusivo de performance (DB `sipra_performance`, :3100, almacenamiento `apps/api/.almacen-performance`, `LOG_NIVEL=info`, IA simulada, correo por consola, token de métricas efímero). No modifica `.env`. |
| `herramientas/sembrar.ts` | Sembrador idempotente: 2.500 estudiantes, 50 tutores, 5 coordinadores, escuela `ESC-PERF`, periodo `PERF-2026` con cargue abierto, una práctica ACTIVA por estudiante (compuerta ARL cumplida) y sus obligaciones. Se niega fuera de `sipra_performance`. |
| `herramientas/generar-archivos.cjs` | PDF/JPG sintéticos válidos: pequeño 150 KB, medio 2 MB, medio JPG 1,5 MB, límite 9,5 MB, negativo 10,5 MB. |
| `herramientas/preparar-tokens.cjs` | JWT de estudiantes con el modo abierto existente de dev, fuera de la ventana medida. |
| `herramientas/muestrear.cjs` | Muestreo por segundo: PostgreSQL (conexiones, estados, waits, locks, commits/rollbacks/deadlocks), API (`/api/v1/metrics`: CPU, RSS, heap, event loop, GC) y máquina. |
| `herramientas/integridad.cjs` | 201 de k6 ↔ `documentos` ↔ archivo físico (tamaño y SHA-256) ↔ auditoría `documento_cargado`; huérfanos, duplicados, atascados, parciales. Código 1 si algo no cuadra. |
| `herramientas/correr.sh` | Variante LOCAL (P1–P8): muestreo + `docker stats` + k6 en Docker Desktop + integridad. No se usa en las mediciones nuevas. |
| `herramientas/pc-sipra-iniciar.sh`, `pc-sipra-cerrar.sh` | PC SIPRA con generador EXTERNO: comprueba API en 0.0.0.0:3100, rango de estudiantes sin usar, tokens y muestreo; al cerrar, integridad. |
| `herramientas/verificar-rango.cjs` | Garantiza estudiantes/documentos propios por corrida (ninguna práctica del rango con documentos). |
| `herramientas/comparar.cjs` | Tabla ANTES/DESPUÉS de dos corridas con las mismas métricas. |
| `herramientas/ventana.cjs` | Ventana REAL de k6 (`summary.json → ventanaK6`, con el desfase de reloj estimado por la integridad): muestras y picos de PC A y generador SOLO dentro de ella. |
| `herramientas/compuerta.cjs` | Compuerta CONTINUAR/STOP: ventana real, integridad, API sin reinicio, PostgreSQL, k6, generador y margen del PC A. |
| `herramientas/campana.cjs` | Tabla de campaña (P10/P11) en `out/campana-p10.md`. |
| `herramientas/red-generador.ps1` | Precheck de red hacia el generador por la ruta real (Wi‑Fi o cable): ARP, API por esa IP y enlace. |
| `generador/correr-escalon.ps1`, `preparar-tokens.ps1` | PC B: verifica el kit, prepara tokens, monitor, k6, verifica `ventanaK6` y empaqueta resultados. |
| `scenarios/10-escalones-upload.js`, `11-sostenida-upload.js` | P10 escalones y P11 sostenida (8 uploads/s): ejecutados. |
| `kit-pc-b/`, `kit-pc-b*.zip` | Kit exportado al PC B (vigente: `kit-pc-b-6000-r3.zip`); ignorado por Git. |
| `generador/correr-externo.ps1`, `monitor-generador.ps1` | PC GENERADOR (Windows): k6 NATIVO + CPU/RAM/red del generador. |
| `herramientas/eco-servidor.cjs`, `scenarios/00-calibracion-generador.js` | Calibración del generador sin SIPRA (P15). |
| `scenarios/01-baseline.js`, `scenarios/03-upload.js` | Implementados y ejecutados (1 y 100 usuarios). |
| `scenarios/02-navigation`, `04-mixed-load`, `05-upload-burst`, `06-stress`, `07-soak` | **Pendientes**: se escriben cuando la compuerta de 100 lo permita. |
| `out/`, `archivos/` | Resultados, tokens y binarios: **ignorados por Git**. |

Tipo documental de la prueba: `carta_aceptacion` (modo «configurado» con IA simulada: sin OCR ni lectura local).

## P9 · Generador externo (procedimiento vigente)

**PC A (SIPRA):** API de performance en `0.0.0.0:3100`, PostgreSQL `localhost:5433`, almacenamiento y muestreo.
**PC B (generador):** k6 **nativo** (sin Docker), la carpeta `performance/` y los archivos sintéticos.

Red: preferir **cable** en ambos equipos. Con Wi-Fi, la calibración (paso 2) dirá si la red es el nuevo cuello.

### Firewall del PC A (PowerShell como administrador)

Solo TCP 3100, solo desde la IP del generador. **Nunca** 5433.

```powershell
New-NetFirewallRule -DisplayName "SIPRA performance 3100 (generador)" -Direction Inbound -Protocol TCP `
  -LocalPort 3100 -RemoteAddress <IP_PC_GENERADOR> -Profile Private,Public -Action Allow
# al terminar las pruebas
Remove-NetFirewallRule -DisplayName "SIPRA performance 3100 (generador)"
```

`-Profile` incluye `Public` porque la red actual del PC A está clasificada como pública. Ojo: hoy existe una regla
heredada «Node.js JavaScript Runtime» que permite TCP/UDP entrante a `node.exe` en **cualquier puerto y desde
cualquier dirección** (perfil público): mientras exista, la API de dev en :3000 también es alcanzable desde la red.
Recomendado deshabilitarla y quedarse solo con la regla mínima: `Disable-NetFirewallRule -DisplayName "Node.js JavaScript Runtime"`.

### Pasos

1. **PC A** — API de performance: `. performance/herramientas/entorno.sh && (cd apps/api && node dist/main.js > ../../performance/out/api-3100.log 2>&1 &)`.
2. **Calibración de red/generador (sin SIPRA)** — PC A: detener la API y levantar el eco en el MISMO puerto:
   `node performance/herramientas/eco-servidor.cjs 3100`. PC B (desde `performance\`):
   `powershell -ExecutionPolicy Bypass -File generador\correr-externo.ps1 -Escenario 00-calibracion-generador -Eco http://<IP_PC_A>:3100 -Corrida 00-calibracion-100-lan -Vus 100`.
   Detener el eco y volver a levantar la API (paso 1).
3. **PC A** — `bash performance/herramientas/pc-sipra-iniciar.sh 03-upload-100-lan 103 100`
   (estudiantes 103–202, sin usar; tokens válidos 8 h). Copiar `performance/out/tokens.json` al PC B (`performance\out\`).
4. **PC B** — `powershell -ExecutionPolicy Bypass -File generador\correr-externo.ps1 -Base http://<IP_PC_A>:3100/api/v1 -Escenario 03-upload -Corrida 03-upload-100-lan -Vus 100 -Offset 0 -Archivo medio`
   (equivale a `k6 run --log-output=file=out\03-upload-100-lan.k6.log -e BASE=... -e VUS=100 -e OFFSET=0 -e ARCHIVO=medio -e CORRIDA=03-upload-100-lan scenarios\03-upload.js`).
5. Copiar del PC B al PC A (`performance/out/`): `<corrida>.k6.log`, `<corrida>.summary.json`, `<corrida>.generador.jsonl`, `<corrida>.generador-resumen.json` (y los mismos de la calibración).
6. **PC A** — `bash performance/herramientas/pc-sipra-cerrar.sh 03-upload-100-lan` (integridad) y
   `node performance/herramientas/comparar.cjs 03-upload-100 03-upload-100-lan`.

### Corrida externa con tokens creados en el PC B (sin copiar tokens)

Kit para el PC B: `performance/kit-pc-b/` (o `kit-pc-b.zip`). Contiene `scenarios/03-upload.js`,
`lib/{config,flujo,resumen}.js`, `archivos/medio.pdf`, `generador/preparar-tokens.ps1`,
`generador/monitor-generador.ps1` y `out/`. Los dos se ignoran en Git.

1. **PC A**: `bash performance/herramientas/pc-sipra-iniciar.sh <corrida> <desde> <cantidad> tokens-remotos`
   (verifica la API y el rango y arranca el muestreo, sin generar tokens).
2. **PC B**, desde la raíz del kit:
   - preparar los tokens: `generador\preparar-tokens.ps1 -Base http://<IP_PC_A>:3100/api/v1 -Desde <desde> -Cantidad <cantidad>`;
   - ejecutar `k6 run ... -e CORRIDA=<corrida> scenarios-upload.js`.
3. **PC A**: `INTEGRIDAD_ESPERADOS=<cantidad> bash performance/herramientas/pc-sipra-cerrar.sh <corrida>` exige exactamente
   `<cantidad>` respuestas 201.

`CORRIDA` es el identificador de la corrida (RUN_ID). Etiqueta las marcas `DOC201` del registro de k6 y da nombre a todos
los archivos de `out/`.

Archivos necesarios en el PC B: `lib/`, `scenarios/`, `generador/`, `archivos/medio.pdf` (o `herramientas/generar-archivos.cjs`
si tiene Node) y `out/tokens.json`. Nada de esto se versiona (`out/`, `archivos/` ignorados).

## P10 · Escalones de capacidad (generador externo)

**Caso**, idéntico al de P9: PDF medio de 2.096.839 bytes, `carta_aceptacion`, sin OCR, una carga por estudiante distinto.

**Escenario `scenarios/10-escalones-upload.js`.** Llegada en rampa (`ramping-arrival-rate`, modelo abierto), no en ráfaga.

- **Perfil**, igual en todos los escalones; solo escala la tasa:
  - rampa lineal de 0 a P en **120 s**;
  - meseta en P durante **120 s**;
  - cola de **30 s** solo para absorber el redondeo.
- **Tasa:** P = ⌈UPLOADS/3⌉ llegadas por minuto. Por ejemplo, 250 → 84/min y 2000 → 667/min (11,1/s, unos 22 MB/s a
  máxima tasa).
- **Duración total:** unos 270 s más el drenaje.
- **Cargues exactos:** siempre UPLOADS. Las iteraciones posteriores a la UPLOADS-ésima no hacen ninguna petición.
- **VUs:** 200 preasignados (o UPLOADS si es menor) y un máximo de UPLOADS. Si SIPRA se degrada, la concurrencia sube sola
  (tasa × latencia). Si faltan VUs, k6 cuenta `dropped_iterations`.
- **Ancho de banda:** con 2000, la máxima tasa queda en la mitad de la entrada medida en P9 (39,7 MB/s). Así la prueba
  mide SIPRA y no solo la red.
- **PDF:** se abre con `k6/experimental/fs`, una sola copia para todos los VUs.
- `SECO=1` lee el PDF sin enviar peticiones; sirve para validar el generador.

**Rangos de estudiantes.** Del 1 al 202 ya se usaron. Cada rango se verifica con `practicasConDocumentos = 0`:

| Escalón | Corrida | Estudiantes | Estado |
|---|---|---|---|
| 250 | `external-250-001` | 203–452 | disponible |
| 500 | `external-500-001` | 453–952 | disponible |
| 1000 | `external-1000-001` | 953–1952 | disponible |
| 1500 | `external-1500-001` | — | **bloqueado**: solo quedan 548 limpios (1953–2500) |
| 2000 | `external-2000-001` | — | **bloqueado** |

Para 1500 y 2000 hay que decidir entre ampliar el dataset y reutilizar prácticas. Reutilizarlas no es el mismo caso,
porque crea la versión 2 del documento.

**Por escalón** (sin encadenar automáticamente):

1. **PC A:** `bash performance/herramientas/pc-sipra-iniciar.sh <corrida> <desde> <n> tokens-remotos`. Verifica la API y
   el rango, guarda el PID de la API y arranca el muestreo.
2. **PC B:** `generador\correr-escalon.ps1 -Base http://<IP_PC_A>:3100/api/v1 -Corrida <corrida> -Uploads <n> -Desde <desde>`.
   Prepara los tokens, espera a que el monitor tenga 2 muestras, corre k6, borra los tokens y deja
   `out\<corrida>.resultados.zip`.
3. Copiar el zip al PC A y descomprimirlo en `performance/out/`.
4. **PC A:** `INTEGRIDAD_ESPERADOS=<n> bash performance/herramientas/pc-sipra-cerrar.sh <corrida>`. Corre la integridad y
   la **compuerta** (`compuerta.cjs`):
   - integridad OK con n respuestas 201;
   - API viva y sin reinicio (mismo PID);
   - PostgreSQL sin deadlocks ni errores;
   - k6 sin fallos ni iteraciones perdidas;
   - generador medido y no saturado: CPU por debajo del 90 % y al menos 1 GB libre.

   Un código distinto de 0 es **STOP**: no se pasa al siguiente escalón.
5. Al final: `node performance/herramientas/campana.cjs external-250-001 external-500-001 ...` escribe
   `out/campana-p10.md`.

## P11 · Carga sostenida grande (3.000 y luego 6.000) — **APROBADA** (ver «Cierre de P11» al final de esta sección)

**Dataset.** `sipra_performance` tiene **13.000** estudiantes sintéticos, con 13.000 prácticas activas y 52.000
obligaciones. Se sembró con `PERF_ESTUDIANTES=10000` y luego `PERF_ESTUDIANTES=13000` en `sembrar.ts`, que es
idempotente y se niega a correr fuera de `sipra_performance`.

| Uso | Estudiantes |
|---|---|
| Ya usados (P3–P10) | 1–452 |
| `external-3000-001` / `-002` | 453–3452 (usados por `-002`) |
| `external-3000-003` (repetición limpia por Wi‑Fi, compuerta CONTINUAR) | 3453–6452 |
| `external-6000-001` (dataset ampliado a 13.000 con `PERF_ESTUDIANTES=13000`) | 6453–12452 |
| Reserva | 12453–13000 |

**Escenario `scenarios/11-sostenida-upload.js`.** Usa el mismo caso que P9/P10, pero la tasa tiene un **tope** y no
escala con N:

- **Perfil:** rampa lineal de 0 a 8 uploads/s en 240 s, meseta a 8/s hasta completar exactamente N y cola de 30 s para
  el redondeo.
- **Duración:** 3.000 → 255 s de meseta (≈ 525 s en total); 6.000 → 630 s de meseta (≈ 900 s).
- **Red:** 8/s son ≈ 16,8 MB/s, alrededor del 42 % de los 39,7 MB/s medidos.
- **VUs:** 100 preasignados y un máximo de 600. Con 8/s eso equivale a tolerar unos 75 s de latencia. Si no hay VUs,
  k6 cuenta `dropped_iterations` y la compuerta da STOP.
- **Ajustes:** `-e TASA` (de 1 a 10) y `-e MAX_VUS`.

**Pasos para 3.000** (STOP ante cualquier compuerta en falla; **no** encadenar 6.000):

1. **PC A:** `bash performance/herramientas/pc-sipra-iniciar.sh external-3000-001 453 3000 tokens-remotos`. Además del
   rango, exige disco libre ≥ 1,5 × N × 2 MB + 5 GB y RAM libre ≥ 1 GB, y lo guarda en `<corrida>.precheck.json`.
2. **PC B:** `generador\correr-escalon.ps1 -Escenario 11-sostenida-upload -Base http://<IP_PC_A>:3100/api/v1 -Corrida external-3000-001 -Uploads 3000 -Desde 453`.
3. Descomprimir `out\external-3000-001.resultados.zip` en `performance/out/` del PC A.
4. **PC A:** `INTEGRIDAD_ESPERADOS=3000 COMPUERTA_DISCO_MIN_GB=23 bash performance/herramientas/pc-sipra-cerrar.sh external-3000-001`.
   El mínimo de 23 GB es lo que 6.000 necesitaría después.
   - Al final, además de las cinco compuertas de P10, se exige disco ≥ `COMPUERTA_DISCO_MIN_GB`, RAM libre mínima ≥ 512 MB
     y que las muestras del PC A cubran el 90 % de la corrida.
   - La paginación de Windows (`paginasSeg`) se reporta, pero no detiene por sí sola.
5. `node performance/herramientas/campana.cjs external-250-001 external-3000-001`.

**Repetición `external-3000-003` (estudiantes 3453–6452).** `external-3000-002` (453–3452) no saturó SIPRA, pero tuvo
2 timeouts de transporte. Se planeó repetir por Ethernet, pero el Ethernet de ambos equipos negocia 100 Mbps (cuello a
8 uploads/s ≈ 141 Mbps), así que `-003` corrió por Wi‑Fi y pasó sin errores. Antes de repetirla se corrigió el tooling:

- **Nombre de corrida único.** `pc-sipra-iniciar.sh` se niega, antes de escribir nada, si ya existe cualquier
  `performance/out/<corrida>.*`, y lista esos archivos. El pre-check solo se guarda si pasa.
- **Ventana real de k6** (`herramientas/ventana.cjs`). `lib/resumen.js` guarda `ventanaK6 {inicio, fin}` en el
  `summary.json` (reloj del PC B). La integridad estima el desfase de reloj PC B − PC A comparando las marcas `DOC201`
  con `cargado_en` (`integridad.json → reloj`). La compuerta y `campana.cjs` calculan cobertura, CPU, RAM, red, event
  loop, paginación, PostgreSQL, GC, disco y generador **solo** con las muestras dentro de esa ventana. Las de antes y
  después siguen en los `.jsonl` para diagnóstico. Para corridas anteriores, la ventana se aproxima con la última línea
  del `k6.log` menos la duración. Sin ventana, la compuerta da STOP.
- **Calentamiento del event loop.** prom-client guarda el máximo desde la lectura anterior de `/metrics`. Por eso
  `muestrear.cjs` hace una lectura de calentamiento antes de la primera muestra y registra el valor descartado en
  `muestras-resumen.json → calentamiento`. Además, `ventana.cjs` excluye siempre la primera muestra del archivo del pico
  de event loop. Toda muestra posterior al inicio de k6 cuenta.
- `PERF_OUT=<carpeta>` (en integridad, muestreo, ventana, compuerta y campaña) permite probar sobre **copias** sin
  escribir en `performance/out/`.

**Preparación de `external-6000-001` (6453–12452, 8/s, 600 VUs máx.).**

- **Kit nuevo.** `external-3000-003.summary.json` salió **sin** `ventanaK6` porque el PC B ejecutó un `lib\resumen.js`
  anterior (el kit se actualizó por archivos sueltos). El kit vigente es `kit-pc-b-6000-r3.zip` y debe descomprimirse
  **completo en una carpeta nueva**. `correr-escalon.ps1` se niega a correr si `lib\resumen.js` no escribe `ventanaK6`,
  la verifica en `-Seco` y la vuelve a verificar al terminar k6.
- **Compuerta.** Exige la ventana **real**: sin `ventanaK6` da STOP en `ventana-k6`. La aproximada solo se acepta con
  `COMPUERTA_VENTANA_APROXIMADA=1`, para reevaluar corridas anteriores (≤ `external-3000-003`).
- **`pc-sipra-iniciar.sh` además** (`GENERADOR_IP=<IP PC B> [RED_INTERFAZ=<alias>] bash … <corrida> <desde> <cantidad> tokens-remotos`):
  - exige PostgreSQL solo en localhost, ningún `muestrear.cjs` vivo y la suspensión en CA en 0
    (`powercfg /change standby-timeout-ac 0`);
  - **red sin asumir Ethernet** (`herramientas/red-generador.ps1`). La interfaz es la de la ruta real hacia el
    generador (`Find-NetRoute`). Se exige:
    - si se da `RED_INTERFAZ`, que coincida con la de la ruta;
    - que la interfaz esté Up y que el generador sea alcanzable (ARP);
    - que la API responda por esa IP;
    - en Ethernet, enlace ≥ `RED_MIN_MBPS` (200 por defecto; 8 uploads/s ≈ 141 Mbps).

    En Wi‑Fi la velocidad se informa como mínimo y máximo de 5 lecturas. El ping solo se informa, porque el PC B
    bloquea el eco ICMP entrante. Aquí el Ethernet de ambos equipos negocia 100 Mbps, así que **se usa Wi‑Fi**, igual
    que en `external-3000-003` (PC A `192.168.78.119` ↔ PC B `192.168.78.191`). La interfaz usada queda en
    `<corrida>.precheck.json → red`;
  - calcula el disco con el consumo medido de 2,1 MB por upload: 6.000 → 1,5 × 12.600 + 5.120 = 24.020 MB.

### Cierre de P11 (26 de noviembre de 2026): APROBADA

**Objetivo.** Comprobar que SIPRA mantiene integridad completa y estabilidad bajo una carga de upload **sostenida**:
mismo caso que P9/P10 durante más tiempo y con más volumen, sin subir la presión.

**Metodología.**

- **Generador externo:** PC B con k6 nativo v2.4.0 contra el PC A (API de performance en `:3100`, base
  `sipra_performance`, PostgreSQL 18 local).
- **Escenario:** `11-sostenida-upload`, modelo abierto (`ramping-arrival-rate`). Rampa de 0 a 8 uploads/s en 240 s,
  meseta a 8/s y cola de 30 s; 100 VUs preasignados y 600 como máximo.
- **Carga por upload:** cada upload es de un estudiante distinto (rango virgen por corrida), con el mismo PDF sintético
  de 2.096.839 bytes, tipo `carta_aceptacion`, sin OCR e IA simulada. Antes de cada upload se consulta el expediente y
  después se verifica.
- **Mediciones:**
  - PC A: API, PostgreSQL, CPU, RAM, red, disco y paginación, por segundo;
  - PC B: CPU y RAM de k6 y red, por segundo;
  - integridad completa al cerrar: 201 ↔ fila ↔ archivo (tamaño y SHA-256) ↔ auditoría.
- **Compuerta (6 + ventana):** integridad, API sin reinicio, PostgreSQL estable, k6 sin errores ni iteraciones
  perdidas, generador no saturado y PC A con margen, todo dentro de la ventana real de k6.

**Resultados.**

| | `external-3000-003` | `external-6000-001` |
|---|---|---|
| Estudiantes | 3453–6452 | 6453–12452 |
| Uploads OK | 3.000 / 3.000 | 6.000 / 6.000 |
| Peticiones · fallidas · 5xx · iteraciones perdidas | 9.000 · 0 · 0 · 0 | 18.000 · 0 · 0 · 0 |
| Duración · datos enviados | 525 s · 6.005 MB | 900 s · 12.010 MB |
| Upload p50 / p95 / p99 / máx. (ms) | 91,7 / 171,0 / 479,4 / 5.158 | 85,7 / 175,5 / 420,3 / 4.276 |
| API: CPU pico (% de 1 núcleo) · RSS pico | 96,8 % · 337 MB | 49,9 % · 334 MB |
| Event loop p99 / máx. | 33,4 / 102,4 ms | 25,5 / 30,9 ms |
| PostgreSQL: conexiones / activas pico · deadlocks · rollbacks | 7 / 2 · 0 · 0 | 7 / 2 · 0 · 0 |
| PC A: CPU pico · RAM libre mín. · disco consumido | 58,4 % · 2.348 MB · 6.241 MB | 52,5 % · 2.570 MB · 11.953 MB |
| PC B: CPU pico · k6 CPU / RAM pico | 27 % · 5 % / 411 MB | 30 % · 3,8 % / 401 MB |
| Cobertura PC A / generador | 0,99 / 0,94 | 0,99 / 0,99 |
| Ventana de k6 | aproximada (kit anterior) | **real** (`summary.json ventanaK6`) |
| Integridad · compuerta | OK · CONTINUAR | OK · CONTINUAR |

Duplicar el volumen y la duración no degradó las latencias (p95 171 → 175 ms; p99 479 → 420 ms) ni consumió más
memoria. El disco crece de forma lineal: unos 2 MB por upload.

**Incidente de `external-3000-002` (no vale como resultado).**

- 2.998 de 3.000 uploads; 2 fallaron por `request timeout` a los 120 s (estudiantes 1390 y 2414) y una consulta previa
  se colgó 60 s.
- En los segundos en que empezaron los cuelgues la API estaba sana (event loop ≈ 22 ms, ≤ 1 consulta activa) y el resto
  de uploads tuvo p99 de 267 ms.
- **1390:** el cuerpo nunca terminó de llegar y no persistió nada.
- **2414:** el cuerpo llegó completo a los ~120 s y el servidor lo guardó en ≈ 60 ms, pero k6 ya había cortado; ese es
  el `persistidosSin201 = 1`.
- **Causa:** transporte (conexiones TCP colgadas en la red).
- **Además se detectó:** el muestreo mezclaba muestras previas y posteriores a k6 (cobertura 1,68) y un máximo de event
  loop arrastrado de antes de la corrida (1.730.871,8 ms). Se corrigió el tooling (nombre único, ventana real,
  calentamiento) y se repitió limpio como `external-3000-003`.

**Limitaciones de interpretación.**

- **No representa 6.000 usuarios concurrentes.** Representa 6.000 uploads totales con una presión sostenida objetivo
  de 8 uploads/s durante 15 minutos (PDF ≈ 2,1 MB, ≈ 12 GB enviados). La concurrencia real en vuelo fue baja: unos
  2 uploads por la latencia de ≈ 90 ms.
- **No mide el punto de saturación.** La tasa se mantuvo fija a propósito; no se sabe cuánto más aguanta.
- **Una sola instancia** en un portátil Windows, con red Wi‑Fi de oficina y almacenamiento en disco local.
- **No cubre lo que usa producción:** cola en proceso (en `pre`/`prod` va Cloud Tasks), IA simulada y sin OCR,
  `AUTH_MODO=abierto`, Cloud Storage, Cloud SQL ni `max-instances`. El mismo PDF en todos los uploads activa la bandera
  `C0_HASH_DUPLICADO`: el camino de análisis no es el de documentos reales y distintos.
- Ninguna cifra es un SLA. Hay que repetirlo en `qa` con la infraestructura real (pendiente P-16).

**Conclusión.** P11 queda **APROBADA**. A 8 uploads/s sostenidos, SIPRA procesó 6.000 uploads durante 15 minutos sin un
solo error, con integridad completa (6.000 filas, archivos y auditorías, sin huérfanos, duplicados ni escrituras
parciales). La API no se reinició, PostgreSQL no tuvo deadlocks ni rollbacks y ni el PC A ni el generador llegaron cerca
de su límite. `sipra_performance` se conserva tal cual (no se limpia todavía).

**Evidencias** (en `performance/out/`, ignoradas por Git, no se borran) de `external-3000-003` y `external-6000-001`:
`summary.json`, `k6.log`, `generador.jsonl`, `generador-resumen.json`, `muestras.jsonl`, `muestras-resumen.json`,
`integridad.json`, `compuerta.json`, `precheck.json` y `resultados.zip`. También las de `external-3000-002`, como
evidencia del incidente.

### Siguiente fase propuesta (P12, separada, NO ejecutada): saturación por tasa y concurrencia

P11 respondió «¿se mantiene estable a 8/s durante mucho tiempo?». P12 debe responder **«¿dónde empieza a degradarse?»**
subiendo la **presión**, no el número total de uploads.

- **Escalera de tasa** (modelo abierto, mismo PDF y tipo): escalones de 5 min a 8 → 12 → 16 → 20 → 24 uploads/s…, con
  2 min de recuperación entre escalones, cada uno con su propio rango virgen. Volumen por escalón: tasa × 300 s (la
  reserva de 548 no alcanza: hay que sembrar más estudiantes antes).
- **Escalones de concurrencia** (modelo cerrado, como contraste): 25 → 50 → 100 → 200 VUs en paralelo durante 3 min.
- **Burst corto:** N uploads simultáneos (100, 250, 500) con un tiempo de espera definido; integridad completa después.
- **Criterio de saturación:** un escalón está «saturado» cuando ocurre cualquiera de estas cosas:
  - el p95 del upload supera 3× el de 8/s;
  - aparecen `dropped_iterations`, 5xx o timeouts;
  - el event loop p99 pasa de 100 ms;
  - las conexiones activas de PostgreSQL se acercan al pool;
  - la integridad falla.

  Se detiene en el **primer** escalón saturado y se reporta el anterior como capacidad sostenible.
- **Antes de ejecutarla:**
  - **Red:** a 8/s ya se usan ≈ 141 Mbps. Por encima de unos 20 uploads/s el Wi‑Fi y el Ethernet de 100 Mbps de estos
    equipos limitan antes que SIPRA. Hace falta Ethernet gigabit real (cable y puerto que negocien 1 Gbps) o un
    generador en la misma máquina que no mida la red. Si no, se mide la red y no la aplicación.
  - Sembrar el dataset para los rangos de todos los escalones.
  - Disco: ≈ 2 MB por upload.
  - Sincronizar los relojes de PC A y PC B (NTP).
  - Decidir por escrito los umbrales antes de correr.

## Preparación (una vez)

```bash
# desde la raíz del repositorio (Git Bash)
. performance/herramientas/entorno.sh
(cd apps/api && npm run migration:run)
(cd apps/api && TS_NODE_PROJECT=tsconfig.json node -r ts-node/register/transpile-only ../../performance/herramientas/sembrar.ts)
node performance/herramientas/generar-archivos.cjs
(cd apps/api && node dist/main.js > ../../performance/out/api-3100.log 2>&1 &)   # API de performance en :3100
node performance/herramientas/preparar-tokens.cjs 1 102
```

## Corridas

```bash
bash performance/herramientas/correr.sh 01-baseline 01-baseline-1 1 0 medio
bash performance/herramientas/correr.sh 03-upload 03-upload-100 100 1 medio
```

k6 se ejecuta SIEMPRE desde la carpeta `performance/` (`open()` resuelve desde `scenarios/` y los resúmenes van a
`./out/`). `BASE` es obligatoria: los scripts no tienen dirección por defecto.

`OFFSET` es el índice del primer token: cada corrida usa estudiantes **distintos** (sin dos cargues concurrentes sobre
la misma práctica y tipo). El resumen JSON queda en `performance/out/<corrida>.summary.json`.
