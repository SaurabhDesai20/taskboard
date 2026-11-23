# Run backend (pytest) and frontend (vitest) tests (make test).
# Backend tests need Postgres running (.\scripts\db.ps1); they use TEST_DATABASE_URL.
# Usage: .\scripts\test.ps1

. (Join-Path $PSScriptRoot '_common.ps1')

Assert-Command 'uv' 'Run .\scripts\setup.ps1 first.'
Assert-Command 'npm' 'Run .\scripts\setup.ps1 first.'
Test-EnvFile

$failed = @()

Write-Host '== Backend tests (pytest) =='
try {
    Invoke-Native -Command 'uv' -Arguments @('run', 'pytest') -WorkingDirectory $BackendDir
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $failed += 'backend'
}

Write-Host '== Frontend tests (vitest) =='
try {
    Invoke-Native -Command 'npm' -Arguments @('run', 'test') -WorkingDirectory $FrontendDir
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $failed += 'frontend'
}

if ($failed.Count -gt 0) {
    throw "Tests failed: $($failed -join ', ')"
}
Write-Host 'All tests passed.' -ForegroundColor Green
