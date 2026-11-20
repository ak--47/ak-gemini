/**
 * @fileoverview ImageGenerator — Generate images via Gemini's Nano Banana models.
 *
 * Extends BaseGemini for auth/client reuse but overrides init() to skip chat session
 * creation (image gen is stateless). Mirrors the Embedding class pattern.
 *
 * @example
 * ```javascript
 * import { ImageGenerator } from 'ak-gemini';
 * import { writeFileSync } from 'node:fs';
 *
 * const gen = new ImageGenerator({ apiKey: 'your-key' });
 * const result = await gen.generate('A cat astronaut on the moon');
 * writeFileSync('cat.png', Buffer.from(result.images[0].data, 'base64'));
 * ```
 */

import BaseGemini from './base.js';
import log from './logger.js';
import { writeFileSync } from 'node:fs';
import { toParts } from './files.js';

// Nano Banana 2.1 (GA 2026-10-06). The old default, gemini-3.1-flash-image-preview,
// is 404 on Vertex and was shut down on the Gemini API on 2026-06-25.
const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';

/**
 * Build a FRESH image-generation config. Gemini image models reject
 * safetySettings/temp/topK/topP/thinkingConfig, so this never spreads chatConfig.
 * @param {{ aspectRatio?: string|null, imageSize?: string|null, personGeneration?: string|null, includeText?: boolean }} defaults
 * @param {{ aspectRatio?: string, imageSize?: string, personGeneration?: string, includeText?: boolean }} [overrides]
 * @param {{ outputMimeType?: string }} [extra] - `outputMimeType` is Vertex-only
 * @returns {Record<string, any>}
 */
export function buildImageConfig(defaults, overrides = {}, { outputMimeType } = {}) {
	const includeText = overrides.includeText ?? defaults.includeText ?? false;
	/** @type {Record<string, any>} */
	const config = { responseModalities: includeText ? ['IMAGE', 'TEXT'] : ['IMAGE'] };

	/** @type {Record<string, any>} */
	const imageConfig = {};
	const aspectRatio = overrides.aspectRatio || defaults.aspectRatio;
	const imageSize = overrides.imageSize || defaults.imageSize;
	const personGeneration = overrides.personGeneration || defaults.personGeneration;
	if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
	if (imageSize) imageConfig.imageSize = imageSize;
	if (personGeneration) imageConfig.personGeneration = personGeneration;
	if (outputMimeType) imageConfig.outputMimeType = outputMimeType;
	if (Object.keys(imageConfig).length > 0) config.imageConfig = imageConfig;

	return config;
}

/**
 * Pull images and text out of an image-model response. The MIME type is the
 * one the API returned (possibly undefined); callers decide any default.
 * @param {any} result
 * @returns {{ images: Array<{ data: string, mimeType: string }>, text: string|null }}
 */
export function parseImageResponse(result) {
	const images = [];
	let text = '';
	const responseParts = result?.candidates?.[0]?.content?.parts || [];
	for (const part of responseParts) {
		if (part.inlineData?.data) {
			images.push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType });
		} else if (part.text) {
			text += part.text;
		}
	}
	return { images, text: text || null };
}

export default class ImageGenerator extends BaseGemini {

	/**
	 * @param {import('./types.d.ts').ImageGeneratorOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.modelName === undefined) {
			options = { ...options, modelName: DEFAULT_IMAGE_MODEL };
		}
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: null };
		}
		super(options);

		this.aspectRatio = options.aspectRatio || null;
		this.imageSize = options.imageSize || null;
		this.personGeneration = options.personGeneration || null;
		this.includeText = options.includeText ?? false;

		log.debug(`ImageGenerator created with model: ${this.modelName}`);
	}

	/**
	 * Validate API connection only; no chat session (stateless).
	 * @param {boolean} [force=false]
	 */
	async init(force = false) {
		if (this._initialized && !force) return;

		log.debug(`Initializing ${this.constructor.name} with model: ${this.modelName}...`);

		// Connectivity check is opt-in (healthCheck: true) — avoids an extra
		// round-trip and the models.list() IAM surface. First generate() is a fine
		// error signal on its own.
		await this._healthCheckPing();

		this._initialized = true;
	}

	/**
	 * Build a FRESH config — Gemini image models reject safetySettings/temp/topK/topP/thinkingConfig.
	 * Do NOT spread this.chatConfig.
	 * @private
	 */
	_buildConfig(overrides = {}) {
		return buildImageConfig(this, overrides);
	}

	/**
	 * Generate one or more images from a text prompt.
	 * Optionally accepts `inputImages` for image editing / multi-image composition.
	 *
	 * @param {string} prompt
	 * @param {import('./types.d.ts').ImageGenerateOptions} [opts={}]
	 * @returns {Promise<import('./types.d.ts').ImageGenerationResult>}
	 */
	async generate(prompt, opts = {}) {
		if (!this._initialized) await this.init();

		/** @type {any[]} */
		const parts = [{ text: prompt }];
		/** @type {any[]} */
		let uploaded = [];
		if (Array.isArray(opts.inputImages)) {
			const isLegacy = img => img && typeof img === 'object' && typeof img.data === 'string' && img.mimeType;
			const inputs = /** @type {any[]} */ (opts.inputImages);
			// Paths, URIs, Buffers: ONE strict-resolver call, so every input is checked
			// (and the inline total summed) before any upload.
			const strict = inputs.filter(img => !isLegacy(img));
			let resolved = [];
			if (strict.length) {
				({ parts: resolved, uploaded } = await toParts(strict, await this._ensureClient(), {
					vertexai: this.vertexai, withRetry: fn => this._withRetry(fn)
				}));
			}
			let next = 0;
			for (const img of inputs) {
				// 3.0.0 shape: base64 object passes through untouched.
				parts.push(isLegacy(img) ? { inlineData: { data: img.data, mimeType: img.mimeType } } : resolved[next++]);
			}
		}

		const result = await this._withRetry(async () => (await this._ensureClient()).models.generateContent({
			model: this.modelName,
			contents: [{ role: 'user', parts }],
			config: this._buildConfig(opts)
		}));

		// Per-call usage computed synchronously from THIS response (concurrency-safe).
		const usage = { ...this._usageFromResponse(result), files: uploaded };

		this._captureMetadata(result);
		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			thoughtsTokens: this.lastResponseMetadata.thoughtsTokens,
			cachedTokens: this.lastResponseMetadata.cachedTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		const parsed = parseImageResponse(result);
		const images = parsed.images.map(img => ({ data: img.data, mimeType: img.mimeType || 'image/png' }));
		const text = parsed.text;

		if (images.length === 0) {
			log.warn('ImageGenerator: no images returned. Check prompt or safety filters.');
		}

		return { images, text, usage };
	}

	/**
	 * Convenience: write one or all images to disk.
	 * If multiple images, suffixes with `_N` before extension.
	 * @param {import('./types.d.ts').ImageGenerationResult} result
	 * @param {string} filePath
	 * @returns {string[]} Written file paths
	 */
	save(result, filePath) {
		if (!result?.images?.length) {
			log.warn('ImageGenerator.save(): no images to save.');
			return [];
		}
		const paths = [];
		const dot = filePath.lastIndexOf('.');
		const base = dot >= 0 ? filePath.slice(0, dot) : filePath;
		const ext = dot >= 0 ? filePath.slice(dot) : '.png';
		result.images.forEach((img, i) => {
			const out = result.images.length === 1 ? filePath : `${base}_${i}${ext}`;
			writeFileSync(out, Buffer.from(img.data, 'base64'));
			paths.push(out);
		});
		return paths;
	}

	// ── No-ops (image gen is stateless) ──

	/** @returns {any[]} Always returns empty array */
	getHistory() { return []; }

	/** No-op for ImageGenerator */
	async clearHistory() {}

	/** No-op for ImageGenerator */
	async seed() {
		log.warn('ImageGenerator.seed() is a no-op — image generation does not support few-shot.');
		return [];
	}

	/**
	 * @param {any} _nextPayload
	 * @throws {Error} ImageGenerator does not support token estimation
	 * @returns {Promise<{ inputTokens: number }>}
	 */
	async estimate(_nextPayload) {
		throw new Error('ImageGenerator does not support token estimation. Use generate() directly.');
	}
}
