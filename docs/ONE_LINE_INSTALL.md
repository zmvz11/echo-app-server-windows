# One-Line GitHub Install

Echo App Server supports an OpenClaw-style terminal install flow: paste one command, download the latest GitHub Release, install the server, and launch guided onboarding.

## Windows PowerShell

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/zmvz11/echo-app-server-windows/main/scripts/install.ps1 | iex"
```

Advanced form with parameters:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/zmvz11/echo-app-server-windows/main/scripts/install.ps1))) -Repo zmvz11/echo-app-server-windows -AssetPattern "echo-app-server-windows*.zip"
```

## Linux

```bash
curl -fsSL https://raw.githubusercontent.com/zmvz11/echo-app-server-linux/main/scripts/install.sh | bash
```

Advanced form:

```bash
curl -fsSL https://raw.githubusercontent.com/zmvz11/echo-app-server-linux/main/scripts/install.sh | bash -s -- --repo=zmvz11/echo-app-server-linux --asset='echo-app-server-linux*.zip'
```

## GitHub Release requirement

The one-line installer reads GitHub Releases. Before the public install command can work, create a GitHub Release and upload the matching server package as a release asset.

Recommended release setup:

```text
Tag: v1.0.0
Windows asset: echo-app-server-windows-v1.0.0.zip
Linux asset: echo-app-server-linux-v1.0.0.zip
```

The installer searches for assets matching:

```text
echo-app-server-windows*.zip
echo-app-server-linux*.zip
```

## What the installer does

1. Detects the platform package source.
2. Checks/install-prompts for Node.js 20+.
3. Finds the latest GitHub Release asset.
4. Downloads and extracts the server package.
5. Runs the packaged Echo setup installer.
6. Builds the server.
7. Launches `echo-server onboard`.
8. Prints next commands for service install, dashboard, doctor, and updates.

## Private repositories

For private GitHub repositories, set a token before running the installer:

Windows:

```powershell
$env:ECHO_GITHUB_TOKEN="YOUR_TOKEN"
```

Linux:

```bash
export ECHO_GITHUB_TOKEN="YOUR_TOKEN"
```
