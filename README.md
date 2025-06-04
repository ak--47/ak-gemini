# AK-Gemini

**Generic, type-safe, and highly configurable wrapper for Google's Gemini AI JSON transformation.**
Use this to power LLM-driven data pipelines, JSON mapping, or any automated AI transformation step, locally or in cloud functions.

---

## Features

* **Model-Agnostic**: Configure for any Gemini model (`gemini-2.0-flash` by default)
* **Declarative Examples**: Seed transformations using example mappings, with support for custom keys (`PROMPT`, `ANSWER`, `CONTEXT`, or your own)
* **Automatic Validation & Repair**: Validate outputs with your own async function; auto-repair failed payloads with LLM feedback loop (exponential backoff, fully configurable)
* **Strong TypeScript/JSDoc Typings**: All public APIs fully typed (see `/types`)
* **Minimal API Surface**: Dead simple, no ceremony—init, seed, transform, validate.
* **Robust Logging**: Pluggable logger for all steps, easy debugging

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

---

### 2. **Basic Example**

```js
import AITransformer from 'ai-transformer';

const transformer = new AITransformer({
  modelName: 'gemini-2.0-flash',    // or your preferred Gemini model
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

### 3. **Automatic Validation & Self-Healing**

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

## API

### Constructor

```js
new AITransformer(options)
```

| Option             | Type   | Default            | Description                                       |
| ------------------ | ------ | ------------------ | ------------------------------------------------- |
| modelName          | string | 'gemini-2.0-flash' | Gemini model to use                               |
| sourceKey          | string | 'PROMPT'           | Key for prompt/example input                      |
| targetKey          | string | 'ANSWER'           | Key for expected output in examples               |
| contextKey         | string | 'CONTEXT'          | Key for per-example context (optional)            |
| examplesFile       | string | null               | Path to JSON file containing examples             |
| exampleData        | array  | null               | Inline array of example objects                   |
| responseSchema     | object | null               | Optional JSON schema for strict output validation |
| maxRetries         | number | 3                  | Retries for validation+rebuild loop               |
| retryDelay         | number | 1000               | Initial retry delay in ms (exponential backoff)   |
| chatConfig         | object | ...                | Gemini chat config overrides                      |
| systemInstructions | string | ...                | System prompt for Gemini                          |

---

### Methods

#### `await transformer.init()`

Initializes Gemini chat session (idempotent).

#### `await transformer.seed(examples?)`

Seeds the model with example transformations (uses keys from constructor).
You can omit `examples` to use the `examplesFile` (if provided).

#### `await transformer.message(sourcePayload)`

Transforms input JSON to output JSON using the seeded examples and system instructions.

#### `await transformer.transformWithValidation(sourcePayload, validatorFn, options?)`

Runs transformation, validates with your async validator, and (optionally) repairs payload using LLM until valid or retries are exhausted.
Throws if all attempts fail.

#### `await transformer.rebuild(lastPayload, errorMessage)`

Given a failed payload and error message, uses LLM to generate a corrected payload.

#### `await transformer.reset()`

Resets the Gemini chat session, clearing all history/examples.

#### `transformer.getHistory()`

Returns the current chat history (for debugging).

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

## Testing

* **Jest test suite included**
* Mocks Google Gemini, logger, ak-tools
* 100% coverage for all error cases, configuration options, edge cases

Run tests with:

```sh
npm test
```

---

## Error Handling

* Throws on missing `GEMINI_API_KEY`
* All API and parsing errors surfaced as `Error` with context
* Validator and retry failures include the number of attempts and last error

---


