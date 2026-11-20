/**
 * @fileoverview FileAgent — produce a file from a prompt, or read files with a prompt.
 *
 * `write()` routes by format: text formats go to the text model, images to an
 * image model, `.wav` to a TTS model. `read()` is a stateless send with `files`.
 * Stateless like Message: no history, no few-shot.
 *
 * @example
 * ```javascript
 * import { FileAgent } from 'ak-gemini';
 * const fa = new FileAgent({ vertexai: true });
 * await fa.write('a product photo of a red mug', { path: './out/mug.png' });
 * const { data } = await fa.write('quarterly summary as CSV', { format: 'csv' });
 * const { text } = await fa.read(['./invoice.pdf'], 'extract the total');
 * ```
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import BaseGemini from './base.js';
import { WRITE_FORMATS, writeFormatsFor, UnsupportedFormatError, pcmToWav, parsePcmMime, wavToPcm } from './files.js';
import { buildImageConfig, parseImageResponse } from './image-generator.js';
import { extractJSON } from './json-helpers.js';
import log from './logger.js';

const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';
// Measured 2026-11-20 on Vertex global and the Gemini API. Returns audio/wav.
const DEFAULT_SPEECH_MODEL = 'gemini-3.8-flash-tts';
const DEFAULT_VOICE = 'Kore';

/** MIME type of each writable format. */
const WRITE_MIME_TYPES = {
	txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
	yaml: 'application/yaml', yml: 'application/yaml', html: 'text/html', xml: 'text/xml',
	svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', wav: 'audio/wav'
};

/** jpg and jpeg name the same bytes. */
const sameFormat = (a, b) => a === b || (['jpg', 'jpeg'].includes(a) && ['jpg', 'jpeg'].includes(b));

/** Remove one code fence that wraps the whole text. */
function stripFence(text) {
	const m = text.match(/^\s*```[\w+.-]*[^\S\n]*\n([\s\S]*?)\n?```\s*$/);
	// More than one fence (e.g. Markdown that opens and closes with code blocks): leave it alone.
	if (!m || /^\s*```/m.test(m[1])) return text;
	return m[1];
}

class FileAgent extends BaseGemini {
	/**
	 * @param {import('./types').FileAgentOptions} [options={}]
	 */
	constructor(options = {}) {
		super(options);
		this.imageModel = options.imageModel || DEFAULT_IMAGE_MODEL;
		this.speechModel = options.speechModel || DEFAULT_SPEECH_MODEL;
		this.voice = options.voice || DEFAULT_VOICE;
		this.languageCode = options.languageCode || null;
		this.aspectRatio = options.aspectRatio || null;
		this.imageSize = options.imageSize || null;
		this.personGeneration = options.personGeneration || null;
		log.debug(`FileAgent created (text=${this.modelName}, image=${this.imageModel}, speech=${this.speechModel})`);
	}

	/**
	 * Stateless: no chat session.
	 * @param {boolean} [force=false]
	 */
	async init(force = false) {
		if (this._initialized && !force) return;
		await this._healthCheckPing();
		this._initialized = true;
	}

	/**
	 * Produce a file from a prompt.
	 * @param {string|Array<{ speaker: string, text: string, style?: string }>} prompt
	 * @param {import('./types').FileWriteOptions} opts
	 * @returns {Promise<import('./types').FileWriteResult>}
	 */
	async write(prompt, opts = {}) {
		const { format, kind } = this._resolveFormat(opts);
		if (Array.isArray(prompt)) {
			if (kind !== 'audio') throw new Error(`FileAgent.write(): a SpeechTurn[] prompt works only for .wav. Pass a string prompt for .${format}.`);
			const files = opts.files == null ? [] : [].concat(opts.files);
			if (files.length) throw new Error('FileAgent.write(): files cannot be combined with a SpeechTurn[] prompt. Speech models read only the script.');
		}
		if (!this._initialized) await this.init();

		let out;
		if (kind === 'text') out = await this._writeText(/** @type {string} */ (prompt), format, opts);
		else if (kind === 'image') out = await this._writeImage(/** @type {string} */ (prompt), format, opts);
		else out = await this._writeAudio(prompt, opts);

		const mimeType = WRITE_MIME_TYPES[format];
		this._lastFileUsage = out.usage;
		if (opts.path) {
			await mkdir(dirname(opts.path), { recursive: true });
			await writeFile(opts.path, out.data);
		}
		return { data: out.data, mimeType, format, path: opts.path || null, text: out.text, usage: out.usage };
	}

	/**
	 * Read files with a prompt (one stateless call).
	 * @param {import('./types').FileInput|import('./types').FileInput[]} files
	 * @param {string} prompt
	 * @param {import('./types').FileReadOptions} [opts={}]
	 * @returns {Promise<{ text: string, data?: any, usage: import('./types').UsageData }>}
	 */
	async read(files, prompt, opts = {}) {
		if (!this._initialized) await this.init();
		const { message, uploaded } = await this._buildUserParts(prompt, files);
		const structured = !!(opts.responseSchema || opts.responseMimeType === 'application/json');
		const config = {
			...this._getChatCreateOptions().config,
			...(opts.responseSchema && { responseSchema: opts.responseSchema }),
			...(structured && { responseMimeType: opts.responseMimeType || 'application/json' }),
			...this._labelsConfig(opts.labels)
		};
		const result = await this._generate(this.modelName, message, config);
		const usage = { ...this._usageFromResponse(result), files: uploaded };
		this._lastFileUsage = usage;
		const text = result.text || '';
		/** @type {{ text: string, data?: any, usage: any }} */
		const response = { text, usage };
		if (structured) {
			try {
				response.data = extractJSON(text);
			} catch (e) {
				log.warn(`FileAgent.read(): could not parse structured response: ${e.message}`);
				response.data = null;
			}
		}
		return response;
	}

	// ── Routes ───────────────────────────────────────────────────────────────

	/** @private */
	async _writeText(prompt, format, opts) {
		const { message, uploaded } = await this._buildUserParts(
			`${prompt}\n\nWrite the complete contents of a .${format} file. Reply with the file contents only: no commentary and no code fences.`,
			opts.files
		);
		const json = format === 'json';
		const config = {
			...this._getChatCreateOptions().config,
			...(json && { responseMimeType: 'application/json' }),
			...(json && opts.responseSchema && { responseSchema: opts.responseSchema }),
			...this._labelsConfig(opts.labels)
		};
		const result = await this._generate(this.modelName, message, config);
		const usage = { ...this._usageFromResponse(result), files: uploaded };
		const text = stripFence(result.text || '');
		if (json) {
			try {
				JSON.parse(text);
			} catch (e) {
				const err = new Error(`FileAgent: the model output is not valid JSON (${e.message}).`);
				/** @type {any} */ (err).raw = text;
				throw err;
			}
		}
		return { data: Buffer.from(text, 'utf8'), text, usage };
	}

	/** @private */
	async _writeImage(prompt, format, opts) {
		const wanted = WRITE_MIME_TYPES[format];
		const { message, uploaded } = await this._buildUserParts(prompt, opts.files);
		// outputMimeType is Vertex-only; the SDK rejects it on the Gemini API.
		const config = {
			...buildImageConfig(this, opts, { outputMimeType: this.vertexai ? wanted : undefined }),
			...this._labelsConfig(opts.labels)
		};
		const result = await this._generate(this.imageModel, message, config);
		const usage = { ...this._usageFromResponse(result, 1, this.imageModel), files: uploaded };
		const { images, text } = parseImageResponse(result);
		if (images.length === 0) {
			const cand = result?.candidates?.[0];
			const reason = cand?.finishReason ? ` (${cand.finishReason})` : '';
			const detail = cand?.finishMessage || (text ? `Model text: ${text}` : 'Check the prompt or safety filters.');
			throw new Error(`FileAgent: the image model returned no image${reason}. ${detail}`);
		}
		const got = images[0].mimeType;
		if (!got) throw new Error(`FileAgent: the image model returned no MIME type; refusing to write it as ${wanted}.`);
		if (got.toLowerCase() !== wanted) {
			throw new Error(`FileAgent: asked for ${wanted} (.${format}) but the image model returned ${got}. Nothing was written.`);
		}
		return { data: Buffer.from(images[0].data, 'base64'), text, usage };
	}

	/** @private */
	async _writeAudio(prompt, opts) {
		/** @type {Record<string, any>} */
		let speechConfig;
		if (opts.speakers?.length) {
			speechConfig = { multiSpeakerVoiceConfig: { speakerVoiceConfigs: opts.speakers.map(s => ({
				speaker: s.speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
			})) } };
		} else {
			speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice || this.voice } } };
		}
		const languageCode = opts.languageCode || this.languageCode;
		if (languageCode) speechConfig.languageCode = languageCode;

		// Multi-speaker scripts: one part per turn, tagged with speechMetadata
		// (3.8 TTS models 400 without it).
		let message;
		let uploaded = [];
		if (Array.isArray(prompt)) {
			message = prompt.map(t => ({ text: t.text, speechMetadata: { speaker: t.speaker, ...(t.style && { style: t.style }) } }));
		} else {
			({ message, uploaded } = await this._buildUserParts(prompt, opts.files));
		}

		const config = { responseModalities: ['AUDIO'], speechConfig, ...this._labelsConfig(opts.labels) };
		const result = await this._generate(this.speechModel, message, config);
		const usage = { ...this._usageFromResponse(result, 1, this.speechModel), files: uploaded };

		// 3.8 TTS returns audio/wav; 3.1 preview returns audio/L16 PCM. Normalise
		// every part to PCM, check the formats agree, and write one WAV.
		const parts = (result?.candidates?.[0]?.content?.parts || []).filter(p => p.inlineData?.data);
		if (parts.length === 0) throw new Error('FileAgent: the speech model returned no audio.');
		const chunks = parts.map(p => {
			const mime = String(p.inlineData.mimeType || '');
			const bytes = Buffer.from(p.inlineData.data, 'base64');
			if (/^audio\/(wav|x-wav|wave)\b/i.test(mime)) return wavToPcm(bytes);
			const fmt = parsePcmMime(mime);
			return { pcm: bytes, sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16 };
		});
		const { sampleRate, channels, bitsPerSample } = chunks[0];
		if (chunks.some(c => c.sampleRate !== sampleRate || c.channels !== channels || c.bitsPerSample !== bitsPerSample)) {
			throw new Error('FileAgent: the speech model returned audio parts in different formats.');
		}
		const pcm = chunks.length === 1 ? chunks[0].pcm : Buffer.concat(chunks.map(c => c.pcm));
		const text = (result?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') || null;
		return { data: pcmToWav(pcm, { sampleRate, channels, bitsPerSample }), text, usage };
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	/**
	 * Decide the output format from `format` and/or `path`. Runs before any API
	 * call or disk write.
	 * @param {{ format?: string, path?: string }} opts
	 * @returns {{ format: string, kind: 'text'|'image'|'audio' }}
	 * @private
	 */
	_resolveFormat(opts) {
		const norm = f => String(f).toLowerCase().replace(/^\./, '');
		const fromFormat = opts.format != null ? norm(opts.format) : undefined;
		const fromPath = opts.path != null ? norm(extname(opts.path)) : undefined;
		if (fromFormat === undefined && fromPath === undefined) {
			throw new Error('FileAgent.write() needs { format } or { path }');
		}
		if (fromFormat !== undefined && fromPath !== undefined && !sameFormat(fromFormat, fromPath)) {
			throw new Error(fromPath === ''
				? `format "${fromFormat}" does not match path "${opts.path}" (no extension)`
				: `format "${fromFormat}" does not match path extension ".${fromPath}"`);
		}
		const format = /** @type {string} */ (fromFormat ?? fromPath);
		if (!writeFormatsFor(this.vertexai).includes(format)) {
			throw new UnsupportedFormatError(format, 'write', { vertexai: this.vertexai, who: 'FileAgent' });
		}
		const kind = WRITE_FORMATS.text.includes(format) ? 'text' : (WRITE_FORMATS.audio.includes(format) ? 'audio' : 'image');
		return { format, kind };
	}

	/** @private */
	_labelsConfig(perCallLabels) {
		const labels = { ...this.labels, ...(perCallLabels || {}) };
		return this.vertexai && Object.keys(labels).length > 0 ? { labels } : {};
	}

	/**
	 * One generateContent call with the 429 retry.
	 * @param {string} model
	 * @param {string|any[]} message - text or Part[]
	 * @param {Record<string, any>} config
	 * @private
	 */
	async _generate(model, message, config) {
		const parts = typeof message === 'string' ? [{ text: message }] : message;
		return this._withRetry(async () => (await this._ensureClient()).models.generateContent({
			model, contents: [{ role: 'user', parts }], config
		}));
	}

	/**
	 * Usage of the last write() or read() on this instance. Prefer the per-call
	 * `result.usage` under concurrency.
	 * @returns {import('./types').UsageData|null}
	 */
	getLastUsage() {
		return this._lastFileUsage || null;
	}

	// ── No-ops (stateless) ───────────────────────────────────────────────────

	/** @returns {any[]} */
	getHistory() { return []; }

	async clearHistory() {}

	async seed() {
		log.warn('FileAgent is stateless — seed() has no effect.');
		return [];
	}

	/**
	 * @param {any} _nextPayload
	 * @returns {Promise<{ inputTokens: number }>}
	 */
	async estimate(_nextPayload) {
		throw new Error('FileAgent is stateless — use estimate() on Chat or Transformer.');
	}
}

export { DEFAULT_IMAGE_MODEL, DEFAULT_SPEECH_MODEL, DEFAULT_VOICE };
export default FileAgent;
