# PC GENERADOR (PC B, Windows) · CPU total, CPU/RAM del proceso k6 y red, por segundo, mientras dure la corrida.
# No necesita privilegios. Se detiene al crear out\<corrida>.stop-generador (lo hacen correr-externo.ps1 y correr-escalon.ps1).
# Tarda unos segundos en arrancar (CIM): quien lo lance debe ESPERAR a que out\<corrida>.generador.jsonl tenga 2+ líneas
# antes de iniciar k6 (en external-100-001 se lanzó k6 sin esperar y solo quedó 1 muestra).
#
#   powershell -File generador\monitor-generador.ps1 -Corrida <id>     (desde la carpeta performance\)
#   -Salida <carpeta>: carpeta out ABSOLUTA (la pasa correr-escalon.ps1). Sin ella: out\ junto a la raíz del kit
#   (carpeta padre de generador\), independiente del directorio de trabajo con el que se lance el proceso.
param([Parameter(Mandatory = $true)][string]$Corrida, [int]$SegundosMax = 3600, [string]$Salida = '')
$ErrorActionPreference = 'SilentlyContinue'
$out = if ($Salida) { $Salida } else { Join-Path (Split-Path -Parent $PSScriptRoot) 'out' }
New-Item -ItemType Directory -Force $out | Out-Null
$archivo = Join-Path $out "$Corrida.generador.jsonl"
$parada = Join-Path $out "$Corrida.stop-generador"
Remove-Item $parada -Force
$utf8 = New-Object System.Text.UTF8Encoding($false)   # sin BOM
[System.IO.File]::WriteAllText($archivo, '', $utf8)
Add-Type -AssemblyName Microsoft.VisualBasic
$info = New-Object Microsoft.VisualBasic.Devices.ComputerInfo
$cim = New-CimSession
$nicks = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' }
$nucleos = [Environment]::ProcessorCount
$ramTotalMb = [math]::Round($info.TotalPhysicalMemory / 1MB)
$prevK6 = $null; $prevRed = $null; $prevT = Get-Date
$picos = @{ cpuTotalPct = 0; k6CpuPct = 0; k6RamMb = 0; redTxMBs = 0; redRxMBs = 0 }
$libreMin = [double]::MaxValue
$fin = (Get-Date).AddSeconds($SegundosMax)
while ((Get-Date) -lt $fin -and -not (Test-Path $parada)) {
  $t = Get-Date
  $cpu = (Get-CimInstance -CimSession $cim Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
  $libre = [math]::Round($info.AvailablePhysicalMemory / 1MB)
  $k6 = Get-Process -Name k6
  $k6Cpu = ($k6 | Measure-Object CPU -Sum).Sum
  $k6Ws = ($k6 | Measure-Object WorkingSet64 -Sum).Sum
  $tx = 0; $rx = 0
  foreach ($n in $nicks) { $st = $n.GetIPStatistics(); $tx += $st.BytesSent; $rx += $st.BytesReceived }
  $seg = ($t - $prevT).TotalSeconds
  $m = [ordered]@{ t = $t.ToUniversalTime().ToString('o'); cpuTotalPct = $cpu; libreMb = $libre; k6RamMb = [math]::Round($k6Ws / 1MB) }
  if ($prevK6 -ne $null -and $seg -gt 0) { $m.k6CpuPct = [math]::Round((($k6Cpu - $prevK6) / $seg) * 100 / $nucleos, 1) }
  if ($prevRed -ne $null -and $seg -gt 0) { $m.redTxMBs = [math]::Round(($tx - $prevRed[0]) / $seg / 1MB, 2); $m.redRxMBs = [math]::Round(($rx - $prevRed[1]) / $seg / 1MB, 2) }
  $prevK6 = $k6Cpu; $prevRed = @($tx, $rx); $prevT = $t
  foreach ($k in @($picos.Keys)) { if ($m.Contains($k) -and $m[$k] -gt $picos[$k]) { $picos[$k] = $m[$k] } }
  if ($libre -lt $libreMin) { $libreMin = $libre }
  [System.IO.File]::AppendAllText($archivo, ($m | ConvertTo-Json -Compress) + "`n", $utf8)
  $espera = 1000 - ((Get-Date) - $t).TotalMilliseconds
  if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }
}
Remove-CimSession $cim
$resumen = [ordered]@{ corrida = $Corrida; nucleos = $nucleos; ramTotalMb = $ramTotalMb; libreMinMb = $libreMin; picos = $picos; nota = 'k6CpuPct y cpuTotalPct en % de la máquina completa' }
[System.IO.File]::WriteAllText((Join-Path $out "$Corrida.generador-resumen.json"), ($resumen | ConvertTo-Json), $utf8)
