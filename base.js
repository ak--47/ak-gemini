/**
 * @fileoverview BaseGemini class — shared foundation for all ak-gemini classes.
 * Handles authentication, client initialization, thinking config, log levels,
 * safety settings, token estimation, cost tracking, and chat session management.
 */

import dotenv from 'dotenv';
dotenv.config();
const { NODE_ENV = "unknown", LOG_LEVEL = "" } = process.env;

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import log from './logger.js';
import { isJSON } from './json-helpers.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SAFETY_SETTINGS = [
	{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
];

const DEFAULT_THINKING_CONFIG = {
	thinkingBudget: 0
};

const DEFAULT_MAX_OUTPUT_TOKENS = 50_000;

/** Models that support thinking features */
const THINKING_SUPPORTED_MODELS = [
	/^gemini-3-flash(-preview)?$/,
	/^gemini-3-pro(-preview|-image-preview)?$/,
	/^gemini-2\.5-pro/,
	/^gemini-2\.5-flash(-preview)?$/,
	/^gemini-2\.5-flash-lite(-preview)?$/,
	/^gemini-2\.0-flash$/
];

/** Model pricing per million tokens (as of Dec 2025) */
const MODEL_PRICING = {
	'gemini-2.5-flash': { input: 0.15, output: 0.60 },
	'gemini-2.5-flash-lite': { input: 0.02, output: 0.10 },
	'gemini-2.5-pro': { input: 2.50, output: 10.00 },
	'gemini-3-pro': { input: 2.00, output: 12.00 },
	'gemini-3-pro-preview': { input: 2.00, output: 12.00 },
	'gemini-2.0-flash': { input: 0.10, output: 0.40 },
	'gemini-2.0-flash-lite': { input: 0.02, output: 0.10 }
};

export { DEFAULT_SAFETY_SETTINGS, DEFAULT_THINKING_CONFIG, THINKING_SUPPORTED_MODELS, MODEL_PRICING, DEFAULT_MAX_OUTPUT_TOKENS };

// ── BaseGemini Class ─────────────────────────────────────────────────────────

/**
 * @typedef {import('./types').BaseGeminiOptions} BaseGeminiOptions
 * @typedef {import('./types').UsageData} UsageData
 * @typedef {import('./types').TransformationExample} TransformationExample
 */

/**
 * Base class for all ak-gemini wrappers.
 * Provides shared initialization, authentication, chat session management,
 * token estimation, cost tracking, and usage reporting.
 *
 * Not typically instantiated directly — use Transformer, Chat, Message, ToolAgent, or CodeAgent.
 */
class BaseGemini {
	/**
	 * @param {BaseGeminiOptions} [options={}]
	 */
	constructor(options = {}) {
		// ── Model ──
		this.modelName = options.modelName || 'gemini-2.5-flash';

		// ── System Prompt ──
		// Subclasses set their own default if options.systemPrompt is undefined
		if (options.systemPrompt !== undefined) {
			this.systemPrompt = options.systemPrompt;
		} else {
			this.systemPrompt = null; // subclasses override this default
		}

		// ── Auth ──
		this.vertexai = options.vertexai || false;
		this.project = options.project || process.env.GOOGLE_CLOUD_PROJECT || null;
		this.location = options.location || process.env.GOOGLE_CLOUD_LOCATION || undefined;
		this.googleAuthOptions = options.googleAuthOptions || null;
		this.apiKey = options.apiKey !== undefined && options.apiKey !== null ? options.apiKey : process.env.GEMINI_API_KEY;

		if (!this.vertexai && !this.apiKey) {
			throw new Error("Missing Gemini API key. Provide via options.apiKey or GEMINI_API_KEY env var. For Vertex AI, set vertexai: true with project and location.");
		}
		if (this.vertexai && !this.project) {
			throw new Error("Vertex AI requires a project ID. Provide via options.project or GOOGLE_CLOUD_PROJECT env var.");
		}

		// ── Logging ──
		this._configureLogLevel(options.logLevel);

		// ── Labels ──
		this.labels = options.labels || {};

		// ── Chat Config ──
		this.chatConfig = {
			temperature: 0.7,
			topP: 0.95,
			topK: 64,
			safetySettings: DEFAULT_SAFETY_SETTINGS,
			...options.chatConfig
		};

		// Apply systemPrompt to chatConfig
		if (this.systemPrompt) {
			this.chatConfig.systemInstruction = this.systemPrompt;
		} else if (this.systemPrompt === null && options.systemPrompt === undefined) {
			// Subclass hasn't set a default yet — leave systemInstruction alone
			// (subclass constructor will handle it)
		} else if (options.systemPrompt === null || options.systemPrompt === false) {
			// Explicitly disabled
			delete this.chatConfig.systemInstruction;
		}

		// ── Max Output Tokens ──
		if (options.maxOutputTokens !== undefined) {
			if (options.maxOutputTokens === null) {
				delete this.chatConfig.maxOutputTokens;
			} else {
				this.chatConfig.maxOutputTokens = options.maxOutputTokens;
			}
		} else if (options.chatConfig?.maxOutputTokens !== undefined) {
			if (options.chatConfig.maxOutputTokens === null) {
				delete this.chatConfig.maxOutputTokens;
			}
			// else already set via spread above
		} else {
			this.chatConfig.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
		}

		// ── Thinking Config ──
		this._configureThinking(options.thinkingConfig);

		// ── GenAI Client ──
		const clientOptions = this.vertexai
			? {
				vertexai: true,
				project: this.project,
				...(this.location && { location: this.location }),
				...(this.googleAuthOptions && { googleAuthOptions: this.googleAuthOptions })
			}
			: { apiKey: this.apiKey };

		this.genAIClient = new GoogleGenAI(clientOptions);

		// ── State ──
		this.chatSession = null;
		this.lastResponseMetadata = null;
		this.exampleCount = 0;
		this._cumulativeUsage = {
			promptTokens: 0,
			responseTokens: 0,
			totalTokens: 0,
			attempts: 0
		};

		log.debug(`${this.constructor.name} created with model: ${this.modelName}`);
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

		log.debug(`Initializing ${this.constructor.name} chat session with model: ${this.modelName}...`);

		const chatOptions = this._getChatCreateOptions();
		this.chatSession = this.genAIClient.chats.create(chatOptions);

		try {
			await this.genAIClient.models.list();
			log.debug(`${this.constructor.name}: API connection successful.`);
		} catch (e) {
			throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
		}

		log.debug(`${this.constructor.name}: Chat session initialized.`);
	}

	/**
	 * Builds the options object for `genAIClient.chats.create()`.
	 * Override in subclasses to add tools, grounding, etc.
	 * @returns {Object}
	 * @protected
	 */
	_getChatCreateOptions() {
		return {
			model: this.modelName,
			config: {
				...this.chatConfig,
				...(this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels })
			},
			history: []
		};
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
			log.warn("Chat session not initialized. No history available.");
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
			log.warn(`Cannot clear history: chat not initialized.`);
			return;
		}
		this.chatSession = this._createChatSession([]);
		this.lastResponseMetadata = null;
		this._cumulativeUsage = { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 0 };
		log.debug(`${this.constructor.name}: Conversation history cleared.`);
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
			log.debug("No examples provided. Skipping seeding.");
			return this.getHistory();
		}

		const promptKey = opts.promptKey || 'PROMPT';
		const answerKey = opts.answerKey || 'ANSWER';
		const contextKey = opts.contextKey || 'CONTEXT';
		const explanationKey = opts.explanationKey || 'EXPLANATION';
		const systemPromptKey = opts.systemPromptKey || 'SYSTEM';

		// Check for system prompt override in examples
		const instructionExample = examples.find(ex => ex[systemPromptKey]);
		if (instructionExample) {
			log.debug(`Found system prompt in examples; reinitializing chat.`);
			this.systemPrompt = instructionExample[systemPromptKey];
			this.chatConfig.systemInstruction = this.systemPrompt;
			await this.init(true);
		}

		log.debug(`Seeding chat with ${examples.length} examples...`);
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
				userText += `CONTEXT:\n${contextText}\n\n`;
			}

			if (promptValue) {
				let promptText = isJSON(promptValue) ? JSON.stringify(promptValue, null, 2) : promptValue;
				userText += promptText;
			}

			if (answerValue) modelResponse.data = answerValue;
			if (explanationValue) modelResponse.explanation = explanationValue;
			const modelText = JSON.stringify(modelResponse, null, 2);

			if (userText.trim().length && modelText.trim().length > 0) {
				historyToAdd.push({ role: 'user', parts: [{ text: userText.trim() }] });
				historyToAdd.push({ role: 'model', parts: [{ text: modelText.trim() }] });
			}
		}

		const currentHistory = this.chatSession?.getHistory() || [];
		log.debug(`Adding ${historyToAdd.length} items to chat history (${currentHistory.length} existing)...`);

		this.chatSession = this._createChatSession([...currentHistory, ...historyToAdd]);

		this.exampleCount = currentHistory.length + historyToAdd.length;

		const newHistory = this.chatSession.getHistory();
		log.debug(`Chat session now has ${newHistory.length} history items.`);
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
			timestamp: Date.now()
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
			timestamp: meta.timestamp
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

		const nextMessage = typeof nextPayload === "string"
			? nextPayload
			: JSON.stringify(nextPayload, null, 2);

		contents.push({ parts: [{ text: nextMessage }] });

		const resp = await this.genAIClient.models.countTokens({
			model: this.modelName,
			contents,
		});

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
			pricing: pricing,
			estimatedInputCost: (tokenInfo.inputTokens / 1_000_000) * pricing.input,
			note: 'Cost is for input tokens only; output cost depends on response length'
		};
	}

	// ── Private Helpers ──────────────────────────────────────────────────────

	/**
	 * Configures the log level based on options, env vars, or NODE_ENV.
	 * @param {string} [logLevel]
	 * @private
	 */
	_configureLogLevel(logLevel) {
		if (logLevel) {
			if (logLevel === 'none') {
				log.level = 'silent';
			} else {
				log.level = logLevel;
			}
		} else if (LOG_LEVEL) {
			log.level = LOG_LEVEL;
		} else if (NODE_ENV === 'dev') {
			log.level = 'debug';
		} else if (NODE_ENV === 'test') {
			log.level = 'warn';
		} else if (NODE_ENV.startsWith('prod')) {
			log.level = 'error';
		} else {
			log.level = 'info';
		}
	}

	/**
	 * Configures thinking settings based on model support.
	 * @param {Object|null|undefined} thinkingConfig
	 * @private
	 */
	_configureThinking(thinkingConfig) {
		const modelSupportsThinking = THINKING_SUPPORTED_MODELS.some(p => p.test(this.modelName));

		if (thinkingConfig === undefined) return;

		if (thinkingConfig === null) {
			delete this.chatConfig.thinkingConfig;
			log.debug(`thinkingConfig set to null - removed from configuration`);
			return;
		}

		if (!modelSupportsThinking) {
			log.warn(`Model ${this.modelName} does not support thinking features. Ignoring thinkingConfig.`);
			return;
		}

		const config = { ...DEFAULT_THINKING_CONFIG, ...thinkingConfig };
		if (thinkingConfig.thinkingLevel !== undefined) {
			delete config.thinkingBudget;
		}
		this.chatConfig.thinkingConfig = config;
		log.debug(`Thinking config applied: ${JSON.stringify(config)}`);
	}
}

export default BaseGemini;
