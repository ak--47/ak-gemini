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
  DEFAULT_GEMINI_API_VERSION: () => DEFAULT_GEMINI_API_VERSION,
  DEFAULT_MODEL: () => DEFAULT_MODEL,
  EFFORT_LEVELS: () => EFFORT_LEVELS,
  Embedding: () => Embedding,
  FileAgent: () => file_agent_default,
  HarmBlockThreshold: () => import_genai2.HarmBlockThreshold,
  HarmCategory: () => import_genai2.HarmCategory,
  ImageGenerator: () => ImageGenerator,
  MODEL_ALIASES: () => MODEL_ALIASES,
  MODEL_PRICING: () => MODEL_PRICING,
  MODEL_PRICING_AS_OF: () => MODEL_PRICING_AS_OF,
  Message: () => message_default,
  READ_FORMATS: () => READ_FORMATS,
  RagAgent: () => rag_agent_default,
  THINKING_CAPABILITIES: () => THINKING_CAPABILITIES,
  THINKING_SUPPORTED_MODELS: () => THINKING_SUPPORTED_MODELS,
  ThinkingLevel: () => import_genai2.ThinkingLevel,
  ToolAgent: () => tool_agent_default,
  Transformer: () => transformer_default,
  UnsupportedFormatError: () => UnsupportedFormatError,
  WRITE_FORMATS: () => WRITE_FORMATS,
  attemptJSONRecovery: () => attemptJSONRecovery,
  computeCost: () => computeCost,
  default: () => index_default,
  extractJSON: () => extractJSON,
  log: () => logger_default,
  pcmToWav: () => pcmToWav,
  resolvePricing: () => resolvePricing,
  thinkingCapabilities: () => thinkingCapabilities,
  validateSchema: () => validateSchema,
  writeFormatsFor: () => writeFormatsFor
});
module.exports = __toCommonJS(index_exports);

// base.js
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");
var import_google_auth_library = require("google-auth-library");

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
function validateSchema(data, schema, path2 = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  if (data === null && schema.nullable === true) return errors;
  if (Array.isArray(schema.enum)) {
    const target = JSON.stringify(data);
    const ok = schema.enum.some((v) => v === data || JSON.stringify(v) === target);
    if (!ok) errors.push(`${path2}: value ${JSON.stringify(data)} is not one of allowed enum values ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type !== void 0) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (schema.nullable === true) types.push("null");
    if (!types.some((t) => matchesType(data, t))) {
      errors.push(`${path2}: expected type ${types.join("|")} but got ${describeType(data)}`);
      return errors;
    }
  }
  const isObject = data !== null && typeof data === "object" && !Array.isArray(data);
  if (isObject && (schema.properties || schema.required || schema.additionalProperties === false)) {
    const props = schema.properties || {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.hasOwn(data, key)) errors.push(`${path2}: missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) {
        if (!Object.hasOwn(props, key)) errors.push(`${path2}: unexpected property "${key}" (additionalProperties is false)`);
      }
    }
    for (const [key, subSchema] of Object.entries(props)) {
      if (Object.hasOwn(data, key)) {
        errors.push(...validateSchema(
          data[key],
          /** @type {any} */
          subSchema,
          `${path2}.${key}`
        ));
      }
    }
  }
  if (Array.isArray(data) && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    data.forEach((item, i) => {
      errors.push(...validateSchema(item, schema.items, `${path2}[${i}]`));
    });
  }
  return errors;
}
function matchesType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
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

// files.js
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var TEXT_MIME_TYPES = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".xml": "text/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".ts": "text/plain",
  ".css": "text/css",
  ".py": "text/x-python",
  ".rb": "text/plain",
  ".sh": "text/plain",
  ".svg": "image/svg+xml"
};
var BINARY_MIME_TYPES = {
  ".pdf": "application/pdf",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  // Audio
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".aiff": "audio/aiff",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  // Video
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".webm": "video/webm",
  ".wmv": "video/wmv",
  ".3gp": "video/3gpp"
};
var MIME_TYPES = Object.freeze({ ...TEXT_MIME_TYPES, ...BINARY_MIME_TYPES });
var TEXT_EXTENSIONS = new Set(Object.keys(TEXT_MIME_TYPES));
var LEGACY_MIME_TYPES = Object.freeze({
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
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska"
});
var READ_FORMATS = Object.freeze(Object.keys(MIME_TYPES));
var TEXT_MIMES = new Set(Object.values(TEXT_MIME_TYPES));
var BINARY_MIMES = new Set(Object.values(BINARY_MIME_TYPES));
var WRITE_FORMATS = Object.freeze({
  text: Object.freeze(["txt", "md", "csv", "json", "yaml", "yml", "html", "xml", "svg"]),
  image: Object.freeze({
    vertex: Object.freeze(["png", "jpg", "jpeg"]),
    gemini: Object.freeze(["jpg", "jpeg"])
  }),
  audio: Object.freeze(["wav"])
});
function writeFormatsFor(vertexai) {
  return [...WRITE_FORMATS.text, ...WRITE_FORMATS.image[vertexai ? "vertex" : "gemini"], ...WRITE_FORMATS.audio];
}
var INLINE_LIMIT_BYTES = Object.freeze({ gemini: 1e8, vertex: 256e6 });
var HTTPS_URI_SUPPORT = Object.freeze({ gemini: true, vertex: true });
var UnsupportedFormatError = class extends Error {
  /**
   * @param {string} format - Extension without the dot (or a MIME type)
   * @param {'read'|'write'} direction
   * @param {{ vertexai?: boolean, who?: string }} [opts]
   */
  constructor(format, direction, { vertexai = false, who = "FileAgent" } = {}) {
    const backend = vertexai ? "vertex" : "gemini";
    const shown = format === "" ? "a file with no extension" : format.includes("/") ? `"${format}"` : `".${format}"`;
    let message;
    let supported;
    if (direction === "write") {
      supported = writeFormatsFor(vertexai);
      message = `Cannot write ${shown}. ${who} (${vertexai ? "Vertex" : "Gemini API"}) writes: ${supported.map((f) => "." + f).join(" ")}`;
      if (!vertexai && WRITE_FORMATS.image.vertex.includes(format) && !WRITE_FORMATS.image.gemini.includes(format)) {
        const extra = WRITE_FORMATS.image.vertex.filter((f) => !WRITE_FORMATS.image.gemini.includes(f));
        message += ` The Gemini API writes images as ${WRITE_FORMATS.image.gemini.map((f) => "." + f).join(" ")} only; Vertex also writes ${extra.map((f) => "." + f).join(" ")}.`;
      }
    } else {
      supported = [...READ_FORMATS];
      message = `Cannot read ${shown}. ak-gemini reads: ${supported.join(" ")}`;
    }
    super(message);
    this.name = "UnsupportedFormatError";
    this.format = format;
    this.direction = direction;
    this.supported = supported;
    this.backend = backend;
  }
};
function extOf(nameOrUri) {
  let p = nameOrUri;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(nameOrUri)) {
    try {
      p = new URL(nameOrUri).pathname;
    } catch {
    }
  }
  return (0, import_node_path.extname)(p).toLowerCase();
}
function mimeFromName(nameOrUri) {
  return MIME_TYPES[extOf(nameOrUri)] || null;
}
function baseMime(mime) {
  return String(mime).split(";")[0].trim().toLowerCase();
}
async function uploadFile(client, file, { mimeType, displayName }) {
  return client.files.upload({ file, config: { displayName, mimeType } });
}
async function waitForFileActive(client, file, { intervalMs = 2e3, timeoutMs = 6e4 } = {}) {
  if (file.state === "ACTIVE") return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const updated = await client.files.get({ name: file.name });
    if (updated.state === "ACTIVE") return;
    if (updated.state === "FAILED") {
      throw new Error(`File processing failed: ${file.displayName || file.name}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`File processing timed out after ${timeoutMs / 1e3}s: ${file.displayName || file.name}`);
}
async function classify(input, vertexai) {
  if (typeof input === "string") {
    if (/^gs:\/\//i.test(input) || /^https?:\/\//i.test(input)) return classifyUri(input, void 0, vertexai);
    const path2 = (0, import_node_path.resolve)(input);
    const name = (0, import_node_path.basename)(path2);
    const ext = extOf(path2);
    const st = await (0, import_promises.stat)(path2);
    if (TEXT_EXTENSIONS.has(ext)) {
      return { kind: "text", part: { text: `--- File: ${name} ---
${await (0, import_promises.readFile)(path2, "utf-8")}` } };
    }
    const mimeType = BINARY_MIME_TYPES[ext];
    if (!mimeType) throw new UnsupportedFormatError(ext.replace(/^\./, ""), "read", { vertexai });
    return { kind: "binary", path: path2, name, mimeType, size: st.size };
  }
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    throw new Error("A MIME type is required for raw bytes. Pass { data, mimeType } instead of a bare Buffer.");
  }
  if (input && typeof input === "object") {
    if (typeof input.uri === "string") return classifyUri(input.uri, input.mimeType, vertexai);
    if (input.data !== void 0) {
      if (!input.mimeType) throw new Error("A MIME type is required: pass { data, mimeType }.");
      const mime = baseMime(input.mimeType);
      if (typeof input.data === "string" && !/^[A-Za-z0-9+/_-]*={0,2}$/.test(input.data.replace(/\s+/g, ""))) {
        throw new Error('A string in { data } must be base64. For plain text pass a Buffer (Buffer.from(text)); strip any "data:...;base64," prefix.');
      }
      const buf = typeof input.data === "string" ? Buffer.from(input.data, "base64") : Buffer.from(input.data);
      if (TEXT_MIMES.has(mime) || mime.startsWith("text/")) {
        return { kind: "text", part: { text: `--- File: ${input.name || "data"} ---
${buf.toString("utf-8")}` } };
      }
      if (!BINARY_MIMES.has(mime)) throw new UnsupportedFormatError(mime, "read", { vertexai });
      return { kind: "binary", buffer: buf, name: input.name || "data", mimeType: mime, size: buf.length };
    }
  }
  throw new Error(`Unrecognized file input: ${JSON.stringify(input)?.slice(0, 100)}. Pass a path, a gs:// or https:// URI, { uri, mimeType }, or { data, mimeType }.`);
}
function classifyUri(uri, explicitMime, vertexai) {
  if (/^gs:\/\//i.test(uri) && !vertexai) {
    throw new Error(`gs:// URIs work only on Vertex AI (${uri}). On the Gemini API pass a local path, an https:// URL, or { data, mimeType }.`);
  }
  if (/^https?:\/\//i.test(uri) && !HTTPS_URI_SUPPORT[vertexai ? "vertex" : "gemini"]) {
    throw new Error(`https:// URIs are not accepted as file data on this backend (${uri}).`);
  }
  let mimeType;
  if (explicitMime) {
    mimeType = baseMime(explicitMime);
    if (!BINARY_MIMES.has(mimeType) && !TEXT_MIMES.has(mimeType)) throw new UnsupportedFormatError(mimeType, "read", { vertexai });
  } else {
    mimeType = mimeFromName(uri);
    if (!mimeType) throw new UnsupportedFormatError(extOf(uri).replace(/^\./, ""), "read", { vertexai });
  }
  return { kind: "uri", part: { fileData: { fileUri: uri, mimeType } } };
}
async function toParts(files, client, opts = {}) {
  const {
    vertexai = false,
    alwaysUpload = false,
    inlineBytesUsed = 0,
    withRetry = (fn) => fn(),
    inlineLimit = INLINE_LIMIT_BYTES[vertexai ? "vertex" : "gemini"]
  } = opts;
  const list = files == null ? [] : Array.isArray(files) ? files : [files];
  const items = [];
  for (const input of list) items.push(await classify(input, vertexai));
  const binaries = items.filter((i) => i.kind === "binary");
  if (vertexai) {
    const total = inlineBytesUsed + binaries.reduce((s, b) => s + b.size, 0);
    if (total > inlineLimit) {
      throw new Error(
        `Inline files total ${total} bytes${inlineBytesUsed ? ` (including ${inlineBytesUsed} already in this conversation)` : ""}, over the Vertex inline limit of ${inlineLimit} bytes. Vertex cannot upload files; pass a gs:// URI instead.`
      );
    }
  } else {
    for (const b of binaries) if (alwaysUpload || b.size > inlineLimit) b.upload = true;
    let total = inlineBytesUsed + binaries.filter((b) => !b.upload).reduce((s, b) => s + b.size, 0);
    const remaining = binaries.filter((b) => !b.upload).sort((a, b) => b.size - a.size);
    while (total > inlineLimit && remaining.length) {
      const b = (
        /** @type {any} */
        remaining.shift()
      );
      b.upload = true;
      total -= b.size;
    }
  }
  const parts = [];
  const uploaded = [];
  for (const item of items) {
    if (item.kind !== "binary") {
      parts.push(item.part);
      continue;
    }
    if (item.upload) {
      const source = item.path ?? new Blob([item.buffer], { type: item.mimeType });
      let f;
      try {
        f = await withRetry(() => uploadFile(client, source, { mimeType: item.mimeType, displayName: item.name }));
        await waitForFileActive(client, f);
      } catch (error) {
        error.uploaded = f ? [...uploaded, { name: f.name, uri: f.uri, mimeType: f.mimeType || item.mimeType, displayName: f.displayName || item.name, sizeBytes: f.sizeBytes }] : [...uploaded];
        throw error;
      }
      uploaded.push({ name: f.name, uri: f.uri, mimeType: f.mimeType || item.mimeType, displayName: f.displayName || item.name, sizeBytes: f.sizeBytes });
      parts.push({ fileData: { fileUri: f.uri, mimeType: f.mimeType || item.mimeType } });
    } else {
      const buf = item.buffer ?? await (0, import_promises.readFile)(item.path);
      parts.push({ inlineData: { data: buf.toString("base64"), mimeType: item.mimeType } });
    }
  }
  return { parts, uploaded };
}
function pcmToWav(pcm, { sampleRate, channels = 1, bitsPerSample = 16 }) {
  const blockAlign = channels * bitsPerSample / 8;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function parsePcmMime(mime) {
  const m = String(mime).toLowerCase();
  if (!/^audio\/(l16|pcm)\b/.test(m)) throw new Error(`Unexpected audio MIME type "${mime}"; expected audio/L16 PCM.`);
  const rate = m.match(/rate=(\d+)/);
  if (!rate) throw new Error(`Audio MIME type "${mime}" has no sample rate.`);
  const ch = m.match(/channels=(\d+)/);
  return { sampleRate: Number(rate[1]), channels: ch ? Number(ch[1]) : 1 };
}
function wavToPcm(wav) {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Audio bytes are not a WAV file (missing RIFF/WAVE header).");
  }
  let fmt = null;
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    let size = wav.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      const format = wav.readUInt16LE(body);
      if (format !== 1) throw new Error(`WAV audio format ${format} is not PCM.`);
      fmt = { channels: wav.readUInt16LE(body + 2), sampleRate: wav.readUInt32LE(body + 4), bitsPerSample: wav.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV file has a data chunk before its fmt chunk.");
      if (size > wav.length - body) size = wav.length - body;
      return { pcm: wav.subarray(body, body + size), ...fmt };
    }
    off = body + size + size % 2;
  }
  throw new Error("WAV file has no data chunk.");
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
var EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
var THINKING_LEVEL_ORDER = ["minimal", "low", "medium", "high", "xhigh"];
var LEVELS_LOW_HIGH = ["low", "medium", "high"];
var LEVELS_LOW_XHIGH = ["low", "medium", "high", "xhigh"];
var LEVELS_MINIMAL_HIGH = ["minimal", "low", "medium", "high"];
var THINKING_CAPABILITIES = [
  { pattern: /^gemini-4-(neon|hydrogen)$/, levels: LEVELS_LOW_XHIGH, budget: false },
  { pattern: /^gemini-4-(carbon|argon)$/, levels: LEVELS_LOW_HIGH, budget: false },
  { pattern: /^gemini-3\.[78]-flash$/, levels: LEVELS_LOW_HIGH, budget: true },
  { pattern: /^gemini-3(\.\d+)?-pro(-preview)?$/, levels: LEVELS_LOW_HIGH, budget: true },
  { pattern: /^gemini-3(\.\d+)?-flash(-preview)?$/, levels: LEVELS_MINIMAL_HIGH, budget: true },
  { pattern: /^gemini-3(\.\d+)?-flash-lite(-preview)?$/, levels: LEVELS_MINIMAL_HIGH, budget: true },
  { pattern: /^gemini-2\.5-pro/, levels: null, budget: true },
  { pattern: /^gemini-2\.5-flash(-preview)?$/, levels: null, budget: true },
  { pattern: /^gemini-2\.5-flash-lite(-preview)?$/, levels: null, budget: true },
  { pattern: /^gemini-2\.0-flash$/, levels: null, budget: true }
];
function budgetToThinkingLevel(budget) {
  if (budget < 0) return void 0;
  if (budget === 0) return "minimal";
  if (budget <= 2048) return "low";
  if (budget <= 8192) return "medium";
  return "high";
}
var NO_THINKING_MODELS = /(image|banana|tts|live|transcribe|embedding|omni)/;
var THINKING_SUPPORTED_MODELS = THINKING_CAPABILITIES.map((c) => c.pattern);
function thinkingCapabilities(modelName) {
  return THINKING_CAPABILITIES.find((c) => c.pattern.test(modelName)) || null;
}
function clampThinkingLevel(requested, accepted) {
  if (!accepted) return requested === "max" ? "high" : requested;
  if (requested === "max") return accepted[accepted.length - 1];
  if (accepted.includes(requested) || !THINKING_LEVEL_ORDER.includes(requested)) return requested;
  const idx = THINKING_LEVEL_ORDER.indexOf(requested);
  const lowest = THINKING_LEVEL_ORDER.indexOf(accepted[0]);
  return idx < lowest ? accepted[0] : accepted[accepted.length - 1];
}
var DEFAULT_MODEL = "gemini-3.8-flash";
var DEFAULT_GEMINI_API_VERSION = "v1beta";
var MODEL_PRICING_AS_OF = "2026-11-20";
var TIER_THRESHOLD = 2e5;
var MODEL_PRICING = {
  // Gemini 4 (GA Oct-Nov 2026). Explicit context caching is NOT supported
  // (`caches.create` returns a 400); cachedInput prices implicit cache hits.
  // Carbon/Argon intro is a lower list price on the Gemini API. Vertex bills the
  // full list price and returns 50% as credits, which this table does not model.
  "gemini-4-carbon": {
    input: 4,
    output: 20,
    cachedInput: 0.2,
    intro: { input: 2, output: 10, cachedInput: 0.1, until: "2026-11-30" }
  },
  "gemini-4-argon": {
    input: 4,
    output: 20,
    cachedInput: 0.2,
    intro: { input: 2, output: 10, cachedInput: 0.1, until: "2026-11-30" }
  },
  "gemini-4-neon": { input: 3, output: 15, cachedInput: 0.15 },
  "gemini-4-hydrogen": { input: 1.5, output: 7.5, cachedInput: 0.075 },
  // Gemini 3.x stable
  // 3.8, 3.7 and 3.6 Flash share one rate card, including the promo window that
  // runs through 2026-12-31 before doubling on 2027-01-01.
  "gemini-3.8-flash": {
    input: 1.5,
    output: 7.5,
    cachedInput: 0.15,
    intro: { input: 0.75, output: 3.75, cachedInput: 0.075, until: "2026-12-31" }
  },
  "gemini-3.7-flash": {
    input: 1.5,
    output: 7.5,
    cachedInput: 0.15,
    intro: { input: 0.75, output: 3.75, cachedInput: 0.075, until: "2026-12-31" }
  },
  "gemini-3.6-flash": {
    input: 1.5,
    output: 7.5,
    cachedInput: 0.15,
    intro: { input: 0.75, output: 3.75, cachedInput: 0.075, until: "2026-12-31" }
  },
  "gemini-3.5-flash": { input: 1.5, output: 9, cachedInput: 0.15 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cachedInput: 0.025 },
  "gemini-nano-banana-2.1": { input: 1.5, output: 7.5 },
  // text-only; image-output is $30/M
  "gemini-3.1-flash-image": { input: 0.5, output: 3 },
  // text-only; image-output is $60/M
  "gemini-3.1-flash-lite-image": { input: 0.25, output: 1.5 },
  // text-only; image-output billed separately
  "gemini-3-pro-image": { input: 2, output: 12 },
  // text-only; image-output is $120/M
  // Text-to-speech. input = text input; output = AUDIO output (see NOTES).
  // Read from the live pricing page 2026-11-20.
  "gemini-3.8-flash-tts": {
    input: 1,
    output: 18,
    intro: { input: 0.5, output: 9, until: "2026-12-31" }
  },
  "gemini-3.8-flash-lite-tts": {
    input: 1,
    output: 12,
    intro: { input: 0.5, output: 6, until: "2026-12-31" }
  },
  "gemini-3.1-flash-tts-preview": { input: 1, output: 20 },
  "gemini-2.5-flash-preview-tts": { input: 0.5, output: 10 },
  "gemini-2.5-pro-preview-tts": { input: 1, output: 20 },
  // Gemini 3.x preview
  "gemini-3.1-pro-preview": {
    input: 2,
    output: 12,
    cachedInput: 0.2,
    inputAbove200k: 4,
    outputAbove200k: 18,
    cachedInputAbove200k: 0.4
  },
  "gemini-3-pro-preview": { input: 2, output: 12 },
  // ≤200k tier; launch rate (superseded by 3.1, off the pricing page)
  "gemini-3-flash-preview": { input: 0.5, output: 3, cachedInput: 0.05 },
  "gemini-3.1-flash-lite-preview": { input: 0.25, output: 1.5, cachedInput: 0.025 },
  "gemini-3.1-flash-image-preview": { input: 0.5, output: 3 },
  // text-only; image-output is $60/M
  "gemini-3-pro-image-preview": { input: 2, output: 12 },
  // text-only; image-output is $120/M
  // Gemini 2.5 stable
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cachedInput: 0.01 },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10,
    cachedInput: 0.125,
    inputAbove200k: 2.5,
    outputAbove200k: 15,
    cachedInputAbove200k: 0.25
  },
  "gemini-2.5-flash-image": { input: 0.3, output: 0 },
  // image-output is ~$0.039/image (1290 tokens)
  // Deprecated but kept for back-compat (shut down June 2026)
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.02, output: 0.1 },
  // Embeddings
  "gemini-embedding-001": { input: 0.15, output: 0 },
  "gemini-embedding-2": { input: 0.2, output: 0 },
  // text input; image/audio/video input not modelled
  "gemini-embedding-2-preview": { input: 0.2, output: 0 }
  // reroutes to gemini-embedding-2 since 2026-11-06
};
var MODEL_ALIASES = {
  "gemini-flash-latest": "gemini-3.8-flash",
  "gemini-pro-latest": "gemini-3.1-pro-preview",
  "gemini-flash-lite-latest": "gemini-3.5-flash-lite"
};
function _applyIntroPricing(entry, at) {
  if (!entry?.intro) return entry;
  const now = at === void 0 ? /* @__PURE__ */ new Date() : new Date(at);
  const until = /* @__PURE__ */ new Date(`${entry.intro.until}T23:59:59.999Z`);
  if (Number.isNaN(now.getTime()) || now > until) return entry;
  return {
    ...entry,
    input: entry.intro.input,
    output: entry.intro.output,
    ...entry.intro.cachedInput !== void 0 && { cachedInput: entry.intro.cachedInput },
    introUntil: entry.intro.until
  };
}
function resolvePricing(modelId, opts = {}) {
  const entry = _lookupPricing(modelId);
  if (!entry) return null;
  return { ..._applyIntroPricing(entry, opts.at), tierThreshold: TIER_THRESHOLD, asOf: MODEL_PRICING_AS_OF };
}
function _lookupPricing(modelId) {
  if (!modelId) return null;
  const tryKey = (id) => {
    if (MODEL_PRICING[id]) return MODEL_PRICING[id];
    const alias = MODEL_ALIASES[id];
    if (alias && MODEL_PRICING[alias]) {
      logger_default.debug(`Pricing: alias "${id}" resolved to "${alias}". If Google has rotated this alias the rate may be wrong \u2014 prefer the echoed modelVersion.`);
      return MODEL_PRICING[alias];
    }
    return null;
  };
  let hit = tryKey(modelId);
  if (hit) return hit;
  let stripped = modelId;
  while (true) {
    const next = stripped.replace(/-\d{2,}$/, "");
    if (next === stripped) break;
    stripped = next;
    hit = tryKey(stripped);
    if (hit) return hit;
  }
  return null;
}
function computeCost(modelId, promptTokens, responseTokens, thoughtsTokens = 0, cachedTokens = 0, opts = {}) {
  const pricing = resolvePricing(modelId, { at: opts.at });
  if (!pricing) return null;
  const above = (promptTokens || 0) > TIER_THRESHOLD;
  const inputRate = above && pricing.inputAbove200k || pricing.input;
  const outputRate = above && pricing.outputAbove200k || pricing.output;
  const cachedRate = above ? pricing.cachedInputAbove200k ?? pricing.cachedInput ?? inputRate : pricing.cachedInput ?? inputRate;
  const cached = Math.max(0, Math.min(cachedTokens || 0, promptTokens || 0));
  const billablePrompt = Math.max(0, (promptTokens || 0) - cached);
  return billablePrompt / 1e6 * inputRate + cached / 1e6 * cachedRate + ((responseTokens || 0) + (thoughtsTokens || 0)) / 1e6 * outputRate;
}
var BaseGemini = class {
  /**
   * @param {BaseGeminiOptions} [options={}]
   */
  constructor(options = {}) {
    this.modelName = options.modelName || DEFAULT_MODEL;
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
    this.apiVersion = options.apiVersion || (!this.vertexai && !process.env.GOOGLE_GENAI_API_VERSION ? DEFAULT_GEMINI_API_VERSION : void 0);
    this.resourceExhaustedRetries = options.resourceExhaustedRetries ?? 5;
    this.resourceExhaustedDelay = options.resourceExhaustedDelay ?? 1e3;
    this.healthCheck = options.healthCheck ?? false;
    this._configureLogLevel(options.logLevel);
    this.labels = options.labels || {};
    this.enableGrounding = options.enableGrounding || false;
    this.groundingConfig = options.groundingConfig || {};
    this.cachedContent = options.cachedContent || null;
    this.serviceTier = options.serviceTier || null;
    this.includeServerSideToolInvocations = options.includeServerSideToolInvocations ?? false;
    this.store = options.store;
    this.chatConfig = {
      temperature: 0.7,
      topP: 0.95,
      topK: 64,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      ...options.chatConfig
    };
    if (this.serviceTier) this.chatConfig["serviceTier"] = this.serviceTier;
    if (this.includeServerSideToolInvocations) this.chatConfig["includeServerSideToolInvocations"] = true;
    if (typeof this.store === "boolean") {
      if (this.vertexai) logger_default.warn("`store` is a Gemini API option; ignored on Vertex AI.");
      else this.chatConfig["store"] = this.store;
    }
    for (const key of ["temperature", "topP", "topK"]) {
      if (options[key] !== void 0) this.chatConfig[key] = options[key];
    }
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
    this.effort = this._normalizeEffort(options.effort);
    this._configureThinking(options.thinkingConfig);
    this.genAIClient = null;
    if (!this.vertexai || this.project) this._createClient();
    this.chatSession = null;
    this.lastResponseMetadata = null;
    this.exampleCount = 0;
    this._cumulativeUsage = {
      promptTokens: 0,
      responseTokens: 0,
      thoughtsTokens: 0,
      cachedTokens: 0,
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
    await this._ensureClient();
    logger_default.debug(`Initializing ${this.constructor.name} chat session with model: ${this.modelName}...`);
    const chatOptions = this._getChatCreateOptions();
    this.chatSession = /** @type {GoogleGenAI} */
    this.genAIClient.chats.create(chatOptions);
    await this._healthCheckPing();
    logger_default.debug(`${this.constructor.name}: Chat session initialized.`);
  }
  /**
   * Builds the GoogleGenAI client from resolved auth options.
   * @private
   */
  _createClient() {
    const clientOptions = this.vertexai ? {
      vertexai: true,
      project: this.project,
      ...this.location && { location: this.location },
      ...this.googleAuthOptions && { googleAuthOptions: this.googleAuthOptions }
    } : { apiKey: this.apiKey };
    if (this.apiVersion) clientOptions.apiVersion = this.apiVersion;
    this.genAIClient = new import_genai.GoogleGenAI(clientOptions);
  }
  /**
   * Ensures `genAIClient` exists. On Vertex with no project configured, discovers
   * the project from Application Default Credentials first — inside GCP that is
   * the metadata server, so a Cloud Run / GKE / GCE service needs no env vars.
   * Every method that calls the API awaits this.
   * @returns {Promise<GoogleGenAI>}
   * @protected
   */
  async _ensureClient() {
    if (this.genAIClient) return this.genAIClient;
    if (!this._projectPromise) {
      this._projectPromise = this._discoverProject().then((p) => {
        if (!p) throw new Error("ADC returned no project id");
        return p;
      }).catch((e) => {
        this._projectPromise = null;
        throw new Error(`Vertex AI requires a project ID and none could be found. Provide options.project or GOOGLE_CLOUD_PROJECT, or run where Application Default Credentials expose one. Cause: ${e.message}`);
      });
    }
    const project = await this._projectPromise;
    if (!this.genAIClient) {
      this.project = project;
      logger_default.debug(`Vertex AI project resolved from Application Default Credentials: ${project}`);
      this._createClient();
    }
    return (
      /** @type {GoogleGenAI} */
      this.genAIClient
    );
  }
  /**
   * Asks google-auth-library for the ADC project: GOOGLE_CLOUD_PROJECT-style env
   * vars, the credentials file, gcloud config, then the GCE/Cloud Run metadata server.
   * @returns {Promise<string>}
   * @protected
   */
  async _discoverProject() {
    const auth = new import_google_auth_library.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      ...this.googleAuthOptions || {}
    });
    return auth.getProjectId();
  }
  /**
   * Opt-in connectivity check via `models.list()` — runs only when
   * `healthCheck: true`. Fails fast (no exponential backoff): a readiness probe
   * should surface a bad config immediately, not after ~30s of 429 retries.
   * @returns {Promise<void>}
   * @protected
   */
  async _healthCheckPing() {
    await this._ensureClient();
    if (!this.healthCheck) return;
    try {
      await this.genAIClient.models.list();
      logger_default.debug(`${this.constructor.name}: API connection successful.`);
    } catch (e) {
      throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
    }
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
    if (this.cachedContent) delete opts.config.systemInstruction;
    if (this.enableGrounding) {
      const existingTools = opts.config.tools || [];
      opts.config.tools = [...existingTools, { googleSearch: this.groundingConfig }];
      logger_default.debug("Search grounding ENABLED (WARNING: costs $35/1k queries)");
    }
    return opts;
  }
  /**
   * Builds the `config` for a per-message `chatSession.sendMessage()` /
   * `sendMessageStream()` call.
   *
   * `@google/genai` resolves it as `config: params.config ?? this.config` —
   * a per-message config REPLACES the create-time session config rather than
   * merging with it. So anything passed per-message must carry the full
   * create-time config forward, or `systemInstruction`, `responseSchema`,
   * `responseMimeType`, `maxOutputTokens`, `thinkingConfig`, `tools` and
   * `cachedContent` are all silently dropped for that request.
   *
   * Returns `undefined` when there is nothing to override, so the call site
   * can omit `config` entirely and let the SDK fall through to the session
   * config it already holds.
   *
   * @param {Record<string, string>} [perMessageLabels] - Per-message billing labels (Vertex only)
   * @returns {Object|undefined}
   * @protected
   */
  _getSendConfig(perMessageLabels) {
    const hasOverride = this.vertexai && perMessageLabels && Object.keys(perMessageLabels).length > 0;
    if (!hasOverride) return void 0;
    const config = { ...this._getChatCreateOptions().config };
    config.labels = { ...config.labels || {}, ...perMessageLabels };
    return config;
  }
  /**
   * Builds the user turn for a send: the text prompt followed by resolved
   * `files`. With no files it returns the text unchanged (a string), so 3.0.0
   * calls send exactly what they sent before.
   *
   * Stateful (chat-session) classes pass `{ stateful: true }`: on the Gemini API
   * every binary uploads, so history keeps a small fileData URI instead of
   * re-sending inline bytes each turn; on Vertex (no uploads) bytes already in
   * history count toward the inline limit.
   *
   * Records the uploads as `this._lastUploadedFiles` (surfaced as
   * `getLastUsage().files`).
   *
   * @param {string} text
   * @param {any} [files] - One file input or an array
   * @param {{ stateful?: boolean }} [opts]
   * @returns {Promise<{ message: string|any[], uploaded: Array<Object> }>}
   * @protected
   */
  async _buildUserParts(text, files, { stateful = false } = {}) {
    const list = files == null ? [] : Array.isArray(files) ? files : [files];
    if (list.length === 0) {
      this._lastUploadedFiles = [];
      return { message: text, uploaded: [] };
    }
    const client = await this._ensureClient();
    const { parts, uploaded } = await toParts(list, client, {
      vertexai: this.vertexai,
      alwaysUpload: stateful,
      inlineBytesUsed: stateful && this.vertexai ? this._inlineBytesInHistory() : 0,
      withRetry: (fn) => this._withRetry(fn)
    });
    this._lastUploadedFiles = uploaded;
    return { message: [{ text }, ...parts], uploaded };
  }
  /**
   * Decoded byte count of every inlineData part in the chat history.
   * @returns {number}
   * @protected
   */
  _inlineBytesInHistory() {
    const history = this.chatSession?.getHistory?.() ?? [];
    let total = 0;
    for (const turn of history) {
      for (const part of turn?.parts ?? []) {
        const data = part?.inlineData?.data;
        if (data) total += Math.floor(data.length * 3 / 4);
      }
    }
    return total;
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
    if (!this.genAIClient) throw new Error(`${this.constructor.name}: client not ready. Call init() first.`);
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
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0, attempts: 0 };
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
   * @param {'json'|'text'} [opts.format='json'] - Model-turn format: 'json' wraps answers in a {data} envelope (Transformer protocol); 'text' stores ANSWER verbatim (prose agents like Chat)
   * @returns {Promise<Array>} The updated chat history
   */
  async seed(examples, opts = {}) {
    await this._ensureClient();
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
    const format = opts.format || "json";
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
      let modelText;
      if (format === "text") {
        modelText = isJSON(answerValue) ? JSON.stringify(answerValue, null, 2) : String(answerValue || "");
        if (explanationValue) logger_default.warn("seed(): EXPLANATION has no representation in text format; ignored.");
      } else {
        if (answerValue) modelResponse.data = answerValue;
        if (explanationValue) modelResponse.explanation = explanationValue;
        modelText = JSON.stringify(modelResponse, null, 2);
      }
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
    const modelStatus = response?.modelStatus || null;
    const promptTokens = response.usageMetadata?.promptTokenCount || 0;
    const responseTokens = response.usageMetadata?.candidatesTokenCount || 0;
    const thoughtsTokens = response.usageMetadata?.thoughtsTokenCount || 0;
    const cachedTokens = response.usageMetadata?.cachedContentTokenCount || 0;
    this.lastResponseMetadata = {
      modelVersion: response.modelVersion || null,
      requestedModel: this.modelName,
      promptTokens,
      responseTokens,
      thoughtsTokens,
      cachedTokens,
      // totalTokenCount includes thoughts; fall back to summing the parts.
      totalTokens: response.usageMetadata?.totalTokenCount || promptTokens + responseTokens + thoughtsTokens,
      timestamp: Date.now(),
      groundingMetadata: response.candidates?.[0]?.groundingMetadata || null,
      modelStatus,
      trafficType: response.usageMetadata?.trafficType || null
    };
    if (modelStatus === "DEPRECATED" && !this._deprecationWarned) {
      logger_default.warn(`Model "${this.modelName}" is marked DEPRECATED by Google. Plan migration.`);
      this._deprecationWarned = true;
    }
  }
  /**
   * Zeroes the cumulative usage counters. Call once at the start of any method
   * that makes one or more API round-trips, before the first `_accumulateUsage()`.
   * @protected
   */
  _resetUsage() {
    this._cumulativeUsage = {
      promptTokens: 0,
      responseTokens: 0,
      thoughtsTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      attempts: 0
    };
  }
  /**
   * Captures metadata from `response` and ADDS its token counts to the running
   * cumulative total. Call once per API round-trip.
   *
   * Multi-round methods (agent tool loops, Transformer retries) make several
   * calls per turn; assigning from the final response only — as the tool loops
   * used to — reports the last round and undercounts the turn several-fold,
   * because `promptTokens` grows with the accumulated history so the final
   * round looks plausibly large on its own.
   *
   * `attempts` becomes the number of API round-trips in the turn.
   *
   * @param {Object} response - A single API response (or a stream's final chunk)
   * @protected
   */
  _accumulateUsage(response) {
    this._captureMetadata(response);
    if (!this._cumulativeUsage) this._resetUsage();
    const meta = this.lastResponseMetadata;
    const cumulative = this._cumulativeUsage;
    cumulative.promptTokens += meta.promptTokens || 0;
    cumulative.responseTokens += meta.responseTokens || 0;
    cumulative.thoughtsTokens += meta.thoughtsTokens || 0;
    cumulative.cachedTokens += meta.cachedTokens || 0;
    cumulative.totalTokens += meta.totalTokens || 0;
    cumulative.attempts += 1;
  }
  /**
   * Creates a per-round usage accumulator for a streamed response.
   *
   * `stream()` used to yield `usage: this.getLastUsage()` without ever reading
   * `usageMetadata` off the stream — so the `done` event carried `null` on a
   * fresh instance, or stale numbers from an unrelated earlier call on a reused
   * one. `@google/genai` emits `usageMetadata` on stream chunks holding the
   * running totals for that round, so the LAST chunk carrying it has the round's
   * final counts. Grounding metadata can arrive on any chunk.
   *
   * Call `track(chunk)` for every chunk, then `commit()` once the round's stream
   * is exhausted.
   *
   * @returns {{ track: (chunk: any) => void, commit: () => void }}
   * @protected
   */
  _streamUsage() {
    let usageChunk = null;
    let groundingMetadata = null;
    return {
      track: (chunk) => {
        if (chunk?.usageMetadata) usageChunk = chunk;
        const grounding = chunk?.candidates?.[0]?.groundingMetadata;
        if (grounding) groundingMetadata = grounding;
      },
      commit: () => {
        if (!usageChunk) return;
        this._accumulateUsage(groundingMetadata ? { ...usageChunk, candidates: [{ groundingMetadata }] } : usageChunk);
      }
    };
  }
  /**
   * Extracts the user-visible text parts of a stream chunk.
   *
   * Reads EVERY part, not just `parts[0]` — a chunk can split text across parts,
   * or carry a thought summary followed by answer text, and indexing `[0]`
   * silently truncates the rest. `thought` parts are skipped: thought summaries
   * must not be concatenated into the answer.
   *
   * @param {any} chunk
   * @returns {string[]}
   * @protected
   */
  _chunkTextParts(chunk) {
    const parts = chunk?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return [];
    return parts.filter((p) => p?.text && !p.thought).map((p) => p.text);
  }
  /**
   * Returns structured usage data from the last API call for billing verification.
   * Includes CUMULATIVE token counts across all retry attempts.
   * @returns {UsageData|null} Usage data or null if no API call has been made.
   */
  getLastUsage() {
    if (!this.lastResponseMetadata) return null;
    const meta = this.lastResponseMetadata;
    const cumulative = this._cumulativeUsage || { promptTokens: 0, responseTokens: 0, totalTokens: 0, thoughtsTokens: 0, cachedTokens: 0, attempts: 1 };
    const useCumulative = cumulative.attempts > 0;
    const promptTokens = useCumulative ? cumulative.promptTokens : meta.promptTokens;
    const responseTokens = useCumulative ? cumulative.responseTokens : meta.responseTokens;
    const thoughtsTokens = useCumulative ? cumulative.thoughtsTokens || 0 : meta.thoughtsTokens || 0;
    const totalTokens = useCumulative ? cumulative.totalTokens : meta.totalTokens;
    const cachedTokens = useCumulative && cumulative.cachedTokens !== void 0 ? cumulative.cachedTokens : meta.cachedTokens || 0;
    return {
      promptTokens,
      responseTokens,
      thoughtsTokens,
      cachedTokens,
      totalTokens,
      attempts: useCumulative ? cumulative.attempts : 1,
      modelVersion: meta.modelVersion,
      requestedModel: meta.requestedModel,
      timestamp: meta.timestamp,
      groundingMetadata: meta.groundingMetadata || null,
      modelStatus: meta.modelStatus || null,
      trafficType: meta.trafficType || null,
      estimatedCost: this._estimatedCost(meta.modelVersion, promptTokens, responseTokens, thoughtsTokens, cachedTokens),
      files: this._lastUploadedFiles || []
    };
  }
  /**
   * Estimated USD cost, preferring the model id the API echoed (`modelVersion`)
   * and falling back to the requested model when that build isn't priced.
   * @param {string|null|undefined} modelVersion
   * @param {number} promptTokens
   * @param {number} responseTokens
   * @param {number} [thoughtsTokens=0]
   * @param {number} [cachedTokens=0] - Cached-content tokens (a SUBSET of promptTokens)
   * @param {string} [fallbackModel] - Model to price when modelVersion is unpriced (default: this.modelName)
   * @returns {number|null}
   * @protected
   */
  _estimatedCost(modelVersion, promptTokens, responseTokens, thoughtsTokens = 0, cachedTokens = 0, fallbackModel = this.modelName) {
    return computeCost(modelVersion, promptTokens, responseTokens, thoughtsTokens, cachedTokens) ?? computeCost(fallbackModel, promptTokens, responseTokens, thoughtsTokens, cachedTokens);
  }
  /**
   * Builds a usage object directly from a single API response, WITHOUT reading
   * mutable instance state (`lastResponseMetadata`/`_cumulativeUsage`). Safe to
   * call under concurrent send() calls on a shared instance — unlike
   * getLastUsage(), which reflects whichever call most recently mutated the
   * instance and can cross-talk between concurrent sends.
   * @param {Object} response - A single generateContent() response
   * @param {number} [attempts=1] - Attempts this call consumed
   * @param {string} [modelName] - Model this call targeted (default: this.modelName). FileAgent passes its image/speech model.
   * @returns {UsageData}
   * @protected
   */
  _usageFromResponse(response, attempts = 1, modelName = this.modelName) {
    const promptTokens = response?.usageMetadata?.promptTokenCount || 0;
    const responseTokens = response?.usageMetadata?.candidatesTokenCount || 0;
    const thoughtsTokens = response?.usageMetadata?.thoughtsTokenCount || 0;
    const cachedTokens = response?.usageMetadata?.cachedContentTokenCount || 0;
    const totalTokens = response?.usageMetadata?.totalTokenCount || promptTokens + responseTokens + thoughtsTokens;
    const modelVersion = response?.modelVersion || null;
    return {
      promptTokens,
      responseTokens,
      thoughtsTokens,
      cachedTokens,
      totalTokens,
      attempts,
      modelVersion,
      requestedModel: modelName,
      model: modelName,
      timestamp: Date.now(),
      groundingMetadata: response?.candidates?.[0]?.groundingMetadata || null,
      modelStatus: response?.modelStatus || null,
      trafficType: response?.usageMetadata?.trafficType || null,
      estimatedCost: this._estimatedCost(modelVersion, promptTokens, responseTokens, thoughtsTokens, cachedTokens, modelName)
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
    const client = await this._ensureClient();
    const resp = await this._withRetry(() => client.models.countTokens({
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
    const pricing = resolvePricing(this.modelName);
    return {
      inputTokens: tokenInfo.inputTokens,
      model: this.modelName,
      pricing,
      estimatedInputCost: pricing ? tokenInfo.inputTokens / 1e6 * pricing.input : null,
      note: pricing ? "Cost is for input tokens only; output cost depends on response length" : `No pricing known for model "${this.modelName}"; estimatedInputCost is null`
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
    const client = await this._ensureClient();
    const cached = await this._withRetry(() => client.caches.create({
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
    const client = await this._ensureClient();
    return await this._withRetry(() => client.caches.get({ name: cacheName }));
  }
  /**
   * Lists all cached content resources.
   * @returns {Promise<Object>} Pager of cached content resources
   */
  async listCaches() {
    const client = await this._ensureClient();
    const pager = await this._withRetry(() => client.caches.list());
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
    const client = await this._ensureClient();
    return await this._withRetry(() => client.caches.update({
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
    const client = await this._ensureClient();
    await this._withRetry(() => client.caches.delete({ name: cacheName }));
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
    if (thinkingConfig === void 0 && this.effort === null) return;
    if (thinkingConfig === null) {
      delete this.chatConfig.thinkingConfig;
      logger_default.debug(`thinkingConfig set to null - removed from configuration`);
      return;
    }
    const caps = thinkingCapabilities(this.modelName);
    if (!caps && NO_THINKING_MODELS.test(this.modelName)) {
      logger_default.warn(`Model ${this.modelName} does not support thinking features. Ignoring thinkingConfig/effort.`);
      return;
    }
    if (!caps) {
      logger_default.debug(`Model ${this.modelName} is not in THINKING_CAPABILITIES; sending thinking config unchanged.`);
    }
    const base = caps && !caps.budget ? {} : DEFAULT_THINKING_CONFIG;
    const config = { ...base, ...thinkingConfig || {} };
    if (this.effort !== null) {
      if (caps && !caps.levels) {
        logger_default.warn(`Model ${this.modelName} has no thinkingLevel; ignoring effort '${this.effort}'. Use thinkingConfig.thinkingBudget instead.`);
      } else {
        config.thinkingLevel = this.effort;
      }
    }
    if (caps && !caps.budget && config.thinkingBudget !== void 0) {
      if (config.thinkingLevel === void 0) {
        const translated = budgetToThinkingLevel(config.thinkingBudget);
        if (translated) config.thinkingLevel = translated;
        logger_default.debug(`Model ${this.modelName} does not accept thinkingBudget; translated ${config.thinkingBudget} to thinkingLevel '${translated ?? "(model default)"}'.`);
      }
      delete config.thinkingBudget;
    }
    if (config.thinkingLevel !== void 0) {
      const requested = String(config.thinkingLevel).toLowerCase();
      const level = clampThinkingLevel(requested, caps ? caps.levels : null);
      if (level !== requested) {
        logger_default.debug(`Thinking level '${requested}' is not accepted by ${this.modelName}; using '${level}'.`);
        config.thinkingLevel = level;
      }
      delete config.thinkingBudget;
    }
    this.chatConfig.thinkingConfig = config;
    logger_default.debug(`Thinking config applied: ${JSON.stringify(config)}`);
  }
  /**
   * Validates the cross-package `effort` option.
   * Throws rather than warns: this runs in the constructor before log levels are
   * finalized, so a warning could be swallowed.
   * @param {string|null|undefined} effort
   * @returns {'minimal'|'low'|'medium'|'high'|'xhigh'|'max'|null}
   * @protected
   */
  _normalizeEffort(effort) {
    if (effort === void 0 || effort === null) return null;
    const level = String(effort).toLowerCase();
    if (!EFFORT_LEVELS.includes(level)) {
      throw new Error(`Invalid effort "${effort}". Expected one of: ${EFFORT_LEVELS.join(", ")}.`);
    }
    return (
      /** @type {any} */
      level
    );
  }
};
var base_default = BaseGemini;

// transformer.js
var import_promises2 = __toESM(require("fs/promises"), 1);
var import_path = __toESM(require("path"), 1);
var DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON).

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.
`;
var EXTRACTION_RETRY_NUDGE = `Your previous response could not be parsed as JSON. Respond with a single valid JSON object and NOTHING else \u2014 no prose, no explanations, no markdown code fences.`;
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
          const raw = await import_promises2.default.readFile(filePath, "utf-8");
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
      systemPromptKey: this.systemPromptKey,
      format: "json"
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
    const originalPayload = this._preparePayload(payload);
    let firstMessage;
    try {
      ({ message: firstMessage } = await this._buildUserParts(originalPayload, opts.files, { stateful: true }));
    } catch (error) {
      if (opts._restoreGrounding) await opts._restoreGrounding();
      throw error;
    }
    const historyLenBefore = this.chatSession.getHistory(true)?.length ?? 0;
    const messageOptions = {};
    if (opts.labels) messageOptions.labels = opts.labels;
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0, attempts: 0 };
    let lastError = null;
    let lastModelOutput = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        let transformedPayload;
        if (attempt === 0) {
          transformedPayload = await this._rawSendMessage(firstMessage, messageOptions);
        } else if (lastModelOutput !== null) {
          transformedPayload = await this.rebuild(lastModelOutput, lastError.message, messageOptions);
        } else {
          const retryText = `${originalPayload}

${EXTRACTION_RETRY_NUDGE}`;
          const filesInHistory = (this.chatSession.getHistory(true)?.length ?? 0) > historyLenBefore;
          transformedPayload = await this._rawSendMessage(
            Array.isArray(firstMessage) && !filesInHistory ? [{ text: retryText }, ...firstMessage.slice(1)] : retryText,
            messageOptions
          );
        }
        if (this.lastResponseMetadata) {
          this._cumulativeUsage.promptTokens += this.lastResponseMetadata.promptTokens || 0;
          this._cumulativeUsage.responseTokens += this.lastResponseMetadata.responseTokens || 0;
          this._cumulativeUsage.thoughtsTokens += this.lastResponseMetadata.thoughtsTokens || 0;
          this._cumulativeUsage.cachedTokens += this.lastResponseMetadata.cachedTokens || 0;
          this._cumulativeUsage.totalTokens += this.lastResponseMetadata.totalTokens || 0;
          this._cumulativeUsage.attempts = attempt + 1;
        }
        if (validator) {
          try {
            await validator(transformedPayload);
          } catch (validationError) {
            validationError._akValidationPayload = transformedPayload;
            throw validationError;
          }
        }
        logger_default.debug(`Transformation succeeded on attempt ${attempt + 1}`);
        if (opts._restoreGrounding) await opts._restoreGrounding();
        return transformedPayload;
      } catch (error) {
        lastError = error;
        lastModelOutput = "_akValidationPayload" in error ? error._akValidationPayload : null;
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
    const { message } = await this._buildUserParts(actualPayload, messageOptions.files, { stateful: true });
    return this._rawSendMessage(message, messageOptions);
  }
  /**
   * Sends an already-built user turn (string or Part[]) and parses the JSON
   * response. Shared by rawSend() and send(), which resolves `files` once,
   * before its retry loop, so a format error is not retried.
   *
   * @param {string|Array<Object>} message
   * @param {Object} [messageOptions={}]
   * @returns {Promise<Object>}
   * @private
   */
  async _rawSendMessage(message, messageOptions = {}) {
    try {
      const sendParams = { message };
      const config = this._getSendConfig(messageOptions.labels);
      if (config) sendParams.config = config;
      const result = await this._withRetry(() => this.chatSession.sendMessage(sendParams));
      this._captureMetadata(result);
      if (result.usageMetadata && logger_default.level !== "silent") {
        logger_default.debug(`API response: model=${result.modelVersion || "unknown"}, tokens=${result.usageMetadata.totalTokenCount}`);
      }
      return this._parseModelResponse(result);
    } catch (error) {
      if (this.onlyJSON && error.message.includes("Could not extract valid JSON")) {
        throw new Error(`Invalid JSON response from Gemini: ${error.message}`);
      }
      throw new Error(`Transformation failed: ${error.message}`);
    }
  }
  // ── Response Parsing ─────────────────────────────────────────────────────
  /**
   * Turns a raw API response into the transformed payload.
   *
   * Shared by `rawSend()` and `rebuild()` so both apply the SAME two steps:
   * `extractJSON()` (handles markdown fences, prose preambles and truncation
   * recovery, where bare `JSON.parse` throws) and the `{data: …}` unwrap that
   * seeded Transformers need — `seed()` always uses `format: 'json'`, which
   * trains the model to answer in that envelope. `rebuild()` used to do neither,
   * so a repair either threw on a fenced response or returned `{data: payload}`
   * where attempt 0 returned `payload`.
   *
   * @param {Object} result - Raw API response
   * @returns {Object} The transformed payload
   * @protected
   */
  _parseModelResponse(result) {
    const extracted = extractJSON(result?.text);
    return extracted?.data ? extracted.data : extracted;
  }
  // ── Rebuild ──────────────────────────────────────────────────────────────
  /**
   * Asks the model to fix a payload that failed validation.
   *
   * @param {Object} lastPayload - The payload that failed
   * @param {string} serverError - The error message
   * @param {Object} [messageOptions={}] - Per-message options (e.g., labels)
   * @returns {Promise<Object>} Corrected payload
   */
  async rebuild(lastPayload, serverError, messageOptions = {}) {
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
      const sendConfig = this._getSendConfig(messageOptions.labels);
      result = await this._withRetry(() => this.chatSession.sendMessage({
        message: prompt,
        ...sendConfig && { config: sendConfig }
      }));
      this._captureMetadata(result);
    } catch (err) {
      throw new Error(`Gemini call failed while repairing payload: ${err.message}`);
    }
    try {
      return this._parseModelResponse(result);
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
    const { message: userMessage } = await this._buildUserParts(payloadStr, opts.files);
    contents.push({ role: "user", parts: typeof userMessage === "string" ? [{ text: userMessage }] : userMessage });
    const mergedLabels = { ...this.labels, ...opts.labels || {} };
    this._resetUsage();
    const result = await this._withRetry(async () => (await this._ensureClient()).models.generateContent({
      model: this.modelName,
      contents,
      config: {
        ...this._getChatCreateOptions().config,
        ...this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels }
      }
    }));
    this._accumulateUsage(result);
    let transformedPayload = this._parseModelResponse(result);
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
    this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0, attempts: 0 };
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
   * Seeds the conversation with example pairs stored as plain prose turns.
   * Chat is a prose agent — model turns are stored verbatim, not wrapped in
   * Transformer's {data} JSON envelope.
   *
   * @param {import('./types').TransformationExample[]} [examples]
   * @param {import('./types').SeedOptions} [opts={}]
   * @returns {Promise<Array>} The updated chat history
   */
  async seed(examples, opts = {}) {
    return super.seed(examples, { format: "text", ...opts });
  }
  /**
   * Send a text message and get a response. Adds to conversation history.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @param {Record<string, string>} [opts.labels] - Per-message billing labels
   * @param {import('./types').FileInput|import('./types').FileInput[]} [opts.files] - Files sent after the message (strict)
   * @returns {Promise<ChatResponse>} Response with text and usage data
   */
  async send(message, opts = {}) {
    if (!this.chatSession) await this.init();
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    const sendParams = { message: userMessage };
    const config = this._getSendConfig(opts.labels);
    if (config) sendParams.config = config;
    this._resetUsage();
    const result = await this._withRetry(() => this.chatSession.sendMessage(sendParams));
    this._accumulateUsage(result);
    return {
      text: result.text || "",
      usage: this.getLastUsage()
    };
  }
  /**
   * Send a message and stream the response as events.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @yields {ChatStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this.chatSession) await this.init();
    let fullText = "";
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    const sendParams = { message: userMessage };
    const config = this._getSendConfig(opts.labels);
    if (config) sendParams.config = config;
    this._resetUsage();
    const usage = this._streamUsage();
    const streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream(sendParams));
    for await (const chunk of streamResponse) {
      usage.track(chunk);
      for (const text of this._chunkTextParts(chunk)) {
        fullText += text;
        yield { type: "text", text };
      }
    }
    usage.commit();
    yield {
      type: "done",
      fullText,
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
    } else if (options.responseSchema) {
      this.chatConfig.responseMimeType = "application/json";
      logger_default.debug("responseSchema set without responseMimeType \u2014 defaulting responseMimeType to 'application/json'.");
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
    await this._healthCheckPing();
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
   * @param {import('./types').FileInput|import('./types').FileInput[]} [opts.files] - Files sent after the message (strict)
   * @returns {Promise<MessageResponse>} Response with text, optional data, and usage
   */
  async send(payload, opts = {}) {
    if (!this._initialized) await this.init();
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const { message: userMessage, uploaded } = await this._buildUserParts(payloadStr, opts.files);
    const contents = [{ role: "user", parts: typeof userMessage === "string" ? [{ text: userMessage }] : userMessage }];
    const mergedLabels = { ...this.labels, ...opts.labels || {} };
    const result = await this._withRetry(async () => (await this._ensureClient()).models.generateContent({
      model: this.modelName,
      contents,
      config: {
        ...this._getChatCreateOptions().config,
        ...this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels }
      }
    }));
    const usage = { ...this._usageFromResponse(result), files: uploaded };
    this._captureMetadata(result);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      thoughtsTokens: this.lastResponseMetadata.thoughtsTokens,
      cachedTokens: this.lastResponseMetadata.cachedTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    if (result.usageMetadata && logger_default.level !== "silent") {
      logger_default.debug(`Message response: model=${result.modelVersion || "unknown"}, tokens=${result.usageMetadata.totalTokenCount}`);
    }
    const text = result.text || "";
    const response = {
      text,
      usage
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
async function runWithConcurrency(tasks, concurrency) {
  if (concurrency === Infinity) return Promise.all(tasks.map((t) => t()));
  if (concurrency === 1) {
    const results2 = [];
    for (const t of tasks) results2.push(await t());
    return results2;
  }
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}
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
    this.parallelToolCalls = options.parallelToolCalls ?? true;
    this._concurrency = this.parallelToolCalls === true ? Infinity : this.parallelToolCalls === false ? 1 : this.parallelToolCalls;
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
   * @param {import('./types').FileInput|import('./types').FileInput[]} [opts.files] - Files sent after the message (strict)
   * @returns {Promise<AgentResponse>} Response with text, toolCalls, and usage
   */
  async chat(message, opts = {}) {
    if (!this.chatSession) await this.init();
    this._stopped = false;
    const allToolCalls = [];
    const sendConfig = this._getSendConfig(opts.labels);
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    this._resetUsage();
    let response = await this._withRetry(() => this.chatSession.sendMessage({
      message: userMessage,
      ...sendConfig && { config: sendConfig }
    }));
    this._accumulateUsage(response);
    for (let round = 0; round < this.maxToolRounds; round++) {
      if (this._stopped) break;
      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) break;
      const tasks = functionCalls.map((call) => async () => {
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
              return { id: call.id, name: call.name, args: call.args, result: result2 };
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
        return { id: call.id, name: call.name, args: call.args, result };
      });
      const toolResults = await runWithConcurrency(tasks, this._concurrency);
      for (const r of toolResults) allToolCalls.push({ name: r.name, args: r.args, result: r.result });
      response = await this._withRetry(() => this.chatSession.sendMessage({
        message: toolResults.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        })),
        ...sendConfig && { config: sendConfig }
      }));
      this._accumulateUsage(response);
    }
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
    const sendConfig = this._getSendConfig(opts.labels);
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    this._resetUsage();
    let streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({
      message: userMessage,
      ...sendConfig && { config: sendConfig }
    }));
    for (let round = 0; round < this.maxToolRounds; round++) {
      if (this._stopped) break;
      const functionCalls = [];
      const usage = this._streamUsage();
      for await (const chunk of streamResponse) {
        usage.track(chunk);
        if (chunk.functionCalls) functionCalls.push(...chunk.functionCalls);
        for (const text of this._chunkTextParts(chunk)) {
          fullText += text;
          yield { type: "text", text };
        }
      }
      usage.commit();
      if (functionCalls.length === 0) {
        yield {
          type: "done",
          fullText,
          usage: this.getLastUsage()
        };
        return;
      }
      const toolResults = [];
      if (this._concurrency === 1) {
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
      } else {
        for (const call of functionCalls) {
          yield { type: "tool_call", toolName: call.name, args: call.args };
        }
        const tasks = functionCalls.map((call) => async () => {
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
          return { id: call.id, name: call.name, args: call.args, result };
        });
        const results = await runWithConcurrency(tasks, this._concurrency);
        for (const r of results) {
          allToolCalls.push({ name: r.name, args: r.args, result: r.result });
          yield { type: "tool_result", toolName: r.name, result: r.result };
          toolResults.push({ id: r.id, name: r.name, result: r.result });
        }
      }
      if (this._stopped) break;
      streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({
        message: toolResults.map((r) => ({
          functionResponse: {
            id: r.id,
            name: r.name,
            response: { output: r.result }
          }
        })),
        ...sendConfig && { config: sendConfig }
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
var import_promises3 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var import_node_crypto = require("node:crypto");
var MAX_OUTPUT_CHARS = 5e4;
var MAX_FILE_TREE_LINES = 500;
var IGNORE_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "coverage", ".next", "build", "__pycache__", ".venv"]);
var LANG_CONFIG = {
  javascript: {
    toolDescExecute: "Execute a given piece of JavaScript code in a Node.js child process. Use this when you already have code to run \u2014 e.g., running code from a previous write_code call, re-running a snippet, or executing code the user provided. Use console.log() for output.",
    toolDescWriteAndRun: "Write a fresh solution from scratch and execute it in one step. Use this when you need to figure out the code AND run it \u2014 the autonomous, end-to-end tool for solving problems with code.",
    codeParamDesc: "JavaScript code to execute. Use console.log() for output. Use import syntax (ES modules).",
    codeRules: `- Your code runs in a Node.js child process with access to all built-in modules
- IMPORTANT: Your code runs as an ES module (.mjs). Use import syntax, NOT require():
  - import fs from 'fs';
  - import path from 'path';
  - import { execSync } from 'child_process';
- Use console.log() to produce output \u2014 that's how results are returned to you
- Write efficient scripts that do multiple things per execution when possible
- For parallel async operations, use Promise.all()
- Handle errors in your scripts with try/catch so you get useful error messages
- Top-level await is supported`,
    commentsEnabled: `- Add a JSDoc @fileoverview comment at the top of each script explaining what it does
- Add brief JSDoc @param comments for any functions you define`,
    commentsDisabled: `- Do NOT write any comments in your code \u2014 save tokens. The code should be self-explanatory.`,
    packageLabel: "Available Packages",
    packageIntro: "These npm packages are installed and can be imported",
    bashExamples: "ls, grep, curl, git, npm, cat",
    codeBlockLang: "javascript",
    execToolSummary: "Run a given piece of JavaScript code. Use when you already have code to run \u2014 e.g., from a previous write_code call, re-running a snippet, or executing user-provided code.",
    writeRunToolSummary: "Write a fresh solution from scratch and execute it in one step. The autonomous, end-to-end tool for solving problems with code."
  },
  python: {
    toolDescExecute: "Execute a given piece of Python code in a child process. Use this when you already have code to run \u2014 e.g., running code from a previous write_code call, re-running a snippet, or executing code the user provided. Use print() for output.",
    toolDescWriteAndRun: "Write a fresh Python solution from scratch and execute it in one step. Use this when you need to figure out the code AND run it \u2014 the autonomous, end-to-end tool for solving problems with code.",
    codeParamDesc: "Python code to execute. Use print() for output.",
    codeRules: `- Your code runs in a Python 3 child process
- Use print() to produce output \u2014 that's how results are returned to you
- Use standard Python imports (import os, import json, from pathlib import Path, etc.)
- Write efficient scripts; prefer list comprehensions and built-in functions
- For async operations, use asyncio
- Handle errors with try/except so you get useful error messages
- A virtual environment is active \u2014 you can install packages using run_bash with: pip install <package>
- Installed packages persist across executions in this session`,
    commentsEnabled: `- Add a module-level docstring at the top of each script explaining what it does
- Add brief docstrings for any functions you define`,
    commentsDisabled: `- Do NOT write any comments in your code \u2014 save tokens. The code should be self-explanatory.`,
    packageLabel: "Available Packages",
    packageIntro: "These Python packages are available for import",
    bashExamples: "ls, grep, curl, git, pip, cat",
    codeBlockLang: "python",
    execToolSummary: "Run a given piece of Python code. Use when you already have code to run \u2014 e.g., from a previous write_code call, re-running a snippet, or executing user-provided code.",
    writeRunToolSummary: "Write a fresh Python solution from scratch and execute it in one step. The autonomous, end-to-end tool for solving problems with code."
  }
};
var EXECUTING_TOOLS = /* @__PURE__ */ new Set(["execute_code", "write_and_run_code", "run_bash"]);
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
    this.language = options.language || "javascript";
    this.pythonPath = options.pythonPath || null;
    this.maxRounds = options.maxRounds || 10;
    this.timeout = options.timeout || 3e4;
    this.onBeforeExecution = options.onBeforeExecution || null;
    this.onCodeExecution = options.onCodeExecution || null;
    this.importantFiles = options.importantFiles || [];
    this.writeDir = options.writeDir || (0, import_node_path2.join)(this.workingDirectory, "tmp");
    this.keepArtifacts = options.keepArtifacts ?? false;
    this.comments = options.comments ?? false;
    this.maxRetries = options.maxRetries ?? 3;
    this.skills = options.skills || [];
    this.envOverview = options.envOverview || "";
    this._pythonBinary = null;
    this._venvPath = null;
    this._venvEnv = null;
    this.customTools = (options.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.parametersJsonSchema || t.parameters || t.input_schema || t.inputSchema
    }));
    this.toolExecutor = options.toolExecutor || null;
    if (this.customTools.length > 0 && !this.toolExecutor) {
      throw new Error("CodeAgent: tools provided without a toolExecutor.");
    }
    this._codebaseContext = null;
    this._contextGathered = false;
    this._stopped = false;
    this._activeProcess = null;
    this._userSystemPrompt = options.systemPrompt || "";
    this._allExecutions = [];
    this._skillRegistry = /* @__PURE__ */ new Map();
    this.chatConfig.tools = [this._buildToolDefinitions()];
    this.chatConfig.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    logger_default.debug(`CodeAgent created for directory: ${this.workingDirectory}`);
  }
  // ── Tool Definitions ─────────────────────────────────────────────────────
  /**
   * Build tool definitions in Gemini format.
   * use_skill is only included when skills are registered.
   * @private
   * @returns {{ functionDeclarations: Array<Object> }}
   */
  _buildToolDefinitions() {
    const lang = LANG_CONFIG[this.language] || LANG_CONFIG.javascript;
    const declarations = [
      {
        name: "write_code",
        description: "Output code without executing it. Use this when you want to show, propose, or present code to the user without running it.",
        parametersJsonSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "The code to output." },
            purpose: { type: "string", description: 'A short 2-4 word slug describing the code (e.g., "api-client", "data-parser").' },
            language: { type: "string", description: 'Programming language of the code (default: "javascript").' }
          },
          required: ["code"]
        }
      },
      {
        name: "execute_code",
        description: lang.toolDescExecute,
        parametersJsonSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: lang.codeParamDesc },
            purpose: { type: "string", description: 'A short 2-4 word slug describing what this script does (e.g., "read-config", "parse-logs").' }
          },
          required: ["code"]
        }
      },
      {
        name: "write_and_run_code",
        description: lang.toolDescWriteAndRun,
        parametersJsonSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: lang.codeParamDesc },
            purpose: { type: "string", description: 'A short 2-4 word slug describing what this script does (e.g., "fetch-api-data", "generate-report").' }
          },
          required: ["code"]
        }
      },
      {
        name: "fix_code",
        description: "Fix broken code. Provide the original and fixed versions with an explanation. Optionally execute the fix to verify it works.",
        parametersJsonSchema: {
          type: "object",
          properties: {
            original_code: { type: "string", description: "The original broken code." },
            fixed_code: { type: "string", description: "The corrected code." },
            explanation: { type: "string", description: "Brief explanation of what was wrong and how it was fixed." },
            execute: { type: "boolean", description: "If true, execute the fixed code to verify it works (default: false)." }
          },
          required: ["original_code", "fixed_code"]
        }
      },
      {
        name: "run_bash",
        description: `Execute a shell command in the working directory. Use this for file operations, git commands, installing packages, or any shell task (e.g., ${lang.bashExamples}). Prefer this over execute_code for simple shell operations.`,
        parametersJsonSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "The shell command to execute." },
            purpose: { type: "string", description: 'A short 2-4 word slug describing the command (e.g., "list-files", "install-deps").' }
          },
          required: ["command"]
        }
      }
    ];
    if (this._skillRegistry && this._skillRegistry.size > 0) {
      declarations.push({
        name: "use_skill",
        description: `Load a skill by name to get instructions, templates, or patterns. Available skills: ${[...this._skillRegistry.keys()].join(", ")}`,
        parametersJsonSchema: {
          type: "object",
          properties: {
            skill_name: { type: "string", description: "The name of the skill to load." }
          },
          required: ["skill_name"]
        }
      });
    }
    for (const t of this.customTools) {
      declarations.push({ name: t.name, description: t.description, parametersJsonSchema: t.parametersJsonSchema });
    }
    return { functionDeclarations: declarations };
  }
  // ── Init ─────────────────────────────────────────────────────────────────
  /**
   * Initialize the agent: load skills, gather codebase context, and build system prompt.
   * @param {boolean} [force=false]
   */
  async init(force = false) {
    if (this.chatSession && !force) return;
    if (this.skills.length > 0 && (this._skillRegistry.size === 0 || force)) {
      await this._loadSkills();
    }
    if (this.language === "python" && (!this._pythonBinary || force)) {
      await this._resolvePython();
      await this._setupVenv();
    }
    this.chatConfig.tools = [this._buildToolDefinitions()];
    if (!this._contextGathered || force) {
      await this._gatherCodebaseContext();
    }
    this.chatConfig.systemInstruction = this._buildSystemPrompt();
    await super.init(force);
  }
  // ── Skill Loading ────────────────────────────────────────────────────────
  /**
   * Load skill files into the skill registry.
   * @private
   */
  async _loadSkills() {
    this._skillRegistry.clear();
    for (const filePath of this.skills) {
      try {
        const content = await (0, import_promises3.readFile)(filePath, "utf-8");
        let name = (0, import_node_path2.basename)(filePath).replace(/\.md$/i, "");
        const fmMatch = content.match(/^---\s*\n[\s\S]*?^name:\s*(.+)$/m);
        if (fmMatch) name = fmMatch[1].trim();
        this._skillRegistry.set(name, { name, content, path: filePath });
        logger_default.debug(`Loaded skill: ${name} from ${filePath}`);
      } catch (e) {
        logger_default.warn(`skills: could not load "${filePath}": ${e.message}`);
      }
    }
  }
  // ── Python Resolution ───────────────────────────────────────────────────
  /**
   * Resolve the Python 3 binary path.
   * @private
   */
  async _resolvePython() {
    const tryBinary = (bin) => new Promise((resolve3) => {
      (0, import_node_child_process.execFile)(bin, ["--version"], { timeout: 5e3 }, (err, stdout, stderr) => {
        if (err) return resolve3(null);
        const output = (stdout || "") + (stderr || "");
        if (output.includes("Python 3.")) return resolve3(bin);
        resolve3(null);
      });
    });
    if (this.pythonPath) {
      const result = await tryBinary(this.pythonPath);
      if (result) {
        this._pythonBinary = result;
        return;
      }
      throw new Error(`CodeAgent: pythonPath "${this.pythonPath}" is not a valid Python 3 binary.`);
    }
    const python3 = await tryBinary("python3");
    if (python3) {
      this._pythonBinary = python3;
      return;
    }
    const python = await tryBinary("python");
    if (python) {
      this._pythonBinary = python;
      return;
    }
    throw new Error('CodeAgent: language is "python" but python3 was not found on PATH. Install Python 3 or provide the pythonPath option.');
  }
  /**
   * Create a virtual environment for Python execution.
   * @private
   */
  async _setupVenv() {
    await (0, import_promises3.mkdir)(this.writeDir, { recursive: true });
    this._venvPath = (0, import_node_path2.join)(this.writeDir, ".venv");
    const isWin = process.platform === "win32";
    const venvBin = isWin ? (0, import_node_path2.join)(this._venvPath, "Scripts") : (0, import_node_path2.join)(this._venvPath, "bin");
    const venvPython = (0, import_node_path2.join)(venvBin, isWin ? "python.exe" : "python");
    try {
      await (0, import_promises3.readFile)(venvPython);
    } catch {
      logger_default.debug(`Creating Python venv at ${this._venvPath}`);
      await new Promise((resolve3, reject) => {
        (0, import_node_child_process.execFile)(this._pythonBinary, ["-m", "venv", this._venvPath], {
          timeout: 3e4
        }, (err) => {
          if (err) return reject(new Error(`CodeAgent: failed to create venv: ${err.message}`));
          resolve3();
        });
      });
    }
    const env = Object.assign({}, process.env);
    env.VIRTUAL_ENV = this._venvPath;
    env.PATH = venvBin + (isWin ? ";" : ":") + (process.env.PATH || "");
    this._venvEnv = env;
    this._pythonBinary = venvPython;
    logger_default.debug(`Python venv ready at ${this._venvPath}`);
  }
  // ── Context Gathering ────────────────────────────────────────────────────
  /**
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
    let packages = [];
    if (this.language === "python") {
      try {
        const reqPath = (0, import_node_path2.join)(this.workingDirectory, "requirements.txt");
        const content = await (0, import_promises3.readFile)(reqPath, "utf-8");
        packages = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("-")).map((l) => l.split(/[>=<!\[;\s]/)[0]);
      } catch {
      }
      if (packages.length === 0) {
        try {
          const ppPath = (0, import_node_path2.join)(this.workingDirectory, "pyproject.toml");
          const content = await (0, import_promises3.readFile)(ppPath, "utf-8");
          const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
          if (depMatch) {
            packages = (depMatch[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, "").split(/[>=<!\[;\s]/)[0]);
          }
        } catch {
        }
      }
    } else {
      try {
        const pkgPath = (0, import_node_path2.join)(this.workingDirectory, "package.json");
        const pkg = JSON.parse(await (0, import_promises3.readFile)(pkgPath, "utf-8"));
        packages = [
          ...Object.keys(pkg.dependencies || {}),
          ...Object.keys(pkg.devDependencies || {})
        ];
      } catch {
      }
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
          const fullPath = (0, import_node_path2.isAbsolute)(resolved) ? resolved : (0, import_node_path2.join)(this.workingDirectory, resolved);
          const content = await (0, import_promises3.readFile)(fullPath, "utf-8");
          importantFileContents.push({ path: resolved, content });
        } catch (e) {
          logger_default.warn(`importantFiles: could not read "${resolved}": ${e.message}`);
        }
      }
    }
    this._codebaseContext = { fileTree, npmPackages: packages, packages, importantFileContents };
    this._contextGathered = true;
  }
  /**
   * @private
   */
  _resolveImportantFile(filename, fileTreeLines) {
    if ((0, import_node_path2.isAbsolute)(filename)) return filename;
    const exact = fileTreeLines.find((line) => line === filename);
    if (exact) return exact;
    const partial = fileTreeLines.find(
      (line) => line.endsWith("/" + filename) || line.endsWith(import_node_path2.sep + filename)
    );
    return partial || null;
  }
  /**
   * @private
   */
  async _getFileTreeGit() {
    return new Promise((resolve3, reject) => {
      (0, import_node_child_process.execFile)("git", ["ls-files"], {
        cwd: this.workingDirectory,
        timeout: 5e3,
        maxBuffer: 5 * 1024 * 1024
      }, (err, stdout) => {
        if (err) return reject(err);
        resolve3(stdout.trim());
      });
    });
  }
  /**
   * @private
   */
  async _getFileTreeReaddir(dir, depth, maxDepth) {
    if (depth >= maxDepth) return "";
    const entries = [];
    try {
      const items = await (0, import_promises3.readdir)(dir, { withFileTypes: true });
      for (const item of items) {
        if (IGNORE_DIRS.has(item.name)) continue;
        if (item.name.startsWith(".") && depth === 0 && item.isDirectory()) continue;
        const relativePath = (0, import_node_path2.join)(dir, item.name).replace(this.workingDirectory + "/", "");
        if (item.isFile()) {
          entries.push(relativePath);
        } else if (item.isDirectory()) {
          entries.push(relativePath + "/");
          const subEntries = await this._getFileTreeReaddir((0, import_node_path2.join)(dir, item.name), depth + 1, maxDepth);
          if (subEntries) entries.push(subEntries);
        }
      }
    } catch {
    }
    return entries.join("\n");
  }
  /**
   * @private
   */
  _buildSystemPrompt() {
    const { fileTree, packages, importantFileContents } = this._codebaseContext || { fileTree: "", packages: [], importantFileContents: [] };
    const lang = LANG_CONFIG[this.language] || LANG_CONFIG.javascript;
    let prompt = `You are a coding agent working in ${this.workingDirectory}.

## Available Tools

### write_code
Output code without executing it. Use when showing, proposing, or presenting code to the user.

### execute_code
${lang.execToolSummary}

### write_and_run_code
${lang.writeRunToolSummary}

### fix_code
Fix broken code by providing original and fixed versions. Set execute=true to verify the fix works.

### run_bash
Run shell commands directly (e.g., ${lang.bashExamples}). Prefer this over execute_code for simple shell operations.`;
    if (this._skillRegistry.size > 0) {
      prompt += `

### use_skill
Load a skill by name to get detailed instructions and templates. Available skills: ${[...this._skillRegistry.keys()].join(", ")}`;
    }
    prompt += `

## Code Execution Rules
These rules apply when using execute_code, write_and_run_code, or fix_code (with execute=true):
- Always provide a short descriptive \`purpose\` parameter (2-4 word slug like "read-config")
${lang.codeRules}
- The working directory is: ${this.workingDirectory}`;
    if (this.comments) {
      prompt += `
${lang.commentsEnabled}`;
    } else {
      prompt += `
${lang.commentsDisabled}`;
    }
    if (fileTree) {
      prompt += `

## File Tree
\`\`\`
${fileTree}
\`\`\``;
    }
    if (packages && packages.length > 0) {
      prompt += `

## ${lang.packageLabel}
${lang.packageIntro}: ${packages.join(", ")}`;
    }
    if (importantFileContents && importantFileContents.length > 0) {
      prompt += `

## Key Files`;
      for (const { path: filePath, content } of importantFileContents) {
        prompt += `

### ${filePath}
\`\`\`${lang.codeBlockLang}
${content}
\`\`\``;
      }
    }
    if (this._userSystemPrompt) {
      prompt += `

## Additional Instructions
${this._userSystemPrompt}`;
    }
    if (this.envOverview) {
      prompt += `

## Environment Overview
${this.envOverview}`;
    }
    return prompt;
  }
  // ── Code Execution ───────────────────────────────────────────────────────
  /**
   * @private
   */
  _slugify(purpose) {
    if (!purpose) return (0, import_node_crypto.randomUUID)().slice(0, 8);
    return purpose.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }
  /**
   * @private
   */
  async _executeCode(code, purpose, toolName) {
    if (this._stopped) {
      return { stdout: "", stderr: "Agent was stopped", exitCode: -1 };
    }
    if (this.onBeforeExecution) {
      try {
        const allowed = await this.onBeforeExecution(code, toolName || "execute_code");
        if (allowed === false) {
          return { stdout: "", stderr: "Execution denied by onBeforeExecution callback", exitCode: -1, denied: true };
        }
      } catch (e) {
        logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
      }
    }
    await (0, import_promises3.mkdir)(this.writeDir, { recursive: true });
    const slug = this._slugify(purpose);
    const ext = this.language === "python" ? ".py" : ".mjs";
    const tempFile = (0, import_node_path2.join)(this.writeDir, `agent-${slug}-${Date.now()}${ext}`);
    try {
      await (0, import_promises3.writeFile)(tempFile, code, "utf-8");
      const binary = this.language === "python" ? this._pythonBinary : "node";
      const execEnv = this.language === "python" && this._venvEnv ? this._venvEnv : process.env;
      const result = await new Promise((resolve3) => {
        const child = (0, import_node_child_process.execFile)(binary, [tempFile], {
          cwd: this.workingDirectory,
          timeout: this.timeout,
          env: execEnv,
          maxBuffer: 10 * 1024 * 1024
        }, (err, stdout, stderr) => {
          this._activeProcess = null;
          if (err) {
            resolve3({
              stdout: err.stdout || stdout || "",
              stderr: (err.stderr || stderr || "") + (err.killed ? "\n[EXECUTION TIMED OUT]" : ""),
              exitCode: err.code || 1
            });
          } else {
            resolve3({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
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
        filePath: this.keepArtifacts ? tempFile : null,
        tool: toolName || "execute_code"
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
          await (0, import_promises3.unlink)(tempFile);
        } catch {
        }
      }
    }
  }
  // ── Bash Execution ───────────────────────────────────────────────────────
  /**
   * Execute a bash command in the working directory.
   * @private
   */
  async _executeBash(command, purpose) {
    if (this._stopped) {
      return { stdout: "", stderr: "Agent was stopped", exitCode: -1 };
    }
    if (this.onBeforeExecution) {
      try {
        const allowed = await this.onBeforeExecution(command, "run_bash");
        if (allowed === false) {
          return { stdout: "", stderr: "Execution denied by onBeforeExecution callback", exitCode: -1, denied: true };
        }
      } catch (e) {
        logger_default.warn(`onBeforeExecution callback error: ${e.message}`);
      }
    }
    const execEnv = this.language === "python" && this._venvEnv ? this._venvEnv : process.env;
    const result = await new Promise((resolve3) => {
      const child = (0, import_node_child_process.execFile)("bash", ["-c", command], {
        cwd: this.workingDirectory,
        timeout: this.timeout,
        env: execEnv,
        maxBuffer: 10 * 1024 * 1024
      }, (err, stdout, stderr) => {
        this._activeProcess = null;
        if (err) {
          resolve3({
            stdout: err.stdout || stdout || "",
            stderr: (err.stderr || stderr || "") + (err.killed ? "\n[EXECUTION TIMED OUT]" : ""),
            exitCode: err.code || 1
          });
        } else {
          resolve3({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
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
      code: command,
      purpose: purpose || null,
      output: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      filePath: null,
      tool: "run_bash"
    });
    if (this.onCodeExecution) {
      try {
        this.onCodeExecution(command, result);
      } catch (e) {
        logger_default.warn(`onCodeExecution callback error: ${e.message}`);
      }
    }
    return result;
  }
  /**
   * @private
   */
  _formatOutput(result) {
    let output = "";
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? "\n" : "") + `[STDERR]: ${result.stderr}`;
    if (result.exitCode !== 0) output += (output ? "\n" : "") + `[EXIT CODE]: ${result.exitCode}`;
    return output || "(no output)";
  }
  // ── Tool Call Dispatch ───────────────────────────────────────────────────
  /**
   * Handle a tool call by name, dispatching to the appropriate handler.
   * @private
   * @param {string} name - Tool name
   * @param {Object} input - Tool arguments
   * @returns {Promise<{output: string, type: string, data: Object}>}
   */
  async _handleToolCall(name, input) {
    switch (name) {
      case "execute_code":
      case "write_and_run_code": {
        const result = await this._executeCode(input.code || "", input.purpose, name);
        return {
          output: this._formatOutput(result),
          type: "code_execution",
          data: {
            tool: name,
            code: input.code || "",
            purpose: input.purpose,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            denied: result.denied
          }
        };
      }
      case "write_code": {
        return {
          output: "Code written successfully.",
          type: "write",
          data: {
            tool: "write_code",
            code: input.code || "",
            purpose: input.purpose,
            language: input.language || "javascript"
          }
        };
      }
      case "fix_code": {
        let execResult = null;
        if (input.execute) {
          execResult = await this._executeCode(input.fixed_code || "", "fix", "fix_code");
        }
        return {
          output: input.execute ? this._formatOutput(execResult) : "Fix recorded.",
          type: "fix",
          data: {
            tool: "fix_code",
            originalCode: input.original_code || "",
            fixedCode: input.fixed_code || "",
            explanation: input.explanation,
            executed: !!input.execute,
            stdout: execResult?.stdout,
            stderr: execResult?.stderr,
            exitCode: execResult?.exitCode,
            denied: execResult?.denied
          }
        };
      }
      case "run_bash": {
        const result = await this._executeBash(input.command || "", input.purpose);
        return {
          output: this._formatOutput(result),
          type: "bash",
          data: {
            tool: "run_bash",
            command: input.command || "",
            purpose: input.purpose,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            denied: result.denied
          }
        };
      }
      case "use_skill": {
        const skillName = input.skill_name || "";
        const skill = this._skillRegistry.get(skillName);
        if (!skill) {
          const available = [...this._skillRegistry.keys()].join(", ");
          return {
            output: `Skill "${skillName}" not found. Available skills: ${available || "(none)"}`,
            type: "skill",
            data: { tool: "use_skill", skillName, found: false }
          };
        }
        return {
          output: skill.content,
          type: "skill",
          data: { tool: "use_skill", skillName: skill.name, content: skill.content, found: true }
        };
      }
      default: {
        if (this.toolExecutor) {
          try {
            const result = await this.toolExecutor(name, input);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            return {
              output: resultStr,
              type: "tool",
              data: { tool: name, args: input, result }
            };
          } catch (err) {
            return {
              output: `Tool "${name}" failed: ${err.message}`,
              type: "tool",
              data: { tool: name, args: input, error: err.message }
            };
          }
        }
        return {
          output: `Unknown tool: ${name}`,
          type: "unknown",
          data: { tool: name }
        };
      }
    }
  }
  // ── Non-Streaming Chat ───────────────────────────────────────────────────
  /**
   * Send a message and get a complete response (non-streaming).
   * Automatically handles the multi-tool execution loop.
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}] - Per-message options
   * @param {Record<string, string>} [opts.labels] - Per-message billing labels
   * @param {import('./types').FileInput|import('./types').FileInput[]} [opts.files] - Files sent after the message (strict)
   * @returns {Promise<CodeAgentResponse>}
   */
  async chat(message, opts = {}) {
    if (!this.chatSession) await this.init();
    this._stopped = false;
    const toolCalls = [];
    let consecutiveFailures = 0;
    const sendConfig = this._getSendConfig(opts.labels);
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    this._resetUsage();
    let response = await this._withRetry(() => this.chatSession.sendMessage({
      message: userMessage,
      ...sendConfig && { config: sendConfig }
    }));
    this._accumulateUsage(response);
    for (let round = 0; round < this.maxRounds; round++) {
      if (this._stopped) break;
      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) break;
      const results = [];
      for (const call of functionCalls) {
        if (this._stopped) break;
        const { output, type, data } = await this._handleToolCall(call.name, call.args || {});
        toolCalls.push(data);
        const isExecutingTool = EXECUTING_TOOLS.has(call.name) || call.name === "fix_code" && call.args?.execute;
        if (isExecutingTool) {
          if (data.exitCode !== 0 && !data.denied) {
            consecutiveFailures++;
          } else {
            consecutiveFailures = 0;
          }
        }
        let toolOutput = output;
        if (consecutiveFailures >= this.maxRetries) {
          toolOutput += `

[RETRY LIMIT REACHED] You have failed ${this.maxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
        }
        results.push({
          id: call.id,
          name: call.name,
          result: toolOutput
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
        })),
        ...sendConfig && { config: sendConfig }
      }));
      this._accumulateUsage(response);
      if (consecutiveFailures >= this.maxRetries) break;
    }
    const codeExecutions = toolCalls.filter((tc) => tc.tool === "execute_code" || tc.tool === "write_and_run_code" || tc.tool === "fix_code" && tc.executed).map((tc) => ({
      code: tc.code || tc.fixedCode,
      purpose: this._slugify(tc.purpose),
      output: tc.stdout || "",
      stderr: tc.stderr || "",
      exitCode: tc.exitCode ?? 0
    }));
    return {
      text: response.text || "",
      codeExecutions,
      toolCalls,
      usage: this.getLastUsage()
    };
  }
  // ── Streaming ────────────────────────────────────────────────────────────
  /**
   * Send a message and stream the response as events.
   *
   * Event types:
   * - `text` — A chunk of the agent's text response
   * - `code` — The agent is about to execute code (execute_code or write_and_run_code)
   * - `output` — Code/bash finished executing
   * - `write` — The agent wrote code without executing (write_code)
   * - `fix` — The agent fixed code (fix_code)
   * - `bash` — The agent is about to run a bash command
   * - `skill` — The agent loaded a skill
   * - `done` — The agent finished
   *
   * @param {string} message - The user's message
   * @param {Object} [opts={}]
   * @yields {CodeAgentStreamEvent}
   */
  async *stream(message, opts = {}) {
    if (!this.chatSession) await this.init();
    this._stopped = false;
    const toolCalls = [];
    let fullText = "";
    let consecutiveFailures = 0;
    const sendConfig = this._getSendConfig(opts.labels);
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    this._resetUsage();
    let streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({
      message: userMessage,
      ...sendConfig && { config: sendConfig }
    }));
    for (let round = 0; round < this.maxRounds; round++) {
      if (this._stopped) break;
      const functionCalls = [];
      const usage = this._streamUsage();
      for await (const chunk of streamResponse) {
        usage.track(chunk);
        if (chunk.functionCalls) functionCalls.push(...chunk.functionCalls);
        for (const text of this._chunkTextParts(chunk)) {
          fullText += text;
          yield { type: "text", text };
        }
      }
      usage.commit();
      if (functionCalls.length === 0) {
        const codeExecutions2 = toolCalls.filter((tc) => tc.tool === "execute_code" || tc.tool === "write_and_run_code" || tc.tool === "fix_code" && tc.executed).map((tc) => ({
          code: tc.code || tc.fixedCode,
          purpose: this._slugify(tc.purpose),
          output: tc.stdout || "",
          stderr: tc.stderr || "",
          exitCode: tc.exitCode ?? 0
        }));
        yield { type: "done", fullText, codeExecutions: codeExecutions2, toolCalls, usage: this.getLastUsage() };
        return;
      }
      const results = [];
      for (const call of functionCalls) {
        if (this._stopped) break;
        const toolName = call.name;
        const toolInput = call.args || {};
        if (toolName === "write_code") {
          yield { type: "write", code: toolInput.code, purpose: toolInput.purpose, language: toolInput.language || "javascript" };
        } else if (toolName === "fix_code") {
          yield { type: "fix", originalCode: toolInput.original_code, fixedCode: toolInput.fixed_code, explanation: toolInput.explanation };
        } else if (toolName === "run_bash") {
          yield { type: "bash", command: toolInput.command };
        } else if (toolName === "execute_code" || toolName === "write_and_run_code") {
          yield { type: "code", code: toolInput.code };
        }
        const { output, type, data } = await this._handleToolCall(toolName, toolInput);
        toolCalls.push(data);
        if (data.stdout !== void 0 || data.stderr !== void 0) {
          yield {
            type: "output",
            code: data.code || data.command || data.fixedCode,
            stdout: data.stdout || "",
            stderr: data.stderr || "",
            exitCode: data.exitCode ?? 0
          };
        }
        if (toolName === "use_skill") {
          yield { type: "skill", skillName: data.skillName, content: data.content, found: data.found };
        }
        if (type === "tool") {
          yield { type: "tool", toolName, args: data.args, result: data.result, error: data.error };
        }
        const isExecutingTool = EXECUTING_TOOLS.has(toolName) || toolName === "fix_code" && toolInput.execute;
        if (isExecutingTool) {
          if (data.exitCode !== 0 && !data.denied) {
            consecutiveFailures++;
          } else {
            consecutiveFailures = 0;
          }
        }
        let toolOutput = output;
        if (consecutiveFailures >= this.maxRetries) {
          toolOutput += `

[RETRY LIMIT REACHED] You have failed ${this.maxRetries} consecutive attempts. STOP trying to execute code. Instead, respond with: 1) What you were trying to do, 2) The errors you encountered, 3) Questions for the user about how to resolve it.`;
        }
        results.push({
          id: call.id,
          name: call.name,
          result: toolOutput
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
        })),
        ...sendConfig && { config: sendConfig }
      }));
      if (consecutiveFailures >= this.maxRetries) break;
    }
    let warning = "Max tool rounds reached";
    if (this._stopped) warning = "Agent was stopped";
    else if (consecutiveFailures >= this.maxRetries) warning = "Retry limit reached";
    const codeExecutions = toolCalls.filter((tc) => tc.tool === "execute_code" || tc.tool === "write_and_run_code" || tc.tool === "fix_code" && tc.executed).map((tc) => ({
      code: tc.code || tc.fixedCode,
      purpose: this._slugify(tc.purpose),
      output: tc.stdout || "",
      stderr: tc.stderr || "",
      exitCode: tc.exitCode ?? 0
    }));
    yield { type: "done", fullText, codeExecutions, toolCalls, usage: this.getLastUsage(), warning };
  }
  // ── Dump ─────────────────────────────────────────────────────────────────
  /**
   * Returns all code scripts and bash commands the agent has executed.
   * @returns {Array<{fileName: string, purpose: string|null, script: string, filePath: string|null, tool: string}>}
   */
  dump() {
    const ext = this.language === "python" ? ".py" : ".mjs";
    return this._allExecutions.map((exec, i) => ({
      fileName: exec.purpose ? `agent-${exec.purpose}${ext}` : `script-${i + 1}${ext}`,
      purpose: exec.purpose || null,
      script: exec.code,
      filePath: exec.filePath || null,
      tool: exec.tool || "execute_code"
    }));
  }
  // ── Stop ─────────────────────────────────────────────────────────────────
  /**
   * Stop the agent. Kills any running child process.
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
var import_node_path3 = require("node:path");
var import_promises4 = require("node:fs/promises");
var _warnedRemoteFiles = /* @__PURE__ */ new Set();
var DEFAULT_SYSTEM_PROMPT = "You are a helpful AI assistant. Answer questions based on the provided documents and data. When referencing information, mention which document or data source it comes from.";
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
      const resolvedPath = (0, import_node_path3.resolve)(filePath);
      logger_default.debug(`Uploading remote file: ${resolvedPath}`);
      const ext = (0, import_node_path3.extname)(resolvedPath).toLowerCase();
      const mimeType = LEGACY_MIME_TYPES[ext] || MIME_TYPES[ext] || "application/octet-stream";
      if (!MIME_TYPES[ext] && !_warnedRemoteFiles.has(resolvedPath)) {
        _warnedRemoteFiles.add(resolvedPath);
        logger_default.warn(`RagAgent.remoteFiles: "${(0, import_node_path3.basename)(resolvedPath)}" (${ext || "no extension"}) is not a format Gemini reads natively; uploading anyway. The strict "files" option would reject it.`);
      }
      const uploaded = await this._withRetry(async () => uploadFile(await this._ensureClient(), resolvedPath, {
        displayName: (0, import_node_path3.basename)(resolvedPath),
        mimeType
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
      const resolvedPath = (0, import_node_path3.resolve)(filePath);
      logger_default.debug(`Reading local file: ${resolvedPath}`);
      const content = await (0, import_promises4.readFile)(resolvedPath, "utf-8");
      this._localFileContents.push({
        name: (0, import_node_path3.basename)(resolvedPath),
        content,
        path: resolvedPath
      });
      logger_default.debug(`Local file read: ${(0, import_node_path3.basename)(resolvedPath)} (${content.length} chars)`);
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
   * @param {import('./types').FileInput|import('./types').FileInput[]} [opts.files] - Files sent after the message (strict)
   * @returns {Promise<RagResponse>}
   */
  async chat(message, opts = {}) {
    if (!this._initialized) await this.init();
    const sendConfig = this._getSendConfig(opts.labels);
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    this._resetUsage();
    const response = await this._withRetry(() => this.chatSession.sendMessage({
      message: userMessage,
      ...sendConfig && { config: sendConfig }
    }));
    this._accumulateUsage(response);
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
    const sendConfig = this._getSendConfig(opts.labels);
    const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
    this._resetUsage();
    const usage = this._streamUsage();
    const streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({
      message: userMessage,
      ...sendConfig && { config: sendConfig }
    }));
    for await (const chunk of streamResponse) {
      usage.track(chunk);
      for (const text of this._chunkTextParts(chunk)) {
        fullText += text;
        yield { type: "text", text };
      }
    }
    usage.commit();
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
    await waitForFileActive(await this._ensureClient(), file);
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
    await this._healthCheckPing();
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
    const result = await this._withRetry(async () => (await this._ensureClient()).models.embedContent({
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
    const result = await this._withRetry(async () => (await this._ensureClient()).models.embedContent({
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

// image-generator.js
var import_node_fs = require("node:fs");
var DEFAULT_IMAGE_MODEL = "gemini-nano-banana-2.1";
function buildImageConfig(defaults, overrides = {}, { outputMimeType } = {}) {
  const includeText = overrides.includeText ?? defaults.includeText ?? false;
  const config = { responseModalities: includeText ? ["IMAGE", "TEXT"] : ["IMAGE"] };
  const imageConfig = {};
  const aspectRatio = overrides.aspectRatio || defaults.aspectRatio;
  const imageSize = overrides.imageSize || defaults.imageSize;
  const personGeneration = overrides.personGeneration || defaults.personGeneration;
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (imageSize) imageConfig.imageSize = imageSize;
  if (personGeneration) imageConfig.personGeneration = personGeneration;
  if (outputMimeType) imageConfig.outputMimeType = outputMimeType;
  if (Object.keys(imageConfig).length > 0) config.imageConfig = imageConfig;
  return config;
}
function parseImageResponse(result) {
  const images = [];
  let text = "";
  const responseParts = result?.candidates?.[0]?.content?.parts || [];
  for (const part of responseParts) {
    if (part.inlineData?.data) {
      images.push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType });
    } else if (part.text) {
      text += part.text;
    }
  }
  return { images, text: text || null };
}
var ImageGenerator = class extends base_default {
  /**
   * @param {import('./types.d.ts').ImageGeneratorOptions} [options={}]
   */
  constructor(options = {}) {
    if (options.modelName === void 0) {
      options = { ...options, modelName: DEFAULT_IMAGE_MODEL };
    }
    if (options.systemPrompt === void 0) {
      options = { ...options, systemPrompt: null };
    }
    super(options);
    this.aspectRatio = options.aspectRatio || null;
    this.imageSize = options.imageSize || null;
    this.personGeneration = options.personGeneration || null;
    this.includeText = options.includeText ?? false;
    logger_default.debug(`ImageGenerator created with model: ${this.modelName}`);
  }
  /**
   * Validate API connection only; no chat session (stateless).
   * @param {boolean} [force=false]
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    logger_default.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);
    await this._healthCheckPing();
    this._initialized = true;
  }
  /**
   * Build a FRESH config — Gemini image models reject safetySettings/temp/topK/topP/thinkingConfig.
   * Do NOT spread this.chatConfig.
   * @private
   */
  _buildConfig(overrides = {}) {
    return buildImageConfig(this, overrides);
  }
  /**
   * Generate one or more images from a text prompt.
   * Optionally accepts `inputImages` for image editing / multi-image composition.
   *
   * @param {string} prompt
   * @param {import('./types.d.ts').ImageGenerateOptions} [opts={}]
   * @returns {Promise<import('./types.d.ts').ImageGenerationResult>}
   */
  async generate(prompt, opts = {}) {
    if (!this._initialized) await this.init();
    const parts = [{ text: prompt }];
    let uploaded = [];
    if (Array.isArray(opts.inputImages)) {
      const isLegacy = (img) => img && typeof img === "object" && typeof img.data === "string" && img.mimeType;
      const inputs = (
        /** @type {any[]} */
        opts.inputImages
      );
      const strict = inputs.filter((img) => !isLegacy(img));
      let resolved = [];
      if (strict.length) {
        ({ parts: resolved, uploaded } = await toParts(strict, await this._ensureClient(), {
          vertexai: this.vertexai,
          withRetry: (fn) => this._withRetry(fn)
        }));
      }
      let next = 0;
      for (const img of inputs) {
        parts.push(isLegacy(img) ? { inlineData: { data: img.data, mimeType: img.mimeType } } : resolved[next++]);
      }
    }
    const result = await this._withRetry(async () => (await this._ensureClient()).models.generateContent({
      model: this.modelName,
      contents: [{ role: "user", parts }],
      config: this._buildConfig(opts)
    }));
    const usage = { ...this._usageFromResponse(result), files: uploaded };
    this._captureMetadata(result);
    this._cumulativeUsage = {
      promptTokens: this.lastResponseMetadata.promptTokens,
      responseTokens: this.lastResponseMetadata.responseTokens,
      thoughtsTokens: this.lastResponseMetadata.thoughtsTokens,
      cachedTokens: this.lastResponseMetadata.cachedTokens,
      totalTokens: this.lastResponseMetadata.totalTokens,
      attempts: 1
    };
    const parsed = parseImageResponse(result);
    const images = parsed.images.map((img) => ({ data: img.data, mimeType: img.mimeType || "image/png" }));
    const text = parsed.text;
    if (images.length === 0) {
      logger_default.warn("ImageGenerator: no images returned. Check prompt or safety filters.");
    }
    return { images, text, usage };
  }
  /**
   * Convenience: write one or all images to disk.
   * If multiple images, suffixes with `_N` before extension.
   * @param {import('./types.d.ts').ImageGenerationResult} result
   * @param {string} filePath
   * @returns {string[]} Written file paths
   */
  save(result, filePath) {
    if (!result?.images?.length) {
      logger_default.warn("ImageGenerator.save(): no images to save.");
      return [];
    }
    const paths = [];
    const dot = filePath.lastIndexOf(".");
    const base = dot >= 0 ? filePath.slice(0, dot) : filePath;
    const ext = dot >= 0 ? filePath.slice(dot) : ".png";
    result.images.forEach((img, i) => {
      const out = result.images.length === 1 ? filePath : `${base}_${i}${ext}`;
      (0, import_node_fs.writeFileSync)(out, Buffer.from(img.data, "base64"));
      paths.push(out);
    });
    return paths;
  }
  // ── No-ops (image gen is stateless) ──
  /** @returns {any[]} Always returns empty array */
  getHistory() {
    return [];
  }
  /** No-op for ImageGenerator */
  async clearHistory() {
  }
  /** No-op for ImageGenerator */
  async seed() {
    logger_default.warn("ImageGenerator.seed() is a no-op \u2014 image generation does not support few-shot.");
    return [];
  }
  /**
   * @param {any} _nextPayload
   * @throws {Error} ImageGenerator does not support token estimation
   * @returns {Promise<{ inputTokens: number }>}
   */
  async estimate(_nextPayload) {
    throw new Error("ImageGenerator does not support token estimation. Use generate() directly.");
  }
};

// file-agent.js
var import_promises5 = require("node:fs/promises");
var import_node_path4 = require("node:path");
var DEFAULT_IMAGE_MODEL2 = "gemini-nano-banana-2.1";
var DEFAULT_SPEECH_MODEL = "gemini-3.8-flash-tts";
var DEFAULT_VOICE = "Kore";
var WRITE_MIME_TYPES = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  html: "text/html",
  xml: "text/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  wav: "audio/wav"
};
var sameFormat = (a, b) => a === b || ["jpg", "jpeg"].includes(a) && ["jpg", "jpeg"].includes(b);
function stripFence(text) {
  const m = text.match(/^\s*```[\w+.-]*[^\S\n]*\n([\s\S]*?)\n?```\s*$/);
  if (!m || /^\s*```/m.test(m[1])) return text;
  return m[1];
}
var FileAgent = class extends base_default {
  /**
   * @param {import('./types').FileAgentOptions} [options={}]
   */
  constructor(options = {}) {
    super(options);
    this.imageModel = options.imageModel || DEFAULT_IMAGE_MODEL2;
    this.speechModel = options.speechModel || DEFAULT_SPEECH_MODEL;
    this.voice = options.voice || DEFAULT_VOICE;
    this.languageCode = options.languageCode || null;
    this.aspectRatio = options.aspectRatio || null;
    this.imageSize = options.imageSize || null;
    this.personGeneration = options.personGeneration || null;
    logger_default.debug(`FileAgent created (text=${this.modelName}, image=${this.imageModel}, speech=${this.speechModel})`);
  }
  /**
   * Stateless: no chat session.
   * @param {boolean} [force=false]
   */
  async init(force = false) {
    if (this._initialized && !force) return;
    await this._healthCheckPing();
    this._initialized = true;
  }
  /**
   * Produce a file from a prompt.
   * @param {string|Array<{ speaker: string, text: string, style?: string }>} prompt
   * @param {import('./types').FileWriteOptions} opts
   * @returns {Promise<import('./types').FileWriteResult>}
   */
  async write(prompt, opts = {}) {
    const { format, kind } = this._resolveFormat(opts);
    if (Array.isArray(prompt)) {
      if (kind !== "audio") throw new Error(`FileAgent.write(): a SpeechTurn[] prompt works only for .wav. Pass a string prompt for .${format}.`);
      const files = opts.files == null ? [] : [].concat(opts.files);
      if (files.length) throw new Error("FileAgent.write(): files cannot be combined with a SpeechTurn[] prompt. Speech models read only the script.");
    }
    if (!this._initialized) await this.init();
    let out;
    if (kind === "text") out = await this._writeText(
      /** @type {string} */
      prompt,
      format,
      opts
    );
    else if (kind === "image") out = await this._writeImage(
      /** @type {string} */
      prompt,
      format,
      opts
    );
    else out = await this._writeAudio(prompt, opts);
    const mimeType = WRITE_MIME_TYPES[format];
    this._lastFileUsage = out.usage;
    if (opts.path) {
      await (0, import_promises5.mkdir)((0, import_node_path4.dirname)(opts.path), { recursive: true });
      await (0, import_promises5.writeFile)(opts.path, out.data);
    }
    return { data: out.data, mimeType, format, path: opts.path || null, text: out.text, usage: out.usage };
  }
  /**
   * Read files with a prompt (one stateless call).
   * @param {import('./types').FileInput|import('./types').FileInput[]} files
   * @param {string} prompt
   * @param {import('./types').FileReadOptions} [opts={}]
   * @returns {Promise<{ text: string, data?: any, usage: import('./types').UsageData }>}
   */
  async read(files, prompt, opts = {}) {
    if (!this._initialized) await this.init();
    const { message, uploaded } = await this._buildUserParts(prompt, files);
    const structured = !!(opts.responseSchema || opts.responseMimeType === "application/json");
    const config = {
      ...this._getChatCreateOptions().config,
      ...opts.responseSchema && { responseSchema: opts.responseSchema },
      ...structured && { responseMimeType: opts.responseMimeType || "application/json" },
      ...this._labelsConfig(opts.labels)
    };
    const result = await this._generate(this.modelName, message, config);
    const usage = { ...this._usageFromResponse(result), files: uploaded };
    this._lastFileUsage = usage;
    const text = result.text || "";
    const response = { text, usage };
    if (structured) {
      try {
        response.data = extractJSON(text);
      } catch (e) {
        logger_default.warn(`FileAgent.read(): could not parse structured response: ${e.message}`);
        response.data = null;
      }
    }
    return response;
  }
  // ── Routes ───────────────────────────────────────────────────────────────
  /** @private */
  async _writeText(prompt, format, opts) {
    const { message, uploaded } = await this._buildUserParts(
      `${prompt}

Write the complete contents of a .${format} file. Reply with the file contents only: no commentary and no code fences.`,
      opts.files
    );
    const json = format === "json";
    const config = {
      ...this._getChatCreateOptions().config,
      ...json && { responseMimeType: "application/json" },
      ...json && opts.responseSchema && { responseSchema: opts.responseSchema },
      ...this._labelsConfig(opts.labels)
    };
    const result = await this._generate(this.modelName, message, config);
    const usage = { ...this._usageFromResponse(result), files: uploaded };
    const text = stripFence(result.text || "");
    if (json) {
      try {
        JSON.parse(text);
      } catch (e) {
        const err = new Error(`FileAgent: the model output is not valid JSON (${e.message}).`);
        err.raw = text;
        throw err;
      }
    }
    return { data: Buffer.from(text, "utf8"), text, usage };
  }
  /** @private */
  async _writeImage(prompt, format, opts) {
    const wanted = WRITE_MIME_TYPES[format];
    const { message, uploaded } = await this._buildUserParts(prompt, opts.files);
    const config = {
      ...buildImageConfig(this, opts, { outputMimeType: this.vertexai ? wanted : void 0 }),
      ...this._labelsConfig(opts.labels)
    };
    const result = await this._generate(this.imageModel, message, config);
    const usage = { ...this._usageFromResponse(result, 1, this.imageModel), files: uploaded };
    const { images, text } = parseImageResponse(result);
    if (images.length === 0) {
      const cand = result?.candidates?.[0];
      const reason = cand?.finishReason ? ` (${cand.finishReason})` : "";
      const detail = cand?.finishMessage || (text ? `Model text: ${text}` : "Check the prompt or safety filters.");
      throw new Error(`FileAgent: the image model returned no image${reason}. ${detail}`);
    }
    const got = images[0].mimeType;
    if (!got) throw new Error(`FileAgent: the image model returned no MIME type; refusing to write it as ${wanted}.`);
    if (got.toLowerCase() !== wanted) {
      throw new Error(`FileAgent: asked for ${wanted} (.${format}) but the image model returned ${got}. Nothing was written.`);
    }
    return { data: Buffer.from(images[0].data, "base64"), text, usage };
  }
  /** @private */
  async _writeAudio(prompt, opts) {
    let speechConfig;
    if (opts.speakers?.length) {
      speechConfig = { multiSpeakerVoiceConfig: { speakerVoiceConfigs: opts.speakers.map((s) => ({
        speaker: s.speaker,
        voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
      })) } };
    } else {
      speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice || this.voice } } };
    }
    const languageCode = opts.languageCode || this.languageCode;
    if (languageCode) speechConfig.languageCode = languageCode;
    let message;
    let uploaded = [];
    if (Array.isArray(prompt)) {
      message = prompt.map((t) => ({ text: t.text, speechMetadata: { speaker: t.speaker, ...t.style && { style: t.style } } }));
    } else {
      ({ message, uploaded } = await this._buildUserParts(prompt, opts.files));
    }
    const config = { responseModalities: ["AUDIO"], speechConfig, ...this._labelsConfig(opts.labels) };
    const result = await this._generate(this.speechModel, message, config);
    const usage = { ...this._usageFromResponse(result, 1, this.speechModel), files: uploaded };
    const parts = (result?.candidates?.[0]?.content?.parts || []).filter((p) => p.inlineData?.data);
    if (parts.length === 0) throw new Error("FileAgent: the speech model returned no audio.");
    const chunks = parts.map((p) => {
      const mime = String(p.inlineData.mimeType || "");
      const bytes = Buffer.from(p.inlineData.data, "base64");
      if (/^audio\/(wav|x-wav|wave)\b/i.test(mime)) return wavToPcm(bytes);
      const fmt = parsePcmMime(mime);
      return { pcm: bytes, sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16 };
    });
    const { sampleRate, channels, bitsPerSample } = chunks[0];
    if (chunks.some((c) => c.sampleRate !== sampleRate || c.channels !== channels || c.bitsPerSample !== bitsPerSample)) {
      throw new Error("FileAgent: the speech model returned audio parts in different formats.");
    }
    const pcm = chunks.length === 1 ? chunks[0].pcm : Buffer.concat(chunks.map((c) => c.pcm));
    const text = (result?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("") || null;
    return { data: pcmToWav(pcm, { sampleRate, channels, bitsPerSample }), text, usage };
  }
  // ── Helpers ──────────────────────────────────────────────────────────────
  /**
   * Decide the output format from `format` and/or `path`. Runs before any API
   * call or disk write.
   * @param {{ format?: string, path?: string }} opts
   * @returns {{ format: string, kind: 'text'|'image'|'audio' }}
   * @private
   */
  _resolveFormat(opts) {
    const norm = (f) => String(f).toLowerCase().replace(/^\./, "");
    const fromFormat = opts.format != null ? norm(opts.format) : void 0;
    const fromPath = opts.path != null ? norm((0, import_node_path4.extname)(opts.path)) : void 0;
    if (fromFormat === void 0 && fromPath === void 0) {
      throw new Error("FileAgent.write() needs { format } or { path }");
    }
    if (fromFormat !== void 0 && fromPath !== void 0 && !sameFormat(fromFormat, fromPath)) {
      throw new Error(fromPath === "" ? `format "${fromFormat}" does not match path "${opts.path}" (no extension)` : `format "${fromFormat}" does not match path extension ".${fromPath}"`);
    }
    const format = (
      /** @type {string} */
      fromFormat ?? fromPath
    );
    if (!writeFormatsFor(this.vertexai).includes(format)) {
      throw new UnsupportedFormatError(format, "write", { vertexai: this.vertexai, who: "FileAgent" });
    }
    const kind = WRITE_FORMATS.text.includes(format) ? "text" : WRITE_FORMATS.audio.includes(format) ? "audio" : "image";
    return { format, kind };
  }
  /** @private */
  _labelsConfig(perCallLabels) {
    const labels = { ...this.labels, ...perCallLabels || {} };
    return this.vertexai && Object.keys(labels).length > 0 ? { labels } : {};
  }
  /**
   * One generateContent call with the 429 retry.
   * @param {string} model
   * @param {string|any[]} message - text or Part[]
   * @param {Record<string, any>} config
   * @private
   */
  async _generate(model, message, config) {
    const parts = typeof message === "string" ? [{ text: message }] : message;
    return this._withRetry(async () => (await this._ensureClient()).models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config
    }));
  }
  /**
   * Usage of the last write() or read() on this instance. Prefer the per-call
   * `result.usage` under concurrency.
   * @returns {import('./types').UsageData|null}
   */
  getLastUsage() {
    return this._lastFileUsage || null;
  }
  // ── No-ops (stateless) ───────────────────────────────────────────────────
  /** @returns {any[]} */
  getHistory() {
    return [];
  }
  async clearHistory() {
  }
  async seed() {
    logger_default.warn("FileAgent is stateless \u2014 seed() has no effect.");
    return [];
  }
  /**
   * @param {any} _nextPayload
   * @returns {Promise<{ inputTokens: number }>}
   */
  async estimate(_nextPayload) {
    throw new Error("FileAgent is stateless \u2014 use estimate() on Chat or Transformer.");
  }
};
var file_agent_default = FileAgent;

// index.js
var import_genai2 = require("@google/genai");
var index_default = { Transformer: transformer_default, Chat: chat_default, Message: message_default, ToolAgent: tool_agent_default, CodeAgent: code_agent_default, RagAgent: rag_agent_default, Embedding, ImageGenerator, FileAgent: file_agent_default };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BaseGemini,
  Chat,
  CodeAgent,
  DEFAULT_GEMINI_API_VERSION,
  DEFAULT_MODEL,
  EFFORT_LEVELS,
  Embedding,
  FileAgent,
  HarmBlockThreshold,
  HarmCategory,
  ImageGenerator,
  MODEL_ALIASES,
  MODEL_PRICING,
  MODEL_PRICING_AS_OF,
  Message,
  READ_FORMATS,
  RagAgent,
  THINKING_CAPABILITIES,
  THINKING_SUPPORTED_MODELS,
  ThinkingLevel,
  ToolAgent,
  Transformer,
  UnsupportedFormatError,
  WRITE_FORMATS,
  attemptJSONRecovery,
  computeCost,
  extractJSON,
  log,
  pcmToWav,
  resolvePricing,
  thinkingCapabilities,
  validateSchema,
  writeFormatsFor
});
