# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Module Overview

**ak-gemini** (v2.0) is a modular wrapper around Google's `@google/genai` SDK. It provides 5 class exports for different AI interaction patterns, all extending a shared `BaseGemini` base class.

## Architecture

### File Structure

```
ak-gemini/
  index.js              ← Package entry point: re-exports all classes + helpers
  base.js               ← BaseGemini class (shared logic for all classes)
  transformer.js        ← Transformer class (JSON transformation, few-shot)
  chat.js               ← Chat class (multi-turn text conversation)
  message.js            ← Message class (stateless one-off messages)
  tool-agent.js         ← ToolAgent class (agent with user-provided tools)
  code-agent.js         ← CodeAgent class (agent that writes and executes code)
  json-helpers.js       ← Pure functions: extractJSON, attemptJSONRecovery, etc.
  logger.js             ← Pino-based logging with configurable levels
  types.d.ts            ← TypeScript definitions for all classes and interfaces
  index.cjs             ← Auto-generated CJS bundle via esbuild
  tests/
    base.test.js        ← Shared base class behavior
    transformer.test.js ← JSON transformation tests
    chat.test.js        ← Multi-turn conversation tests
    message.test.js     ← Stateless message tests
    tool-agent.test.js  ← Agent with user-provided tools tests
    code-agent.test.js  ← CodeAgent tests
    json-helpers.test.js ← Pure function unit tests
```

### Class Hierarchy

All classes extend `BaseGemini` which provides: auth, client init, chat session management, thinking config, log levels, safety settings, token estimation, cost tracking, usage reporting, and `seed()`.

| Class | Primary Method | Description |
|-------|---------------|-------------|
| `Transformer` | `send(payload)` | JSON transformation with few-shot, validation, retry |
| `Chat` | `send(message)` | Multi-turn text conversation with history |
| `Message` | `send(payload)` | Stateless one-off messages via `generateContent()` |
| `ToolAgent` | `chat(message)` / `stream(message)` | Agent with user-provided tools |
| `CodeAgent` | `chat(message)` / `stream(message)` | Agent that writes and executes JavaScript |

### Key Design Decisions

- **`systemPrompt`** is the unified option name across all classes (replaces old `systemInstructions`)
- **`send()`** is the primary method on Transformer, Chat, and Message
- **ToolAgent** ships with zero built-in tools — users provide `tools` + `toolExecutor` via constructor
- **CodeAgent** uses a single `execute_code` tool internally — the model writes JavaScript to accomplish tasks
- **`seed()`** is available on BaseGemini (all classes get few-shot capability)
- **`stop()`** is available on both ToolAgent and CodeAgent to cancel mid-execution
- **`onBeforeExecution`** callback on both agents for gating/approval before execution
- Default export is a namespace object: `{ Transformer, Chat, Message, ToolAgent, CodeAgent }`

## Key Classes & APIs

### BaseGemini (`base.js`)
Shared foundation. Not typically instantiated directly.
- `init(force?)` — Creates chat session, validates API connection
- `seed(examples, opts?)` — Add example pairs to chat history
- `getHistory()` / `clearHistory()` — Manage chat history
- `getLastUsage()` — Structured usage data after API calls
- `estimate(payload)` / `estimateCost(payload)` — Token/cost estimation

### Transformer (`transformer.js`)
JSON transformation via few-shot learning. Extends BaseGemini.
- `send(payload, opts?, validatorFn?)` — Transform with validation + retry
- `rawSend(payload, opts?)` — Direct send, extract JSON
- `rebuild(payload, error)` — AI-powered error correction
- `seed(examples)` — Override with key mapping + file loading
- `clearHistory()` — Preserves seeded examples
- `reset()` — Full reset including examples
- `updateSystemPrompt(instructions)` — Change system prompt, reinit

### Chat (`chat.js`)
Multi-turn text conversation. Extends BaseGemini.
- `send(message, opts?)` → `{ text, usage }`

### Message (`message.js`)
Stateless one-off messages. Uses `generateContent()`. Extends BaseGemini.
- `send(payload, opts?)` → `{ text, data?, usage }`
- Supports structured output via `responseSchema` / `responseMimeType`
- `getHistory()`, `clearHistory()`, `seed()` are no-ops

### ToolAgent (`tool-agent.js`)
Agent with user-provided tools. Extends BaseGemini.
- `chat(message)` → `{ text, toolCalls, usage }`
- `stream(message)` → AsyncGenerator yielding `{ type, text?, toolName?, args?, result? }`
- `stop()` — Cancel the agent before the next tool execution round
- Constructor requires: `tools` (FunctionDeclaration[]) + `toolExecutor` (async fn)
- Optional: `maxToolRounds`, `onToolCall`, `onBeforeExecution`

### CodeAgent (`code-agent.js`)
Agent that writes and executes JavaScript autonomously. Extends BaseGemini.
- `chat(message)` → `{ text, codeExecutions, usage }`
- `stream(message)` → AsyncGenerator yielding `{ type: 'text'|'code'|'output'|'done', ... }`
- `stop()` — Cancel the agent and kill any running child process
- `init()` gathers codebase context (file tree + key files) and injects it into system prompt
- Code executes in Node.js child processes that inherit `process.env`
- Optional: `workingDirectory`, `maxRounds`, `timeout`, `onBeforeExecution`, `onCodeExecution`

## Development Commands

```bash
npm test                   # Run all Jest tests
npm run build:cjs          # Build CommonJS version using esbuild
npm run release            # Version bump and publish to npm
npm run typecheck          # Verify TypeScript definitions
```

## Configuration & Environment

### Environment Variables
- `GEMINI_API_KEY` — Google Gemini API key (for Gemini API)
- `GOOGLE_CLOUD_PROJECT` — GCP project ID (for Vertex AI)
- `GOOGLE_CLOUD_LOCATION` — GCP region (for Vertex AI)
- `NODE_ENV` — Environment (dev/test/prod affects log levels)
- `LOG_LEVEL` — Override log level (debug/info/warn/error)

### Authentication

```javascript
// Gemini API (default)
new Transformer({ apiKey: 'your-key' }); // or GEMINI_API_KEY env var

// Vertex AI
new Transformer({ vertexai: true, project: 'my-gcp-project' });
```

## Module Exports

```javascript
// Named exports
import { Transformer, Chat, Message, ToolAgent, CodeAgent, BaseGemini, log } from 'ak-gemini';
import { extractJSON, attemptJSONRecovery } from 'ak-gemini';

// Default export (namespace object)
import AI from 'ak-gemini';
new AI.Transformer({ ... });

// CommonJS
const { Transformer, Chat } = require('ak-gemini');
```

## Testing Strategy

- "No mocks" approach — all tests use real Gemini API calls
- Test timeout: 30 seconds (AI calls take 5-15 seconds)
- Rate limiting (429 errors) can cause flaky failures — retry after waiting
- Test files: `base.test.js`, `transformer.test.js`, `chat.test.js`, `message.test.js`, `tool-agent.test.js`, `code-agent.test.js`, `json-helpers.test.js`

## Key Design Patterns

### Few-Shot Learning (Transformer)
Configurable key mappings: `promptKey` (default: 'PROMPT'), `answerKey` (default: 'ANSWER'), `contextKey` (default: 'CONTEXT'), `explanationKey` (default: 'EXPLANATION')

### Validation & Self-Healing (Transformer)
- Custom async validator functions that throw on failure
- Automatic retry with exponential backoff (`maxRetries`, `retryDelay`)
- AI-powered payload reconstruction via `rebuild()`

### Code Execution (CodeAgent)
- Single `execute_code` tool — model writes JavaScript, we execute it
- Child processes inherit `process.env` for full environment access
- `onBeforeExecution` async callback gates execution (return false to deny)
- `onCodeExecution` notification callback after execution
- File tree + key files gathered during `init()` for codebase awareness
- `stop()` kills running child processes via SIGTERM

### Agent Stop API (ToolAgent + CodeAgent)
- `agent.stop()` — sets `_stopped` flag, breaks loop before next execution
- Can be called from `onBeforeExecution` or `onToolCall` callbacks
- CodeAgent also kills any running child process on stop

### Token Management
- `estimate()` — INPUT token counts before sending
- `getLastUsage()` — actual consumption AFTER the call
- `estimateCost()` — cost estimate using MODEL_PRICING table

### Billing Labels (Vertex AI)
- Constructor-level: `labels: { app: 'myapp', env: 'prod' }`
- Per-message: `send(payload, { labels: { ... } })`
