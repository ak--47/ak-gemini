import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { ImageGenerator } from '../index.js';
import { existsSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { GEMINI_API_KEY } = process.env;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};

describe('ImageGenerator', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should default model to gemini-3.1-flash-image-preview', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			expect(g.modelName).toBe('gemini-3.1-flash-image-preview');
		});

		it('should accept custom model name', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, modelName: 'gemini-2.5-flash-image' });
			expect(g.modelName).toBe('gemini-2.5-flash-image');
		});

		it('should accept aspectRatio option', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, aspectRatio: '16:9' });
			expect(g.aspectRatio).toBe('16:9');
		});

		it('should accept imageSize option', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, imageSize: '2K' });
			expect(g.imageSize).toBe('2K');
		});

		it('should accept personGeneration option', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, personGeneration: 'ALLOW_ADULT' });
			expect(g.personGeneration).toBe('ALLOW_ADULT');
		});

		it('should default includeText to false', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			expect(g.includeText).toBe(false);
		});

		it('should accept includeText option', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, includeText: true });
			expect(g.includeText).toBe(true);
		});

		it('should throw on missing API key', () => {
			const saved = process.env.GEMINI_API_KEY;
			delete process.env.GEMINI_API_KEY;
			try {
				expect(() => new ImageGenerator({})).toThrow(/api key/i);
			} finally {
				process.env.GEMINI_API_KEY = saved;
			}
		});
	});

	// ── init() ──────────────────────────────────────────────────────────────

	describe('init()', () => {
		it('should initialize without creating a chat session', async () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			await g.init();
			expect(g._initialized).toBe(true);
			expect(g.chatSession).toBeNull();
		});

		it('should be idempotent', async () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			await g.init();
			await g.init();
			expect(g._initialized).toBe(true);
		});

		it('should throw on invalid API key', async () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, apiKey: 'invalid-key-xxx' });
			await expect(g.init()).rejects.toThrow();
		});
	});

	// ── _buildConfig ────────────────────────────────────────────────────────

	describe('_buildConfig', () => {
		it('should default to IMAGE-only modality', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			const config = g._buildConfig();
			expect(config.responseModalities).toEqual(['IMAGE']);
		});

		it('should include TEXT modality when includeText: true', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, includeText: true });
			const config = g._buildConfig();
			expect(config.responseModalities).toEqual(['IMAGE', 'TEXT']);
		});

		it('should nest aspectRatio under imageConfig', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, aspectRatio: '16:9' });
			const config = g._buildConfig();
			expect(config.imageConfig).toEqual({ aspectRatio: '16:9' });
		});

		it('should nest all image options under imageConfig', () => {
			const g = new ImageGenerator({
				...BASE_OPTIONS,
				aspectRatio: '1:1',
				imageSize: '2K',
				personGeneration: 'ALLOW_ADULT'
			});
			const config = g._buildConfig();
			expect(config.imageConfig).toEqual({
				aspectRatio: '1:1',
				imageSize: '2K',
				personGeneration: 'ALLOW_ADULT'
			});
		});

		it('should omit imageConfig when no image options set', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			const config = g._buildConfig();
			expect(config.imageConfig).toBeUndefined();
		});

		it('should allow per-call overrides', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, aspectRatio: '1:1', imageSize: '1K' });
			const config = g._buildConfig({ aspectRatio: '16:9', includeText: true });
			expect(config.responseModalities).toEqual(['IMAGE', 'TEXT']);
			expect(config.imageConfig.aspectRatio).toBe('16:9');
			expect(config.imageConfig.imageSize).toBe('1K');
		});

		it('should NOT include safetySettings / temperature / topK / topP', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, aspectRatio: '16:9' });
			const config = g._buildConfig();
			expect(config.safetySettings).toBeUndefined();
			expect(config.temperature).toBeUndefined();
			expect(config.topK).toBeUndefined();
			expect(config.topP).toBeUndefined();
			expect(config.thinkingConfig).toBeUndefined();
		});
	});

	// ── save() ──────────────────────────────────────────────────────────────

	describe('save()', () => {
		const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

		it('should write a single image to disk', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			const path = join(tmpdir(), `ak-gemini-test-${Date.now()}.png`);
			const result = { images: [{ data: TINY_PNG_B64, mimeType: 'image/png' }], text: null, usage: null };
			const written = g.save(result, path);
			expect(written).toEqual([path]);
			expect(existsSync(path)).toBe(true);
			expect(statSync(path).size).toBeGreaterThan(0);
			unlinkSync(path);
		});

		it('should suffix _N when saving multiple images', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			const base = join(tmpdir(), `ak-gemini-multi-${Date.now()}.png`);
			const result = {
				images: [
					{ data: TINY_PNG_B64, mimeType: 'image/png' },
					{ data: TINY_PNG_B64, mimeType: 'image/png' }
				],
				text: null,
				usage: null
			};
			const written = g.save(result, base);
			expect(written.length).toBe(2);
			expect(written[0]).toMatch(/_0\.png$/);
			expect(written[1]).toMatch(/_1\.png$/);
			written.forEach(p => { expect(existsSync(p)).toBe(true); unlinkSync(p); });
		});

		it('should return empty array when no images', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			expect(g.save({ images: [] }, '/tmp/x.png')).toEqual([]);
			expect(g.save(null, '/tmp/x.png')).toEqual([]);
		});
	});

	// ── No-ops ───────────────────────────────────────────────────────────────

	describe('No-ops', () => {
		it('getHistory should return empty array', () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			expect(g.getHistory()).toEqual([]);
		});

		it('clearHistory should not throw', async () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			await expect(g.clearHistory()).resolves.toBeUndefined();
		});

		it('seed should return empty array', async () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			await expect(g.seed()).resolves.toEqual([]);
		});

		it('estimate should throw', async () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS });
			await expect(g.estimate({})).rejects.toThrow(/does not support token estimation/);
		});
	});

	// ── generate() — real API ────────────────────────────────────────────────

	describe('generate() — real API call', () => {
		it('should generate at least one image from a text prompt', async () => {
			const g = new ImageGenerator({ ...BASE_OPTIONS, aspectRatio: '1:1' });
			const result = await g.generate('A simple red circle on a white background');

			expect(result).toBeDefined();
			expect(Array.isArray(result.images)).toBe(true);
			expect(result.images.length).toBeGreaterThan(0);

			const img = result.images[0];
			expect(typeof img.data).toBe('string');
			expect(img.data.length).toBeGreaterThan(100); // base64 should be non-trivial
			expect(typeof img.mimeType).toBe('string');
			expect(img.mimeType).toMatch(/^image\//);

			expect(result.usage).toBeDefined();
			expect(typeof result.usage.totalTokens).toBe('number');
		}, 60_000);
	});
});
