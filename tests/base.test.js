import dotenv from 'dotenv';
dotenv.config();
import { Transformer, Chat, BaseGemini, log } from '../index.js';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash-lite',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};

describe('BaseGemini — Shared Behavior', () => {

	// ── Auth ──────────────────────────────────────────────────────────────────

	describe('Authentication', () => {
		it('should throw on missing API key', () => {
			expect(() => new Chat({})).toThrow(/api key/i);
		});

		it('should throw on empty string API key', () => {
			expect(() => new Chat({ apiKey: '' })).toThrow(/api key/i);
		});

		it('should throw on Vertex AI without project', () => {
			const savedProject = process.env.GOOGLE_CLOUD_PROJECT;
			delete process.env.GOOGLE_CLOUD_PROJECT;
			try {
				expect(() => new Chat({ vertexai: true })).toThrow(/project/i);
			} finally {
				if (savedProject) process.env.GOOGLE_CLOUD_PROJECT = savedProject;
			}
		});

		it('should accept API key via options', () => {
			const chat = new Chat({ apiKey: GEMINI_API_KEY });
			expect(chat.apiKey).toBe(GEMINI_API_KEY);
		});
	});

	// ── Init ─────────────────────────────────────────────────────────────────

	describe('init()', () => {
		it('should initialize and create a chat session', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			expect(chat.chatSession).toBeTruthy();
			expect(chat.genAIClient).toBeTruthy();
		});

		it('should be idempotent', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const session = chat.chatSession;
			await chat.init();
			expect(chat.chatSession).toBe(session);
		});

		it('should reinitialize when force=true', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const session1 = chat.chatSession;
			await chat.init(true);
			expect(chat.chatSession).not.toBe(session1);
		});

		it('should throw on invalid API key', async () => {
			const chat = new Chat({ ...BASE_OPTIONS, apiKey: 'invalid-key-xxx' });
			await expect(chat.init()).rejects.toThrow();
		});
	});

	// ── Usage Tracking ───────────────────────────────────────────────────────

	describe('getLastUsage()', () => {
		it('should return null before any API call', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.getLastUsage()).toBeNull();
		});

		it('should return usage data after a call', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.send('Say hi.');
			const usage = chat.getLastUsage();
			expect(usage).toBeTruthy();
			expect(typeof usage.promptTokens).toBe('number');
			expect(typeof usage.responseTokens).toBe('number');
			expect(typeof usage.totalTokens).toBe('number');
			expect(usage.promptTokens).toBeGreaterThan(0);
			expect(usage.requestedModel).toBe('gemini-2.0-flash-lite');
			expect(typeof usage.timestamp).toBe('number');
		});
	});

	// ── Token Estimation ─────────────────────────────────────────────────────

	describe('estimate()', () => {
		it('should estimate input tokens for a payload', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const count = await chat.estimate({ foo: "bar" });
			expect(typeof count.inputTokens).toBe('number');
			expect(count.inputTokens).toBeGreaterThan(0);
		});
	});

	describe('estimateCost()', () => {
		it('should estimate cost based on input tokens', async () => {
			const chat = new Chat({ ...BASE_OPTIONS, modelName: 'gemini-2.5-flash' });
			await chat.init();
			const cost = await chat.estimateCost({ test: 'payload' });
			expect(cost).toHaveProperty('inputTokens');
			expect(cost).toHaveProperty('model');
			expect(cost).toHaveProperty('pricing');
			expect(cost).toHaveProperty('estimatedInputCost');
			expect(cost.model).toBe('gemini-2.5-flash');
		});
	});

	// ── Seed (on BaseGemini) ─────────────────────────────────────────────────

	describe('seed()', () => {
		it('should add example pairs to chat history', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.seed([
				{ PROMPT: { x: 1 }, ANSWER: { y: 2 } },
				{ PROMPT: { x: 3 }, ANSWER: { y: 6 } }
			]);
			const history = chat.getHistory();
			expect(history.length).toBe(4); // 2 examples * 2 messages
		});

		it('should handle empty or null examples', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.seed([]);
			await chat.seed(null);
			await chat.seed(undefined);
			// Should not throw
		});
	});

	// ── History ──────────────────────────────────────────────────────────────

	describe('getHistory()', () => {
		it('should return empty array before init', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.getHistory()).toEqual([]);
		});
	});

	describe('clearHistory()', () => {
		it('should clear history', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.send('Remember this.');
			expect(chat.getHistory().length).toBeGreaterThan(0);
			await chat.clearHistory();
			expect(chat.getHistory().length).toBe(0);
			expect(chat.lastResponseMetadata).toBeNull();
		});
	});

	// ── Thinking Config ──────────────────────────────────────────────────────

	describe('Thinking Config', () => {
		it('should handle thinkingConfig set to null', () => {
			const chat = new Chat({ ...BASE_OPTIONS, thinkingConfig: null });
			expect(chat.chatConfig.thinkingConfig).toBeUndefined();
		});

		it('should apply thinkingConfig on supported models', () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				modelName: 'gemini-2.5-flash',
				thinkingConfig: { thinkingBudget: 1000 }
			});
			expect(chat.chatConfig.thinkingConfig).toBeTruthy();
			expect(chat.chatConfig.thinkingConfig.thinkingBudget).toBe(1000);
		});

		it('should remove thinkingBudget when thinkingLevel is set', () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				modelName: 'gemini-2.5-flash',
				thinkingConfig: { thinkingLevel: 'THINKING_LOW' }
			});
			expect(chat.chatConfig.thinkingConfig.thinkingLevel).toBe('THINKING_LOW');
			expect(chat.chatConfig.thinkingConfig.thinkingBudget).toBeUndefined();
		});

		it('should ignore thinkingConfig on unsupported models', () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				modelName: 'gemini-2.0-flash-lite',
				thinkingConfig: { thinkingBudget: 500 }
			});
			expect(chat.chatConfig.thinkingConfig).toBeUndefined();
		});
	});

	// ── Max Output Tokens ────────────────────────────────────────────────────

	describe('maxOutputTokens', () => {
		it('should use default when not specified', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.chatConfig.maxOutputTokens).toBe(50_000);
		});

		it('should accept custom maxOutputTokens', () => {
			const chat = new Chat({ ...BASE_OPTIONS, maxOutputTokens: 10_000 });
			expect(chat.chatConfig.maxOutputTokens).toBe(10_000);
		});

		it('should remove maxOutputTokens when set to null', () => {
			const chat = new Chat({ ...BASE_OPTIONS, maxOutputTokens: null });
			expect(chat.chatConfig.maxOutputTokens).toBeUndefined();
		});

		it('should remove maxOutputTokens when set to null via chatConfig', () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				chatConfig: { maxOutputTokens: null }
			});
			expect(chat.chatConfig.maxOutputTokens).toBeUndefined();
		});
	});

	// ── Log Level ────────────────────────────────────────────────────────────

	describe('Log Level', () => {
		it('should accept logLevel "none" as silent', () => {
			const chat = new Chat({ ...BASE_OPTIONS, logLevel: 'none' });
			expect(log.level).toBe('silent');
		});

		it('should accept custom logLevel', () => {
			const chat = new Chat({ ...BASE_OPTIONS, logLevel: 'error' });
			expect(log.level).toBe('error');
		});
	});

	// ── clearHistory edge cases ─────────────────────────────────────────────

	describe('clearHistory — edge cases', () => {
		it('should not throw when called before init', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.clearHistory(); // should not throw
		});
	});

	// ── Labels ───────────────────────────────────────────────────────────────

	describe('Labels', () => {
		it('should accept labels option', () => {
			const chat = new Chat({ ...BASE_OPTIONS, labels: { app: 'test', env: 'ci' } });
			expect(chat.labels).toEqual({ app: 'test', env: 'ci' });
		});
	});

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should set model name', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.modelName).toBe('gemini-2.0-flash-lite');
		});

		it('should have null lastResponseMetadata before any call', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.lastResponseMetadata).toBeNull();
		});
	});
});
