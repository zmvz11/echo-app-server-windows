Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Release = Join-Path $Root "release"
if (Test-Path $Release) { Remove-Item -Recurse -Force $Release }
New-Item -ItemType Directory -Path $Release | Out-Null
$Name = "Echo-App-Server-Windows-Source.zip"
$Destination = Join-Path $Release $Name
$exclude = @('node_modules','dist','release','data','.git','.env')
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("echo-server-win-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $Temp | Out-Null
Get-ChildItem -LiteralPath $Root -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  if ($_.PSIsContainer) { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Temp $_.Name) -Recurse -Force }
  else { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Temp $_.Name) -Force }
}
Compress-Archive -Path (Join-Path $Temp '*') -DestinationPath $Destination -Force
Remove-Item -Recurse -Force $Temp
Write-Host "Created $Destination"
