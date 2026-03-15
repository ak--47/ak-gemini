# ak-gemini

**Modular, type-safe wrapper for Google's Gemini AI.** Five class exports for different interaction patterns — JSON transformation, chat, stateless messages, tool-using agents, and code-writing agents — all sharing a common base.

```sh
npm install ak-gemini
```

Requires Node.js 18+ and [@google/genai](https://www.npmjs.com/package/@google/genai).

---

## Quick Start

```sh
export GEMINI_API_KEY=your-key
```

```javascript
import { Transformer, Chat, Message, ToolAgent, CodeAgent } from 'ak-gemini';
```

---

## Classes

### Transformer — JSON Transformation

Transform structured data using few-shot examples with validation and retry.

```javascript
const transformer = new Transformer({
  modelName: 'gemini-2.5-flash',
  sourceKey: 'INPUT',
  targetKey: 'OUTPUT'
});

await transformer.init();
await transformer.seed([
  {
    INPUT: { name: 'Alice' },
    OUTPUT: { name: 'Alice', role: 'engineer', emoji: '👩‍💻' }
  }
]);

const result = await transformer.send({ name: 'Bob' });
// → { name: 'Bob', role: '...', emoji: '...' }
```

**Validation & self-healing:**

```javascript
const result = await transformer.send({ name: 'Bob' }, {}, async (output) => {
  if (!output.role) throw new Error('Missing role field');
  return output;
});
```

### Chat — Multi-Turn Conversation

```javascript
const chat = new Chat({
  systemPrompt: 'You are a helpful assistant.'
});

const r1 = await chat.send('My name is Alice.');
const r2 = await chat.send('What is my name?');
// r2.text → "Alice"
```

### Message — Stateless One-Off

Each call is independent — no history maintained.

```javascript
const msg = new Message({
  systemPrompt: 'Extract entities as JSON.',
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'object',
    properties: {
      entities: { type: 'array', items: { type: 'string' } }
    }
  }
});

const result = await msg.send('Alice works at Acme in New York.');
// result.data → { entities: ['Alice', 'Acme', 'New York'] }
```

### ToolAgent — Agent with User-Provided Tools

Provide tool declarations and an executor function. The agent manages the tool-use loop automatically.

```javascript
const agent = new ToolAgent({
  systemPrompt: 'You are a research assistant.',
  tools: [
    {
      name: 'http_get',
      description: 'Fetch a URL',
      parametersJsonSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }
    }
  ],
  toolExecutor: async (toolName, args) => {
    if (toolName === 'http_get') {
      const res = await fetch(args.url);
      return { status: res.status, body: await res.text() };
    }
  },
  onBeforeExecution: async (toolName, args) => {
    console.log(`About to call ${toolName}`);
    return true; // return false to deny
  }
});

const result = await agent.chat('Fetch https://api.example.com/data');
console.log(result.text);       // Agent's summary
console.log(result.toolCalls);  // [{ name, args, result }]
```

**Streaming:**

```javascript
for await (const event of agent.stream('Fetch the data')) {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'tool_call') console.log(`Calling ${event.toolName}...`);
  if (event.type === 'tool_result') console.log(`Result:`, event.result);
  if (event.type === 'done') console.log('Done!');
}
```

### CodeAgent — Agent That Writes and Executes Code

Instead of calling tools one by one, the model writes JavaScript that can do everything — read files, write files, run commands — in a single script. Inspired by the [code mode](https://blog.cloudflare.com/how-we-built-mcp-code-mode/) philosophy.

```javascript
const agent = new CodeAgent({
  workingDirectory: '/path/to/my/project',
  onCodeExecution: (code, output) => {
    console.log('Ran:', code.slice(0, 100));
    console.log('Output:', output.stdout);
  },
  onBeforeExecution: async (code) => {
    // Review code before execution
    console.log('About to run:', code);
    return true; // return false to deny
  }
});

const result = await agent.chat('Find all TODO comments in the codebase');
console.log(result.text);             // Agent's summary
console.log(result.codeExecutions);   // [{ code, output, stderr, exitCode }]
```

**How it works:**
1. On `init()`, gathers codebase context (file tree + key files like package.json)
2. Injects context into the system prompt so the model understands the project
3. Model writes JavaScript using the `execute_code` tool
4. Code runs in a Node.js child process that inherits `process.env`
5. Output (stdout/stderr) feeds back to the model
6. Model decides if more work is needed

**Streaming:**

```javascript
for await (const event of agent.stream('Refactor the auth module')) {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'code') console.log('\n[Running code...]');
  if (event.type === 'output') console.log('[Output]:', event.stdout);
  if (event.type === 'done') console.log('\nDone!');
}
```

---

## Stopping Agents

Both `ToolAgent` and `CodeAgent` support a `stop()` method to cancel execution mid-loop. This is useful for implementing user-facing cancel buttons or safety limits.

```javascript
const agent = new CodeAgent({ workingDirectory: '.' });

// Stop from a callback
const agent = new ToolAgent({
  tools: [...],
  toolExecutor: myExecutor,
  onBeforeExecution: async (toolName, args) => {
    if (toolName === 'dangerous_tool') {
      agent.stop(); // Stop the agent entirely
      return false; // Deny this specific execution
    }
    return true;
  }
});

// Stop externally (e.g., from a timeout or user action)
setTimeout(() => agent.stop(), 60_000);
const result = await agent.chat('Do some work');
```

For `CodeAgent`, `stop()` also kills any currently running child process via SIGTERM.

---

## Shared Features

All classes extend `BaseGemini` and share these features:

### Authentication

```javascript
// Gemini API (default)
new Chat({ apiKey: 'your-key' }); // or GEMINI_API_KEY env var

// Vertex AI
new Chat({ vertexai: true, project: 'my-gcp-project' });
```

### Token Estimation

```javascript
const { inputTokens } = await instance.estimate({ some: 'payload' });
const cost = await instance.estimateCost({ some: 'payload' });
```

### Usage Tracking

```javascript
const usage = instance.getLastUsage();
// { promptTokens, responseTokens, totalTokens, attempts, modelVersion, requestedModel, timestamp }
```

### Few-Shot Seeding

```javascript
await instance.seed([
  { PROMPT: { x: 1 }, ANSWER: { y: 2 } }
]);
```

### Thinking Configuration

```javascript
new Chat({
  modelName: 'gemini-2.5-flash',
  thinkingConfig: { thinkingBudget: 1024 }
});
```

### Billing Labels (Vertex AI)

```javascript
new Transformer({
  vertexai: true,
  project: 'my-project',
  labels: { app: 'pipeline', env: 'prod' }
});
```

---

## Constructor Options

All classes accept `BaseGeminiOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `modelName` | string | `'gemini-2.5-flash'` | Gemini model to use |
| `systemPrompt` | string | varies by class | System prompt |
| `apiKey` | string | env var | Gemini API key |
| `vertexai` | boolean | `false` | Use Vertex AI |
| `project` | string | env var | GCP project ID |
| `location` | string | `'global'` | GCP region |
| `chatConfig` | object | — | Gemini chat config overrides |
| `thinkingConfig` | object | — | Thinking features config |
| `maxOutputTokens` | number | `50000` | Max tokens in response (`null` removes limit) |
| `logLevel` | string | based on NODE_ENV | `'trace'`\|`'debug'`\|`'info'`\|`'warn'`\|`'error'`\|`'none'` |
| `labels` | object | — | Billing labels (Vertex AI) |

### Transformer-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sourceKey`/`promptKey` | string | `'PROMPT'` | Key for input in examples |
| `targetKey`/`answerKey` | string | `'ANSWER'` | Key for output in examples |
| `contextKey` | string | `'CONTEXT'` | Key for context in examples |
| `maxRetries` | number | `3` | Retry attempts for validation |
| `retryDelay` | number | `1000` | Initial retry delay (ms) |
| `responseSchema` | object | — | JSON schema for output validation |
| `asyncValidator` | function | — | Global async validator |
| `enableGrounding` | boolean | `false` | Enable Google Search grounding |

### ToolAgent-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tools` | array | — | Tool declarations (FunctionDeclaration format) |
| `toolExecutor` | function | — | `async (toolName, args) => result` |
| `maxToolRounds` | number | `10` | Max tool-use loop iterations |
| `onToolCall` | function | — | Notification callback when tool is called |
| `onBeforeExecution` | function | — | `async (toolName, args) => boolean` — gate execution |

### CodeAgent-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `workingDirectory` | string | `process.cwd()` | Directory for code execution |
| `maxRounds` | number | `10` | Max code execution loop iterations |
| `timeout` | number | `30000` | Per-execution timeout (ms) |
| `onBeforeExecution` | function | — | `async (code) => boolean` — gate execution |
| `onCodeExecution` | function | — | Notification after execution |

### Message-Specific

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `responseSchema` | object | — | Schema for structured output |
| `responseMimeType` | string | — | e.g. `'application/json'` |

---

## Exports

```javascript
// Named exports
import { Transformer, Chat, Message, ToolAgent, CodeAgent, BaseGemini, log } from 'ak-gemini';
import { extractJSON, attemptJSONRecovery } from 'ak-gemini';

// Default export (namespace)
import AI from 'ak-gemini';
new AI.Transformer({ ... });

// CommonJS
const { Transformer, Chat } = require('ak-gemini');
```

---

## Testing

```sh
npm test
```

All tests use real Gemini API calls (no mocks). Rate limiting (429 errors) can cause intermittent failures.

---

## Migration from v1.x

See [MIGRATION.md](./MIGRATION.md) for a detailed guide on upgrading from v1.x to v2.0.
