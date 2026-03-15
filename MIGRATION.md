# Migrating from ak-gemini v1.x to v2.0

This guide covers everything you need to change when upgrading from v1.2 to v2.0.

**v2.0 is a breaking release.** The monolithic `AITransformer` class has been split into 5 focused classes, the `AIAgent` has been redesigned, and several method/option names have changed.

---

## Quick Summary

| What Changed | v1.x | v2.0 |
|---|---|---|
| Default import | `AITransformer` | Namespace: `{ Transformer, Chat, Message, ToolAgent, CodeAgent }` |
| JSON transformation class | `new AITransformer(...)` | `new Transformer(...)` |
| Agent class | `new AIAgent(...)` | `new ToolAgent(...)` |
| Agent import path | `import { AIAgent } from 'ak-gemini'` | `import { ToolAgent } from 'ak-gemini'` |
| System prompt option | `systemInstructions` | `systemPrompt` |
| Primary transform method | `.message(payload)` | `.send(payload)` |
| Transform w/ validation | `.messageAndValidate(payload, validator)` | `.send(payload, {}, validatorFn)` |
| Raw transform | `.rawMessage(payload)` | `.rawSend(payload)` |
| Clear conversation | `.clearConversation()` | `.clearHistory()` |
| Update system prompt | `.updateSystemInstructions(str)` | `.updateSystemPrompt(str)` |
| Reset chat | `.reset()` or `.resetChat()` | `.reset()` |
| Agent built-in tools | `http_get`, `http_post`, `write_markdown` | None — you provide your own |
| Agent `markdownFiles` | Returned in response | Removed |
| `ak-tools` dependency | Required | Removed |

---

## 1. Import Changes

### Default import

```javascript
// v1.x
import AITransformer from 'ak-gemini';
const ai = new AITransformer({ ... });

// v2.0 — named import (recommended)
import { Transformer } from 'ak-gemini';
const ai = new Transformer({ ... });

// v2.0 — namespace import
import AI from 'ak-gemini';
const ai = new AI.Transformer({ ... });
```

### Agent import

```javascript
// v1.x
import { AIAgent } from 'ak-gemini';
const agent = new AIAgent({ ... });

// v2.0
import { ToolAgent } from 'ak-gemini';
const agent = new ToolAgent({ ... });
```

### CommonJS

```javascript
// v1.x
const AITransformer = require('ak-gemini');

// v2.0
const { Transformer, Chat, ToolAgent } = require('ak-gemini');
```

### New classes available

v2.0 adds `Chat` and `Message` for use cases that don't need JSON transformation:

```javascript
import { Chat, Message } from 'ak-gemini';

// Multi-turn text conversation (with history)
const chat = new Chat({ systemPrompt: 'You are helpful.' });
const r = await chat.send('Hello!');

// Stateless one-off message (no history)
const msg = new Message({ systemPrompt: 'Be concise.' });
const r2 = await msg.send('What is 2+2?');
```

---

## 2. Constructor Option Changes

### `systemInstructions` → `systemPrompt`

```javascript
// v1.x
new AITransformer({ systemInstructions: 'You are an expert.' });
new AITransformer({ systemInstructions: null }); // disable

// v2.0
new Transformer({ systemPrompt: 'You are an expert.' });
new Transformer({ systemPrompt: null }); // disable
```

### `sourceKey` → `promptKey`

Both `sourceKey` and `promptKey` worked in v1.x. In v2.0, use `promptKey`:

```javascript
// v1.x
new AITransformer({ sourceKey: 'INPUT', targetKey: 'OUTPUT' });

// v2.0
new Transformer({ promptKey: 'INPUT', answerKey: 'OUTPUT' });
```

`targetKey` still works as an alias for `answerKey`.

### `systemInstructionsKey` → `systemPromptKey`

```javascript
// v1.x
new AITransformer({ systemInstructionsKey: 'SYS' });

// v2.0
new Transformer({ systemPromptKey: 'SYS' });
```

---

## 3. Method Changes

### `message()` → `send()`

```javascript
// v1.x
const result = await ai.message(payload);
const result2 = await ai.message(payload, { stateless: true });

// v2.0
const result = await ai.send(payload);
// For stateless, use Message class instead:
const msg = new Message({ ... });
const result2 = await msg.send(payload);
```

### `messageAndValidate()` / `transformWithValidation()` → `send()` with validator

```javascript
// v1.x
const result = await ai.messageAndValidate(payload, async (data) => {
  if (!data.name) throw new Error('Missing name');
});

// v2.0 — pass validator as 3rd argument to send()
const result = await ai.send(payload, {}, async (data) => {
  if (!data.name) throw new Error('Missing name');
});
```

### `rawMessage()` → `rawSend()`

```javascript
// v1.x
const result = await ai.rawMessage(payload);

// v2.0
const result = await ai.rawSend(payload);
```

### `clearConversation()` → `clearHistory()`

```javascript
// v1.x
await ai.clearConversation();

// v2.0
await ai.clearHistory();
```

Both preserve seeded examples on the `Transformer` class (same behavior as v1.x).

### `updateSystemInstructions()` → `updateSystemPrompt()`

```javascript
// v1.x
await ai.updateSystemInstructions('New instructions here.');

// v2.0
await ai.updateSystemPrompt('New instructions here.');
```

### `resetChat()` → `reset()`

```javascript
// v1.x
await ai.resetChat();
// or
await ai.reset();

// v2.0
await ai.reset();
```

### Unchanged methods

These methods work the same in v2.0:

- `init(force?)`
- `seed(examples)`
- `rebuild(payload, error)`
- `estimate(payload)`
- `estimateCost(payload)`
- `getHistory()`
- `getLastUsage()`

---

## 4. Stateless Messages

v1.x supported stateless messages via an option flag. v2.0 provides a dedicated `Message` class:

```javascript
// v1.x — stateless via option
const result = await ai.message(payload, { stateless: true });

// v2.0 — use Message class
import { Message } from 'ak-gemini';
const msg = new Message({
  systemPrompt: 'Extract entities.',
  responseMimeType: 'application/json'  // optional: for structured output
});
const result = await msg.send(payload);
// result.text — raw text response
// result.data — parsed JSON (when responseMimeType is 'application/json')
```

---

## 5. Agent (AIAgent → ToolAgent)

This is the biggest breaking change. The old `AIAgent` shipped with built-in `http_get`, `http_post`, and `write_markdown` tools. The new `ToolAgent` ships with **zero built-in tools** — you provide everything.

### Before (v1.x)

```javascript
import { AIAgent } from 'ak-gemini';

const agent = new AIAgent({
  systemPrompt: 'You are a research assistant.',
  httpTimeout: 30000,
  onToolCall: (name, args) => console.log(`Tool: ${name}`),
  onMarkdown: (filename, content) => fs.writeFileSync(filename, content)
});

const result = await agent.chat('Fetch https://api.example.com/data');
console.log(result.text);
console.log(result.markdownFiles); // [{filename, content}, ...]
```

### After (v2.0)

```javascript
import { ToolAgent } from 'ak-gemini';

const agent = new ToolAgent({
  systemPrompt: 'You are a research assistant.',
  tools: [
    {
      name: 'http_get',
      description: 'Fetch a URL via GET request',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' }
        },
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
  onToolCall: (name, args) => console.log(`Tool: ${name}`)
});

const result = await agent.chat('Fetch https://api.example.com/data');
console.log(result.text);
console.log(result.toolCalls); // [{name, args, result}, ...]
```

### Key differences

| Feature | v1.x `AIAgent` | v2.0 `ToolAgent` |
|---|---|---|
| Built-in HTTP tools | Yes (`http_get`, `http_post`) | No — provide your own |
| Built-in markdown tool | Yes (`write_markdown`) | No — provide your own |
| `tools` constructor option | Not available | Required (with `toolExecutor`) |
| `toolExecutor` constructor option | Not available | Required (with `tools`) |
| `markdownFiles` in response | Yes | Removed |
| `onMarkdown` callback | Yes | Removed |
| `httpTimeout` option | Yes | Removed (handle in your toolExecutor) |
| `maxRetries` option | Yes | Removed (handle in your toolExecutor) |
| `stream()` method | Yes | Yes (same event types, minus `markdown`) |

### Stream events

```javascript
// v1.x stream events: 'text', 'tool_call', 'tool_result', 'markdown', 'done'
// v2.0 stream events: 'text', 'tool_call', 'tool_result', 'done'
// ('markdown' type removed)
```

### Agent without tools

If you pass no `tools`, `ToolAgent` works as a plain chat agent (similar to `Chat` but using the agent's tool-use loop internally):

```javascript
const agent = new ToolAgent({ systemPrompt: 'You are helpful.' });
const result = await agent.chat('Hello!');
```

---

## 6. Removed Features

### `ak-tools` dependency

v2.0 no longer depends on `ak-tools`. File reading for example loading now uses native `fs.readFile` + `JSON.parse`.

### `stateless` option on `message()`

Use the `Message` class instead. See [section 4](#4-stateless-messages).

### Agent built-in tools

`http_get`, `http_post`, and `write_markdown` are no longer built in. Provide them yourself via the `tools` + `toolExecutor` constructor options. See [section 5](#5-agent-aiagent--toolagent).

### `markdownFiles` and `onMarkdown`

Handle document output in your own `toolExecutor`. The `AgentResponse` no longer includes a `markdownFiles` array.

---

## 7. Full Before/After Example

### v1.x

```javascript
import AITransformer from 'ak-gemini';

const ai = new AITransformer({
  modelName: 'gemini-2.5-flash',
  systemInstructions: 'Transform user profiles to CRM format.',
  apiKey: process.env.GEMINI_API_KEY,
  maxRetries: 3,
  retryDelay: 2000
});

await ai.init();

await ai.seed([
  { PROMPT: { name: 'Alice', age: 30 }, ANSWER: { fullName: 'Alice', ageGroup: 'adult' } },
  { PROMPT: { name: 'Bob', age: 10 }, ANSWER: { fullName: 'Bob', ageGroup: 'child' } }
]);

const result = await ai.message({ name: 'Carol', age: 65 });
console.log(result); // { fullName: 'Carol', ageGroup: 'senior' }

const usage = ai.getLastUsage();
console.log(usage.totalTokens);

await ai.clearConversation(); // preserves seed examples
```

### v2.0

```javascript
import { Transformer } from 'ak-gemini';

const ai = new Transformer({
  modelName: 'gemini-2.5-flash',
  systemPrompt: 'Transform user profiles to CRM format.',
  apiKey: process.env.GEMINI_API_KEY,
  maxRetries: 3,
  retryDelay: 2000
});

await ai.init();

await ai.seed([
  { PROMPT: { name: 'Alice', age: 30 }, ANSWER: { fullName: 'Alice', ageGroup: 'adult' } },
  { PROMPT: { name: 'Bob', age: 10 }, ANSWER: { fullName: 'Bob', ageGroup: 'child' } }
]);

const result = await ai.send({ name: 'Carol', age: 65 });
console.log(result); // { fullName: 'Carol', ageGroup: 'senior' }

const usage = ai.getLastUsage();
console.log(usage.totalTokens);

await ai.clearHistory(); // preserves seed examples
```

The changes are minimal for Transformer users: update the import, rename the constructor option, and change `.message()` to `.send()`.
