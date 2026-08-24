/**
 * @fileoverview Chat class — multi-turn text conversation with AI.
 * Extends BaseGemini with simple send/receive text messaging and conversation history.
 */

import BaseGemini from './base.js';
import log from './logger.js';

/**
 * @typedef {import('./types').ChatOptions} ChatOptions
 * @typedef {import('./types').ChatResponse} ChatResponse
 * @typedef {import('./types').ChatStreamEvent} ChatStreamEvent
 */

/**
 * Multi-turn text conversation with AI.
 * Maintains conversation history for contextual back-and-forth exchanges.
 * Returns plain text responses (not JSON).
 *
 * @example
 * ```javascript
 * import { Chat } from 'ak-gemini';
 *
 * const chat = new Chat({
 *   systemPrompt: 'You are a friendly tutor who explains concepts simply.'
 * });
 *
 * await chat.init();
 * const r1 = await chat.send('What is recursion?');
 * console.log(r1.text);
 *
 * const r2 = await chat.send('Can you give me an example in JavaScript?');
 * console.log(r2.text); // Remembers the recursion context
 * ```
 */
class Chat extends BaseGemini {
	/**
	 * @param {ChatOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: 'You are a helpful AI assistant.' };
		}

		super(options);

		log.debug(`Chat created with model: ${this.modelName}`);
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
		return super.seed(examples, { format: 'text', ...opts });
	}

	/**
	 * Send a text message and get a response. Adds to conversation history.
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @param {Record<string, string>} [opts.labels] - Per-message billing labels
	 * @returns {Promise<ChatResponse>} Response with text and usage data
	 */
	async send(message, opts = {}) {
		if (!this.chatSession) await this.init();

		// Only set a per-message config when there is something to override — it
		// REPLACES the session config in @google/genai. See _getSendConfig().
		const sendParams = { message };
		const config = this._getSendConfig(opts.labels);
		if (config) sendParams.config = config;

		this._resetUsage();
		const result = await this._withRetry(() => this.chatSession.sendMessage(sendParams));
		this._accumulateUsage(result);

		return {
			text: result.text || '',
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

		let fullText = '';
		const sendParams = { message };
		const config = this._getSendConfig(opts.labels);
		if (config) sendParams.config = config;

		this._resetUsage();
		const usage = this._streamUsage();
		const streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream(sendParams));

		for await (const chunk of streamResponse) {
			usage.track(chunk);
			for (const text of this._chunkTextParts(chunk)) {
				fullText += text;
				yield { type: 'text', text };
			}
		}

		usage.commit();

		yield {
			type: 'done',
			fullText,
			usage: this.getLastUsage()
		};
	}
}

export default Chat;
