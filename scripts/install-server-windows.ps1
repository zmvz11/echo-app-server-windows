Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:NODE_ENV = "development"
$env:NPM_CONFIG_REGISTRY = "https://registry.npmjs.org/"
$env:NPM_CONFIG_AUDIT = "false"
$env:NPM_CONFIG_FUND = "false"

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}
function Get-NodeMajor {
  try {
    $version = node -p "process.versions.node.split('.')[0]" 2>$null
    if ($LASTEXITCODE -eq 0 -and $version) { return [int]$version.Trim() }
  } catch {}
  return 0
}
function Ensure-Node {
  Refresh-Path
  $major = Get-NodeMajor
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue) -and $major -ge 20) {
    Write-Host "Node: $(node --version)"
    Write-Host "npm:  $(npm --version)"
    return
  }
  Write-Host "Node.js 20+ is required. Attempting winget install..." -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Invoke-Checked "winget" @("install", "--id", "OpenJS.NodeJS.LTS", "-e", "--accept-source-agreements", "--accept-package-agreements")
    Refresh-Path
  }
  $major = Get-NodeMajor
  if (-not ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue) -and $major -ge 20)) {
    try { Start-Process "https://nodejs.org/" } catch {}
    throw "Install Node.js 20+ or 24 LTS, open a new terminal, then run INSTALL.bat again."
  }
}
function Ask([string]$Prompt, [string]$Default) {
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value.Trim()
}
function Add-UserPath([string]$PathToAdd) {
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($current) { $parts = $current -split ';' | Where-Object { $_ } }
  if ($parts -notcontains $PathToAdd) {
    [Environment]::SetEnvironmentVariable("Path", (($parts + $PathToAdd) -join ';'), "User")
    Write-Host "Added to user PATH: $PathToAdd"
  }
  $env:Path = "$env:Path;$PathToAdd"
}
function Copy-Project([string]$From, [string]$To) {
  if (-not (Test-Path $To)) { New-Item -ItemType Directory -Path $To | Out-Null }
  $skip = @('node_modules','dist','release','data','.git','.env')
  Get-ChildItem -LiteralPath $From -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
    $dest = Join-Path $To $_.Name
    if ($_.PSIsContainer) { Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force }
    else { Copy-Item -LiteralPath $_.FullName -Destination $dest -Force }
  }
}

Write-Host "============================================================"
Write-Host " Echo App Server - installer"
Write-Host "============================================================"
Ensure-Node

$defaultInstall = Join-Path $env:LOCALAPPDATA "EchoApps\EchoAppServer"
$installDir = [Environment]::ExpandEnvironmentVariables((Ask "Install Echo App Server to" $defaultInstall))

Write-Host "Installing source files to: $installDir"
Copy-Project $SourceRoot $installDir
Set-Location $installDir

try { npm config delete production --location=project 2>$null | Out-Null } catch {}
npm config set registry https://registry.npmjs.org/ --location=project | Out-Null

if ((Test-Path "node_modules") -and ((Test-Path "node_modules\.bin\tsc.cmd") -or (Test-Path "node_modules\.bin\tsc"))) {
  Write-Host "Dependencies already installed. Skipping npm install."
} else {
  Write-Host "Installing dependencies from npm..."
  Invoke-Checked "npm" @("install", "--include=dev", "--no-audit", "--no-fund", "--registry", "https://registry.npmjs.org/")
}

Write-Host "Building Echo App Server..."
Invoke-Checked "npm" @("run", "build")
if (-not (Test-Path "dist\index.js")) { throw "Build failed: dist\index.js missing." }
if (-not (Test-Path "dist\cli\index.js")) { throw "Build failed: dist\cli\index.js missing." }

Write-Host "Running guided setup wizard."
Invoke-Checked "node" @("dist\cli\index.js", "setup")
Invoke-Checked "node" @("dist\cli\index.js", "doctor")

$binDir = Join-Path $env:USERPROFILE ".echo\bin"
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
$escapedInstall = $installDir.Replace('%','%%')
@"
@echo off
cd /d "$escapedInstall"
node dist\cli\index.js %*
"@ | Set-Content -Path (Join-Path $binDir "echo-server.cmd") -Encoding ASCII
@"
@echo off
cd /d "$escapedInstall"
node dist\cli\index.js doctor %*
"@ | Set-Content -Path (Join-Path $binDir "echo-server-doctor.cmd") -Encoding ASCII
@"
@echo off
cd /d "$escapedInstall"
node dist\cli\index.js setup %*
"@ | Set-Content -Path (Join-Path $binDir "echo-server-setup.cmd") -Encoding ASCII

Add-UserPath $binDir

Write-Host "============================================================"
Write-Host " Echo App Server installed."
Write-Host " Open a NEW terminal and run: echo-server"
Write-Host " Start server:  echo-server start"
Write-Host " Diagnostics:   echo-server doctor"
Write-Host " Setup wizard:  echo-server setup"
Write-Host " Note: do not use 'echo' as the command. Windows owns that command."
Write-Host "============================================================"
