import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { Embedding } from '../index.js';

const { GEMINI_API_KEY } = process.env;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'gemini-embedding-001',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};

describe('Embedding', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should default model to gemini-embedding-001', () => {
			const e = new Embedding({ apiKey: GEMINI_API_KEY, logLevel: 'warn' });
			expect(e.modelName).toBe('gemini-embedding-001');
		});

		it('should accept custom model name', () => {
			const e = new Embedding({ ...BASE_OPTIONS, modelName: 'text-embedding-001' });
			expect(e.modelName).toBe('text-embedding-001');
		});

		it('should accept taskType option', () => {
			const e = new Embedding({ ...BASE_OPTIONS, taskType: 'RETRIEVAL_QUERY' });
			expect(e.taskType).toBe('RETRIEVAL_QUERY');
		});

		it('should accept title option', () => {
			const e = new Embedding({ ...BASE_OPTIONS, title: 'My Document' });
			expect(e.title).toBe('My Document');
		});

		it('should accept outputDimensionality option', () => {
			const e = new Embedding({ ...BASE_OPTIONS, outputDimensionality: 256 });
			expect(e.outputDimensionality).toBe(256);
		});

		it('should default autoTruncate to true', () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			expect(e.autoTruncate).toBe(true);
		});

		it('should throw on missing API key', () => {
			const saved = process.env.GEMINI_API_KEY;
			delete process.env.GEMINI_API_KEY;
			try {
				expect(() => new Embedding({})).toThrow(/api key/i);
			} finally {
				process.env.GEMINI_API_KEY = saved;
			}
		});
	});

	// ── init() ──────────────────────────────────────────────────────────────

	describe('init()', () => {
		it('should initialize without creating a chat session', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			await e.init();
			expect(e._initialized).toBe(true);
			expect(e.chatSession).toBeNull();
		});

		it('should be idempotent', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			await e.init();
			await e.init();
			expect(e._initialized).toBe(true);
		});

		it('should reinitialize when force=true', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			await e.init();
			await e.init(true); // should not throw
			expect(e._initialized).toBe(true);
		});

		it('should throw on invalid API key', async () => {
			const e = new Embedding({ ...BASE_OPTIONS, apiKey: 'invalid-key-xxx' });
			await expect(e.init()).rejects.toThrow();
		});

		it('should auto-init on embed()', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			expect(e._initialized).toBeFalsy();
			await e.embed('test');
			expect(e._initialized).toBe(true);
		}, 30_000);
	});

	// ── _buildConfig ────────────────────────────────────────────────────────

	describe('_buildConfig', () => {
		it('should return empty config with no options', () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			const config = e._buildConfig();
			expect(config.taskType).toBeUndefined();
			expect(config.title).toBeUndefined();
			expect(config.outputDimensionality).toBeUndefined();
		});

		it('should include instance-level options', () => {
			const e = new Embedding({
				...BASE_OPTIONS,
				taskType: 'RETRIEVAL_DOCUMENT',
				title: 'My Doc',
				outputDimensionality: 256
			});
			const config = e._buildConfig();
			expect(config.taskType).toBe('RETRIEVAL_DOCUMENT');
			expect(config.title).toBe('My Doc');
			expect(config.outputDimensionality).toBe(256);
		});

		it('should allow per-call overrides', () => {
			const e = new Embedding({
				...BASE_OPTIONS,
				taskType: 'RETRIEVAL_DOCUMENT',
				outputDimensionality: 256
			});
			const config = e._buildConfig({
				taskType: 'RETRIEVAL_QUERY',
				outputDimensionality: 128
			});
			expect(config.taskType).toBe('RETRIEVAL_QUERY');
			expect(config.outputDimensionality).toBe(128);
		});
	});

	// ── No-ops ───────────────────────────────────────────────────────────────

	describe('No-ops', () => {
		it('getHistory should return empty array', () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			expect(e.getHistory()).toEqual([]);
		});

		it('clearHistory should not throw', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			await e.clearHistory();
		});

		it('seed should return empty array', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			const result = await e.seed();
			expect(result).toEqual([]);
		});

		it('estimate should throw', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			await expect(e.estimate('test')).rejects.toThrow(/does not support/i);
		});
	});

	// ── Similarity (pure math, no API) ───────────────────────────────────────

	describe('similarity', () => {
		const e = new Embedding({ ...BASE_OPTIONS });

		it('should return 1.0 for identical vectors', () => {
			const v = [1, 2, 3, 4, 5];
			expect(e.similarity(v, v)).toBeCloseTo(1.0, 5);
		});

		it('should return 0 for orthogonal vectors', () => {
			expect(e.similarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
		});

		it('should return -1 for opposite vectors', () => {
			expect(e.similarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
		});

		it('should return 0 for zero vectors', () => {
			expect(e.similarity([0, 0], [0, 0])).toBe(0);
		});

		it('should throw for mismatched lengths', () => {
			expect(() => e.similarity([1, 2], [1, 2, 3])).toThrow(/same length/i);
		});

		it('should throw for null vectors', () => {
			expect(() => e.similarity(null, [1, 2])).toThrow();
		});
	});

	// ── API calls ────────────────────────────────────────────────────────────

	describe('embed', () => {
		it('should embed a single text and return values array', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			const result = await e.embed('Hello world');
			expect(result).toBeDefined();
			expect(result.values).toBeDefined();
			expect(Array.isArray(result.values)).toBe(true);
			expect(result.values.length).toBeGreaterThan(0);
			expect(typeof result.values[0]).toBe('number');
		}, 30_000);

		it('should respect outputDimensionality', async () => {
			const e = new Embedding({ ...BASE_OPTIONS, outputDimensionality: 128 });
			const result = await e.embed('Hello world');
			expect(result.values.length).toBe(128);
		}, 30_000);

		it('should accept per-call config overrides', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			const result = await e.embed('Hello world', { outputDimensionality: 64 });
			expect(result.values.length).toBe(64);
		}, 30_000);
	});

	describe('embedBatch', () => {
		it('should embed multiple texts', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			const results = await e.embedBatch(['Hello', 'World', 'Test']);
			expect(Array.isArray(results)).toBe(true);
			expect(results.length).toBe(3);
			for (const r of results) {
				expect(r.values).toBeDefined();
				expect(r.values.length).toBeGreaterThan(0);
			}
		}, 30_000);
	});

	// ── End-to-end: embed + similarity ────────────────────────────────────────

	describe('embed + similarity', () => {
		it('should produce high similarity for semantically similar texts', async () => {
			const e = new Embedding({ ...BASE_OPTIONS });
			const [a, b, c] = await Promise.all([
				e.embed('The cat sat on the mat'),
				e.embed('A feline rested on the rug'),
				e.embed('Quantum physics equations')
			]);
			const similar = e.similarity(a.values, b.values);
			const different = e.similarity(a.values, c.values);
			expect(similar).toBeGreaterThan(different);
		}, 30_000);
	});
});
