import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { Message } from '../index.js';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash-lite',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};


describe('Message', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should create without system prompt', () => {
			const msg = new Message({ ...BASE_OPTIONS });
			expect(msg.modelName).toBe('gemini-2.0-flash-lite');
		});

		it('should accept custom system prompt', () => {
			const msg = new Message({ ...BASE_OPTIONS, systemPrompt: 'Be brief.' });
			expect(msg.systemPrompt).toBe('Be brief.');
		});

		it('should have send() method', () => {
			const msg = new Message({ ...BASE_OPTIONS });
			expect(typeof msg.send).toBe('function');
		});

		it('should detect structured mode', () => {
			const plain = new Message({ ...BASE_OPTIONS });
			expect(plain._isStructured).toBe(false);

			const structured = new Message({ ...BASE_OPTIONS, responseMimeType: 'application/json' });
			expect(structured._isStructured).toBe(true);
		});
	});

	// ── init() ───────────────────────────────────────────────────────────────

	describe('init()', () => {
		it('should initialize without creating a chat session', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			await msg.init();
			expect(msg._initialized).toBe(true);
			expect(msg.chatSession).toBeNull(); // No chat session for stateless
		});

		it('should be idempotent', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			await msg.init();
			await msg.init();
			expect(msg._initialized).toBe(true);
		});
	});

	// ── send() — Text Mode ───────────────────────────────────────────────────

	describe('send() — text responses', () => {
		it('should return a text response', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Answer concisely.'
			});
			const response = await msg.send('What is the capital of France?');
			expect(response.text).toBeTruthy();
			expect(response.text.toLowerCase()).toMatch(/paris/);
			expect(response).toHaveProperty('usage');
			expect(response.data).toBeUndefined();
		});

		it('should include usage data', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			const response = await msg.send('Say hello.');
			expect(response.usage).toBeTruthy();
			expect(response.usage.promptTokens).toBeGreaterThan(0);
			expect(response.usage.totalTokens).toBeGreaterThan(0);
		});

		it('should auto-init', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			const response = await msg.send('Hello');
			expect(response.text).toBeTruthy();
		});
	});

	// ── send() — Structured Mode ─────────────────────────────────────────────

	describe('send() — structured JSON responses', () => {
		it('should return parsed data when responseMimeType is application/json', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Extract the name and age from the text. Return as JSON with "name" and "age" keys.',
				responseMimeType: 'application/json',
				responseSchema: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						age: { type: 'number' }
					},
					required: ['name', 'age']
				}
			});
			const response = await msg.send('Alice is 30 years old.');
			expect(response.data).toBeTruthy();
			expect(response.data.name).toBeTruthy();
		});

		it('should return data with responseSchema', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Extract entities.',
				responseMimeType: 'application/json',
				responseSchema: {
					type: 'object',
					properties: {
						entities: {
							type: 'array',
							items: { type: 'string' }
						}
					}
				}
			});
			const response = await msg.send('Alice works at Acme in New York.');
			expect(response.data).toBeTruthy();
		});
	});

	// ── Stateless Behavior ───────────────────────────────────────────────────

	describe('Stateless behavior', () => {
		it('should not maintain history between sends', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely.'
			});

			await msg.send('My name is TestUser.');
			const response = await msg.send('What is my name?');
			// Stateless — should NOT remember the name
			expect(response.text.toLowerCase()).not.toContain('testuser');
		});

		it('should return empty history always', () => {
			const msg = new Message({ ...BASE_OPTIONS });
			expect(msg.getHistory()).toEqual([]);
		});

		it('should no-op on clearHistory', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			await msg.clearHistory(); // Should not throw
		});

		it('should warn on seed()', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			const result = await msg.seed([{ PROMPT: 'x', ANSWER: 'y' }]);
			expect(result).toEqual([]);
		});
	});

	// ── Unsupported methods ─────────────────────────────────────────────────

	describe('Unsupported methods', () => {
		it('should throw on estimate()', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			await expect(msg.estimate({ test: 1 })).rejects.toThrow(/stateless/i);
		});
	});

	// ── Edge Cases ───────────────────────────────────────────────────────────

	describe('Edge Cases', () => {
		it('should handle object payloads', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Describe the object you receive.',
			});
			const response = await msg.send({ key: 'value', count: 42 });
			expect(response.text).toBeTruthy();
		});

		it('should handle special characters', async () => {
			const msg = new Message({ ...BASE_OPTIONS });
			const response = await msg.send('Hello 🌍 "world" \n test');
			expect(response.text).toBeTruthy();
		});
	});

	// ── Concurrent Operations ────────────────────────────────────────────────

	describe('Concurrent Operations', () => {
		it('should handle concurrent sends', async () => {
			const msg = new Message({
				...BASE_OPTIONS,
				systemPrompt: 'Reply with one word.'
			});

			const responses = await Promise.all([
				msg.send('Say alpha'),
				msg.send('Say beta'),
				msg.send('Say gamma')
			]);

			responses.forEach(r => {
				expect(r.text).toBeTruthy();
			});
		});
	});
});
