/**
 * @fileoverview AIAgent class for chat-based agent interactions with built-in tools.
 * Supports streaming and non-streaming conversations with HTTP and markdown tools.
 */

import dotenv from 'dotenv';
dotenv.config();
const { NODE_ENV = "unknown", LOG_LEVEL = "" } = process.env;

import { GoogleGenAI, HarmCategory, HarmBlockThreshold, ThinkingLevel } from '@google/genai';
import log from './logger.js';
import { BUILT_IN_DECLARATIONS, executeBuiltInTool } from './tools.js';

const DEFAULT_SAFETY_SETTINGS = [
	{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
];

const DEFAULT_THINKING_CONFIG = {
	thinkingBudget: 0
};

const THINKING_SUPPORTED_MODELS = [
	/^gemini-3-flash(-preview)?$/,
	/^gemini-3-pro(-preview|-image-preview)?$/,
	/^gemini-2\.5-pro/,
	/^gemini-2\.5-flash(-preview)?$/,
	/^gemini-2\.5-flash-lite(-preview)?$/,
	/^gemini-2\.0-flash$/
];

/**
 * @typedef {import('./types').AIAgentOptions} AIAgentOptions
 * @typedef {import('./types').AgentResponse} AgentResponse
 * @typedef {import('./types').AgentStreamEvent} AgentStreamEvent
 * @typedef {import('./types').UsageData} UsageData
 */

/**
 * Chat-based AI agent with built-in tools for HTTP requests and markdown generation.
 *
 * Unlike AITransformer (which is optimized for few-shot JSON transformations), AIAgent
 * is designed for interactive, multi-turn conversations where the agent can take actions
 * on the user's behalf — like fetching data from APIs, posting to endpoints, and
 * generating structured markdown reports.
 *
 * Built-in tools:
 * - **http_get** — Fetch any URL (APIs, web pages, etc.)
 * - **http_post** — POST JSON to any endpoint
 * - **write_markdown** — Generate markdown documents (reports, summaries, findings)
 *
 * The agent automatically manages the tool-use loop: when the model decides to call
 * a tool, the agent executes it, sends the result back, and continues until the model
 * produces a final text response.
 *
 * @example
 * ```javascript
 * import { AIAgent } from 'ak-gemini';
 *
 * const agent = new AIAgent({
 *   systemPrompt: 'You are a research assistant...',
 *   onMarkdown: (filename, content) => fs.writeFileSync(filename, content)
 * });
 *
 * // Non-streaming
 * const res = await agent.chat('Fetch https://api.example.com/data and summarize it');
 * console.log(res.text);          // Agent's response
 * console.log(res.toolCalls);     // [{name, args, result}, ...]
 * console.log(res.markdownFiles); // [{filename, content}, ...]
 *
 * // Streaming
 * for await (const event of agent.stream('Write a report on...')) {
 *   if (event.type === 'text') process.stdout.write(event.text);
 *   if (event.type === 'tool_call') console.log(`Calling: ${event.toolName}`);
 *   if (event.type === 'done') console.log('\nDone!');
 * }
 * ```
 */
class AIAgent {
	/**
	 * Create a new AIAgent instance.
	 * @param {AIAgentOptions} [options={}] - Configuration options (see AIAgentOptions in types.d.ts)
	 */
	constructor(options = {}) {
		this.modelName = options.modelName || 'gemini-2.5-flash';
		this.systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';
		this.maxToolRounds = options.maxToolRounds || 10;
		this.httpTimeout = options.httpTimeout || 30000;
		this.maxRetries = options.maxRetries || 3;
		this.onToolCall = options.onToolCall || null;
		this.onMarkdown = options.onMarkdown || null;
		this.labels = options.labels || {};

		// Auth - same as AITransformer
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

		// Log level
		this._configureLogLevel(options.logLevel);

		// Build chat config
		this.chatConfig = {
			temperature: 0.7,
			topP: 0.95,
			topK: 64,
			safetySettings: DEFAULT_SAFETY_SETTINGS,
			systemInstruction: this.systemPrompt,
			maxOutputTokens: options.chatConfig?.maxOutputTokens || 50_000,
			...options.chatConfig
		};

		// Ensure systemPrompt takes precedence over chatConfig.systemInstruction
		this.chatConfig.systemInstruction = this.systemPrompt;

		// Thinking config
		this._configureThinking(options.thinkingConfig);

		// Tools config
		this.chatConfig.tools = [{ functionDeclarations: BUILT_IN_DECLARATIONS }];
		this.chatConfig.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };

		// State
		this.genAIClient = null;
		this.chatSession = null;
		this.lastResponseMetadata = null;
		this._markdownFiles = [];

		log.debug(`AIAgent created with model: ${this.modelName}`);
	}

	/**
	 * Initialize the agent — creates the GenAI client and chat session.
	 * Called automatically by chat() and stream() if not called explicitly.
	 * Idempotent — safe to call multiple times.
	 * @returns {Promise<void>}
	 */
	async init() {
		if (this.chatSession) return;

		const clientOptions = this.vertexai
			? {
				vertexai: true,
				project: this.project,
				...(this.location && { location: this.location }),
				...(this.googleAuthOptions && { googleAuthOptions: this.googleAuthOptions })
			}
			: { apiKey: this.apiKey };

		this.genAIClient = new GoogleGenAI(clientOptions);

		this.chatSession = this.genAIClient.chats.create({
			model: this.modelName,
			config: {
				...this.chatConfig,
				...(this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels })
			},
			history: []
		});

		try {
			await this.genAIClient.models.list();
			log.debug("AIAgent: Gemini API connection successful.");
		} catch (e) {
			throw new Error(`AIAgent initialization failed: ${e.message}`);
		}

		log.debug("AIAgent: Chat session initialized.");
	}

	/**
	 * Send a message and get a complete response (non-streaming).
	 * Automatically handles the tool-use loop — if the model requests tool calls,
	 * they are executed and results sent back until the model produces a final response.
	 *
	 * @param {string} message - The user's message
	 * @returns {Promise<AgentResponse>} Response with text, toolCalls, markdownFiles, and usage
	 * @example
	 * const res = await agent.chat('Fetch https://api.example.com/users');
	 * console.log(res.text);      // Agent's summary
	 * console.log(res.toolCalls); // [{name: 'http_get', args: {...}, result: {...}}]
	 */
	async chat(message) {
		if (!this.chatSession) await this.init();

		this._markdownFiles = [];
		const allToolCalls = [];

		let response = await this.chatSession.sendMessage({ message });

		for (let round = 0; round < this.maxToolRounds; round++) {
			const functionCalls = response.functionCalls;
			if (!functionCalls || functionCalls.length === 0) break;

			// Execute all tool calls in parallel
			const toolResults = await Promise.all(
				functionCalls.map(async (call) => {
					let result;
					try {
						result = await executeBuiltInTool(call.name, call.args, {
							httpTimeout: this.httpTimeout,
							onToolCall: this.onToolCall,
							onMarkdown: this.onMarkdown
						});
					} catch (err) {
						log.warn(`Tool ${call.name} failed: ${err.message}`);
						result = { error: err.message };
					}

					allToolCalls.push({ name: call.name, args: call.args, result });

					// Collect markdown files
					if (call.name === 'write_markdown' && call.args) {
						this._markdownFiles.push({
							filename: /** @type {string} */ (call.args.filename),
							content: /** @type {string} */ (call.args.content)
						});
					}

					return { id: call.id, name: call.name, result };
				})
			);

			// Send all function responses back to the model
			response = await this.chatSession.sendMessage({
				message: toolResults.map(r => ({
					functionResponse: {
						id: r.id,
						name: r.name,
						response: { output: r.result }
					}
				}))
			});
		}

		// Capture metadata
		this._captureMetadata(response);

		return {
			text: response.text || '',
			toolCalls: allToolCalls,
			markdownFiles: [...this._markdownFiles],
			usage: this.getLastUsage()
		};
	}

	/**
	 * Send a message and stream the response as events.
	 * Automatically handles the tool-use loop between streamed rounds.
	 *
	 * Event types:
	 * - `text` — A chunk of the agent's text response (yield as it arrives)
	 * - `tool_call` — The agent is about to call a tool (includes toolName and args)
	 * - `tool_result` — A tool finished executing (includes toolName and result)
	 * - `markdown` — A markdown document was generated (includes filename and content)
	 * - `done` — The agent finished (includes fullText, markdownFiles, usage)
	 *
	 * @param {string} message - The user's message
	 * @yields {AgentStreamEvent}
	 * @example
	 * for await (const event of agent.stream('Analyze this API...')) {
	 *   if (event.type === 'text') process.stdout.write(event.text);
	 *   if (event.type === 'tool_call') console.log(`Calling: ${event.toolName}`);
	 *   if (event.type === 'done') console.log(`\nTokens: ${event.usage?.totalTokens}`);
	 * }
	 */
	async *stream(message) {
		if (!this.chatSession) await this.init();

		this._markdownFiles = [];
		const allToolCalls = [];
		let fullText = '';

		let streamResponse = await this.chatSession.sendMessageStream({ message });

		for (let round = 0; round < this.maxToolRounds; round++) {
			let roundText = '';
			const functionCalls = [];

			// Consume the stream
			for await (const chunk of streamResponse) {
				// Check for function calls first (accessing .text when functionCall parts
				// exist triggers a warning from the SDK)
				if (chunk.functionCalls) {
					functionCalls.push(...chunk.functionCalls);
				} else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
					const text = chunk.candidates[0].content.parts[0].text;
					roundText += text;
					fullText += text;
					yield { type: 'text', text };
				}
			}

			// No tool calls — we're done
			if (functionCalls.length === 0) {
				// Capture metadata from the last chunk's aggregated response
				// (streaming doesn't give us a final response object easily,
				// so metadata may be limited here)
				yield {
					type: 'done',
					fullText,
					markdownFiles: [...this._markdownFiles],
					usage: this.getLastUsage()
				};
				return;
			}

			// Execute tools sequentially so we can yield events
			const toolResults = [];
			for (const call of functionCalls) {
				yield { type: 'tool_call', toolName: call.name, args: call.args };

				let result;
				try {
					result = await executeBuiltInTool(call.name, call.args, {
						httpTimeout: this.httpTimeout,
						onToolCall: this.onToolCall,
						onMarkdown: this.onMarkdown
					});
				} catch (err) {
					log.warn(`Tool ${call.name} failed: ${err.message}`);
					result = { error: err.message };
				}

				allToolCalls.push({ name: call.name, args: call.args, result });
				yield { type: 'tool_result', toolName: call.name, result };

				if (call.name === 'write_markdown' && call.args) {
					const mdFilename = /** @type {string} */ (call.args.filename);
					const mdContent = /** @type {string} */ (call.args.content);
					this._markdownFiles.push({ filename: mdFilename, content: mdContent });
					yield { type: 'markdown', filename: mdFilename, content: mdContent };
				}

				toolResults.push({ id: call.id, name: call.name, result });
			}

			// Send function responses back and get next stream
			streamResponse = await this.chatSession.sendMessageStream({
				message: toolResults.map(r => ({
					functionResponse: {
						id: r.id,
						name: r.name,
						response: { output: r.result }
					}
				}))
			});
		}

		// Max rounds reached
		yield {
			type: 'done',
			fullText,
			markdownFiles: [...this._markdownFiles],
			usage: this.getLastUsage(),
			warning: 'Max tool rounds reached'
		};
	}

	/**
	 * Clear conversation history while preserving tools and system prompt.
	 * Useful for starting a new user session without re-initializing the agent.
	 * @returns {Promise<void>}
	 */
	async clearHistory() {
		this.chatSession = this.genAIClient.chats.create({
			model: this.modelName,
			config: {
				...this.chatConfig,
				...(this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels })
			},
			history: []
		});
		this._markdownFiles = [];
		this.lastResponseMetadata = null;
		log.debug("AIAgent: Conversation history cleared.");
	}

	/**
	 * Get conversation history.
	 * @param {boolean} [curated=false]
	 * @returns {any[]}
	 */
	getHistory(curated = false) {
		if (!this.chatSession) return [];
		return this.chatSession.getHistory(curated);
	}

	/**
	 * Get structured usage data from the last API call.
	 * Returns null if no API call has been made yet.
	 * @returns {UsageData|null} Usage data with promptTokens, responseTokens, totalTokens, etc.
	 */
	getLastUsage() {
		if (!this.lastResponseMetadata) return null;
		const m = this.lastResponseMetadata;
		return {
			promptTokens: m.promptTokens,
			responseTokens: m.responseTokens,
			totalTokens: m.totalTokens,
			attempts: 1,
			modelVersion: m.modelVersion,
			requestedModel: this.modelName,
			timestamp: m.timestamp
		};
	}

	// --- Private helpers ---

	/**
	 * Capture response metadata (model version, token counts) from an API response.
	 * @param {import('@google/genai').GenerateContentResponse} response
	 * @private
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

	/** @private */
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

	/** @private */
	_configureThinking(thinkingConfig) {
		const modelSupportsThinking = THINKING_SUPPORTED_MODELS.some(p => p.test(this.modelName));

		if (thinkingConfig === undefined) return;

		if (thinkingConfig === null) {
			delete this.chatConfig.thinkingConfig;
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

export default AIAgent;
