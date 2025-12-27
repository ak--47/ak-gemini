# AK-Gemini

**Generic, type-safe, and highly configurable wrapper for Google's Gemini AI JSON transformation.**
Use this to power LLM-driven data pipelines, JSON mapping, or any automated AI transformation step, locally or in cloud functions.

---

## Features

* **Model-Agnostic:** Use any Gemini model (`gemini-2.5-flash` by default)
* **Declarative Few-shot Examples:** Seed transformations using example mappings, with support for custom keys (`PROMPT`, `ANSWER`, `CONTEXT`, or your own)
* **Automatic Validation & Repair:** Validate outputs with your own async function; auto-repair failed payloads with LLM feedback loop (exponential backoff, fully configurable)
* **Token Counting & Safety:** Preview the *exact* Gemini token consumption for any operation—including all examples, instructions, and your input—before sending, so you can avoid window errors and manage costs.
* **Conversation Management:** Clear conversation history while preserving examples, or send stateless one-off messages that don't affect history
* **Response Metadata:** Access actual model version and token counts from API responses for billing verification and debugging
* **Strong TypeScript/JSDoc Typings:** All public APIs fully typed (see `/types`)
* **Minimal API Surface:** Dead simple, no ceremony—init, seed, transform, validate.
* **Robust Logging:** Pluggable logger for all steps, easy debugging

---

## Install

```sh
npm install ak-gemini
```

Requires Node.js 18+, and [@google/genai](https://www.npmjs.com/package/@google/genai).

---

## Usage

### 1. **Setup**

Set your `GEMINI_API_KEY` environment variable:

```sh
export GEMINI_API_KEY=sk-your-gemini-api-key
```

or pass it directly in the constructor options.

---

### 2. **Basic Example**

```js
import AITransformer from 'ak-gemini';

const transformer = new AITransformer({
  modelName: 'gemini-2.5-flash',    // or your preferred Gemini model
  sourceKey: 'INPUT',               // Custom prompt key (default: 'PROMPT')
  targetKey: 'OUTPUT',              // Custom answer key (default: 'ANSWER')
  contextKey: 'CONTEXT',            // Optional, for per-example context
  maxRetries: 2,                    // Optional, for validation-repair loops
  // responseSchema: { ... },       // Optional, strict output typing
});

const examples = [
  {
    CONTEXT: "Generate professional profiles with emoji representations",
    INPUT: { "name": "Alice" },
    OUTPUT: { "name": "Alice", "profession": "data scientist", "life_as_told_by_emoji": ["🔬", "💡", "📊", "🧠", "🌟"] }
  }
];

await transformer.init();
await transformer.seed(examples);

const result = await transformer.message({ name: "Bob" });
console.log(result);
// → { name: "Bob", profession: "...", life_as_told_by_emoji: [ ... ] }
```

---

### 3. **Token Window Safety/Preview**

Before calling `.message()` or `.seed()`, you can preview the INPUT token usage that will be sent to Gemini—*including* your system instructions, examples, and user input. This is vital for avoiding window errors and managing context size:

```js
const { inputTokens } = await transformer.estimate({ name: "Bob" });
console.log(`Input tokens: ${inputTokens}`);

// Optional: abort or trim if over limit
if (inputTokens > 32000) throw new Error("Request too large for selected Gemini model");

// After the call, check actual usage (input + output)
await transformer.message({ name: "Bob" });
const usage = transformer.getLastUsage();
console.log(`Actual usage: ${usage.promptTokens} in, ${usage.responseTokens} out`);
```

---

### 4. **Automatic Validation & Self-Healing**

You can pass a custom async validator—if it fails, the transformer will attempt to self-correct using LLM feedback, retrying up to `maxRetries` times:

```js
const validator = async (payload) => {
  if (!payload.profession || !Array.isArray(payload.life_as_told_by_emoji)) {
    throw new Error('Invalid profile format');
  }
  return payload;
};

const validPayload = await transformer.transformWithValidation({ name: "Lynn" }, validator);
console.log(validPayload);
```

---

### 5. **Conversation Management**

Manage chat history to control costs and isolate requests:

```js
// Clear conversation history while preserving seeded examples
await transformer.clearConversation();

// Send a stateless message that doesn't affect chat history
const result = await transformer.message({ query: "one-off question" }, { stateless: true });

// Check actual model and token usage from last API call
console.log(transformer.lastResponseMetadata);
// → { modelVersion: 'gemini-2.5-flash-001', requestedModel: 'gemini-2.5-flash',
//    promptTokens: 150, responseTokens: 42, totalTokens: 192, timestamp: 1703... }
```

---

## API

### Constructor

```js
new AITransformer(options)
```

| Option             | Type   | Default            | Description                                       |
| ------------------ | ------ | ------------------ | ------------------------------------------------- |
| modelName          | string | 'gemini-2.5-flash' | Gemini model to use                               |
| sourceKey          | string | 'PROMPT'           | Key for prompt/example input                      |
| targetKey          | string | 'ANSWER'           | Key for expected output in examples               |
| contextKey         | string | 'CONTEXT'          | Key for per-example context (optional)            |
| examplesFile       | string | null               | Path to JSON file containing examples             |
| exampleData        | array  | null               | Inline array of example objects                   |
| responseSchema     | object | null               | Optional JSON schema for strict output validation |
| maxRetries         | number | 3                  | Retries for validation+rebuild loop               |
| retryDelay         | number | 1000               | Initial retry delay in ms (exponential backoff)   |
| logLevel           | string | 'info'             | Log level: 'trace', 'debug', 'info', 'warn', 'error', 'fatal', or 'none' |
| chatConfig         | object | ...                | Gemini chat config overrides                      |
| systemInstructions | string | ...                | System prompt for Gemini                          |

---

### Methods

#### `await transformer.init()`

Initializes Gemini chat session (idempotent).

#### `await transformer.seed(examples?)`

Seeds the model with example transformations (uses keys from constructor).
You can omit `examples` to use the `examplesFile` (if provided).

#### `await transformer.message(sourcePayload, options?)`

Transforms input JSON to output JSON using the seeded examples and system instructions. Throws if estimated token window would be exceeded.

**Options:**
- `stateless: true` — Send a one-off message without affecting chat history (uses `generateContent` instead of chat)
- `labels: {}` — Per-message billing labels

#### `await transformer.estimate(sourcePayload)`

Returns `{ inputTokens }` — the estimated INPUT tokens for the request (system instructions + all examples + your sourcePayload).
Use this to preview token window safety and manage costs before sending.

**Note:** This only estimates input tokens. Output tokens cannot be predicted before the API call. Use `getLastUsage()` after `message()` to see actual consumption.

#### `await transformer.transformWithValidation(sourcePayload, validatorFn, options?)`

Runs transformation, validates with your async validator, and (optionally) repairs payload using LLM until valid or retries are exhausted.
Throws if all attempts fail.

#### `await transformer.rebuild(lastPayload, errorMessage)`

Given a failed payload and error message, uses LLM to generate a corrected payload.

#### `await transformer.reset()`

Resets the Gemini chat session, clearing all history/examples.

#### `transformer.getHistory()`

Returns the current chat history (for debugging).

#### `await transformer.clearConversation()`

Clears conversation history while preserving seeded examples. Useful for starting fresh user sessions without re-seeding.

#### `transformer.getLastUsage()`

Returns structured usage data from the last API response for billing verification. Returns `null` if no API call has been made yet.

```js
const usage = transformer.getLastUsage();
// {
//   promptTokens: 150,      // Input tokens (includes system instructions + history + message)
//   responseTokens: 42,     // Output tokens
//   totalTokens: 192,       // Total tokens from API
//   modelVersion: 'gemini-2.5-flash-001',  // Actual model that responded
//   requestedModel: 'gemini-2.5-flash',    // Model you requested
//   timestamp: 1703...      // When response was received
// }
```

---

### Properties

#### `transformer.lastResponseMetadata`

After each API call, contains metadata from the response:

```js
{
  modelVersion: string | null,  // Actual model version that responded (e.g., 'gemini-2.5-flash-001')
  requestedModel: string,       // Model you requested (e.g., 'gemini-2.5-flash')
  promptTokens: number,         // Tokens in the prompt
  responseTokens: number,       // Tokens in the response
  totalTokens: number,          // Total tokens used
  timestamp: number             // When response was received
}
```

Useful for verifying billing, debugging model behavior, and tracking token usage.

---

## Examples

### Seed with Custom Example Keys

```js
const transformer = new AITransformer({
  sourceKey: 'INPUT',
  targetKey: 'OUTPUT',
  contextKey: 'CTX'
});

await transformer.init();
await transformer.seed([
  {
    CTX: "You are a dog expert.",
    INPUT: { breed: "golden retriever" },
    OUTPUT: { breed: "golden retriever", size: "large", friendly: true }
  }
]);

const dog = await transformer.message({ breed: "chihuahua" });
```

---

### Use With Validation and Retry

```js
const result = await transformer.transformWithValidation(
  { name: "Bob" },
  async (output) => {
    if (!output.name || !output.profession) throw new Error("Missing fields");
    return output;
  }
);
```

---

## Token Window Management & Error Handling

* Throws on missing `GEMINI_API_KEY`
* `.message()` and `.seed()` will *estimate* and prevent calls that would exceed Gemini's model window
* All API and parsing errors surfaced as `Error` with context
* Validator and retry failures include the number of attempts and last error

---

## Testing

* **Jest test suite included**
* Real API integration tests as well as local unit tests
* 100% coverage for all error cases, configuration options, edge cases

Run tests with:

```sh
npm test
```

---
