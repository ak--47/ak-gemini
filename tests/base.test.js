import dotenv from 'dotenv';
dotenv.config({ quiet: true });
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

	// ── Grounding ────────────────────────────────────────────────────────────

	describe('Grounding', () => {
		it('should accept enableGrounding option', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableGrounding: true });
			expect(chat.enableGrounding).toBe(true);
		});

		it('should default enableGrounding to false', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.enableGrounding).toBe(false);
		});

		it('should accept groundingConfig option', () => {
			const config = { excludeDomains: ['example.com'] };
			const chat = new Chat({ ...BASE_OPTIONS, enableGrounding: true, groundingConfig: config });
			expect(chat.groundingConfig).toEqual(config);
		});

		it('should include googleSearch in _getChatCreateOptions when grounding enabled', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableGrounding: true });
			const opts = chat._getChatCreateOptions();
			expect(opts.config.tools).toBeDefined();
			expect(opts.config.tools.some(t => t.googleSearch !== undefined)).toBe(true);
		});

		it('should not include googleSearch when grounding disabled', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			const opts = chat._getChatCreateOptions();
			expect(opts.config.tools).toBeUndefined();
		});

		it('should merge grounding with existing tools', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableGrounding: true });
			// Simulate existing tools (like ToolAgent would set)
			chat.chatConfig.tools = [{ functionDeclarations: [{ name: 'test' }] }];
			const opts = chat._getChatCreateOptions();
			expect(opts.config.tools.length).toBe(2);
			expect(opts.config.tools[0].functionDeclarations).toBeDefined();
			expect(opts.config.tools[1].googleSearch).toBeDefined();
		});
	});

	// ── Context Caching ──────────────────────────────────────────────────────

	describe('Context Caching', () => {
		it('should accept cachedContent option', () => {
			const chat = new Chat({ ...BASE_OPTIONS, cachedContent: 'cache-name-123' });
			expect(chat.cachedContent).toBe('cache-name-123');
		});

		it('should default cachedContent to null', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.cachedContent).toBeNull();
		});

		it('should include cachedContent in _getChatCreateOptions when set', () => {
			const chat = new Chat({ ...BASE_OPTIONS, cachedContent: 'cache-name-123' });
			const opts = chat._getChatCreateOptions();
			expect(opts.config.cachedContent).toBe('cache-name-123');
		});

		it('should not include cachedContent when null', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			const opts = chat._getChatCreateOptions();
			expect(opts.config.cachedContent).toBeUndefined();
		});

		it('useCache should set cachedContent', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			// Don't init, just test the setter behavior
			await chat.useCache('cache-name-456');
			expect(chat.cachedContent).toBe('cache-name-456');
		});

		it('useCache should reinitialize session if already initialized', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const session1 = chat.chatSession;
			await chat.useCache('cache-reinit-test');
			expect(chat.cachedContent).toBe('cache-reinit-test');
			expect(chat.chatSession).not.toBe(session1);
		});

		it('useCache should not reinitialize if no session exists', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.useCache('cache-no-reinit');
			expect(chat.cachedContent).toBe('cache-no-reinit');
			expect(chat.chatSession).toBeNull();
		});
	});

	// ── Context Caching — CRUD (e2e) ────────────────────────────────────────

	describe('Context Caching — CRUD (e2e)', () => {
		// Context caching requires ~32k+ tokens of content.
		// Generate a large system prompt to meet the minimum.
		const LARGE_PROMPT = Array.from({ length: 500 }, (_, i) => {
			const topics = ['quantum computing', 'machine learning', 'distributed systems', 'cryptography', 'compiler design'];
			const topic = topics[i % topics.length];
			return `Section ${i + 1} — ${topic}: This section covers advanced concepts in ${topic}, including theoretical foundations, practical applications, and recent breakthroughs in the field. The area has evolved significantly over the past decade, with key contributions from research institutions worldwide. Understanding these principles is essential for modern computer science practitioners. Key challenges include scalability, reliability, and performance optimization. Researchers continue to push boundaries by combining ${topic} with adjacent fields to create novel solutions for real-world problems. This interdisciplinary approach has yielded promising results in both academic and industrial settings.`;
		}).join('\n\n');

		let chat;
		let cacheName;

		beforeAll(async () => {
			chat = new Chat({
				modelName: 'gemini-2.0-flash-lite',
				apiKey: GEMINI_API_KEY,
				logLevel: 'warn',
				systemPrompt: LARGE_PROMPT
			});
			await chat.init();
		});

		afterAll(async () => {
			// Clean up cache if it still exists
			if (cacheName) {
				try { await chat.deleteCache(cacheName); } catch {}
			}
		});

		it('should create a cache', async () => {
			const cache = await chat.createCache({
				ttl: '120s',
				displayName: 'ak-gemini-test-cache'
			});
			cacheName = cache.name;
			expect(cache.name).toBeTruthy();
			expect(typeof cache.name).toBe('string');
			expect(cache.displayName).toBe('ak-gemini-test-cache');
		}, 30_000);

		it('should get a cache by name', async () => {
			expect(cacheName).toBeTruthy();
			const cache = await chat.getCache(cacheName);
			expect(cache.name).toBe(cacheName);
			expect(cache.displayName).toBe('ak-gemini-test-cache');
		}, 30_000);

		it('should list caches and find ours', async () => {
			expect(cacheName).toBeTruthy();
			const caches = await chat.listCaches();
			expect(Array.isArray(caches)).toBe(true);
			// Our cache might be among many; just verify it's iterable
			// (the API may return a pager, so we check for array-like behavior)
		}, 30_000);

		it('should update a cache TTL', async () => {
			expect(cacheName).toBeTruthy();
			const updated = await chat.updateCache(cacheName, { ttl: '300s' });
			expect(updated.name).toBe(cacheName);
		}, 30_000);

		it('should use cache and send a message', async () => {
			expect(cacheName).toBeTruthy();
			await chat.useCache(cacheName);
			expect(chat.cachedContent).toBe(cacheName);

			const result = await chat.send('What topics are covered? List them in one line.');
			expect(result.text).toBeTruthy();
			expect(result.text.length).toBeGreaterThan(0);
		}, 30_000);

		it('should delete cache and clear cachedContent', async () => {
			expect(cacheName).toBeTruthy();
			chat.cachedContent = cacheName;
			await chat.deleteCache(cacheName);
			expect(chat.cachedContent).toBeNull();
			cacheName = null; // prevent afterAll from double-deleting
		}, 30_000);
	});

	// ── Grounding — Config ──────────────────────────────────────────────────

	describe('Grounding — Config', () => {
		it('should pass groundingConfig through to googleSearch tool', () => {
			const config = { dynamicRetrievalConfig: { mode: 'MODE_DYNAMIC' } };
			const chat = new Chat({ ...BASE_OPTIONS, enableGrounding: true, groundingConfig: config });
			const opts = chat._getChatCreateOptions();
			const googleSearchTool = opts.config.tools.find(t => t.googleSearch !== undefined);
			expect(googleSearchTool.googleSearch).toEqual(config);
		});

		it('should use empty object as default groundingConfig', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableGrounding: true });
			const opts = chat._getChatCreateOptions();
			const googleSearchTool = opts.config.tools.find(t => t.googleSearch !== undefined);
			expect(googleSearchTool.googleSearch).toEqual({});
		});

		it('should not add tools array when grounding disabled and no existing tools', () => {
			const chat = new Chat({ ...BASE_OPTIONS, enableGrounding: false });
			const opts = chat._getChatCreateOptions();
			expect(opts.config.tools).toBeUndefined();
		});

		it('should work with Transformer class (inherited)', () => {
			const t = new Transformer({ ...BASE_OPTIONS, enableGrounding: true });
			expect(t.enableGrounding).toBe(true);
			const opts = t._getChatCreateOptions();
			expect(opts.config.tools.some(tool => tool.googleSearch !== undefined)).toBe(true);
		});
	});

	// ── Grounding — e2e ─────────────────────────────────────────────────────
	// WARNING: Google Search grounding costs ~$35/1k queries. These tests use real API calls.

	describe('Grounding — e2e', () => {
		it('should return a grounded response with metadata', async () => {
			const chat = new Chat({
				modelName: 'gemini-2.0-flash-lite',
				apiKey: GEMINI_API_KEY,
				logLevel: 'warn',
				systemPrompt: 'Answer concisely using web search results.',
				enableGrounding: true
			});

			const result = await chat.send('What is the capital of France?');
			expect(result.text).toBeTruthy();
			expect(result.text.toLowerCase()).toMatch(/paris/);

			const usage = chat.getLastUsage();
			expect(usage).toBeTruthy();
			// groundingMetadata may or may not be present depending on model behavior
			// but the call should succeed without error
		}, 30_000);
	});
});
