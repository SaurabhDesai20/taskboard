# Run the Vite dev server on http://localhost:5173, proxying /api to :8000 (make frontend).
# Usage: .\scripts\frontend.ps1   (Ctrl+C to stop)

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'npm' 'Run .\scripts\setup.ps1 first.'

Invoke-Native -Command 'npm' -Arguments @('run', 'dev') -WorkingDirectory $FrontendDir
