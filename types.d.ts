import type { ThinkingLevel, HarmCategory, HarmBlockThreshold } from '@google/genai';

export { ThinkingLevel, HarmCategory, HarmBlockThreshold };

// ── Shared Types ─────────────────────────────────────────────────────────────

export interface ThinkingConfig {
  includeThoughts?: boolean;
  /** Token budget for thinking. 0 = disabled, -1 = automatic. */
  thinkingBudget?: number;
  thinkingLevel?: ThinkingLevel;
}

export interface SafetySetting {
  category: HarmCategory;
  threshold: HarmBlockThreshold;
}

export interface ChatConfig {
  responseMimeType?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  safetySettings?: SafetySetting[];
  responseSchema?: Object;
  thinkingConfig?: ThinkingConfig;
  labels?: Record<string, string>;
  tools?: any[];
  toolConfig?: any;
  [key: string]: any;
}

export interface GroundingChunk {
  web?: { uri?: string; title?: string; domain?: string };
}

export interface GroundingSupport {
  segment?: any;
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
  webSearchQueries?: string[];
  searchEntryPoint?: { renderedContent?: string };
}

export interface ResponseMetadata {
  modelVersion: string | null;
  requestedModel: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  timestamp: number;
  groundingMetadata?: GroundingMetadata | null;
}

export interface UsageData {
  /** CUMULATIVE input tokens across all retry attempts */
  promptTokens: number;
  /** CUMULATIVE output tokens across all retry attempts */
  responseTokens: number;
  /** CUMULATIVE total tokens across all retry attempts */
  totalTokens: number;
  /** Number of attempts (1 = first try success, 2+ = retries needed) */
  attempts: number;
  /** Actual model that responded (e.g., 'gemini-2.5-flash-001') */
  modelVersion: string | null;
  /** Model you requested (e.g., 'gemini-2.5-flash') */
  requestedModel: string;
  timestamp: number;
  groundingMetadata?: GroundingMetadata | null;
}

export interface TransformationExample {
  CONTEXT?: Record<string, unknown> | string;
  PROMPT?: Record<string, unknown>;
  ANSWER?: Record<string, unknown>;
  INPUT?: Record<string, unknown>;
  OUTPUT?: Record<string, unknown>;
  SYSTEM?: string;
  EXPLANATION?: string;
  [key: string]: any;
}

export interface GoogleAuthOptions {
  keyFilename?: string;
  keyFile?: string;
  credentials?: { client_email?: string; private_key?: string; [key: string]: any };
  scopes?: string | string[];
  projectId?: string;
  universeDomain?: string;
}

export interface CacheConfig {
  /** Model to cache for (defaults to instance modelName) */
  model?: string;
  /** Time-to-live duration (e.g., '3600s') */
  ttl?: string;
  /** Human-readable display name */
  displayName?: string;
  /** Content to cache */
  contents?: any[];
  /** System instruction to cache (defaults to instance systemPrompt) */
  systemInstruction?: string;
  /** Tools to cache */
  tools?: any[];
  /** Tool configuration to cache */
  toolConfig?: any;
}

export interface CachedContentInfo {
  /** Server-generated resource name */
  name: string;
  /** User-provided display name */
  displayName?: string;
  /** Model this cache is for */
  model: string;
  /** Creation timestamp */
  createTime: string;
  /** Expiration timestamp */
  expireTime: string;
  /** Cache usage metadata */
  usageMetadata?: { totalTokenCount?: number };
}

export type AsyncValidatorFunction = (payload: Record<string, unknown>) => Promise<unknown>;
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'none';

// ── Constructor Options ──────────────────────────────────────────────────────

export interface BaseGeminiOptions {
  /** Gemini model to use (default: 'gemini-2.5-flash') */
  modelName?: string;
  /** System prompt for the model (null or false to disable) */
  systemPrompt?: string | null | false;
  /** Chat session configuration overrides */
  chatConfig?: Partial<ChatConfig>;
  /** Thinking features configuration */
  thinkingConfig?: ThinkingConfig | null;
  /** Maximum output tokens (default: 50000, null removes limit) */
  maxOutputTokens?: number | null;
  /** Log level (default: based on NODE_ENV) */
  logLevel?: LogLevel;

  // Authentication
  /** API key for Gemini API */
  apiKey?: string;
  /** Use Vertex AI instead of Gemini API */
  vertexai?: boolean;
  /** Google Cloud project ID (required for Vertex AI) */
  project?: string;
  /** Google Cloud location/region */
  location?: string;
  /** Authentication options for Vertex AI */
  googleAuthOptions?: GoogleAuthOptions;

  /** Billing labels for cost segmentation (Vertex AI only) */
  labels?: Record<string, string>;

  /** Enable Google Search grounding (WARNING: costs $35/1k queries) */
  enableGrounding?: boolean;
  /** Google Search grounding configuration (searchTypes, excludeDomains, timeRangeFilter) */
  groundingConfig?: Record<string, any>;

  /** Cached content resource name to use for this session */
  cachedContent?: string;

  /** Max retry attempts for 429 RESOURCE_EXHAUSTED errors (default: 5) */
  resourceExhaustedRetries?: number;
  /** Initial backoff delay in ms for 429 retries, doubles each attempt (default: 1000) */
  resourceExhaustedDelay?: number;
}

export interface TransformerOptions extends BaseGeminiOptions {
  /** Path to JSON file containing transformation examples */
  examplesFile?: string;
  /** Inline examples to seed the transformer */
  exampleData?: TransformationExample[];
  /** Key for source/input data in examples (default: 'PROMPT') */
  sourceKey?: string;
  /** Alias for sourceKey */
  promptKey?: string;
  /** Key for target/output data in examples (default: 'ANSWER') */
  targetKey?: string;
  /** Alias for targetKey */
  answerKey?: string;
  /** Key for context data in examples (default: 'CONTEXT') */
  contextKey?: string;
  /** Key for explanation data in examples (default: 'EXPLANATION') */
  explanationKey?: string;
  /** Key for system prompt overrides in examples (default: 'SYSTEM') */
  systemPromptKey?: string;
  /** Maximum retry attempts for validation failures (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Schema for validating model responses */
  responseSchema?: Object;
  /** If true, only JSON responses are allowed (default: true) */
  onlyJSON?: boolean;
  /** Global async validator function for response validation */
  asyncValidator?: AsyncValidatorFunction;
  /** Enable Google Search grounding (WARNING: costs $35/1k queries) */
  enableGrounding?: boolean;
  /** Additional grounding configuration */
  groundingConfig?: Record<string, any>;
}

export interface ChatOptions extends BaseGeminiOptions {
  // Chat uses base options only — no additional fields needed
}

export interface MessageOptions extends BaseGeminiOptions {
  /** Schema for structured output validation */
  responseSchema?: Object;
  /** MIME type for responses (e.g., 'application/json' for structured output) */
  responseMimeType?: string;
}

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY' | 'CLUSTERING' | 'CLASSIFICATION' | 'QUESTION_ANSWERING' | 'FACT_VERIFICATION';

export interface EmbeddingOptions extends BaseGeminiOptions {
  /** Embedding task type (affects how embeddings are optimized) */
  taskType?: EmbeddingTaskType;
  /** Title for the document being embedded (only with RETRIEVAL_DOCUMENT) */
  title?: string;
  /** Output dimensionality for the embedding vector */
  outputDimensionality?: number;
  /** Whether to auto-truncate long inputs (default: true) */
  autoTruncate?: boolean;
}

export interface EmbedConfig {
  /** Override task type for this call */
  taskType?: EmbeddingTaskType;
  /** Override title for this call */
  title?: string;
  /** Override output dimensionality for this call */
  outputDimensionality?: number;
}

export interface EmbeddingResult {
  /** The embedding vector */
  values?: number[];
  /** Embedding statistics (Vertex AI) */
  statistics?: { tokenCount?: number; truncated?: boolean };
}

/** Tool declaration in @google/genai FunctionDeclaration format */
export interface ToolDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export interface ToolAgentOptions extends BaseGeminiOptions {
  /** Tool declarations for the model */
  tools?: ToolDeclaration[];
  /** Function to execute tool calls: (toolName, args) => result */
  toolExecutor?: (toolName: string, args: Record<string, any>) => Promise<any>;
  /** Max tool-use loop iterations (default: 10) */
  maxToolRounds?: number;
  /** Callback fired when a tool is called */
  onToolCall?: (toolName: string, args: Record<string, any>) => void;
  /** Async callback before tool execution; return false to deny */
  onBeforeExecution?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
  /** Directory for tool-written files (pass-through for toolExecutor use) */
  writeDir?: string;
}

export interface LocalDataEntry {
  /** Label shown to the model (e.g. "users", "config") */
  name: string;
  /** Any JSON-serializable value */
  data: any;
}

export interface RagAgentOptions extends BaseGeminiOptions {
  /** Paths to files uploaded via Google Files API (PDFs, images, audio, video) */
  remoteFiles?: string[];
  /** Paths to local text files read from disk (md, json, csv, yaml, txt) */
  localFiles?: string[];
  /** In-memory data objects to include as context */
  localData?: LocalDataEntry[];
}

export interface CodeAgentOptions extends BaseGeminiOptions {
  /** Working directory for code execution (default: process.cwd()) */
  workingDirectory?: string;
  /** Max code execution loop iterations (default: 10) */
  maxRounds?: number;
  /** Per-execution timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Async callback before code execution; return false to deny */
  onBeforeExecution?: (code: string) => Promise<boolean>;
  /** Notification callback after code execution */
  onCodeExecution?: (code: string, output: { stdout: string; stderr: string; exitCode: number }) => void;
  /** Files whose contents are included in the system prompt for project context */
  importantFiles?: string[];
  /** Directory for writing script files (default: '{workingDirectory}/tmp') */
  writeDir?: string;
  /** Keep script files on disk after execution (default: false) */
  keepArtifacts?: boolean;
  /** Instruct model to write JSDoc comments in generated code (default: false) */
  comments?: boolean;
  /** Max consecutive failed executions before stopping (default: 3) */
  maxRetries?: number;
}

export interface CodeExecution {
  /** The JavaScript code that was executed */
  code: string;
  /** Short slug describing the script's purpose */
  purpose?: string;
  /** stdout from the execution */
  output: string;
  /** stderr from the execution */
  stderr: string;
  /** Process exit code (0 = success) */
  exitCode: number;
}

export interface CodeAgentResponse {
  /** The agent's final text response */
  text: string;
  /** All code executions during this interaction */
  codeExecutions: CodeExecution[];
  /** Token usage data */
  usage: UsageData | null;
}

export interface CodeAgentStreamEvent {
  type: 'text' | 'code' | 'output' | 'done';
  /** For 'text' events: the text chunk */
  text?: string;
  /** For 'code' events: the code about to be executed */
  code?: string;
  /** For 'output' events: stdout from execution */
  stdout?: string;
  /** For 'output' events: stderr from execution */
  stderr?: string;
  /** For 'output' events: process exit code */
  exitCode?: number;
  /** For 'done' events: complete accumulated text */
  fullText?: string;
  /** For 'done' events: all code executions */
  codeExecutions?: CodeExecution[];
  /** For 'done' events: token usage */
  usage?: UsageData | null;
  /** For 'done' events: e.g. "Max tool rounds reached" or "Agent was stopped" */
  warning?: string;
}

// ── Per-Message Options ──────────────────────────────────────────────────────

export interface SendOptions {
  /** Per-message billing labels */
  labels?: Record<string, string>;
  /** Send without affecting chat history (Transformer only) */
  stateless?: boolean;
  /** Override max retries for this message */
  maxRetries?: number;
  /** Override retry delay for this message */
  retryDelay?: number;
  /** Override grounding setting for this message */
  enableGrounding?: boolean;
  /** Override grounding config for this message */
  groundingConfig?: Record<string, any>;
  /** @internal Used to restore grounding state after per-message override */
  _restoreGrounding?: () => Promise<void>;
  [key: string]: any;
}

// ── Response Types ───────────────────────────────────────────────────────────

export interface ChatResponse {
  /** The model's text response */
  text: string;
  /** Token usage data */
  usage: UsageData | null;
}

export interface MessageResponse {
  /** The model's text response */
  text: string;
  /** Parsed structured data (when responseSchema or responseMimeType is set) */
  data?: any;
  /** Token usage data */
  usage: UsageData | null;
}

export interface RagResponse {
  /** The model's text response */
  text: string;
  /** Token usage data */
  usage: UsageData | null;
}

export interface RagStreamEvent {
  type: 'text' | 'done';
  /** For 'text' events: the text chunk */
  text?: string;
  /** For 'done' events: complete accumulated text */
  fullText?: string;
  /** For 'done' events: token usage */
  usage?: UsageData | null;
}

export interface AgentResponse {
  /** The agent's final text response */
  text: string;
  /** All tool calls made during this interaction */
  toolCalls: Array<{ name: string; args: Record<string, any>; result: any }>;
  /** Token usage data */
  usage: UsageData | null;
}

export interface AgentStreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'done';
  /** For 'text' events: the text chunk */
  text?: string;
  /** For 'tool_call' and 'tool_result' events */
  toolName?: string;
  /** For 'tool_call' events: the tool arguments */
  args?: Record<string, any>;
  /** For 'tool_result' events: the tool result */
  result?: any;
  /** For 'done' events: the complete accumulated text */
  fullText?: string;
  /** For 'done' events: token usage */
  usage?: UsageData | null;
  /** For 'done' events: e.g. "Max tool rounds reached" */
  warning?: string;
}

// ── Seed Options ─────────────────────────────────────────────────────────────

export interface SeedOptions {
  promptKey?: string;
  answerKey?: string;
  contextKey?: string;
  explanationKey?: string;
  systemPromptKey?: string;
}

// ── Class Declarations ───────────────────────────────────────────────────────

export declare class BaseGemini {
  constructor(options?: BaseGeminiOptions);

  modelName: string;
  systemPrompt: string | null | false;
  chatConfig: ChatConfig;
  genAIClient: any;
  chatSession: any;
  lastResponseMetadata: ResponseMetadata | null;
  exampleCount: number;
  labels: Record<string, string>;
  vertexai: boolean;
  enableGrounding: boolean;
  groundingConfig: Record<string, any>;
  cachedContent: string | null;

  init(force?: boolean): Promise<void>;
  seed(examples?: TransformationExample[], opts?: SeedOptions): Promise<any[]>;
  getHistory(curated?: boolean): any[];
  clearHistory(): Promise<void>;
  getLastUsage(): UsageData | null;
  estimate(nextPayload: Record<string, unknown> | string): Promise<{ inputTokens: number }>;
  estimateCost(nextPayload: Record<string, unknown> | string): Promise<{
    inputTokens: number;
    model: string;
    pricing: { input: number; output: number };
    estimatedInputCost: number;
    note: string;
  }>;

  // Context Caching
  createCache(config?: CacheConfig): Promise<CachedContentInfo>;
  getCache(cacheName: string): Promise<CachedContentInfo>;
  listCaches(): Promise<CachedContentInfo[]>;
  updateCache(cacheName: string, config?: { ttl?: string; expireTime?: string }): Promise<CachedContentInfo>;
  deleteCache(cacheName: string): Promise<void>;
  useCache(cacheName: string): Promise<void>;
}

export declare class Transformer extends BaseGemini {
  constructor(options?: TransformerOptions);

  promptKey: string;
  answerKey: string;
  contextKey: string;
  explanationKey: string;
  onlyJSON: boolean;
  asyncValidator: AsyncValidatorFunction | null;
  maxRetries: number;
  retryDelay: number;
  seed(examples?: TransformationExample[]): Promise<any[]>;
  send(payload: Record<string, unknown> | string, opts?: SendOptions, validatorFn?: AsyncValidatorFunction | null): Promise<Record<string, unknown>>;
  rawSend(payload: Record<string, unknown> | string, messageOptions?: { labels?: Record<string, string> }): Promise<Record<string, unknown>>;
  rebuild(lastPayload: Record<string, unknown>, serverError: string): Promise<Record<string, unknown>>;
  reset(): Promise<void>;
  updateSystemPrompt(newPrompt: string): Promise<void>;
}

export declare class Chat extends BaseGemini {
  constructor(options?: ChatOptions);

  send(message: string, opts?: { labels?: Record<string, string> }): Promise<ChatResponse>;
}

export declare class Message extends BaseGemini {
  constructor(options?: MessageOptions);

  init(force?: boolean): Promise<void>;
  send(payload: Record<string, unknown> | string, opts?: { labels?: Record<string, string> }): Promise<MessageResponse>;
}

export declare class ToolAgent extends BaseGemini {
  constructor(options?: ToolAgentOptions);

  tools: ToolDeclaration[];
  toolExecutor: ((toolName: string, args: Record<string, any>) => Promise<any>) | null;
  maxToolRounds: number;
  onToolCall: ((toolName: string, args: Record<string, any>) => void) | null;
  onBeforeExecution: ((toolName: string, args: Record<string, any>) => Promise<boolean>) | null;
  /** Directory for tool-written files (pass-through for toolExecutor use) */
  writeDir: string | null;

  chat(message: string, opts?: { labels?: Record<string, string> }): Promise<AgentResponse>;
  stream(message: string, opts?: { labels?: Record<string, string> }): AsyncGenerator<AgentStreamEvent, void, unknown>;
  /** Stop the agent before the next tool execution round */
  stop(): void;
}

export declare class RagAgent extends BaseGemini {
  constructor(options?: RagAgentOptions);

  /** Paths to files uploaded via Google Files API */
  remoteFiles: string[];
  /** Paths to local text files read from disk */
  localFiles: string[];
  /** In-memory data objects */
  localData: LocalDataEntry[];

  init(force?: boolean): Promise<void>;
  chat(message: string, opts?: { labels?: Record<string, string> }): Promise<RagResponse>;
  stream(message: string, opts?: { labels?: Record<string, string> }): AsyncGenerator<RagStreamEvent, void, unknown>;
  /** Add remote files uploaded via Files API (triggers reinitialize) */
  addRemoteFiles(paths: string[]): Promise<void>;
  /** Add local text files read from disk (triggers reinitialize) */
  addLocalFiles(paths: string[]): Promise<void>;
  /** Add in-memory data entries (triggers reinitialize) */
  addLocalData(entries: LocalDataEntry[]): Promise<void>;
  /** Returns metadata about all context sources */
  getContext(): {
    remoteFiles: Array<{ name: string; displayName: string; mimeType: string; sizeBytes: string; uri: string; originalPath: string }>;
    localFiles: Array<{ name: string; path: string; size: number }>;
    localData: Array<{ name: string; type: string }>;
  };
}

export declare class CodeAgent extends BaseGemini {
  constructor(options?: CodeAgentOptions);

  workingDirectory: string;
  maxRounds: number;
  timeout: number;
  onBeforeExecution: ((code: string) => Promise<boolean>) | null;
  onCodeExecution: ((code: string, output: { stdout: string; stderr: string; exitCode: number }) => void) | null;
  /** Files whose contents are included in the system prompt */
  importantFiles: string[];
  /** Directory for writing script files */
  writeDir: string;
  /** Keep script files on disk after execution */
  keepArtifacts: boolean;
  /** Whether the model writes comments in generated code */
  comments: boolean;
  /** Max consecutive failed executions before stopping */
  maxRetries: number;

  init(force?: boolean): Promise<void>;
  chat(message: string, opts?: { labels?: Record<string, string> }): Promise<CodeAgentResponse>;
  stream(message: string, opts?: { labels?: Record<string, string> }): AsyncGenerator<CodeAgentStreamEvent, void, unknown>;
  /** Returns all code scripts written across all chat/stream calls. */
  dump(): Array<{ fileName: string; purpose: string | null; script: string; filePath: string | null }>;
  /** Stop the agent before the next code execution. Kills any running child process. */
  stop(): void;
}

export declare class Embedding extends BaseGemini {
  constructor(options?: EmbeddingOptions);

  taskType: EmbeddingTaskType | null;
  title: string | null;
  outputDimensionality: number | null;
  autoTruncate: boolean;

  init(force?: boolean): Promise<void>;
  /** Embed a single text string */
  embed(text: string, config?: EmbedConfig): Promise<EmbeddingResult>;
  /** Embed multiple text strings in a single API call */
  embedBatch(texts: string[], config?: EmbedConfig): Promise<EmbeddingResult[]>;
  /** Compute cosine similarity between two embedding vectors (-1 to 1) */
  similarity(a: number[], b: number[]): number;
}

// ── Module Exports ───────────────────────────────────────────────────────────

export declare function extractJSON(text: string): any;
export declare function attemptJSONRecovery(text: string, maxAttempts?: number): any | null;

declare const _default: {
  Transformer: typeof Transformer;
  Chat: typeof Chat;
  Message: typeof Message;
  ToolAgent: typeof ToolAgent;
  CodeAgent: typeof CodeAgent;
  RagAgent: typeof RagAgent;
  Embedding: typeof Embedding;
};

export default _default;
