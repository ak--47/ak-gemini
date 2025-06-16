#!/bin/bash

set -euo pipefail

echo "🧪 Running comprehensive test suite..."

# Load environment variables
if [ -f .env ]; then
    export "$(grep -v '^#' .env | xargs)"
fi

# Check required environment variables
if [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "❌ GEMINI_API_KEY environment variable is not set"
    exit 1
fi

if [ -z "${CODE_PHRASE:-}" ]; then
    echo "❌ CODE_PHRASE environment variable is not set"
    exit 1
fi

echo "✅ Environment variables are set"

# 1. Run unit tests (module tests with real AI calls)
echo ""
echo "📋 Step 1: Running unit tests (module tests)..."
if npm run test:unit; then
    echo "✅ Unit tests passed"
else
    echo "❌ Unit tests failed"
    exit 1
fi

# 2. Run function integration tests (direct function calls)
echo ""
echo "🔧 Step 2: Running function integration tests..."
if npm run test:function; then
    echo "✅ Function integration tests passed"
else
    echo "❌ Function integration tests failed"
    exit 1
fi

# 3. Run HTTP integration tests (actual HTTP calls to local server)
echo ""
echo "🌐 Step 3: Running HTTP integration tests..."

# Start the functions framework in the background
echo "🚀 Starting local Cloud Function server..."
npx @google-cloud/functions-framework --target=entry --source=. --port=8080 &
FUNC_PID=$!

# Give it time to start
echo "⏳ Waiting for function to start..."
sleep 5

# Check if the function is running
if curl -s http://localhost:8080/health > /dev/null; then
    echo "✅ Function server is running on http://localhost:8080"
    
    # Run the HTTP integration tests
    if npm test -- tests/function.http.test.js; then
        echo "✅ HTTP integration tests passed"
        HTTP_TESTS_PASSED=true
    else
        echo "❌ HTTP integration tests failed"
        HTTP_TESTS_PASSED=false
    fi
    
    echo "🛑 Stopping local function server..."
    kill $FUNC_PID 2>/dev/null || true
    
    if [ "$HTTP_TESTS_PASSED" = false ]; then
        exit 1
    fi
else
    echo "❌ Failed to start function server"
    kill $FUNC_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "🎉 All tests passed successfully!"
echo ""
echo "📊 Test Summary:"
echo "  ✅ Unit tests (AI Transformer module)"
echo "  ✅ Function integration tests (direct function calls)"
echo "  ✅ HTTP integration tests (real HTTP requests)"
echo ""
echo "🚀 Your Cloud Function is ready for deployment!"