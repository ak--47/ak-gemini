# Testing Guide

This project includes comprehensive testing for both the AI Transformer module and the Cloud Function wrapper.

## Test Types

### 1. Unit Tests (`module.test.js`)
- **Purpose**: Tests the core AI Transformer module with real Gemini API calls
- **What it tests**: AITransformer class, transformations, validation, examples, etc.
- **Run with**: `npm run test:unit`

### 2. Function Integration Tests (`function.integration.test.js`)
- **Purpose**: Tests the Cloud Function by calling it directly (no HTTP)
- **What it tests**: Authentication, endpoints, parameter handling, AI integration
- **Run with**: `npm run test:function`

### 3. HTTP Integration Tests (`function.http.test.js`)
- **Purpose**: Tests the Cloud Function via real HTTP requests to a local server
- **What it tests**: Full HTTP request/response cycle, real network behavior
- **Run with**: `npm run test:http` (requires local server)

## Quick Start

```bash
# Run all tests (recommended)
npm run test:all

# Run individual test suites
npm run test:unit        # Unit tests only
npm run test:function    # Function integration only  
npm run test:http        # HTTP integration only

# Run basic Jest (all test files)
npm test
```

## Environment Requirements

Create a `.env` file with:
```bash
GEMINI_API_KEY=your_gemini_api_key
CODE_PHRASE=your_secret_phrase
NODE_ENV=test
```

## Test Structure

```
tests/
├── module.test.js              # Unit tests (no mocks)
├── function.integration.test.js # Direct function calls
├── function.http.test.js        # HTTP requests
├── function.test.js            # Original mock-based tests (legacy)
├── setup.js                    # Jest setup
└── README.md                   # This file
```

## Key Features

### No Mocks Policy
- All new tests hit real APIs and services
- Tests use actual Gemini API calls
- Validates real-world behavior

### Authentication Testing
- Tests all auth parameter variations (`code_phrase`, `CODE_PHRASE`, `code`, `auth`)
- Validates both URL and body parameter placement
- Ensures public endpoints (`/health`, `/help`) bypass auth

### AI Integration Testing
- Real transformations with examples
- Custom model configurations
- Response schema validation
- Error handling and retries

### HTTP Testing
- Full request/response cycle
- Parameter merging (URL + body)
- Content-Type handling
- Error responses

## Running Locally

The HTTP tests require a local Cloud Function server:

```bash
# Start server manually
npx @google-cloud/functions-framework --target=entry --source=. --port=8080

# Run HTTP tests
npm run test:http
```

Or use the automated script:
```bash
# Starts server, runs tests, stops server
npm run test:integration
```

## Timeouts

- Default test timeout: 30 seconds
- AI calls can take 5-15 seconds
- HTTP tests include server startup time

## Tips

1. **Rate Limits**: Tests run sequentially to avoid Gemini API rate limits
2. **API Costs**: Integration tests make real API calls (small cost)
3. **Debugging**: Set `LOG_LEVEL=debug` for verbose output
4. **CI/CD**: Use `npm run test:all` for complete validation

## Troubleshooting

**Tests timing out?**
- Check your internet connection
- Verify GEMINI_API_KEY is valid
- Increase timeout in jest.config.js

**Authentication failures?**
- Verify CODE_PHRASE is set correctly
- Check .env file is loaded

**HTTP tests failing?**
- Ensure port 8080 is available
- Check if function server started successfully