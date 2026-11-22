# Build the React app into frontend/dist (make build).
# Usage: .\scripts\build.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'npm' 'Run .\scripts\setup.ps1 first.'

Invoke-Native -Command 'npm' -Arguments @('run', 'build') -WorkingDirectory $FrontendDir
