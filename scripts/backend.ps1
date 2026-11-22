# Run the FastAPI dev server with auto-reload on http://127.0.0.1:8000 (make backend).
# Usage: .\scripts\backend.ps1   (Ctrl+C to stop)

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'
Test-EnvFile

Invoke-Native -Command 'uv' -Arguments @('run', 'uvicorn', 'app.main:app', '--reload', '--port', '8000') -WorkingDirectory $BackendDir
