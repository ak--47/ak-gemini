import dotenv from 'dotenv';
dotenv.config();
import { Chat } from '../index.js';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash-lite',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};


describe('Chat', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should create with default system prompt', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.systemPrompt).toBe('You are a helpful AI assistant.');
		});

		it('should accept custom system prompt', () => {
			const chat = new Chat({ ...BASE_OPTIONS, systemPrompt: 'You are a pirate.' });
			expect(chat.systemPrompt).toBe('You are a pirate.');
		});

		it('should have send() method', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(typeof chat.send).toBe('function');
		});
	});

	// ── send() ───────────────────────────────────────────────────────────────

	describe('send()', () => {
		let chat;
		beforeAll(async () => {
			chat = new Chat({
				...BASE_OPTIONS,
				systemPrompt: 'You are a helpful assistant. Respond concisely.'
			});
			await chat.init();
		});

		it('should return text response', async () => {
			const response = await chat.send('What is 2 + 2? Reply with just the number.');
			expect(response.text).toBeTruthy();
			expect(response.text).toContain('4');
		});

		it('should return ChatResponse structure', async () => {
			const response = await chat.send('Say hello.');
			expect(response).toHaveProperty('text');
			expect(response).toHaveProperty('usage');
			expect(typeof response.text).toBe('string');
		});

		it('should include usage data', async () => {
			const response = await chat.send('Say hi.');
			expect(response.usage).toBeTruthy();
			expect(response.usage.promptTokens).toBeGreaterThan(0);
			expect(response.usage.totalTokens).toBeGreaterThan(0);
			expect(response.usage.requestedModel).toBe('gemini-2.0-flash-lite');
		});

		it('should auto-init if not called', async () => {
			const lazyChat = new Chat({ ...BASE_OPTIONS });
			const response = await lazyChat.send('Say hello.');
			expect(response.text).toBeTruthy();
			expect(lazyChat.chatSession).toBeTruthy();
		});
	});

	// ── Multi-turn Conversation ──────────────────────────────────────────────

	describe('Multi-turn Conversation', () => {
		it('should remember context across turns', async () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				systemPrompt: 'You remember context. Respond concisely.'
			});
			await chat.init();

			await chat.send('My name is Zorblax and I love building robots.');
			const response = await chat.send('What is my name?');
			expect(response.text.toLowerCase()).toContain('zorblax');
		});

		it('should maintain history across multiple exchanges', async () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely.'
			});
			await chat.init();

			await chat.send('Remember the number 42.');
			await chat.send('Remember the word "quartz".');
			const response = await chat.send('What number and word did I ask you to remember?');
			expect(response.text).toMatch(/42/);
			expect(response.text.toLowerCase()).toMatch(/quartz/);
		});

		it('should lose context after clearHistory', async () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely. If you don\'t know, say "I don\'t know".'
			});
			await chat.init();

			await chat.send('My secret code is ALPHA-7.');
			await chat.clearHistory();
			const response = await chat.send('What is my secret code?');
			expect(response.text.toLowerCase()).not.toContain('alpha-7');
		});
	});

	// ── History Management ───────────────────────────────────────────────────

	describe('History Management', () => {
		it('should return empty history before any messages', () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			expect(chat.getHistory()).toEqual([]);
		});

		it('should return non-empty history after messages', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.send('Hello.');
			const history = chat.getHistory();
			expect(history.length).toBeGreaterThan(0);
		});

		it('should still work after clearHistory', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			await chat.send('First message.');
			await chat.clearHistory();
			const response = await chat.send('Second message after clear.');
			expect(response.text).toBeTruthy();
		});
	});

	// ── Edge Cases ───────────────────────────────────────────────────────────

	describe('Edge Cases', () => {
		it('should handle very short messages', async () => {
			const chat = new Chat({ ...BASE_OPTIONS });
			await chat.init();
			const response = await chat.send('Hi');
			expect(response.text).toBeTruthy();
		});

		it('should handle special characters', async () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				systemPrompt: 'Reply concisely.'
			});
			await chat.init();
			const response = await chat.send('What does "Hello World" mean? 🌍\n\nTell me.');
			expect(response.text).toBeTruthy();
		});

		it('should handle multiple sequential sends', async () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				systemPrompt: 'Respond with one word.'
			});
			await chat.init();
			const r1 = await chat.send('Say "alpha"');
			const r2 = await chat.send('Say "beta"');
			const r3 = await chat.send('Say "gamma"');
			expect(r1.text).toBeTruthy();
			expect(r2.text).toBeTruthy();
			expect(r3.text).toBeTruthy();
		});
	});

	// ── Few-Shot Seeding (via BaseGemini) ────────────────────────────────────

	describe('seed() — inherited from BaseGemini', () => {
		it('should seed with examples and use them for context', async () => {
			const chat = new Chat({
				...BASE_OPTIONS,
				systemPrompt: 'You are a helpful assistant who follows patterns from examples.'
			});
			await chat.init();

			await chat.seed([
				{ PROMPT: "What color is the sky?", ANSWER: "The sky is blue." },
				{ PROMPT: "What color is grass?", ANSWER: "Grass is green." }
			]);

			const history = chat.getHistory();
			expect(history.length).toBe(4); // 2 examples * 2
		});
	});

	// ── Concurrent Operations ────────────────────────────────────────────────

	describe('Concurrent Operations', () => {
		it('should handle concurrent sends on separate instances', async () => {
			const chats = Array.from({ length: 3 }, () =>
				new Chat({ ...BASE_OPTIONS, systemPrompt: 'Reply with one word.' })
			);

			const responses = await Promise.all(
				chats.map(c => c.send('Say hello.'))
			);

			responses.forEach(response => {
				expect(response.text).toBeTruthy();
			});
		});
	});
});
