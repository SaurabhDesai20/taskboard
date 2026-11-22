# One-time setup: create .env, install backend (uv) and frontend (npm) dependencies.
# Usage: .\scripts\setup.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Install uv: https://docs.astral.sh/uv/getting-started/installation/'
Assert-Command 'npm' 'Install Node.js (LTS): https://nodejs.org/'

$envFile = Join-Path $RepoRoot '.env'
if (Test-Path $envFile) {
    Write-Host '.env already exists, leaving it unchanged.'
}
else {
    Copy-Item (Join-Path $RepoRoot '.env.example') $envFile
    Write-Host 'Created .env from .env.example.'
}

Write-Host 'Installing backend dependencies (uv sync)...'
Invoke-Native -Command 'uv' -Arguments @('sync') -WorkingDirectory $BackendDir

Write-Host 'Installing frontend dependencies (npm install)...'
Invoke-Native -Command 'npm' -Arguments @('install') -WorkingDirectory $FrontendDir

Write-Host 'Setup complete. Next: .\scripts\db.ps1, then .\scripts\migrate.ps1'
