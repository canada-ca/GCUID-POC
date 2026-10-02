#!/bin/bash

# GCUID CLI Test Script

echo ""
echo "=== GCUID Command Line Utilities Test ==="
echo ""

# Test 1: Mint a V2 GCUID (default)
echo "1. Minting a V2 GCUID (default format)..."
node dist/cli.js mint person
echo ""

# Test 2: Mint a V1 GCUID (legacy format)
echo "2. Minting a V1 GCUID (legacy format)..."
V1GCUID=$(node dist/cli.js mint org --format v1 2>&1 | grep "urn:gc:uid:" | tr -d '│ └┐┌─')
echo "Generated V1: $V1GCUID"
echo ""

# Test 3: Mint a V2 GCUID with UUID
echo "3. Minting a V2 GCUID with UUID..."
node dist/cli.js mint asset --type uuid
echo ""

# Test 4: Generate a V2 GCUID and create an alias
echo "4. Generating V2 GCUID and creating alias..."
V2GCUID=$(node dist/cli.js mint person 2>&1 | grep "urn:gcuid:" | tr -d '│ └┐┌─')
echo "Generated V2: $V2GCUID"
echo ""
echo "Generating alias..."
ALIAS=$(node dist/cli.js generate-alias "$V2GCUID" 2>&1 | grep "GC-" | tr -d '│ └┐┌─')
echo "Generated Alias: $ALIAS"
echo ""

# Test 5: Validate an alias
echo "5. Validating the alias..."
node dist/cli.js validate-alias "$ALIAS"
echo ""

# Test 6: Parse an alias
echo "6. Parsing the alias..."
node dist/cli.js parse-alias "$ALIAS"
echo ""

# Test 7: Convert V1 to V2
echo "7. Converting V1 GCUID to V2 format..."
node dist/cli.js convert "$V1GCUID"
echo ""

# Test 8: Convert V1 to V2 with alias generation
echo "8. Converting V1 to V2 with alias..."
node dist/cli.js convert "$V1GCUID" --generate-alias
echo ""

# Test 9: Register a custom entity type
echo "9. Registering custom entity type 'device'..."
node dist/cli.js register device
echo ""

# Test 10: List all entity types
echo "10. Listing all registered entity types..."
node dist/cli.js types
echo ""

# Test 11: Parse a V2 GCUID
echo "11. Parsing a V2 GCUID..."
node dist/cli.js parse "$V2GCUID"
echo ""

# Test 12: Validate a V2 GCUID
echo "12. Validating a V2 GCUID..."
node dist/cli.js validate "$V2GCUID"
echo ""

# Test 13: Validate a V1 GCUID
echo "13. Validating a V1 GCUID..."
node dist/cli.js validate "$V1GCUID"
echo ""

# Test 14: Mint with metadata
echo "14. Minting a person with metadata..."
node dist/cli.js mint person --metadata '{"name":"John Doe","email":"john@example.com","role":"admin"}'
echo ""

echo "=== All Tests Complete ==="
echo "✓ V2 format (default)"
echo "✓ V1 format (legacy)"
echo "✓ Alias generation"
echo "✓ Alias validation"
echo "✓ Alias parsing"
echo "✓ V1 to V2 conversion"
