/**
 * @fileoverview ToolAgent class — AI agent with user-provided tools.
 * Extends BaseGemini with automatic tool-use loops for both streaming
 * and non-streaming conversations.
 */

import BaseGemini from './base.js';
import log from './logger.js';

/**
 * @typedef {import('./types').ToolAgentOptions} ToolAgentOptions
 * @typedef {import('./types').AgentResponse} AgentResponse
 * @typedef {import('./types').AgentStreamEvent} AgentStreamEvent
 */

/**
 * AI agent that uses user-provided tools to accomplish tasks.
 * Automatically manages the tool-use loop: when the model decides to call
 * a tool, the agent executes it via your toolExecutor, sends the result back,
 * and continues until the model produces a final text response.
 *
 * Ships with zero built-in tools — you provide everything via the constructor.
 *
 * @example
 * ```javascript
 * import { ToolAgent } from 'ak-gemini';
 *
 * const agent = new ToolAgent({
 *   systemPrompt: 'You are a research assistant.',
 *   tools: [
 *     {
 *       name: 'http_get',
 *       description: 'Fetch a URL and return its contents',
 *       parametersJsonSchema: {
 *         type: 'object',
 *         properties: { url: { type: 'string', description: 'The URL to fetch' } },
 *         required: ['url']
 *       }
 *     }
 *   ],
 *   toolExecutor: async (toolName, args) => {
 *     if (toolName === 'http_get') {
 *       const res = await fetch(args.url);
 *       return { status: res.status, body: await res.text() };
 *     }
 *     throw new Error(`Unknown tool: ${toolName}`);
 *   }
 * });
 *
 * const result = await agent.chat('Fetch https://api.example.com/data and summarize it');
 * console.log(result.text);      // Agent's summary
 * console.log(result.toolCalls); // [{ name: 'http_get', args: {...}, result: {...} }]
 * ```
 */
class ToolAgent extends BaseGemini {
	/**
	 * @param {ToolAgentOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: 'You are a helpful AI assistant.' };
		}

		super(options);

		// ── Tools ──
		this.tools = options.tools || [];
		this.toolExecutor = options.toolExecutor || null;

		// Validate: if tools provided, executor is required (and vice versa)
		if (this.tools.length > 0 && !this.toolExecutor) {
			throw new Error("ToolAgent: tools provided without a toolExecutor. Provide a toolExecutor function to handle tool calls.");
		}
		if (this.toolExecutor && this.tools.length === 0) {
			throw new Error("ToolAgent: toolExecutor provided without tools. Provide tool declarations so the model knows what tools are available.");
		}

		// ── Tool loop config ──
		this.maxToolRounds = options.maxToolRounds || 10;
		this.onToolCall = options.onToolCall || null;
		this.onBeforeExecution = options.onBeforeExecution || null;
		this._stopped = false;

		// ── Apply tools to chat config ──
		if (this.tools.length > 0) {
			this.chatConfig.tools = [{ functionDeclarations: this.tools }];
			this.chatConfig.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
		}

		log.debug(`ToolAgent created with ${this.tools.length} tools`);
	}

	// ── Non-Streaming Chat ───────────────────────────────────────────────────

	/**
	 * Send a message and get a complete response (non-streaming).
	 * Automatically handles the tool-use loop.
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @param {Record<string, string>} [opts.labels] - Per-message billing labels
	 * @returns {Promise<AgentResponse>} Response with text, toolCalls, and usage
	 */
	async chat(message, opts = {}) {
		if (!this.chatSession) await this.init();
		this._stopped = false;

		const allToolCalls = [];

		let response = await this.chatSession.sendMessage({ message });

		for (let round = 0; round < this.maxToolRounds; round++) {
			if (this._stopped) break;

			const functionCalls = response.functionCalls;
			if (!functionCalls || functionCalls.length === 0) break;

			const toolResults = await Promise.all(
				functionCalls.map(async (call) => {
					// Fire onToolCall callback
					if (this.onToolCall) {
						try { this.onToolCall(call.name, call.args); }
						catch (e) { log.warn(`onToolCall callback error: ${e.message}`); }
					}

					// Check onBeforeExecution gate
					if (this.onBeforeExecution) {
						try {
							const allowed = await this.onBeforeExecution(call.name, call.args);
							if (allowed === false) {
								const result = { error: 'Execution denied by onBeforeExecution callback' };
								allToolCalls.push({ name: call.name, args: call.args, result });
								return { id: call.id, name: call.name, result };
							}
						} catch (e) {
							log.warn(`onBeforeExecution callback error: ${e.message}`);
						}
					}

					let result;
					try {
						result = await this.toolExecutor(call.name, call.args);
					} catch (err) {
						log.warn(`Tool ${call.name} failed: ${err.message}`);
						result = { error: err.message };
					}

					allToolCalls.push({ name: call.name, args: call.args, result });

					return { id: call.id, name: call.name, result };
				})
			);

			// Send function responses back to the model
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

		this._captureMetadata(response);

		// Set cumulative usage
		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		return {
			text: response.text || '',
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
		let fullText = '';

		let streamResponse = await this.chatSession.sendMessageStream({ message });

		for (let round = 0; round < this.maxToolRounds; round++) {
			if (this._stopped) break;

			let roundText = '';
			const functionCalls = [];

			// Consume the stream
			for await (const chunk of streamResponse) {
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
				yield {
					type: 'done',
					fullText,
					usage: this.getLastUsage()
				};
				return;
			}

			// Execute tools sequentially so we can yield events
			const toolResults = [];
			for (const call of functionCalls) {
				if (this._stopped) break;

				yield { type: 'tool_call', toolName: call.name, args: call.args };

				// Fire onToolCall callback
				if (this.onToolCall) {
					try { this.onToolCall(call.name, call.args); }
					catch (e) { log.warn(`onToolCall callback error: ${e.message}`); }
				}

				// Check onBeforeExecution gate
				let denied = false;
				if (this.onBeforeExecution) {
					try {
						const allowed = await this.onBeforeExecution(call.name, call.args);
						if (allowed === false) denied = true;
					} catch (e) {
						log.warn(`onBeforeExecution callback error: ${e.message}`);
					}
				}

				let result;
				if (denied) {
					result = { error: 'Execution denied by onBeforeExecution callback' };
				} else {
					try {
						result = await this.toolExecutor(call.name, call.args);
					} catch (err) {
						log.warn(`Tool ${call.name} failed: ${err.message}`);
						result = { error: err.message };
					}
				}

				allToolCalls.push({ name: call.name, args: call.args, result });
				yield { type: 'tool_result', toolName: call.name, result };

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

		// Max rounds reached or stopped
		yield {
			type: 'done',
			fullText,
			usage: this.getLastUsage(),
			warning: this._stopped ? 'Agent was stopped' : 'Max tool rounds reached'
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
		log.info('ToolAgent stopped');
	}
}

export default ToolAgent;
