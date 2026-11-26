# PC GENERADOR (PC B, Windows) · prepara los JWT de los estudiantes sintéticos ANTES de la ventana medida, contra la API de
# performance del PC SIPRA. Equivale a herramientas/preparar-tokens.cjs, pero sin Node y sin copiar tokens entre equipos.
# Usa el modo abierto EXISTENTE de dev (POST /auth/ingresar): no agrega ningún bypass. Escribe out\tokens.json
# ([{ i, correo, practicaId, token }], UTF-8 sin BOM) con el formato que lee lib/config.js. Los tokens son efímeros
# (vencen solos); out\ no se versiona.
#
#   powershell -ExecutionPolicy Bypass -File generador\preparar-tokens.ps1 -Base http://<IP_PC_SIPRA>:3100/api/v1 -Desde 103 -Cantidad 100
#   (desde la carpeta del kit; el rango lo confirma el PC SIPRA con herramientas/verificar-rango.cjs)
param(
  [Parameter(Mandatory = $true)][string]$Base,
  [Parameter(Mandatory = $true)][int]$Desde,
  [Parameter(Mandatory = $true)][int]$Cantidad
)
$ErrorActionPreference = 'Stop'
if ($Base -match 'localhost|127\.0\.0\.1|host\.docker\.internal') { throw 'BASE debe ser la IP LAN del PC SIPRA, no una dirección local' }
$t0 = Get-Date
$salida = New-Object System.Collections.Generic.List[object]
for ($i = $Desde; $i -lt $Desde + $Cantidad; $i++) {
  $correo = 'perf-est-{0:D4}@performance.invalid' -f $i
  $cuerpo = @{ rol = 'estudiante'; correo = $correo } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Method Post -Uri "$Base/auth/ingresar" -ContentType 'application/json' -Body $cuerpo -TimeoutSec 30
  if (-not $r.accessToken) { throw "ingreso de $correo sin accessToken" }
  $salida.Add([ordered]@{ i = $i; correo = $correo; practicaId = ('aaaaaaaa-0000-4000-8000-{0:D12}' -f $i); token = $r.accessToken })
}
New-Item -ItemType Directory -Force out | Out-Null
$json = ConvertTo-Json -InputObject @($salida.ToArray()) -Depth 3 -Compress
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'out\tokens.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("{0} tokens (estudiantes {1}-{2}) en {3:N0} ms -> out\tokens.json" -f $salida.Count, $Desde, ($Desde + $Cantidad - 1), ((Get-Date) - $t0).TotalMilliseconds)
