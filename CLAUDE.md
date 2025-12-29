# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Module Overview

**ak-gemini** is an AI-JSON-TRANSFORMER module that simplifies using Google's Gemini AI to transform JSON payloads through few-shot learning examples. The module provides a clean API for seeding transformations with examples and automatically handling validation, retries, and token management.

## Architecture

### Core Components

- **`index.js`** - Main AITransformer class with methods for initialization, seeding, transformation, and validation
- **`types.d.ts`** - Complete TypeScript definitions for all interfaces and options
- **`logger.js`** - Pino-based logging with configurable levels

### Key Classes & APIs

**AITransformer Class** (`index.js`):
- `init()` - Initialize Gemini chat session
- `seed(examples)` - Load transformation examples using configurable keys
- `message(payload, opts)` - Transform JSON with token estimation and validation
- `messageAndValidate(payload, validator)` - Transform with custom async validation
- `rebuild(payload, error)` - Auto-repair failed payloads using AI feedback
- `estimate(payload)` - Estimate INPUT token consumption before sending
- `estimateCost(payload)` - Estimate input cost based on tokens and model pricing
- `clearConversation()` - Clear conversation history while preserving seeded examples
- `getLastUsage()` - Get structured usage data (input/output tokens, model) from last API call
- `lastResponseMetadata` - Property containing model version and token counts from last API call


## Development Commands

```bash
# Testing
npm test                    # Run all Jest tests
npm run test:unit          # Unit tests only (tests/module.test.js)

# Build & Release  
npm run build:cjs         # Build CommonJS version using esbuild
npm run release           # Version bump and publish to npm
```

## Configuration & Environment

### Environment Variables
- `GEMINI_API_KEY` - Google Gemini API key (for Gemini API)
- `GOOGLE_CLOUD_PROJECT` - GCP project ID (for Vertex AI)
- `GOOGLE_CLOUD_LOCATION` - GCP region (for Vertex AI, defaults to 'us-central1')
- `NODE_ENV` - Environment (dev/test/prod affects log levels)
- `LOG_LEVEL` - Override log level (debug/info/warn/error)

### Authentication Options

**Option 1: Gemini API (default)**
```javascript
const ai = new AITransformer({
    apiKey: 'your-gemini-api-key'  // or use GEMINI_API_KEY env var
});
```

**Option 2: Vertex AI with Service Account Key File**
```javascript
const ai = new AITransformer({
    vertexai: true,
    project: 'my-gcp-project',
    location: 'us-central1',
    googleAuthOptions: {
        keyFilename: './credentials.json'
    }
});
```

**Option 3: Vertex AI with Inline Credentials**
```javascript
const ai = new AITransformer({
    vertexai: true,
    project: 'my-gcp-project',
    location: 'us-central1',
    googleAuthOptions: {
        credentials: {
            client_email: 'svc@project.iam.gserviceaccount.com',
            private_key: '-----BEGIN PRIVATE KEY-----\n...'
        }
    }
});
```

**Option 4: Vertex AI with Application Default Credentials (ADC)**
```javascript
// Uses GOOGLE_APPLICATION_CREDENTIALS env var or `gcloud auth application-default login`
const ai = new AITransformer({
    vertexai: true,
    project: 'my-gcp-project'  // or GOOGLE_CLOUD_PROJECT env var
});
```

## Key Design Patterns

### Few-Shot Learning
The module uses configurable key mappings for examples:
- `sourceKey`/`promptKey` (default: 'PROMPT') - Input data
- `targetKey`/`answerKey` (default: 'ANSWER') - Expected output  
- `contextKey` (default: 'CONTEXT') - Optional per-example context
- `explanationKey` (default: 'EXPLANATION') - Optional reasoning

### Validation & Self-Healing
- Custom async validator functions that throw on validation failure
- Automatic retry with exponential backoff (configurable `maxRetries`, `retryDelay`)
- AI-powered payload reconstruction using error feedback via `rebuild()`

### Token Management
- `estimate()` provides INPUT token counts before sending (returns `{ inputTokens }`)
- Includes system instructions, chat history, examples, and user payload
- `getLastUsage()` provides actual consumption AFTER the call (input + output tokens)
- Prevents window size errors and helps manage API costs

### Conversation Management
Control chat history accumulation for cost optimization:

**Clear conversation while preserving examples:**
```javascript
const ai = new AITransformer({ modelName: 'gemini-2.5-flash' });
await ai.init();
await ai.seed(examples);

// Process multiple user requests
await ai.message(userRequest1);
await ai.message(userRequest2);

// Start fresh for a new user session (examples preserved, messages cleared)
await ai.clearConversation();

// New conversation starts with clean history but same examples
await ai.message(newUserRequest);
```

**Send stateless one-off messages (don't add to history):**
```javascript
// Normal message - adds to history
const result1 = await ai.message(payload);

// Stateless one-off - does NOT add to history
const result2 = await ai.message(payload, { stateless: true });

// History still only contains result1's exchange
```

**Verify model and track token usage:**
```javascript
await ai.message(payload);

// Get structured usage data for billing verification
const usage = ai.getLastUsage();
console.log(usage);
// { promptTokens, responseTokens, totalTokens, attempts, modelVersion, requestedModel, timestamp }
// Note: Token counts are CUMULATIVE across all retry attempts
// attempts = 1 means success on first try, 2+ means retries were needed
```

### Billing Labels & Cost Tracking
Labels flow through to GCP billing reports for cost attribution by client/app/environment.

**Constructor-level labels** (applied to all requests):
```javascript
const ai = new AITransformer({
    labels: {
        client: 'acme_corp',
        app: 'dungeon_master',
        environment: 'production'
    }
});
```

**Per-message label overrides**:
```javascript
await ai.message(payload, { labels: { request_type: 'character_gen' } });
```

**Cost estimation before sending**:
```javascript
const cost = await ai.estimateCost(payload);
// Returns: { inputTokens, model, pricing, estimatedInputCost, note }
console.log(`Estimated input cost: $${cost.estimatedInputCost.toFixed(6)}`);
// Note: Output cost depends on response length and cannot be predicted
```

Label requirements:
- Up to 64 labels per request
- Keys: 1-63 chars, lowercase letters, numbers, underscores, dashes
- Values: max 63 chars
- Don't include sensitive information

## Testing Strategy

The project uses a "no mocks" approach with real API integration:
- **Unit tests** - Test AITransformer class with real Gemini API calls
- Test timeout: 30 seconds (AI calls take 5-15 seconds)
- Sequential execution to avoid rate limits

## Module Exports

**ES Module** (`index.js`):
```javascript
import AITransformer from 'ak-gemini';
```

**CommonJS** (`index.cjs`):
```javascript  
const AITransformer = require('ak-gemini');
```

Both formats support the same API with full TypeScript definitions.

## TypeScript Support

The module provides complete TypeScript definitions in `types.d.ts` that enable full intellisense when consuming from npm. Key features:

- Complete method signatures with parameter types and return types
- Documented constructor options with all supported properties
- Support for both documented method names (`transformWithValidation`, `estimate`, `getLastUsage`) and internal aliases
- Proper default export declaration for both ES modules and CommonJS