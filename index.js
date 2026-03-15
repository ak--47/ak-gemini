/**
 * @fileoverview ak-gemini — Easy-to-use wrappers on @google/genai.
 *
 * Exports:
 * - Transformer — AI-powered JSON transformation via few-shot learning
 * - Chat — Multi-turn text conversation with AI
 * - Message — Stateless one-off messages to AI
 * - ToolAgent — AI agent with user-provided tools
 * - CodeAgent — AI agent that writes and executes code (stub)
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
export { default as BaseGemini } from './base.js';
export { default as log } from './logger.js';
export { ThinkingLevel, HarmCategory, HarmBlockThreshold } from '@google/genai';
export { extractJSON, attemptJSONRecovery } from './json-helpers.js';

// ── Default Export (namespace object) ──

import Transformer from './transformer.js';
import Chat from './chat.js';
import Message from './message.js';
import ToolAgent from './tool-agent.js';
import CodeAgent from './code-agent.js';

export default { Transformer, Chat, Message, ToolAgent, CodeAgent };
