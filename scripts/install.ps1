#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Repo = $env:ECHO_INSTALL_REPO,
  [string]$AssetPattern = $env:ECHO_INSTALL_ASSET_PATTERN,
  [string]$Tag = $env:ECHO_INSTALL_TAG,
  [switch]$NoOnboard
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Repo)) { $Repo = "zmvz11/echo-app-server-windows" }
if ([string]::IsNullOrWhiteSpace($AssetPattern)) { $AssetPattern = "echo-app-server-windows*.zip" }
if ([string]::IsNullOrWhiteSpace($Tag)) { $Tag = "latest" }

$script:UseColor = -not [Console]::IsOutputRedirected
function Color([string]$Text, [ConsoleColor]$Color) {
  if ($script:UseColor) { Write-Host $Text -ForegroundColor $Color } else { Write-Host $Text }
}
function Header {
  Write-Host ""
  Color "╔════════════════════════════════════════════════════════════╗" Cyan
  Write-Host "║                  Echo App Server Installer                ║"
  Color "╚════════════════════════════════════════════════════════════╝" Cyan
}
function Step([string]$Text) { Write-Host ""; Color "▶ $Text" Cyan }
function Ok([string]$Text) { Color "✓ $Text" Green }
function Warn([string]$Text) { Color "! $Text" Yellow }
function Fail([string]$Text) { Color "✗ $Text" Red; throw $Text }
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
    $version = node -p "Number(process.versions.node.split('.')[0])" 2>$null
    if ($LASTEXITCODE -eq 0 -and $version) { return [int]$version.Trim() }
  } catch {}
  return 0
}
function Ensure-Node {
  Refresh-Path
  $major = Get-NodeMajor
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue) -and $major -ge 20) {
    Ok "Node $(node --version) and npm $(npm --version) detected"
    return
  }
  Warn "Node.js 20+ was not found. Attempting winget install."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Invoke-Checked "winget" @("install", "--id", "OpenJS.NodeJS.LTS", "-e", "--accept-source-agreements", "--accept-package-agreements")
    Refresh-Path
  }
  $major = Get-NodeMajor
  if (-not ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue) -and $major -ge 20)) {
    try { Start-Process "https://nodejs.org/" } catch {}
    Fail "Install Node.js 20+ or 24 LTS, open a new terminal, then rerun the one-line installer."
  }
  Ok "Node $(node --version) and npm $(npm --version) ready"
}
function Get-GitHubRelease {
  param([string]$Repository, [string]$ReleaseTag)
  $headers = @{ "Accept" = "application/vnd.github+json"; "User-Agent" = "EchoInstaller" }
  if ($env:ECHO_GITHUB_TOKEN) { $headers["Authorization"] = "Bearer $env:ECHO_GITHUB_TOKEN" }
  if ($ReleaseTag -eq "latest") { $url = "https://api.github.com/repos/$Repository/releases/latest" }
  else { $url = "https://api.github.com/repos/$Repository/releases/tags/$ReleaseTag" }
  Invoke-RestMethod -Uri $url -Headers $headers
}
function Find-Asset($Release, [string]$Pattern) {
  $Release.assets | Where-Object { $_.name -like $Pattern } | Select-Object -First 1
}

Header
Write-Host "Repo:   $Repo"
Write-Host "Asset:  $AssetPattern"
Write-Host "Tag:    $Tag"

Step "Preflight checks"
Ensure-Node

Step "Finding latest Echo App Server release"
$release = Get-GitHubRelease -Repository $Repo -ReleaseTag $Tag
$asset = Find-Asset -Release $release -Pattern $AssetPattern
if (-not $asset) { Fail "No release asset matched '$AssetPattern'. Upload the server zip to GitHub Releases first." }
Ok "Found release asset: $($asset.name)"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("echo-server-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
  $zipPath = Join-Path $tempRoot "echo-server.zip"
  Step "Downloading package"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
  Ok "Downloaded $([Math]::Round((Get-Item $zipPath).Length / 1MB, 2)) MB"

  Step "Extracting package"
  $extractPath = Join-Path $tempRoot "package"
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
  $packageJson = Get-ChildItem -LiteralPath $extractPath -Filter package.json -Recurse -File | Select-Object -First 1
  if (-not $packageJson) { Fail "Downloaded package did not contain package.json." }
  $packageRoot = $packageJson.Directory.FullName
  Ok "Package root: $packageRoot"

  Step "Launching Echo guided installer"
  Set-Location $packageRoot
  if (Test-Path (Join-Path $packageRoot "INSTALL.bat")) {
    Invoke-Checked "cmd.exe" @("/c", "INSTALL.bat")
  } elseif (Test-Path (Join-Path $packageRoot "scripts\install-server-windows.ps1")) {
    Invoke-Checked "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\install-server-windows.ps1")
  } else {
    Fail "Package did not contain INSTALL.bat or scripts\install-server-windows.ps1."
  }
} finally {
  Set-Location $env:USERPROFILE
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Step "Install complete"
Ok "Echo App Server was installed."
Write-Host ""
Write-Host "Next commands:"
Write-Host "  echo-server"
Write-Host "  echo-server onboard"
Write-Host "  echo-server service install"
Write-Host "  echo-server service start"
Write-Host "  echo-server dashboard"
