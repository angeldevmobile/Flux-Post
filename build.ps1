# Flux production build script
# Usage: .\build.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "==> Building Flux CLI..." -ForegroundColor Cyan
Push-Location flux-cli
cargo build --release
if (-not $?) { Write-Error "CLI build failed"; exit 1 }
Pop-Location

Write-Host "==> CLI binary ready at flux-cli/target/release/flux.exe" -ForegroundColor Green

Write-Host "==> Building Flux desktop app..." -ForegroundColor Cyan
cargo tauri build --bundles nsis
if (-not $?) { Write-Error "Tauri build failed"; exit 1 }

Write-Host "==> Build complete." -ForegroundColor Green
Write-Host "    Installer: src-tauri/target/release/bundle/" -ForegroundColor DarkGray
