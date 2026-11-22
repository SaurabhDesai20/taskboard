# Run FastAPI as a single process on http://127.0.0.1:8000 without auto-reload (make start).
# Serving the built frontend (frontend/dist) from this process is added in Phase 7;
# until then this serves the API only.
# Usage: .\scripts\build.ps1; .\scripts\start.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'
Test-EnvFile

Invoke-Native -Command 'uv' -Arguments @('run', 'uvicorn', 'app.main:app', '--port', '8000') -WorkingDirectory $BackendDir
