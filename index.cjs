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
  BaseGemini: () => base_default,
  Chat: () => chat_default,
  CodeAgent: () => code_agent_default,
  Embedding: () => Embedding,
  HarmBlockThreshold: () => import_genai2.HarmBlockThreshold,
  HarmCategory: () => import_genai2.HarmCategory,
  Message: () => message_default,
  RagAgent: () => rag_agent_default,
  ThinkingLevel: () => import_genai2.ThinkingLevel,
  ToolAgent: () => tool_agent_default,
  Transformer: () => transformer_default,
  attemptJSONRecovery: () => attemptJSONRecovery,
  default: () => index_default,
  extractJSON: () => extractJSON,
  log: () => logger_default
});
module.exports = __toCommonJS(index_exports);

// base.js
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");

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

// json-helpers.js
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
    /\{[\s\S]*\}/g,
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

// base.js
import_dotenv.default.config({ quiet: true });
var { NODE_ENV = "unknown", LOG_LEVEL = "" } = process.env;
var DEFAULT_SAFETY_SETTINGS = [
  { category: import_genai.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE },
  { category: import_genai.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE }
];
var DEFAULT_THINKING_CONFIG = {
  thinkingBudget: 0
};
var DEFAULT_MAX_OUTPUT_TOKENS = 5e4;
var THINKING_SUPPORTED_MODELS = [
  /^gemini-3-flash(-preview)?$/,
  /^gemini-3-pro(-preview|-image-preview)?$/,
  /^gemini-2\.5-pro/,
  /^gemini-2\.5-flash(-preview)?$/,
  /^gemini-2\.5-flash-lite(-preview)?$/,
  /^gemini-2\.0-flash$/
];
var MODEL_PRICING = {
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-flash-lite": { input: 0.02, output: 0.1 },
  "gemini-2.5-pro": { input: 2.5, output: 10 },
  "gemini-3-pro": { input: 2, output: 12 },
  "gemini-3-pro-preview": { input: 2, output: 12 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.02, output: 0.1 },
  "gemini-embedding-001": { input: 6e-3, output: 0 }
};
var BaseGemini = class {
  /**
   * @param {BaseGeminiOptions} [options={}]
   */
  constructor(options = {}) {
    this.modelName = options.modelName || "gemini-2.5-flash";
    if (options.systemPrompt !== void 0) {
      this.systemPrompt = options.systemPrompt;
    } else {
      this.systemPrompt = null;
    }
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
    this.resourceExhaustedRetries = options.resourceExhaustedRetries ?? 5;
    this.resourceExhaustedDelay = options.resourceExhaustedDelay ?? 1e3;
    this._configureLogLevel(options.logLevel);
    this.labels = options.labels || {};
    this.enableGrounding = options.enableGrounding || false;
    this.groundingConfig = options.groundingConfig || {};
    this.cachedContent = options.cachedContent || null;
    this.chatConfig = {
      temperature: 0.7,
      topP: 0.95,
      topK: 64,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      ...options.chatConfig
    };
    if (this.systemPrompt) {
      this.chatConfig.systemInstruction = this.systemPrompt;
    } else if (this.systemPrompt === null && options.systemPrompt === void 0) {
    } else if (options.systemPrompt === null || options.systemPrompt === false) {
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
      }
    } else {
      this.chatConfig.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
    }
    this._configureThinking(options.thinkingConfig);
    const clientOptions = this.vertexai ? {
      vertexai: true,
      project: this.project,
      ...this.location && { location: this.location },
      ...this.googleAuthOptions && { googleAuthOptions: this.googleAuthOptions }
    } : { apiKey: this.apiKey };
    this.genAIClient = new import_genai.GoogleGenAI(clientOptions);
    this.chatSession = null;
    this.lastResponseMetadata = null;
    this.exampleCount = 0;
    this._cumulativeUsage = {
      promptTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      attempts: 0
    };
    logger_default.debug(`${this.constructor.name} created with model: ${this.modelName}`);
  }
  // ── Initialization ───────────────────────────────────────────────────────
  /**
   * Initializes the chat session. Idempotent unless force=true.
   * Subclasses can override `_getChatCreateOptions()` to customize.
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async init(force = false) {
    if (this.chatSession && !force) return;
    logger_default.debug(`Initializing ${this.constructor.name} chat session with model: ${this.modelName}...`);
    const chatOptions = this._getChatCreateOptions();
    this.chatSession = this.genAIClient.chats.create(chatOptions);
    try {
      await this.genAIClient.models.list();
      logger_default.debug(`${this.constructor.name}: API connection successful.`);
    } catch (e) {
      throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
    }
    logger_default.debug(`${this.constructor.name}: Chat session initialized.`);
  }
  /**
   * Builds the options object for `genAIClient.chats.create()`.
   * Override in subclasses to add tools, grounding, etc.
   * @returns {Object}
   * @protected
   */
  _getChatCreateOptions() {
    const opts = {
      model: this.modelName,
      config: {
        ...this.chatConfig,
        ...this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels },
        ...this.cachedContent && { cachedContent: this.cachedContent }
      },
      history: []
    };
    if (this.enableGrounding) {
      const existingTools = opts.config.tools || [];
      opts.config.tools = [...existingTools, { googleSearch: this.groundingConfig }];
      logger_default.debug("Search grounding ENABLED (WARNING: costs $35/1k queries)");
    }
    return opts;
  }
  // ── Chat Session Management ──────────────────────────────────────────────
  /**
   * Creates a new chat session with the given history.
   * Internal helper used by init, seed, clearHistory, reset.
   * @param {Array} [history=[]]
   * @returns {Object} The new chat session
   * @protected
   */
  _createChatSession(history = []) {
    const opts = this._getChatCreateOptions();
    opts.history = history;
    return this.genAIClient.chats.create(opts);
  }
  /**
   * Retrieves the current conversation history.
   * @param {boolean} [curated=false]
   * @returns {Array<Object>}
   */
  getHistory(curated = false) {
    if (!this.chatSession) {
      logger_default.warn("Chat session not initialized. No history available.");
      return [];
    }
    return this.chatSession.getHistory(curated);
  }
  /**
   * Clears conversation history. Recreates chat session with empty history.
   * Subclasses may override to preserve seeded examples.
   * @returns {Promise<void>}
   */
  async clearHistory() {
    if (!this.chatSession) {
      logger_default.warn(`Cannot clear history: chat not initialized.`);
      return;
    }
    this.chatSession = this._createChatSession([]);
    this.lastResponseMetadata = null;
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
    logger_default.debug(`${this.constructor.name}: Conversation history cleared.`);
  }
  // ── Few-Shot Seeding ─────────────────────────────────────────────────────
  /**
   * Seeds the chat session with example input/output pairs for few-shot learning.
   * @param {TransformationExample[]} examples - Array of example objects
   * @param {Object} [opts={}] - Key configuration
   * @param {string} [opts.promptKey='PROMPT'] - Key for input data in examples
   * @param {string} [opts.answerKey='ANSWER'] - Key for output data in examples
   * @param {string} [opts.contextKey='CONTEXT'] - Key for optional context
   * @param {string} [opts.explanationKey='EXPLANATION'] - Key for optional explanations
   * @param {string} [opts.systemPromptKey='SYSTEM'] - Key for system prompt overrides in examples
   * @returns {Promise<Array>} The updated chat history
   */
  async seed(examples, opts = {}) {
    await this.init();
    if (!examples || !Array.isArray(examples) || examples.length === 0) {
      logger_default.debug("No examples provided. Skipping seeding.");
      return this.getHistory();
    }
    const promptKey = opts.promptKey || "PROMPT";
    const answerKey = opts.answerKey || "ANSWER";
    const contextKey = opts.contextKey || "CONTEXT";
    const explanationKey = opts.explanationKey || "EXPLANATION";
    const systemPromptKey = opts.systemPromptKey || "SYSTEM";
    const instructionExample = examples.find((ex) => ex[systemPromptKey]);
    if (instructionExample) {
      logger_default.debug(`Found system prompt in examples; reinitializing chat.`);
      this.systemPrompt = instructionExample[systemPromptKey];
      this.chatConfig.systemInstruction = /** @type {string} */
      this.systemPrompt;
      await this.init(true);
    }
    logger_default.debug(`Seeding chat with ${examples.length} examples...`);
    const historyToAdd = [];
    for (const example of examples) {
      const contextValue = example[contextKey] || "";
      const promptValue = example[promptKey] || "";
      const answerValue = example[answerKey] || "";
      const explanationValue = example[explanationKey] || "";
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
    const currentHistory = this.chatSession?.getHistory() || [];
    logger_default.debug(`Adding ${historyToAdd.length} items to chat history (${currentHistory.length} existing)...`);
    this.chatSession = this._createChatSession([...currentHistory, ...historyToAdd]);
    this.exampleCount = currentHistory.length + historyToAdd.length;
    const newHistory = this.chatSession.getHistory();
    logger_default.debug(`Chat session now has ${newHistory.length} history items.`);
    return newHistory;
  }
  // ── Response Metadata ────────────────────────────────────────────────────
  /**
   * Captures response metadata (model version, token counts) from an API response.
   * @param {Object} response - The API response object
   * @protected
   */
  _captureMetadata(response) {
    this.lastResponseMetadata = {
      modelVersion: response.modelVersion || null,
      requestedModel: this.modelName,
      promptTokens: response.usageMetadata?.promptTokenCount || 0,
      responseTokens: response.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: response.usageMetadata?.totalTokenCount || 0,
      timestamp: Date.now(),
      groundingMetadata: response.candidates?.[0]?.groundingMetadata || null
    };
  }
  /**
   * Returns structured usage data from the last API call for billing verification.
   * Includes CUMULATIVE token counts across all retry attempts.
   * @returns {UsageData|null} Usage data or null if no API call has been made.
   */
  getLastUsage() {
    if (!this.lastResponseMetadata) return null;
    const meta = this.lastResponseMetadata;
    const cumulative = this._cumulativeUsage || { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 1 };
    const useCumulative = cumulative.attempts > 0;
    return {
      promptTokens: useCumulative ? cumulative.promptTokens : meta.promptTokens,
      responseTokens: useCumulative ? cumulative.responseTokens : meta.responseTokens,
      totalTokens: useCumulative ? cumulative.totalTokens : meta.totalTokens,
      attempts: useCumulative ? cumulative.attempts : 1,
      modelVersion: meta.modelVersion,
      requestedModel: meta.requestedModel,
      timestamp: meta.timestamp,
      groundingMetadata: meta.groundingMetadata || null
    };
  }
  // ── Token Estimation ─────────────────────────────────────────────────────
  /**
   * Estimates INPUT token count for a payload before sending.
   * Includes system prompt + chat history + your new message.
   * @param {Object|string} nextPayload - The next message to estimate
   * @returns {Promise<{ inputTokens: number }>}
   */
  async estimate(nextPayload) {
    const contents = [];
    if (this.systemPrompt) {
      contents.push({ parts: [{ text: this.systemPrompt }] });
    }
    if (this.chatSession && typeof this.chatSession.getHistory === "function") {
      const history = this.chatSession.getHistory();
      if (Array.isArray(history) && history.length > 0) {
        contents.push(...history);
      }
    }
    const nextMessage = typeof nextPayload === "string" ? nextPayload : JSON.stringify(nextPayload, null, 2);
    contents.push({ parts: [{ text: nextMessage }] });
    const resp = await this._withRetry(() => this.genAIClient.models.countTokens({
      model: this.modelName,
      contents
    }));
    return { inputTokens: resp.totalTokens };
  }
  /**
   * Estimates the INPUT cost of sending a payload based on model pricing.
   * @param {Object|string} nextPayload - The next message to estimate
   * @returns {Promise<Object>} Cost estimation
   */
  async estimateCost(nextPayload) {
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
  // ── Context Caching ─────────────────────────────────────────────────────
  /**
   * Creates a cached content resource for cost reduction on repeated prompts.
   * Auto-populates model and systemInstruction from this instance if not provided.
   * @param {Object} [config={}] - Cache configuration
   * @param {string} [config.model] - Model (defaults to this.modelName)
   * @param {string} [config.ttl] - Time-to-live (e.g., '3600s')
   * @param {string} [config.displayName] - Human-readable name
   * @param {Array} [config.contents] - Content to cache
   * @param {string} [config.systemInstruction] - System prompt to cache (defaults to this.systemPrompt)
   * @param {Array} [config.tools] - Tools to cache
   * @param {Object} [config.toolConfig] - Tool configuration to cache
   * @returns {Promise<Object>} The created cache resource
   */
  async createCache(config = {}) {
    const cacheConfig = {};
    if (config.ttl) cacheConfig.ttl = config.ttl;
    if (config.displayName) cacheConfig.displayName = config.displayName;
    if (config.contents) cacheConfig.contents = config.contents;
    if (config.tools) cacheConfig.tools = config.tools;
    if (config.toolConfig) cacheConfig.toolConfig = config.toolConfig;
    const sysInstruction = config.systemInstruction !== void 0 ? config.systemInstruction : this.systemPrompt;
    if (sysInstruction) cacheConfig.systemInstruction = sysInstruction;
    const cached = await this._withRetry(() => this.genAIClient.caches.create({
      model: config.model || this.modelName,
      config: cacheConfig
    }));
    logger_default.debug(`Cache created: ${cached.name}`);
    return cached;
  }
  /**
   * Retrieves a cached content resource by name.
   * @param {string} cacheName - Server-generated resource name
   * @returns {Promise<Object>} The cached content resource
   */
  async getCache(cacheName) {
    return await this._withRetry(() => this.genAIClient.caches.get({ name: cacheName }));
  }
  /**
   * Lists all cached content resources.
   * @returns {Promise<Object>} Pager of cached content resources
   */
  async listCaches() {
    const pager = await this._withRetry(() => this.genAIClient.caches.list());
    const results = [];
    for await (const cache of pager) {
      results.push(cache);
    }
    return results;
  }
  /**
   * Updates a cached content resource (TTL or expiration).
   * @param {string} cacheName - Server-generated resource name
   * @param {Object} [config={}] - Update config
   * @param {string} [config.ttl] - New TTL (e.g., '7200s')
   * @param {string} [config.expireTime] - New expiration (RFC 3339)
   * @returns {Promise<Object>} The updated cache resource
   */
  async updateCache(cacheName, config = {}) {
    return await this._withRetry(() => this.genAIClient.caches.update({
      name: cacheName,
      config: {
        ...config.ttl && { ttl: config.ttl },
        ...config.expireTime && { expireTime: config.expireTime }
      }
    }));
  }
  /**
   * Deletes a cached content resource.
   * Clears this.cachedContent if it matches the deleted cache.
   * @param {string} cacheName - Server-generated resource name
   * @returns {Promise<void>}
   */
  async deleteCache(cacheName) {
    await this._withRetry(() => this.genAIClient.caches.delete({ name: cacheName }));
    logger_default.debug(`Cache deleted: ${cacheName}`);
    if (this.cachedContent === cacheName) {
      this.cachedContent = null;
    }
  }
  /**
   * Sets the cached content for this instance and reinitializes the session.
   * @param {string} cacheName - Server-generated cache resource name
   * @returns {Promise<void>}
   */
  async useCache(cacheName) {
    this.cachedContent = cacheName;
    delete this.chatConfig.systemInstruction;
    if (this.chatSession) {
      await this.init(true);
    }
    logger_default.debug(`Using cache: ${cacheName}`);
  }
  // ── Rate Limit Retry ────────────────────────────────────────────────────
  /**
   * Detects whether an error is a 429 / RESOURCE_EXHAUSTED rate-limit error.
   * @param {Error} error
   * @returns {boolean}
   * @private
   */
  _is429Error(error) {
    const e = error;
    if (e.status === 429 || e.code === 429 || e.httpStatusCode === 429) return true;
    const msg = e.message || "";
    return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
  }
  /**
   * Wraps an async function with automatic retry on 429 (RESOURCE_EXHAUSTED) errors.
   * Uses exponential backoff with jitter. Non-429 errors are rethrown immediately.
   * @param {() => Promise<T>} fn - The async function to execute
   * @returns {Promise<T>}
   * @template T
   * @protected
   */
  async _withRetry(fn) {
    const maxAttempts = this.resourceExhaustedRetries;
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!this._is429Error(error) || attempt >= maxAttempts) throw error;
        const jitter = Math.random() * 500;
        const delay = this.resourceExhaustedDelay * Math.pow(2, attempt) + jitter;
        logger_default.warn(`Rate limited (429). Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxAttempts})...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  // ── Private Helpers ──────────────────────────────────────────────────────
  /**
   * Configures the log level based on options, env vars, or NODE_ENV.
   * @param {string} [logLevel]
   * @private
   */
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
  /**
   * Configures thinking settings based on model support.
   * @param {Object|null|undefined} thinkingConfig
   * @private
   */
  _configureThinking(thinkingConfig) {
    const modelSupportsThinking = THINKING_SUPPORTED_MODELS.some((p) => p.test(this.modelName));
    if (thinkingConfig === void 0) return;
    if (thinkingConfig === null) {
      delete this.chatConfig.thinkingConfig;
      logger_default.debug(`thinkingConfig set to null - removed from configuration`);
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
var base_default = BaseGemini;

// transformer.js
var import_promises = __toESM(require("fs/promises"), 1);
var import_path = __toESM(require("path"), 1);
var DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON).

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.
`;
var Transformer = class extends base_default {
  /**
   * @param {TransformerOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: DEFAULT_SYSTEM_INSTRUCTIONS };
    }
    super(options);
    this.chatConfig.responseMimeType = "application/json";
    this.onlyJSON = options.onlyJSON !== void 0 ? options.onlyJSON : true;
    if (options.responseSchema) {
      this.chatConfig.responseSchema = options.responseSchema;
    }
    this.promptKey = options.promptKey || options.sourceKey || "PROMPT";
    this.answerKey = options.answerKey || options.targetKey || "ANSWER";
    this.contextKey = options.contextKey || "CONTEXT";
    this.explanationKey = options.explanationKey || "EXPLANATION";
    this.systemPromptKey = options.systemPromptKey || "SYSTEM";
    if (this.promptKey === this.answerKey) {
      throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
    }
    this.examplesFile = options.examplesFile || null;
    this.exampleData = options.exampleData || null;
    this.asyncValidator = options.asyncValidator || null;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1e3;
    logger_default.debug(`Transformer keys \u2014 Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
  }
  // ── Seeding ──────────────────────────────────────────────────────────────
  /**
   * Seeds the chat with transformation examples using the configured key mapping.
   * Overrides base seed() to use Transformer-specific keys and support
   * examplesFile/exampleData fallbacks.
   *
   * @param {TransformationExample[]} [examples] - Array of example objects
   * @returns {Promise<Array>} The updated chat history
   */
  async seed(examples) {
    await this.init();
    if (!examples || !Array.isArray(examples) || examples.length === 0) {
      if (this.examplesFile) {
        logger_default.debug(`No examples provided, loading from file: ${this.examplesFile}`);
        try {
          const filePath = import_path.default.resolve(this.examplesFile);
          const raw = await import_promises.default.readFile(filePath, "utf-8");
          examples = JSON.parse(raw);
        } catch (err) {
          throw new Error(`Could not load examples from file: ${this.examplesFile}. ${err.message}`);
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
        return this.getHistory();
      }
    }
    return await super.seed(examples, {
      promptKey: this.promptKey,
      answerKey: this.answerKey,
      contextKey: this.contextKey,
      explanationKey: this.explanationKey,
      systemPromptKey: this.systemPromptKey
    });
  }
  // ── Primary Send Method ──────────────────────────────────────────────────
  /**
   * Transforms a payload using the seeded examples and model.
   * Includes validation and automatic retry with AI-powered error correction.
   *
   * @param {Object|string} payload - The source payload to transform
   * @param {import('./types').SendOptions} [opts={}] - Per-message options
   * @param {AsyncValidatorFunction|null} [validatorFn] - Validator for this call (overrides constructor validator)
   * @returns {Promise<Object>} The transformed payload
   */
  async send(payload, opts = {}, validatorFn = null) {
    if (!this.chatSession) {
      throw new Error("Chat session not initialized. Please call init() first.");
    }
    const validator = validatorFn || this.asyncValidator;
    if (opts.stateless) {
      return await this._statelessSend(payload, opts, validator);
    }
    const maxRetries = opts.maxRetries ?? this.maxRetries;
    const retryDelay = opts.retryDelay ?? this.retryDelay;
    if (opts.enableGrounding !== void 0 && opts.enableGrounding !== this.enableGrounding) {
      const originalGrounding = this.enableGrounding;
      const originalConfig = this.groundingConfig;
      try {
        this.enableGrounding = opts.enableGrounding;
        this.groundingConfig = opts.groundingConfig ?? this.groundingConfig;
        await this.init(true);
      } catch (error) {
        this.enableGrounding = originalGrounding;
        this.groundingConfig = originalConfig;
        throw error;
      }
      opts._restoreGrounding = async () => {
        this.enableGrounding = originalGrounding;
        this.groundingConfig = originalConfig;
        await this.init(true);
      };
    }
    let lastPayload = this._preparePayload(payload);
    const messageOptions = {};
    if (opts.labels) messageOptions.labels = opts.labels;
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const transformedPayload = attempt === 0 ? await this.rawSend(lastPayload, messageOptions) : await this.rebuild(lastPayload, lastError.message);
        if (this.lastResponseMetadata) {
          this._cumulativeUsage.promptTokens += this.lastResponseMetadata.promptTokens || 0;
          this._cumulativeUsage.responseTokens += this.lastResponseMetadata.responseTokens || 0;
          this._cumulativeUsage.totalTokens += this.lastResponseMetadata.totalTokens || 0;
          this._cumulativeUsage.attempts = attempt + 1;
        }
        lastPayload = transformedPayload;
        if (validator) {
          await validator(transformedPayload);
        }
        logger_default.debug(`Transformation succeeded on attempt ${attempt + 1}`);
        if (opts._restoreGrounding) await opts._restoreGrounding();
        return transformedPayload;
      } catch (error) {
        lastError = error;
        logger_default.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
        if (attempt >= maxRetries) {
          logger_default.error(`All ${maxRetries + 1} attempts failed.`);
          if (opts._restoreGrounding) await opts._restoreGrounding();
          throw new Error(`Transformation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
        }
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  // ── Raw Send ─────────────────────────────────────────────────────────────
  /**
   * Sends a single prompt to the model and parses the JSON response.
   * No validation or retry logic.
   *
   * @param {Object|string} payload - The source payload
   * @param {Object} [messageOptions={}] - Per-message options (e.g., labels)
   * @returns {Promise<Object>} The transformed payload
   */
  async rawSend(payload, messageOptions = {}) {
    if (!this.chatSession) {
      throw new Error("Chat session not initialized.");
    }
    const actualPayload = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const mergedLabels = { ...this.labels, ...messageOptions.labels || {} };
    const hasLabels = this.vertexai && Object.keys(mergedLabels).length > 0;
    try {
      const sendParams = { message: actualPayload };
      if (hasLabels) {
        sendParams.config = { labels: mergedLabels };
      }
      const result = await this._withRetry(() => this.chatSession.sendMessage(sendParams));
      this._captureMetadata(result);
      if (result.usageMetadata && logger_default.level !== "silent") {
        logger_default.debug(`API response: model=${result.modelVersion || "unknown"}, tokens=${result.usageMetadata.totalTokenCount}`);
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
  // ── Rebuild ──────────────────────────────────────────────────────────────
  /**
   * Asks the model to fix a payload that failed validation.
   *
   * @param {Object} lastPayload - The payload that failed
   * @param {string} serverError - The error message
   * @returns {Promise<Object>} Corrected payload
   */
  async rebuild(lastPayload, serverError) {
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
      result = await this._withRetry(() => this.chatSession.sendMessage({ message: prompt }));
      this._captureMetadata(result);
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
  // ── Stateless Send ───────────────────────────────────────────────────────
  /**
   * Sends a one-off message using generateContent (not chat).
   * Does NOT affect chat history.
   * @param {Object|string} payload
   * @param {Object} [opts={}]
   * @param {AsyncValidatorFunction|null} [validatorFn]
   * @returns {Promise<Object>}
   * @private
   */
  async _statelessSend(payload, opts = {}, validatorFn = null) {
    if (!this.chatSession) {
      throw new Error("Chat session not initialized. Please call init() first.");
    }
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const contents = [];
    if (this.exampleCount > 0) {
      const history = this.chatSession.getHistory();
      const exampleHistory = history.slice(0, this.exampleCount);
      contents.push(...exampleHistory);
    }
    contents.push({ role: "user", parts: [{ text: payloadStr }] });
    const mergedLabels = { ...this.labels, ...opts.labels || {} };
    const result = await this._withRetry(() => this.genAIClient.models.generateContent({
      model: this.modelName,
      contents,
      config: {
        ...this.chatConfig,
        ...this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels }
      }
    }));
    this._captureMetadata(result);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    const modelResponse = result.text;
    const extractedJSON = extractJSON(modelResponse);
    let transformedPayload = extractedJSON?.data ? extractedJSON.data : extractedJSON;
    if (validatorFn) {
      await validatorFn(transformedPayload);
    }
    return transformedPayload;
  }
  // ── History Management ───────────────────────────────────────────────────
  /**
   * Clears conversation history while preserving seeded examples.
   * @returns {Promise<void>}
   */
  async clearHistory() {
    if (!this.chatSession) {
      logger_default.warn("Cannot clear history: chat not initialized.");
      return;
    }
    const history = this.chatSession.getHistory();
    const exampleHistory = history.slice(0, this.exampleCount || 0);
    this.chatSession = this._createChatSession(exampleHistory);
    this.lastResponseMetadata = null;
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
    logger_default.debug(`Conversation cleared. Preserved ${exampleHistory.length} example items.`);
  }
  /**
   * Fully resets the chat session, clearing all history including examples.
   * @returns {Promise<void>}
   */
  async reset() {
    if (this.chatSession) {
      logger_default.debug("Resetting chat session...");
      this.chatSession = this._createChatSession([]);
      this.exampleCount = 0;
      logger_default.debug("Chat session reset.");
    } else {
      logger_default.warn("Cannot reset: chat not yet initialized.");
    }
  }
  /**
   * Updates system prompt and reinitializes the chat session.
   * @param {string} newPrompt - The new system prompt
   * @returns {Promise<void>}
   */
  async updateSystemPrompt(newPrompt) {
    if (!newPrompt || typeof newPrompt !== "string") {
      throw new Error("System prompt must be a non-empty string");
    }
    this.systemPrompt = newPrompt.trim();
    this.chatConfig.systemInstruction = this.systemPrompt;
    logger_default.debug("Updating system prompt and reinitializing chat...");
    await this.init(true);
  }
  // ── Private Helpers ──────────────────────────────────────────────────────
  /**
   * Normalizes a payload to a string for sending.
   * @param {*} payload
   * @returns {string}
   * @private
   */
  _preparePayload(payload) {
    if (payload && isJSON(payload)) {
      return JSON.stringify(payload, null, 2);
    } else if (typeof payload === "string") {
      return payload;
    } else if (typeof payload === "boolean" || typeof payload === "number") {
      return payload.toString();
    } else if (payload === null || payload === void 0) {
      return JSON.stringify({});
    } else {
      throw new Error("Invalid source payload. Must be a JSON object or string.");
    }
  }
};
var transformer_default = Transformer;

// chat.js
var Chat = class extends base_default {
  /**
   * @param {ChatOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: "You are a helpful AI assistant." };
    }
    super(options);
    logger_default.debug(`Chat created with model: ${this.modelName}`);
  }
  /**
   * Send a text message and get a response. Adds to conversation history.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @param {Record<string, string>} [opts.labels] - Per-message billing labels
   * @returns {Promise<ChatResponse>} Response with text and usage data
   */
  async send(message, opts = {}) {
    if (!this.chatSession) await this.init();
    const mergedLabels = { ...this.labels, ...opts.labels || {} };
    const hasLabels = this.vertexai && Object.keys(mergedLabels).length > 0;
    const sendParams = { message };
    if (hasLabels) {
      sendParams.config = { labels: mergedLabels };
    }
    const result = await this._withRetry(() => this.chatSession.sendMessage(sendParams));
    this._captureMetadata(result);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    return {
      text: result.text || "",
      usage: this.getLastUsage()
    };
  }
};
var chat_default = Chat;

// message.js
var Message = class extends base_default {
  /**
   * @param {MessageOptions} [options={}]
   */
  constructor(options = {}) {
    super(options);
    if (options.responseSchema) {
      this.chatConfig.responseSchema = options.responseSchema;
    }
    if (options.responseMimeType) {
      this.chatConfig.responseMimeType = options.responseMimeType;
    }
    this._isStructured = !!(options.responseSchema || options.responseMimeType === "application/json");
    logger_default.debug(`Message created (structured=${this._isStructured})`);
  }
  /**
   * Initialize the Message client.
   * Override: creates genAIClient only, NO chat session (stateless).
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    logger_default.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);
    try {
      await this.genAIClient.models.list();
      logger_default.debug(`${this.constructor.name}: API connection successful.`);
    } catch (e) {
      throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
    }
    this._initialized = true;
    logger_default.debug(`${this.constructor.name}: Initialized (stateless mode).`);
  }
  /**
   * Send a stateless message and get a response.
   * Each call is independent — no history is maintained.
   *
   * @param {Object|string} payload - The message or data to send
   * @param {Object} [opts={}] - Per-message options
   * @param {Record<string, string>} [opts.labels] - Per-message billing labels
   * @returns {Promise<MessageResponse>} Response with text, optional data, and usage
   */
  async send(payload, opts = {}) {
    if (!this._initialized) await this.init();
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const contents = [{ role: "user", parts: [{ text: payloadStr }] }];
    const mergedLabels = { ...this.labels, ...opts.labels || {} };
    const result = await this._withRetry(() => this.genAIClient.models.generateContent({
      model: this.modelName,
      contents,
      config: {
        ...this.chatConfig,
        ...this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels }
      }
    }));
    this._captureMetadata(result);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    if (result.usageMetadata && logger_default.level !== "silent") {
      logger_default.debug(`Message response: model=${result.modelVersion || "unknown"}, tokens=${result.usageMetadata.totalTokenCount}`);
    }
    const text = result.text || "";
    const response = {
      text,
      usage: this.getLastUsage()
    };
    if (this._isStructured) {
      try {
        response.data = extractJSON(text);
      } catch (e) {
        logger_default.warn(`Could not parse structured response: ${e.message}`);
        response.data = null;
      }
    }
    return response;
  }
  // ── No-ops for stateless class ──
  /** @returns {Array} Always returns empty array (stateless). */
  getHistory() {
    return [];
  }
  /** No-op (stateless). */
  async clearHistory() {
  }
  /** Not supported on Message (stateless). */
  async seed() {
    logger_default.warn("Message is stateless \u2014 seed() has no effect. Use Transformer or Chat for few-shot learning.");
    return [];
  }
  /**
   * Not supported on Message (stateless).
   * @param {any} [_nextPayload]
   * @returns {Promise<{inputTokens: number}>}
   */
  async estimate(_nextPayload) {
    throw new Error("Message is stateless \u2014 use estimate() on Chat or Transformer which have conversation context.");
  }
};
var message_default = Message;

// tool-agent.js
var ToolAgent = class extends base_default {
  /**
   * @param {ToolAgentOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: "You are a helpful AI assistant." };
    }
    super(options);
    this.tools = options.tools || [];
    this.toolExecutor = options.toolExecutor || null;
    if (this.tools.length > 0 && !this.toolExecutor) {
      throw new Error("ToolAgent: tools provided without a toolExecutor. Provide a toolExecutor function to handle tool calls.");
    }
    if (this.toolExecutor && this.tools.length === 0) {
      throw new Error("ToolAgent: toolExecutor provided without tools. Provide tool declarations so the model knows what tools are available.");
    }
    this.maxToolRounds = options.maxToolRounds || 10;
    this.onToolCall = options.onToolCall || null;
    this.onBeforeExecution = options.onBeforeExecution || null;
    this.writeDir = options.writeDir || null;
    this._stopped = false;
    if (this.tools.length > 0) {
      this.chatConfig.tools = [{ functionDeclarations: this.tools }];
      this.chatConfig.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }
    logger_default.debug(`ToolAgent created with ${this.tools.length} tools`);
  }
  // ── Non-Streaming Chat ───────────────────────────────────────────────────
  /**
   * Send a message and get a complete response (non-streaming).
   * Automatically handles the tool-use loop.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @param {Record<string, string>} [opts.labels] - Per-message billing labels
   * @returns {Promise<AgentResponse>} Response with text, toolCalls, and usage
   */
  async chat(message, opts = {}) {
    if (!this.chatSession) await this.init();
    this._stopped = false;
    const allToolCalls = [];
    let response = await this._withRetry(() => this.chatSession.sendMessage({ message }));
    for (let round = 0; round < this.maxToolRounds; round++) {
      if (this._stopped) break;
      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) break;
      const toolResults = await Promise.all(
        functionCalls.map(async (call) => {
          if (this.onToolCall) {
            try {
              this.onToolCall(call.name, call.args);
            } catch (e) {
              logger_default.warn(`onToolCall callback error: ${e.message}`);
            }
          }
          if (this.onBeforeExecution) {
            try {
              const allowed = await this.onBeforeExecution(call.name, call.args);
              if (allowed === false) {
                const result2 = { error: "Execution denied by onBeforeExecution callback" };
                allToolCalls.push({ name: call.name, args: call.args, result: result2 });
                return { id: call.id, name: call.name, result: result2 };
              }
            } catch (e) {
              logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
            }
          }
          let result;
          try {
            result = await this.toolExecutor(call.name, call.args);
          } catch (err) {
            logger_default.warn(`Tool ${call.name} failed: ${err.message}`);
            result = { error: err.message };
          }
          allToolCalls.push({ name: call.name, args: call.args, result });
          return { id: call.id, name: call.name, result };
        })
      );
      response = await this._withRetry(() => this.chatSession.sendMessage({
        message: toolResults.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        }))
      }));
    }
    this._captureMetadata(response);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    return {
      text: response.text || "",
      toolCalls: allToolCalls,
      usage: this.getLastUsage()
    };
  }
  // ── Streaming ────────────────────────────────────────────────────────────
  /**
   * Send a message and stream the response as events.
   * Automatically handles the tool-use loop between streamed rounds.
   *
   * Event types:
   * - `text` — A chunk of the agent's text response
   * - `tool_call` — The agent is about to call a tool
   * - `tool_result` — A tool finished executing
   * - `done` — The agent finished
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @yields {AgentStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this.chatSession) await this.init();
    this._stopped = false;
    const allToolCalls = [];
    let fullText = "";
    let streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({ message }));
    for (let round = 0; round < this.maxToolRounds; round++) {
      if (this._stopped) break;
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
          usage: this.getLastUsage()
        };
        return;
      }
      const toolResults = [];
      for (const call of functionCalls) {
        if (this._stopped) break;
        yield { type: "tool_call", toolName: call.name, args: call.args };
        if (this.onToolCall) {
          try {
            this.onToolCall(call.name, call.args);
          } catch (e) {
            logger_default.warn(`onToolCall callback error: ${e.message}`);
          }
        }
        let denied = false;
        if (this.onBeforeExecution) {
          try {
            const allowed = await this.onBeforeExecution(call.name, call.args);
            if (allowed === false) denied = true;
          } catch (e) {
            logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
          }
        }
        let result;
        if (denied) {
          result = { error: "Execution denied by onBeforeExecution callback" };
        } else {
          try {
            result = await this.toolExecutor(call.name, call.args);
          } catch (err) {
            logger_default.warn(`Tool ${call.name} failed: ${err.message}`);
            result = { error: err.message };
          }
        }
        allToolCalls.push({ name: call.name, args: call.args, result });
        yield { type: "tool_result", toolName: call.name, result };
        toolResults.push({ id: call.id, name: call.name, result });
      }
      streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({
        message: toolResults.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        }))
      }));
    }
    yield {
      type: "done",
      fullText,
      usage: this.getLastUsage(),
      warning: this._stopped ? "Agent was stopped" : "Max tool rounds reached"
    };
  }
  // ── Stop ────────────────────────────────────────────────────────────────
  /**
   * Stop the agent before the next tool execution round.
   * If called during a chat() or stream() loop, the agent will finish
   * the current round and then stop.
   */
  stop() {
    this._stopped = true;
    logger_default.info("ToolAgent stopped");
  }
};
var tool_agent_default = ToolAgent;

// code-agent.js
var import_node_child_process = require("node:child_process");
var import_promises2 = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
var MAX_OUTPUT_CHARS = 5e4;
var MAX_FILE_TREE_LINES = 500;
var IGNORE_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "coverage", ".next", "build", "__pycache__"]);
var CodeAgent = class extends base_default {
  /**
   * @param {CodeAgentOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: "" };
    }
    super(options);
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.maxRounds = options.maxRounds || 10;
    this.timeout = options.timeout || 3e4;
    this.onBeforeExecution = options.onBeforeExecution || null;
    this.onCodeExecution = options.onCodeExecution || null;
    this.importantFiles = options.importantFiles || [];
    this.writeDir = options.writeDir || (0, import_node_path.join)(this.workingDirectory, "tmp");
    this.keepArtifacts = options.keepArtifacts ?? false;
    this.comments = options.comments ?? false;
    this.maxRetries = options.maxRetries ?? 3;
    this._codebaseContext = null;
    this._contextGathered = false;
    this._stopped = false;
    this._activeProcess = null;
    this._userSystemPrompt = options.systemPrompt || "";
    this._allExecutions = [];
    this.chatConfig.tools = [{
      functionDeclarations: [{
        name: "execute_code",
        description: "Execute JavaScript code in a Node.js child process. The code has access to all Node.js built-in modules (fs, path, child_process, http, etc.). Use console.log() to produce output that will be returned to you. The code runs in the working directory with the same environment variables as the parent process.",
        parametersJsonSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript code to execute. Use console.log() for output. You can import any built-in Node.js module."
            },
            purpose: {
              type: "string",
              description: 'A short 2-4 word slug describing what this script does (e.g., "read-config", "parse-logs", "fetch-api-data"). Used for naming the script file.'
            }
          },
          required: ["code"]
        }
      }]
    }];
    this.chatConfig.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    logger_default.debug(`CodeAgent created for directory: ${this.workingDirectory}`);
  }
  // ── Init ─────────────────────────────────────────────────────────────────
  /**
   * Initialize the agent: gather codebase context, build system prompt,
   * and create the chat session.
   * @param {boolean} [force=false]
   */
  async init(force = false) {
    if (this.chatSession && !force) return;
    if (!this._contextGathered || force) {
      await this._gatherCodebaseContext();
    }
    const systemPrompt = this._buildSystemPrompt();
    this.chatConfig.systemInstruction = systemPrompt;
    await super.init(force);
  }
  // ── Context Gathering ────────────────────────────────────────────────────
  /**
   * Gather file tree and key file contents from the working directory.
   * @private
   */
  async _gatherCodebaseContext() {
    let fileTree = "";
    try {
      fileTree = await this._getFileTreeGit();
    } catch {
      logger_default.debug("git ls-files failed, falling back to readdir");
      fileTree = await this._getFileTreeReaddir(this.workingDirectory, 0, 3);
    }
    const lines = fileTree.split("\n");
    if (lines.length > MAX_FILE_TREE_LINES) {
      const truncated = lines.slice(0, MAX_FILE_TREE_LINES).join("\n");
      fileTree = `${truncated}
... (${lines.length - MAX_FILE_TREE_LINES} more files)`;
    }
    let npmPackages = [];
    try {
      const pkgPath = (0, import_node_path.join)(this.workingDirectory, "package.json");
      const pkg = JSON.parse(await (0, import_promises2.readFile)(pkgPath, "utf-8"));
      npmPackages = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {})
      ];
    } catch {
    }
    const importantFileContents = [];
    if (this.importantFiles.length > 0) {
      const fileTreeLines = fileTree.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const requested of this.importantFiles) {
        const resolved = this._resolveImportantFile(requested, fileTreeLines);
        if (!resolved) {
          logger_default.warn(`importantFiles: could not locate "${requested}"`);
          continue;
        }
        try {
          const fullPath = (0, import_node_path.join)(this.workingDirectory, resolved);
          const content = await (0, import_promises2.readFile)(fullPath, "utf-8");
          importantFileContents.push({ path: resolved, content });
        } catch (e) {
          logger_default.warn(`importantFiles: could not read "${resolved}": ${e.message}`);
        }
      }
    }
    this._codebaseContext = { fileTree, npmPackages, importantFileContents };
    this._contextGathered = true;
  }
  /**
   * Resolve an importantFiles entry against the file tree.
   * Supports exact matches and partial (basename/suffix) matches.
   * @private
   * @param {string} filename
   * @param {string[]} fileTreeLines
   * @returns {string|null}
   */
  _resolveImportantFile(filename, fileTreeLines) {
    const exact = fileTreeLines.find((line) => line === filename);
    if (exact) return exact;
    const partial = fileTreeLines.find(
      (line) => line.endsWith("/" + filename) || line.endsWith(import_node_path.sep + filename)
    );
    return partial || null;
  }
  /**
   * Get file tree using git ls-files.
   * @private
   * @returns {Promise<string>}
   */
  async _getFileTreeGit() {
    return new Promise((resolve2, reject) => {
      (0, import_node_child_process.execFile)("git", ["ls-files"], {
        cwd: this.workingDirectory,
        timeout: 5e3,
        maxBuffer: 5 * 1024 * 1024
      }, (err, stdout) => {
        if (err) return reject(err);
        resolve2(stdout.trim());
      });
    });
  }
  /**
   * Fallback file tree via recursive readdir.
   * @private
   * @param {string} dir
   * @param {number} depth
   * @param {number} maxDepth
   * @returns {Promise<string>}
   */
  async _getFileTreeReaddir(dir, depth, maxDepth) {
    if (depth >= maxDepth) return "";
    const entries = [];
    try {
      const items = await (0, import_promises2.readdir)(dir, { withFileTypes: true });
      for (const item of items) {
        if (IGNORE_DIRS.has(item.name)) continue;
        if (item.name.startsWith(".") && depth === 0 && item.isDirectory()) continue;
        const relativePath = (0, import_node_path.join)(dir, item.name).replace(this.workingDirectory + "/", "");
        if (item.isFile()) {
          entries.push(relativePath);
        } else if (item.isDirectory()) {
          entries.push(relativePath + "/");
          const subEntries = await this._getFileTreeReaddir((0, import_node_path.join)(dir, item.name), depth + 1, maxDepth);
          if (subEntries) entries.push(subEntries);
        }
      }
    } catch {
    }
    return entries.join("\n");
  }
  /**
   * Build the full system prompt with codebase context.
   * @private
   * @returns {string}
   */
  _buildSystemPrompt() {
    const { fileTree, npmPackages, importantFileContents } = this._codebaseContext || { fileTree: "", npmPackages: [], importantFileContents: [] };
    let prompt = `You are a coding agent working in ${this.workingDirectory}.

## Instructions
- Use the execute_code tool to accomplish tasks by writing JavaScript code
- Always provide a short descriptive \`purpose\` parameter (2-4 word slug like "read-config") when calling execute_code
- Your code runs in a Node.js child process with access to all built-in modules
- IMPORTANT: Your code runs as an ES module (.mjs). Use import syntax, NOT require():
  - import fs from 'fs';
  - import path from 'path';
  - import { execSync } from 'child_process';
- Use console.log() to produce output \u2014 that's how results are returned to you
- Write efficient scripts that do multiple things per execution when possible
- For parallel async operations, use Promise.all():
  const [a, b] = await Promise.all([fetchA(), fetchB()]);
- Read files with fs.readFileSync() when you need to understand their contents
- Handle errors in your scripts with try/catch so you get useful error messages
- Top-level await is supported
- The working directory is: ${this.workingDirectory}`;
    if (this.comments) {
      prompt += `
- Add a JSDoc @fileoverview comment at the top of each script explaining what it does
- Add brief JSDoc @param comments for any functions you define`;
    } else {
      prompt += `
- Do NOT write any comments in your code \u2014 save tokens. The code should be self-explanatory.`;
    }
    if (fileTree) {
      prompt += `

## File Tree
\`\`\`
${fileTree}
\`\`\``;
    }
    if (npmPackages.length > 0) {
      prompt += `

## Available Packages
These npm packages are installed and can be imported: ${npmPackages.join(", ")}`;
    }
    if (importantFileContents && importantFileContents.length > 0) {
      prompt += `

## Key Files`;
      for (const { path: filePath, content } of importantFileContents) {
        prompt += `

### ${filePath}
\`\`\`javascript
${content}
\`\`\``;
      }
    }
    if (this._userSystemPrompt) {
      prompt += `

## Additional Instructions
${this._userSystemPrompt}`;
    }
    return prompt;
  }
  // ── Code Execution ───────────────────────────────────────────────────────
  /**
   * Generate a sanitized slug from a purpose string.
   * @private
   * @param {string} [purpose]
   * @returns {string}
   */
  _slugify(purpose) {
    if (!purpose) return (0, import_node_crypto.randomUUID)().slice(0, 8);
    return purpose.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }
  /**
   * Execute a JavaScript code string in a child process.
   * @private
   * @param {string} code - JavaScript code to execute
   * @param {string} [purpose] - Short description for file naming
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, denied?: boolean}>}
   */
  async _executeCode(code, purpose) {
    if (this._stopped) {
      return { stdout: "", stderr: "Agent was stopped", exitCode: -1 };
    }
    if (this.onBeforeExecution) {
      try {
        const allowed = await this.onBeforeExecution(code);
        if (allowed === false) {
          return { stdout: "", stderr: "Execution denied by onBeforeExecution callback", exitCode: -1, denied: true };
        }
      } catch (e) {
        logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
      }
    }
    await (0, import_promises2.mkdir)(this.writeDir, { recursive: true });
    const slug = this._slugify(purpose);
    const tempFile = (0, import_node_path.join)(this.writeDir, `agent-${slug}-${Date.now()}.mjs`);
    try {
      await (0, import_promises2.writeFile)(tempFile, code, "utf-8");
      const result = await new Promise((resolve2) => {
        const child = (0, import_node_child_process.execFile)("node", [tempFile], {
          cwd: this.workingDirectory,
          timeout: this.timeout,
          env: process.env,
          maxBuffer: 10 * 1024 * 1024
        }, (err, stdout, stderr) => {
          this._activeProcess = null;
          if (err) {
            resolve2({
              stdout: err.stdout || stdout || "",
              stderr: (err.stderr || stderr || "") + (err.killed ? "\n[EXECUTION TIMED OUT]" : ""),
              exitCode: err.code || 1
            });
          } else {
            resolve2({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
          }
        });
        this._activeProcess = child;
      });
      const totalLen = result.stdout.length + result.stderr.length;
      if (totalLen > MAX_OUTPUT_CHARS) {
        const half = Math.floor(MAX_OUTPUT_CHARS / 2);
        if (result.stdout.length > half) {
          result.stdout = result.stdout.slice(0, half) + "\n...[OUTPUT TRUNCATED]";
        }
        if (result.stderr.length > half) {
          result.stderr = result.stderr.slice(0, half) + "\n...[STDERR TRUNCATED]";
        }
      }
      this._allExecutions.push({
        code,
        purpose: purpose || null,
        output: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        filePath: this.keepArtifacts ? tempFile : null
      });
      if (this.onCodeExecution) {
        try {
          this.onCodeExecution(code, result);
        } catch (e) {
          logger_default.warn(`onCodeExecution callback error: ${e.message}`);
        }
      }
      return result;
    } finally {
      if (!this.keepArtifacts) {
        try {
          await (0, import_promises2.unlink)(tempFile);
        } catch {
        }
      }
    }
  }
  /**
   * Format execution result as a string for the model.
   * @private
   * @param {{stdout: string, stderr: string, exitCode: number}} result
   * @returns {string}
   */
  _formatOutput(result) {
    let output = "";
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? "\n" : "") + `[STDERR]: ${result.stderr}`;
    if (result.exitCode !== 0) output += (output ? "\n" : "") + `[EXIT CODE]: ${result.exitCode}`;
    return output || "(no output)";
  }
  // ── Non-Streaming Chat ───────────────────────────────────────────────────
  /**
   * Send a message and get a complete response (non-streaming).
   * Automatically handles the code execution loop.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @param {Record<string, string>} [opts.labels] - Per-message billing labels
   * @returns {Promise<CodeAgentResponse>} Response with text, codeExecutions, and usage
   */
  async chat(message, opts = {}) {
    if (!this.chatSession) await this.init();
    this._stopped = false;
    const codeExecutions = [];
    let consecutiveFailures = 0;
    let response = await this._withRetry(() => this.chatSession.sendMessage({ message }));
    for (let round = 0; round < this.maxRounds; round++) {
      if (this._stopped) break;
      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) break;
      const results = [];
      for (const call of functionCalls) {
        if (this._stopped) break;
        const code = call.args?.code || "";
        const purpose = call.args?.purpose;
        const result = await this._executeCode(code, purpose);
        codeExecutions.push({
          code,
          purpose: this._slugify(purpose),
          output: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        });
        if (result.exitCode !== 0 && !result.denied) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
        }
        let output = this._formatOutput(result);
        if (consecutiveFailures >= this.maxRetries) {
          output += `

[RETRY LIMIT REACHED] You have failed ${this.maxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
        }
        results.push({
          id: call.id,
          name: call.name,
          result: output
        });
      }
      if (this._stopped) break;
      response = await this._withRetry(() => this.chatSession.sendMessage({
        message: results.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        }))
      }));
      if (consecutiveFailures >= this.maxRetries) break;
    }
    this._captureMetadata(response);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    return {
      text: response.text || "",
      codeExecutions,
      usage: this.getLastUsage()
    };
  }
  // ── Streaming ────────────────────────────────────────────────────────────
  /**
   * Send a message and stream the response as events.
   * Automatically handles the code execution loop between streamed rounds.
   *
   * Event types:
   * - `text` — A chunk of the agent's text response
   * - `code` — The agent is about to execute code
   * - `output` — Code finished executing
   * - `done` — The agent finished
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @yields {CodeAgentStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this.chatSession) await this.init();
    this._stopped = false;
    const codeExecutions = [];
    let fullText = "";
    let consecutiveFailures = 0;
    let streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({ message }));
    for (let round = 0; round < this.maxRounds; round++) {
      if (this._stopped) break;
      const functionCalls = [];
      for await (const chunk of streamResponse) {
        if (chunk.functionCalls) {
          functionCalls.push(...chunk.functionCalls);
        } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
          const text = chunk.candidates[0].content.parts[0].text;
          fullText += text;
          yield { type: "text", text };
        }
      }
      if (functionCalls.length === 0) {
        yield {
          type: "done",
          fullText,
          codeExecutions,
          usage: this.getLastUsage()
        };
        return;
      }
      const results = [];
      for (const call of functionCalls) {
        if (this._stopped) break;
        const code = call.args?.code || "";
        const purpose = call.args?.purpose;
        yield { type: "code", code };
        const result = await this._executeCode(code, purpose);
        codeExecutions.push({
          code,
          purpose: this._slugify(purpose),
          output: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        });
        yield {
          type: "output",
          code,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        };
        if (result.exitCode !== 0 && !result.denied) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
        }
        let output = this._formatOutput(result);
        if (consecutiveFailures >= this.maxRetries) {
          output += `

[RETRY LIMIT REACHED] You have failed ${this.maxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
        }
        results.push({
          id: call.id,
          name: call.name,
          result: output
        });
      }
      if (this._stopped) break;
      streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({
        message: results.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        }))
      }));
      if (consecutiveFailures >= this.maxRetries) break;
    }
    let warning = "Max tool rounds reached";
    if (this._stopped) warning = "Agent was stopped";
    else if (consecutiveFailures >= this.maxRetries) warning = "Retry limit reached";
    yield {
      type: "done",
      fullText,
      codeExecutions,
      usage: this.getLastUsage(),
      warning
    };
  }
  // ── Dump ─────────────────────────────────────────────────────────────────
  /**
   * Returns all code scripts the agent has written across all chat/stream calls.
   * @returns {Array<{fileName: string, script: string}>}
   */
  dump() {
    return this._allExecutions.map((exec, i) => ({
      fileName: exec.purpose ? `agent-${exec.purpose}.mjs` : `script-${i + 1}.mjs`,
      purpose: exec.purpose || null,
      script: exec.code,
      filePath: exec.filePath || null
    }));
  }
  // ── Stop ─────────────────────────────────────────────────────────────────
  /**
   * Stop the agent before the next code execution.
   * If a child process is currently running, it will be killed.
   */
  stop() {
    this._stopped = true;
    if (this._activeProcess) {
      try {
        this._activeProcess.kill("SIGTERM");
      } catch {
      }
    }
    logger_default.info("CodeAgent stopped");
  }
};
var code_agent_default = CodeAgent;

// rag-agent.js
var import_node_path2 = require("node:path");
var import_promises3 = require("node:fs/promises");
var MIME_TYPES = {
  // Text
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "text/xml",
  ".json": "application/json",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".ts": "text/plain",
  ".css": "text/css",
  ".yaml": "text/plain",
  ".yml": "text/plain",
  ".py": "text/x-python",
  ".rb": "text/plain",
  ".sh": "text/plain",
  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska"
};
var DEFAULT_SYSTEM_PROMPT = "You are a helpful AI assistant. Answer questions based on the provided documents and data. When referencing information, mention which document or data source it comes from.";
var FILE_POLL_INTERVAL_MS = 2e3;
var FILE_POLL_TIMEOUT_MS = 6e4;
var RagAgent = class extends base_default {
  /**
   * @param {RagAgentOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: DEFAULT_SYSTEM_PROMPT };
    }
    super(options);
    this.remoteFiles = options.remoteFiles || [];
    this.localFiles = options.localFiles || [];
    this.localData = options.localData || [];
    this._uploadedRemoteFiles = [];
    this._localFileContents = [];
    this._initialized = false;
    const total = this.remoteFiles.length + this.localFiles.length + this.localData.length;
    logger_default.debug(`RagAgent created with ${total} context sources`);
  }
  // ── Initialization ───────────────────────────────────────────────────────
  /**
   * Uploads remote files, reads local files, and seeds all context into the chat.
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    this._uploadedRemoteFiles = [];
    for (const filePath of this.remoteFiles) {
      const resolvedPath = (0, import_node_path2.resolve)(filePath);
      logger_default.debug(`Uploading remote file: ${resolvedPath}`);
      const ext = (0, import_node_path2.extname)(resolvedPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      const uploaded = await this._withRetry(() => this.genAIClient.files.upload({
        file: resolvedPath,
        config: { displayName: (0, import_node_path2.basename)(resolvedPath), mimeType }
      }));
      await this._waitForFileActive(uploaded);
      this._uploadedRemoteFiles.push({
        ...uploaded,
        originalPath: resolvedPath
      });
      logger_default.debug(`File uploaded: ${uploaded.displayName} (${uploaded.mimeType})`);
    }
    this._localFileContents = [];
    for (const filePath of this.localFiles) {
      const resolvedPath = (0, import_node_path2.resolve)(filePath);
      logger_default.debug(`Reading local file: ${resolvedPath}`);
      const content = await (0, import_promises3.readFile)(resolvedPath, "utf-8");
      this._localFileContents.push({
        name: (0, import_node_path2.basename)(resolvedPath),
        content,
        path: resolvedPath
      });
      logger_default.debug(`Local file read: ${(0, import_node_path2.basename)(resolvedPath)} (${content.length} chars)`);
    }
    this.chatConfig.systemInstruction = /** @type {string} */
    this.systemPrompt;
    await super.init(force);
    const parts = [];
    for (const f of this._uploadedRemoteFiles) {
      parts.push({ fileData: { fileUri: f.uri, mimeType: f.mimeType } });
    }
    for (const lf of this._localFileContents) {
      parts.push({ text: `--- File: ${lf.name} ---
${lf.content}` });
    }
    for (const ld of this.localData) {
      const serialized = typeof ld.data === "string" ? ld.data : JSON.stringify(ld.data, null, 2);
      parts.push({ text: `--- Data: ${ld.name} ---
${serialized}` });
    }
    if (parts.length > 0) {
      parts.push({ text: "Here are the documents and data to analyze." });
      const history = [
        { role: "user", parts },
        { role: "model", parts: [{ text: "I have reviewed all the provided documents and data. I am ready to answer your questions about them." }] }
      ];
      this.chatSession = this._createChatSession(history);
    }
    this._initialized = true;
    logger_default.debug(`RagAgent initialized with ${this._uploadedRemoteFiles.length} remote files, ${this._localFileContents.length} local files, ${this.localData.length} data entries`);
  }
  // ── Non-Streaming Chat ───────────────────────────────────────────────────
  /**
   * Send a message and get a complete response grounded in the loaded context.
   *
   * @param {string} message - The user's question
   * @param {Object} [opts={}] - Per-message options
   * @param {Record<string, string>} [opts.labels] - Per-message billing labels
   * @returns {Promise<RagResponse>}
   */
  async chat(message, opts = {}) {
    if (!this._initialized) await this.init();
    const response = await this._withRetry(() => this.chatSession.sendMessage({ message }));
    this._captureMetadata(response);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    return {
      text: response.text || "",
      usage: this.getLastUsage()
    };
  }
  // ── Streaming ────────────────────────────────────────────────────────────
  /**
   * Send a message and stream the response as events.
   *
   * @param {string} message - The user's question
   * @param {Object} [opts={}] - Per-message options
   * @yields {RagStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this._initialized) await this.init();
    let fullText = "";
    const streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({ message }));
    for await (const chunk of streamResponse) {
      if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
        const text = chunk.candidates[0].content.parts[0].text;
        fullText += text;
        yield { type: "text", text };
      }
    }
    yield {
      type: "done",
      fullText,
      usage: this.getLastUsage()
    };
  }
  // ── Context Management ──────────────────────────────────────────────────
  /**
   * Add remote files (uploaded via Files API). Triggers reinitialize.
   * @param {string[]} paths
   * @returns {Promise<void>}
   */
  async addRemoteFiles(paths) {
    this.remoteFiles.push(...paths);
    await this.init(true);
  }
  /**
   * Add local text files (read from disk). Triggers reinitialize.
   * @param {string[]} paths
   * @returns {Promise<void>}
   */
  async addLocalFiles(paths) {
    this.localFiles.push(...paths);
    await this.init(true);
  }
  /**
   * Add in-memory data entries. Triggers reinitialize.
   * @param {LocalDataEntry[]} entries
   * @returns {Promise<void>}
   */
  async addLocalData(entries) {
    this.localData.push(...entries);
    await this.init(true);
  }
  /**
   * Returns metadata about all context sources.
   * @returns {{ remoteFiles: Array<Object>, localFiles: Array<Object>, localData: Array<Object> }}
   */
  getContext() {
    return {
      remoteFiles: this._uploadedRemoteFiles.map((f) => ({
        name: f.name,
        displayName: f.displayName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        uri: f.uri,
        originalPath: f.originalPath
      })),
      localFiles: this._localFileContents.map((lf) => ({
        name: lf.name,
        path: lf.path,
        size: lf.content.length
      })),
      localData: this.localData.map((ld) => ({
        name: ld.name,
        type: typeof ld.data === "object" && ld.data !== null ? Array.isArray(ld.data) ? "array" : "object" : typeof ld.data
      }))
    };
  }
  // ── Private Helpers ──────────────────────────────────────────────────────
  /**
   * Polls until an uploaded file reaches ACTIVE state.
   * @param {Object} file - The uploaded file object
   * @returns {Promise<void>}
   * @private
   */
  async _waitForFileActive(file) {
    if (file.state === "ACTIVE") return;
    const start = Date.now();
    while (Date.now() - start < FILE_POLL_TIMEOUT_MS) {
      const updated = await this.genAIClient.files.get({ name: file.name });
      if (updated.state === "ACTIVE") return;
      if (updated.state === "FAILED") {
        throw new Error(`File processing failed: ${file.displayName || file.name}`);
      }
      await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
    }
    throw new Error(`File processing timed out after ${FILE_POLL_TIMEOUT_MS / 1e3}s: ${file.displayName || file.name}`);
  }
};
var rag_agent_default = RagAgent;

// embedding.js
var Embedding = class extends base_default {
  /**
   * @param {import('./types.d.ts').EmbeddingOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.modelName === void 0) {
      options = { ...options, modelName: "gemini-embedding-001" };
    }
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: null };
    }
    super(options);
    this.taskType = options.taskType || null;
    this.title = options.title || null;
    this.outputDimensionality = options.outputDimensionality || null;
    this.autoTruncate = options.autoTruncate ?? true;
    logger_default.debug(`Embedding created with model: ${this.modelName}`);
  }
  /**
   * Initialize the Embedding client.
   * Override: validates API connection only, NO chat session (stateless).
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    logger_default.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);
    try {
      await this.genAIClient.models.list();
      logger_default.debug(`${this.constructor.name}: API connection successful.`);
    } catch (e) {
      throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
    }
    this._initialized = true;
    logger_default.debug(`${this.constructor.name}: Initialized (stateless mode).`);
  }
  /**
   * Builds the config object for embedContent calls.
   * @param {Object} [overrides={}] - Per-call config overrides
   * @returns {Object} The config object
   * @private
   */
  _buildConfig(overrides = {}) {
    const config = {};
    const taskType = overrides.taskType || this.taskType;
    const title = overrides.title || this.title;
    const dims = overrides.outputDimensionality || this.outputDimensionality;
    if (taskType) config.taskType = taskType;
    if (title) config.title = title;
    if (dims) config.outputDimensionality = dims;
    return config;
  }
  /**
  	 * Embed a single text string.
  	 * @param {string} text - The text to embed
  	 * @param {Object} [config={}] - Per-call config overrides
  	 * @param {string} [config.taskType] - Override task type
  	 * @param {string} [config.title] - Override title
  	 * @param {number} [config.outputDimensionality] - Override dimensions
  
  	 * @returns {Promise<import('./types.d.ts').EmbeddingResult>} The embedding result
  	 */
  async embed(text, config = {}) {
    if (!this._initialized) await this.init();
    const result = await this._withRetry(() => this.genAIClient.models.embedContent({
      model: this.modelName,
      contents: text,
      config: this._buildConfig(config)
    }));
    return result.embeddings[0];
  }
  /**
  	 * Embed multiple text strings in a single API call.
  	 * @param {string[]} texts - Array of texts to embed
  	 * @param {Object} [config={}] - Per-call config overrides
  	 * @param {string} [config.taskType] - Override task type
  	 * @param {string} [config.title] - Override title
  	 * @param {number} [config.outputDimensionality] - Override dimensions
  
  	 * @returns {Promise<import('./types.d.ts').EmbeddingResult[]>} Array of embedding results
  	 */
  async embedBatch(texts, config = {}) {
    if (!this._initialized) await this.init();
    const result = await this._withRetry(() => this.genAIClient.models.embedContent({
      model: this.modelName,
      contents: texts,
      config: this._buildConfig(config)
    }));
    return result.embeddings;
  }
  /**
   * Compute cosine similarity between two embedding vectors.
   * Pure math — no API call.
   * @param {number[]} a - First embedding vector
   * @param {number[]} b - Second embedding vector
   * @returns {number} Cosine similarity between -1 and 1
   */
  similarity(a, b) {
    if (!a || !b || a.length !== b.length) {
      throw new Error("Vectors must be non-null and have the same length");
    }
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    if (magnitude === 0) return 0;
    return dot / magnitude;
  }
  // ── No-ops (embeddings don't use chat sessions) ──
  /** @returns {any[]} Always returns empty array */
  getHistory() {
    return [];
  }
  /** No-op for Embedding */
  async clearHistory() {
  }
  /** No-op for Embedding */
  async seed() {
    logger_default.warn("Embedding.seed() is a no-op \u2014 embeddings do not support few-shot examples.");
    return [];
  }
  /**
   * @param {any} _nextPayload
   * @throws {Error} Embedding does not support token estimation
   * @returns {Promise<{inputTokens: number}>}
   */
  async estimate(_nextPayload) {
    throw new Error("Embedding does not support token estimation. Use embed() directly.");
  }
};

// index.js
var import_genai2 = require("@google/genai");
var index_default = { Transformer: transformer_default, Chat: chat_default, Message: message_default, ToolAgent: tool_agent_default, CodeAgent: code_agent_default, RagAgent: rag_agent_default, Embedding };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BaseGemini,
  Chat,
  CodeAgent,
  Embedding,
  HarmBlockThreshold,
  HarmCategory,
  Message,
  RagAgent,
  ThinkingLevel,
  ToolAgent,
  Transformer,
  attemptJSONRecovery,
  extractJSON,
  log
});
