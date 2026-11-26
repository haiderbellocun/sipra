# PC SIPRA (PC A) - precheck de RED hacia el generador (PC B). Solo lectura. Lo llama pc-sipra-iniciar.sh.
# NO asume Ethernet: la interfaz es la que Windows usa REALMENTE para llegar al generador (Find-NetRoute), sea Wi-Fi o
# cable. external-3000-003 paso por Wi-Fi (1 Gbps); el Ethernet de ambos equipos negocia 100 Mbps y seria el cuello.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File performance/herramientas/red-generador.ps1 -Generador 192.168.78.191 [-Interfaz Wi-Fi] [-MinMbps 200]
#
# Falla (codigo 1) si:
#   - no hay ruta hacia el generador, o la interfaz de esa ruta no es -Interfaz (cuando se indica), o no esta Up;
#   - el generador no es alcanzable en la red: su entrada ARP en esa interfaz queda ausente/Incomplete/Unreachable
#     (antes se envian pings: aunque el firewall del PC B bloquee el eco ICMP, la resolucion ARP ocurre igual);
#   - la API no responde en http://<IP de la interfaz>:3100/api/v1/salud;
#   - ETHERNET con enlace < MinMbps (8 uploads/s x 2,1 MB ~ 141 Mbps; 200 por defecto). En Wi-Fi la velocidad varia
#     segundo a segundo por la adaptacion de tasa: se reportan 5 lecturas (min/max) sin fallar por una lectura baja.
# El ping (respuestas y latencia) se REPORTA: el PC B puede bloquear el eco ICMP entrante.
# Salida: UNA linea JSON y codigo 0 = OK, 1 = falla (motivos en "fallas").
param([Parameter(Mandatory = $true)][string]$Generador, [string]$Interfaz = '', [int]$MinMbps = 200, [int]$Pings = 4)
$ErrorActionPreference = 'Stop'
$r = [ordered]@{ generador = $Generador; interfazEsperada = $(if ($Interfaz) { $Interfaz } else { $null }); fallas = @() }
try { $ruta = Find-NetRoute -RemoteIPAddress $Generador | Where-Object { $_.IPAddress } | Select-Object -First 1 } catch { $ruta = $null }
if (-not $ruta) {
  $r.fallas += "sin ruta hacia el generador $Generador"
} else {
  $a = Get-NetAdapter -InterfaceIndex $ruta.InterfaceIndex
  $r.interfaz = $a.Name
  $r.descripcion = $a.InterfaceDescription
  $r.tipo = $(if ($a.PhysicalMediaType -match '802\.11') { 'wifi' } elseif ($a.PhysicalMediaType -eq '802.3') { 'ethernet' } else { "$($a.PhysicalMediaType)" })
  $r.ipSipra = $ruta.IPAddress
  $r.estado = "$($a.Status)"
  if ($Interfaz -and $a.Name -ne $Interfaz) { $r.fallas += "la ruta al generador usa '$($a.Name)', no la interfaz esperada '$Interfaz'" }
  if ($a.Status -ne 'Up') { $r.fallas += "interfaz $($a.Name) no esta Up" }
  $lecturas = @(1..5 | ForEach-Object { [math]::Round((Get-NetAdapter -InterfaceIndex $a.ifIndex).ReceiveLinkSpeed / 1e6); Start-Sleep -Milliseconds 200 })
  $r.enlaceMbps = [ordered]@{ min = ($lecturas | Measure-Object -Minimum).Minimum; max = ($lecturas | Measure-Object -Maximum).Maximum }
  if ($r.tipo -eq 'ethernet' -and $r.enlaceMbps.max -lt $MinMbps) { $r.fallas += "Ethernet a $($r.enlaceMbps.max) Mbps < $MinMbps Mbps: seria el cuello de botella a 8 uploads/s (~141 Mbps)" }
  if ($r.tipo -eq 'wifi' -and $r.enlaceMbps.max -lt $MinMbps) { $r.fallas += "Wi-Fi sin ninguna lectura >= $MinMbps Mbps (max $($r.enlaceMbps.max))" }
  $otras = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.ifIndex -ne $a.ifIndex } | ForEach-Object { $_.Name })
  if ($otras.Count) { $r.otrasInterfacesUp = $otras }
}
$p = @(Test-Connection -ComputerName $Generador -Count $Pings -ErrorAction SilentlyContinue)
$r.ping = [ordered]@{ enviados = $Pings; respuestas = $p.Count
  mediaMs = $(if ($p.Count) { [math]::Round(($p | Measure-Object ResponseTime -Average).Average, 1) } else { $null })
  nota = $(if ($p.Count) { $null } else { 'sin respuestas ICMP: el PC B puede bloquear el eco entrante (se usa ARP como prueba de alcance)' }) }
if ($ruta) {
  $vecino = Get-NetNeighbor -IPAddress $Generador -InterfaceIndex $ruta.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1
  $r.arp = $(if ($vecino) { "$($vecino.State)" } else { 'ausente' })
  if ($r.arp -in @('ausente', 'Incomplete', 'Unreachable')) { $r.fallas += "el generador $Generador no responde en la red por $($r.interfaz) (ARP: $($r.arp))" }
}
if ($r.ipSipra) {
  try { $r.apiPorInterfaz = (Invoke-WebRequest -UseBasicParsing "http://$($r.ipSipra):3100/api/v1/salud" -TimeoutSec 5).StatusCode } catch { $r.apiPorInterfaz = 'sin respuesta' }
  if ($r.apiPorInterfaz -ne 200) { $r.fallas += "la API no responde en http://$($r.ipSipra):3100" }
}
$r.ok = ($r.fallas.Count -eq 0)
$r | ConvertTo-Json -Compress -Depth 4
if ($r.ok) { exit 0 } else { exit 1 }
