# Write the backend OpenAPI schema to docs/openapi.json (make openapi).
# Usage: .\scripts\openapi.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'

$output = Join-Path $RepoRoot 'docs\openapi.json'
Invoke-Native -Command 'uv' -Arguments @('run', 'python', '-m', 'app.export_openapi', $output) -WorkingDirectory $BackendDir
