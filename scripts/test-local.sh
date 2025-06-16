#!/bin/bash

set -euo pipefail

echo "🚀 Starting local Cloud Function for integration testing..."

# Load environment variables
if [ -f .env ]; then
    export "$(grep -v '^#' .env | xargs)"
fi

# Start the functions framework in the background
npx @google-cloud/functions-framework --target=entry --source=. --port=8080 &
FUNC_PID=$!

# Give it time to start
echo "⏳ Waiting for function to start..."
sleep 3

# Check if the function is running
if curl -s http://localhost:8080/health > /dev/null; then
    echo "✅ Function is running on http://localhost:8080"
    echo "🔍 Running integration tests..."
    
    # Run the integration tests
    npm test -- tests/function.integration.test.js
    TEST_EXIT_CODE=$?
    
    echo "🛑 Stopping local function..."
    kill $FUNC_PID 2>/dev/null || true
    
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo "✅ All integration tests passed!"
    else
        echo "❌ Integration tests failed!"
        exit $TEST_EXIT_CODE
    fi
else
    echo "❌ Failed to start function"
    kill $FUNC_PID 2>/dev/null || true
    exit 1
fi