# Apply all Alembic migrations to the database in DATABASE_URL (make migrate).
# Usage: .\scripts\migrate.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'
Test-EnvFile

Write-Host 'Running alembic upgrade head...'
Invoke-Native -Command 'uv' -Arguments @('run', 'alembic', 'upgrade', 'head') -WorkingDirectory $BackendDir
