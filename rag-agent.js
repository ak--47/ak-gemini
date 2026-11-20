/**
 * @fileoverview RagAgent class — AI agent for document & data Q&A.
 *
 * NOTE: This is not true RAG (no vector embeddings, chunking, or similarity
 * search). It uses long-context injection — all content is placed directly
 * into the model's context window. Named "RagAgent" because it serves the
 * same purpose in spirit: grounding AI responses in user-provided data.
 *
 * Supports three input types:
 * - remoteFiles: uploaded via Google Files API (PDFs, images, audio, video)
 * - localFiles: read from disk as text (md, json, csv, yaml, txt)
 * - localData: in-memory objects serialized as JSON
 */

import { resolve, basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import BaseGemini from './base.js';
import log from './logger.js';
import { MIME_TYPES, LEGACY_MIME_TYPES, uploadFile, waitForFileActive } from './files.js';

/** Resolved paths already warned about (one warning per file per process). */
const _warnedRemoteFiles = new Set();

/**
 * @typedef {import('./types').RagAgentOptions} RagAgentOptions
 * @typedef {import('./types').RagResponse} RagResponse
 * @typedef {import('./types').RagStreamEvent} RagStreamEvent
 * @typedef {import('./types').LocalDataEntry} LocalDataEntry
 */

const DEFAULT_SYSTEM_PROMPT =
	'You are a helpful AI assistant. Answer questions based on the provided documents and data. ' +
	'When referencing information, mention which document or data source it comes from.';

/**
 * AI agent that answers questions grounded in user-provided documents and data.
 * Supports three input types:
 * - `remoteFiles` — uploaded via Google Files API (PDFs, images, audio, video)
 * - `localFiles` — read from disk as text (md, json, csv, yaml, txt)
 * - `localData` — in-memory objects serialized as JSON
 *
 * @example
 * ```javascript
 * import { RagAgent } from 'ak-gemini';
 *
 * const agent = new RagAgent({
 *   remoteFiles: ['./report.pdf', './diagram.png'],
 *   localFiles: ['./docs/api.md', './config.yaml'],
 *   localData: [
 *     { name: 'users', data: [{ id: 1, name: 'Alice' }] },
 *   ],
 * });
 *
 * const result = await agent.chat('What does the API doc say about auth?');
 * console.log(result.text);
 *
 * // Streaming
 * for await (const event of agent.stream('Summarize the report')) {
 *   if (event.type === 'text') process.stdout.write(event.text);
 * }
 * ```
 */
class RagAgent extends BaseGemini {
	/**
	 * @param {RagAgentOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: DEFAULT_SYSTEM_PROMPT };
		}

		super(options);

		this.remoteFiles = options.remoteFiles || [];
		this.localFiles = options.localFiles || [];
		this.localData = options.localData || [];
		this._uploadedRemoteFiles = [];
		this._localFileContents = [];
		this._initialized = false;

		const total = this.remoteFiles.length + this.localFiles.length + this.localData.length;
		log.debug(`RagAgent created with ${total} context sources`);
	}

	// ── Initialization ───────────────────────────────────────────────────────

	/**
	 * Uploads remote files, reads local files, and seeds all context into the chat.
	 * @param {boolean} [force=false]
	 * @returns {Promise<void>}
	 */
	async init(force = false) {
		if (this._initialized && !force) return;

		// 1. Upload remote files via Files API
		this._uploadedRemoteFiles = [];
		for (const filePath of this.remoteFiles) {
			const resolvedPath = resolve(filePath);
			log.debug(`Uploading remote file: ${resolvedPath}`);

			const ext = extname(resolvedPath).toLowerCase();
			// Lenient by design (3.0.0 behaviour): unknown types still upload.
			const mimeType = LEGACY_MIME_TYPES[ext] || MIME_TYPES[ext] || 'application/octet-stream';
			if (!MIME_TYPES[ext] && !_warnedRemoteFiles.has(resolvedPath)) {
				_warnedRemoteFiles.add(resolvedPath);
				log.warn(`RagAgent.remoteFiles: "${basename(resolvedPath)}" (${ext || 'no extension'}) is not a format Gemini reads natively; uploading anyway. The strict "files" option would reject it.`);
			}

			const uploaded = await this._withRetry(async () => uploadFile(await this._ensureClient(), resolvedPath, {
				displayName: basename(resolvedPath), mimeType
			}));

			await this._waitForFileActive(uploaded);

			this._uploadedRemoteFiles.push({
				...uploaded,
				originalPath: resolvedPath
			});

			log.debug(`File uploaded: ${uploaded.displayName} (${uploaded.mimeType})`);
		}

		// 2. Read local files from disk
		this._localFileContents = [];
		for (const filePath of this.localFiles) {
			const resolvedPath = resolve(filePath);
			log.debug(`Reading local file: ${resolvedPath}`);

			const content = await readFile(resolvedPath, 'utf-8');
			this._localFileContents.push({
				name: basename(resolvedPath),
				content,
				path: resolvedPath
			});

			log.debug(`Local file read: ${basename(resolvedPath)} (${content.length} chars)`);
		}

		// 3. Set system instruction and create chat session
		this.chatConfig.systemInstruction = /** @type {string} */ (this.systemPrompt);
		await super.init(force);

		// 4. Build unified context parts and seed into chat history
		/** @type {Array<Object>} */
		const parts = [];

		// Remote file references
		for (const f of this._uploadedRemoteFiles) {
			parts.push({ fileData: { fileUri: f.uri, mimeType: f.mimeType } });
		}

		// Local file contents
		for (const lf of this._localFileContents) {
			parts.push({ text: `--- File: ${lf.name} ---\n${lf.content}` });
		}

		// Local data entries
		for (const ld of this.localData) {
			const serialized = typeof ld.data === 'string' ? ld.data : JSON.stringify(ld.data, null, 2);
			parts.push({ text: `--- Data: ${ld.name} ---\n${serialized}` });
		}

		if (parts.length > 0) {
			parts.push({ text: 'Here are the documents and data to analyze.' });

			const history = [
				{ role: 'user', parts },
				{ role: 'model', parts: [{ text: 'I have reviewed all the provided documents and data. I am ready to answer your questions about them.' }] }
			];

			this.chatSession = this._createChatSession(history);
		}

		this._initialized = true;
		log.debug(`RagAgent initialized with ${this._uploadedRemoteFiles.length} remote files, ${this._localFileContents.length} local files, ${this.localData.length} data entries`);
	}

	// ── Non-Streaming Chat ───────────────────────────────────────────────────

	/**
	 * Send a message and get a complete response grounded in the loaded context.
	 *
	 * @param {string} message - The user's question
	 * @param {Object} [opts={}] - Per-message options
	 * @param {Record<string, string>} [opts.labels] - Per-message billing labels
	 * @param {import('./types').FileInput|import('./types').FileInput[]} [opts.files] - Files sent after the message (strict)
	 * @returns {Promise<RagResponse>}
	 */
	async chat(message, opts = {}) {
		if (!this._initialized) await this.init();

		// undefined unless there are per-message label overrides; see _getSendConfig()
		const sendConfig = this._getSendConfig(opts.labels);
		const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
		this._resetUsage();
		const response = await this._withRetry(() => this.chatSession.sendMessage({
			message: userMessage,
			...(sendConfig && { config: sendConfig })
		}));
		this._accumulateUsage(response);

		return {
			text: response.text || '',
			usage: this.getLastUsage()
		};
	}

	// ── Streaming ────────────────────────────────────────────────────────────

	/**
	 * Send a message and stream the response as events.
	 *
	 * @param {string} message - The user's question
	 * @param {Object} [opts={}] - Per-message options
	 * @yields {RagStreamEvent}
	 */
	async *stream(message, opts = {}) {
		if (!this._initialized) await this.init();

		let fullText = '';
		// undefined unless there are per-message label overrides; see _getSendConfig()
		const sendConfig = this._getSendConfig(opts.labels);
		const { message: userMessage } = await this._buildUserParts(message, opts.files, { stateful: true });
		this._resetUsage();
		const usage = this._streamUsage();
		const streamResponse = await this._withRetry(() => this.chatSession.sendMessageStream({
			message: userMessage,
			...(sendConfig && { config: sendConfig })
		}));

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

	// ── Context Management ──────────────────────────────────────────────────

	/**
	 * Add remote files (uploaded via Files API). Triggers reinitialize.
	 * @param {string[]} paths
	 * @returns {Promise<void>}
	 */
	async addRemoteFiles(paths) {
		this.remoteFiles.push(...paths);
		await this.init(true);
	}

	/**
	 * Add local text files (read from disk). Triggers reinitialize.
	 * @param {string[]} paths
	 * @returns {Promise<void>}
	 */
	async addLocalFiles(paths) {
		this.localFiles.push(...paths);
		await this.init(true);
	}

	/**
	 * Add in-memory data entries. Triggers reinitialize.
	 * @param {LocalDataEntry[]} entries
	 * @returns {Promise<void>}
	 */
	async addLocalData(entries) {
		this.localData.push(...entries);
		await this.init(true);
	}

	/**
	 * Returns metadata about all context sources.
	 * @returns {{ remoteFiles: Array<Object>, localFiles: Array<Object>, localData: Array<Object> }}
	 */
	getContext() {
		return {
			remoteFiles: this._uploadedRemoteFiles.map(f => ({
				name: f.name,
				displayName: f.displayName,
				mimeType: f.mimeType,
				sizeBytes: f.sizeBytes,
				uri: f.uri,
				originalPath: f.originalPath
			})),
			localFiles: this._localFileContents.map(lf => ({
				name: lf.name,
				path: lf.path,
				size: lf.content.length
			})),
			localData: this.localData.map(ld => ({
				name: ld.name,
				type: typeof ld.data === 'object' && ld.data !== null
					? (Array.isArray(ld.data) ? 'array' : 'object')
					: typeof ld.data
			}))
		};
	}

	// ── Private Helpers ──────────────────────────────────────────────────────

	/**
	 * Polls until an uploaded file reaches ACTIVE state.
	 * @param {Object} file - The uploaded file object
	 * @returns {Promise<void>}
	 * @private
	 */
	async _waitForFileActive(file) {
		await waitForFileActive(await this._ensureClient(), file);
	}
}

export default RagAgent;
