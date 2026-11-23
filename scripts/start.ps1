# Run FastAPI as a single process on http://127.0.0.1:8000 without auto-reload (make start).
# The same process serves the API under /api and the built UI (frontend/dist), with deep
# links falling back to index.html. Build the UI first.
# Usage: .\scripts\build.ps1; .\scripts\start.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'
Test-EnvFile

Invoke-Native -Command 'uv' -Arguments @('run', 'uvicorn', 'app.main:app', '--port', '8000') -WorkingDirectory $BackendDir
