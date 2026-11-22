# Lint and type-check both apps: ruff + mypy, eslint + tsc.
# Usage: .\scripts\lint.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'
Assert-Command 'npm' 'Run .\scripts\setup.ps1 first.'

Write-Host '== Backend: ruff check, ruff format --check, mypy =='
Invoke-Native -Command 'uv' -Arguments @('run', 'ruff', 'check', '.') -WorkingDirectory $BackendDir
Invoke-Native -Command 'uv' -Arguments @('run', 'ruff', 'format', '--check', '.') -WorkingDirectory $BackendDir
Invoke-Native -Command 'uv' -Arguments @('run', 'mypy') -WorkingDirectory $BackendDir

Write-Host '== Frontend: eslint, tsc =='
Invoke-Native -Command 'npm' -Arguments @('run', 'lint') -WorkingDirectory $FrontendDir
Invoke-Native -Command 'npm' -Arguments @('run', 'typecheck') -WorkingDirectory $FrontendDir

Write-Host 'Lint and type checks passed.' -ForegroundColor Green
