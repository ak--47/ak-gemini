var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.js
var index_exports = {};
__export(index_exports, {
  AIAgent: () => agent_default,
  HarmBlockThreshold: () => import_genai2.HarmBlockThreshold,
  HarmCategory: () => import_genai2.HarmCategory,
  ThinkingLevel: () => import_genai2.ThinkingLevel,
  attemptJSONRecovery: () => attemptJSONRecovery,
  default: () => index_default,
  log: () => logger_default
});
module.exports = __toCommonJS(index_exports);
var import_dotenv2 = __toESM(require("dotenv"), 1);
var import_genai2 = require("@google/genai");
var import_ak_tools = __toESM(require("ak-tools"), 1);
var import_path = __toESM(require("path"), 1);

// logger.js
var import_pino = __toESM(require("pino"), 1);
var isDev = process.env.NODE_ENV !== "production";
var logger = (0, import_pino.default)({
  level: process.env.LOG_LEVEL || "info",
  // Supports 'fatal', 'error', 'warn', 'info', 'debug', 'trace'
  messageKey: "message",
  // GCP expects 'message' instead of Pino's default 'msg'
  transport: isDev ? {
    target: "pino-pretty",
    // Prettified output for local dev
    options: { colorize: true, translateTime: true }
  } : void 0
  // In prod/cloud, keep as JSON for cloud logging
});
var logger_default = logger;

// agent.js
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");

// tools.js
var MAX_RESPONSE_LENGTH = 5e4;
var BUILT_IN_DECLARATIONS = [
  {
    name: "http_get",
    description: "Make an HTTP GET request to any URL. Returns the response status and body as text. Use for fetching web pages, REST APIs, or any HTTP resource.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL to request (including https://)" },
        headers: {
          type: "object",
          description: "Optional HTTP headers as key-value pairs",
          additionalProperties: { type: "string" }
        }
      },
      required: ["url"]
    }
  },
  {
    name: "http_post",
    description: "Make an HTTP POST request to any URL with a JSON body. Returns the response status and body as text.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL to request (including https://)" },
        body: { type: "object", description: "The JSON body to send" },
        headers: {
          type: "object",
          description: "Optional HTTP headers as key-value pairs",
          additionalProperties: { type: "string" }
        }
      },
      required: ["url"]
    }
  },
  {
    name: "write_markdown",
    description: "Generate a structured markdown document such as a report, analysis, summary, or formatted findings. The content will be captured and returned to the caller.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: 'Suggested filename for the document (e.g. "report.md")' },
        title: { type: "string", description: "Document title" },
        content: { type: "string", description: "Full markdown content of the document" }
      },
      required: ["filename", "content"]
    }
  }
];
async function executeBuiltInTool(name, args, options = {}) {
  const { httpTimeout = 3e4, onToolCall, onMarkdown } = options;
  if (onToolCall) {
    try {
      onToolCall(name, args);
    } catch (e) {
      logger_default.warn(`onToolCall callback error: ${e.message}`);
    }
  }
  switch (name) {
    case "http_get": {
      logger_default.debug(`http_get: ${args.url}`);
      const resp = await fetch(args.url, {
        method: "GET",
        headers: args.headers || {},
        signal: AbortSignal.timeout(httpTimeout)
      });
      const text = await resp.text();
      const body = text.length > MAX_RESPONSE_LENGTH ? text.slice(0, MAX_RESPONSE_LENGTH) + "\n...[TRUNCATED]" : text;
      return { status: resp.status, statusText: resp.statusText, body };
    }
    case "http_post": {
      logger_default.debug(`http_post: ${args.url}`);
      const headers = { "Content-Type": "application/json", ...args.headers || {} };
      const resp = await fetch(args.url, {
        method: "POST",
        headers,
        body: args.body ? JSON.stringify(args.body) : void 0,
        signal: AbortSignal.timeout(httpTimeout)
      });
      const text = await resp.text();
      const body = text.length > MAX_RESPONSE_LENGTH ? text.slice(0, MAX_RESPONSE_LENGTH) + "\n...[TRUNCATED]" : text;
      return { status: resp.status, statusText: resp.statusText, body };
    }
    case "write_markdown": {
      logger_default.debug(`write_markdown: ${args.filename}`);
      if (onMarkdown) {
        try {
          onMarkdown(args.filename, args.content);
        } catch (e) {
          logger_default.warn(`onMarkdown callback error: ${e.message}`);
        }
      }
      return { written: true, filename: args.filename, length: args.content.length };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// agent.js
import_dotenv.default.config();
var { NODE_ENV = "unknown", LOG_LEVEL = "" } = process.env;
var DEFAULT_SAFETY_SETTINGS = [
  { category: import_genai.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE },
  { category: import_genai.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE }
];
var DEFAULT_THINKING_CONFIG = {
  thinkingBudget: 0
};
var THINKING_SUPPORTED_MODELS = [
  /^gemini-3-flash(-preview)?$/,
  /^gemini-3-pro(-preview|-image-preview)?$/,
  /^gemini-2\.5-pro/,
  /^gemini-2\.5-flash(-preview)?$/,
  /^gemini-2\.5-flash-lite(-preview)?$/,
  /^gemini-2\.0-flash$/
];
var AIAgent = class {
  /**
   * Create a new AIAgent instance.
   *
   * @param {AIAgentOptions} [options={}] - Configuration options
   * @param {string} [options.apiKey] - Gemini API key (or set GEMINI_API_KEY env var)
   * @param {string} [options.systemPrompt='You are a helpful AI assistant.'] - System prompt
   * @param {string} [options.modelName='gemini-2.5-flash'] - Gemini model to use
   * @param {number} [options.maxToolRounds=10] - Max tool-use loop iterations
   * @param {number} [options.httpTimeout=30000] - HTTP request timeout in ms
   * @param {Function} [options.onToolCall] - Callback fired before each tool execution
   * @param {Function} [options.onMarkdown] - Callback fired when markdown is generated
   * @param {boolean} [options.vertexai=false] - Use Vertex AI instead of Gemini API
   * @param {string} [options.project] - GCP project ID (required for Vertex AI)
   * @param {string} [options.location] - GCP region (defaults to 'global')
   * @param {import('./types').GoogleAuthOptions} [options.googleAuthOptions] - Vertex AI auth
   * @param {import('./types').ThinkingConfig} [options.thinkingConfig] - Extended thinking config
   * @param {Record<string, string>} [options.labels] - Billing labels (Vertex AI only)
   * @param {string} [options.logLevel] - Log level
   */
  constructor(options = {}) {
    this.modelName = options.modelName || "gemini-2.5-flash";
    this.systemPrompt = options.systemPrompt || "You are a helpful AI assistant.";
    this.maxToolRounds = options.maxToolRounds || 10;
    this.httpTimeout = options.httpTimeout || 3e4;
    this.maxRetries = options.maxRetries || 3;
    this.onToolCall = options.onToolCall || null;
    this.onMarkdown = options.onMarkdown || null;
    this.labels = options.labels || {};
    this.vertexai = options.vertexai || false;
    this.project = options.project || process.env.GOOGLE_CLOUD_PROJECT || null;
    this.location = options.location || process.env.GOOGLE_CLOUD_LOCATION || void 0;
    this.googleAuthOptions = options.googleAuthOptions || null;
    this.apiKey = options.apiKey !== void 0 && options.apiKey !== null ? options.apiKey : process.env.GEMINI_API_KEY;
    if (!this.vertexai && !this.apiKey) {
      throw new Error("Missing Gemini API key. Provide via options.apiKey or GEMINI_API_KEY env var. For Vertex AI, set vertexai: true with project and location.");
    }
    if (this.vertexai && !this.project) {
      throw new Error("Vertex AI requires a project ID. Provide via options.project or GOOGLE_CLOUD_PROJECT env var.");
    }
    this._configureLogLevel(options.logLevel);
    this.chatConfig = {
      temperature: 0.7,
      topP: 0.95,
      topK: 64,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      systemInstruction: this.systemPrompt,
      maxOutputTokens: options.chatConfig?.maxOutputTokens || 5e4,
      ...options.chatConfig
    };
    this.chatConfig.systemInstruction = this.systemPrompt;
    this._configureThinking(options.thinkingConfig);
    this.chatConfig.tools = [{ functionDeclarations: BUILT_IN_DECLARATIONS }];
    this.chatConfig.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    this.genAIClient = null;
    this.chatSession = null;
    this.lastResponseMetadata = null;
    this._markdownFiles = [];
    logger_default.debug(`AIAgent created with model: ${this.modelName}`);
  }
  /**
   * Initialize the agent — creates the GenAI client and chat session.
   * Called automatically by chat() and stream() if not called explicitly.
   * Idempotent — safe to call multiple times.
   * @returns {Promise<void>}
   */
  async init() {
    if (this.chatSession) return;
    const clientOptions = this.vertexai ? {
      vertexai: true,
      project: this.project,
      ...this.location && { location: this.location },
      ...this.googleAuthOptions && { googleAuthOptions: this.googleAuthOptions }
    } : { apiKey: this.apiKey };
    this.genAIClient = new import_genai.GoogleGenAI(clientOptions);
    this.chatSession = this.genAIClient.chats.create({
      model: this.modelName,
      config: {
        ...this.chatConfig,
        ...this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels }
      },
      history: []
    });
    try {
      await this.genAIClient.models.list();
      logger_default.debug("AIAgent: Gemini API connection successful.");
    } catch (e) {
      throw new Error(`AIAgent initialization failed: ${e.message}`);
    }
    logger_default.debug("AIAgent: Chat session initialized.");
  }
  /**
   * Send a message and get a complete response (non-streaming).
   * Automatically handles the tool-use loop — if the model requests tool calls,
   * they are executed and results sent back until the model produces a final response.
   *
   * @param {string} message - The user's message
   * @returns {Promise<AgentResponse>} Response with text, toolCalls, markdownFiles, and usage
   * @example
   * const res = await agent.chat('Fetch https://api.example.com/users');
   * console.log(res.text);      // Agent's summary
   * console.log(res.toolCalls); // [{name: 'http_get', args: {...}, result: {...}}]
   */
  async chat(message) {
    if (!this.chatSession) await this.init();
    this._markdownFiles = [];
    const allToolCalls = [];
    let response = await this.chatSession.sendMessage({ message });
    for (let round = 0; round < this.maxToolRounds; round++) {
      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) break;
      const toolResults = await Promise.all(
        functionCalls.map(async (call) => {
          let result;
          try {
            result = await executeBuiltInTool(call.name, call.args, {
              httpTimeout: this.httpTimeout,
              onToolCall: this.onToolCall,
              onMarkdown: this.onMarkdown
            });
          } catch (err) {
            logger_default.warn(`Tool ${call.name} failed: ${err.message}`);
            result = { error: err.message };
          }
          allToolCalls.push({ name: call.name, args: call.args, result });
          if (call.name === "write_markdown" && call.args) {
            this._markdownFiles.push({
              filename: (
                /** @type {string} */
                call.args.filename
              ),
              content: (
                /** @type {string} */
                call.args.content
              )
            });
          }
          return { id: call.id, name: call.name, result };
        })
      );
      response = await this.chatSession.sendMessage({
        message: toolResults.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        }))
      });
    }
    this._captureMetadata(response);
    return {
      text: response.text || "",
      toolCalls: allToolCalls,
      markdownFiles: [...this._markdownFiles],
      usage: this.getLastUsage()
    };
  }
  /**
   * Send a message and stream the response as events.
   * Automatically handles the tool-use loop between streamed rounds.
   *
   * Event types:
   * - `text` — A chunk of the agent's text response (yield as it arrives)
   * - `tool_call` — The agent is about to call a tool (includes toolName and args)
   * - `tool_result` — A tool finished executing (includes toolName and result)
   * - `markdown` — A markdown document was generated (includes filename and content)
   * - `done` — The agent finished (includes fullText, markdownFiles, usage)
   *
   * @param {string} message - The user's message
   * @yields {AgentStreamEvent}
   * @example
   * for await (const event of agent.stream('Analyze this API...')) {
   *   if (event.type === 'text') process.stdout.write(event.text);
   *   if (event.type === 'tool_call') console.log(`Calling: ${event.toolName}`);
   *   if (event.type === 'done') console.log(`\nTokens: ${event.usage?.totalTokens}`);
   * }
   */
  async *stream(message) {
    if (!this.chatSession) await this.init();
    this._markdownFiles = [];
    const allToolCalls = [];
    let fullText = "";
    let streamResponse = await this.chatSession.sendMessageStream({ message });
    for (let round = 0; round < this.maxToolRounds; round++) {
      let roundText = "";
      const functionCalls = [];
      for await (const chunk of streamResponse) {
        if (chunk.functionCalls) {
          functionCalls.push(...chunk.functionCalls);
        } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
          const text = chunk.candidates[0].content.parts[0].text;
          roundText += text;
          fullText += text;
          yield { type: "text", text };
        }
      }
      if (functionCalls.length === 0) {
        yield {
          type: "done",
          fullText,
          markdownFiles: [...this._markdownFiles],
          usage: this.getLastUsage()
        };
        return;
      }
      const toolResults = [];
      for (const call of functionCalls) {
        yield { type: "tool_call", toolName: call.name, args: call.args };
        let result;
        try {
          result = await executeBuiltInTool(call.name, call.args, {
            httpTimeout: this.httpTimeout,
            onToolCall: this.onToolCall,
            onMarkdown: this.onMarkdown
          });
        } catch (err) {
          logger_default.warn(`Tool ${call.name} failed: ${err.message}`);
          result = { error: err.message };
        }
        allToolCalls.push({ name: call.name, args: call.args, result });
        yield { type: "tool_result", toolName: call.name, result };
        if (call.name === "write_markdown" && call.args) {
          const mdFilename = (
            /** @type {string} */
            call.args.filename
          );
          const mdContent = (
            /** @type {string} */
            call.args.content
          );
          this._markdownFiles.push({ filename: mdFilename, content: mdContent });
          yield { type: "markdown", filename: mdFilename, content: mdContent };
        }
        toolResults.push({ id: call.id, name: call.name, result });
      }
      streamResponse = await this.chatSession.sendMessageStream({
        message: toolResults.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        }))
      });
    }
    yield {
      type: "done",
      fullText,
      markdownFiles: [...this._markdownFiles],
      usage: this.getLastUsage(),
      warning: "Max tool rounds reached"
    };
  }
  /**
   * Clear conversation history while preserving tools and system prompt.
   * Useful for starting a new user session without re-initializing the agent.
   * @returns {Promise<void>}
   */
  async clearHistory() {
    this.chatSession = this.genAIClient.chats.create({
      model: this.modelName,
      config: {
        ...this.chatConfig,
        ...this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels }
      },
      history: []
    });
    this._markdownFiles = [];
    this.lastResponseMetadata = null;
    logger_default.debug("AIAgent: Conversation history cleared.");
  }
  /**
   * Get conversation history.
   * @param {boolean} [curated=false]
   * @returns {any[]}
   */
  getHistory(curated = false) {
    if (!this.chatSession) return [];
    return this.chatSession.getHistory(curated);
  }
  /**
   * Get structured usage data from the last API call.
   * Returns null if no API call has been made yet.
   * @returns {UsageData|null} Usage data with promptTokens, responseTokens, totalTokens, etc.
   */
  getLastUsage() {
    if (!this.lastResponseMetadata) return null;
    const m = this.lastResponseMetadata;
    return {
      promptTokens: m.promptTokens,
      responseTokens: m.responseTokens,
      totalTokens: m.totalTokens,
      attempts: 1,
      modelVersion: m.modelVersion,
      requestedModel: this.modelName,
      timestamp: m.timestamp
    };
  }
  // --- Private helpers ---
  /**
   * Capture response metadata (model version, token counts) from an API response.
   * @param {import('@google/genai').GenerateContentResponse} response
   * @private
   */
  _captureMetadata(response) {
    this.lastResponseMetadata = {
      modelVersion: response.modelVersion || null,
      requestedModel: this.modelName,
      promptTokens: response.usageMetadata?.promptTokenCount || 0,
      responseTokens: response.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: response.usageMetadata?.totalTokenCount || 0,
      timestamp: Date.now()
    };
  }
  /** @private */
  _configureLogLevel(logLevel) {
    if (logLevel) {
      if (logLevel === "none") {
        logger_default.level = "silent";
      } else {
        logger_default.level = logLevel;
      }
    } else if (LOG_LEVEL) {
      logger_default.level = LOG_LEVEL;
    } else if (NODE_ENV === "dev") {
      logger_default.level = "debug";
    } else if (NODE_ENV === "test") {
      logger_default.level = "warn";
    } else if (NODE_ENV.startsWith("prod")) {
      logger_default.level = "error";
    } else {
      logger_default.level = "info";
    }
  }
  /** @private */
  _configureThinking(thinkingConfig) {
    const modelSupportsThinking = THINKING_SUPPORTED_MODELS.some((p) => p.test(this.modelName));
    if (thinkingConfig === void 0) return;
    if (thinkingConfig === null) {
      delete this.chatConfig.thinkingConfig;
      return;
    }
    if (!modelSupportsThinking) {
      logger_default.warn(`Model ${this.modelName} does not support thinking features. Ignoring thinkingConfig.`);
      return;
    }
    const config = { ...DEFAULT_THINKING_CONFIG, ...thinkingConfig };
    if (thinkingConfig.thinkingLevel !== void 0) {
      delete config.thinkingBudget;
    }
    this.chatConfig.thinkingConfig = config;
    logger_default.debug(`Thinking config applied: ${JSON.stringify(config)}`);
  }
};
var agent_default = AIAgent;

// index.js
var import_meta = {};
import_dotenv2.default.config();
var { NODE_ENV: NODE_ENV2 = "unknown", GEMINI_API_KEY, LOG_LEVEL: LOG_LEVEL2 = "" } = process.env;
var DEFAULT_SAFETY_SETTINGS2 = [
  { category: import_genai2.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: import_genai2.HarmBlockThreshold.BLOCK_NONE },
  { category: import_genai2.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: import_genai2.HarmBlockThreshold.BLOCK_NONE }
];
var DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON).

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.
`;
var DEFAULT_THINKING_CONFIG2 = {
  thinkingBudget: 0
};
var DEFAULT_MAX_OUTPUT_TOKENS = 5e4;
var THINKING_SUPPORTED_MODELS2 = [
  /^gemini-3-flash(-preview)?$/,
  /^gemini-3-pro(-preview|-image-preview)?$/,
  /^gemini-2\.5-pro/,
  /^gemini-2\.5-flash(-preview)?$/,
  /^gemini-2\.5-flash-lite(-preview)?$/,
  /^gemini-2\.0-flash$/
  // Experimental support, exact match only
];
var DEFAULT_CHAT_CONFIG = {
  responseMimeType: "application/json",
  temperature: 0.2,
  topP: 0.95,
  topK: 64,
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTIONS,
  safetySettings: DEFAULT_SAFETY_SETTINGS2
};
var AITransformer = class {
  /**
   * @param {AITransformerOptions} [options={}] - Configuration options for the transformer	
   * 
   */
  constructor(options = {}) {
    this.modelName = "";
    this.promptKey = "";
    this.answerKey = "";
    this.contextKey = "";
    this.explanationKey = "";
    this.systemInstructionKey = "";
    this.maxRetries = 3;
    this.retryDelay = 1e3;
    this.chatConfig = {};
    this.apiKey = GEMINI_API_KEY;
    this.onlyJSON = true;
    this.asyncValidator = null;
    this.logLevel = "info";
    this.lastResponseMetadata = null;
    this.exampleCount = 0;
    this._cumulativeUsage = {
      promptTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      attempts: 0
    };
    AITransformFactory.call(this, options);
    this.init = initChat.bind(this);
    this.seed = seedWithExamples.bind(this);
    this.rawMessage = rawMessage.bind(this);
    this.message = (payload, opts = {}, validatorFn = null) => {
      return prepareAndValidateMessage.call(this, payload, opts, validatorFn || this.asyncValidator);
    };
    this.rebuild = rebuildPayload.bind(this);
    this.reset = resetChat.bind(this);
    this.getHistory = getChatHistory.bind(this);
    this.messageAndValidate = prepareAndValidateMessage.bind(this);
    this.transformWithValidation = prepareAndValidateMessage.bind(this);
    this.estimate = estimateInputTokens.bind(this);
    this.updateSystemInstructions = updateSystemInstructions.bind(this);
    this.estimateCost = estimateCost.bind(this);
    this.clearConversation = clearConversation.bind(this);
    this.getLastUsage = getLastUsage.bind(this);
  }
};
var index_default = AITransformer;
function AITransformFactory(options = {}) {
  this.modelName = options.modelName || "gemini-2.5-flash";
  if (options.systemInstructions === void 0) {
    this.systemInstructions = DEFAULT_SYSTEM_INSTRUCTIONS;
  } else {
    this.systemInstructions = options.systemInstructions;
  }
  if (options.logLevel) {
    this.logLevel = options.logLevel;
    if (this.logLevel === "none") {
      logger_default.level = "silent";
    } else {
      logger_default.level = this.logLevel;
    }
  } else if (LOG_LEVEL2) {
    this.logLevel = LOG_LEVEL2;
    logger_default.level = LOG_LEVEL2;
  } else if (NODE_ENV2 === "dev") {
    this.logLevel = "debug";
    logger_default.level = "debug";
  } else if (NODE_ENV2 === "test") {
    this.logLevel = "warn";
    logger_default.level = "warn";
  } else if (NODE_ENV2.startsWith("prod")) {
    this.logLevel = "error";
    logger_default.level = "error";
  } else {
    this.logLevel = "info";
    logger_default.level = "info";
  }
  this.vertexai = options.vertexai || false;
  this.project = options.project || process.env.GOOGLE_CLOUD_PROJECT || null;
  this.location = options.location || process.env.GOOGLE_CLOUD_LOCATION || void 0;
  this.googleAuthOptions = options.googleAuthOptions || null;
  this.apiKey = options.apiKey !== void 0 && options.apiKey !== null ? options.apiKey : GEMINI_API_KEY;
  if (!this.vertexai && !this.apiKey) {
    throw new Error("Missing Gemini API key. Provide via options.apiKey or GEMINI_API_KEY env var. For Vertex AI, set vertexai: true with project and location.");
  }
  if (this.vertexai && !this.project) {
    throw new Error("Vertex AI requires a project ID. Provide via options.project or GOOGLE_CLOUD_PROJECT env var.");
  }
  this.chatConfig = {
    ...DEFAULT_CHAT_CONFIG,
    ...options.chatConfig
  };
  if (this.systemInstructions) {
    this.chatConfig.systemInstruction = this.systemInstructions;
  } else if (options.systemInstructions !== void 0) {
    delete this.chatConfig.systemInstruction;
  }
  if (options.maxOutputTokens !== void 0) {
    if (options.maxOutputTokens === null) {
      delete this.chatConfig.maxOutputTokens;
    } else {
      this.chatConfig.maxOutputTokens = options.maxOutputTokens;
    }
  } else if (options.chatConfig?.maxOutputTokens !== void 0) {
    if (options.chatConfig.maxOutputTokens === null) {
      delete this.chatConfig.maxOutputTokens;
    } else {
      this.chatConfig.maxOutputTokens = options.chatConfig.maxOutputTokens;
    }
  } else {
    this.chatConfig.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
  }
  const modelSupportsThinking = THINKING_SUPPORTED_MODELS2.some(
    (pattern) => pattern.test(this.modelName)
  );
  if (options.thinkingConfig !== void 0) {
    if (options.thinkingConfig === null) {
      delete this.chatConfig.thinkingConfig;
      if (logger_default.level !== "silent") {
        logger_default.debug(`thinkingConfig set to null - removed from configuration`);
      }
    } else if (modelSupportsThinking) {
      const thinkingConfig = {
        ...DEFAULT_THINKING_CONFIG2,
        ...options.thinkingConfig
      };
      if (options.thinkingConfig?.thinkingLevel !== void 0) {
        delete thinkingConfig.thinkingBudget;
      }
      this.chatConfig.thinkingConfig = thinkingConfig;
      if (logger_default.level !== "silent") {
        logger_default.debug(`Model ${this.modelName} supports thinking. Applied thinkingConfig:`, thinkingConfig);
      }
    } else {
      if (logger_default.level !== "silent") {
        logger_default.warn(`Model ${this.modelName} does not support thinking features. Ignoring thinkingConfig.`);
      }
    }
  }
  if (options.responseSchema) {
    this.chatConfig.responseSchema = options.responseSchema;
  }
  this.examplesFile = options.examplesFile || null;
  this.exampleData = options.exampleData || null;
  this.promptKey = options.promptKey || options.sourceKey || "PROMPT";
  this.answerKey = options.answerKey || options.targetKey || "ANSWER";
  this.contextKey = options.contextKey || "CONTEXT";
  this.explanationKey = options.explanationKey || "EXPLANATION";
  this.systemInstructionsKey = options.systemInstructionsKey || "SYSTEM";
  this.maxRetries = options.maxRetries || 3;
  this.retryDelay = options.retryDelay || 1e3;
  this.asyncValidator = options.asyncValidator || null;
  this.onlyJSON = options.onlyJSON !== void 0 ? options.onlyJSON : true;
  this.enableGrounding = options.enableGrounding || false;
  this.groundingConfig = options.groundingConfig || {};
  this.labels = options.labels || {};
  if (Object.keys(this.labels).length > 0 && logger_default.level !== "silent") {
    if (!this.vertexai) {
      logger_default.warn(`Billing labels are only supported with Vertex AI. Labels will be ignored.`);
    } else {
      logger_default.debug(`Billing labels configured: ${JSON.stringify(this.labels)}`);
    }
  }
  if (this.promptKey === this.answerKey) {
    throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
  }
  if (logger_default.level !== "silent") {
    logger_default.debug(`Creating AI Transformer with model: ${this.modelName}`);
    logger_default.debug(`Using keys - Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
    logger_default.debug(`Max output tokens set to: ${this.chatConfig.maxOutputTokens}`);
    if (this.vertexai) {
      logger_default.debug(`Using Vertex AI - Project: ${this.project}, Location: ${this.location || "global (default)"}`);
      if (this.googleAuthOptions?.keyFilename) {
        logger_default.debug(`Auth: Service account key file: ${this.googleAuthOptions.keyFilename}`);
      } else if (this.googleAuthOptions?.credentials) {
        logger_default.debug(`Auth: Inline credentials provided`);
      } else {
        logger_default.debug(`Auth: Application Default Credentials (ADC)`);
      }
    } else {
      logger_default.debug(`Using Gemini API with key: ${this.apiKey.substring(0, 10)}...`);
    }
    logger_default.debug(`Grounding ${this.enableGrounding ? "ENABLED" : "DISABLED"} (costs $35/1k queries)`);
  }
  const clientOptions = this.vertexai ? {
    vertexai: true,
    project: this.project,
    ...this.location && { location: this.location },
    ...this.googleAuthOptions && { googleAuthOptions: this.googleAuthOptions }
  } : { apiKey: this.apiKey };
  const ai = new import_genai2.GoogleGenAI(clientOptions);
  this.genAIClient = ai;
  this.chat = null;
}
async function initChat(force = false) {
  if (this.chat && !force) return;
  logger_default.debug(`Initializing Gemini chat session with model: ${this.modelName}...`);
  const chatOptions = {
    model: this.modelName,
    // @ts-ignore
    config: {
      ...this.chatConfig,
      ...this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels }
    },
    history: []
  };
  if (this.enableGrounding) {
    chatOptions.config.tools = [{
      googleSearch: this.groundingConfig
    }];
    logger_default.debug(`Search grounding ENABLED for this session (WARNING: costs $35/1k queries)`);
  }
  this.chat = await this.genAIClient.chats.create(chatOptions);
  try {
    await this.genAIClient.models.list();
    logger_default.debug("Gemini API connection successful.");
  } catch (e) {
    throw new Error(`Gemini chat initialization failed: ${e.message}`);
  }
  logger_default.debug("Gemini chat session initialized.");
}
async function seedWithExamples(examples) {
  await this.init();
  if (!examples || !Array.isArray(examples) || examples.length === 0) {
    if (this.examplesFile) {
      logger_default.debug(`No examples provided, loading from file: ${this.examplesFile}`);
      try {
        examples = await import_ak_tools.default.load(import_path.default.resolve(this.examplesFile), true);
      } catch (err) {
        throw new Error(`Could not load examples from file: ${this.examplesFile}. Please check the file path and format.`);
      }
    } else if (this.exampleData) {
      logger_default.debug(`Using example data provided in options.`);
      if (Array.isArray(this.exampleData)) {
        examples = this.exampleData;
      } else {
        throw new Error(`Invalid example data provided. Expected an array of examples.`);
      }
    } else {
      logger_default.debug("No examples provided and no examples file specified. Skipping seeding.");
      return;
    }
  }
  const instructionExample = examples.find((ex) => ex[this.systemInstructionsKey]);
  if (instructionExample) {
    logger_default.debug(`Found system instructions in examples; reinitializing chat with new instructions.`);
    this.systemInstructions = instructionExample[this.systemInstructionsKey];
    this.chatConfig.systemInstruction = this.systemInstructions;
    await this.init(true);
  }
  logger_default.debug(`Seeding chat with ${examples.length} transformation examples...`);
  const historyToAdd = [];
  for (const example of examples) {
    const contextValue = example[this.contextKey] || "";
    const promptValue = example[this.promptKey] || "";
    const answerValue = example[this.answerKey] || "";
    const explanationValue = example[this.explanationKey] || "";
    let userText = "";
    let modelResponse = {};
    if (contextValue) {
      let contextText = isJSON(contextValue) ? JSON.stringify(contextValue, null, 2) : contextValue;
      userText += `CONTEXT:
${contextText}

`;
    }
    if (promptValue) {
      let promptText = isJSON(promptValue) ? JSON.stringify(promptValue, null, 2) : promptValue;
      userText += promptText;
    }
    if (answerValue) modelResponse.data = answerValue;
    if (explanationValue) modelResponse.explanation = explanationValue;
    const modelText = JSON.stringify(modelResponse, null, 2);
    if (userText.trim().length && modelText.trim().length > 0) {
      historyToAdd.push({ role: "user", parts: [{ text: userText.trim() }] });
      historyToAdd.push({ role: "model", parts: [{ text: modelText.trim() }] });
    }
  }
  const currentHistory = this?.chat?.getHistory() || [];
  logger_default.debug(`Adding ${historyToAdd.length} examples to chat history (${currentHistory.length} current examples)...`);
  this.chat = await this.genAIClient.chats.create({
    model: this.modelName,
    // @ts-ignore
    config: {
      ...this.chatConfig,
      ...this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels }
    },
    history: [...currentHistory, ...historyToAdd]
  });
  this.exampleCount = currentHistory.length + historyToAdd.length;
  const newHistory = this.chat.getHistory();
  logger_default.debug(`Created new chat session with ${newHistory.length} examples.`);
  return newHistory;
}
async function rawMessage(sourcePayload, messageOptions = {}) {
  if (!this.chat) {
    throw new Error("Chat session not initialized.");
  }
  const actualPayload = typeof sourcePayload === "string" ? sourcePayload : JSON.stringify(sourcePayload, null, 2);
  const mergedLabels = { ...this.labels, ...messageOptions.labels || {} };
  const hasLabels = this.vertexai && Object.keys(mergedLabels).length > 0;
  try {
    const sendParams = { message: actualPayload };
    if (hasLabels) {
      sendParams.config = { labels: mergedLabels };
    }
    const result = await this.chat.sendMessage(sendParams);
    this.lastResponseMetadata = {
      modelVersion: result.modelVersion || null,
      requestedModel: this.modelName,
      promptTokens: result.usageMetadata?.promptTokenCount || 0,
      responseTokens: result.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: result.usageMetadata?.totalTokenCount || 0,
      timestamp: Date.now()
    };
    if (result.usageMetadata && logger_default.level !== "silent") {
      logger_default.debug(`API response metadata:`, {
        modelVersion: result.modelVersion || "not-provided",
        requestedModel: this.modelName,
        promptTokens: result.usageMetadata.promptTokenCount,
        responseTokens: result.usageMetadata.candidatesTokenCount,
        totalTokens: result.usageMetadata.totalTokenCount
      });
    }
    const modelResponse = result.text;
    const extractedJSON = extractJSON(modelResponse);
    if (extractedJSON?.data) {
      return extractedJSON.data;
    }
    return extractedJSON;
  } catch (error) {
    if (this.onlyJSON && error.message.includes("Could not extract valid JSON")) {
      throw new Error(`Invalid JSON response from Gemini: ${error.message}`);
    }
    throw new Error(`Transformation failed: ${error.message}`);
  }
}
async function prepareAndValidateMessage(sourcePayload, options = {}, validatorFn = null) {
  if (!this.chat) {
    throw new Error("Chat session not initialized. Please call init() first.");
  }
  if (options.stateless) {
    return await statelessMessage.call(this, sourcePayload, options, validatorFn);
  }
  const maxRetries = options.maxRetries ?? this.maxRetries;
  const retryDelay = options.retryDelay ?? this.retryDelay;
  const enableGroundingForMessage = options.enableGrounding ?? this.enableGrounding;
  const groundingConfigForMessage = options.groundingConfig ?? this.groundingConfig;
  if (enableGroundingForMessage !== this.enableGrounding) {
    const originalGrounding = this.enableGrounding;
    const originalConfig = this.groundingConfig;
    try {
      this.enableGrounding = enableGroundingForMessage;
      this.groundingConfig = groundingConfigForMessage;
      await this.init(true);
      if (enableGroundingForMessage) {
        logger_default.warn(`Search grounding ENABLED for this message (WARNING: costs $35/1k queries)`);
      } else {
        logger_default.debug(`Search grounding DISABLED for this message`);
      }
    } catch (error) {
      this.enableGrounding = originalGrounding;
      this.groundingConfig = originalConfig;
      throw error;
    }
    const restoreGrounding = async () => {
      this.enableGrounding = originalGrounding;
      this.groundingConfig = originalConfig;
      await this.init(true);
    };
    options._restoreGrounding = restoreGrounding;
  }
  let lastError = null;
  let lastPayload = null;
  if (sourcePayload && isJSON(sourcePayload)) {
    lastPayload = JSON.stringify(sourcePayload, null, 2);
  } else if (typeof sourcePayload === "string") {
    lastPayload = sourcePayload;
  } else if (typeof sourcePayload === "boolean" || typeof sourcePayload === "number") {
    lastPayload = sourcePayload.toString();
  } else if (sourcePayload === null || sourcePayload === void 0) {
    lastPayload = JSON.stringify({});
  } else {
    throw new Error("Invalid source payload. Must be a JSON object or string.");
  }
  const messageOptions = {};
  if (options.labels) {
    messageOptions.labels = options.labels;
  }
  this._cumulativeUsage = {
    promptTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    attempts: 0
  };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const transformedPayload = attempt === 0 ? await this.rawMessage(lastPayload, messageOptions) : await this.rebuild(lastPayload, lastError.message);
      if (this.lastResponseMetadata) {
        this._cumulativeUsage.promptTokens += this.lastResponseMetadata.promptTokens || 0;
        this._cumulativeUsage.responseTokens += this.lastResponseMetadata.responseTokens || 0;
        this._cumulativeUsage.totalTokens += this.lastResponseMetadata.totalTokens || 0;
        this._cumulativeUsage.attempts = attempt + 1;
      }
      lastPayload = transformedPayload;
      if (validatorFn) {
        await validatorFn(transformedPayload);
      }
      logger_default.debug(`Transformation succeeded on attempt ${attempt + 1}`);
      if (options._restoreGrounding) {
        await options._restoreGrounding();
      }
      return transformedPayload;
    } catch (error) {
      lastError = error;
      logger_default.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt >= maxRetries) {
        logger_default.error(`All ${maxRetries + 1} attempts failed.`);
        if (options._restoreGrounding) {
          await options._restoreGrounding();
        }
        throw new Error(`Transformation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
      }
      const delay = retryDelay * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}
async function rebuildPayload(lastPayload, serverError) {
  await this.init();
  const prompt = `
The previous JSON payload (below) failed validation.
The server's error message is quoted afterward.

---------------- BAD PAYLOAD ----------------
${JSON.stringify(lastPayload, null, 2)}


---------------- SERVER ERROR ----------------
${serverError}

Please return a NEW JSON payload that corrects the issue.
Respond with JSON only \u2013 no comments or explanations.
`;
  let result;
  try {
    result = await this.chat.sendMessage({ message: prompt });
    this.lastResponseMetadata = {
      modelVersion: result.modelVersion || null,
      requestedModel: this.modelName,
      promptTokens: result.usageMetadata?.promptTokenCount || 0,
      responseTokens: result.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: result.usageMetadata?.totalTokenCount || 0,
      timestamp: Date.now()
    };
    if (result.usageMetadata && logger_default.level !== "silent") {
      logger_default.debug(`Rebuild response metadata - tokens used:`, result.usageMetadata.totalTokenCount);
    }
  } catch (err) {
    throw new Error(`Gemini call failed while repairing payload: ${err.message}`);
  }
  try {
    const text = result.text ?? result.response ?? "";
    return typeof text === "object" ? text : JSON.parse(text);
  } catch (parseErr) {
    throw new Error(`Gemini returned non-JSON while repairing payload: ${parseErr.message}`);
  }
}
async function estimateInputTokens(nextPayload) {
  const contents = [];
  if (this.systemInstructions) {
    contents.push({ parts: [{ text: this.systemInstructions }] });
  }
  if (this.chat && typeof this.chat.getHistory === "function") {
    const history = this.chat.getHistory();
    if (Array.isArray(history) && history.length > 0) {
      contents.push(...history);
    }
  }
  const nextMessage = typeof nextPayload === "string" ? nextPayload : JSON.stringify(nextPayload, null, 2);
  contents.push({ parts: [{ text: nextMessage }] });
  const resp = await this.genAIClient.models.countTokens({
    model: this.modelName,
    contents
  });
  return { inputTokens: resp.totalTokens };
}
var MODEL_PRICING = {
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-flash-lite": { input: 0.02, output: 0.1 },
  "gemini-2.5-pro": { input: 2.5, output: 10 },
  "gemini-3-pro": { input: 2, output: 12 },
  "gemini-3-pro-preview": { input: 2, output: 12 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.02, output: 0.1 }
};
async function estimateCost(nextPayload) {
  const tokenInfo = await this.estimate(nextPayload);
  const pricing = MODEL_PRICING[this.modelName] || { input: 0, output: 0 };
  return {
    inputTokens: tokenInfo.inputTokens,
    model: this.modelName,
    pricing,
    estimatedInputCost: tokenInfo.inputTokens / 1e6 * pricing.input,
    note: "Cost is for input tokens only; output cost depends on response length"
  };
}
async function resetChat() {
  if (this.chat) {
    logger_default.debug("Resetting Gemini chat session...");
    const chatOptions = {
      model: this.modelName,
      // @ts-ignore
      config: {
        ...this.chatConfig,
        ...this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels }
      },
      history: []
    };
    if (this.enableGrounding) {
      chatOptions.config.tools = [{
        googleSearch: this.groundingConfig
      }];
      logger_default.debug(`Search grounding preserved during reset (WARNING: costs $35/1k queries)`);
    }
    this.chat = await this.genAIClient.chats.create(chatOptions);
    logger_default.debug("Chat session reset.");
  } else {
    logger_default.warn("Cannot reset chat session: chat not yet initialized.");
  }
}
function getChatHistory() {
  if (!this.chat) {
    logger_default.warn("Chat session not initialized. No history available.");
    return [];
  }
  return this.chat.getHistory();
}
async function updateSystemInstructions(newInstructions) {
  if (!newInstructions || typeof newInstructions !== "string") {
    throw new Error("System instructions must be a non-empty string");
  }
  this.systemInstructions = newInstructions.trim();
  this.chatConfig.systemInstruction = this.systemInstructions;
  logger_default.debug("Updating system instructions and reinitializing chat...");
  await this.init(true);
}
async function clearConversation() {
  if (!this.chat) {
    logger_default.warn("Cannot clear conversation: chat not initialized.");
    return;
  }
  const history = this.chat.getHistory();
  const exampleHistory = history.slice(0, this.exampleCount || 0);
  this.chat = await this.genAIClient.chats.create({
    model: this.modelName,
    // @ts-ignore
    config: {
      ...this.chatConfig,
      ...this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels }
    },
    history: exampleHistory
  });
  this.lastResponseMetadata = null;
  this._cumulativeUsage = {
    promptTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    attempts: 0
  };
  logger_default.debug(`Conversation cleared. Preserved ${exampleHistory.length} example items.`);
}
function getLastUsage() {
  if (!this.lastResponseMetadata) {
    return null;
  }
  const meta = this.lastResponseMetadata;
  const cumulative = this._cumulativeUsage || { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 1 };
  const useCumulative = cumulative.attempts > 0;
  return {
    // Token breakdown for billing - CUMULATIVE across all retry attempts
    promptTokens: useCumulative ? cumulative.promptTokens : meta.promptTokens,
    responseTokens: useCumulative ? cumulative.responseTokens : meta.responseTokens,
    totalTokens: useCumulative ? cumulative.totalTokens : meta.totalTokens,
    // Number of attempts (1 = success on first try, 2+ = retries were needed)
    attempts: useCumulative ? cumulative.attempts : 1,
    // Model verification for billing cross-check
    modelVersion: meta.modelVersion,
    // Actual model that responded (e.g., 'gemini-2.5-flash-001')
    requestedModel: meta.requestedModel,
    // Model you requested (e.g., 'gemini-2.5-flash')
    // Timestamp for audit trail
    timestamp: meta.timestamp
  };
}
async function statelessMessage(sourcePayload, options = {}, validatorFn = null) {
  if (!this.chat) {
    throw new Error("Chat session not initialized. Please call init() first.");
  }
  const payloadStr = typeof sourcePayload === "string" ? sourcePayload : JSON.stringify(sourcePayload, null, 2);
  const contents = [];
  if (this.exampleCount > 0) {
    const history = this.chat.getHistory();
    const exampleHistory = history.slice(0, this.exampleCount);
    contents.push(...exampleHistory);
  }
  contents.push({ role: "user", parts: [{ text: payloadStr }] });
  const mergedLabels = { ...this.labels, ...options.labels || {} };
  const result = await this.genAIClient.models.generateContent({
    model: this.modelName,
    contents,
    config: {
      ...this.chatConfig,
      ...this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels }
    }
  });
  this.lastResponseMetadata = {
    modelVersion: result.modelVersion || null,
    requestedModel: this.modelName,
    promptTokens: result.usageMetadata?.promptTokenCount || 0,
    responseTokens: result.usageMetadata?.candidatesTokenCount || 0,
    totalTokens: result.usageMetadata?.totalTokenCount || 0,
    timestamp: Date.now()
  };
  this._cumulativeUsage = {
    promptTokens: this.lastResponseMetadata.promptTokens,
    responseTokens: this.lastResponseMetadata.responseTokens,
    totalTokens: this.lastResponseMetadata.totalTokens,
    attempts: 1
  };
  if (result.usageMetadata && logger_default.level !== "silent") {
    logger_default.debug(`Stateless message metadata:`, {
      modelVersion: result.modelVersion || "not-provided",
      promptTokens: result.usageMetadata.promptTokenCount,
      responseTokens: result.usageMetadata.candidatesTokenCount
    });
  }
  const modelResponse = result.text;
  const extractedJSON = extractJSON(modelResponse);
  let transformedPayload = extractedJSON?.data ? extractedJSON.data : extractedJSON;
  if (validatorFn) {
    await validatorFn(transformedPayload);
  }
  return transformedPayload;
}
function attemptJSONRecovery(text, maxAttempts = 100) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch (e) {
  }
  let workingText = text.trim();
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escapeNext = false;
  for (let j = 0; j < workingText.length; j++) {
    const char = workingText[j];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") braces++;
      else if (char === "}") braces--;
      else if (char === "[") brackets++;
      else if (char === "]") brackets--;
    }
  }
  if ((braces > 0 || brackets > 0 || inString) && workingText.length > 2) {
    let fixedText = workingText;
    if (inString) {
      fixedText += '"';
    }
    while (braces > 0) {
      fixedText += "}";
      braces--;
    }
    while (brackets > 0) {
      fixedText += "]";
      brackets--;
    }
    try {
      const result = JSON.parse(fixedText);
      if (logger_default.level !== "silent") {
        logger_default.warn(`JSON response appears truncated (possibly hit maxOutputTokens limit). Recovered by adding closing characters.`);
      }
      return result;
    } catch (e) {
    }
  }
  for (let i = 0; i < maxAttempts && workingText.length > 2; i++) {
    workingText = workingText.slice(0, -1);
    let braces2 = 0;
    let brackets2 = 0;
    let inString2 = false;
    let escapeNext2 = false;
    for (let j = 0; j < workingText.length; j++) {
      const char = workingText[j];
      if (escapeNext2) {
        escapeNext2 = false;
        continue;
      }
      if (char === "\\") {
        escapeNext2 = true;
        continue;
      }
      if (char === '"') {
        inString2 = !inString2;
        continue;
      }
      if (!inString2) {
        if (char === "{") braces2++;
        else if (char === "}") braces2--;
        else if (char === "[") brackets2++;
        else if (char === "]") brackets2--;
      }
    }
    if (braces2 === 0 && brackets2 === 0 && !inString2) {
      try {
        const result = JSON.parse(workingText);
        if (logger_default.level !== "silent") {
          logger_default.warn(`JSON response appears truncated (possibly hit maxOutputTokens limit). Recovered by removing ${i + 1} characters from the end.`);
        }
        return result;
      } catch (e) {
      }
    }
    if (i > 5) {
      let fixedText = workingText;
      if (inString2) {
        fixedText += '"';
      }
      while (braces2 > 0) {
        fixedText += "}";
        braces2--;
      }
      while (brackets2 > 0) {
        fixedText += "]";
        brackets2--;
      }
      try {
        const result = JSON.parse(fixedText);
        if (logger_default.level !== "silent") {
          logger_default.warn(`JSON response appears truncated (possibly hit maxOutputTokens limit). Recovered by adding closing characters.`);
        }
        return result;
      } catch (e) {
      }
    }
  }
  return null;
}
function isJSON(data) {
  try {
    const attempt = JSON.stringify(data);
    if (attempt?.startsWith("{") || attempt?.startsWith("[")) {
      if (attempt?.endsWith("}") || attempt?.endsWith("]")) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}
function isJSONStr(string) {
  if (typeof string !== "string") return false;
  try {
    const result = JSON.parse(string);
    const type = Object.prototype.toString.call(result);
    return type === "[object Object]" || type === "[object Array]";
  } catch (err) {
    return false;
  }
}
function extractJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("No text provided for JSON extraction");
  }
  if (isJSONStr(text.trim())) {
    return JSON.parse(text.trim());
  }
  const codeBlockPatterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/gi,
    /```\s*\n?([\s\S]*?)\n?\s*```/gi
  ];
  for (const pattern of codeBlockPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const jsonContent = match.replace(/```json\s*\n?/gi, "").replace(/```\s*\n?/gi, "").trim();
        if (isJSONStr(jsonContent)) {
          return JSON.parse(jsonContent);
        }
      }
    }
  }
  const jsonPatterns = [
    // Match complete JSON objects
    /\{[\s\S]*\}/g,
    // Match complete JSON arrays
    /\[[\s\S]*\]/g
  ];
  for (const pattern of jsonPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const candidate = match.trim();
        if (isJSONStr(candidate)) {
          return JSON.parse(candidate);
        }
      }
    }
  }
  const advancedExtract = findCompleteJSONStructures(text);
  if (advancedExtract.length > 0) {
    for (const candidate of advancedExtract) {
      if (isJSONStr(candidate)) {
        return JSON.parse(candidate);
      }
    }
  }
  const cleanedText = text.replace(/^\s*Sure,?\s*here\s+is\s+your?\s+.*?[:\n]/gi, "").replace(/^\s*Here\s+is\s+the\s+.*?[:\n]/gi, "").replace(/^\s*The\s+.*?is\s*[:\n]/gi, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trim();
  if (isJSONStr(cleanedText)) {
    return JSON.parse(cleanedText);
  }
  const recoveredJSON = attemptJSONRecovery(text);
  if (recoveredJSON !== null) {
    return recoveredJSON;
  }
  throw new Error(`Could not extract valid JSON from model response. Response preview: ${text.substring(0, 200)}...`);
}
function findCompleteJSONStructures(text) {
  const results = [];
  const startChars = ["{", "["];
  for (let i = 0; i < text.length; i++) {
    if (startChars.includes(text[i])) {
      const extracted = extractCompleteStructure(text, i);
      if (extracted) {
        results.push(extracted);
      }
    }
  }
  return results;
}
function extractCompleteStructure(text, startPos) {
  const startChar = text[startPos];
  const endChar = startChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startPos; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"' && !escaped) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          return text.substring(startPos, i + 1);
        }
      }
    }
  }
  return null;
}
if (import_meta.url === new URL(`file://${process.argv[1]}`).href) {
  logger_default.info("RUNNING AI Transformer as standalone script...");
  (async () => {
    try {
      logger_default.info("Initializing AI Transformer...");
      const transformer = new AITransformer({
        modelName: "gemini-2.5-flash",
        sourceKey: "INPUT",
        // Custom source key
        targetKey: "OUTPUT",
        // Custom target key
        contextKey: "CONTEXT",
        // Custom context key
        maxRetries: 2
      });
      const examples = [
        {
          CONTEXT: "Generate professional profiles with emoji representations",
          INPUT: { "name": "Alice" },
          OUTPUT: { "name": "Alice", "profession": "data scientist", "life_as_told_by_emoji": ["\u{1F52C}", "\u{1F4A1}", "\u{1F4CA}", "\u{1F9E0}", "\u{1F31F}"] }
        },
        {
          INPUT: { "name": "Bob" },
          OUTPUT: { "name": "Bob", "profession": "product manager", "life_as_told_by_emoji": ["\u{1F4CB}", "\u{1F91D}", "\u{1F680}", "\u{1F4AC}", "\u{1F3AF}"] }
        },
        {
          INPUT: { "name": "Eve" },
          OUTPUT: { "name": "Even", "profession": "security analyst", "life_as_told_by_emoji": ["\u{1F575}\uFE0F\u200D\u2640\uFE0F", "\u{1F512}", "\u{1F4BB}", "\u{1F440}", "\u26A1\uFE0F"] }
        }
      ];
      await transformer.init();
      await transformer.seed(examples);
      logger_default.info("AI Transformer initialized and seeded with examples.");
      const normalResponse = await transformer.message({ "name": "AK" });
      logger_default.info("Normal Payload Transformed", normalResponse);
      const mockValidator = async (payload) => {
        if (!payload.profession || !payload.life_as_told_by_emoji) {
          throw new Error("Missing required fields: profession or life_as_told_by_emoji");
        }
        if (!Array.isArray(payload.life_as_told_by_emoji)) {
          throw new Error("life_as_told_by_emoji must be an array");
        }
        return payload;
      };
      const validatedResponse = await transformer.messageAndValidate(
        { "name": "Lynn" },
        {},
        mockValidator
      );
      logger_default.info("Validated Payload Transformed", validatedResponse);
      if (NODE_ENV2 === "dev") debugger;
    } catch (error) {
      logger_default.error("Error in AI Transformer script:", error);
      if (NODE_ENV2 === "dev") debugger;
    }
  })();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AIAgent,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  attemptJSONRecovery,
  log
});
