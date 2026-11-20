# Auditoría de la fuente histórica de prácticas CUN

> **Alcance:** solo inspección. El Excel no se modificó, no se importó nada a SIPRA, no se crearon tablas
> ni migraciones. Este informe contiene **conteos, patrones y ejemplos enmascarados**: ningún nombre,
> documento, correo ni teléfono real. El archivo fuente vive fuera del repositorio y no debe copiarse a él.
>
> Fecha de la auditoría: 19 de noviembre de 2026 · Herramienta: pandas 2.3.3 + openpyxl 3.1.5 (solo lectura).

## 1. Identificación de la fuente

| Atributo | Valor |
|---|---|
| Archivo | `Reporte Prácticas total.xlsx` (local del usuario, carpeta Descargas) |
| Tamaño | 72.833.641 bytes |
| SHA-256 | `b9e259356328dd280a7532ef8dfd15da90ceb523347673ecaa2cb6ffb1313111` |
| Hojas | 1: `Reporte Prácticas general` |
| Rango declarado de la hoja | `A1:AL1048576` (38 columnas, todas las filas de Excel) |
| Otros componentes | `sharedStrings.xml` (84 MB), `calcChain.xml` (2.562 celdas con fórmula, todas en la columna W) |

## 2. Dimensiones reales y la anomalía de `Nombre Asignatura`

`pd.read_excel(...)` produce **`df.shape == (1046195, 38)`**, no 143.659 filas.

- **143.659** es el número de filas con dato en `#` (y en casi todas las columnas): son los **registros reales**.
- **902.536** filas adicionales no tienen ningún dato salvo, en 902.533 de ellas, la columna L
  (`Nombre Asignatura`) con el literal `'PRÁCTICA NIVEL TÉCNICO '` (con espacio final).

**Causa (verificada en el XML de la hoja, no supuesta):** la celda L se arrastró/rellenó hacia abajo
hasta la fila 1.046.196 de Excel. En `sheet1.xml`, desde la fila 143.662 cada fila es
`<row r="N" spans="12:12"><c r="LN" t="s">…</c></row>`: una única celda en la columna 12 (L).
Las filas 1.046.197 a 1.048.576 existen como filas vacías con formato. Por eso `df.info()` reporta
`Nombre Asignatura 1046192 non-null` (902.533 fantasmas + 143.659 reales) sobre un `RangeIndex` de
1.046.195 entradas. Ninguna otra columna tiene datos en esas filas.

**Además, 3 registros están truncados:** las filas de datos con índice 66420, 74269 y 85392 (filas de
Excel 66.422, 74.271 y 85.394) terminan en la columna R (`Nit Empresa`) y les sigue una fila
completamente vacía. Les faltan empresa, fechas, documentos, bitácora, movimientos y pensum. Son las
3 filas que explican los conteos de 143.656 en las columnas finales.

**Regla para cualquier lector futuro:** una fila es real si y solo si `#` no es nulo. Nunca contar filas
de la hoja.

## 3. Granularidad: qué es una fila

**Una fila = un registro de inscripción a la asignatura de práctica en la plataforma de prácticas**
(un *caso* de práctica: estudiante + asignatura de nivel + periodo de inscripción + escenario), incluidos
los anulados y las reinscripciones. Evidencia:

| Hecho | Dato |
|---|---|
| `#` es único, entero, sin nulos | 143.659 valores distintos, rango 1.450–169.180 (24.072 huecos: registros borrados o no exportados) |
| `#` es el id secuencial del sistema origen | correlación de rangos `#` ↔ `Fecha Creación` = **1,0000** |
| Un estudiante tiene varias filas | 68.435 documentos; media 2,1 filas, mediana 2, máx. 63 |
| No es una fila por estudiante + periodo | 15.128 grupos `Documento + Periodo` repetidos (33.995 filas) |
| Tampoco estudiante + periodo + asignatura | 15.020 grupos repetidos; sus estados son casi siempre `Anulado` + otro (`Anulado/Cerrado` 8.976 grupos, `Anulado/Reprueba` 1.472, `Anulado/Anulado` 1.154) |
| Cada estudiante cursa hasta 3 niveles | personas con 1 nivel: 40.538 · 2 niveles: 15.865 · 3 niveles: 12.032 |
| Repetición por nivel | `Documento + Nombre Asignatura`: 24.704 grupos repetidos; combinaciones típicas `Anulado/Cerrado` (13.978), `Cerrado/Reprueba` (4.530) |
| Doble cierre del mismo nivel | solo 109 pares persona+nivel tienen más de un `Cerrado` |

Conclusión: la **clave natural del origen es `#`**. `Documento` no es clave (ni sola ni combinada): un
estudiante aparece por cada nivel (técnico, tecnológico, profesional), por cada reprobación y por cada
anulación. El número de filas **no** es el número de prácticas.

### Estimación de prácticas

| Medida | Valor |
|---|---|
| Registros (filas reales) | 143.659 |
| Estudiantes distintos (por documento) | 68.435 |
| Registros no anulados (intentos efectivos) | 116.458 |
| Procesos estudiante + nivel distintos | 108.364 |
| Registros `Cerrado` (práctica culminada) | 91.656 |
| Registros activos al corte (`Inscrito` + `En Práctica`) | 7.405 |

## 4. Perfil de columnas

Nulos y cardinalidad sobre las 143.659 filas reales (tipos tal como los entrega pandas).

| Columna | Nulos | Distintos | Tipos observados | Nota |
|---|---:|---:|---|---|
| `#` | 0 | 143.659 | float | id del origen |
| Documento | 0 | 68.435 | float | **identificador: tratar como texto** (§6) |
| Nombre Estudiante | 0 | 68.394 | str | PII |
| Email Estudiante | 0 | 68.416 | str | PII; 100 % dominio institucional; 19 correos con más de un documento |
| Telefono Estudiante | 6.574 | 61.022 | int / str | PII; 6.953 con caracteres no numéricos |
| Programa | 2 | 19 | str | §9 |
| Regional | 0 | 18 | str | §9 |
| Nivel Formación | 82.759 | 3 | str | **57,6 % nulo**, ver §9 |
| Semestre Segun Creditos | 23.398 | 10 | float | nulo casi total antes de 2022 |
| Modalidad | 72 | 3 | str | §11 |
| Codigo Asignatura | 0 | 66 | int / str | mezcla de tipos; un valor con tabulador (`'14132\t'`) |
| Nombre Asignatura | 0 | 3 | str | nivel de la práctica |
| Estado Práctica | 0 | 5 | str | §12 |
| Periodo Inscripción Asignatura | 0 | 79 | str | §10 |
| Modalidad Práctica | 0 | 15 | str | §11 |
| Nombre Docente | 0 | 556 | str | PII |
| Documento Docente | 159 | 545 | float | texto; §14 |
| Nit Empresa | 2 | 46.300 | int / str | §13 |
| Nombre Empresa | 17 | 83.550 | str / int / datetime | §13 |
| Cargo Estudiante | 45 | 54.316 | str / int | texto libre |
| Horario | 269 | 50.190 | str / datetime / time / int / float / timedelta | texto libre que Excel convirtió parcialmente en fechas y horas |
| Salario | 27 | 14.310 | int / str | §17 |
| Funciones Relevantes | 2.608 | 132.250 | str / int | texto libre; puede contener PII; 1.844 empiezan por `-` (origen de las 2.562 fórmulas de `calcChain`; ninguna celda quedó en error) |
| Área | 3 | 22 | str | catálogo cerrado (§9) |
| Cargo / Nombre / Email / Teléfono Jefe | 10–288 | 48 k–106 k | mixtos | **PII de terceros**; 90 correos sin `@` |
| Ciudad | 21 | 10.439 | str / int | §18 |
| Fecha inicio Práctica | 3 | 4.064 | datetime / str | §15 |
| Fecha Finalización Práctica | 6 | 2.953 | datetime / str | §15 |
| Documentos Subidos / Aprobados | 3 | 35 / 34 | float | **proporciones 0–1, no conteos** (§16) |
| Registros Bitacora | 3 | 69 | float | §16 |
| Fecha Creación | 3 | 2.351 | datetime | solo fecha (3 con hora) |
| Ultimo movimiento Estudiante / Docente | 3 | ~142.900 | datetime | fecha y hora |
| Pensum | 3 | 112 | int / str | §9 |

Filas idénticas en todas las columnas salvo `#`: **148 filas** (116 sobrantes), todas en estado `Anulado`.

## 5. Duplicados (solo reporte, nada eliminado)

| Combinación | Grupos con >1 fila | Filas involucradas | Máx. por grupo |
|---|---:|---:|---:|
| Documento | 37.162 | 112.386 | 63 |
| Documento + Periodo | 15.128 | 33.995 | 63 |
| Documento + Periodo + Código Asignatura | 15.020 | 33.748 | 63 |
| Documento + Periodo + Nombre Asignatura | 15.036 | 33.784 | 63 |
| Documento + Periodo + Modalidad Práctica | 11.192 | 25.023 | 63 |
| Documento + Fecha inicio + Fecha fin | 6.209 | 14.029 | 62 |
| Documento + Nombre Asignatura | 24.704 | 59.999 | 63 |
| Documento + Código Asignatura | 24.292 | 58.586 | 63 |
| Documento + Periodo + Asignatura + Estado | 4.091 | 9.369 | 62 |
| Documento + Periodo + Código + NIT | 11.719 | 25.995 | 63 |
| Documento + Periodo + Código + Fecha Creación | 4.484 | 10.147 | 63 |
| Documento + Fecha Creación | 4.569 | 10.336 | 63 |
| Todas las columnas menos `#` | — | 148 | — |

Caso extremo: un mismo estudiante con 63 registros en un único periodo y una única fecha de creación
(62 `Anulado` + 1 `Cerrado`): ráfaga de creación repetida en el sistema origen, no 63 prácticas.

Los «duplicados» por clave de negocio son, en su gran mayoría, **historia legítima** (anulación y
reinscripción, reprobación y repetición). Solo las 148 filas idénticas anuladas y las ráfagas como la
anterior son ruido técnico, y aun así se conservan con una marca de observación.

## 6. Identificadores como texto

- `Documento`: 0 valores con decimales; ninguno supera 2^53 (no hay pérdida por `float64` en este
  archivo). Longitudes: 6 díg. 122 · 7 díg. 1.290 · 8 díg. 17.407 · 9 díg. 42 · 10 díg. 124.793 ·
  11 díg. 4 · **15 díg. 1** (atípico, posible error de digitación).
- `Documento Docente`: 0 decimales; longitudes 6–10; 159 nulos (todos de un mismo nombre de docente).
- **Normalización recomendada** (para la fase de importación): leer estas columnas con
  `dtype=str` / `converters` desde el origen, nunca pasar por `float`; si el lector ya entregó `float`,
  convertir con `format(int(v), 'd')` solo tras comprobar `pd.notna(v)` y `v % 1 == 0`. Conservar
  además el texto original. No rellenar con ceros: el origen ya los habría perdido y no hay forma de
  recuperarlos; 122 documentos de 6 dígitos podrían ser casos así, se marcan como observación.

## 7. NIT de la empresa

`Nit Empresa` es un identificador textual con formatos heterogéneos:

| Forma | Filas |
|---|---:|
| entero de 10 dígitos (casi siempre NIT de 9 + dígito de verificación pegado) | 123.258 |
| entero de 9 dígitos (NIT sin DV) | 6.002 |
| entero de 11 dígitos (cédula + DV: persona natural) | 4.571 |
| texto con puntos (`9.999.999-9`, `99.999.999.9`, …) | ≈ 8.400 |
| entero de 8 dígitos | 813 |
| entero de 12 dígitos | 415 |
| texto que empieza con tabulador | ≈ 450 |
| texto con guion | 111 |
| texto con letras (`TIN:`, `RUT`, sufijos de letra, identificadores extranjeros) | 65 |
| 1 a 7 dígitos (basura o NIT incompleto) | ≈ 95 |
| valores triviales (`0`, `123`, `123456789`, …) | 43 |
| nulos | 2 |

- 46.291 NIT distintos en texto crudo; 44.722 tras dejar solo dígitos.
- 122.233 valores de 10 dígitos empiezan por 8 o 9 (patrón de NIT jurídico + DV).
- Los NIT de 11 dígitos se concentran en `PASANTÍA`, `VALIDACIÓN DE LA EXPERIENCIA LABORAL` y
  `EMPRENDIMIENTO CUNBRE`: son **personas naturales** y por tanto el NIT es PII.

**No normalizar destructivamente.** Propuesta: guardar `nit_original` (texto exacto), `nit_digitos`
(solo dígitos) y, después, `nit_base` + `nit_dv` con validación del dígito de verificación de la DIAN
(algoritmo módulo 11): si los últimos dígitos validan como DV se separan; si no, se marca observación.

## 8. Periodos

79 valores distintos, **siete esquemas** que conviven:

| Esquema | Ejemplo | Filas | Lectura probable | Años |
|---|---|---:|---|---|
| `AAAAA` / `AAAAB` | `2022A`, `2024B` | 33.752 / 25.325 | semestral (presencial y a distancia) | 2020–2026 / 2020–2024 |
| `AAAAC` | `2025C`, `2026C` | 4.452 | segundo semestre desde 2025 (reemplaza a `B`) | 2025–2026 |
| `AAAAI` | `2023I` | 48 | intersemestral | 2020–2024 |
| `AAVNN` | `23V04` | 72.467 | bloques virtuales, 6 por año (`V01`–`V06`) | 2020–2026 |
| `AAPNN` | `25P03` | 7.606 | bloques de 6 por año desde 2024 (mayoría virtual) | 2024–2026 |
| `AATNN` | `22T01` | 9 | esquema residual | 2021–2022 |

- `2025B` solo tiene 33 filas: el cambio de `B` a `C` ocurre en 2025.
- El último periodo con datos es `26V04` / `26P04` / `2026C`.
- **No convertir automáticamente** al modelo de periodos actual: guardar `periodo_original` y derivar
  (`esquema`, `anio`, `ordinal`) solo como columnas auxiliares; la correspondencia a periodos SIPRA la
  define después una tabla de equivalencias aprobada por la institución.

## 9. Estados

| Valor | Filas |
|---|---:|
| `Cerrado` | 91.656 |
| `Anulado` | 27.201 |
| `Reprueba` | 17.397 |
| `Inscrito` | 6.216 |
| `En Práctica` | 1.189 |

Cinco valores limpios, sin variantes ortográficas ni de mayúsculas. `Inscrito` y `En Práctica` existen
solo en registros creados en 2025–2026 (31 + 7.374): son el estado **al corte**, no un estado final.
Al importar, la foto histórica no debe confundirse con el estado vivo de la práctica en SIPRA.
No se mapean a los estados técnicos de SIPRA en esta fase.

## 10. Modalidad vs. Modalidad Práctica

Son **conceptos distintos**:

- **`Modalidad`** = modalidad de estudio del estudiante en el programa:
  `VIRTUAL` 75.505 · `PRESENCIAL` 52.581 · `A DISTANCIA` 15.501 · nulo 72.
  Encaja con el esquema de periodo: los bloques `V`/`P` son casi siempre `VIRTUAL`; los semestres
  `A`/`B`/`C`, `PRESENCIAL` o `A DISTANCIA`.
- **`Modalidad Práctica`** = escenario o figura de la práctica (15 valores):

| Valor | Filas |
|---|---:|
| VALIDACIÓN DE LA EXPERIENCIA LABORAL | 81.462 |
| PASANTÍA | 30.847 |
| CONTRATO DE APRENDIZAJE | 10.570 |
| COMBINACIÓN DE FUNCIONES | 10.081 |
| PRÁCTICA TÉCNICA EN INVESTIGACIÓN | 2.291 |
| PRÁCTICA INVESTIGATIVA | 1.664 |
| EMPRENDIMIENTO CUNBRE - NACIENTE | 1.360 |
| PROYECCIÓN SOCIAL | 1.294 |
| MONITORÍA | 1.239 |
| ASESORÍA Y ASISTENCIA TÉCNICA | 1.235 |
| EMPRENDIMIENTO CUNBRE - CONSOLIDADO | 974 |
| EMPRESA PROPIA | 424 |
| ESTADO JOVEN PASANTÍAS | 100 |
| PASANTÍA INTERNACIONAL | 90 |
| PASANTÍA INVESTIGATIVA | 28 |

Todas las modalidades de práctica aparecen en las tres modalidades de estudio.

## 11. Programas, niveles, pensum, regionales

- **Programas:** 19 valores, 2 nulos. Concentración: Administración de Empresas 46.637 (32 %),
  Ingeniería de Sistemas 24.489, Contaduría Pública 17.542, Ingeniería Industrial 13.720.
  Variaciones a revisar (no corregidas): acentuación inconsistente (`INGENIERIA INDUSTRIAL`,
  `GESTION SOCIAL Y SALUD COMUNITARIA` sin tilde frente al resto con tilde) y
  `DISEÑO DE MODA Y PATRONAJE` (3 filas) junto a `DISEÑO DE MODAS` (2.529): posible renombramiento.
  No hay duplicados por espacios dentro de `Programa`.
- **Nivel Formación:** `Profesional` 23.992 · `Tecnologo` (sin tilde) 18.835 · `Técnico` 18.073 ·
  **nulo 82.759**. La proporción de nulos crece con los años (19 % en 2021 → 82 % en 2026), luego no
  es un dato confiable. El nivel real se deduce de `Nombre Asignatura`, que nunca es nulo:
  `PRÁCTICA NIVEL TÉCNICO ` 58.566 · `PRACTICA NIVEL PROFESIONAL UNIVERSITARIO` 45.876 ·
  `PRACTICA NIVEL TECNOLÓGICO` 39.217 (tildes y espacio final inconsistentes). Cuando ambos existen
  coinciden en el 99,9 % de los casos (60.848 de 60.900).
- **Semestre Segun Creditos:** 1–10; nulo en 97 % de 2020 y 85 % de 2021, completo desde 2022.
- **Pensum:** 112 códigos; mezcla de enteros (`1037`) y texto con sufijo (`1072N`, `5015D`, `1044V`,
  `VG001`, `VTG12`). Los sufijos `N`/`D` parecen jornada y `V`/`VG`/`VTG` virtual (por confirmar).
  Ingeniería de Sistemas tiene 20 pensums distintos. Guardar siempre como texto.
- **Código Asignatura:** 66 valores (int y str mezclados; uno con tabulador); 5 códigos aparecen con
  más de un `Nombre Asignatura`.
- **Regionales:** 18 valores. Bogotá concentra 121.645 filas (84,7 %). Variaciones:
  `'REGIONAL VALLE DEL CAUCA '` con espacio final, `REGIONAL ATLÁNTICO` (1 fila, la única con tilde)
  junto a `REGIONAL COSTA CARIBE`, `REGIONAL NARINO` sin eñe. Administración de Empresas está en 18
  regionales; Bogotá ofrece 16 programas.
- **Área:** 22 valores de un catálogo cerrado (varios con espacio final); 3 nulos.
- 267 estudiantes aparecen con más de un programa y 975 con más de una regional.

## 12. Empresas (organizaciones receptoras históricas)

| Medida | Valor |
|---|---:|
| NIT distintos (crudo / solo dígitos) | 46.291 / 44.722 |
| Nombres distintos (crudo) | 79.457 (83.550 contando tipos mixtos) |
| Nombres distintos tras normalizar (mayúsculas, sin tildes, sin puntuación ni razón social) | 52.793 |
| NIT con más de un nombre normalizado | 7.927 (máx. 484 nombres en un mismo NIT) |
| Nombres normalizados con más de un NIT | 5.323 (máx. 60) |
| Filas sin nombre de empresa / sin NIT | 17 / 2 |
| Nombres genéricos (`ALCALDIA`, `POLICIA NACIONAL`, `CUN`, `OUTSOURCING`, `NAN`) | presentes con decenas de NIT cada uno |

- El NIT más frecuente (`860***49`, 7.262 filas) es la propia CUN: prácticas internas
  (investigación, monitoría, proyección social, emprendimiento). Un segundo NIT de la CUN
  (`860***39`) suma 371.
- Entidades públicas con un solo nombre genérico (`POLICIA NACIONAL`, `ALCALDIA MUNICIPAL`,
  `EJERCITO NACIONAL`) aparecen con decenas de NIT distintos: el nombre **no** sirve como clave.
- Conclusión: la clave de consolidación es el **NIT base** (sin DV, validado); el nombre es solo un
  atributo con variantes.

## 13. Docentes

- 556 nombres, 545 documentos; 159 filas sin documento (todas de un único nombre).
- Ningún nombre está asociado a más de un documento; **10 documentos** tienen más de un nombre
  (variantes de escritura). Normalizando tildes los 556 nombres bajan a 555.
- Carga por docente: mediana 93 registros, máximo 2.606.
- Docentes activos por año de creación: 149 (2020) · 182 (2021) · 267 (2022) · 251 (2023) ·
  211 (2024) · 75 (2025) · 140 (2026).

## 14. Ciudades

- 10.439 valores crudos → 5.877 tras mayúsculas y recorte → 3.478 sin tildes ni puntuación.
- **Bogotá: 543 variantes** (`Bogotá`, `Bogota`, `BOGOTA`, `bogota`, `Bogotá D.C`, `Bogotá D.C.`,
  `Bogotá DC`, con y sin espacio final…) que suman 83.349 filas (58 %).
- Lo mismo con Santa Marta, Ibagué, Medellín, Montería, Sincelejo.
- 78 valores numéricos, 105 con más de 40 caracteres y 58 que contienen una dirección.
- Propuesta futura: correspondencia contra DIVIPOLA (DANE) en una tabla de equivalencias revisable;
  sin geocodificar.

## 15. Fechas

| Campo | Mínimo | Máximo | Nulos o no fecha | Observaciones |
|---|---|---|---:|---|
| Fecha inicio Práctica | 1979-07-17 | 2223-03-09 | 198 | 145 `0000-00-00`, 15 `0001-01-01`, años como `0020`, `0202`, `1019`; 792 antes de 2015; 9 posteriores al corte |
| Fecha Finalización Práctica | 1999-02-28 | 2223-05-09 | 13.561 | **13.475 `0000-00-00`** (fecha cero típica de MySQL: el origen probablemente es una base MySQL), 51 `0001-01-01`; 25 después de 2027 |
| Fecha Creación | 2018-10-15 | 2026-09-22 | 3 | rango real del sistema |
| Último movimiento Estudiante | 2019-06-27 | 2026-09-22 | 3 | nunca anterior a la creación |
| Último movimiento Docente | 2019-09-09 | 2026-09-22 | 3 | nunca anterior a la creación |

- **Corte del archivo:** 22 de septiembre de 2026.
- Duración (fin − inicio, fechas válidas, 130.069 casos): p01 27 días · p25 45 · **mediana 72** · p75 148 ·
  p95 302 · p99 466.
- **Fin anterior al inicio: 92** (53 `Cerrado`, 31 `Anulado`, 8 `Reprueba`). Fin igual al inicio: 60.
  Más de 365 días: 1.798; más de 730: 829. Mínimo −7.136 días, máximo 15.340.
- 7.776 registros con fecha de inicio más de un año anterior a la creación: típico de
  `VALIDACIÓN DE LA EXPERIENCIA LABORAL` (la experiencia es anterior a la inscripción), no
  necesariamente error.
- Las fechas imposibles llegan como texto (`str`): pandas no las convirtió. No se corrigió ninguna.

## 16. Calidad documental y bitácora

**`Documentos Subidos` y `Documentos Aprobados` no son conteos: son proporciones de 0 a 1**, redondeadas
a dos decimales (0,17 = 1/6; 0,08 = 1/12; 0,15 = 2/13; 0,23 = 3/13…). El denominador (documentos
exigidos) varía según la modalidad: 6, 11, 12 o 13. El archivo no trae el número absoluto.

- `aprobados ≤ subidos`: **se cumple en el 100 %** (0 excepciones).
- Subidos: 0 en 18.100 registros; 1,0 (todo subido) en 94.336. Aprobados: 0 en 28.411; 1,0 en 91.599.
- Por estado (medias): `Cerrado` 1,00 / 1,00 · `En Práctica` 0,84 / 0,73 · `Reprueba` 0,48 / 0,36 ·
  `Inscrito` 0,46 / 0,09 · `Anulado` 0,29 / 0,19.

**Registros Bitacora** (entero): mín. 0 · p05 0 · p10 1 · p25 3 · **mediana 5** · media 6,31 · p75 9 ·
p90 12 · p95 15 · p99 23 · **máx. 239**; 11.578 en cero. Mediana por estado: `Cerrado` 7,
`En Práctica` 4, `Reprueba` 3, `Anulado` 1, `Inscrito` 0. Varía por modalidad (mediana 1 en pasantía
internacional e investigativa, 7 en contrato de aprendizaje). No se interpreta como cumplimiento.

## 17. Actividad (últimos movimientos)

- Último movimiento del estudiante − creación: mediana 56 días, p95 206, máx. 1.030.
- Último movimiento del docente − del estudiante: mediana 3 días, p25 0, p75 16, p95 129;
  mín. −521 (docente sin movimiento después del estudiante), máx. 1.012.
- 5.721 registros con ambos movimientos idénticos (misma acción registrada para los dos).
- No hay nulos salvo los 3 truncados. No se construye ningún indicador de riesgo.

## 18. Salario

Texto libre capturado sin máscara:

- 140.168 enteros: **0 en 29.673** (prácticas no remuneradas), mediana 1.423.500 (= SMMLV 2025),
  p25 681.394, p95 3.517.000; **mínimo −658.000**; 225 por encima de 20 millones (máx. 9.000.000.000);
  327 entre 1 y 99 (posiblemente «1» = 1 SMMLV o millones abreviados).
- 3.464 textos: 3.113 con puntos de miles (`1.300.000`), varios **truncados al comienzo**
  (`.908.526`, `000.000`, `.681.394`: les falta el primer dígito), apóstrofos y comillas como separador
  (`1´.300.000`), `SMLV`/`SMMLV`/`MÍNIMO` (36), `NO REMUNERADO`, `NO APLICA`, `NINGUNO`, `N`, `USD`,
  `/`, cadenas vacías (154). Ningún `$` ni coma decimal.
- Se reconocen los salarios mínimos de cada año (877.803 de 2020, 908.526 de 2021, 1.160.000 de
  2023, 1.300.000 de 2024, 1.423.500 de 2025).
- **No convertir automáticamente:** guardar `salario_original` y un `salario_valor` solo cuando el
  patrón sea inequívoco, con una marca de calidad (`exacto`, `inferido`, `no_remunerado`,
  `no_interpretable`).

## 19. Datos personales y riesgos

| Dato | Columnas | Riesgo |
|---|---|---|
| Identidad del estudiante | Documento, Nombre, Email, Teléfono | alto |
| Identidad de terceros (jefe inmediato) | Nombre, Cargo, Email, Teléfono del jefe | alto; personas que nunca dieron consentimiento a SIPRA |
| Identidad del docente | Nombre, Documento | medio |
| Persona natural como empresa | NIT de 11 dígitos, Nombre Empresa en emprendimiento/empresa propia | medio |
| Texto libre | Funciones Relevantes, Cargo, Horario, Ciudad (contiene direcciones) | puede contener PII incidental |
| Datos económicos | Salario | sensible en combinación con la identidad |

Controles aplicados en esta auditoría: el Excel no se copió al repositorio; los intermedios de pandas
vivieron solo en la carpeta temporal de la sesión y se borraron al terminar; este informe no contiene
ningún valor personal; los NIT se muestran enmascarados.

Riesgos para la importación: base legal y finalidad del tratamiento histórico (Ley 1581 de 2012),
retención, acceso restringido, y que **ningún** usuario de empresa pueda alcanzar estos datos (la
prueba de aislamiento entre empresas debe cubrir el esquema histórico).

## 20. Modelo histórico propuesto (no creado)

> Primera aproximación. La versión alineada con el dominio actual está en el §25, que prevalece.

Esquema separado **`historico`**, sin claves foráneas hacia `estudiantes`, `practicas`, `usuarios`,
`empresas` ni `obligaciones`. Solo lectura para la aplicación; escritura solo para un rol de carga.

### `historico.importaciones`

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `archivo` | text | nombre original |
| `sha256` | char(64) **UNIQUE** | idempotencia |
| `tamano_bytes` | bigint | |
| `hoja` | text | |
| `filas_hoja` | int | 1.046.195 en esta fuente |
| `cantidad_filas` | int | filas reales (`#` no nulo): 143.659 |
| `cantidad_validas` | int | sin observaciones bloqueantes |
| `cantidad_observadas` | int | con al menos una observación |
| `cantidad_descartadas` | int | fantasmas (902.536) |
| `fecha_corte` | date | 2026-09-22 (máximo de los movimientos) |
| `version` | text | versión del lector/normalizador |
| `estado` | enum | `registrada → perfilada → cargada → validada → publicada`, más `fallida` y `revertida` |
| `fecha_importacion`, `importado_por` | timestamptz, text | |

### `historico.practicas`

Una fila por registro del origen (la granularidad del §3). PII fuera de la tabla analítica.

| Grupo | Campos |
|---|---|
| Trazabilidad | `id`, `importacion_id`, `source_row` (fila de Excel), `id_origen` (`#`), `hash_fila` (SHA-256 del registro normalizado) |
| Estudiante (seudónimo) | `estudiante_clave` = HMAC-SHA256(documento normalizado, secreto en Secret Manager) |
| Académico | `programa_original`, `regional_original`, `nivel_original`, `nivel_practica` (derivado de `Nombre Asignatura`), `semestre_creditos`, `modalidad_estudio`, `codigo_asignatura` (texto), `nombre_asignatura_original`, `pensum` (texto) |
| Periodo | `periodo_original`, `periodo_esquema`, `periodo_anio`, `periodo_ordinal` |
| Práctica | `estado_original`, `modalidad_practica_original`, `area`, `cargo_estudiante` |
| Docente (seudónimo) | `docente_clave` = HMAC(documento docente) |
| Empresa | `nit_original`, `nit_digitos`, `empresa_nombre_original`, `empresa_historica_id` (nullable) |
| Lugar | `ciudad_original`, `ciudad_divipola` (nullable, posterior) |
| Fechas | `fecha_inicio`, `fecha_fin` (date nullable), `fecha_inicio_original`, `fecha_fin_original` (texto), `fecha_creacion`, `ultimo_mov_estudiante`, `ultimo_mov_docente` |
| Economía | `salario_original`, `salario_valor` (nullable), `salario_calidad` |
| Cumplimiento | `docs_subidos_ratio`, `docs_aprobados_ratio` (numeric 0–1, `CHECK aprobados ≤ subidos`), `registros_bitacora` |
| Calidad | `observaciones` text[] (códigos: `FECHA_CERO`, `FIN_ANTES_INICIO`, `REGISTRO_TRUNCADO`, `DUPLICADO_IDENTICO`, `NIT_NO_VALIDO`, `SALARIO_NO_INTERPRETABLE`, `DOCUMENTO_ATIPICO`…), `es_valida` |

Restricción única: `(importacion_id, source_row)` y `(fuente, id_origen, version_registro)`.

### Registro original

Para no perder el dato: **`historico.registros_origen`** (`importacion_id`, `source_row`, `datos jsonb`)
con el registro completo tal como vino, incluida la PII, en una tabla con acceso exclusivo de un rol
de auditoría, cifrada y sujeta a la política de retención; o, como alternativa más conservadora,
dejar el original solo en el archivo archivado (bucket con acceso restringido) referenciado por
`sha256 + source_row`. Decisión institucional pendiente.

### Empresas históricas

- `historico.empresas`: una fila por `nit_base` validado (o por nombre normalizado cuando no hay NIT
  válido), con `nombres_variantes`, primera y última aparición y volumen.
- `historico.correspondencias_organizacion`: `empresa_historica_id ↔ organizacion_sipra_id`, con
  `metodo` (`nit_exacto`, `nit_base`, `nombre_similar`), `confianza` y `estado`
  (`propuesta` / `confirmada` / `rechazada`) decidido por una persona.
- **Nunca** se escribe en las organizaciones actuales de SIPRA; la correspondencia es una tabla aparte.

### Estudiantes históricos

No se crean usuarios ni estudiantes. El vínculo con un estudiante actual, si algún día se necesita, se
hace comparando el mismo HMAC del documento, sin guardar el documento en claro en la capa analítica.

## 21. Estrategia de importación (para la fase siguiente)

1. **Registrar** el archivo: SHA-256 → si ya existe en `historico.importaciones`, terminar sin cambios
   (idempotencia del archivo: reimportar el mismo archivo no duplica las 143.659 filas).
2. **Leer** con identificadores como texto (`dtype=str` para Documento, Documento Docente, NIT,
   Código, Pensum) y conservar los tipos originales para fechas y números.
3. **Recortar** a filas con `#` no nulo; contar las fantasmas como descartadas.
4. **Normalizar** a columnas auxiliares sin tocar el original; asignar observaciones.
5. **Cargar** en una transacción por importación (`COPY` a tabla de preparación y `INSERT … SELECT`);
   143.659 filas cargan en segundos.
6. **Idempotencia por registro:** clave `(fuente, id_origen)`. Un archivo posterior del mismo sistema
   con registros ya conocidos: si `hash_fila` coincide, se ignora; si difiere, se inserta una nueva
   versión del registro (historia), nunca se actualiza en sitio.
7. **Reversión:** borrar por `importacion_id` (solo el rol de carga) y marcar la importación `revertida`.
8. **Validar** conteos contra este informe antes de `publicada`.
9. Todo por migraciones de TypeORM (`synchronize` prohibido), rol de solo lectura para la API y
   cobertura del esquema en `test:aislamiento`.

## 22. Posibilidades para Reportes V3 (no implementado)

Con los datos que el archivo soporta:

- **Evolución de prácticas** 2020–2026 por periodo y año de creación (con la advertencia de los siete
  esquemas de periodo).
- **Programas, niveles y regionales:** volumen, tasa de cierre (`Cerrado` / no anulados), tasa de
  reprobación y anulación.
- **Modalidad de práctica:** mezcla y su evolución (peso creciente de validación de experiencia).
- **Modalidad de estudio:** virtual vs. presencial vs. a distancia.
- **Organizaciones receptoras:** top por NIT base, recurrencia por año, prácticas internas CUN.
- **Ciudades:** solo tras la correspondencia con DIVIPOLA.
- **Docentes:** carga histórica (seudonimizada) y tiempos de respuesta.
- **Cumplimiento documental histórico:** proporciones subido/aprobado por estado, modalidad y periodo.
- **Actividad:** distribución de bitácora y de tiempos entre movimientos del estudiante y del docente.
- **Duración:** fin − inicio por modalidad (excluyendo fechas observadas).

Todo desde PostgreSQL (vistas o materializadas del esquema `historico`), nunca leyendo el Excel.

## 23. Posibilidades futuras de IA (sin entrenar nada)

El dataset tiene variables suficientes para **estudiar**, en una fase futura y con aprobación:

| Uso | Variables disponibles | Limitación |
|---|---|---|
| Probabilidad de finalización | estado final, programa, nivel, modalidades, periodo, regional, docs, bitácora, empresa | `Inscrito`/`En Práctica` son censurados al corte; fuga de información (docs y bitácora son finales, no tempranos) |
| Duración esperada | inicio, fin, modalidad, nivel, programa | 13.475 fines en fecha cero; outliers |
| Riesgo de retraso / inactividad | creación, últimos movimientos, bitácora | solo hay el *último* movimiento, no la serie temporal |
| Patrones empresariales | NIT, área, cargo, salario, ciudad | consolidación de empresas y ciudades previa |

Faltan: serie temporal de eventos, fechas de cada documento, calificación numérica y motivo de
anulación o reprobación. Cualquier modelo sería apoyo a la decisión de una persona, en línea con la
regla de SIPRA de no autoaprobar.

## 24. Resumen de anomalías relevantes

1. 902.536 filas fantasma por una celda rellenada hasta el final de la hoja.
2. 3 registros truncados después de la columna NIT.
3. `Documentos Subidos/Aprobados` son proporciones, no conteos.
4. 13.475 fechas de fin `0000-00-00` y fechas imposibles (años 0001, 0020, 2222).
5. 92 prácticas con fin anterior al inicio.
6. 148 registros idénticos (todos anulados) y una ráfaga de 63 registros de un mismo estudiante.
7. `Nivel Formación` 58 % nulo y en aumento; el nivel fiable está en `Nombre Asignatura`.
8. Siete esquemas de periodo coexistentes y cambio `B → C` en 2025.
9. NIT en una docena de formatos, con personas naturales como empresa.
10. 543 variantes de Bogotá en `Ciudad`.
11. Salario con valores negativos, de miles de millones y textos truncados.
12. Un documento de estudiante de 15 dígitos.

---

## 25. Integración con el dominio actual de Prácticas

> Diseño, no implementación: no se crean esquemas, migraciones ni registros. Esta sección **prevalece
> sobre el §20 y el §21** donde difieran.

### 25.1 Premisa: mismo dominio, distinto modelo transaccional

El Excel es una exportación del **SGP (Sistema de Gestión de Prácticas)**, la plataforma que SIPRA
reemplaza. El dominio ya lo reconoce: `EQUIVALENCIA_SGP` y `ESTADO_OPERATIVO` en
`apps/api/src/domain/entities/practica.entity.ts`, y las 14 modalidades de `modalidad.entity.ts`
documentadas a partir de las 15 del selector del SGP. Los conceptos son los mismos (estudiante,
programa, ciclo, modalidad, organización, tutor, periodo, estado, fechas, vacante); lo que cambia es la
naturaleza del dato. Cada fila es una **foto** del registro SGP al corte del 22 de septiembre de 2026,
no una práctica operativa de SIPRA.

Razones verificadas para no cargar las filas en `public.practicas`:

- `practicas.estudiante_id` es `NOT NULL REFERENCES usuarios`: exigiría crear 68.435 usuarios.
- `ux_practicas_registro_por_periodo` (un registro no anulado por estudiante y periodo): **231 grupos
  del histórico (502 filas) la violan**.
- `ck_practicas_estado` y la compuerta ARL suponen el ciclo técnico de SIPRA (`certificada`,
  `finalizada`, ARL verificada), que el SGP no registra.
- Cumplimiento, distribución docente, expediente, Mesa de validación, carta de presentación y
  métricas operativas leen `practicas`: 143.659 filas falsearían todos ellos.
- `numero_fur` es la identidad propia de SIPRA (empieza en 1) y **se solapa numéricamente** con el
  rango de `#` (1.450–169.180). Nunca se comparan.

### 25.2 Arquitectura objetivo

```
public.practicas  (operación SIPRA) ──┐
                                      ├──► analytics.practicas  (proyección homogénea, solo lectura)
historico.practicas (fotos del SGP) ──┘          ▲
                                                 └── analytics.correspondencia_practica (regla de solapamiento)
```

- `public`: la operación, sin cambios. Ninguna clave foránea entre `historico` y `public`.
- `historico`: cargado solo por un rol de importación. La API **no** lee `historico` directamente.
- `analytics`: vistas o vistas materializadas que unifican columnas y aplican la regla de solapamiento.
  Las consume solo Reportes V3. Cumplimiento, cartas, ARL, documentos, validaciones y bitácora
  **no** leen `historico` ni `analytics`.
- Aislamiento: los roles de empresa no alcanzan ninguno de los dos esquemas.
  `npm run test:aislamiento` debe incluirlos.

### 25.3 Matriz de los 38 campos

Clases: **D** = equivalente directo (mismo campo actual, solo limpieza de tipo); **T** = equivalente
con transformación; **A** = equivalente agregado (SIPRA lo calcula a partir de filas propias, no es
una columna); **S** = sin equivalente en el modelo actual. Columna **M** = importación minimizada
(§25.12): ✓ se conserva, ✗ se excluye, # se conserva solo como clave seudónima.

| # | Campo histórico | Campo actual | Clase | Transformación | Calidad | M | Observación |
|---|---|---|---|---|---|---|---|
| 1 | `#` | — (no es `numero_fur`) | S | `source_record_id` texto | alta | ✓ | clave del SGP; única; nunca se reemplaza por Documento |
| 2 | Documento | `practicas.estudiante_id` → `usuarios.documento` | T | normalizar → `student_key` HMAC | alta | # | 0 nulos; 1 atípico de 15 dígitos |
| 3 | Nombre Estudiante | `usuarios.nombre` | T | — | — | ✗ | PII; no necesaria para analítica |
| 4 | Email Estudiante | `usuarios.correo` | T | — | — | ✗ | PII |
| 5 | Telefono Estudiante | — | S | — | baja | ✗ | PII; SIPRA no guarda teléfono del estudiante |
| 6 | Programa | `practicas.programa_id` (código SINU por programa + ciclo, p. ej. `ADM-PRO`) | T | tabla de equivalencia nombre + ciclo → código SINU, aprobada por persona | media | ✓ | 19 nombres; 2 nulos; tildes inconsistentes |
| 7 | Regional | `practicas.regional` | D | recortar espacios | alta | ✓ | 18 valores, 1 con espacio final |
| 8 | Nivel Formación | `practicas.ciclo` | T | `nivel_original`; ver §25.8 | baja | ✓ | 58 % nulo |
| 9 | Semestre Segun Creditos | — (solo tabla sintética de dev) | S | smallint | media | ✓ | nulo antes de 2022 |
| 10 | Modalidad | — (cercano: `periodos_academicos.calendario`) | S | `modalidad_estudio` | alta | ✓ | no se fusiona con la modalidad de práctica |
| 11 | Codigo Asignatura | — | S | texto, recortar tabulador | alta | ✓ | int/str mezclados |
| 12 | Nombre Asignatura | `practicas.asignatura` | D | recortar | alta | ✓ | fuente fiable del ciclo |
| 13 | Estado Práctica | `practicas.estado` → `EstadoOperativo` | T | equivalencia inversa de `EQUIVALENCIA_SGP` (§25.9) | alta | ✓ | estado **al corte** |
| 14 | Periodo Inscripción Asignatura | `practicas.periodo_academico` | T | parser explícito (§25.10) | alta | ✓ | 99,96 % con formato de código vigente |
| 15 | Modalidad Práctica | `practicas.modalidad` (`ModalidadPractica`) | T | tabla de equivalencia 15 → 14 (§25.11) | alta | ✓ | 1 sin equivalente |
| 16 | Nombre Docente | `usuarios.nombre` (tutor) | T | — | — | ✗ | PII; se resuelve por correspondencia |
| 17 | Documento Docente | `practicas.tutor_id` | T | normalizar → `teacher_key` HMAC | alta | # | 159 nulos |
| 18 | Nit Empresa | `practicas.empresa_nit` (+ `empresa_id` por correspondencia) | D | texto exacto; `nit_digitos`, `nit_base`, `nit_dv` derivados | media | ✓* | *persona natural: solo clave (§25.6) |
| 19 | Nombre Empresa | `practicas.empresa_razon_social` | D | recortar | media | ✓* | *persona natural: no se conserva |
| 20 | Cargo Estudiante | `practicas.cargo` | D | recortar | media | ✓ | texto libre corto |
| 21 | Horario | `practicas.horario` | D | texto; reconstruir valores que Excel convirtió en fecha u hora | baja | ✓ | 6 tipos mezclados |
| 22 | Salario | `practicas.salario` + `tipo_remuneracion` | T | §25.11 | baja | ✓ | negativos, truncados, textos |
| 23 | Funciones Relevantes | `practicas.funciones_relevantes` | D | — | — | ✗ | texto libre con posible PII; solo con aprobación específica |
| 24 | Área | `practicas.area` | D | recortar | alta | ✓ | catálogo de 22 |
| 25 | Cargo Jefe Inmediato | `practicas.jefe_inmediato_cargo` | D | — | — | ✗ | bloque del jefe excluido |
| 26 | Nombre Jefe Inmediato | `practicas.jefe_inmediato_nombre` | D | — | — | ✗ | PII de tercero |
| 27 | Email Jefe Inmediato | `practicas.jefe_inmediato_correo` | D | — | — | ✗ | PII de tercero |
| 28 | Telefono Jefe Inmediato | `practicas.jefe_inmediato_telefono` | D | — | — | ✗ | PII de tercero |
| 29 | Ciudad | `practicas.ciudad` (Reportes usa `empresas.divipola_municipio`) | D | original + `ciudad_divipola` por tabla de equivalencias | baja | ✓ | 543 variantes de Bogotá; 58 direcciones |
| 30 | Fecha inicio Práctica | `practicas.fecha_inicio` | T | original + fecha nullable + marca | media | ✓ | §25.11 |
| 31 | Fecha Finalización Práctica | `practicas.fecha_fin` | T | ídem | baja | ✓ | 13.475 `0000-00-00` |
| 32 | Documentos Subidos | — (agregado de `documentos`) | A | `documentos_subidos_ratio` numeric(3,2) | alta | ✓ | proporción, no conteo |
| 33 | Documentos Aprobados | — (agregado de `documentos`) | A | `documentos_aprobados_ratio` | alta | ✓ | ≤ subidos en el 100 % |
| 34 | Registros Bitacora | — (conteo de `bitacora_entradas`) | A | `bitacora_count` | alta | ✓ | no se crean eventos |
| 35 | Fecha Creación | `practicas.creada_en` | D | date | alta | ✓ | |
| 36 | Ultimo movimiento Estudiante | `practicas.ultima_actividad` (parcial) | T | `ultimo_movimiento_estudiante` | alta | ✓ | SIPRA guarda un solo «última actividad» |
| 37 | Ultimo movimiento Docente | `practicas.ultima_actividad` (parcial) | T | `ultimo_movimiento_docente` | alta | ✓ | ídem |
| 38 | Pensum | — | S | texto | alta | ✓ | puede ayudar a la equivalencia de programa |

**Resumen:**

| Clase | Campos | % |
|---|---:|---:|
| D · equivalente directo | 14 | 36,8 % |
| T · con transformación | 15 | 39,5 % |
| A · agregado derivable | 3 | 7,9 % |
| S · sin equivalente | 6 | 15,8 % |
| **Con equivalente en el modelo actual (D + T)** | **29** | **76,3 %** |

La variante M excluye 10 campos: nombre, correo y teléfono del estudiante, nombre del docente, los 4
del jefe y funciones relevantes. El documento de estudiante y de docente se conserva solo como clave.

### 25.4 `historico.importaciones`

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `source_system` | text | `'sgp'` |
| `filename` | text | nombre del archivo, sin ruta local |
| `file_sha256` | char(64) | único parcial donde `status NOT IN ('failed','reverted')` |
| `file_size_bytes` | bigint | |
| `fecha_corte` | timestamptz | máximo de los últimos movimientos: 2026-09-22 12:25 |
| `started_at` / `finished_at` | timestamptz | |
| `row_count_file` | int | filas de la hoja: 1.046.195 |
| `row_count_real` | int | `#` no vacío: 143.659 |
| `row_count_imported` | int | versiones nuevas insertadas |
| `row_count_unchanged` | int | `content_hash` ya vigente |
| `row_count_observed` | int | con al menos una marca de calidad |
| `row_count_missing` | int | vigentes antes y ausentes en este archivo (no se borran) |
| `status` | enum | `registered → profiled → loading → loaded → published`, más `failed` y `reverted` |
| `importer_version` | text | versión del importador y del parser de periodos |
| `pii_variant` | enum | `minimized` o `extended` (§25.12) |
| `key_version` | smallint | versión del secreto HMAC usado |
| `imported_by` | text | |

**Idempotencia:** si el `file_sha256` (`b9e25935…1313111` para el archivo actual) ya tiene una
importación vigente, el importador termina sin escribir. Si el archivo es nuevo pero trae registros
conocidos, decide el `content_hash` (§25.5).

**Reversión:** borrar por `importacion_id` las filas de `historico.practicas`, de alias y de
correspondencias propuestas por esa importación; recalcular `vigente` como la versión máxima restante
de cada `(source_system, source_record_id)`; marcar `reverted`; refrescar `analytics`. No toca
`public` ni otras importaciones.

### 25.5 `historico.practicas`

Una fila por **versión** de un registro del SGP.

| Grupo | Campos |
|---|---|
| Identidad y versión | `id` uuid · `importacion_id` · `source_system` · `source_record_id` text · `source_row` int (fila de Excel) · `version` int · `content_hash` char(64) · `vigente` boolean |
| Estudiante | `student_key` (HMAC) · `key_version` |
| Académico | `programa_original` · `programa_codigo` (nullable, por equivalencia) · `escuela_id` (nullable, derivada del programa) · `regional_original` · `regional` · `nivel_original` · `asignatura_original` · `ciclo_inferido` · `ciclo_fuente` · `ciclo_calidad` · `semestre_creditos` · `modalidad_estudio` · `codigo_asignatura` · `pensum` |
| Periodo | `periodo_original` · `periodo_codigo` (nullable) · `periodo_calendario` (`presencial`/`virtual`/`335`/`legado`) · `periodo_anio` · `periodo_ordinal` · `periodo_formato` |
| Práctica | `modalidad_practica_original` · `modalidad_practica` (`ModalidadPractica`, nullable) · `estado_original` · `estado_normalizado` · `estado_analitico` · `es_estado_de_corte` · `area` · `cargo` · `horario` |
| Docente | `teacher_key` (HMAC, nullable) |
| Organización | `nit_original` · `nit_digitos` · `organizacion_historica_id` (nullable) · `empresa_nombre_original` (nulo si persona natural) |
| Lugar | `ciudad_original` · `ciudad_divipola` (nullable) |
| Fechas | `fecha_inicio_original` text · `fecha_inicio` date · `fecha_fin_original` text · `fecha_fin` date · `duracion_dias` (nulo si hay marca de fecha) · `fecha_creacion` · `ultimo_movimiento_estudiante` · `ultimo_movimiento_docente` |
| Economía | `salario_original` text · `salario_normalizado` bigint · `salario_calidad` · `remunerada` boolean nullable |
| Seguimiento | `documentos_subidos_ratio` · `documentos_aprobados_ratio` (`CHECK aprobados ≤ subidos`, `CHECK 0–1`) · `bitacora_count` |
| Calidad | `quality_flags` text[] · `quality_status` (`clean`/`observed`) |

Restricciones conceptuales:

- `UNIQUE (source_system, source_record_id, version)`;
- único parcial `(source_system, source_record_id) WHERE vigente`;
- `UNIQUE (importacion_id, source_row)`.

`content_hash` = SHA-256 de la serialización canónica (orden fijo de claves, textos tal como vinieron)
de los campos de origen conservados, sin metadatos de importación.

Al reimportar:

- **mismo hash:** no se crea versión; se cuenta como `unchanged`;
- **hash distinto:** se inserta la `version + 1` como vigente y la anterior queda como historia;
  nunca se sobrescribe en silencio;
- **registro ausente en el archivo nuevo:** se conserva y se cuenta como `missing`.

Las 3 filas truncadas se importan con `TRUNCATED_SOURCE_ROW` y `quality_status = observed`. Las 148
filas idénticas se conservan: tienen `#` distinto y son registros distintos del SGP.

### 25.6 Organizaciones

| Tabla | Contenido |
|---|---|
| `historico.organizaciones` | una fila por `nit_base` válido (módulo 11 de la DIAN) o, sin NIT confiable, por identificador provisional; `tipo` (`juridica`/`natural`/`extranjera`/`indeterminada`), `nombre_preferido`, primera y última aparición, volumen |
| `historico.organizacion_alias` | cada `(nit_original, nombre_original)` observado → organización, con frecuencia y periodo |
| `historico.organizacion_mapping` | `organizacion_historica_id ↔ public.empresas.id`, con `metodo` (`nit_exacto`, `nit_base_dv`), `confianza`, `estado` (`propuesta`/`confirmada`/`rechazada`), `decidido_por`, `decidido_en` |

Reglas:

- **nunca** por nombre solo; el nombre solo sirve para proponer y revisar;
- coincidencia automática solo con `nit_base` + DV válido igual a `empresas.nit_numero` + `nit_dv`, y
  aun así queda en `propuesta` si el NIT tiene varios nombres (7.927 casos);
- NIT con varios nombres o nombre con varios NIT (5.323) → `COMPANY_IDENTIFIER_AMBIGUOUS` y revisión
  manual;
- NIT de persona natural (11 dígitos o modalidades de emprendimiento) → `COMPANY_NATURAL_PERSON`; en
  la variante M no se guarda el nombre;
- no se crean filas en `public.empresas`; `empresas` exige solicitante, estado y decisión que el SGP
  no tiene;
- las prácticas internas de la CUN (≈7.600 filas, dos NIT) se marcan como organización institucional.

### 25.7 Estudiantes, docentes y claves seudónimas

- `student_key = HMAC-SHA256(secreto_institucional_vN, normalizar(documento))`.
  `teacher_key` se calcula igual con un secreto distinto.
- `normalizar`: solo dígitos, sin ceros a la izquierda. El histórico ya los perdió al pasar por
  `float`, así que la misma regla se aplica a `usuarios.documento` para que las claves coincidan.
- El secreto vive en Secret Manager, nunca en la base ni en el repositorio. Se guarda su versión
  (`key_version`); rotar el secreto obliga a recalcular las claves.
- Una cédula tiene poca entropía: si el secreto se filtra, el HMAC se puede revertir por fuerza bruta.
  Es **seudonimización**, no anonimización: el dato sigue siendo personal bajo la Ley 1581.
- **Correspondencia con el estudiante actual:** `analytics.estudiante_clave(usuario_id, student_key)`.
  Lo calcula un proceso con acceso al secreto a partir de `usuarios.documento` de los usuarios con rol
  estudiante. Es una relación analítica: no copia ningún dato histórico sobre el usuario y no crea
  cuentas.
- **Docentes:** `analytics.docente_clave(usuario_id, teacher_key)` con el mismo mecanismo. Cuando hay
  correspondencia, el nombre visible sale de `usuarios`; sin ella, Reportes muestra «Docente SGP
  (sin cuenta SIPRA)». No se crean 545 usuarios.

### 25.8 Ciclo (nivel)

| `asignatura_original` | `ciclo_inferido` |
|---|---|
| `PRÁCTICA NIVEL TÉCNICO ` | `tecnico` |
| `PRACTICA NIVEL TECNOLÓGICO` | `tecnologo` |
| `PRACTICA NIVEL PROFESIONAL UNIVERSITARIO` | `profesional` |

Las tres asignaturas cubren el 100 % de las filas.

| Situación | `ciclo_fuente` | `ciclo_calidad` | Filas | Marca |
|---|---|---|---:|---|
| las dos fuentes existen y coinciden | `ambas` | `alta` | 60.848 | — |
| solo existe la asignatura | `asignatura` | `alta` | 82.759 | `MISSING_LEVEL` |
| las dos fuentes existen y se contradicen | `asignatura` | `media` | 52 | `LEVEL_CONFLICT` |

`nivel_original` se conserva intacto.

### 25.9 Estados

El mapeo es la inversa exacta de `EQUIVALENCIA_SGP` y `ESTADO_OPERATIVO` del dominio, que ya agrupan
los estados técnicos de SIPRA en los cinco del SGP:

| `estado_original` | `estado_normalizado` | `estado_analitico` (= `EstadoOperativo`) | `es_estado_de_corte` | Filas |
|---|---|---|---|---:|
| Cerrado | `cerrado` | `cerrado` | no | 91.656 |
| Anulado | `anulado` | `anulado` | no | 27.201 |
| Reprueba | `reprueba` | `reprobado` | no | 17.397 |
| Inscrito | `inscrito` | `inscrito` | **sí** | 6.216 |
| En Práctica | `en_practica` | `en_practica` | **sí** | 1.189 |

- **No** se mapea a `EstadoPractica`: el SGP no distingue `documentacion`, `en_validacion`,
  `activa`, `finalizada` ni `certificada`. Inventarlos sería falso.
- `Inscrito` y `En Práctica` significan «así estaba el 22 de septiembre de 2026», no la situación
  actual. Reportes debe rotularlos así o excluirlos de las tasas (§25.14).

### 25.10 Periodos

Parser explícito y con pruebas unitarias. La entrada es `periodo_original` y la salida
`(periodo_codigo, calendario, anio, ordinal, formato)`.

| Regla (regex) | Calendario | Ejemplo | Filas | Formato |
|---|---|---|---:|---|
| `^(\d{4})([A-D])$` | `presencial` | `2025C` → año 2025, ordinal C | 63.529 | `vigente` |
| `^(\d{2})V(0[1-6])$` | `virtual` | `23V04` → 2023, 4 | 72.467 | `vigente` |
| `^(\d{2})P(0[1-6])$` | `335` | `25P03` → 2025, 3 | 7.606 | `vigente` |
| `^(\d{4})I$` | `legado` | `2023I` | 48 | `legado` · `PERIOD_LEGACY_FORMAT` |
| `^(\d{2})T(\d{2})$` | `legado` | `22T01` | 9 | `legado` · `PERIOD_LEGACY_FORMAT` |
| cualquier otro | — | — | 0 | `PERIOD_UNPARSEABLE` |

- Hallazgo: los formatos `AAAA[A-D]`, `AAV0N` y `AAP0N` son **los mismos códigos** que usa hoy
  `periodos_academicos` (2026A…2026D, 26V01…26V06, 26P01…26P06). El 99,96 % de las filas tiene un
  código compatible.
- `periodo_codigo` solo se llena con formato vigente; no se crea ninguna fila en
  `periodos_academicos` ni hay clave foránea hacia esa tabla.
- `B` (hasta 2024) y `C` (desde 2025) se conservan tal cual. No se reinterpretan como el mismo
  ordinal sin una decisión institucional.
- Casos de prueba mínimos:
  - los 79 valores observados;
  - años de 2 dígitos → siglo 2000;
  - minúsculas y espacios;
  - `V07` y `P00`, que no son válidos;
  - entrada vacía.

### 25.11 Modalidades, fechas y salario

**Modalidad de práctica (15 → 14).** `Modalidad` (de estudio) queda en `modalidad_estudio` y no se
fusiona con esta.

| SGP | `ModalidadPractica` |
|---|---|
| VALIDACIÓN DE LA EXPERIENCIA LABORAL | `validacion_experiencia` |
| PASANTÍA | `pasantia` |
| CONTRATO DE APRENDIZAJE | `contrato_aprendizaje` |
| COMBINACIÓN DE FUNCIONES | `combinacion_funciones` |
| PRÁCTICA TÉCNICA EN INVESTIGACIÓN | `practica_tecnica_investigacion` |
| PRÁCTICA INVESTIGATIVA | `investigacion` |
| EMPRENDIMIENTO CUNBRE - NACIENTE | `cunbre_naciente` |
| PROYECCIÓN SOCIAL | `social` |
| MONITORÍA | `monitoria` |
| ASESORÍA Y ASISTENCIA TÉCNICA | `asesoria_asistencia_tecnica` |
| EMPRENDIMIENTO CUNBRE - CONSOLIDADO | `cunbre_consolidado` |
| ESTADO JOVEN PASANTÍAS | `estado_joven` |
| PASANTÍA INTERNACIONAL | `pasantia_internacional` |
| PASANTÍA INVESTIGATIVA | `pasantia_investigativa` |
| **EMPRESA PROPIA** | **sin equivalente** → `NULL` + `MODALITY_NO_CURRENT_EQUIVALENT` |

`EMPRESA PROPIA` cubre 424 filas, usadas solo de 2019 a 2023; en la práctica la sustituyó CUNbre.
Asignarla a `cunbre_naciente` o a `cunbre_consolidado` es una decisión institucional, no del
importador. El resto de las equivalencias cubre el 99,7 % de las filas.

**Fechas.** Siempre se guardan el texto original, una fecha nullable y una marca. Nada rompe la
importación y ninguna fecha imposible se convierte en una fecha falsa.

| Caso | Fecha normalizada | Marca |
|---|---|---|
| `0000-00-00`, `0001-01-01`, años como `0020` o `0202` | `NULL` | `INVALID_START_DATE` / `INVALID_END_DATE` |
| inicio antes de 2015 o después del corte; fin más de 2 años después del corte | se conserva | `DATE_OUT_OF_RANGE` |
| fin anterior al inicio (92) | se conservan las dos | `END_BEFORE_START`, `duracion_dias = NULL` |
| duración > 730 días (829) | se conservan | `DURATION_EXTREME` |

**Salario.** Se guarda `salario_original` siempre; `salario_normalizado` solo cuando el patrón es
inequívoco.

| `salario_calidad` | Regla | Marca |
|---|---|---|
| `exacto` | entero o miles con punto completos y valor ≥ 0 | — |
| `no_remunerado` | `0`, `NO REMUNERADO`, `NO APLICA`, `NINGUNO` | — |
| `referencia_smmlv` | `SMLV`, `SMMLV`, `MÍNIMO` | — (sin valor numérico) |
| `atipico` | negativo o > 20 millones | `SALARY_OUTLIER` |
| `no_interpretable` | truncado (`.908.526`), apóstrofos, letras sueltas | `SALARY_UNPARSEABLE` |

Las agregaciones de salario solo usan `exacto`. `remunerada` se deriva de `exacto > 0` o
`no_remunerado`; en los demás casos queda `NULL`.

### 25.12 Datos personales: variante minimizada (M) y extendida (E)

| Variante | Qué se guarda | Requiere |
|---|---|---|
| **M · minimizada (recomendada por defecto)** | todo lo marcado ✓ en §25.3; estudiante y docente solo como HMAC; sin nombre, correo, teléfono, jefe ni funciones; organización de persona natural solo como clave | base legal para análisis estadístico seudonimizado |
| E · extendida | lo anterior + `historico.registro_origen` (registro completo como `jsonb`) con acceso solo para un rol de auditoría, cifrado y fecha de purga | aprobación específica de finalidad y retención |

Con la variante M se pueden construir todas las métricas del §25.15 (conteos, tendencias, programas,
periodos, modalidades, duraciones, organizaciones, cierres) sin nombre, correo ni teléfono. El archivo
original, si se conserva, va a un bucket restringido, referenciado por `file_sha256` + `source_row`;
nunca al repositorio.

### 25.13 Marcas de calidad (hechos, no veredictos)

`quality_status` vale `clean` o `observed`; **no existe `invalid`**. La decisión de excluir una marca
de una métrica es institucional y se toma en la capa `analytics`, no en la importación.

| Marca | Hecho técnico | Filas aprox. |
|---|---|---:|
| `TRUNCATED_SOURCE_ROW` | fila cortada después de `Nit Empresa` | 3 |
| `INVALID_START_DATE` | inicio no es una fecha real | ≈200 |
| `INVALID_END_DATE` | fin no es una fecha real | ≈13.550 |
| `END_BEFORE_START` | fin < inicio | 92 |
| `DATE_OUT_OF_RANGE` | fecha fuera de la ventana razonable | ≈830 |
| `DURATION_EXTREME` | duración > 730 días | 829 |
| `MISSING_LEVEL` | `Nivel Formación` vacío (ciclo inferido de la asignatura) | 82.759 |
| `LEVEL_CONFLICT` | nivel y asignatura se contradicen | 52 |
| `MISSING_PROGRAM` | sin programa | 2 |
| `MISSING_STUDY_MODALITY` | sin modalidad de estudio | 72 |
| `MODALITY_NO_CURRENT_EQUIVALENT` | `EMPRESA PROPIA` | 424 |
| `PERIOD_LEGACY_FORMAT` | `AAAAI` o `AATNN` | 57 |
| `COMPANY_IDENTIFIER_MISSING` | NIT nulo, trivial o de menos de 8 dígitos | ≈140 |
| `COMPANY_IDENTIFIER_AMBIGUOUS` | NIT con varios nombres o nombre con varios NIT | por calcular en la importación |
| `COMPANY_NATURAL_PERSON` | NIT de persona natural | ≈4.600 |
| `SALARY_UNPARSEABLE` | salario no interpretable | ≤3.464 |
| `SALARY_OUTLIER` | negativo o > 20 millones | ≥225 |
| `STUDENT_ID_ATYPICAL` | documento de 15 dígitos o de menos de 7 | 123 |
| `TEACHER_ID_MISSING` | sin documento de docente | 159 |
| `IDENTICAL_CONTENT` | contenido igual al de otro `#` | 148 |
| `BURST_DUPLICATE` | ráfaga de registros del mismo estudiante, periodo y día | 63 (1 caso) |
| `DUPLICATE_ACTIVE_IN_PERIOD` | más de un registro no anulado del mismo estudiante en el periodo (violaría la regla actual) | 502 |
| `STATE_AS_OF_CUTOFF` | `Inscrito` o `En Práctica` al corte | 7.405 |

### 25.14 `analytics.practicas` y la regla de solapamiento

**Columnas homogéneas** (vista materializada, refrescada tras cada importación publicada y
periódicamente para la parte actual):

| Columna | `current` (desde `public.practicas`) | `historical` (desde `historico.practicas` vigente) |
|---|---|---|
| `source` | `'current'` | `'historical'` |
| `record_id` | `practicas.id` | `historico.practicas.id` |
| `source_record_id` | `numero_fur` | `#` |
| `student_key` | vía `analytics.estudiante_clave` | `student_key` |
| `teacher_key` | vía `analytics.docente_clave` | `teacher_key` |
| `programa_codigo`, `escuela_id` | propios | por equivalencia (nullable) |
| `regional`, `ciclo` | propios | normalizados / `ciclo_inferido` |
| `modalidad_estudio` | `NULL` (no existe; derivable del calendario del periodo) | `modalidad_estudio` |
| `modalidad_practica` | propia | equivalente (nullable) |
| `estado_analitico` | `ESTADO_OPERATIVO[estado]` | `estado_analitico` |
| `estado_al` | `now()` | `fecha_corte` de la importación |
| `periodo_codigo`, `periodo_calendario`, `periodo_anio` | de `periodos_academicos` | del parser |
| `organizacion_clave` | `nit_base` de la empresa o del FUR | `organizacion_historica_id` → `nit_base` |
| `fecha_inicio`, `fecha_fin`, `duracion_dias` | propias | normalizadas |
| `documentos_subidos_ratio`, `documentos_aprobados_ratio` | `NULL` en la primera versión (otra matriz documental) | ratios del SGP |
| `bitacora_count` | `COUNT(bitacora_entradas)` | `bitacora_count` |
| `quality_flags` | `{}` | marcas |
| `incluida` | regla de solapamiento | regla de solapamiento |

**Por qué no basta una unión ciega.** El histórico llega hasta el 22 de septiembre de 2026 y tiene
21.909 registros en periodos de 2026, de los cuales 7.405 siguen abiertos al corte:

- `26V04`: 3.416 inscritos y 231 en práctica;
- `2026C`: 1.315 inscritos;
- `26V03`: 710 inscritos y 463 en práctica;
- `26P04`: 526 inscritos;
- 55 rezagados de 2025.

Esos mismos procesos continúan en SIPRA si la carga inicial del SGP (pendiente P-42 del documento
técnico) los lleva a la operación, o si los estudiantes se registran de nuevo.

| Opción | Ventaja | Falla |
|---|---|---|
| **A** · histórico hasta el corte, SIPRA después | simple | parte los periodos de frontera; si el proceso sigue en SIPRA se cuenta dos veces (registro creado antes del corte en el SGP y después en SIPRA); los abiertos del SGP quedan congelados en estado de corte |
| **B** · correspondencia por identificador | exacta cuando existe | hoy no existe: `practicas` no guarda el id del SGP y `numero_fur` es otra secuencia; la alternativa `(student_key, periodo, ciclo)` es aproximada (202 grupos del propio histórico la repiten) |
| **C** · combinada (**recomendada**) | cierra ambos huecos | requiere dos definiciones institucionales |

**Regla C propuesta:**

1. **Periodo frontera por calendario** (decisión institucional, p. ej. presencial `2026C`, virtual
   `26V04`, 335 `26P04`):
   - los periodos anteriores a la frontera toman solo el histórico;
   - los periodos posteriores toman solo SIPRA;
   - el corte va por periodo, nunca por fecha de creación.
2. **En los periodos frontera**, `analytics.correspondencia_practica(historico_id, practica_id,
   metodo, estado)`:
   - **método `sgp_id`**: exacto. Requiere que, si P-42 carga prácticas abiertas en la operación,
     cada una guarde el `#` de origen (una columna nueva `origen_sgp_id`; decisión de esa fase, no de
     esta);
   - **método `estudiante_periodo_ciclo`**: `student_key` + `periodo_codigo` + `ciclo`, solo para
     registros no anulados; queda `propuesta` cuando hay más de un candidato.
3. **Precedencia:** si hay correspondencia, gana SIPRA (estado más reciente) y el registro histórico
   queda `incluida = false`. Sin correspondencia, el histórico se muestra con su estado de corte
   rotulado.
4. **Control automático** (prueba de la capa `analytics`): cero pares
   `(student_key, periodo_codigo, ciclo)` no anulados incluidos desde las dos fuentes a la vez.
5. **Tasas** (cierre, reprobación, anulación): por omisión solo sobre periodos cerrados, es decir,
   sin estados de corte.

### 25.15 Reportes V3 (preparado, no implementado)

Selector **Fuente: Todos · Actual · Histórico**. «Todos» aplica `incluida = true`. Los filtros que no
existen en una fuente (modalidad de estudio, semestre por créditos, ratios documentales) se muestran
como «No disponible en la fuente actual» en vez de ocultar filas.

| Métrica | Histórico | Condición |
|---|---|---|
| Prácticas por periodo | limpia | 100 % con periodo; 99,96 % parseado |
| Estudiantes únicos | limpia | `student_key` (0 documentos nulos) |
| Programas | limpia en histórico | combinar con actual exige la equivalencia nombre → código SINU |
| Regionales | limpia | recorte de espacios |
| Ciclo / nivel | limpia | inferido de la asignatura (100 %) |
| Modalidad de estudio | limpia | 99,95 %; sin equivalente actual |
| Modalidad de práctica | limpia | 99,7 % equivalente; `EMPRESA PROPIA` aparte |
| Estado | limpia | rótulo de estado al corte |
| Tasa de cierre / reprobación / anulación | limpia | solo periodos cerrados |
| Organizaciones | condicionada | `nit_base`; ambiguas en revisión |
| Ciudades | condicionada | requiere equivalencia DIVIPOLA |
| Duración | condicionada | excluye marcas de fecha (≈130.000 válidas) |
| Actividad | limitada | solo último movimiento, sin serie temporal |
| Cumplimiento documental histórico | limpia como «indicador SGP» | no comparable 1:1 con la matriz documental actual |

**Fuera de alcance, explícitamente:**

- Cumplimiento V3 sigue siendo operacional y solo usa `public`;
- no se generan cartas, obligaciones, documentos, solicitudes de ARL, validaciones, entradas de
  bitácora ni registros de auditoría para prácticas históricas.

### 25.16 Futuro: «Historial de prácticas» (no implementado)

En la ficha del estudiante actual (coordinación y dirección), un proceso con acceso al secreto
calcula `student_key` desde `usuarios.documento` y lista en solo lectura sus registros SGP: periodo,
ciclo, modalidad, estado (con fecha de corte) y organización. La consulta se registra en
`auditoria`. Si el estudiante puede ver su propio historial es una decisión pendiente. No se copian
datos al expediente actual.

### 25.17 IA futura

El modelo conserva lo necesario para datasets futuros: versiones, estados de corte explícitos,
marcas de calidad y claves estables. No se crean variables derivadas (*features*), puntajes ni
modelos.

### 25.18 Estrategia futura de importación

1. Migraciones TypeORM que crean los esquemas `historico` y `analytics` con sus roles (`synchronize`
   prohibido):
   - `sipra_historico_carga`: escritura en `historico`;
   - `sipra_app`: solo `SELECT` sobre las vistas de `analytics`.
2. Importador fuera de la API: script con pruebas que lee identificadores con `dtype=str`, filtra
   por `#` no vacío, aplica el parser de periodos y calcula los HMAC en memoria. El documento en claro
   nunca se escribe en la base.
3. Carga con `COPY` a tabla temporal + `INSERT … SELECT` en una transacción por importación;
   idempotencia por `file_sha256` y versionado por `content_hash`.
4. Validación de conteos contra esta auditoría y publicación (`published`); refresco de `analytics`.
5. Equivalencias revisadas por personas, en tablas aparte: programas, organizaciones, ciudades,
   frontera de periodos y `EMPRESA PROPIA`.
6. Pruebas:
   - parser de periodos;
   - normalización de documentos;
   - idempotencia (dos veces el mismo archivo = 0 filas nuevas);
   - versionado;
   - reversión;
   - regla de solapamiento;
   - aislamiento entre empresas sobre `historico` y `analytics`.

### 25.19 Decisiones institucionales que siguen bloqueando la importación

1. **Base legal, finalidad y retención** del histórico, incluso seudonimizado (Ley 1581): quién lo
   autoriza y por cuánto tiempo.
2. **Variante de datos personales:** M (recomendada) o E. Si es E, qué rol accede a `registro_origen`
   y cuándo se purga.
3. **Custodia del secreto HMAC** y su política de rotación.
4. **Periodo frontera** por calendario y si la carga inicial P-42 guardará `origen_sgp_id`.
5. **Equivalencias que solo puede aprobar la institución:**
   - nombre de programa + ciclo → código SINU;
   - `EMPRESA PROPIA`;
   - significado de `B` frente a `C` y de los formatos `I`/`T`.
6. **Política de calidad:** qué marcas excluyen una fila de qué métricas.

---

## 26. Infraestructura de importación (H2)

> Implementada el 19 de noviembre de 2026. **Datos reales importados: 0.** Sobre el Excel real solo se ejecutó un
> simulacro (DRY RUN, cero escrituras). La carga real queda para H3. Donde esta sección precise o difiera del §25
> (nombres de marcas, variante minimizada), prevalece esta.

### 26.1 Piezas

| Capa | Archivo | Qué hace |
|---|---|---|
| Migración | `migrations/1756000025000-HistoricoSgp.ts` | esquema `historico`, 5 tablas, restricciones, índices y disparadores; no toca `public` |
| Dominio | `domain/historico/calidad-historico.ts` | catálogo central de marcas; `clean`/`observed` (no existe `invalid`) |
| Dominio | `domain/historico/periodo-sgp.parser.ts` | parser explícito de los 7 esquemas de periodo |
| Dominio | `domain/historico/fechas-sgp.parser.ts` | fechas y marcas de tiempo: original + fecha nullable + estado |
| Dominio | `domain/historico/normalizacion-sgp.ts` | documento (texto, nunca `float`), NIT (DV DIAN con `Nit`), salario, nivel, modalidad 15→14, estado (inversa de `EQUIVALENCIA_SGP`) |
| Dominio | `domain/historico/seudonimizacion-historico.ts` | HMAC-SHA256 con prefijo de propósito; fail-closed |
| Dominio | `domain/historico/registro-historico.ts` | fila real → registro minimizado, `content_hash`, marcas de lote, planificación del versionado |
| Puerto | `domain/ports/out/historico-repositorio.port.ts` | fuente SGP y repositorio del histórico |
| Aplicación | `application/use-cases/historico/*.use-case.ts` | importar (DRY RUN / APPLY) y revertir |
| Infraestructura | `infrastructure/historico/lector-xlsx-sgp.ts` | lectura en flujo con `exceljs` (ya era dependencia: no se agregó ninguna) |
| Infraestructura | `infrastructure/historico/configuracion-historico.ts` | variables de entorno y compuertas |
| Infraestructura | `adapters/persistence/postgres/historico.adapter.ts` | bloqueo consultivo, transacción única, inserción por lotes, versionado, reversión |
| CLI | `herramientas/historico-importar.ts`, `historico-revertir.ts`, `historico-fixture.ts` | sin endpoint HTTP |
| Pruebas | `test/historico-*.spec.ts`, `test/soporte-historico-sgp.ts`, `herramientas/verificar-historico-pg.ts` | unitarias y PostgreSQL real |

La regla de dependencia se cumple: el dominio solo usa `node:crypto` y entidades propias (`practica.entity`,
`modalidad.entity`, `nit.vo`).

### 26.2 Esquema `historico`

| Tabla | Una fila = | Claves |
|---|---|---|
| `importaciones` | un intento de importación | `ux_himp_archivo_completado` (sistema + SHA-256, solo `completed`), `ux_himp_una_en_curso` (sistema, solo `processing`) |
| `practicas` | una **versión** de un registro SGP | `ux_hprac_version` (sistema, `source_record_id`, versión), `ux_hprac_vigente` (sistema, `source_record_id`) **WHERE is_current** |
| `organizaciones` | una organización histórica por clave seudónima | único (sistema, `organization_key`, versión de clave) |
| `organizacion_alias` | un alias seudónimo de nombre por organización | FK compuesta a `organizaciones` |
| `organizacion_mapping` | una correspondencia futura con `public.empresas` | sin FK a `public` (el histórico no se borra ni se bloquea si desaparece una empresa); H2 no crea ninguna |

**Índices.** Son 7 en `practicas`, cada uno con su razón:
- versión y vigente: identidad e invariante;
- `importacion_id`: reversión y clave foránea;
- `student_key`, `teacher_key`, `periodo_normalizado` y (sistema, `organization_key`): parciales `WHERE is_current`, para la analítica futura y el refresco de organizaciones.

**Garantías en el motor, no solo en el código:**
- una sola versión vigente por registro;
- una versión es inmutable: solo cambia `is_current` (disparador);
- una versión solo se borra dentro de una reversión, con `historico.reversion` activado en la transacción;
- una importación no se borra;
- `quality_status` es `observed` si y solo si hay marcas;
- `nit_juridica` en claro solo para persona jurídica con DV válido;
- una correspondencia nunca se hace `nombre` y nunca queda `confirmada` sin revisor;
- `source_system` solo admite `SGP` o `SGP_SINTETICO`, que aísla los fixtures.

**Privilegios.** `REVOKE ALL ON SCHEMA historico FROM PUBLIC` y nada para `sipra_app`: la API no lee el histórico en H2.

**Reversión de la migración.** El `down` se niega si hay cualquier importación registrada.

### 26.3 Variante minimizada (implementada)

- **Nunca se leen de la hoja:** nombre, correo y teléfono del estudiante; nombre del docente; nombre, cargo, correo y teléfono del jefe; funciones relevantes. El lector ni siquiera los extrae.
- **No hay copia JSON de la fila.**
- **`Documento`, `Documento Docente`, `Nit Empresa` y `Nombre Empresa`** solo se leen para calcular claves; no se guardan en claro. Excepción: el NIT base de una persona jurídica con DV válido (rango 8xx/9xx de la DIAN), que no es un dato personal y sirve para la futura correspondencia con `empresas.nit_numero`.
- **Persona natural:** solo la clave.
- **Nombre de empresa:** solo `empresa_alias_hash` (HMAC del nombre canónico, versión de normalización `n1`).
- **Lo que se conserva** (no identificador):
  - programa, regional, nivel, semestre, modalidad de estudio, código y nombre de asignatura, pensum;
  - periodo, modalidad de práctica, estado, área, cargo, horario, ciudad;
  - fechas (original y normalizada), salario (original solo si no parece contener un dato personal);
  - proporciones documentales, conteo de bitácora y últimos movimientos.

### 26.4 Claves HMAC

`clave = HMAC-SHA256(HISTORICO_HMAC_KEY, "<propósito>:<valor normalizado>")`. Los propósitos son `student`,
`teacher`, `organization` y `organization-alias`, así que el mismo número da claves distintas en cada dominio.

- **Normalización del documento:**
  - entero exacto sin `.0` ni notación científica (el `.0` solo se quita cuando la celda era numérica);
  - texto con separadores → solo dígitos;
  - texto `1234.0` → atípico y sin clave (no se adivina);
  - alfanumérico → mayúsculas, solo letras y dígitos;
  - sin ceros a la izquierda;
  - la misma regla servirá para `usuarios.documento` en la fase de correspondencia.
- **Normalización del NIT:** sin DV cuando se identificó. Así `900123456-7`, `9001234567`, `900.123.456-7` y `900123456` dan la misma clave.
- **Configuración:** `HISTORICO_HMAC_KEY` y `HISTORICO_HMAC_KEY_VERSION` (`v1`, `v2`…). Cada importación y cada versión guardan `hmac_key_version`.
- **Rotación:** no está implementada. Un APPLY con otra versión de clave sobre registros vigentes se rechaza (`VersionClaveIncompatibleError`); el diseño la deja posible.
- **Fail-closed:** APPLY sin clave, con el marcador de plantilla, con menos de 32 caracteres o sin versión válida → no hay seudonimizador. No existe clave de respaldo ni de desarrollo. El simulacro sin clave usa una clave **efímera** en memoria, válida para contar y no comparable con la base, y así lo informa.
- **Seudonimización, no anonimización:** la clave sigue siendo un dato personal; el secreto va a Secret Manager.

### 26.5 `content_hash` y versionado

`content_hash` es el SHA-256 de una serialización canónica: pares `[columna, valor]` en orden fijo, sobre los campos
de origen conservados. No incluye columnas personales, metadatos del proceso, número de fila ni claves HMAC.

**El documento y el NIT tampoco entran al hash.** Junto con los demás campos conocidos podrían revertirse por fuerza
bruta. Sus cambios se detectan comparando las claves seudónimas con la misma versión de clave.

| Caso | Resultado |
|---|---|
| `source_record_id` nuevo | versión 1, vigente |
| existente, mismo hash y mismas claves | `unchanged` (no se escribe) |
| existente, hash o claves distintos | versión + 1 vigente; la anterior pasa a `is_current = false` y nunca se sobrescribe |
| vigente que no viene en el archivo | se conserva y se cuenta en `row_count_missing` |
| el mismo `#` dos veces en un archivo | el importador falla: la identidad de origen no es única |

### 26.6 Marcas de calidad

El catálogo vive en `calidad-historico.ts`. Las de lote (`IDENTICAL_CONTENT`, `DUPLICATE_ACTIVE_IN_PERIOD` y
`COMPANY_IDENTIFIER_AMBIGUOUS`) se calculan sobre el archivo completo. Cambios respecto al §25.13:

- `PERIOD_LEGACY_FORMAT` → `PERIOD_MAPPING_PENDING` (formatos I y T); lo no interpretable es `PERIOD_UNPARSEABLE`.
- `STATE_AS_OF_CUTOFF` no es una marca: es la columna `es_estado_de_corte`, más `estado_fecha_corte`. Marcar 7.405
  filas como observadas por un hecho de interpretación diluiría la marca.
- `PROGRAM_MAPPING_PENDING` existe en el catálogo pero no se pone fila a fila. La equivalencia institucional falta
  para el 100 % y se expresa en `programa_mapping_status = PENDING_INSTITUTIONAL_MAPPING`; ponerla en cada fila
  dejaría todo el histórico como observado.
- `codigo_sinu` queda siempre `NULL`: no se inventa ningún código.

### 26.7 Comandos

| Comando | Efecto |
|---|---|
| `npm run historico:dry-run -- --file "<xlsx>" [--source-system SGP\|SGP_SINTETICO] [--sin-base] [--json]` | simulacro por defecto: cero escrituras. Con `DB_URL` solo **lee** lo vigente para proyectar |
| `HISTORICO_IMPORT_APPLY=true … npm run historico:import -- --file "<xlsx>" --apply` | APPLY: exige `--apply` **y** la compuerta de entorno **y** una clave real **y** `DB_URL` |
| `HISTORICO_IMPORT_APPLY=true DB_URL=… npm run historico:revert -- --import-id <uuid>` | reversión de una importación |
| `npm run historico:fixture -- --out <carpeta>` | genera el fixture sintético v1/v2 |
| `DB_URL=… npm run test:pg:historico` | verificación contra PostgreSQL local desechable |

- **Sin confirmación interactiva:** la garantía es la doble compuerta (bandera explícita y variable de entorno explícita).
- **Salida:** solo agregados y el SHA-256 del archivo. Los errores nombran el `source_record_id` (id del SGP), nunca
  un documento, nombre o NIT.

### 26.8 APPLY, concurrencia y reversión

**APPLY** corre en una sola transacción, en este orden:
1. `pg_try_advisory_xact_lock('HIST', hashtext(sistema))`: si otro APPLY o una reversión lo tiene, falla de inmediato con `IMPORT_IN_PROGRESS`;
2. vuelve a comprobar `ALREADY_IMPORTED`;
3. cierra como `failed` cualquier `processing` huérfana (proceso caído);
4. comprueba que la versión de clave coincida;
5. planifica el versionado **dentro del bloqueo**;
6. inserta la importación `processing`;
7. retira la vigencia anterior;
8. inserta por lotes de 1.000 con `jsonb_to_recordset` (ninguna consulta ni inserción por fila);
9. refresca organizaciones y alias, derivados de lo vigente;
10. marca la importación `completed` con sus conteos.

Cualquier error revierte todo, y luego queda una constancia `failed` sin datos personales.

**Reversión:**
- La unidad es la importación; un `source_record_id` suelto no se borra nunca.
- Mismo bloqueo, una transacción y solo sobre la **última** `completed` del sistema (LIFO). Revertir una anterior
  dejaría a la posterior sin la base que dio por «sin cambios».
- Retira sus versiones, restituye como vigente la versión anterior de cada registro, recalcula organizaciones y marca
  `reverted`. El mismo archivo puede volver a importarse después.

**Volumen:** las 143.659 filas reales caben en una transacción (unos 144 lotes). Si H3 necesita partirla, el
bloqueo y la idempotencia por archivo ya están en su sitio.

### 26.9 Pruebas y resultados

| Prueba | Resultado |
|---|---|
| Unitarias del histórico (7 suites: periodo, fechas, HMAC, normalización, registro y versionado, XLSX y privacidad, migración) | 104/104 |
| Suite completa de la API | 125 suites, 3.340 pruebas en verde (una prueba de rendimiento de G6 había fallado bajo carga concurrente del lint; aislada y en la corrida completa sin carga, pasa) |
| `npm run test:pg:historico` (PostgreSQL 18 local, base desechable) | 67/67, dos corridas seguidas |
| `npm run verificar:migraciones` | código de salida 0, 138 comprobaciones estrictas, 0 fallas, 9 «DEUDA» (§26.10) |
| `npm run test:aislamiento` | 10/10 |
| `npm run lint` (API y web) | 0 advertencias |
| `npm run build` (API y web) | OK |
| `npm run smoke:arranque` | OK (`AppModule`, `/salud` 200, rutas protegidas 401) |
| `npm run verificar:secretos` | limpio (nuevo patrón: un valor real de `HISTORICO_HMAC_KEY` en un `.env` o un literal) |

**`test:pg:historico` cubre:**
- esquema y ausencia de columnas personales;
- privilegios;
- simulacro sin escrituras;
- compuertas;
- APPLY v1 con todas las marcas esperadas;
- HMAC: texto con puntos y número dan la misma clave; claves de estudiante y docente nunca coinciden;
- organizaciones derivadas sin correspondencias;
- búsqueda de centinelas, documentos y cédulas en **todo** el esquema;
- idempotencia (`ALREADY_IMPORTED` con 0 escrituras);
- versionado (10 nuevas, 6 versionadas, 241 sin cambios, 3 ausentes) con la historia intacta;
- índice parcial, inmutabilidad y prohibición de borrado en el motor;
- concurrencia con el bloqueo tomado;
- atomicidad: fallo tras el primer lote → cero filas;
- `processing` huérfana;
- reversión LIFO con restitución;
- versión de clave distinta;
- tablas operativas idénticas;
- salida del importador sin centinelas.

**Fixture sintético** (`test/soporte-historico-sgp.ts`): se genera en cada corrida y nunca se versiona un `.xlsx`.
- 250 registros, 60 filas fantasma y una fila vacía interior;
- valores centinela (`SECRET-…-XYZ`) en todas las columnas personales;
- casos de borde: `0000-00-00`, años 0001 y 2223, fin anterior al inicio, `EMPRESA PROPIA`, periodos I/T/desconocido,
  empresas ambiguas, persona natural, documento y docente ausentes, fila truncada, filas idénticas y duplicado activo
  en un periodo.
- La v2 modifica 5 registros, cambia un documento, agrega 10 y retira 3.

### 26.10 `verificar:migraciones`: deuda conocida separada

- **Sección nueva H, estricta:** la 25 sobre una base poblada hasta la 24 no cambia ninguna tabla de `public`; baja
  limpia sin datos y sube otra vez; se **niega** a bajar con una importación registrada.
- **Sección A:** valida el esquema `historico`.
- **Sección B:** baja primero la 25 (vacía) para que el bloque de la carta (24) siga probando lo suyo.
- **Bloques heredados en «modo deuda»:** las secuencias que asumen la 20 como última (bajadas de 20→12 con datos,
  protecciones del acta y de documentos empresariales, y el upgrade desde PRE-EPS). Sus fallos se imprimen como
  `DEUDA`, se cuentan aparte y no deciden el código de salida.
- **Resultado:** 9 deudas. Todas son la negativa por diseño de la 22 a bajar con usuarios director o analista, o
  consecuencia de que esas secuencias ya no bajan lo que dicen bajar. La protección de la 22 no se tocó.

### 26.11 `sipra_dev`

- **Migración 25 aplicada.** Las tablas operativas (`practicas`, `usuarios`, `empresas`, `obligaciones`) quedaron
  idénticas, comparadas por huella antes y después.
- **Fixture cargado con `SGP_SINTETICO`** y una clave aleatoria que solo existió durante la ejecución:
  - simulacro, y APPLY sin compuerta → rechazado;
  - APPLY v1: 250 nuevas; repetido → `ALREADY_IMPORTED`;
  - APPLY v2: 10 nuevas, 6 versionadas, 241 sin cambios, 3 ausentes;
  - consultas de QA: 0 registros con dos vigentes, marcas esperadas, 30 organizaciones y 0 correspondencias;
  - revert v2: 16 retiradas, 6 restituidas.
- **Estado final:** importación v1 `completed` (250 vigentes) y v2 `reverted`. `sipra_reportes_1000` no se tocó.

### 26.12 Simulacro sobre el Excel real (sin APPLY)

| Medida | Simulacro | Auditoría H1 | Nota |
|---|---:|---:|---|
| SHA-256 | `b9e25935…1313111` | igual | |
| Filas físicas con datos | 1.046.192 | 1.046.195 (`df.shape`) | `pandas` cuenta además las 3 filas vacías interiores que siguen a las truncadas |
| Filas reales (`#` no vacío) | **143.659** | 143.659 | |
| Filas fantasma descartadas | 902.533 | 902.533 | |
| Estudiantes distintos | 68.435 | 68.435 | por clave HMAC |
| Docentes distintos | 545 | 545 | |
| Periodos | 79 (presencial 63.529 · virtual 72.467 · 335 7.606 · legado 57) | 79 | ninguno no interpretable |
| Estados | Cerrado 91.656 · Anulado 27.201 · Reprueba 17.397 · Inscrito 6.216 · En Práctica 1.189 | igual | 7.405 estados de corte |
| Modalidad de práctica | 14 mapeadas · `EMPRESA PROPIA` 424 pendiente | igual | |
| Nivel | de `Nivel Formación` 60.848 · de la asignatura 82.811 (52 en conflicto) | igual | |
| Organizaciones distintas | 44.070 claves | 44.722 NIT (solo dígitos) | se unifican NIT con y sin DV |
| Fecha de corte | 2026-09-22 12:25:54 (hora de Colombia) | 22-09-2026 | |
| Filas truncadas | 3 | 3 | importables como observadas |
| Activos duplicados en el periodo | 502 | 502 (231 grupos) | |
| Contenido idéntico | 167 | 148 | aquí se compara sin las columnas personales (excluidas): por eso son más |
| Observadas | 128.620 (89,5 %) | — | sobre todo `MISSING_LEVEL` (82.759) y `COMPANY_IDENTIFIER_AMBIGUOUS` (96.971) |

- **Otras marcas:**
  - fechas: `INVALID_END_DATE` 13.558, `INVALID_START_DATE` 199, `END_BEFORE_START` 92, `DURATION_EXTREME` 829, `DATE_OUT_OF_RANGE` 20;
  - organización: `COMPANY_NATURAL_PERSON` 5.886, `COMPANY_IDENTIFIER_NONSTANDARD` 488, `COMPANY_IDENTIFIER_INVALID` 105;
  - salario: `SALARY_UNPARSEABLE` 949, `SALARY_OUTLIER` 888;
  - identidades: `TEACHER_ID_MISSING` 159, `STUDENT_ID_ATYPICAL` 1.
- **Rendimiento:** 69,3 s en total (unos 2.074 registros reales/s, recorriendo 1.046.192 filas físicas) y un pico de
  memoria de unos 1.021 MB (RSS). La mayor parte es la caché de cadenas compartidas de `exceljs` (84 MB de XML). Es
  viable para H3 sin optimizar.
- **Privacidad:** la salida no contiene valores de origen, y el archivo real no se copió.

### 26.13 Riesgos y pendientes para H3

1. **`COMPANY_IDENTIFIER_AMBIGUOUS` marca el 67 % de las filas.** Los grandes empleadores tienen muchas variantes de
   nombre bajo el mismo NIT. Antes de H3 conviene decidir si la ambigüedad de lote se limita a «nombre con varios NIT»
   o se lleva solo al catálogo de organizaciones (donde ya existe `alias_count`).
2. **Las decisiones institucionales del §25.19 siguen abiertas:** base legal y retención, custodia y rotación del
   secreto, periodo frontera, equivalencias de programa y `EMPRESA PROPIA`, y política de calidad.
3. **Memoria de 1 GB en el simulacro:** suficiente en local. En Cloud Run, asignar al menos 2 GiB al trabajo de carga.
4. **La deuda de `verificar:migraciones`** (secuencias heredadas que asumen la 20) sigue pendiente de una adaptación
   propia; quedó separada y visible, no oculta.
5. **El fixture de `sipra_dev`** usa una clave que ya no existe: sus claves no se pueden recalcular, y está bien porque
   es sintético. Para retirarlo: `historico:revert` de la importación v1.

---

## 27. Preparación de la importación real (H3)

> 19 de noviembre de 2026. **Datos reales importados: 0.** Sobre el Excel real solo se ejecutaron simulacros (DRY RUN,
> cero escrituras). Esta sección prevalece sobre el §26 donde difieran.

### 27.1 Calidad por dominio: práctica ≠ organización

H2 marcaba `COMPANY_IDENTIFIER_AMBIGUOUS` en la práctica. En el archivo real eso volvía observado el 67,5 % de las
filas (96.971), aunque la causa era que los grandes empleadores aparecen con varias variantes de nombre bajo el mismo
NIT. H3 separa dos dominios:

| Dominio | Dónde vive | Marcas |
|---|---|---|
| **A · Práctica** (`quality_flags` → `quality_status`) | `historico.practicas` | fechas, nivel, periodo, modalidad, estado, salario, seguimiento, fila truncada, duplicados (`MARCAS_CALIDAD`) |
| **B · Organización, en la fila** (`organization_flags`) | `historico.practicas` | `IDENTIFIER_MISSING`, `IDENTIFIER_INVALID`, `IDENTIFIER_NONSTANDARD`, `IDENTIFIER_PERSON_NATURAL`, `NIT_DV_INVALID`, `NAME_MISSING` |
| **B · Organización, en el catálogo** | `historico.organizaciones.quality_flags` | `MULTIPLE_ALIASES`, `ALIAS_SHARED_ACROSS_IDENTIFIERS`, `NIT_DV_INVALID`, `IDENTIFIER_NONSTANDARD`, `IDENTIFIER_PERSON_NATURAL`, `MAPPING_PENDING` |

Reglas:
- Las marcas de organización **nunca** cambian `quality_status`.
- `COMPANY_*` desaparece del catálogo de práctica.
- «Requiere revisión» = `MULTIPLE_ALIASES`, `ALIAS_SHARED_ACROSS_IDENTIFIERS`, `NIT_DV_INVALID` o
  `IDENTIFIER_NONSTANDARD`. `MAPPING_PENDING` es un estado, no un problema.

**Simulacro real, antes y después:**

| | H2 | H3 |
|---|---:|---:|
| Prácticas observadas | 128.620 (89,5 %) | **90.991 (63,3 %)** |
| … por ambigüedad de empresa | 96.971 (67,5 %) | **0** |
| … solo por `MISSING_LEVEL` | — | 73.615 |
| … por otras causas | — | 17.376 (12,1 %) |
| Prácticas limpias | 15.039 | 52.668 |

El grueso de lo observado es `MISSING_LEVEL`: `Nivel Formación` vacío. Es un hecho real de la fila, pero el ciclo se
infiere con fiabilidad de la asignatura, y por eso la política por métrica (§27.6) **no** excluye esas filas de
ninguna métrica.

Otras observadas solo por una marca:

| Marca | Filas |
|---|---:|
| `INVALID_END_DATE` | 6.318 |
| `SALARY_UNPARSEABLE` | 429 |
| `SALARY_OUTLIER` | 376 |
| `DURATION_EXTREME` | 197 |
| `DUPLICATE_ACTIVE_IN_PERIOD` | 186 |
| `MODALITY_MAPPING_PENDING` | 169 |
| resto | menos de 100 cada una |

### 27.2 Organizaciones: modelo definitivo

- **Identidad:** `organization_key` = HMAC del NIT base normalizado (sin DV cuando se identificó) o del identificador
  no estándar. El nombre **nunca** es identidad.
- **Datos guardados:**
  - en la versión: `identifier_kind`, `nit_dv_valid`, `empresa_alias_hash`, `organization_flags` y `organization_type_hint`;
  - en el catálogo: `alias_count`, `mapping_status` y `quality_flags`.
- **`organization_type_hint`**, solo cuando el identificador lo sustenta:
  - `LEGAL_ENTITY`: NIT base de 9 dígitos que empieza por 8 o 9 (rango DIAN de personas jurídicas);
  - `NATURAL_PERSON`: cédula con DV válido (11 dígitos) o cédula de 10 dígitos que empieza por 1;
  - `UNKNOWN`: el resto (6–8 dígitos, DV incorrecto, identificadores no estándar);
  - `NULL`: la fila no trae identificador.
- **Persona natural:** sin nombre en claro y sin NIT en claro. Nunca se convierte en organización operativa.
- **NIT en claro:** `nit_juridica`, solo para persona jurídica con DV válido.
- **Aliases:** `alias_hash` (HMAC del nombre canónico, versión de normalización `n1`) y su frecuencia por
  organización. 7.841 identificadores con varios alias **no** son errores por sí solos.

| Catálogo real (simulacro) | Organizaciones |
|---|---:|
| Total (claves distintas) | 44.070 |
| Pista LEGAL_ENTITY / NATURAL_PERSON / UNKNOWN | 31.373 / 3.906 / 8.791 |
| Con varios alias | 7.841 |
| Con un alias compartido por varios NIT | 10.391 |
| Con DV inválido | 1.756 |
| Identificador no estándar | 417 |
| **Requieren revisión** | **16.170** |

En las filas: `IDENTIFIER_PERSON_NATURAL` 5.886, `NIT_DV_INVALID` 2.237, `IDENTIFIER_NONSTANDARD` 488,
`IDENTIFIER_INVALID` 83, `IDENTIFIER_MISSING` 22 y `NAME_MISSING` 18. Hay 84.129 prácticas con una organización de
varios alias y ninguna queda observada por eso.

### 27.3 Correspondencia con SIPRA (sin mappings masivos)

`npm run historico:proponer-correspondencias -- [--source-system SGP] [--apply]`:

- **Propone** solo si se cumplen las tres condiciones: `nit_juridica` exacto igual a `empresas.nit_numero`, DV
  compatible con `empresas.nit_dv` y **un único** candidato.
- **Sin `--apply`** solo cuenta. **Con `--apply`** (y `HISTORICO_IMPORT_APPLY=true`) escribe
  `organizacion_mapping(method = 'nit_exacto', status = 'propuesta')`, **nunca** `confirmada`.
- **Nunca** propone por nombre: `ck_hmap_method` ni lo admite. **Nunca** escribe en `public`.
- `organizaciones.mapping_status` se deriva de las correspondencias (`sin_correspondencia` / `propuesta` /
  `confirmada` / `rechazada`). Equivale a pending / confirmed / rejected del encargo; los valores en español siguen
  la tabla de H2.
- En `sipra_dev` (fixture sintético): 29 jurídicas evaluadas y 0 candidatas, porque las empresas sintéticas de la
  semilla no comparten NIT con el fixture. La prueba PG cubre el caso positivo.

### 27.4 Programa → código SINU

- **Configuración versionable sin datos personales:** `apps/api/config/historico/programas-sgp.json`, validada al
  cargarla por `validarEquivalenciasProgramas`:
  - nombre normalizado;
  - sin duplicados;
  - una entrada `confirmado` exige un código SINU bien formado;
  - una `pendiente` no puede llevar código.
- **Solo una equivalencia `confirmado`** asigna `codigo_sinu` y `MAPPED`. Todo lo demás queda
  `PENDING_INSTITUTIONAL_MAPPING`.
- **La similitud de texto (Jaccard sobre palabras) solo SUGIERE:** aparece en el inventario y en las notas del
  archivo, y nunca se aplica.
- **Inventario real: 19 programas, 0 confirmados, 19 pendientes.** Cada uno tiene frecuencia, ciclo, regionales y
  pensums en el informe del simulacro. Sugerencias automáticas: solo «ADMINISTRACION DE EMPRESAS» ↔ «… AGROINDUSTRIALES»
  (0,67), que **no** son el mismo programa. «DISENO DE MODA Y PATRONAJE» (3 filas) frente a «DISENO DE MODAS» queda
  como candidato manual de renombramiento.
- **Importante para H4:** las versiones son inmutables, así que una equivalencia aprobada después de la carga no
  reescribe `codigo_sinu`. La capa analítica debe resolver el código desde **el mismo archivo** de equivalencias,
  con `programa_normalizado` como clave.

### 27.5 Periodos B / C, I y T, y `EMPRESA PROPIA`

- **B frente a C (presencial, por año):**

| Año | A | B | C |
|---|---:|---:|---:|
| 2020 | 7.120 | 4.620 | — |
| 2021 | 6.639 | 6.203 | — |
| 2022 | 5.968 | 6.203 | — |
| 2023 | 5.188 | 4.556 | — |
| 2024 | 3.166 | 3.710 | — |
| 2025 | 3.123 | 33 | 2.969 |
| 2026 | 2.548 | — | 1.483 |

  B existe de 2020 a 2024 (más 33 filas residuales en 2025) y C aparece en 2025 sin solaparse con B: la continuidad
  sugiere que **C sustituye a B**. No se unifican: `2024B` y `2025C` siguen siendo códigos distintos, y la decisión es
  institucional. D no aparece nunca.
- **Legado:** `2020I` 1, `2021I` 4, `2023I` 37, `2024I` 6, `21T04` 1, `21T05` 1, `22T01` 6, `22T04` 1. Siguen como
  `LEGACY` con `PERIOD_MAPPING_PENDING`, y no se crean periodos operativos.
- **`EMPRESA PROPIA`:** 424 filas (2019: 1, 2020: 352, 2021: 1, 2022: 24, 2023: 46). Siguen `MODALITY_MAPPING_PENDING`
  y `PENDING_INSTITUTIONAL_MAPPING`; no se mapean a validación de experiencia ni a CUNbre.

### 27.5 bis Solapamiento: política configurable

- **`HISTORICO_OVERLAP_POLICY`** = `CUTOFF_DATE` | `IDENTIFIER` | `COMBINED`. Por omisión, `COMBINED`, tomado de
  `config/historico/solapamiento.json`.
- **Fronteras por calendario** en el mismo archivo, hoy `null`: pendientes de decisión institucional.
- **Matriz** (`matrizSolapamiento`, función pura):
  - `historical_only` y `current_only`;
  - `candidate_overlap`: exactamente un registro de cada lado con la misma clave de proceso, estudiante + periodo +
    ciclo, no anulado. Lleva una «fuerza» (modalidad y fechas) solo informativa;
  - `confirmed_overlap`: solo con el `#` del SGP conservado en SIPRA;
  - `ambiguous_overlap`: varios registros en algún lado.
- **`seleccionarParaConteo`** decide qué contaría una métrica unificada:
  - `CUTOFF_DATE` y `IDENTIFIER` (sin P-42) **cuentan dos veces** el proceso que continuó en SIPRA; hay pruebas que
    lo demuestran;
  - `COMBINED`: SIPRA gana en confirmados, candidatos y ambiguos (exclusión conservadora); el histórico desde la
    frontera queda fuera; y una red de seguridad excluye cualquier histórico cuyo proceso ya cuenta desde SIPRA.
  - Una prueba de propiedad con 50 rondas aleatorias demuestra **0 procesos contados dos veces** con `COMBINED`.
- **Simulacro real** contra `sipra_dev` (solo lectura, 47 prácticas sintéticas): 143.659 solo históricos, 47 solo
  SIPRA, 0 candidatos, 0 confirmados, 0 ambiguos, y 0 procesos contados dos veces con las tres políticas. Era lo
  esperado: no hay estudiantes reales en `sipra_dev`.
- **Nada de esto escribe relaciones.** `analytics` no existe (H4).

### 27.5 ter P-42 · identificador del SGP en SIPRA

- `public` no tiene ninguna columna con el `#` del SGP. Las únicas columnas «origen» pertenecen a EPS y son ajenas.
- `practicas.numero_fur` es una secuencia propia (1–51 en `sipra_dev`).
- `auditoria` no registra ninguna importación ni carga inicial.
- Las 47 prácticas de `sipra_dev` son semillas (`registrada_por = 'coordinacion'`).

**Conclusión:** la carga inicial del SGP **nunca ocurrió**, así que no se perdió ningún identificador; simplemente no
existe la relación. Recomendación para P-42: si se cargan prácticas abiertas del SGP en la operación, guardar
`origen_sgp_id` (= `#`). Con eso `confirmed_overlap` sería exacto. Mientras tanto, `COMBINED` usa candidatos
(estudiante + periodo + ciclo) y nunca los declara confirmados. No se modificaron prácticas actuales.

### 27.6 Política de calidad por métrica

Única definición en `domain/historico/politica-calidad-historico.ts` (`POLITICA_CALIDAD`, `elegibilidadHistorica`).
H4 debe consultarla en vez de dispersar exclusiones en SQL.

**Reglas transversales:**
- solo cuentan las versiones vigentes de importaciones `completed`;
- de un grupo de filas idénticas cuenta solo el representante (`duplicado_de IS NULL`);
- las tasas de resultado excluyen el estado al corte;
- la calidad de organización solo afecta a la métrica de organización.

| Métrica | Clase | Excluye | Elegibles en el archivo real |
|---|---|---|---:|
| prácticas por periodo | limpia | periodo ausente o no interpretable, copia idéntica | 143.533 |
| prácticas | limpia | copia idéntica | 143.533 |
| estudiantes únicos | limpia | documento ausente o atípico | 143.658 |
| programa | limpia | programa ausente, copia | 143.531 |
| nivel | limpia | copia (`MISSING_LEVEL` **no** excluye) | 143.533 |
| regional | limpia | copia | 143.533 |
| modalidad de estudio | limpia | modalidad desconocida o ausente, copia | 143.461 |
| modalidad de práctica | limpia | copia (`EMPRESA PROPIA` aparte) | 143.533 |
| estado | limpia | estado desconocido, copia | 143.533 |
| tasas de cierre, reprobación y anulación | limpia | estado al corte, desconocido, copia | 136.128 |
| organización | condicionada | identificador ausente o inválido, copia | 143.428 |
| ciudad | condicionada | sin ciudad, copia (DIVIPOLA pendiente) | 143.512 |
| duración | condicionada | fechas inválidas, fin antes de inicio, fuera de rango, extrema, truncada, copia | 129.035 |
| salario | condicionada | no interpretable, atípico, copia | 141.502 |
| **indicador documental SGP** | condicionada | proporción inválida, aprobados > subidos, truncada, copia | 143.530 |
| actividad | condicionada | movimiento inválido, bitácora inválida, truncada, copia | 143.530 |

**«Indicador documental SGP»** es el nombre explícito de las proporciones subida y aprobada. **No** es Cumplimiento V3
ni se compara con su matriz documental.

### 27.7 Carga por lotes y fallos

`historico.importaciones.load_mode` = `single` | `batched`. Por omisión, `batched`.

**Flujo `batched`:**
1. Bloqueo consultivo **de sesión** durante toda la carga.
2. Transacción corta de preparación:
   - idempotencia;
   - cierre de huérfanas y purga de sus versiones;
   - versión de clave;
   - plan;
   - importación `processing`.
3. Cada lote de 2.000 se confirma como versiones con **`is_current = false`**, invisibles para lo vigente.
4. Transacción de **finalización** atómica: retira la vigencia anterior, marca vigentes las nuevas, refresca
   organizaciones y marca `completed`.

Ninguna importación parcial se ve como `completed` ni aporta vigentes.

**Si falla en el lote 8:**
- la importación queda `failed` con el error en `metadata`;
- sus versiones (nunca vigentes) se purgan;
- quien llama recibe `ImportacionFallidaError` y no se registra una segunda constancia.

**Si el proceso muere antes de purgar:** quedan versiones no vigentes de una `failed`. No se ven, y el siguiente APPLY
(que tiene el bloqueo) las purga antes de numerar versiones, para que no choquen con `ux_hprac_version`.

**`single`** sigue disponible: una transacción, adecuada para archivos pequeños.

**Elección:** la transacción única con 143.659 filas (unos 72 lotes) mantiene bloqueos y WAL durante toda la carga,
y un fallo tardío pierde todo el trabajo. `batched` la parte en transacciones cortas y concentra la visibilidad en
una finalización breve.

### 27.8 Rendimiento y memoria

**Dónde se iba la memoria en H2 (1.021 MB):**
1. **`exceljs`.** Con el orden del archivo real (`sheet1.xml` antes de `sharedStrings.xml`), copia la hoja completa
   (285 MB, con documentos y teléfonos numéricos) a un **temporal del sistema** hasta llegar a las cadenas, y retiene
   **todas** las cadenas compartidas, incluidos nombres, correos y funciones. Leer solo con él cuesta unos 840 MB de
   RSS. Ese temporal es un riesgo de PII en disco si el proceso muere.
2. **Los registros transformados.** Su heap vivo real, medido con GC forzado, es de unos 285 MB para 143.659.
3. **Basura** del análisis XML que V8 no recoge sin un límite de heap.

**Cambios:**
- **Lector en flujo propio** (`infrastructure/historico/lector-xlsx-flujo.ts`, solo `fs` y `zlib`):
  - lee el zip con acceso aleatorio, **sin temporales**;
  - hace una pasada por la hoja que descarta las filas sin `#` antes de guardar nada;
  - guarda solo las columnas permitidas, con las cadenas como índices;
  - hace una pasada por `sharedStrings.xml` conservando solo los índices usados: los nombres, correos y teléfonos de
    columnas excluidas **nunca llegan a memoria**;
  - es **equivalente fila a fila** al lector de `exceljs` sobre las 143.659 filas reales: 0 diferencias tras alinear
    los escapes `_xHHHH_`, que quedan literales como en `exceljs`;
  - `--lector exceljs` sigue disponible.
- **Internado de cadenas** de baja cardinalidad y liberación de la huella auxiliar tras las marcas de lote.
- **Tope de heap** en los comandos (`node --max-old-space-size=512`).

| Simulacro real | H2 | H3 |
|---|---:|---:|
| Tiempo | 69 s | 55–75 s (variación entre corridas) |
| Pico de memoria (RSS) | 1.021 MB | **531–581 MB** (≈ −45 %), incluidos unos 150 MB de ts-node |
| Heap vivo final | — | ≈ 285 MB |
| Temporales en disco | sí (`exceljs`) | **no** |

**Etapa intermedia CSV o *stream*:** no hace falta. El lector propio ya hace en memoria la etapa normalizada y
minimizada sin escribir nada en disco, que era el riesgo que una etapa intermedia debía evitar.

**Benchmark sintético con PostgreSQL** (`npm run benchmark:historico -- --registros 10000`; base temporal creada y
borrada por la herramienta; 10.000 registros más 63.000 filas fantasma, nada del Excel real).

El equipo estaba cargado durante la corrida: generar el lote tardó 26,8 s, frente a 8,6 s en una corrida anterior.
Las cifras son conservadoras y la extrapolación es aproximada.

| Paso | 10.000 | Extrapolado a 143.659 | Detalle de base |
|---|---:|---:|---|
| Simulacro (lectura + transformación) | 10,4 s | ≈ 2,5 min | — |
| APPLY por lotes (total) | **22,9 s** | ≈ 5,5 min | plan 0,15 s · inserción 4,3 s (5 lotes) · finalización 9,5 s |
| APPLY repetido (`ALREADY_IMPORTED`) | **0,02 s** | ≈ 0 | sin escrituras |
| Reversión | **0,42 s** | ≈ 6 s | 10.000 versiones retiradas |
| APPLY en una transacción (total) | 17,2 s | ≈ 4 min | inserción 7,6 s · finalización 0,7 s |

- Tamaño de `historico.practicas` con 10.000 versiones: 38 MB, es decir, unos 550 MB para 143.659 con índices.
- Memoria: pico de 317 MB (RSS) y heap vivo de unos 50 MB.

**Lectura de los números.** El modo por lotes cuesta más en la base que la transacción única: 13,8 s frente a 8,3 s
en 10.000. Su finalización cambia `is_current` fila a fila, lo que actualiza los índices parciales de lo vigente y
dispara el disparador de inmutabilidad. A cambio, no mantiene una transacción de minutos ni pierde todo ante un fallo
tardío, y ninguna versión es visible antes de terminar. Para unos 5–6 minutos de carga única no se justifica debilitar
el disparador. Si H4 necesitara bajar la finalización, la vía segura sería un disparador `BEFORE UPDATE OF <columnas
de contenido>`, que no se dispara al cambiar solo `is_current`, manteniendo la lista de columnas actualizada por
migración. Queda documentada, no aplicada.

### 27.9 HMAC: custodia, rotación y retención (sin ejecutar)

- **Sin clave institucional todavía.** Pruebas, simulacros y `sipra_dev` usan claves efímeras generadas en la corrida.
- **Custodia futura:**
  - `HISTORICO_HMAC_KEY` en Secret Manager del proyecto de cada ambiente, con acceso solo a la cuenta de servicio del
    trabajo de carga y a un rol de custodia;
  - `HISTORICO_HMAC_KEY_VERSION` como etiqueta (`v1`);
  - copia de respaldo institucional (escrow) bajo custodia dual (TI y Protección de Datos), porque sin la clave no se
    pueden recalcular las claves para la correspondencia futura.
- **Rotación.** Como `student_key` es determinística, rotar la clave cambia todas las claves. Dos estrategias,
  documentadas y no implementadas:
  - **re-key controlado**, que es la recomendada: un trabajo con las dos claves recalcula, versión a versión, las
    claves con `vN+1` en una nueva importación versionada; el contenido no cambia y solo las claves y
    `hmac_key_version`;
  - **búsqueda con clave doble:** durante una ventana, la correspondencia calcula la clave con ambas versiones.
  - Hoy, un APPLY con otra versión sobre lo vigente se rechaza (`VersionClaveIncompatibleError`).
- **Retención.** Sin decisión jurídica no se agregan columnas. El soporte técnico previsto es `retention_until`
  (nullable) y `legal_hold` (boolean) en `historico.importaciones`, con purga por importación (la misma unidad que la
  reversión). Se agregarían por migración cuando exista la política.

### 27.10 Minimización (sin cambios)

Se reconfirma automáticamente en las pruebas:
- la migración no tiene columnas de nombre, correo o teléfono del estudiante, nombre del docente, jefe ni funciones;
- los dos lectores nunca extraen esas columnas;
- el lector propio ni siquiera carga esas cadenas;
- ningún centinela del fixture aparece en registros, base ni salida;
- la configuración versionada no contiene correos ni números de más de 6 dígitos.

### 27.11 Pruebas y verificación

| Prueba | Resultado |
|---|---|
| Unitarias del histórico (10 suites: periodo, fechas, HMAC, normalización, registro, XLSX y los dos lectores, migraciones 25 y 26, política por métrica, solapamiento, programas y decisiones pendientes) | 141/141 |
| Suite completa de la API | 128 suites, 3.377 pruebas en verde |
| `npm run lint` (API y web) | 0 advertencias |
| `npm run build` (API y web) | OK |
| `npm run test:aislamiento` | 10/10 |
| `npm run smoke:arranque` (con la 26) | OK |
| `npm run verificar:secretos` | limpio |
| `sipra_dev` | migración 26 aplicada; fixture H2 revertido y recargado con H3 en modo `batched`: 0 marcas de empresa en prácticas, `organization_flags` y pistas correctas, duplicado apuntando al representante, 30 organizaciones `sin_correspondencia` con `MAPPING_PENDING` |
| `npm run test:pg:historico` (PostgreSQL 18 local, base desechable) | **85/85**, dos corridas seguidas |
| `npm run benchmark:historico` (10.000 registros) | completado (§27.8) |
| `npm run verificar:migraciones` | código de salida 0 · **141 comprobaciones estrictas · 0 fallas · 11 deudas heredadas** |

Un defecto encontrado **en la QA de `sipra_dev`** y corregido: sin correspondencias, el refresco dejaba todas las
organizaciones `rechazada`, porque un agregado sobre cero filas devolvía NULL. La prueba PG lo cubre.

**`test:pg:historico` en H3 confirma:**
- migraciones 25 y 26 aplicadas;
- ninguna marca de empresa en `quality_flags` y calidad de organización en `organization_flags`;
- pista de tipo solo donde se sustenta;
- una práctica limpia con empresa de varios alias sigue limpia;
- `duplicado_de` apunta al representante;
- catálogo con `MULTIPLE_ALIASES`, `ALIAS_SHARED_ACROSS_IDENTIFIERS` y `MAPPING_PENDING`;
- propuesta de correspondencias: simulacro sin escrituras, una única propuesta `nit_exacto` (la de DV incompatible
  no), ninguna confirmada y sin duplicar;
- carga por lotes `batched`;
- **fallo al confirmar el lote 8**: `failed`, versiones purgadas y vigentes intactas;
- **proceso caído antes de purgar**: 6 versiones no vigentes que el siguiente APPLY (modo `single`) purga antes de
  completar;
- bloqueo consultivo con otra carga en curso (`IMPORT_IN_PROGRESS`, sin escrituras);
- idempotencia, versionado, reversión LIFO y versión de clave;
- operación intacta (`public` idéntico).

**`verificar:migraciones`:** la sección H, estricta, valida la 26 de punta a punta:
- se aplica sobre una base poblada sin tocar `public`;
- agrega exactamente sus 6 columnas;
- baja limpia sin versiones y vuelve a subir;
- convive con la 25 cuando esta se niega a bajar con importaciones registradas.

Las deudas pasan de 9 a 11 por el mismo mecanismo heredado: las secuencias antiguas bajan un número fijo de
migraciones suponiendo que la 20 es la última, y con la 26 cada una se desplaza un paso más. Ninguna deuda involucra
a la 25 ni a la 26.

**`sipra_reportes_1000`:** sigue en la migración 23 (`CargueEstudiantePeriodo`), sin esquema `historico`. No se tocó.
No quedan bases temporales (`hist_*`, `mig_*`).

### 27.12 Bloqueos que siguen

1. ~~CREATEDB~~: resuelto (las tres validaciones pasaron); el privilegio puede retirarse.
2. **Decisiones institucionales** (§25.19):
   - base legal y retención;
   - custodia y escrow de la clave HMAC;
   - periodo frontera;
   - equivalencias programa → SINU (19 pendientes);
   - `EMPRESA PROPIA` (424);
   - B frente a C;
   - política de calidad aprobada.
3. **P-42:** si habrá carga inicial del SGP en la operación y si guardará `origen_sgp_id`.

---

## 28. Capa analítica unificada (H4)

> 20 de noviembre de 2026. **Datos reales importados: 0.** Solo se usaron el fixture sintético y lotes sintéticos.
> Reportes V3 y Cumplimiento V3 no se modificaron. La capa **no** está conectada a ningún controlador; eso es H5.

### 28.1 Arquitectura elegida y por qué

```
public.practicas (SIPRA) ─┐      lectura plana       ┌─► proyección al modelo común ─┐
                          ├──────────────────────────┤                               ├─► unión (solo lo confirmado se deduplica)
historico.practicas (SGP) ┘  vigentes de completed   └─► proyección al modelo común ─┘        │
          + organizaciones + correspondencias confirmadas                                     ▼
                                                              métricas con la política de calidad H3 → contrato
```

Se comparó con las alternativas:

| Opción | Decisión |
|---|---|
| A. Vista SQL | **No.** La identidad común de estudiante exige el HMAC del documento actual, y el secreto no puede estar en la base. La unión y la precedencia ya son funciones puras del dominio. |
| B. Vista materializada | **No por anticipación.** Ver §28.9: hoy no se justifica, y es la candidata si H5 lo necesita. |
| **C. Consulta encapsulada en repositorio + agregación en el dominio** | **Elegida.** Conserva el origen, admite filtros, es testeable con un repositorio en memoria, no duplica datos y aguanta el volumen futuro (§28.9). |
| D. Tabla analítica construida | **No.** Copiaría datos y crearía una tercera verdad. |

**Piezas:**

| Capa | Archivo |
|---|---|
| Dominio | `domain/analitica/modelo-analitico.ts` (modelo común, filtros, contrato) |
| Dominio | `domain/analitica/analitica-unificada.service.ts` (elegibilidad, unión, métricas, identidad) |
| Puertos | `domain/ports/out/analitica-unificada.port.ts` (lectura e identidad) |
| Aplicación | `application/use-cases/analitica/analitica-unificada.use-case.ts` |
| Infraestructura | `adapters/persistence/postgres/analitica-unificada.adapter.ts` (solo lectura) |
| Infraestructura | `infrastructure/historico/identidad-analitica.adapter.ts` (HMAC en memoria) |
| Migración 27 | `1756000027000-HistoricoCorrespondenciaPracticas.ts` |
| Herramientas | `analitica:validar` (interna, sin endpoint) y `test:pg:analitica` |

### 28.2 Fuente e identidad analítica

- **`source`:**
  - `current`: solo SIPRA;
  - `historical`: solo SGP, versiones `is_current` de importaciones `completed`; nunca `processing`, `failed` ni
    `reverted`;
  - `all`: la unión deduplicada.
- **`analyticsId`** estable y sin PK compartida: `current:<uuid de la práctica>` o
  `historical:<sistema>:<#>:<versión>`.
- **Estado al corte:** cada fila lleva `estadoAl` (ahora para SIPRA, la fecha de corte para el SGP) y
  `esEstadoDeCorte`. Una fila histórica abierta **no** está abierta hoy.

### 28.3 Modelo común

| Campo | SIPRA | SGP |
|---|---|---|
| periodo | `periodo_academico` | código normalizado; legado como `sgp:<original>` |
| programa | `sinu:<programa_id>` | `sinu:<código>` solo con equivalencia confirmada; si no, `sgp:<nombre normalizado>` |
| nivel | `ciclo` | `nivel_inferido` (mismo vocabulario: dimensión común) |
| regional | texto normalizado | texto normalizado (misma regla exacta, sin parecidos) |
| modalidad de estudio | no existe | `estudio:<virtual / presencial / a_distancia>` |
| modalidad de práctica | `modalidad:<enum>` | `modalidad:<enum>`; `EMPRESA PROPIA` como `sgp:EMPRESA PROPIA` («sin equivalente») |
| estado | `ESTADO_OPERATIVO` | `estado_analitico` (mismo vocabulario) |
| organización | `empresa:<uuid>` o texto del FUR | `empresa:<uuid>` con correspondencia confirmada; si no, `org-historica:<uuid>` con la etiqueta «Organización histórica sin correspondencia» |
| ciudad | `divipola:<código>` | `sgp-texto:<ciudad normalizada>` (no se fusionan sin DIVIPOLA) |
| fechas y duración | `fecha_fin − fecha_inicio`, solo si es mayor o igual a 0 | `duracion_dias`, ya nulo si las fechas no son válidas |
| indicador documental SGP | no aplica | proporciones subida y aprobada |

Las claves de dimensión son **seguras**: prefijo más código, uuid o texto de catálogo. Nunca un HMAC, un documento
ni un nombre reconstruido.

### 28.4 Identidad del estudiante

- En SIPRA, la identidad es `current:<usuario>`.
- En el SGP, `historical:<versión>:<student_key>`, que es **interna** y nunca sale.
- **En `all`**, el backend calcula **en memoria** el HMAC del documento de cada estudiante actual, una vez por
  estudiante y por versión de clave disponible, y el histórico con esa clave adopta la identidad del actual. El
  documento se descarta de inmediato y no se persiste.
- **Varias versiones de clave** (v1, v2…): el mapa se indexa por `versión:clave`. Si el histórico tiene una versión
  sin secreto disponible, `all` informa `precisionEstudiantes = 'cota_superior'` y una advertencia; nunca inventa
  identidades.
- **Sin `HISTORICO_HMAC_KEY`** en el proceso: no se leen documentos y `all` es una cota superior.
- **Alcance por escuelas:** el SGP no registra escuela, así que con un alcance restringido el histórico **no entra**
  y se advierte. Nunca se filtra de más.

### 28.5 Solapamiento y precedencia

- **Solo lo CONFIRMADO se deduplica.** Está registrado en `historico.practica_correspondencia` (migración 27): método
  `sgp_id` o `manual`, revisor obligatorio, una sola confirmada por registro del SGP y por práctica, y sin FK a
  `public`. La fila de SIPRA gana en `all` y la histórica sigue disponible en `historical`.
- **Candidatos y ambiguos** (matriz H3: mismo estudiante + periodo + ciclo) **no** son duplicados confirmados: cuentan
  en ambas fuentes y se informan en `solapamiento.categorias`.
- **Frontera institucional**, si se configura: el histórico desde la frontera sale de `all` con el motivo
  `DESPUES_DE_LA_FRONTERA`.
- **Categorías informadas:** `historical_only`, `current_only`, `matched`, `candidate_overlap`, `ambiguous_overlap`,
  más `excluidosDeAll` con su motivo. Nada desaparece sin explicación.
- Esto **reemplaza para H4** la exclusión conservadora de candidatos de `seleccionarParaConteo` (H3), por la regla del
  encargo: un parecido no es un duplicado.

### 28.6 Calidad y métricas

- **Exclusiones:** salen de `POLITICA_CALIDAD` (H3), sin reglas paralelas. La fila analítica aporta solo el requisito
  de dato de cada métrica.
- **Métricas limpias:** prácticas, estudiantes únicos, periodos, programas, niveles, regionales, modalidad de estudio,
  modalidad de práctica, estados, y tasas de cierre, reprobación y anulación.
  - Las tasas usan **solo estados finales** (cerrado, reprobado, anulado) en las dos fuentes; inscrito y en práctica
    no son un resultado.
  - En el SGP, además, se excluye el estado al corte.
- **Métricas condicionadas:**
  - organización: excluye identificador ausente o inválido;
  - ciudad;
  - duración: excluye `END_BEFORE_START`, fechas inválidas, `0000-00-00`, fuera de rango, extremas y filas truncadas.
- **Copias idénticas del SGP** (`duplicado_de`): cuentan una vez.
- **Indicador documental SGP:** sección propia y nula para `current`. **No** se combina con Cumplimiento.

### 28.7 Contrato y seguridad

`ResultadoAnaliticoUnificado` contiene: totales (con la precisión de estudiantes), dimensiones (clave segura,
etiqueta, origen `current` / `historical` / `comun` y valor), tasas, percentiles de duración, indicador documental
SGP, solapamiento y elegibilidad por métrica.

**No contiene** `student_key`, `teacher_key`, `organization_key`, HMAC, documentos, correos, teléfonos, nombres
históricos, identidades internas ni marcas de calidad. Las pruebas unitarias y PG lo verifican sobre el JSON
completo: ningún hex de 64 caracteres, ningún documento sembrado, ningún centinela.

### 28.8 Pruebas

| Prueba | Resultado |
|---|---|
| `test/analitica-unificada.spec.ts` (current, historical, all, solapamiento, estudiantes únicos, calidad, filtros, PII) | 19/19 |
| `test/analitica-arquitectura.spec.ts`: Cumplimiento y Reportes no importan el histórico ni la analítica; ningún módulo ni controlador la registra; el dominio no depende de infraestructura; SQL de la migración 27 | 7/7 |
| Suite completa de la API | 130 suites, 3.403 pruebas en verde (incluidas las de Reportes V3 y `cumplimiento-v3.spec`, sin regresión) |
| `npm run test:pg:analitica` (base temporal) | **todo en verde** |
| `npm run test:pg:historico` | 85/85 (ajustado a 6 tablas) |
| `npm run verificar:migraciones` | 145 comprobaciones estrictas · 0 fallas · 13 deudas heredadas |
| `npm run analitica:validar` en `sipra_dev` | CURRENT = operación = Reportes V3 (47 = 47 = 47) |
| lint, build, `test:aislamiento` (10/10), `smoke:arranque`, `verificar:secretos` | en verde |

**`test:pg:analitica`** construye, contra estudiantes sembrados, un solapamiento **confirmado** (con correspondencia
manual revisada), uno **candidato** y uno **ambiguo**, más una importación `reverted` y una `failed` con versiones sin
purgar. Comprueba:
- CURRENT = `practicas` = adaptador de Reportes V3, también filtrado por periodo;
- HISTORICAL = vigentes de la importación `completed` (253): las `reverted` y `failed` no aportan;
- ALL = CURRENT + HISTORICAL − 1 confirmado, con `matched` 1, `candidate` 1 y `ambiguous` 2, y solo lo confirmado
  sale de ALL;
- **estudiantes únicos** de ALL = actuales + históricos − 3 compartidos, con precisión `exacta`;
- sin clave, cota superior;
- alcance por escuelas;
- `EMPRESA PROPIA` separada y B/C sin unificar;
- tasas sin estados al corte;
- ausencia de PII.

**Migración 27 UP/DOWN/UP** (`verificar:migraciones`, sección H estricta): se aplica sobre una base poblada sin tocar
`public`, baja limpia sin filas, vuelve a subir, y se **niega** a bajar con una correspondencia registrada. Las deudas
heredadas suben de 11 a 13 por el mismo desplazamiento de siempre (las secuencias antiguas suponen la 20 como
última); ninguna involucra a las migraciones del histórico.

### 28.9 Rendimiento, plan e índices

Con 10.000 registros SGP sintéticos más la operación, en base temporal:

| Consulta | Tiempo |
|---|---:|
| historical (10.000) | 656 ms |
| historical · periodo 24V03 (845) | 50 ms |
| historical · nivel + modalidad (1.235) | 273 ms |
| current | 11 ms |
| all (10.003) | 689 ms |
| all · periodo 24V03 | 60 ms |

**Defecto encontrado y corregido por el plan.** La primera versión unía `historico.organizaciones` en la misma
consulta. Con la tabla recién cargada y sin estadísticas, el planificador estimó 1 fila y eligió un *nested loop*
con `Materialize`: `Rows Removed by Join Filter: 4.990.000`, es decir, 10.000 × 500, y **907 ms** solo en SQL. Ahora
el catálogo de organizaciones se lee en una **segunda consulta plana** y se une en memoria con un mapa (O(n + m)),
sin depender de las estadísticas:
- consulta de versiones: `Hash Join` + `Seq Scan` sobre lo vigente, **16–19 ms**;
- catálogo: `Index Scan ux_horg_clave`, **1,2 ms**;
- la prueba exige ningún nodo con más filas que las versiones leídas y menos de 200 ms.

**Índices:** **ninguno nuevo**. El `Seq Scan` es correcto porque se lee casi toda la tabla, y los índices parciales
de H2 (`ux_hprac_vigente`, `ix_hprac_periodo`) y `ux_horg_clave` cubren lo demás. No hay N+1 ni subconsultas por fila.
Hay un HMAC por estudiante actual y versión (solo en `all`), no por combinación.

**Extrapolación a 143.659:** unos 15 ms × 14 en SQL, más la proyección y agregación en Node (≈ 65 µs por fila):
**≈ 9–10 s por consulta sin filtros** y menos de 1 s filtrando por periodo. Es aceptable para validación interna,
**no** para una pantalla interactiva. Riesgo para H5 (§28.10).

**Recomendación al importador (no aplicada en H4):** ejecutar `ANALYZE` sobre las tablas de `historico` al terminar
una carga real, para que el planificador no trabaje con estadísticas vacías.

### 28.10 Riesgos para H5

1. **Latencia sin filtros con 143.659 registros** (≈ 9–10 s). Opciones, con evidencia y no por anticipación:
   - caché del resultado por filtro (Redis ya está en el stack; el histórico solo cambia al importar, así que la
     invalidación es simple);
   - una tabla de agregados derivada de lo vigente, refrescada al publicar una importación.
2. **Privilegios.** `sipra_app` no tiene acceso al esquema `historico`. H5 necesitará `SELECT` sobre `practicas`,
   `importaciones`, `organizaciones`, `organizacion_mapping` y `practica_correspondencia` (migración 28), y la API
   necesitará `HISTORICO_HMAC_KEY` para la identidad común. Sin ella, `all` es una cota superior.
3. **Alcance por escuelas:** el histórico solo se puede atribuir a escuelas con la equivalencia programa → SINU →
   escuela (0 de 19 confirmadas).
4. **Correspondencias de práctica:** hoy ninguna. Faltan la pantalla y el flujo de revisión, y la decisión sobre
   P-42 (`origen_sgp_id` en la carga inicial).
5. **Decisiones institucionales del §25.19** (B/C, `EMPRESA PROPIA`, programas, frontera, retención, custodia de la
   clave): siguen pendientes.
