# Start Postgres in Docker and wait until it is healthy (make db).
# Usage: .\scripts\db.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'docker' 'Install Docker Desktop and make sure it is running.'
Test-EnvFile

Write-Host 'Starting Postgres (docker compose up -d --wait)...'
Invoke-Native -Command 'docker' -Arguments @('compose', 'up', '-d', '--wait')
Invoke-Native -Command 'docker' -Arguments @('compose', 'ps')
