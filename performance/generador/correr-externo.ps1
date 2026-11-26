# PC GENERADOR (PC B, Windows) · ejecuta una corrida con k6 NATIVO (sin Docker) contra la API de performance del PC SIPRA,
# con el monitor del generador en paralelo. Desde la carpeta performance\ copiada al PC B:
#
#   powershell -ExecutionPolicy Bypass -File generador\correr-externo.ps1 `
#     -Base http://<IP_PC_SIPRA>:3100/api/v1 -Escenario 03-upload -Corrida 03-upload-100-lan -Vus 100 -Offset 0 -Archivo medio
#
# Calibración de red/generador (con el ECO levantado en el PC SIPRA en el puerto 3100 y la API detenida):
#   ... -Escenario 00-calibracion-generador -Eco http://<IP_PC_SIPRA>:3100 -Corrida 00-calibracion-100-lan -Vus 100
#
# Al terminar, copie al PC SIPRA (performance\out\): <corrida>.k6.log, <corrida>.summary.json,
# <corrida>.generador.jsonl y <corrida>.generador-resumen.json.
param(
  [Parameter(Mandatory = $true)][string]$Corrida,
  [Parameter(Mandatory = $true)][string]$Escenario,
  [string]$Base = '', [string]$Eco = '', [int]$Vus = 100, [int]$Offset = 0, [string]$Archivo = 'medio'
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) { throw 'k6 no está instalado en este equipo (k6 nativo; no Docker)' }
if (-not (Test-Path 'scenarios') -or -not (Test-Path 'lib')) { throw 'Ejecute desde la carpeta performance\' }
if (-not (Test-Path "archivos\$($Archivo -replace 'medio-jpg','medio').*")) { Write-Warning 'No se encuentra el archivo sintético en archivos\ (cópielo o genere con node herramientas\generar-archivos.cjs)' }
if ($Escenario -ne '00-calibracion-generador' -and -not (Test-Path 'out\tokens.json')) { throw 'Falta out\tokens.json (prepárelo en el PC SIPRA con pc-sipra-iniciar.sh y cópielo)' }
New-Item -ItemType Directory -Force out | Out-Null
$log = "out\$Corrida.k6.log"
$monitor = Start-Process powershell -ArgumentList @('-NoProfile', '-File', 'generador\monitor-generador.ps1', '-Corrida', $Corrida) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$argumentos = @('run', '--quiet', "--log-output=file=$log", '-e', "VUS=$Vus", '-e', "OFFSET=$Offset", '-e', "ARCHIVO=$Archivo", '-e', "CORRIDA=$Corrida")
if ($Base) { $argumentos += @('-e', "BASE=$Base") }
if ($Eco) { $argumentos += @('-e', "ECO=$Eco", '-e', 'BASE=http://no-usado') }
$argumentos += "scenarios\$Escenario.js"
& k6 @argumentos
$codigo = $LASTEXITCODE
Start-Sleep -Seconds 2
New-Item -ItemType File -Force "out\$Corrida.stop-generador" | Out-Null
$monitor.WaitForExit(30000) | Out-Null
Write-Host "k6 terminó con código $codigo. Copie al PC SIPRA: out\$Corrida.k6.log, out\$Corrida.summary.json, out\$Corrida.generador.jsonl, out\$Corrida.generador-resumen.json"
exit $codigo
