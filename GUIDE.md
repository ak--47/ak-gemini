# ak-gemini — Integration Guide

> A practical guide for rapidly adding AI capabilities to any Node.js codebase using `ak-gemini`.
> Covers every class, common patterns, best practices, and observability hooks.

```sh
npm install ak-gemini
```

**Requirements**: Node.js 18+, a `GEMINI_API_KEY` env var (or Vertex AI credentials).

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Authentication](#authentication)
3. [Class Selection Guide](#class-selection-guide)
4. [Message — Stateless AI Calls](#message--stateless-ai-calls)
5. [Chat — Multi-Turn Conversations](#chat--multi-turn-conversations)
6. [Transformer — Structured JSON Transformation](#transformer--structured-json-transformation)
7. [ToolAgent — Agent with Custom Tools](#toolagent--agent-with-custom-tools)
8. [CodeAgent — Agent That Writes and Runs Code](#codeagent--agent-that-writes-and-runs-code)
9. [RagAgent — Document & Data Q&A](#ragagent--document--data-qa)
10. [Embedding — Vector Embeddings](#embedding--vector-embeddings)
11. [Google Search Grounding](#google-search-grounding)
12. [Context Caching](#context-caching)
13. [Observability & Usage Tracking](#observability--usage-tracking)
14. [Thinking Configuration](#thinking-configuration)
15. [Error Handling & Retries](#error-handling--retries)
16. [Performance Tips](#performance-tips)
17. [Common Integration Patterns](#common-integration-patterns)
18. [Quick Reference](#quick-reference)

---

## Core Concepts

Every class in ak-gemini extends `BaseGemini`, which handles:

- **Authentication** — Gemini API key or Vertex AI service account
- **Chat sessions** — Managed conversation state with the model
- **Token tracking** — Input/output token counts after every call
- **Cost estimation** — Dollar estimates before sending
- **Few-shot seeding** — Inject example pairs to guide the model
- **Thinking config** — Control the model's internal reasoning budget
- **Safety settings** — Harassment and dangerous content filters (relaxed by default)

```javascript
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent } from 'ak-gemini';
// or
import AI from 'ak-gemini';
const t = new AI.Transformer({ ... });
```

The default model is `gemini-2.5-flash`. Override with `modelName`:

```javascript
new Chat({ modelName: 'gemini-2.5-pro' });
```

---

## Authentication

### Gemini API (default)

```javascript
// Option 1: Environment variable (recommended)
// Set GEMINI_API_KEY in your .env or shell
new Chat();

// Option 2: Explicit key
new Chat({ apiKey: 'your-key' });
```

### Vertex AI

```javascript
new Chat({
  vertexai: true,
  project: 'my-gcp-project',           // or GOOGLE_CLOUD_PROJECT env var
  location: 'us-central1',             // or GOOGLE_CLOUD_LOCATION env var
  labels: { app: 'myapp', env: 'prod' } // billing labels (Vertex AI only)
});
```

Vertex AI uses Application Default Credentials. Run `gcloud auth application-default login` locally, or use a service account in production.

---

## Class Selection Guide

| I want to... | Use | Method |
|---|---|---|
| Get a one-off AI response (no history) | `Message` | `send()` |
| Have a back-and-forth conversation | `Chat` | `send()` |
| Transform JSON with examples + validation | `Transformer` | `send()` |
| Give the AI tools to call (APIs, DB, etc.) | `ToolAgent` | `chat()` / `stream()` |
| Let the AI write and run JavaScript | `CodeAgent` | `chat()` / `stream()` |
| Q&A over documents, files, or data | `RagAgent` | `chat()` / `stream()` |
| Generate vector embeddings | `Embedding` | `embed()` / `embedBatch()` |

**Rule of thumb**: Start with `Message` for the simplest integration. Move to `Chat` if you need history. Use `Transformer` when you need structured JSON output with validation. Use agents when the AI needs to take action.

---

## Message — Stateless AI Calls

The simplest class. Each `send()` call is independent — no conversation history is maintained. Ideal for classification, extraction, summarization, and any fire-and-forget AI call.

```javascript
import { Message } from 'ak-gemini';

const msg = new Message({
  systemPrompt: 'You are a sentiment classifier. Respond with: positive, negative, or neutral.'
});

const result = await msg.send('I love this product!');
console.log(result.text);  // "positive"
console.log(result.usage); // { promptTokens, responseTokens, totalTokens, ... }
```

### Structured Output (JSON)

Force the model to return valid JSON matching a schema:

```javascript
const extractor = new Message({
  systemPrompt: 'Extract structured data from the input text.',
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'object',
    properties: {
      people: { type: 'array', items: { type: 'string' } },
      places: { type: 'array', items: { type: 'string' } },
      sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] }
    },
    required: ['people', 'places', 'sentiment']
  }
});

const result = await extractor.send('Alice and Bob visited Paris. They had a wonderful time.');
console.log(result.data);
// { people: ['Alice', 'Bob'], places: ['Paris'], sentiment: 'positive' }
```

Key difference from `Chat`: `result.data` contains the parsed JSON object. `result.text` contains the raw string.

### When to Use Message

- Classification, tagging, or labeling
- Entity extraction
- Summarization
- Any call where previous context doesn't matter
- High-throughput pipelines where you process items independently

---

## Chat — Multi-Turn Conversations

Maintains conversation history across calls. The model remembers what was said earlier.

```javascript
import { Chat } from 'ak-gemini';

const chat = new Chat({
  systemPrompt: 'You are a helpful coding assistant.'
});

const r1 = await chat.send('What is a closure in JavaScript?');
console.log(r1.text);

const r2 = await chat.send('Can you give me an example?');
// The model remembers the closure topic from r1
console.log(r2.text);
```

### History Management

```javascript
// Get conversation history
const history = chat.getHistory();

// Clear and start fresh (preserves system prompt)
await chat.clearHistory();
```

### When to Use Chat

- Interactive assistants and chatbots
- Multi-step reasoning where later questions depend on earlier answers
- Tutoring or coaching interactions
- Any scenario where context carries across messages

---

## Transformer — Structured JSON Transformation

The power tool for data pipelines. Show it examples of input → output mappings, then send new inputs. Includes validation, retry, and AI-powered error correction.

```javascript
import { Transformer } from 'ak-gemini';

const t = new Transformer({
  systemPrompt: 'Transform user profiles into marketing segments.',
  sourceKey: 'INPUT',   // key for input data in examples
  targetKey: 'OUTPUT',  // key for output data in examples
  maxRetries: 3,        // retry on validation failure
  retryDelay: 1000,     // ms between retries
});

// Seed with examples
await t.seed([
  {
    INPUT: { age: 25, spending: 'high', interests: ['tech', 'gaming'] },
    OUTPUT: { segment: 'young-affluent-tech', confidence: 0.9, tags: ['early-adopter'] }
  },
  {
    INPUT: { age: 55, spending: 'medium', interests: ['gardening', 'cooking'] },
    OUTPUT: { segment: 'mature-lifestyle', confidence: 0.85, tags: ['home-focused'] }
  }
]);

// Transform new data
const result = await t.send({ age: 30, spending: 'low', interests: ['books', 'hiking'] });
// result → { segment: '...', confidence: ..., tags: [...] }
```

### Validation

Pass an async validator as the third argument to `send()`. If it throws, the Transformer retries with the error message fed back to the model:

```javascript
const result = await t.send(
  { age: 30, spending: 'low' },
  {},  // options
  async (output) => {
    if (!output.segment) throw new Error('Missing segment field');
    if (output.confidence < 0 || output.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    return output; // return the validated (or modified) output
  }
);
```

Or set a global validator in the constructor:

```javascript
const t = new Transformer({
  asyncValidator: async (output) => {
    if (!output.id) throw new Error('Missing id');
    return output;
  }
});
```

### Self-Healing with `rebuild()`

When downstream code fails, feed the error back to the AI:

```javascript
try {
  await processPayload(result);
} catch (err) {
  const fixed = await t.rebuild(result, err.message);
  await processPayload(fixed); // try again with AI-corrected payload
}
```

### Loading Examples from a File

```javascript
const t = new Transformer({
  examplesFile: './training-data.json'
  // JSON array of { INPUT: ..., OUTPUT: ... } objects
});
await t.seed(); // loads from file automatically
```

### Stateless Sends

Send without affecting the conversation history (useful for parallel processing):

```javascript
const result = await t.send(payload, { stateless: true });
```

### When to Use Transformer

- ETL pipelines — transform data between formats
- API response normalization
- Content enrichment (add tags, categories, scores)
- Any structured data transformation where you can provide examples
- Batch processing with validation guarantees

---

## ToolAgent — Agent with Custom Tools

Give the model tools (functions) it can call. You define what tools exist and how to execute them. The agent handles the conversation loop — sending messages, receiving tool calls, executing them, feeding results back, until the model produces a final text answer.

```javascript
import { ToolAgent } from 'ak-gemini';

const agent = new ToolAgent({
  systemPrompt: 'You are a database assistant.',
  tools: [
    {
      name: 'query_db',
      description: 'Execute a read-only SQL query against the users database',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'The SQL query to execute' }
        },
        required: ['sql']
      }
    },
    {
      name: 'send_email',
      description: 'Send an email notification',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  ],
  toolExecutor: async (toolName, args) => {
    switch (toolName) {
      case 'query_db':
        return await db.query(args.sql);
      case 'send_email':
        await mailer.send(args);
        return { sent: true };
    }
  },
  maxToolRounds: 10 // safety limit on tool-use loop iterations
});

const result = await agent.chat('How many users signed up this week? Email the count to admin@co.com');
console.log(result.text);       // "There were 47 new signups this week. I've sent the email."
console.log(result.toolCalls);  // [{ name: 'query_db', args: {...}, result: [...] }, { name: 'send_email', ... }]
```

### Streaming

Stream the agent's output in real-time — useful for showing progress in a UI:

```javascript
for await (const event of agent.stream('Find the top 5 users by spend')) {
  switch (event.type) {
    case 'text':        process.stdout.write(event.text); break;
    case 'tool_call':   console.log(`\nCalling ${event.toolName}...`); break;
    case 'tool_result': console.log(`Result:`, event.result); break;
    case 'done':        console.log('\nUsage:', event.usage); break;
  }
}
```

### Execution Gating

Control which tool calls are allowed at runtime:

```javascript
const agent = new ToolAgent({
  tools: [...],
  toolExecutor: myExecutor,
  onBeforeExecution: async (toolName, args) => {
    if (toolName === 'delete_user') {
      console.log('Blocked dangerous tool call');
      return false; // deny execution
    }
    return true; // allow
  },
  onToolCall: (toolName, args) => {
    // Notification callback — fires on every tool call (logging, metrics, etc.)
    metrics.increment(`tool_call.${toolName}`);
  }
});
```

### Stopping an Agent

Cancel mid-execution from a callback or externally:

```javascript
// From a callback
onBeforeExecution: async (toolName, args) => {
  if (shouldStop) {
    agent.stop(); // stop after this round
    return false;
  }
  return true;
}

// Externally (e.g., user cancel button, timeout)
setTimeout(() => agent.stop(), 60_000);
const result = await agent.chat('Do some work');
// result includes warning: "Agent was stopped"
```

### When to Use ToolAgent

- AI that needs to call APIs, query databases, or interact with external systems
- Workflow automation — the AI orchestrates a sequence of operations
- Research assistants that fetch and synthesize data from multiple sources
- Any scenario where you want the model to decide *which* tools to use and *when*

---

## CodeAgent — Agent That Writes and Runs Code

Instead of calling tools one by one, the model writes complete JavaScript scripts and executes them in a child process. This is powerful for tasks that require complex logic, file manipulation, or multi-step computation.

```javascript
import { CodeAgent } from 'ak-gemini';

const agent = new CodeAgent({
  workingDirectory: '/path/to/project',
  importantFiles: ['package.json', 'src/config.js'], // injected into system prompt
  timeout: 30_000,    // per-execution timeout
  maxRounds: 10,      // max code execution cycles
  keepArtifacts: true, // keep script files on disk after execution
});

const result = await agent.chat('Find all files larger than 1MB and list them sorted by size');
console.log(result.text);            // Agent's summary
console.log(result.codeExecutions);  // [{ code, output, stderr, exitCode, purpose }]
```

### How It Works

1. On `init()`, the agent scans the working directory and gathers codebase context (file tree, package.json, key files, importantFiles)
2. This context is injected into the system prompt so the model understands the project
3. The model writes JavaScript using an internal `execute_code` tool
4. Code is saved to a `.mjs` file and run in a Node.js child process that inherits `process.env`
5. stdout/stderr feeds back to the model
6. The model decides if more work is needed (up to `maxRounds` cycles)

### Streaming

```javascript
for await (const event of agent.stream('Refactor the auth module to use async/await')) {
  switch (event.type) {
    case 'text':   process.stdout.write(event.text); break;
    case 'code':   console.log('\n--- Executing code ---'); break;
    case 'output': console.log(event.stdout); break;
    case 'done':   console.log('\nDone!', event.usage); break;
  }
}
```

### Execution Gating & Notifications

```javascript
const agent = new CodeAgent({
  workingDirectory: '.',
  onBeforeExecution: async (code) => {
    // Review code before it runs
    if (code.includes('rm -rf')) return false; // deny
    return true;
  },
  onCodeExecution: (code, output) => {
    // Log every execution for audit
    logger.info({ code: code.slice(0, 200), exitCode: output.exitCode });
  }
});
```

### Retrieving Scripts

Get all scripts the agent wrote across all interactions:

```javascript
const scripts = agent.dump();
// [{ fileName: 'agent-read-config.mjs', purpose: 'read-config', script: '...', filePath: '/path/...' }]
```

### When to Use CodeAgent

- File system operations — reading, writing, transforming files
- Data analysis — processing CSV, JSON, or log files
- Codebase exploration — finding patterns, counting occurrences, generating reports
- Prototyping — quickly testing ideas by having the AI write and run code
- Any task where the AI needs more flexibility than predefined tools provide

---

## RagAgent — Document & Data Q&A

Load documents and data into the model's context for grounded Q&A. Supports three input types that can be used together:

| Input Type | Option | What It Does |
|---|---|---|
| **Remote files** | `remoteFiles` | Uploaded via Google Files API — for PDFs, images, audio, video |
| **Local files** | `localFiles` | Read from disk as UTF-8 text — for md, json, csv, yaml, txt |
| **Local data** | `localData` | In-memory objects serialized as JSON |

```javascript
import { RagAgent } from 'ak-gemini';

const agent = new RagAgent({
  // Text files read directly from disk (fast, no upload)
  localFiles: ['./docs/api-reference.md', './docs/architecture.md'],

  // In-memory data
  localData: [
    { name: 'users', data: await db.query('SELECT * FROM users LIMIT 100') },
    { name: 'config', data: JSON.parse(await fs.readFile('./config.json', 'utf-8')) },
  ],

  // Binary/media files uploaded via Files API
  remoteFiles: ['./diagrams/architecture.png', './reports/q4.pdf'],
});

const result = await agent.chat('What authentication method does the API use?');
console.log(result.text);  // Grounded answer citing the api-reference.md
```

### Dynamic Context

Add more context after initialization (each triggers a reinit):

```javascript
await agent.addLocalFiles(['./new-doc.md']);
await agent.addLocalData([{ name: 'metrics', data: { uptime: 99.9 } }]);
await agent.addRemoteFiles(['./new-chart.png']);
```

### Inspecting Context

```javascript
const ctx = agent.getContext();
// {
//   remoteFiles: [{ name, displayName, mimeType, sizeBytes, uri, originalPath }],
//   localFiles: [{ name, path, size }],
//   localData: [{ name, type }]
// }
```

### Streaming

```javascript
for await (const event of agent.stream('Summarize the architecture document')) {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'done') console.log('\nUsage:', event.usage);
}
```

### When to Use RagAgent

- Documentation Q&A — let users ask questions about your docs
- Data exploration — load database results or CSV exports and ask questions
- Code review — load source files and ask about patterns, bugs, or architecture
- Report analysis — load PDF reports and extract insights
- Any scenario where the AI needs to answer questions grounded in specific data

### Choosing Input Types

| Data | Use |
|---|---|
| Plain text files (md, txt, json, csv, yaml) | `localFiles` — fastest, no API upload |
| In-memory objects, DB results, API responses | `localData` — serialized as JSON |
| PDFs, images, audio, video | `remoteFiles` — uploaded via Files API |

Prefer `localFiles` and `localData` when possible — they skip the upload step and initialize faster.

---

## Embedding — Vector Embeddings

Generate vector embeddings for similarity search, clustering, classification, and deduplication. The `Embedding` class uses Google's text embedding models and provides a simple API for single and batch operations.

```javascript
import { Embedding } from 'ak-gemini';

const embedder = new Embedding({
  modelName: 'gemini-embedding-001', // default
});
```

### Basic Embedding

```javascript
const result = await embedder.embed('The quick brown fox jumps over the lazy dog');
console.log(result.values);      // [0.012, -0.034, 0.056, ...] — 768 dimensions by default
console.log(result.values.length); // 768
```

### Batch Embedding

Embed multiple texts in a single API call for efficiency:

```javascript
const texts = [
  'Machine learning fundamentals',
  'Deep neural networks',
  'How to bake sourdough bread',
];

const results = await embedder.embedBatch(texts);
// results[0].values, results[1].values, results[2].values
```

### Task Types

Task types optimize embeddings for specific use cases:

```javascript
// For documents being indexed
const docEmbedder = new Embedding({
  taskType: 'RETRIEVAL_DOCUMENT',
  title: 'API Reference'  // title only applies to RETRIEVAL_DOCUMENT
});

// For search queries against those documents
const queryEmbedder = new Embedding({
  taskType: 'RETRIEVAL_QUERY'
});

// Other task types
new Embedding({ taskType: 'SEMANTIC_SIMILARITY' });
new Embedding({ taskType: 'CLUSTERING' });
new Embedding({ taskType: 'CLASSIFICATION' });
```

**Best practice**: Use `RETRIEVAL_DOCUMENT` when embedding content to store, and `RETRIEVAL_QUERY` when embedding the user's search query.

### Output Dimensionality

Reduce embedding dimensions to save storage space (trade-off with accuracy):

```javascript
// Constructor-level
const embedder = new Embedding({ outputDimensionality: 256 });

// Per-call override
const result = await embedder.embed('Hello', { outputDimensionality: 128 });
console.log(result.values.length); // 128
```

Supported by `gemini-embedding-001` (not `text-embedding-001`).

### Cosine Similarity

Compare two embeddings without an API call:

```javascript
const [a, b] = await Promise.all([
  embedder.embed('cats are great pets'),
  embedder.embed('dogs are wonderful companions'),
]);

const score = embedder.similarity(a.values, b.values);
// score ≈ 0.85 (semantically similar)
```

Returns a value between -1 (opposite) and 1 (identical). Typical thresholds:
- `> 0.8` — very similar
- `0.5–0.8` — somewhat related
- `< 0.5` — different topics

### Integration Pattern: Semantic Search

```javascript
// Index phase
const documents = ['doc1 text...', 'doc2 text...', 'doc3 text...'];
const docEmbedder = new Embedding({ taskType: 'RETRIEVAL_DOCUMENT' });
const docVectors = await docEmbedder.embedBatch(documents);

// Search phase
const queryEmbedder = new Embedding({ taskType: 'RETRIEVAL_QUERY' });
const queryVector = await queryEmbedder.embed('how do I authenticate?');

// Find best match
const scores = docVectors.map((doc, i) => ({
  index: i,
  score: queryEmbedder.similarity(queryVector.values, doc.values)
}));
scores.sort((a, b) => b.score - a.score);
console.log('Best match:', documents[scores[0].index]);
```

### When to Use Embedding

- Semantic search — find documents similar to a query
- Deduplication — detect near-duplicate content
- Clustering — group similar items together
- Classification — compare against known category embeddings
- Recommendation — find items similar to user preferences

---

## Google Search Grounding

Ground model responses in real-time Google Search results. Available on **all classes** via `enableGrounding` — not just Transformer.

**Warning**: Google Search grounding costs approximately **$35 per 1,000 queries**. Use selectively.

### Basic Usage

```javascript
import { Chat } from 'ak-gemini';

const chat = new Chat({
  enableGrounding: true
});

const result = await chat.send('What happened in tech news today?');
console.log(result.text); // Response grounded in current search results
```

### Grounding Metadata

When grounding is enabled, `getLastUsage()` includes source attribution:

```javascript
const usage = chat.getLastUsage();

if (usage.groundingMetadata) {
  // Search queries the model executed
  console.log('Queries:', usage.groundingMetadata.webSearchQueries);

  // Source citations
  for (const chunk of usage.groundingMetadata.groundingChunks || []) {
    if (chunk.web) {
      console.log(`Source: ${chunk.web.title} — ${chunk.web.uri}`);
    }
  }
}
```

### Grounding Configuration

```javascript
const chat = new Chat({
  enableGrounding: true,
  groundingConfig: {
    // Exclude specific domains
    excludeDomains: ['reddit.com', 'twitter.com'],

    // Filter by time range (Gemini API only)
    timeRangeFilter: {
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-12-31T23:59:59Z'
    }
  }
});
```

### Grounding with ToolAgent

Grounding works alongside user-defined tools — both are merged into the tools array automatically:

```javascript
const agent = new ToolAgent({
  enableGrounding: true,
  tools: [
    { name: 'save_result', description: 'Save a research result', parametersJsonSchema: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' } }, required: ['title', 'summary'] } }
  ],
  toolExecutor: async (name, args) => {
    if (name === 'save_result') return await db.insert(args);
  }
});

// The agent can search the web AND call your tools
const result = await agent.chat('Research the latest AI safety developments and save the key findings');
```

### Per-Message Grounding Toggle (Transformer)

Transformer supports toggling grounding per-message without rebuilding the instance:

```javascript
const t = new Transformer({ enableGrounding: false });

// Enable grounding for just this call
const result = await t.send(payload, { enableGrounding: true });

// Back to no grounding for subsequent calls
```

### When to Use Grounding

- Questions about current events, recent news, or real-time data
- Fact-checking or verification tasks
- Research assistants that need up-to-date information
- Any scenario where the model's training data cutoff is a limitation

---

## Context Caching

Cache system prompts, documents, or tool definitions to reduce costs when making many API calls with the same large context. Cached tokens are billed at a reduced rate.

### When Context Caching Helps

- **Large system prompts** reused across many calls
- **RagAgent** with the same document set serving many queries
- **ToolAgent** with many tool definitions
- Any scenario with high token count in repeated context

### Create and Use a Cache

```javascript
import { Chat } from 'ak-gemini';

const chat = new Chat({
  systemPrompt: veryLongSystemPrompt  // e.g., 10,000+ tokens
});

// Create a cache (auto-uses this instance's model and systemPrompt)
const cache = await chat.createCache({
  ttl: '3600s',           // 1 hour
  displayName: 'my-app-system-prompt'
});

console.log(cache.name);       // Server-generated resource name
console.log(cache.expireTime); // When it expires

// Attach the cache to this instance
await chat.useCache(cache.name);

// All subsequent calls use cached tokens at reduced cost
const r1 = await chat.send('Hello');
const r2 = await chat.send('Tell me more');
```

### Cache Management

```javascript
// List all caches
const caches = await chat.listCaches();

// Get cache details
const info = await chat.getCache(cache.name);
console.log(info.usageMetadata?.totalTokenCount);

// Extend TTL
await chat.updateCache(cache.name, { ttl: '7200s' });

// Delete when done
await chat.deleteCache(cache.name);
```

### Cache with Constructor

If you already have a cache name, pass it directly:

```javascript
const chat = new Chat({
  cachedContent: 'projects/my-project/locations/us-central1/cachedContents/abc123'
});
```

### What Can Be Cached

The `createCache()` config accepts:

| Field | Description |
|---|---|
| `systemInstruction` | System prompt (auto-populated from instance if not provided) |
| `contents` | Content messages to cache |
| `tools` | Tool declarations to cache |
| `toolConfig` | Tool configuration to cache |
| `ttl` | Time-to-live (e.g., `'3600s'`) |
| `displayName` | Human-readable label |

### Cost Savings

Context caching reduces input token costs for cached content. The exact savings depend on the model — check [Google's pricing page](https://ai.google.dev/pricing) for current rates. The trade-off is the cache storage cost and the minimum cache size requirement.

**Rule of thumb**: Caching pays off when you make many calls with the same large context (system prompt + documents) within the cache TTL.

---

## Observability & Usage Tracking

Every class provides consistent observability hooks.

### Token Usage

After every API call, get detailed token counts:

```javascript
const usage = instance.getLastUsage();
// {
//   promptTokens: 1250,      // input tokens (cumulative across retries)
//   responseTokens: 340,     // output tokens (cumulative across retries)
//   totalTokens: 1590,       // total (cumulative)
//   attempts: 1,             // 1 = first try, 2+ = retries needed
//   modelVersion: 'gemini-2.5-flash-001',  // actual model that responded
//   requestedModel: 'gemini-2.5-flash',    // model you requested
//   timestamp: 1710000000000
// }
```

### Cost Estimation

Estimate cost *before* sending:

```javascript
const estimate = await instance.estimateCost('What is the meaning of life?');
// {
//   inputTokens: 8,
//   model: 'gemini-2.5-flash',
//   pricing: { input: 0.15, output: 0.60 },  // per million tokens
//   estimatedInputCost: 0.0000012,
//   note: 'Output cost depends on response length'
// }
```

Or just get the token count:

```javascript
const { inputTokens } = await instance.estimate('some payload');
```

### Logging

All classes use [pino](https://github.com/pinojs/pino) for structured logging. Control the level:

```javascript
// Per-instance
new Chat({ logLevel: 'debug' });

// Via environment
LOG_LEVEL=debug node app.js

// Via NODE_ENV (dev → debug, test → warn, prod → info)
```

### Agent Callbacks

ToolAgent and CodeAgent provide execution callbacks for building audit trails, metrics, and approval flows:

```javascript
// ToolAgent
new ToolAgent({
  onToolCall: (toolName, args) => {
    // Fires on every tool call — use for logging, metrics
    logger.info({ event: 'tool_call', tool: toolName, args });
  },
  onBeforeExecution: async (toolName, args) => {
    // Fires before execution — return false to deny
    // Use for approval flows, safety checks, rate limiting
    return !blocklist.includes(toolName);
  }
});

// CodeAgent
new CodeAgent({
  onCodeExecution: (code, output) => {
    // Fires after every code execution
    logger.info({ event: 'code_exec', exitCode: output.exitCode, lines: code.split('\n').length });
  },
  onBeforeExecution: async (code) => {
    // Review code before execution
    if (code.includes('process.exit')) return false;
    return true;
  }
});
```

### Billing Labels (Vertex AI)

Tag API calls for cost attribution:

```javascript
// Constructor-level (applies to all calls)
new Transformer({
  vertexai: true,
  project: 'my-project',
  labels: { app: 'etl-pipeline', env: 'prod', team: 'data' }
});

// Per-message override
await transformer.send(payload, { labels: { job_id: 'abc123' } });
```

---

## Thinking Configuration

Models like `gemini-2.5-flash` and `gemini-2.5-pro` support thinking — internal reasoning before answering. Control the budget:

```javascript
// Disable thinking (default — fastest, cheapest)
new Chat({ thinkingConfig: { thinkingBudget: 0 } });

// Automatic thinking budget (model decides)
new Chat({ thinkingConfig: { thinkingBudget: -1 } });

// Fixed budget (in tokens)
new Chat({ thinkingConfig: { thinkingBudget: 2048 } });

// Use ThinkingLevel enum
import { ThinkingLevel } from 'ak-gemini';
new Chat({ thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } });
```

**When to enable thinking**: Complex reasoning, math, multi-step logic, code generation. **When to disable**: Simple classification, extraction, or chat where speed matters.

---

## Error Handling & Retries

### Transformer Retries

The Transformer has built-in retry with exponential backoff when validation fails:

```javascript
const t = new Transformer({
  maxRetries: 3,   // default: 3
  retryDelay: 1000 // default: 1000ms, doubles each retry
});
```

Each retry feeds the validation error back to the model, giving it a chance to self-correct. The `usage` object reports cumulative tokens across all attempts:

```javascript
const result = await t.send(payload, {}, validator);
const usage = t.getLastUsage();
console.log(usage.attempts); // 2 = needed one retry
```

### Rate Limiting (429 Errors)

The Gemini API returns 429 when rate limited. ak-gemini does not auto-retry 429s — handle them in your application layer:

```javascript
async function sendWithBackoff(instance, payload, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await instance.send(payload);
    } catch (err) {
      if (err.status === 429 && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2 ** i * 1000));
        continue;
      }
      throw err;
    }
  }
}
```

### CodeAgent Failure Limits

CodeAgent tracks consecutive failed executions. After `maxRetries` (default: 3) consecutive failures, the model summarizes what went wrong and asks for guidance:

```javascript
new CodeAgent({
  maxRetries: 5, // allow more failures before stopping
});
```

---

## Performance Tips

### Reuse Instances

Each instance maintains a chat session. Creating a new instance for every request wastes the system prompt tokens. Reuse instances when possible:

```javascript
// Bad — creates a new session every call
app.post('/classify', async (req, res) => {
  const msg = new Message({ systemPrompt: '...' }); // new instance every request!
  const result = await msg.send(req.body.text);
  res.json(result);
});

// Good — reuse the instance
const classifier = new Message({ systemPrompt: '...' });
app.post('/classify', async (req, res) => {
  const result = await classifier.send(req.body.text);
  res.json(result);
});
```

### Choose the Right Model

| Model | Speed | Cost | Best For |
|---|---|---|---|
| `gemini-2.0-flash-lite` | Fastest | Cheapest | Classification, extraction, simple tasks |
| `gemini-2.0-flash` | Fast | Low | General purpose, good quality |
| `gemini-2.5-flash` | Medium | Low | Best balance of speed and quality |
| `gemini-2.5-pro` | Slow | High | Complex reasoning, code, analysis |

### Use `Message` for Stateless Workloads

`Message` uses `generateContent()` under the hood — no chat session overhead. For pipelines processing thousands of items independently, `Message` is the right choice.

### Use `localFiles` / `localData` over `remoteFiles`

For text-based content, `localFiles` and `localData` skip the Files API upload entirely. They're faster to initialize and don't require network calls for the file upload step.

### Disable Thinking for Simple Tasks

Thinking tokens cost money and add latency. For classification, extraction, or simple formatting tasks, keep `thinkingBudget: 0` (the default).

---

## Common Integration Patterns

### Pattern: API Endpoint Classifier

```javascript
import { Message } from 'ak-gemini';

const classifier = new Message({
  modelName: 'gemini-2.0-flash-lite', // fast + cheap
  systemPrompt: 'Classify support tickets. Respond with exactly one of: billing, technical, account, other.',
});

app.post('/api/classify-ticket', async (req, res) => {
  const result = await classifier.send(req.body.text);
  res.json({ category: result.text.trim().toLowerCase() });
});
```

### Pattern: ETL Pipeline with Validation

```javascript
import { Transformer } from 'ak-gemini';

const normalizer = new Transformer({
  sourceKey: 'RAW',
  targetKey: 'NORMALIZED',
  maxRetries: 3,
  asyncValidator: async (output) => {
    if (!output.email?.includes('@')) throw new Error('Invalid email');
    if (!output.name?.trim()) throw new Error('Name is required');
    return output;
  }
});

await normalizer.seed([
  { RAW: { nm: 'alice', mail: 'alice@co.com' }, NORMALIZED: { name: 'Alice', email: 'alice@co.com' } },
]);

for (const record of rawRecords) {
  const clean = await normalizer.send(record, { stateless: true });
  await db.insert('users', clean);
}
```

### Pattern: Conversational Assistant with Tools

```javascript
import { ToolAgent } from 'ak-gemini';

const assistant = new ToolAgent({
  systemPrompt: `You are a customer support agent for Acme Corp.
You can look up orders and issue refunds. Always confirm before issuing refunds.`,
  tools: [
    {
      name: 'lookup_order',
      description: 'Look up an order by ID or customer email',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          email: { type: 'string' }
        }
      }
    },
    {
      name: 'issue_refund',
      description: 'Issue a refund for an order',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          amount: { type: 'number' },
          reason: { type: 'string' }
        },
        required: ['order_id', 'amount', 'reason']
      }
    }
  ],
  toolExecutor: async (toolName, args) => {
    if (toolName === 'lookup_order') return await orderService.lookup(args);
    if (toolName === 'issue_refund') return await orderService.refund(args);
  },
  onBeforeExecution: async (toolName, args) => {
    // Only allow refunds under $100 without human approval
    if (toolName === 'issue_refund' && args.amount > 100) {
      return false;
    }
    return true;
  }
});

// In a chat endpoint
const result = await assistant.chat(userMessage);
```

### Pattern: Document Q&A Service

```javascript
import { RagAgent } from 'ak-gemini';

const docs = new RagAgent({
  localFiles: [
    './docs/getting-started.md',
    './docs/api-reference.md',
    './docs/faq.md',
  ],
  systemPrompt: 'You are a documentation assistant. Answer questions based on the docs. If the answer is not in the docs, say so.',
});

app.post('/api/ask', async (req, res) => {
  const result = await docs.chat(req.body.question);
  res.json({ answer: result.text, usage: result.usage });
});
```

### Pattern: Data-Grounded Analysis

```javascript
import { RagAgent } from 'ak-gemini';

const analyst = new RagAgent({
  modelName: 'gemini-2.5-pro', // use a smarter model for analysis
  localData: [
    { name: 'sales_q4', data: await db.query('SELECT * FROM sales WHERE quarter = 4') },
    { name: 'targets', data: await db.query('SELECT * FROM quarterly_targets') },
  ],
  systemPrompt: 'You are a business analyst. Analyze the provided data and answer questions with specific numbers.',
});

const result = await analyst.chat('Which regions missed their Q4 targets? By how much?');
```

### Pattern: Few-Shot Any Class

Every class supports `seed()` for few-shot learning — not just Transformer:

```javascript
import { Chat } from 'ak-gemini';

const chat = new Chat({ systemPrompt: 'You are a SQL expert.' });
await chat.seed([
  { PROMPT: 'Get all users', ANSWER: 'SELECT * FROM users;' },
  { PROMPT: 'Count orders by status', ANSWER: 'SELECT status, COUNT(*) FROM orders GROUP BY status;' },
]);

const result = await chat.send('Find users who signed up in the last 7 days');
// Model follows the SQL-only response pattern from the examples
```

---

## Quick Reference

### Imports

```javascript
// Named exports
import { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, Embedding, BaseGemini, log } from 'ak-gemini';
import { extractJSON, attemptJSONRecovery } from 'ak-gemini';
import { ThinkingLevel, HarmCategory, HarmBlockThreshold } from 'ak-gemini';

// Default export (namespace)
import AI from 'ak-gemini';

// CommonJS
const { Transformer, Chat, Embedding } = require('ak-gemini');
```

### Constructor Options (All Classes)

| Option | Type | Default |
|---|---|---|
| `modelName` | string | `'gemini-2.5-flash'` |
| `systemPrompt` | string \| null \| false | varies by class |
| `apiKey` | string | `GEMINI_API_KEY` env var |
| `vertexai` | boolean | `false` |
| `project` | string | `GOOGLE_CLOUD_PROJECT` env var |
| `location` | string | `'global'` |
| `chatConfig` | object | `{ temperature: 0.7, topP: 0.95, topK: 64 }` |
| `thinkingConfig` | object | `{ thinkingBudget: 0 }` |
| `maxOutputTokens` | number \| null | `50000` |
| `logLevel` | string | based on `NODE_ENV` |
| `labels` | object | `{}` (Vertex AI only) |
| `enableGrounding` | boolean | `false` |
| `groundingConfig` | object | `{}` |
| `cachedContent` | string | `null` |

### Methods Available on All Classes

| Method | Returns | Description |
|---|---|---|
| `init(force?)` | `Promise<void>` | Initialize chat session |
| `seed(examples, opts?)` | `Promise<Array>` | Add few-shot examples |
| `getHistory()` | `Array` | Get conversation history |
| `clearHistory()` | `Promise<void>` | Clear conversation history |
| `getLastUsage()` | `UsageData \| null` | Token usage from last call |
| `estimate(payload)` | `Promise<{ inputTokens }>` | Estimate input tokens |
| `estimateCost(payload)` | `Promise<object>` | Estimate cost in dollars |
| `createCache(config?)` | `Promise<CachedContentInfo>` | Create a context cache |
| `getCache(name)` | `Promise<CachedContentInfo>` | Get cache details |
| `listCaches()` | `Promise<any>` | List all caches |
| `updateCache(name, config?)` | `Promise<CachedContentInfo>` | Update cache TTL |
| `deleteCache(name)` | `Promise<void>` | Delete a cache |
| `useCache(name)` | `Promise<void>` | Attach a cache to this instance |
