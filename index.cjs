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
  AITransformer: () => AITransformer,
  default: () => AITransformer,
  log: () => logger_default
});
module.exports = __toCommonJS(index_exports);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");
var import_ak_tools = __toESM(require("ak-tools"), 1);
var import_path = __toESM(require("path"), 1);

// logger.js
var import_pino = __toESM(require("pino"), 1);
var isDev = process.env.NODE_ENV !== "production";
var logger = (0, import_pino.default)({
  level: process.env.LOG_LEVEL || "info",
  // Supports 'fatal', 'error', 'warn', 'info', 'debug', 'trace'
  transport: isDev ? {
    target: "pino-pretty",
    // Prettified output for local dev
    options: { colorize: true, translateTime: true }
  } : void 0
  // In prod/cloud, keep as JSON for cloud logging
});
var logger_default = logger;

// index.js
var import_meta = {};
import_dotenv.default.config();
var { NODE_ENV = "unknown", GEMINI_API_KEY } = process.env;
if (NODE_ENV === "dev") logger_default.level = "debug";
if (NODE_ENV === "test") logger_default.level = "warn";
if (NODE_ENV.startsWith("prod")) logger_default.level = "error";
var DEFAULT_SAFETY_SETTINGS = [
  { category: import_genai.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE },
  { category: import_genai.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE }
];
var DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON). 

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.
`;
var DEFAULT_CHAT_CONFIG = {
  responseMimeType: "application/json",
  temperature: 0.2,
  topP: 0.95,
  topK: 64,
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTIONS,
  safetySettings: DEFAULT_SAFETY_SETTINGS
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
    this.maxRetries = 3;
    this.retryDelay = 1e3;
    this.systemInstructions = "";
    this.chatConfig = {};
    this.apiKey = GEMINI_API_KEY;
    AITransformFactory.call(this, options);
    this.init = initChat.bind(this);
    this.seed = seedWithExamples.bind(this);
    this.message = transformJSON.bind(this);
    this.rebuild = rebuildPayload.bind(this);
    this.reset = resetChat.bind(this);
    this.getHistory = getChatHistory.bind(this);
    this.transformWithValidation = transformWithValidation.bind(this);
    this.estimate = estimateTokenUsage.bind(this);
  }
};
function AITransformFactory(options = {}) {
  this.modelName = options.modelName || "gemini-2.0-flash";
  this.systemInstructions = options.systemInstructions || DEFAULT_SYSTEM_INSTRUCTIONS;
  this.apiKey = options.apiKey || GEMINI_API_KEY;
  if (!this.apiKey) throw new Error("Missing Gemini API key. Provide via options.apiKey or GEMINI_API_KEY env var.");
  this.chatConfig = {
    ...DEFAULT_CHAT_CONFIG,
    ...options.chatConfig,
    systemInstruction: this.systemInstructions
  };
  if (options.responseSchema) {
    this.chatConfig.responseSchema = options.responseSchema;
  }
  this.examplesFile = options.examplesFile || null;
  this.exampleData = options.exampleData || null;
  this.promptKey = options.sourceKey || "PROMPT";
  this.answerKey = options.targetKey || "ANSWER";
  this.contextKey = options.contextKey || "CONTEXT";
  this.maxRetries = options.maxRetries || 3;
  this.retryDelay = options.retryDelay || 1e3;
  if (this.promptKey === this.answerKey) {
    throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
  }
  logger_default.debug(`Creating AI Transformer with model: ${this.modelName}`);
  logger_default.debug(`Using keys - Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
  const ai = new import_genai.GoogleGenAI({ apiKey: this.apiKey });
  this.genAIClient = ai;
  this.chat = null;
}
async function initChat() {
  if (this.chat) return;
  logger_default.debug(`Initializing Gemini chat session with model: ${this.modelName}...`);
  this.chat = await this.genAIClient.chats.create({
    model: this.modelName,
    // @ts-ignore
    config: this.chatConfig,
    history: []
  });
  logger_default.debug("Gemini chat session initialized.");
}
async function seedWithExamples(examples) {
  await this.init();
  if (!examples || !Array.isArray(examples) || examples.length === 0) {
    if (this.examplesFile) {
      logger_default.debug(`No examples provided, loading from file: ${this.examplesFile}`);
      examples = await import_ak_tools.default.load(import_path.default.resolve(this.examplesFile), true);
    } else {
      logger_default.debug("No examples provided and no examples file specified. Skipping seeding.");
      return;
    }
  }
  logger_default.debug(`Seeding chat with ${examples.length} transformation examples...`);
  const historyToAdd = [];
  for (const example of examples) {
    const contextValue = example[this.contextKey] || "";
    const promptValue = example[this.promptKey] || "";
    const answerValue = example[this.answerKey] || "";
    if (contextValue) {
      let contextText = import_ak_tools.default.isJSON(contextValue) ? JSON.stringify(contextValue, null, 2) : contextValue;
      historyToAdd.push({
        role: "user",
        parts: [{ text: `Context: ${contextText}` }]
      });
      historyToAdd.push({
        role: "model",
        parts: [{ text: "I understand the context." }]
      });
    }
    if (promptValue) {
      let promptText = import_ak_tools.default.isJSON(promptValue) ? JSON.stringify(promptValue, null, 2) : promptValue;
      historyToAdd.push({ role: "user", parts: [{ text: promptText }] });
    }
    if (answerValue) {
      let answerText = import_ak_tools.default.isJSON(answerValue) ? JSON.stringify(answerValue, null, 2) : answerValue;
      historyToAdd.push({ role: "model", parts: [{ text: answerText }] });
    }
  }
  const currentHistory = this?.chat?.getHistory() || [];
  this.chat = await this.genAIClient.chats.create({
    model: this.modelName,
    // @ts-ignore
    config: this.chatConfig,
    history: [...currentHistory, ...historyToAdd]
  });
  logger_default.debug("Transformation examples seeded successfully.");
}
async function transformJSON(sourcePayload) {
  if (!this.chat) {
    throw new Error("Chat session not initialized. Call initChat() or seedWithExamples() first.");
  }
  let result;
  let actualPayload;
  if (sourcePayload && import_ak_tools.default.isJSON(sourcePayload)) actualPayload = JSON.stringify(sourcePayload, null, 2);
  else if (typeof sourcePayload === "string") actualPayload = sourcePayload;
  else throw new Error("Invalid source payload. Must be a JSON object or a valid JSON string.");
  try {
    result = await this.chat.sendMessage({ message: actualPayload });
  } catch (error) {
    logger_default.error("Error with Gemini API:", error);
    throw new Error(`Transformation failed: ${error.message}`);
  }
  try {
    const modelResponse = result.text;
    const parsedResponse = JSON.parse(modelResponse);
    return parsedResponse;
  } catch (parseError) {
    logger_default.error("Error parsing Gemini response:", parseError);
    throw new Error(`Invalid JSON response from Gemini: ${parseError.message}`);
  }
}
async function transformWithValidation(sourcePayload, validatorFn, options = {}) {
  const maxRetries = options.maxRetries ?? this.maxRetries;
  const retryDelay = options.retryDelay ?? this.retryDelay;
  let lastPayload = null;
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const transformedPayload = attempt === 0 ? await this.message(sourcePayload) : await this.rebuild(lastPayload, lastError.message);
      const validatedPayload = await validatorFn(transformedPayload);
      logger_default.debug(`Transformation and validation succeeded on attempt ${attempt + 1}`);
      return validatedPayload;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        lastPayload = await this.message(sourcePayload).catch(() => null);
      }
      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt);
        logger_default.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error.message);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        logger_default.error(`All ${maxRetries + 1} attempts failed`);
        throw new Error(`Transformation with validation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
      }
    }
  }
}
async function estimateTokenUsage(nextPayload) {
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
  return resp;
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
async function resetChat() {
  if (this.chat) {
    logger_default.debug("Resetting Gemini chat session...");
    this.chat = await this.genAIClient.chats.create({
      model: this.modelName,
      // @ts-ignore
      config: this.chatConfig,
      history: []
    });
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
if (import_meta.url === new URL(`file://${process.argv[1]}`).href) {
  logger_default.info("RUNNING AI Transformer as standalone script...");
  (async () => {
    try {
      logger_default.info("Initializing AI Transformer...");
      const transformer = new AITransformer({
        modelName: "gemini-2.0-flash",
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
      const validatedResponse = await transformer.transformWithValidation(
        { "name": "Lynn" },
        mockValidator
      );
      logger_default.info("Validated Payload Transformed", validatedResponse);
      if (NODE_ENV === "dev") debugger;
    } catch (error) {
      logger_default.error("Error in AI Transformer script:", error);
      if (NODE_ENV === "dev") debugger;
    }
  })();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AITransformer,
  log
});
