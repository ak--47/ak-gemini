# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Module Overview

**ak-gemini** (v2.0) is a modular wrapper around Google's `@google/genai` SDK. It provides 7 class exports for different AI interaction patterns, all extending a shared `BaseGemini` base class.

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
  rag-agent.js          ← RagAgent class (document Q&A via remote files, local files, and in-memory data)
  embedding.js          ← Embedding class (vector embeddings via gemini-embedding-001)
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
    rag-agent.test.js   ← RagAgent tests
    embedding.test.js   ← Embedding tests
    json-helpers.test.js ← Pure function unit tests
```

### Class Hierarchy

All classes extend `BaseGemini` which provides: auth, client init, chat session management, thinking config, log levels, safety settings, token estimation, cost tracking, usage reporting, `seed()`, Google Search grounding, context caching, and 429 rate-limit retry.

| Class | Primary Method | Description |
|-------|---------------|-------------|
| `Transformer` | `send(payload)` | JSON transformation with few-shot, validation, retry |
| `Chat` | `send(message)` | Multi-turn text conversation with history |
| `Message` | `send(payload)` | Stateless one-off messages via `generateContent()` |
| `ToolAgent` | `chat(message)` / `stream(message)` | Agent with user-provided tools |
| `CodeAgent` | `chat(message)` / `stream(message)` | Agent that writes and executes JavaScript |
| `RagAgent` | `chat(message)` / `stream(message)` | Document Q&A via remote files, local files, and in-memory data |
| `Embedding` | `embed(text)` / `embedBatch(texts)` | Vector embeddings via gemini-embedding-001 |

### Key Design Decisions

- **`systemPrompt`** is the unified option name across all classes (replaces old `systemInstructions`)
- **`send()`** is the primary method on Transformer, Chat, and Message
- **ToolAgent** ships with zero built-in tools — users provide `tools` + `toolExecutor` via constructor
- **CodeAgent** uses a single `execute_code` tool internally — the model writes JavaScript to accomplish tasks
- **`seed()`** is available on BaseGemini (all classes get few-shot capability)
- **`stop()`** is available on both ToolAgent and CodeAgent to cancel mid-execution
- **`onBeforeExecution`** callback on both agents for gating/approval before execution
- **RagAgent** supports three context input types: `remoteFiles` (Files API upload), `localFiles` (read from disk), `localData` (in-memory objects)
- **Embedding** uses `gemini-embedding-001` by default, supports task types, dimensionality control, and cosine similarity
- **Google Search grounding** (`enableGrounding`) is available on all classes via BaseGemini, merges with existing tools
- **Context caching** (`cachedContent`, `createCache()`, `useCache()`) is available on all classes via BaseGemini
- **429 rate-limit retry** (`resourceExhaustedRetries: 5`, `resourceExhaustedDelay: 1000`) — automatic exponential backoff on RESOURCE_EXHAUSTED, separate from Transformer's validation retries (`maxRetries`)
- Default export is a namespace object: `{ Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, Embedding }`

## Key Classes & APIs

### BaseGemini (`base.js`)
Shared foundation. Not typically instantiated directly.
- `init(force?)` — Creates chat session; runs `models.list()` health check only if `healthCheck: true`
- `seed(examples, opts?)` — Add example pairs to chat history
- `getHistory()` / `clearHistory()` — Manage chat history
- `getLastUsage()` — Structured usage data after API calls (includes `groundingMetadata` when grounding enabled)
- `estimate(payload)` / `estimateCost(payload)` — Token/cost estimation
- `enableGrounding` / `groundingConfig` — Google Search grounding (available on all classes)
- `resourceExhaustedRetries` / `resourceExhaustedDelay` — 429 rate-limit retry with exponential backoff (default: 5 retries, 1000ms)
- `healthCheck` — opt-in `models.list()` connectivity check during `init()` (default: `false`)
- `cachedContent` — Attach a context cache to reduce costs
- `createCache(config?)` / `getCache(name)` / `listCaches()` / `updateCache(name, config)` / `deleteCache(name)` — Cache CRUD
- `useCache(name)` — Attach cache and reinitialize session

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
- Optional: `maxToolRounds`, `onToolCall`, `onBeforeExecution`, `writeDir`, `parallelToolCalls`

### CodeAgent (`code-agent.js`)
Agent that writes and executes JavaScript autonomously. Extends BaseGemini.
- `chat(message)` → `{ text, codeExecutions, usage }`
- `stream(message)` → AsyncGenerator yielding `{ type: 'text'|'code'|'output'|'done', ... }`
- `stop()` — Cancel the agent and kill any running child process
- `dump()` — Returns all scripts with descriptive filenames and purposes
- `init()` gathers codebase context (file tree + key files + importantFiles) and injects it into system prompt
- Code executes in Node.js child processes that inherit `process.env`
- Scripts written to `writeDir` (default: `{workingDirectory}/tmp`) with descriptive names (`agent-{purpose}-{timestamp}.mjs`)
- Optional: `workingDirectory`, `maxRounds`, `timeout`, `onBeforeExecution`, `onCodeExecution`, `importantFiles`, `writeDir`, `keepArtifacts`, `comments`, `maxRetries`

### RagAgent (`rag-agent.js`)
Document Q&A agent with three context input types. Extends BaseGemini.
- `chat(message)` → `{ text, usage }`
- `stream(message)` → AsyncGenerator yielding `{ type: 'text'|'done', text?, fullText?, usage? }`
- `init()` uploads remote files via Files API, reads local files from disk, serializes local data, seeds all into chat history
- `addRemoteFiles(paths)` — Add files uploaded via Files API (triggers reinit)
- `addLocalFiles(paths)` — Add local text files read from disk (triggers reinit)
- `addLocalData(entries)` — Add in-memory data entries (triggers reinit)
- `getContext()` — Returns metadata about all context sources: `{ remoteFiles, localFiles, localData }`
- **`remoteFiles`**: uploaded via Google Files API — supports PDF, images, audio, video
- **`localFiles`**: read from disk as UTF-8 text — md, json, csv, yaml, txt, etc.
- **`localData`**: in-memory objects/arrays serialized as JSON — shape: `{ name: string, data: any }[]`

### Embedding (`embedding.js`)
Vector embeddings via Google's text embedding models. Extends BaseGemini (stateless, like Message).
- `embed(text, config?)` → `{ values: number[] }` — Embed a single text
- `embedBatch(texts, config?)` → `EmbeddingResult[]` — Embed multiple texts
- `similarity(a, b)` → `number` — Cosine similarity (pure math, no API call)
- Default model: `gemini-embedding-001`
- Constructor options: `taskType`, `title`, `outputDimensionality`
- `getHistory()`, `clearHistory()`, `seed()`, `estimate()` are no-ops/throw

## Publishing Checklist

- **When adding new `.js` files**, always add them to the `files` array in `package.json`. This controls what gets published to npm — missing entries cause `ERR_MODULE_NOT_FOUND` for consumers.

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
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, Embedding, BaseGemini, log } from 'ak-gemini';
import { extractJSON, attemptJSONRecovery } from 'ak-gemini';

// Default export (namespace object)
import AI from 'ak-gemini';
new AI.Transformer({ ... });

// CommonJS
const { Transformer, Chat } = require('ak-gemini');
```

## Testing Strategy

- "No mocks" approach — all tests use real Gemini API calls
- **Do NOT run tests during development** — they are slow (real API calls) and expensive. Use `npm run typecheck` and `npm run build:cjs` to verify changes.
- Test timeout: 30 seconds (AI calls take 5-15 seconds)
- Rate limiting (429 errors) can cause flaky failures — retry after waiting
- Test files: `base.test.js`, `transformer.test.js`, `chat.test.js`, `message.test.js`, `tool-agent.test.js`, `code-agent.test.js`, `rag-agent.test.js`, `embedding.test.js`, `json-helpers.test.js`

## Key Design Patterns

### Few-Shot Learning (Transformer)
Configurable key mappings: `promptKey` (default: 'PROMPT'), `answerKey` (default: 'ANSWER'), `contextKey` (default: 'CONTEXT'), `explanationKey` (default: 'EXPLANATION')

### Validation & Self-Healing (Transformer)
- Custom async validator functions that throw on failure
- Automatic retry with exponential backoff (`maxRetries`, `retryDelay`)
- AI-powered payload reconstruction via `rebuild()`

### Code Execution (CodeAgent)
- Single `execute_code` tool with `code` + optional `purpose` params — model writes JavaScript, we execute it
- Scripts written to `writeDir` (default: `{workingDirectory}/tmp`) with names like `agent-read-config-1710000000.mjs`
- `keepArtifacts: true` preserves scripts on disk; `false` (default) deletes after execution
- `importantFiles: ['path/to/file.js']` — reads file contents into system prompt for deep project context; supports partial path matching
- `comments: true` instructs the model to write JSDoc comments; `false` (default) saves tokens
- `maxRetries: 3` (default) — tracks consecutive failed executions; on limit, model summarizes failures and asks for user guidance
- Child processes inherit `process.env` for full environment access
- `onBeforeExecution` async callback gates execution (return false to deny)
- `onCodeExecution` notification callback after execution
- File tree + key files + importantFiles gathered during `init()` for codebase awareness
- `stop()` kills running child processes via SIGTERM
- `dump()` returns `[{ fileName, purpose, script, filePath }]` across all executions

### Document Q&A (RagAgent)
- Three context input types combined into a single seeded chat history during `init()`:
  - `remoteFiles` — uploaded via Google Files API, seeded as `fileData` parts (PDFs, images, audio, video)
  - `localFiles` — read from disk as UTF-8 text, seeded as labeled text parts (`--- File: name ---`)
  - `localData` — in-memory objects serialized as JSON, seeded as labeled text parts (`--- Data: name ---`)
- `_waitForFileActive()` polls until uploaded remote files finish processing (2s intervals, 60s timeout)
- `addRemoteFiles()`, `addLocalFiles()`, `addLocalData()` each append and call `init(true)` to reinitialize
- No tool loops — simple send/stream pattern like Chat, but with document/data context

### Agent Stop API (ToolAgent + CodeAgent)
- `agent.stop()` — sets `_stopped` flag, breaks loop before next execution
- Can be called from `onBeforeExecution` or `onToolCall` callbacks
- CodeAgent also kills any running child process on stop

### Token Management
- `estimate()` — INPUT token counts before sending
- `getLastUsage()` — actual consumption AFTER the call
- `estimateCost()` — cost estimate using MODEL_PRICING table

### Google Search Grounding (BaseGemini)
- `enableGrounding: true` + `groundingConfig: {}` on any class constructor
- Grounding tool merges with existing tools (ToolAgent/CodeAgent function declarations coexist)
- Response includes `groundingMetadata` in `getLastUsage()` — contains `groundingChunks`, `webSearchQueries`, etc.
- Per-message toggle available in Transformer via `send(payload, { enableGrounding: true })`
- WARNING: costs ~$35/1k queries

### Context Caching (BaseGemini)
- `cachedContent` constructor option or `useCache(name)` to attach a cache
- `createCache(config)` auto-populates model + systemInstruction from instance
- Cache CRUD: `getCache()`, `listCaches()` (returns array), `updateCache()`, `deleteCache()`
- `useCache()` clears `systemInstruction` from chatConfig (API rejects duplicates since it's in the cache)
- `deleteCache()` clears `cachedContent` if it matches the deleted cache
- TTL format: duration string ending in 's' (e.g., `'3600s'`)

### Embeddings (Embedding)
- Extends BaseGemini for auth reuse; overrides `init()` to skip chat session (like Message)
- Default model: `gemini-embedding-001` (not a generative model)
- `embed(text)` → single embedding, `embedBatch(texts)` → array of embeddings
- `similarity(a, b)` → cosine similarity (pure math, no API)
- Task types: `RETRIEVAL_DOCUMENT`, `RETRIEVAL_QUERY`, `SEMANTIC_SIMILARITY`, `CLUSTERING`, `CLASSIFICATION`
- `outputDimensionality` controls vector size (supported by gemini-embedding-001)

### Billing Labels (Vertex AI)
- Constructor-level: `labels: { app: 'myapp', env: 'prod' }`
- Per-message: `send(payload, { labels: { ... } })`
