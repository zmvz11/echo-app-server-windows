# Echo App Package Standard

Echo App Center supports two install package extensions:

```text
.echoapp   preferred Echo package format
.zip       compatibility format
```

A `.echoapp` file is a zip-compatible archive with a clearer product extension. The package should contain an `echo-app.json` manifest at the root.

## Recommended structure

```text
echo-watchtower-sc-1.0.0-windows-x64.echoapp
├─ echo-app.json
├─ app/
│  └─ EchoWatchtowerSC.exe
├─ assets/
│  └─ icon.png
└─ README.md
```

## Manifest example

```json
{
  "id": "echo-watchtower-sc",
  "name": "Echo Watchtower SC",
  "version": "1.0.0",
  "platform": "windows-x64",
  "entrypoint": "app/EchoWatchtowerSC.exe",
  "installType": "portable"
}
```

## Server validation

Echo App Server now validates release metadata before accepting uploaded packages:

- package extension must be `.echoapp` or `.zip`
- version is required
- platform is required
- entrypoint is required
- entrypoint must be relative and stay inside the package
- empty package files are rejected

GitHub-linked releases receive the same metadata validation based on the selected release asset.
