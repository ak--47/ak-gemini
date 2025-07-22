# Testing Guide

This project includes comprehensive testing for the AI Transformer module.

## Test Types

### Unit Tests (`module.test.js`)
- **Purpose**: Tests the core AI Transformer module with real Gemini API calls
- **What it tests**: AITransformer class, transformations, validation, examples, etc.
- **Run with**: `npm run test:unit`

## Quick Start

```bash
# Run all tests
npm test

# Run unit tests specifically
npm run test:unit
```

## Environment Requirements

Create a `.env` file with:
```bash
GEMINI_API_KEY=your_gemini_api_key
NODE_ENV=test
```

## Test Structure

```
tests/
├── module.test.js              # Unit tests (no mocks)
├── jest.setup.js               # Jest setup
└── README.md                   # This file
```

## Key Features

### No Mocks Policy
- All new tests hit real APIs and services
- Tests use actual Gemini API calls
- Validates real-world behavior

### AI Integration Testing
- Real transformations with examples
- Custom model configurations
- Response schema validation
- Error handling and retries


## Timeouts

- Default test timeout: 30 seconds
- AI calls can take 5-15 seconds

## Tips

1. **Rate Limits**: Tests run sequentially to avoid Gemini API rate limits
2. **API Costs**: Tests make real API calls (small cost)
3. **Debugging**: Set `LOG_LEVEL=debug` for verbose output

## Troubleshooting

**Tests timing out?**
- Check your internet connection
- Verify GEMINI_API_KEY is valid
- Increase timeout in jest.config.js

