/**
 * @fileoverview Transformer class — AI-powered JSON transformation via few-shot learning.
 * Extends BaseGemini with validation, retry logic, and structured JSON output.
 */

import BaseGemini from './base.js';
import { extractJSON, isJSON } from './json-helpers.js';
import log from './logger.js';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON).

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.
`;

/**
 * Appended to the original task when a previous attempt returned output that
 * could not be parsed as JSON. The failed response is already in the chat
 * history, so this only needs to correct the format — not restate the task.
 */
const EXTRACTION_RETRY_NUDGE = `Your previous response could not be parsed as JSON. Respond with a single valid JSON object and NOTHING else — no prose, no explanations, no markdown code fences.`;

/**
 * @typedef {import('./types').TransformerOptions} TransformerOptions
 * @typedef {import('./types').AsyncValidatorFunction} AsyncValidatorFunction
 * @typedef {import('./types').TransformationExample} TransformationExample
 * @typedef {import('./types').UsageData} UsageData
 */

/**
 * AI-powered JSON transformation using few-shot learning.
 *
 * Seed with example input/output pairs, then send new payloads to transform.
 * Supports validation, automatic retry with AI-powered error correction,
 * and structured JSON output.
 *
 * @example
 * ```javascript
 * import { Transformer } from 'ak-gemini';
 *
 * const t = new Transformer({
 *   promptKey: 'INPUT',
 *   answerKey: 'OUTPUT'
 * });
 *
 * await t.seed([
 *   { INPUT: { name: "Alice" }, OUTPUT: { greeting: "Hello, Alice!" } },
 *   { INPUT: { name: "Bob" },   OUTPUT: { greeting: "Hello, Bob!" } }
 * ]);
 *
 * const result = await t.send({ name: "Charlie" });
 * // => { greeting: "Hello, Charlie!" }
 * ```
 */
class Transformer extends BaseGemini {
	/**
	 * @param {TransformerOptions} [options={}]
	 */
	constructor(options = {}) {
		// Set Transformer-specific systemPrompt default before calling super
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: DEFAULT_SYSTEM_INSTRUCTIONS };
		}

		super(options);

		// ── JSON-specific config ──
		this.chatConfig.responseMimeType = 'application/json';
		this.onlyJSON = options.onlyJSON !== undefined ? options.onlyJSON : true;

		// ── Response schema ──
		if (options.responseSchema) {
			this.chatConfig.responseSchema = options.responseSchema;
		}

		// ── Example key mapping ──
		this.promptKey = options.promptKey || options.sourceKey || 'PROMPT';
		this.answerKey = options.answerKey || options.targetKey || 'ANSWER';
		this.contextKey = options.contextKey || 'CONTEXT';
		this.explanationKey = options.explanationKey || 'EXPLANATION';
		this.systemPromptKey = options.systemPromptKey || 'SYSTEM';

		if (this.promptKey === this.answerKey) {
			throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
		}

		// ── Examples source ──
		this.examplesFile = options.examplesFile || null;
		this.exampleData = options.exampleData || null;

		// ── Validation & retry ──
		this.asyncValidator = options.asyncValidator || null;
		this.maxRetries = options.maxRetries || 3;
		this.retryDelay = options.retryDelay || 1000;

		log.debug(`Transformer keys — Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
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
				log.debug(`No examples provided, loading from file: ${this.examplesFile}`);
				try {
					const filePath = path.resolve(this.examplesFile);
					const raw = await fs.readFile(filePath, 'utf-8');
					examples = JSON.parse(raw);
				} catch (err) {
					throw new Error(`Could not load examples from file: ${this.examplesFile}. ${err.message}`);
				}
			} else if (this.exampleData) {
				log.debug(`Using example data provided in options.`);
				if (Array.isArray(this.exampleData)) {
					examples = this.exampleData;
				} else {
					throw new Error(`Invalid example data provided. Expected an array of examples.`);
				}
			} else {
				log.debug("No examples provided and no examples file specified. Skipping seeding.");
				return this.getHistory();
			}
		}

		// Delegate to base.seed() with our key mapping
		return await super.seed(examples, {
			promptKey: this.promptKey,
			answerKey: this.answerKey,
			contextKey: this.contextKey,
			explanationKey: this.explanationKey,
			systemPromptKey: this.systemPromptKey,
			format: 'json'
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

		// Use the validator from this call, or fall back to the constructor validator
		const validator = validatorFn || this.asyncValidator;

		// Handle stateless messages
		if (opts.stateless) {
			return await this._statelessSend(payload, opts, validator);
		}

		const maxRetries = opts.maxRetries ?? this.maxRetries;
		const retryDelay = opts.retryDelay ?? this.retryDelay;

		// Handle per-message grounding override
		if (opts.enableGrounding !== undefined && opts.enableGrounding !== this.enableGrounding) {
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

		// Prepare the payload
		const originalPayload = this._preparePayload(payload);

		// Extract per-message labels
		const messageOptions = {};
		if (opts.labels) messageOptions.labels = opts.labels;

		// Reset cumulative usage tracking
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0, attempts: 0 };

		let lastError = null;
		// The payload the MODEL produced, when it produced a parseable one. Stays
		// null after an extraction failure — there is nothing to repair.
		let lastModelOutput = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				let transformedPayload;
				if (attempt === 0) {
					transformedPayload = await this.rawSend(originalPayload, messageOptions);
				} else if (lastModelOutput !== null) {
					// Validation failure: the model produced parseable output that the
					// validator rejected. Repair the payload it actually returned.
					transformedPayload = await this.rebuild(lastModelOutput, lastError.message, messageOptions);
				} else {
					// Extraction failure: the model returned something unparseable, so
					// there is no bad payload to repair. rebuild() would hand it the
					// ORIGINAL INPUT labelled "BAD PAYLOAD" (double-encoded, since
					// _preparePayload already stringified it) — re-send the task with a
					// format nudge instead.
					transformedPayload = await this.rawSend(
						`${originalPayload}\n\n${EXTRACTION_RETRY_NUDGE}`,
						messageOptions
					);
				}

				// Accumulate token usage
				if (this.lastResponseMetadata) {
					this._cumulativeUsage.promptTokens += this.lastResponseMetadata.promptTokens || 0;
					this._cumulativeUsage.responseTokens += this.lastResponseMetadata.responseTokens || 0;
					this._cumulativeUsage.thoughtsTokens += this.lastResponseMetadata.thoughtsTokens || 0;
					this._cumulativeUsage.cachedTokens += this.lastResponseMetadata.cachedTokens || 0;
					this._cumulativeUsage.totalTokens += this.lastResponseMetadata.totalTokens || 0;
					this._cumulativeUsage.attempts = attempt + 1;
				}

				// Validate
				if (validator) {
					try {
						await validator(transformedPayload);
					} catch (validationError) {
						// Tag it so the next attempt repairs this payload rather than
						// treating the failure as an extraction problem.
						validationError._akValidationPayload = transformedPayload;
						throw validationError;
					}
				}

				log.debug(`Transformation succeeded on attempt ${attempt + 1}`);

				if (opts._restoreGrounding) await opts._restoreGrounding();
				return transformedPayload;

			} catch (error) {
				lastError = error;
				lastModelOutput = '_akValidationPayload' in error ? error._akValidationPayload : null;
				log.warn(`Attempt ${attempt + 1} failed: ${error.message}`);

				if (attempt >= maxRetries) {
					log.error(`All ${maxRetries + 1} attempts failed.`);
					if (opts._restoreGrounding) await opts._restoreGrounding();
					throw new Error(`Transformation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
				}

				const delay = retryDelay * Math.pow(2, attempt);
				await new Promise(res => setTimeout(res, delay));
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

		const actualPayload = typeof payload === 'string'
			? payload
			: JSON.stringify(payload, null, 2);

		try {
			// Only set a per-message config when there is something to override — it
			// REPLACES the session config in @google/genai. See _getSendConfig().
			const sendParams = { message: actualPayload };
			const config = this._getSendConfig(messageOptions.labels);
			if (config) sendParams.config = config;

			const result = await this._withRetry(() => this.chatSession.sendMessage(sendParams));

			this._captureMetadata(result);

			if (result.usageMetadata && log.level !== 'silent') {
				log.debug(`API response: model=${result.modelVersion || 'unknown'}, tokens=${result.usageMetadata.totalTokenCount}`);
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
Respond with JSON only – no comments or explanations.
`;

		let result;
		try {
			const sendConfig = this._getSendConfig(messageOptions.labels);
			result = await this._withRetry(() => this.chatSession.sendMessage({
				message: prompt,
				...(sendConfig && { config: sendConfig })
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

		const payloadStr = typeof payload === 'string'
			? payload
			: JSON.stringify(payload, null, 2);

		const contents = [];

		// Include seeded examples
		if (this.exampleCount > 0) {
			const history = this.chatSession.getHistory();
			const exampleHistory = history.slice(0, this.exampleCount);
			contents.push(...exampleHistory);
		}

		contents.push({ role: 'user', parts: [{ text: payloadStr }] });

		const mergedLabels = { ...this.labels, ...(opts.labels || {}) };

		// Build from _getChatCreateOptions() rather than raw chatConfig: grounding
		// tools and cachedContent live there, not in chatConfig, so a stateless send
		// built from chatConfig alone silently ignored enableGrounding and useCache().
		this._resetUsage();
		const result = await this._withRetry(() => this.genAIClient.models.generateContent({
			model: this.modelName,
			contents: contents,
			config: {
				...this._getChatCreateOptions().config,
				...(this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels })
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
			log.warn("Cannot clear history: chat not initialized.");
			return;
		}

		const history = this.chatSession.getHistory();
		const exampleHistory = history.slice(0, this.exampleCount || 0);

		this.chatSession = this._createChatSession(exampleHistory);

		this.lastResponseMetadata = null;
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0, attempts: 0 };

		log.debug(`Conversation cleared. Preserved ${exampleHistory.length} example items.`);
	}

	/**
	 * Fully resets the chat session, clearing all history including examples.
	 * @returns {Promise<void>}
	 */
	async reset() {
		if (this.chatSession) {
			log.debug("Resetting chat session...");
			this.chatSession = this._createChatSession([]);
			this.exampleCount = 0;
			log.debug("Chat session reset.");
		} else {
			log.warn("Cannot reset: chat not yet initialized.");
		}
	}

	/**
	 * Updates system prompt and reinitializes the chat session.
	 * @param {string} newPrompt - The new system prompt
	 * @returns {Promise<void>}
	 */
	async updateSystemPrompt(newPrompt) {
		if (!newPrompt || typeof newPrompt !== 'string') {
			throw new Error('System prompt must be a non-empty string');
		}

		this.systemPrompt = newPrompt.trim();
		this.chatConfig.systemInstruction = this.systemPrompt;

		log.debug('Updating system prompt and reinitializing chat...');
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
		} else if (typeof payload === 'string') {
			return payload;
		} else if (typeof payload === 'boolean' || typeof payload === 'number') {
			return payload.toString();
		} else if (payload === null || payload === undefined) {
			return JSON.stringify({});
		} else {
			throw new Error("Invalid source payload. Must be a JSON object or string.");
		}
	}
}

export default Transformer;
