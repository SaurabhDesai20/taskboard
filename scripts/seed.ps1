# Load demo data (workspace "acme", users for every role, projects, tasks, comments) into the
# database in DATABASE_URL. Safe to re-run: existing demo data is left as it is.
# Demo logins and password are listed in backend/README.md.
# Usage: .\scripts\seed.ps1   (after .\scripts\migrate.ps1)

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'
Test-EnvFile

Invoke-Native -Command 'uv' -Arguments @('run', 'python', '-m', 'app.seed') -WorkingDirectory $BackendDir
