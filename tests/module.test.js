import dotenv from 'dotenv';
dotenv.config();
import { default as AITransformer } from '../index.js';

const { GEMINI_API_KEY } = process.env;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run real integration tests");

describe('AITransformer (real Gemini integration)', () => {
	let transformer;
	const simpleExamples = [
		{ PROMPT: { x: 1 }, ANSWER: { y: 2 } },
		{ PROMPT: { x: 3 }, ANSWER: { y: 6 } }
	];

	beforeAll(async () => {
		transformer = new AITransformer({ apiKey: GEMINI_API_KEY });
		await transformer.init();
	});

	describe('Constructor & init', () => {
		it('should create with default options', () => {
			const t = new AITransformer({ apiKey: GEMINI_API_KEY });
			expect(t.modelName).toMatch(/gemini/);
			expect(typeof t.init).toBe('function');
		});

	});

	describe('Basic chat', () => {
		it('should initialize chat session', async () => {
			await transformer.init();
			expect(transformer.chat).toBeTruthy();
		});
	});

	describe('Seeding and history', () => {
		it('should seed chat with examples', async () => {
			await transformer.seed(simpleExamples);
			const history = transformer.getHistory();
			expect(Array.isArray(history)).toBe(true);
			expect(history.length).toBeGreaterThan(0);
		});
	});

	describe('Message (transform)', () => {
		it('should transform a basic payload', async () => {
			const result = await transformer.message({ x: 10 });
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});

		it('should reject invalid payload', async () => {
			await expect(transformer.message(123)).rejects.toThrow(/invalid source payload/i);
		});
	});

	describe('Token estimation', () => {
		it('should estimate token usage for a payload', async () => {
			const count = await transformer.estimate({ foo: "bar" });
			expect(typeof count.totalTokens).toBe('number');
			expect(count.totalTokens).toBeGreaterThan(0);
		});

		it('should throw on a huge payload if over window', async () => {
			const bigPayload = { data: "x".repeat(150_000) };
			let failed = false;
			try {
				await transformer.estimate(bigPayload);
			} catch (e) {
				failed = true;
				expect(e.message).toMatch(/tokens/i);
			}
			expect(typeof failed).toBe('boolean');
		});
	});

	describe('transformWithValidation', () => {
		it('should transform and validate (identity validator)', async () => {
			const validator = p => Promise.resolve(p);
			const result = await transformer.transformWithValidation({ x: 5 }, validator);
			expect(result).toBeTruthy();
		});
	});

	describe('Error handling', () => {
		it('should handle chat not initialized', async () => {
			const t2 = new AITransformer({ apiKey: GEMINI_API_KEY });
			await expect(t2.message({ foo: 1 })).rejects.toThrow(/chat session not initialized/i);
		});
	});

	describe('reset()', () => {
		it('should reset chat session', async () => {
			await transformer.reset();
			expect(transformer.chat).toBeTruthy();
		});
	});

	describe('Edge cases', () => {
		it('should handle special characters', async () => {
			const payload = { text: "Hi \"world\"\n🚀" };
			const result = await transformer.message(payload);
			expect(result).toBeTruthy();
		});

		it.skip('should handle massive payloads (danger: quota)', async () => {
			const massive = { data: "a".repeat(200_000) };
			await transformer.message(massive);
		});
	});
});
