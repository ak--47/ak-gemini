/**
 * @fileoverview ak-gemini — Easy-to-use wrappers on @google/genai.
 *
 * Exports:
 * - Transformer — AI-powered JSON transformation via few-shot learning
 * - Chat — Multi-turn text conversation with AI
 * - Message — Stateless one-off messages to AI
 * - ToolAgent — AI agent with user-provided tools
 * - CodeAgent — AI agent that writes and executes code (stub)
 * - FileAgent — Write files (text, images, WAV) from a prompt; read files with a prompt
 * - BaseGemini — Base class for building custom wrappers
 *
 * @example
 * ```javascript
 * import { Transformer, Chat, Message, ToolAgent } from 'ak-gemini';
 * // or
 * import AI from 'ak-gemini';
 * const t = new AI.Transformer({ ... });
 * ```
 */

// ── Named Exports ──

export { default as Transformer } from './transformer.js';
export { default as Chat } from './chat.js';
export { default as Message } from './message.js';
export { default as ToolAgent } from './tool-agent.js';
export { default as CodeAgent } from './code-agent.js';
export { default as RagAgent } from './rag-agent.js';
export { default as Embedding } from './embedding.js';
export { default as ImageGenerator } from './image-generator.js';
export { default as FileAgent } from './file-agent.js';
export { default as BaseGemini } from './base.js';
export { MODEL_PRICING, MODEL_PRICING_AS_OF, MODEL_ALIASES, EFFORT_LEVELS, THINKING_CAPABILITIES, THINKING_SUPPORTED_MODELS, thinkingCapabilities, DEFAULT_MODEL, DEFAULT_GEMINI_API_VERSION, resolvePricing, computeCost } from './base.js';
export { default as log } from './logger.js';
export { ThinkingLevel, HarmCategory, HarmBlockThreshold } from '@google/genai';
export { extractJSON, attemptJSONRecovery, validateSchema } from './json-helpers.js';
export { UnsupportedFormatError, READ_FORMATS, WRITE_FORMATS, writeFormatsFor, pcmToWav } from './files.js';

// ── Default Export (namespace object) ──

import Transformer from './transformer.js';
import Chat from './chat.js';
import Message from './message.js';
import ToolAgent from './tool-agent.js';
import CodeAgent from './code-agent.js';
import RagAgent from './rag-agent.js';
import Embedding from './embedding.js';
import ImageGenerator from './image-generator.js';
import FileAgent from './file-agent.js';

export default { Transformer, Chat, Message, ToolAgent, CodeAgent, RagAgent, Embedding, ImageGenerator, FileAgent };
