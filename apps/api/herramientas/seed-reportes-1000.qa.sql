-- QA de reportes_seed_1000 (SOLO comprobación sobre la base sintética; no es lógica del producto).
-- Uso: psql -h 127.0.0.1 -p 55432 -U postgres -d sipra_reportes_1000 -f herramientas/seed-reportes-1000.qa.sql
-- Discriminador del dataset: ids con prefijo 5eed1000- (1 estudiante, 2 práctica, 3 documento, 4 empresa, 5 docente).

\echo '== Totales (estudiantes únicos, prácticas, versiones, documentos práctica·tipo)'
SELECT count(DISTINCT p.estudiante_id) AS estudiantes, count(*) AS practicas,
       (SELECT count(*) FROM documentos d WHERE d.id::text LIKE '5eed1000-3%') AS versiones,
       (SELECT count(DISTINCT (d.practica_id, d.tipo)) FROM documentos d WHERE d.id::text LIKE '5eed1000-3%') AS documentos
FROM practicas p WHERE p.id::text LIKE '5eed1000-2%';

\echo '== Periodo (orden de periodos_academicos.fecha_inicio)'
SELECT p.periodo_academico AS periodo, pa.calendario, pa.fecha_inicio, count(DISTINCT p.estudiante_id) AS estudiantes, count(*) AS practicas,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM practicas p LEFT JOIN periodos_academicos pa ON pa.codigo = p.periodo_academico
WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1, 2, 3 ORDER BY pa.fecha_inicio NULLS LAST, 1;

\echo '== Escuela'
SELECT ce.nombre AS escuela, count(DISTINCT p.estudiante_id) AS estudiantes
FROM practicas p JOIN cat_escuela ce ON ce.codigo = p.escuela_id WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1 ORDER BY 2 DESC;

\echo '== Programa'
SELECT p.escuela_id, p.programa_id, sp.nombre AS nombre_sintetico, count(DISTINCT p.estudiante_id) AS estudiantes,
       count(DISTINCT p.modalidad) AS modalidades, count(DISTINCT p.periodo_academico) AS periodos
FROM practicas p LEFT JOIN sintetico_programa sp ON sp.codigo = p.programa_id
WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1, 2, 3 ORDER BY 1, 2;

\echo '== Periodos usados que NO están en periodos_academicos (debe ser 0)'
SELECT count(*) AS periodos_fuera_del_catalogo FROM (SELECT DISTINCT periodo_academico FROM practicas WHERE id::text LIKE '5eed1000-2%') x
WHERE NOT EXISTS (SELECT 1 FROM periodos_academicos pa WHERE pa.codigo = x.periodo_academico);

\echo '== Semestre (overlay sintético) y nivel'
SELECT s.semestre, p.ciclo, count(DISTINCT p.estudiante_id) AS estudiantes
FROM practicas p JOIN sintetico_semestre_practica s ON s.practica_id = p.id WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1, 2 ORDER BY 1;

\echo '== Nivel'
SELECT ciclo, count(DISTINCT estudiante_id) AS estudiantes FROM practicas WHERE id::text LIKE '5eed1000-2%' GROUP BY 1 ORDER BY 1;

\echo '== Modalidad'
SELECT modalidad, count(DISTINCT estudiante_id) AS estudiantes, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM practicas WHERE id::text LIKE '5eed1000-2%' GROUP BY 1 ORDER BY 2 DESC;

\echo '== Estado de la práctica'
SELECT estado, count(*) AS practicas FROM practicas WHERE id::text LIKE '5eed1000-2%' GROUP BY 1 ORDER BY 2 DESC;

\echo '== Mezclas mínimas: modalidades por programa, programas/escuelas/niveles/modalidades por periodo'
SELECT min(m) AS min_modalidades_por_programa FROM (SELECT count(DISTINCT modalidad) m FROM practicas WHERE id::text LIKE '5eed1000-2%' GROUP BY programa_id) x;
SELECT periodo_academico, count(DISTINCT programa_id) AS programas, count(DISTINCT escuela_id) AS escuelas, count(DISTINCT ciclo) AS niveles,
       count(DISTINCT modalidad) AS modalidades FROM practicas WHERE id::text LIKE '5eed1000-2%' GROUP BY 1 ORDER BY 1;

\echo '== Versiones por documento (práctica·tipo)'
SELECT versiones, count(*) AS documentos FROM (
  SELECT practica_id, tipo, count(*) AS versiones FROM documentos WHERE id::text LIKE '5eed1000-3%' GROUP BY 1, 2) x GROUP BY 1 ORDER BY 1;

\echo '== Estado de la última versión (obligaciones cargadas)'
SELECT estado, count(*) FROM (SELECT DISTINCT ON (practica_id, tipo) estado FROM documentos WHERE id::text LIKE '5eed1000-3%'
  ORDER BY practica_id, tipo, version DESC) x GROUP BY 1 ORDER BY 2 DESC;

\echo '== Integridad temporal: decisiones anteriores a su carga (debe ser 0)'
SELECT count(*) AS decisiones_antes_de_la_carga FROM auditoria a JOIN documentos d ON d.id = a.entidad_id
WHERE a.accion = 'decision_documento' AND a.metadatos->>'seed' = 'reportes_seed_1000' AND a.ocurrido_en < d.cargado_en;

\echo '== Duplicados (deben ser 0): estudiante con más de una práctica, decisión duplicada por versión'
SELECT count(*) AS estudiantes_con_varias_practicas FROM (SELECT estudiante_id FROM practicas WHERE id::text LIKE '5eed1000-2%' GROUP BY 1 HAVING count(*) > 1) x;
SELECT count(*) AS versiones_con_decision_duplicada FROM (SELECT entidad_id FROM auditoria WHERE metadatos->>'seed' = 'reportes_seed_1000' GROUP BY 1 HAVING count(*) > 1) x;

-- ── v4 · Organización receptora (sector = sección CIIU de empresas.ciiu; ciudad = empresas.divipola_municipio) ──
-- Tipo de receptor: interna CUN = modalidad articulada del dominio (monitoria, social, investigacion,
-- practica_tecnica_investigacion, pasantia_investigativa, cunbre_naciente, cunbre_consolidado).
\echo '== Prácticas sin organización receptora (debe ser 0)'
SELECT count(*) AS sin_receptor FROM practicas WHERE id::text LIKE '5eed1000-2%' AND empresa_id IS NULL;

\echo '== Tipo de receptor'
SELECT CASE WHEN modalidad IN ('monitoria','social','investigacion','practica_tecnica_investigacion','pasantia_investigativa','cunbre_naciente','cunbre_consolidado')
            THEN 'interna_cun' ELSE 'externa' END AS tipo, count(*) AS practicas, count(DISTINCT empresa_id) AS organizaciones
FROM practicas WHERE id::text LIKE '5eed1000-2%' GROUP BY 1 ORDER BY 1;

\echo '== Estudiantes por empresa externa (mín, máx, media)'
SELECT count(*) AS empresas, min(n) AS minimo, max(n) AS maximo, round(avg(n), 1) AS media FROM (
  SELECT p.empresa_id, count(DISTINCT p.estudiante_id) AS n FROM practicas p
  WHERE p.id::text LIKE '5eed1000-2%' AND p.modalidad NOT IN ('monitoria','social','investigacion','practica_tecnica_investigacion','pasantia_investigativa','cunbre_naciente','cunbre_consolidado')
  GROUP BY 1) x;

\echo '== Sector (sección CIIU)'
SELECT cc.seccion AS sector, cs.descripcion, count(DISTINCT p.empresa_id) AS empresas, count(DISTINCT p.estudiante_id) AS estudiantes,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM practicas p JOIN empresas e ON e.id = p.empresa_id LEFT JOIN cat_ciiu cc ON cc.codigo = e.ciiu LEFT JOIN cat_ciiu cs ON cs.codigo = cc.seccion
WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1, 2 ORDER BY 4 DESC;

\echo '== Ciudad (DIVIPOLA)'
SELECT coalesce(dv.municipio, '(sin municipio: exterior)') AS ciudad, count(DISTINCT p.empresa_id) AS empresas, count(DISTINCT p.estudiante_id) AS estudiantes,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM practicas p JOIN empresas e ON e.id = p.empresa_id LEFT JOIN cat_divipola dv ON dv.codigo = e.divipola_municipio
WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1 ORDER BY 3 DESC;

\echo '== Coherencia: una empresa = un sector y una ciudad (debe ser 0)'
SELECT count(*) AS empresas_incoherentes FROM (SELECT p.empresa_id FROM practicas p JOIN empresas e ON e.id = p.empresa_id
  WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1 HAVING count(DISTINCT e.ciiu) > 1 OR count(DISTINCT e.divipola_municipio) > 1) x;

\echo '== Cruces (celdas con datos): programa×sector, programa×ciudad, nivel×sector, modalidad×sector, periodo×ciudad'
SELECT 'programa_sector' AS cruce, count(*) AS celdas, min(n), max(n) FROM (SELECT p.programa_id, e.ciiu, count(*) n FROM practicas p JOIN empresas e ON e.id = p.empresa_id JOIN cat_ciiu cc ON cc.codigo = e.ciiu WHERE p.id::text LIKE '5eed1000-2%' GROUP BY p.programa_id, cc.seccion, e.ciiu) x
UNION ALL SELECT 'programa_sectores_distintos', count(*), min(n), max(n) FROM (SELECT p.programa_id, count(DISTINCT cc.seccion) n FROM practicas p JOIN empresas e ON e.id = p.empresa_id JOIN cat_ciiu cc ON cc.codigo = e.ciiu WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1) x
UNION ALL SELECT 'programa_ciudades_distintas', count(*), min(n), max(n) FROM (SELECT p.programa_id, count(DISTINCT e.divipola_municipio) n FROM practicas p JOIN empresas e ON e.id = p.empresa_id WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1) x
UNION ALL SELECT 'nivel_sector', count(*), min(n), max(n) FROM (SELECT p.ciclo, cc.seccion, count(*) n FROM practicas p JOIN empresas e ON e.id = p.empresa_id JOIN cat_ciiu cc ON cc.codigo = e.ciiu WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1, 2) x
UNION ALL SELECT 'modalidad_sector', count(*), min(n), max(n) FROM (SELECT p.modalidad, cc.seccion, count(*) n FROM practicas p JOIN empresas e ON e.id = p.empresa_id JOIN cat_ciiu cc ON cc.codigo = e.ciiu WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1, 2) x
UNION ALL SELECT 'periodo_ciudad', count(*), min(n), max(n) FROM (SELECT p.periodo_academico, e.divipola_municipio, count(*) n FROM practicas p JOIN empresas e ON e.id = p.empresa_id WHERE p.id::text LIKE '5eed1000-2%' GROUP BY 1, 2) x;

\echo '== Internas CUN: programas, niveles, semestres, modalidades, periodos'
SELECT count(DISTINCT p.programa_id) AS programas, count(DISTINCT p.ciclo) AS niveles, count(DISTINCT s.semestre) AS semestres,
       count(DISTINCT p.modalidad) AS modalidades, count(DISTINCT p.periodo_academico) AS periodos, count(*) AS practicas
FROM practicas p JOIN sintetico_semestre_practica s ON s.practica_id = p.id
WHERE p.id::text LIKE '5eed1000-2%' AND p.modalidad IN ('monitoria','social','investigacion','practica_tecnica_investigacion','pasantia_investigativa','cunbre_naciente','cunbre_consolidado');
