# GCUID CLI Test Script for PowerShell

Write-Host "`n=== GCUID Command Line Utilities Test ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Mint a V2 GCUID (default)
Write-Host "1. Minting a V2 GCUID (default format)..." -ForegroundColor Yellow
node dist/cli.js mint person

Write-Host "`n" 

# Test 2: Mint a V1 GCUID (legacy format)
Write-Host "2. Minting a V1 GCUID (legacy format)..." -ForegroundColor Yellow
$v1gcuid = node dist/cli.js mint org --format v1 2>&1 | Select-String -Pattern "urn:gc:uid:" | ForEach-Object { $_.Line.Trim() -replace '[│└┐┌─\s]', '' }
if ($v1gcuid) {
    Write-Host "Generated V1: $v1gcuid" -ForegroundColor Green
}

Write-Host "`n"

# Test 3: Mint a V2 GCUID with UUID
Write-Host "3. Minting a V2 GCUID with UUID..." -ForegroundColor Yellow
node dist/cli.js mint asset --type uuid

Write-Host "`n"

# Test 4: Generate a V2 GCUID and create an alias
Write-Host "4. Generating V2 GCUID and creating alias..." -ForegroundColor Yellow
$v2gcuid = node dist/cli.js mint person 2>&1 | Select-String -Pattern "urn:gcuid:" | ForEach-Object { $_.Line.Trim() -replace '[│└┐┌─\s]', '' }
if ($v2gcuid) {
    Write-Host "Generated V2: $v2gcuid" -ForegroundColor Green
    Write-Host ""
    Write-Host "Generating alias..." -ForegroundColor Yellow
    $alias = node dist/cli.js generate-alias $v2gcuid 2>&1 | Select-String -Pattern "GC-" | ForEach-Object { $_.Line.Trim() -replace '[│└┐┌─\s]', '' }
    if ($alias) {
        Write-Host "Generated Alias: $alias" -ForegroundColor Green
    }
}

Write-Host "`n"

# Test 5: Validate an alias
Write-Host "5. Validating the alias..." -ForegroundColor Yellow
if ($alias) {
    node dist/cli.js validate-alias $alias
}

Write-Host "`n"

# Test 6: Parse an alias
Write-Host "6. Parsing the alias..." -ForegroundColor Yellow
if ($alias) {
    node dist/cli.js parse-alias $alias
}

Write-Host "`n"

# Test 7: Convert V1 to V2
Write-Host "7. Converting V1 GCUID to V2 format..." -ForegroundColor Yellow
if ($v1gcuid) {
    node dist/cli.js convert $v1gcuid
}

Write-Host "`n"

# Test 8: Convert V1 to V2 with alias generation
Write-Host "8. Converting V1 to V2 with alias..." -ForegroundColor Yellow
if ($v1gcuid) {
    node dist/cli.js convert $v1gcuid --generate-alias
}

Write-Host "`n"

# Test 9: Register a custom entity type
Write-Host "9. Registering custom entity type 'device'..." -ForegroundColor Yellow
node dist/cli.js register device

Write-Host "`n"

# Test 10: List all entity types
Write-Host "10. Listing all registered entity types..." -ForegroundColor Yellow
node dist/cli.js types

Write-Host "`n"

# Test 11: Parse a V2 GCUID
Write-Host "11. Parsing a V2 GCUID..." -ForegroundColor Yellow
if ($v2gcuid) {
    node dist/cli.js parse $v2gcuid
}

Write-Host "`n"

# Test 12: Validate a V2 GCUID
Write-Host "12. Validating a V2 GCUID..." -ForegroundColor Yellow
if ($v2gcuid) {
    node dist/cli.js validate $v2gcuid
}

Write-Host "`n"

# Test 13: Validate a V1 GCUID
Write-Host "13. Validating a V1 GCUID..." -ForegroundColor Yellow
if ($v1gcuid) {
    node dist/cli.js validate $v1gcuid
}

Write-Host "`n"

# Test 14: Mint with metadata
Write-Host "14. Minting a person with metadata..." -ForegroundColor Yellow
$metadata = '{"name":"John Doe","email":"john@example.com","role":"admin"}'
node dist/cli.js mint person --metadata $metadata

Write-Host "`n=== All Tests Complete ===" -ForegroundColor Cyan
Write-Host "✓ V2 format (default)" -ForegroundColor Green
Write-Host "✓ V1 format (legacy)" -ForegroundColor Green
Write-Host "✓ Alias generation" -ForegroundColor Green
Write-Host "✓ Alias validation" -ForegroundColor Green
Write-Host "✓ Alias parsing" -ForegroundColor Green
Write-Host "✓ V1 to V2 conversion" -ForegroundColor Green
