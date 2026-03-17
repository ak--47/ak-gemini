/**
 * @fileoverview Embedding class — Generate vector embeddings via Google's embedding models.
 *
 * Extends BaseGemini for auth/client reuse but overrides init() to skip chat session
 * creation (embeddings don't use chat). Follows the Message class pattern.
 *
 * @example
 * ```javascript
 * import { Embedding } from 'ak-gemini';
 *
 * const embedder = new Embedding({ apiKey: 'your-key' });
 * const result = await embedder.embed('Hello world');
 * console.log(result.values); // [0.012, -0.034, ...]
 * ```
 */

import BaseGemini from './base.js';
import log from './logger.js';

export default class Embedding extends BaseGemini {

	/**
	 * @param {import('./types.d.ts').EmbeddingOptions} [options={}]
	 */
	constructor(options = {}) {
		// Embeddings use a different model family — default to gemini-embedding-001
		if (options.modelName === undefined) {
			options = { ...options, modelName: 'gemini-embedding-001' };
		}

		// No system prompt for embeddings
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: null };
		}

		super(options);

		this.taskType = options.taskType || null;
		this.title = options.title || null;
		this.outputDimensionality = options.outputDimensionality || null;
		this.autoTruncate = options.autoTruncate ?? true;

		log.debug(`Embedding created with model: ${this.modelName}`);
	}

	/**
	 * Initialize the Embedding client.
	 * Override: validates API connection only, NO chat session (stateless).
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

		const result = await this.genAIClient.models.embedContent({
			model: this.modelName,
			contents: text,
			config: this._buildConfig(config)
		});

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

		const result = await this.genAIClient.models.embedContent({
			model: this.modelName,
			contents: texts,
			config: this._buildConfig(config)
		});

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
			throw new Error('Vectors must be non-null and have the same length');
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
	getHistory() { return []; }

	/** No-op for Embedding */
	async clearHistory() {}

	/** No-op for Embedding */
	async seed() {
		log.warn('Embedding.seed() is a no-op — embeddings do not support few-shot examples.');
		return [];
	}

	/**
	 * @param {any} _nextPayload
	 * @throws {Error} Embedding does not support token estimation
	 * @returns {Promise<{inputTokens: number}>}
	 */
	async estimate(_nextPayload) {
		throw new Error('Embedding does not support token estimation. Use embed() directly.');
	}
}
