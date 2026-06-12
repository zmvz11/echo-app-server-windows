# Upload Echo App Server for Windows to GitHub

Create a new GitHub repository named:

```text
echo-app-server-windows
```

When creating the repo, do not add a README, license, or .gitignore. This package already includes them.

Then unzip this package and run these commands inside the extracted `echo-app-server-windows` folder:

```bash
git init
git add .
git commit -m "Initial Echo App Server for Windows release candidate"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/echo-app-server-windows.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username or organization name.

## First local test

PowerShell:

```powershell
./scripts/install-windows.ps1
```

## Release packaging

```powershell
npm run package:windows
```
## After cloning or downloading

Run the single installer from the repo root: `INSTALL.bat` on Windows or `./install.sh` on Linux. See `docs/INSTALL.md`.

