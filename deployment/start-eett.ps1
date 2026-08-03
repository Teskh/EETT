$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "Backend"
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"

Set-Location $backendDir
& $python -m uvicorn app.main:app --host 127.0.0.1 --port 5000
