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
  default: () => index_default,
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
    this.explanationKey = "";
    this.systemInstructionKey = "";
    this.maxRetries = 3;
    this.retryDelay = 1e3;
    this.systemInstructions = "";
    this.chatConfig = {};
    this.apiKey = GEMINI_API_KEY;
    this.onlyJSON = true;
    this.asyncValidator = null;
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
    this.estimate = estimateTokenUsage.bind(this);
  }
};
var index_default = AITransformer;
function AITransformFactory(options = {}) {
  this.modelName = options.modelName || "gemini-2.0-flash";
  this.systemInstructions = options.systemInstructions || DEFAULT_SYSTEM_INSTRUCTIONS;
  this.apiKey = options.apiKey !== void 0 && options.apiKey !== null ? options.apiKey : GEMINI_API_KEY;
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
  this.promptKey = options.promptKey || "PROMPT";
  this.answerKey = options.answerKey || "ANSWER";
  this.contextKey = options.contextKey || "CONTEXT";
  this.explanationKey = options.explanationKey || "EXPLANATION";
  this.systemInstructionsKey = options.systemInstructionsKey || "SYSTEM";
  this.maxRetries = options.maxRetries || 3;
  this.retryDelay = options.retryDelay || 1e3;
  this.asyncValidator = options.asyncValidator || null;
  this.onlyJSON = options.onlyJSON !== void 0 ? options.onlyJSON : true;
  if (this.promptKey === this.answerKey) {
    throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
  }
  logger_default.debug(`Creating AI Transformer with model: ${this.modelName}`);
  logger_default.debug(`Using keys - Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
  const ai = new import_genai.GoogleGenAI({ apiKey: this.apiKey });
  this.genAIClient = ai;
  this.chat = null;
}
async function initChat(force = false) {
  if (this.chat && !force) return;
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
      try {
        examples = await import_ak_tools.default.load(import_path.default.resolve(this.examplesFile), true);
      } catch (err) {
        throw new Error(`Could not load examples from file: ${this.examplesFile}. Please check the file path and format.`);
      }
    } else {
      logger_default.debug("No examples provided and no examples file specified. Skipping seeding.");
      return;
    }
  }
  if (examples?.slice().pop()[this.systemInstructionsKey]) {
    logger_default.debug(`Found system instructions in examples; reinitializing chat with new instructions.`);
    this.systemInstructions = examples.slice().pop()[this.systemInstructionsKey];
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
  this.chat = await this.genAIClient.chats.create({
    model: this.modelName,
    // @ts-ignore
    config: this.chatConfig,
    history: [...currentHistory, ...historyToAdd]
  });
  logger_default.debug("Transformation examples seeded successfully.");
  return this.chat.getHistory();
}
async function rawMessage(sourcePayload) {
  if (!this.chat) {
    throw new Error("Chat session not initialized.");
  }
  const actualPayload = typeof sourcePayload === "string" ? sourcePayload : JSON.stringify(sourcePayload, null, 2);
  try {
    const result = await this.chat.sendMessage({ message: actualPayload });
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
  const maxRetries = options.maxRetries ?? this.maxRetries;
  const retryDelay = options.retryDelay ?? this.retryDelay;
  let lastError = null;
  let lastPayload = null;
  if (sourcePayload && isJSON(sourcePayload)) {
    lastPayload = JSON.stringify(sourcePayload, null, 2);
  } else if (typeof sourcePayload === "string") {
    lastPayload = sourcePayload;
  } else {
    throw new Error("Invalid source payload. Must be a JSON object or string.");
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const transformedPayload = attempt === 0 ? await this.rawMessage(lastPayload) : await this.rebuild(lastPayload, lastError.message);
      lastPayload = transformedPayload;
      if (validatorFn) {
        await validatorFn(transformedPayload);
      }
      logger_default.debug(`Transformation succeeded on attempt ${attempt + 1}`);
      return transformedPayload;
    } catch (error) {
      lastError = error;
      logger_default.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt >= maxRetries) {
        logger_default.error(`All ${maxRetries + 1} attempts failed.`);
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
      const validatedResponse = await transformer.messageAndValidate(
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
  log
});
