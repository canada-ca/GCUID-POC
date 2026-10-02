# Connector Communication Integration Tests
# Tests HTTP communication between central system and departmental connectors

Write-Host ""
Write-Host "=== GCUID Connector Integration Tests ===" -ForegroundColor Cyan
Write-Host ""

# Build the project first
Write-Host "Building project..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Running connector integration tests..." -ForegroundColor Yellow
Write-Host ""

# Run the integration tests
node dist/connector-integration-tests.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ All connector tests passed!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Connector tests failed" -ForegroundColor Red
    Write-Host ""
    exit 1
}
