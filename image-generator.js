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

const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

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

		try {
			await this.genAIClient.models.list();
			log.debug(`${this.constructor.name}: API connection successful.`);
		} catch (e) {
			throw new Error(`${this.constructor.name} initialization failed: ${e.message}`);
		}

		this._initialized = true;
	}

	/**
	 * Build a FRESH config — Gemini image models reject safetySettings/temp/topK/topP/thinkingConfig.
	 * Do NOT spread this.chatConfig.
	 * @private
	 */
	_buildConfig(overrides = {}) {
		const includeText = overrides.includeText ?? this.includeText;
		const config = { responseModalities: includeText ? ['IMAGE', 'TEXT'] : ['IMAGE'] };

		const imageConfig = {};
		const aspectRatio = overrides.aspectRatio || this.aspectRatio;
		const imageSize = overrides.imageSize || this.imageSize;
		const personGeneration = overrides.personGeneration || this.personGeneration;
		if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
		if (imageSize) imageConfig.imageSize = imageSize;
		if (personGeneration) imageConfig.personGeneration = personGeneration;
		if (Object.keys(imageConfig).length > 0) config.imageConfig = imageConfig;

		return config;
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
		if (Array.isArray(opts.inputImages)) {
			for (const img of opts.inputImages) {
				parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
			}
		}

		const result = await this._withRetry(() => this.genAIClient.models.generateContent({
			model: this.modelName,
			contents: [{ role: 'user', parts }],
			config: this._buildConfig(opts)
		}));

		this._captureMetadata(result);
		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		const images = [];
		let text = '';
		const responseParts = result.candidates?.[0]?.content?.parts || [];
		for (const part of responseParts) {
			if (part.inlineData?.data) {
				images.push({
					data: part.inlineData.data,
					mimeType: part.inlineData.mimeType || 'image/png'
				});
			} else if (part.text) {
				text += part.text;
			}
		}

		if (images.length === 0) {
			log.warn('ImageGenerator: no images returned. Check prompt or safety filters.');
		}

		return { images, text: text || null, usage: this.getLastUsage() };
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
