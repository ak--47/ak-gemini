/**
 * @fileoverview Chat class — multi-turn text conversation with AI.
 * Extends BaseGemini with simple send/receive text messaging and conversation history.
 */

import BaseGemini from './base.js';
import log from './logger.js';

/**
 * @typedef {import('./types').ChatOptions} ChatOptions
 * @typedef {import('./types').ChatResponse} ChatResponse
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
	 * Send a text message and get a response. Adds to conversation history.
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @param {Record<string, string>} [opts.labels] - Per-message billing labels
	 * @returns {Promise<ChatResponse>} Response with text and usage data
	 */
	async send(message, opts = {}) {
		if (!this.chatSession) await this.init();

		const mergedLabels = { ...this.labels, ...(opts.labels || {}) };
		const hasLabels = this.vertexai && Object.keys(mergedLabels).length > 0;

		const sendParams = { message };
		if (hasLabels) {
			sendParams.config = { labels: mergedLabels };
		}

		const result = await this.chatSession.sendMessage(sendParams);

		this._captureMetadata(result);

		// Set cumulative usage (single attempt for Chat)
		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		return {
			text: result.text || '',
			usage: this.getLastUsage()
		};
	}
}

export default Chat;
