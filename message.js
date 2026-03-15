/**
 * @fileoverview Message class — stateless one-off messages to AI.
 * Uses generateContent() instead of chat sessions. No conversation history.
 */

import BaseGemini from './base.js';
import { extractJSON } from './json-helpers.js';
import log from './logger.js';

/**
 * @typedef {import('./types').MessageOptions} MessageOptions
 * @typedef {import('./types').MessageResponse} MessageResponse
 */

/**
 * Stateless one-off messages to AI.
 * Each send() call is independent — no conversation history is maintained.
 * Uses generateContent() directly instead of chat sessions.
 *
 * Optionally returns structured data when responseSchema or
 * responseMimeType: 'application/json' is configured.
 *
 * @example
 * ```javascript
 * import { Message } from 'ak-gemini';
 *
 * // Simple text response
 * const msg = new Message({
 *   systemPrompt: 'You are a helpful assistant.'
 * });
 * const r = await msg.send('What is the capital of France?');
 * console.log(r.text); // "The capital of France is Paris."
 *
 * // Structured JSON response
 * const jsonMsg = new Message({
 *   systemPrompt: 'Extract entities from text.',
 *   responseMimeType: 'application/json'
 * });
 * const r2 = await jsonMsg.send('Alice works at Acme Corp in New York.');
 * console.log(r2.data); // { entities: [...] }
 * ```
 */
class Message extends BaseGemini {
	/**
	 * @param {MessageOptions} [options={}]
	 */
	constructor(options = {}) {
		super(options);

		// ── Structured output config ──
		if (options.responseSchema) {
			this.chatConfig.responseSchema = options.responseSchema;
		}
		if (options.responseMimeType) {
			this.chatConfig.responseMimeType = options.responseMimeType;
		}

		this._isStructured = !!(options.responseSchema || options.responseMimeType === 'application/json');

		log.debug(`Message created (structured=${this._isStructured})`);
	}

	/**
	 * Initialize the Message client.
	 * Override: creates genAIClient only, NO chat session (stateless).
	 * @param {boolean} [force=false]
	 * @returns {Promise<void>}
	 */
	async init(force = false) {
		if (this._initialized && !force) return;

		log.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);

		try {
			await this.genAIClient.models.list();
			log.debug(`${this.constructor.name}: API connection successful.`);
		} catch (e) {
			throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
		}

		this._initialized = true;
		log.debug(`${this.constructor.name}: Initialized (stateless mode).`);
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

		const payloadStr = typeof payload === 'string'
			? payload
			: JSON.stringify(payload, null, 2);

		const contents = [{ role: 'user', parts: [{ text: payloadStr }] }];

		const mergedLabels = { ...this.labels, ...(opts.labels || {}) };

		const result = await this.genAIClient.models.generateContent({
			model: this.modelName,
			contents: contents,
			config: {
				...this.chatConfig,
				...(this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels })
			}
		});

		this._captureMetadata(result);

		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		if (result.usageMetadata && log.level !== 'silent') {
			log.debug(`Message response: model=${result.modelVersion || 'unknown'}, tokens=${result.usageMetadata.totalTokenCount}`);
		}

		const text = result.text || '';
		const response = {
			text,
			usage: this.getLastUsage()
		};

		// Parse structured data if configured
		if (this._isStructured) {
			try {
				response.data = extractJSON(text);
			} catch (e) {
				log.warn(`Could not parse structured response: ${e.message}`);
				response.data = null;
			}
		}

		return response;
	}

	// ── No-ops for stateless class ──

	/** @returns {Array} Always returns empty array (stateless). */
	getHistory() { return []; }

	/** No-op (stateless). */
	async clearHistory() { }

	/** Not supported on Message (stateless). */
	async seed() {
		log.warn("Message is stateless — seed() has no effect. Use Transformer or Chat for few-shot learning.");
		return [];
	}

	/** Not supported on Message (stateless). */
	async estimate() {
		throw new Error("Message is stateless — use estimate() on Chat or Transformer which have conversation context.");
	}
}

export default Message;
