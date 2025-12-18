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
  [key: string]: any; // Additional properties for flexibility
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
  message?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>; // Function to send messages to the model
  rebuild?: (lastPayload: Record<string, unknown>, serverError: string) => Promise<Record<string, unknown>>; // Function to rebuild the transformer
  rawMessage?: (payload: Record<string, unknown> | string) => Promise<Record<string, unknown>>; // Function to send raw messages to the model
  genAIClient?: GoogleGenAI; // Google GenAI client instance
  onlyJSON?: boolean; // If true, only JSON responses are allowed
  enableGrounding?: boolean; // Enable Google Search grounding (default: false, WARNING: costs $35/1k queries)
  groundingConfig?: Record<string, any>; // Additional grounding configuration options

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

export interface AITransformerOptions {
	// ? https://ai.google.dev/gemini-api/docs/models
  modelName?: string; // The Gemini model to use
  systemInstructions?: string; // Custom system instructions for the model
  chatConfig?: ChatConfig; // Configuration object for the chat session
  thinkingConfig?: ThinkingConfig; // Thinking features configuration (defaults to thinkingBudget: 0, thinkingLevel: "MINIMAL")
  maxOutputTokens?: number; // Maximum number of tokens that can be generated in the response (defaults to 100000)
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
  apiKey?: string; // API key for Google GenAI
  onlyJSON?: boolean; // If true, only JSON responses are allowed
  asyncValidator?: AsyncValidatorFunction; // Optional async validator function for response validation
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'none'; // Log level for the logger (defaults to 'info', 'none' disables logging)
  enableGrounding?: boolean; // Enable Google Search grounding (default: false, WARNING: costs $35/1k queries)
  groundingConfig?: Record<string, any>; // Additional grounding configuration options
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
  
  // Methods
  init(force?: boolean): Promise<void>;
  seed(examples?: TransformationExample[]): Promise<any>;
  message(payload: Record<string, unknown>, opts?: object, validatorFn?: AsyncValidatorFunction | null): Promise<Record<string, unknown>>;
  rawMessage(sourcePayload: Record<string, unknown> | string): Promise<Record<string, unknown> | any>;
  transformWithValidation(sourcePayload: Record<string, unknown>, validatorFn: AsyncValidatorFunction, options?: object): Promise<Record<string, unknown>>;
  messageAndValidate(sourcePayload: Record<string, unknown>, validatorFn: AsyncValidatorFunction, options?: object): Promise<Record<string, unknown>>;
  rebuild(lastPayload: Record<string, unknown>, serverError: string): Promise<Record<string, unknown>>;
  reset(): Promise<void>;
  getHistory(): Array<any>;
  estimateTokenUsage(nextPayload: Record<string, unknown> | string): Promise<{ totalTokens: number; breakdown?: any }>;
  estimate(nextPayload: Record<string, unknown> | string): Promise<{ totalTokens: number; breakdown?: any }>;
}

// Default export
declare const _default: typeof AITransformer;
export default _default;