#!/bin/bash

# Connector Communication Integration Tests
# Tests HTTP communication between central system and departmental connectors

echo ""
echo "=== GCUID Connector Integration Tests ==="
echo ""

# Build the project first
echo "Building project..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Build failed"
  exit 1
fi

echo ""
echo "Running connector integration tests..."
echo ""

# Run the integration tests
node dist/connector-integration-tests.js

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ All connector tests passed!"
  echo ""
else
  echo ""
  echo "❌ Connector tests failed"
  echo ""
  exit 1
fi
