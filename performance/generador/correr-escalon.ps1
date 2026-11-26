# PC GENERADOR (PC B, Windows) · UNA corrida (P10 escalón o P11 sostenida) con k6 NATIVO. Desde cualquier carpeta:
# todas las rutas se resuelven contra la raíz del kit (carpeta padre de generador\).
#
#   P11, tokens ya preparados y validados en out\tokens.json (NO se regeneran):
#   powershell -ExecutionPolicy Bypass -File generador\correr-escalon.ps1 -Escenario 11-sostenida-upload `
#     -Base http://<IP_PC_SIPRA>:3100/api/v1 -Corrida external-3000-001 -Uploads 3000 -Desde 453 -UsarTokensExistentes
#
#   Solo probar el arranque y la detención del monitor (sin k6, sin peticiones, sin tocar tokens):
#   powershell -ExecutionPolicy Bypass -File generador\correr-escalon.ps1 -Corrida external-3000-001 -SoloMonitor
#
#   Solo validar out\tokens.json (sin k6 ni monitor; no modifica el archivo):
#   powershell -ExecutionPolicy Bypass -File generador\correr-escalon.ps1 -SoloValidarTokens -Uploads 3000 -Desde 453
#
#   Prueba en seco de k6 (sin peticiones ni tokens):
#   powershell -ExecutionPolicy Bypass -File generador\correr-escalon.ps1 -Seco -Escenario 11-sostenida-upload
#
# Pasos: 1) tokens (preparados aquí, o los existentes validados con -UsarTokensExistentes); 2) UN monitor del generador
# (sin stop previo, sin otro monitor de la misma corrida), esperando 2+ muestras y con el proceso vivo; 3) k6;
# 4) detiene el monitor; 5) out\<corrida>.resultados.zip. out\tokens.json solo se borra si TODO terminó bien.
# No encadena corridas: la siguiente solo se lanza si la COMPUERTA del PC SIPRA dice CONTINUAR.
param(
  [string]$Base = '', [string]$Corrida = '', [int]$Uploads = 0, [int]$Desde = 0,
  [ValidateSet('10-escalones-upload', '11-sostenida-upload')][string]$Escenario = '10-escalones-upload',
  [int]$Tasa = 8, [int]$MaxVus = 600,
  [switch]$UsarTokensExistentes, [switch]$SoloMonitor, [switch]$SoloValidarTokens, [switch]$Seco
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
[Environment]::CurrentDirectory = $raiz          # Start-Process y .NET usan este directorio, no el de PowerShell
$out = Join-Path $raiz 'out'
New-Item -ItemType Directory -Force $out | Out-Null
$tokens = Join-Path $out 'tokens.json'

# Carga PLANA de out\tokens.json. En Windows PowerShell 5.1, ConvertFrom-Json emite el array JSON como UN solo objeto
# (no lo enumera): @(... | ConvertFrom-Json) produce un array de 1 elemento cuyo elemento es el Object[] completo.
# El foreach enumera ese array (o el objeto suelto) y deja exactamente un PSCustomObject por token.
function Leer-Tokens {
  $crudo = Get-Content -LiteralPath $tokens -Raw -Encoding UTF8 | ConvertFrom-Json
  return , @(foreach ($x in $crudo) { $x })
}

function Validar-Tokens([int]$desde, [int]$cantidad) {
  if (-not (Test-Path $tokens)) { throw 'Falta out\tokens.json' }
  $t = Leer-Tokens
  $ids = @(foreach ($x in $t) { [int]$x.i })
  $incompletos = @(foreach ($x in $t) { if (-not $x.token -or -not $x.practicaId -or $null -eq $x.i) { $x } }).Count
  $duplicados = $ids.Count - @($ids | Sort-Object -Unique).Count
  $enOrden = $true; for ($k = 0; $k -lt $ids.Count; $k++) { if ($ids[$k] -ne $desde + $k) { $enOrden = $false; break } }
  $r = [ordered]@{ tipo = $t.GetType().FullName; total = $t.Count; tipoElemento = $(if ($t.Count) { $t[0].GetType().FullName } else { '—' })
    primero = $(if ($t.Count) { $t[0].i } else { $null }); tipoPrimero = $(if ($t.Count) { $t[0].i.GetType().FullName } else { '—' })
    ultimo = $(if ($t.Count) { $t[-1].i } else { $null }); incompletos = $incompletos; duplicados = $duplicados; enOrden = $enOrden }
  Write-Host ("Tokens: tipo {0} · total {1} · elemento {2} · primero {3} ({4}) · último {5} · incompletos {6} · duplicados {7} · en orden {8}" -f `
    $r.tipo, $r.total, $r.tipoElemento, $r.primero, $r.tipoPrimero, $r.ultimo, $r.incompletos, $r.duplicados, $r.enOrden)
  if ($r.total -ne $cantidad -or $r.primero -ne $desde -or $r.ultimo -ne ($desde + $cantidad - 1) -or $incompletos -or $duplicados -or -not $enOrden) {
    throw "out\tokens.json no corresponde al rango $desde–$($desde + $cantidad - 1) de $cantidad tokens"
  }
  Write-Host "VALIDACIÓN -UsarTokensExistentes: OK ($cantidad tokens, $desde–$($desde + $cantidad - 1))"
}

function Iniciar-Monitor([string]$c) {
  $jsonl = Join-Path $out "$c.generador.jsonl"
  $parada = Join-Path $out "$c.stop-generador"
  # 1) sin señal de parada previa
  Remove-Item $parada -Force -ErrorAction SilentlyContinue
  # 2) ningún otro monitor de esta corrida
  $otros = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*monitor-generador.ps1*' -and $_.CommandLine -like "*$c*" })
  if ($otros.Count -gt 0) { throw "Ya hay $($otros.Count) monitor(es) de $c (PID $(($otros.ProcessId) -join ', ')). Deténgalos: New-Item -ItemType File -Force '$parada'" }
  Remove-Item $jsonl -Force -ErrorAction SilentlyContinue
  # 3-4) exactamente un monitor, con directorio de trabajo y carpeta de salida explícitos; stderr a archivo
  $script = Join-Path $raiz 'generador\monitor-generador.ps1'
  $p = Start-Process powershell -WorkingDirectory $raiz -PassThru -WindowStyle Hidden `
    -RedirectStandardError (Join-Path $out "$c.monitor.err") -RedirectStandardOutput (Join-Path $out "$c.monitor.out") `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script`"", '-Corrida', $c, '-Salida', "`"$out`"")
  Set-Content -Path (Join-Path $out "$c.monitor.pid") -Value $p.Id
  # 5-6) esperar 2+ muestras con el proceso vivo
  $limite = (Get-Date).AddSeconds(90)
  $n = 0
  while ((Get-Date) -lt $limite) {
    if ($p.HasExited) { throw "El monitor terminó antes de medir (código $($p.ExitCode)); ver $c.monitor.err" }
    if (Test-Path $jsonl) { $n = @([System.IO.File]::ReadAllLines($jsonl) | Where-Object { $_ }).Count }
    if ($n -ge 2) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($n -lt 2) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; throw "El monitor no dio 2 muestras en 90 s ($n); ver $c.monitor.err. No se lanza k6" }
  if ($p.HasExited) { throw 'El monitor dejó de correr tras las primeras muestras: no se lanza k6' }
  Write-Host "Monitor del generador listo: PID $($p.Id), $n muestras en $jsonl"
  return $p
}

function Detener-Monitor($p, [string]$c) {
  New-Item -ItemType File -Force (Join-Path $out "$c.stop-generador") | Out-Null
  if (-not $p.WaitForExit(30000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Write-Warning 'El monitor no se detuvo en 30 s: forzado' }
}

if ($SoloMonitor) {
  if (-not $Corrida) { throw 'Falta -Corrida' }
  $c = "$Corrida-prueba-monitor"                  # no pisa los archivos de la corrida real
  $antes = if (Test-Path $tokens) { (Get-FileHash $tokens).Hash } else { $null }
  $p = Iniciar-Monitor $c
  Start-Sleep -Seconds 10
  $jsonl = Join-Path $out "$c.generador.jsonl"
  $muestras = @([System.IO.File]::ReadAllLines($jsonl) | Where-Object { $_ }).Count
  $activos = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*monitor-generador.ps1*' -and $_.CommandLine -like "*$c*" }).Count
  Detener-Monitor $p $c
  $despues = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*monitor-generador.ps1*' -and $_.CommandLine -like "*$c*" }).Count
  $tokensInfo = if (Test-Path $tokens) { "$((Leer-Tokens).Count) (sin cambios: $((Get-FileHash $tokens).Hash -eq $antes))" } else { 'no hay out\tokens.json' }
  Write-Host "MONITOR AUTOMÁTICO: FUNCIONANDO · monitores activos durante la prueba: $activos · tras detener: $despues · muestras tras 10 s: $muestras · resumen: $(Test-Path (Join-Path $out "$c.generador-resumen.json")) · tokens: $tokensInfo"
  Remove-Item (Join-Path $out "$c.*") -Force -ErrorAction SilentlyContinue
  exit 0
}

if ($SoloValidarTokens) {
  # Solo valida out\tokens.json (sin k6, sin monitor, sin tocar el archivo).
  if ($Uploads -lt 1 -or $Desde -lt 1) { throw 'Faltan -Uploads o -Desde' }
  $antes = (Get-FileHash $tokens).Hash
  Validar-Tokens $Desde $Uploads
  Write-Host "out\tokens.json sin cambios: $((Get-FileHash $tokens).Hash -eq $antes)"
  exit 0
}

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) { throw 'k6 no está instalado en este equipo (k6 nativo; no Docker)' }
if (-not (Test-Path "scenarios\$Escenario.js") -or -not (Test-Path 'lib') -or -not (Test-Path 'archivos\medio.pdf')) { throw 'Falta scenarios\, lib\ o archivos\medio.pdf en la raíz del kit' }

# VERSIÓN DEL KIT (P11): lib\resumen.js debe escribir ventanaK6 en el summary.json. En external-3000-003 el PC B corrió
# un lib\resumen.js anterior y la compuerta cayó a la ventana aproximada. Sin la versión nueva no se ejecuta nada.
$resumenJs = Join-Path $raiz 'lib\resumen.js'
$huellaResumen = (Get-FileHash -Algorithm SHA256 -LiteralPath $resumenJs).Hash.Substring(0, 12)
if (-not (Select-String -LiteralPath $resumenJs -Pattern 'ventanaK6' -SimpleMatch -Quiet)) {
  throw "lib\resumen.js DESACTUALIZADO (SHA256 $huellaResumen…, sin ventanaK6): descomprima el kit vigente COMPLETO en una carpeta nueva"
}
Write-Host "Kit: lib\resumen.js con ventanaK6 (SHA256 $huellaResumen…)"

# ¿El summary.json escrito por k6 trae la ventana real? (lo exige la compuerta del PC SIPRA)
function Verificar-VentanaK6([string]$archivo) {
  if (-not (Test-Path $archivo)) { Write-Warning "No existe $archivo"; return $false }
  $v = (Get-Content -LiteralPath $archivo -Raw -Encoding UTF8 | ConvertFrom-Json).ventanaK6
  if (-not $v -or -not $v.inicio -or -not $v.fin) { Write-Warning "$archivo NO trae ventanaK6: la compuerta dará STOP en ventana-k6"; return $false }
  Write-Host ("VENTANAK6 OK: inicio {0} · fin {1} · {2:N1} s (reloj de este equipo)" -f $v.inicio, $v.fin, ($v.duracionMs / 1000))
  return $true
}

if ($Seco) {
  $sumSeco = Join-Path $out "seco-$Escenario.summary.json"
  Remove-Item $sumSeco -Force -ErrorAction SilentlyContinue   # que la verificación lea el de ESTA prueba
  & k6 run --quiet -e BASE=http://no-usado -e UPLOADS=1 -e SECO=1 -e "CORRIDA=seco-$Escenario" "scenarios\$Escenario.js"
  if ($LASTEXITCODE -ne 0) { throw "prueba en seco: k6 terminó con código $LASTEXITCODE" }
  if (-not (Verificar-VentanaK6 $sumSeco)) { throw 'prueba en seco: el summary.json no trae ventanaK6' }
  Write-Host 'Prueba en seco OK: busque dos líneas SECO_OK con bytes = 2096839 en la salida de arriba.'
  exit 0
}

if (-not $Base -or -not $Corrida -or $Uploads -lt 1 -or $Desde -lt 1) { throw 'Faltan -Base, -Corrida, -Uploads o -Desde' }
if ($Base -match 'localhost|127\.0\.0\.1|host\.docker\.internal') { throw 'BASE debe ser la IP LAN del PC SIPRA' }
if (Test-Path (Join-Path $out "$Corrida.summary.json")) { throw "Ya existe out\$Corrida.summary.json: cada corrida es nueva (use otro -Corrida)" }

# 1) Tokens: preparar, o validar los existentes (rango exacto, completos, sin duplicados). Nunca se regeneran aquí.
if (-not $UsarTokensExistentes) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $raiz 'generador\preparar-tokens.ps1') -Base $Base -Desde $Desde -Cantidad $Uploads
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los tokens' }
}
Validar-Tokens $Desde $Uploads

# 2) Monitor (falla ⇒ no hay k6 y los tokens se conservan)
$monitor = Iniciar-Monitor $Corrida

# 3) k6
$t0 = Get-Date
& k6 run --quiet "--log-output=file=out\$Corrida.k6.log" -e "BASE=$Base" -e "UPLOADS=$Uploads" -e OFFSET=0 -e ARCHIVO=medio -e TIPO=carta_aceptacion -e "CORRIDA=$Corrida" -e "TASA=$Tasa" -e "MAX_VUS=$MaxVus" "scenarios\$Escenario.js"
$codigo = $LASTEXITCODE
$duracion = ((Get-Date) - $t0).TotalSeconds

# 4) Detener el monitor
Start-Sleep -Seconds 3
Detener-Monitor $monitor $Corrida
$ventanaOk = Verificar-VentanaK6 (Join-Path $out "$Corrida.summary.json")

# 5) Paquete para el PC SIPRA (sin tokens)
$archivos = @("$Corrida.k6.log", "$Corrida.summary.json", "$Corrida.generador.jsonl", "$Corrida.generador-resumen.json", "$Corrida.monitor.err") | ForEach-Object { Join-Path $out $_ } | Where-Object { Test-Path $_ }
Compress-Archive -Path $archivos -DestinationPath (Join-Path $out "$Corrida.resultados.zip") -Force
if ($codigo -eq 0) { Remove-Item $tokens -Force } else { Write-Warning "k6 terminó con código ${codigo}: se conserva out\tokens.json" }
Write-Host ("k6 terminó con código {0} en {1:N0} s (los umbrales de k6 no son SLA: decide la compuerta del PC SIPRA)." -f $codigo, $duracion)
if (-not $ventanaOk) { Write-Warning 'El summary.json NO trae ventanaK6: avise antes de cerrar la corrida en el PC SIPRA.' }
Write-Host "Copie out\$Corrida.resultados.zip al PC SIPRA y descomprímalo en performance\out\."
