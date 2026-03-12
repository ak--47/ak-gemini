/**
 * @fileoverview Built-in tool declarations and handlers for AIAgent.
 *
 * Tools are defined as @google/genai FunctionDeclaration objects and executed
 * by the agent's tool-use loop. HTTP response bodies are truncated to 50KB
 * to prevent context window overflow.
 *
 * Built-in tools:
 * - `http_get` — GET any URL, returns { status, statusText, body }
 * - `http_post` — POST JSON to any URL, returns { status, statusText, body }
 * - `write_markdown` — Generate a markdown document, returns { written, filename, length }
 */

import log from './logger.js';

/** Maximum characters kept from HTTP response bodies before truncation */
const MAX_RESPONSE_LENGTH = 50_000;

/**
 * Built-in function declarations for the @google/genai SDK.
 * These are passed as `functionDeclarations` in the chat config's tools array.
 * @type {Array<{name: string, description: string, parametersJsonSchema: object}>}
 */
export const BUILT_IN_DECLARATIONS = [
	{
		name: 'http_get',
		description: 'Make an HTTP GET request to any URL. Returns the response status and body as text. Use for fetching web pages, REST APIs, or any HTTP resource.',
		parametersJsonSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'The full URL to request (including https://)' },
				headers: {
					type: 'object',
					description: 'Optional HTTP headers as key-value pairs',
					additionalProperties: { type: 'string' }
				}
			},
			required: ['url']
		}
	},
	{
		name: 'http_post',
		description: 'Make an HTTP POST request to any URL with a JSON body. Returns the response status and body as text.',
		parametersJsonSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'The full URL to request (including https://)' },
				body: { type: 'object', description: 'The JSON body to send' },
				headers: {
					type: 'object',
					description: 'Optional HTTP headers as key-value pairs',
					additionalProperties: { type: 'string' }
				}
			},
			required: ['url']
		}
	},
	{
		name: 'write_markdown',
		description: 'Generate a structured markdown document such as a report, analysis, summary, or formatted findings. The content will be captured and returned to the caller.',
		parametersJsonSchema: {
			type: 'object',
			properties: {
				filename: { type: 'string', description: 'Suggested filename for the document (e.g. "report.md")' },
				title: { type: 'string', description: 'Document title' },
				content: { type: 'string', description: 'Full markdown content of the document' }
			},
			required: ['filename', 'content']
		}
	}
];

/**
 * Execute a built-in tool by name.
 * @param {string} name - Tool name
 * @param {Record<string, any>} args - Tool arguments
 * @param {object} options - Execution options
 * @param {number} [options.httpTimeout=30000] - HTTP request timeout in ms
 * @param {Function} [options.onToolCall] - Callback fired before tool execution
 * @param {Function} [options.onMarkdown] - Callback fired when markdown is generated
 * @returns {Promise<any>} Tool execution result
 */
export async function executeBuiltInTool(name, args, options = {}) {
	const { httpTimeout = 30000, onToolCall, onMarkdown } = options;

	if (onToolCall) {
		try { onToolCall(name, args); } catch (e) { log.warn(`onToolCall callback error: ${e.message}`); }
	}

	switch (name) {
		case 'http_get': {
			log.debug(`http_get: ${args.url}`);
			const resp = await fetch(args.url, {
				method: 'GET',
				headers: args.headers || {},
				signal: AbortSignal.timeout(httpTimeout)
			});
			const text = await resp.text();
			const body = text.length > MAX_RESPONSE_LENGTH
				? text.slice(0, MAX_RESPONSE_LENGTH) + '\n...[TRUNCATED]'
				: text;
			return { status: resp.status, statusText: resp.statusText, body };
		}

		case 'http_post': {
			log.debug(`http_post: ${args.url}`);
			const headers = { 'Content-Type': 'application/json', ...(args.headers || {}) };
			const resp = await fetch(args.url, {
				method: 'POST',
				headers,
				body: args.body ? JSON.stringify(args.body) : undefined,
				signal: AbortSignal.timeout(httpTimeout)
			});
			const text = await resp.text();
			const body = text.length > MAX_RESPONSE_LENGTH
				? text.slice(0, MAX_RESPONSE_LENGTH) + '\n...[TRUNCATED]'
				: text;
			return { status: resp.status, statusText: resp.statusText, body };
		}

		case 'write_markdown': {
			log.debug(`write_markdown: ${args.filename}`);
			if (onMarkdown) {
				try { onMarkdown(args.filename, args.content); } catch (e) { log.warn(`onMarkdown callback error: ${e.message}`); }
			}
			return { written: true, filename: args.filename, length: args.content.length };
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}
