import type { GoogleGenAI, ThinkingLevel, HarmCategory, HarmBlockThreshold } from '@google/genai';

export { ThinkingLevel, HarmCategory, HarmBlockThreshold };

export interface ThinkingConfig {
  /** Indicates whether to include thoughts in the response. If true, thoughts are returned only if the model supports thought and thoughts are available. */
  includeThoughts?: boolean;
  /** Indicates the thinking budget in tokens. 0 is DISABLED. -1 is AUTOMATIC. The default values and allowed ranges are model dependent. */
  thinkingBudget?: number;
  /** Optional. The number of thoughts tokens that the model should generate. */
  thinkingLevel?: ThinkingLevel;
}

export interface SafetySetting {
  category: HarmCategory; // The harm category
  threshold: HarmBlockThreshold; // The blocking threshold
}

export interface ChatConfig {
  responseMimeType?: string; // MIME type for responses
  temperature?: number; // Controls randomness (0.0 to 1.0)
  topP?: number; // Controls diversity via nucleus sampling
  topK?: number; // Controls diversity by limiting top-k tokens
  maxOutputTokens?: number; // Maximum number of tokens that can be generated in the response
  systemInstruction?: string; // System instruction for the model
  safetySettings?: SafetySetting[]; // Safety settings array
  responseSchema?: Object; // Schema for validating model responses
  thinkingConfig?: ThinkingConfig; // Thinking features configuration
  labels?: Record<string, string>; // Labels for billing segmentation
  tools?: any[]; // Tools configuration (e.g., grounding)
  [key: string]: any; // Additional properties for flexibility
}

/** Metadata from the last API response, useful for debugging and cost tracking */
export interface ResponseMetadata {
  modelVersion: string | null; // The actual model version that responded
  requestedModel: string; // The model that was requested
  promptTokens: number; // Number of tokens in the prompt
  responseTokens: number; // Number of tokens in the response
  totalTokens: number; // Total tokens used
  timestamp: number; // Timestamp of when the response was received
}

/** Structured usage data returned by getLastUsage() for billing verification */
export interface UsageData {
  promptTokens: number;       // Input tokens (includes system instructions + history + message)
  responseTokens: number;     // Output tokens
  totalTokens: number;        // promptTokens + responseTokens
  modelVersion: string | null; // Actual model that responded (e.g., 'gemini-2.5-flash-001')
  requestedModel: string;     // Model you requested (e.g., 'gemini-2.5-flash')
  timestamp: number;          // When response was received
}

/** Options for per-message configuration */
export interface MessageOptions {
  labels?: Record<string, string>; // Per-message billing labels
  stateless?: boolean; // If true, send message without affecting chat history
  maxRetries?: number; // Override max retries for this message
  retryDelay?: number; // Override retry delay for this message
  enableGrounding?: boolean; // Override grounding setting for this message
  groundingConfig?: Record<string, any>; // Override grounding config for this message
}

export interface AITransformerContext {
  modelName?: string;
  systemInstructions?: string;
  chatConfig?: ChatConfig;
  genAI?: any;
  chat?: any;
  examplesFile?: string | null;
  exampleData?: TransformationExample[] | null;
  promptKey?: string;
  answerKey?: string;
  contextKey?: string;
  explanationKey?: string;
  systemInstructionsKey?: string;
  maxRetries?: number;
  retryDelay?: number;
  init?: (force?: boolean) => Promise<void>; // Initialization function
  seed?: () => Promise<void>; // Function to seed the transformer with examples
  message?: (payload: Record<string, unknown>, opts?: MessageOptions, validatorFn?: AsyncValidatorFunction | null) => Promise<Record<string, unknown>>; // Function to send messages to the model
  rebuild?: (lastPayload: Record<string, unknown>, serverError: string) => Promise<Record<string, unknown>>; // Function to rebuild the transformer
  rawMessage?: (payload: Record<string, unknown> | string, messageOptions?: { labels?: Record<string, string> }) => Promise<Record<string, unknown>>; // Function to send raw messages to the model
  genAIClient?: GoogleGenAI; // Google GenAI client instance
  onlyJSON?: boolean; // If true, only JSON responses are allowed
  enableGrounding?: boolean; // Enable Google Search grounding (default: false, WARNING: costs $35/1k queries)
  groundingConfig?: Record<string, any>; // Additional grounding configuration options
  labels?: Record<string, string>; // Custom labels for billing segmentation (keys: 1-63 chars lowercase, values: max 63 chars)
  estimate?: (nextPayload: Record<string, unknown> | string) => Promise<{ inputTokens: number }>;
  getLastUsage?: () => UsageData | null;
  lastResponseMetadata?: ResponseMetadata | null; // Metadata from the last API response
  exampleCount?: number; // Number of example history items from seed()
  clearConversation?: () => Promise<void>; // Clears conversation history while preserving examples
}

export interface TransformationExample {
  CONTEXT?: Record<string, unknown> | string; // optional context for the transformation
  PROMPT?: Record<string, unknown>; // what the user provides as input
  ANSWER?: Record<string, unknown>; // what the model should return as output
  INPUT?: Record<string, unknown>; // alias for PROMPT
  OUTPUT?: Record<string, unknown>; // alias for ANSWER
  SYSTEM?: string; // system instructions for this example
  EXPLANATION?: string; // explanation for this example
  [key: string]: any; // allow additional properties for flexible key mapping
}

export interface ExampleFileContent {
  examples: TransformationExample[];
}

// Google Auth options for Vertex AI authentication
// See: https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/googleauth.ts
export interface GoogleAuthOptions {
  keyFilename?: string; // Path to a .json, .pem, or .p12 key file
  keyFile?: string; // Alias for keyFilename
  credentials?: { client_email?: string; private_key?: string; [key: string]: any }; // Object containing client_email and private_key
  scopes?: string | string[]; // Required scopes for the API request
  projectId?: string; // Your project ID (alias for project)
  universeDomain?: string; // The default service domain for a Cloud universe
}

export interface AITransformerOptions {
	// ? https://ai.google.dev/gemini-api/docs/models
  modelName?: string; // The Gemini model to use
  systemInstructions?: string; // Custom system instructions for the model
  chatConfig?: ChatConfig; // Configuration object for the chat session
  thinkingConfig?: ThinkingConfig; // Thinking features configuration (defaults to thinkingBudget: 0, thinkingLevel: "MINIMAL")
  maxOutputTokens?: number; // Maximum number of tokens that can be generated in the response (defaults to 50000)
  examplesFile?: string; // Path to JSON file containing transformation examples
  exampleData?: TransformationExample[]; // Inline examples to seed the transformer
  sourceKey?: string; // Key name for source data in examples (alias for promptKey)
  targetKey?: string; // Key name for target data in examples (alias for answerKey)
  promptKey?: string; // Key for the prompt in examples
  answerKey?: string; // Key for the answer in examples
  contextKey?: string; // Key name for context data in examples
  explanationKey?: string; // Key name for explanation data in examples
  systemInstructionsKey?: string; // Key for system instructions in examples
  maxRetries?: number; // Maximum retry attempts for auto-retry functionality
  retryDelay?: number; // Initial retry delay in milliseconds
  // ? https://ai.google.dev/gemini-api/docs/structured-output
  responseSchema?: Object; // Schema for validating model responses
  apiKey?: string; // API key for Google GenAI (Gemini API)
  onlyJSON?: boolean; // If true, only JSON responses are allowed
  asyncValidator?: AsyncValidatorFunction; // Optional async validator function for response validation
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'none'; // Log level for the logger (defaults to 'info', 'none' disables logging)
  enableGrounding?: boolean; // Enable Google Search grounding (default: false, WARNING: costs $35/1k queries)
  groundingConfig?: Record<string, any>; // Additional grounding configuration options
  labels?: Record<string, string>; // Custom labels for billing segmentation

  // Vertex AI Authentication Options
  // Use these instead of apiKey for Vertex AI with service account authentication
  vertexai?: boolean; // Set to true to use Vertex AI instead of Gemini API
  project?: string; // Google Cloud project ID (required for Vertex AI)
  location?: string; // Google Cloud location/region (e.g., 'us-central1') - required for Vertex AI
  googleAuthOptions?: GoogleAuthOptions; // Authentication options for Vertex AI (keyFilename, credentials, etc.)
}

// Async validator function type
export type AsyncValidatorFunction = (payload: Record<string, unknown>) => Promise<unknown>;


export declare class AITransformer {
  // Constructor
  constructor(options?: AITransformerOptions);

  // Properties
  modelName: string;
  promptKey: string;
  answerKey: string;
  contextKey: string;
  explanationKey: string;
  systemInstructionKey: string;
  maxRetries: number;
  retryDelay: number;
  systemInstructions: string;
  chatConfig: ChatConfig;
  apiKey: string;
  onlyJSON: boolean;
  asyncValidator: AsyncValidatorFunction | null;
  genAIClient: any;
  chat: any;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'none';
  enableGrounding: boolean;
  groundingConfig: Record<string, any>;
  labels: Record<string, string>;
  /** Metadata from the last API response (model version, token counts, etc.) */
  lastResponseMetadata: ResponseMetadata | null;
  /** Number of history items that are seeded examples (used by clearConversation) */
  exampleCount: number;

  // Methods
  init(force?: boolean): Promise<void>;
  seed(examples?: TransformationExample[]): Promise<any>;
  /**
   * Send a message to the model.
   * @param payload - The payload to transform
   * @param opts - Options including { stateless: true } to send without affecting history
   * @param validatorFn - Optional validator function
   */
  message(payload: Record<string, unknown>, opts?: MessageOptions, validatorFn?: AsyncValidatorFunction | null): Promise<Record<string, unknown>>;
  rawMessage(sourcePayload: Record<string, unknown> | string, messageOptions?: { labels?: Record<string, string> }): Promise<Record<string, unknown> | any>;
  transformWithValidation(sourcePayload: Record<string, unknown>, validatorFn: AsyncValidatorFunction, options?: MessageOptions): Promise<Record<string, unknown>>;
  messageAndValidate(sourcePayload: Record<string, unknown>, validatorFn: AsyncValidatorFunction, options?: MessageOptions): Promise<Record<string, unknown>>;
  rebuild(lastPayload: Record<string, unknown>, serverError: string): Promise<Record<string, unknown>>;
  reset(): Promise<void>;
  getHistory(): Array<any>;
  /**
   * Estimate INPUT tokens only for a payload before sending.
   * NOTE: Output tokens cannot be predicted before the API call.
   * Use getLastUsage() after message() to see actual consumption.
   */
  estimate(nextPayload: Record<string, unknown> | string): Promise<{ inputTokens: number }>;
  updateSystemInstructions(newInstructions: string): Promise<void>;
  /**
   * Estimates the INPUT cost of sending a payload.
   * NOTE: Output cost depends on response length and cannot be predicted.
   */
  estimateCost(nextPayload: Record<string, unknown> | string): Promise<{
    inputTokens: number;
    model: string;
    pricing: { input: number; output: number };
    estimatedInputCost: number;
    note: string;
  }>;
  /** Clears conversation history while preserving seeded examples */
  clearConversation(): Promise<void>;
  /**
   * Returns structured usage data from the last API response for billing verification.
   * Returns null if no API call has been made yet.
   */
  getLastUsage(): UsageData | null;
}

// Default export
export default AITransformer;