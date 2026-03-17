import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { Transformer, attemptJSONRecovery, log } from '../index.js';
import path from 'path';
import fs from 'fs';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

/** @typedef {import('../types.d.ts').TransformerOptions} Options */

/** @type {Options} */
const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash-lite',
	apiKey: GEMINI_API_KEY,
	chatConfig: { topK: 21, temperature: 0.1 }
};


describe('Transformer — Basics', () => {
	let transformer;
	const simpleExamples = [
		{ PROMPT: { x: 1 }, ANSWER: { y: 2 } },
		{ PROMPT: { x: 3 }, ANSWER: { y: 6 } }
	];

	beforeAll(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	describe('Constructor', () => {
		it('should create with default options', () => {
			const t = new Transformer({ ...BASE_OPTIONS });
			expect(t.modelName).toMatch(/gemini/);
			expect(typeof t.init).toBe('function');
			expect(typeof t.send).toBe('function');
			expect(typeof t.seed).toBe('function');
		});

		it('should have JSON responseMimeType by default', () => {
			const t = new Transformer({ ...BASE_OPTIONS });
			expect(t.chatConfig.responseMimeType).toBe('application/json');
		});

		it('should throw when promptKey === answerKey', () => {
			expect(() => new Transformer({ ...BASE_OPTIONS, promptKey: 'X', answerKey: 'X' }))
				.toThrow(/same/i);
		});
	});

	describe('init', () => {
		it('should initialize chat session', async () => {
			await transformer.init();
			expect(transformer.chatSession).toBeTruthy();
		});
	});

	describe('seed', () => {
		it('should seed chat with examples', async () => {
			await transformer.seed(simpleExamples);
			const history = transformer.getHistory();
			expect(Array.isArray(history)).toBe(true);
			expect(history.length).toBeGreaterThan(0);
		});
	});

	describe('send', () => {
		it('should transform a basic payload', async () => {
			await transformer.seed(simpleExamples);
			const result = await transformer.send({ x: 10 });
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});

		it('should work with numeric payloads', async () => {
			const result = await transformer.send(123);
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});
	});

	describe('estimate', () => {
		it('should estimate input token usage', async () => {
			const count = await transformer.estimate({ foo: "bar" });
			expect(typeof count.inputTokens).toBe('number');
			expect(count.inputTokens).toBeGreaterThan(0);
		});
	});

	describe('validation', () => {
		it('should pass through an identity validator', async () => {
			const validator = p => Promise.resolve(p);
			const result = await transformer.send({ x: 5 }, {}, validator);
			expect(result).toBeTruthy();
		});

		it('should support a validator on init', async () => {
			const validator = p => {
				if (p.x < 0) throw new Error("wrong try again");
				return Promise.resolve(p);
			};
			const t2 = new Transformer({ ...BASE_OPTIONS, asyncValidator: validator, maxRetries: 1 });
			await t2.init();
			const result = await t2.send({ x: 10, "operation": "multiply by two" });
			expect(result).toBeTruthy();
		});
	});

	describe('Error handling', () => {
		it('should throw when chat not initialized', async () => {
			const t2 = new Transformer({ ...BASE_OPTIONS });
			await expect(t2.send({ foo: 1 })).rejects.toThrow(/not initialized/i);
		});
	});

	describe('reset()', () => {
		it('should reset chat session', async () => {
			await transformer.reset();
			expect(transformer.chatSession).toBeTruthy();
		});
	});

	describe('Edge cases', () => {
		it('should handle special characters', async () => {
			const payload = { text: "Hi \"world\"\n🚀" };
			const result = await transformer.send(payload);
			expect(result).toBeTruthy();
		});
	});
});


describe('Transformer — CONTEXT and EXPLANATION', () => {
	let transformer;
	const contextExamples = [
		{
			CONTEXT: "Add 1 to the input.",
			PROMPT: { value: 3 },
			ANSWER: { value: 4 },
			EXPLANATION: "Increment the value by 1."
		},
		{
			CONTEXT: "Multiply the input by 2.",
			PROMPT: { value: 5 },
			ANSWER: { value: 10 },
			EXPLANATION: "Multiply the input by two."
		},
		{
			CONTEXT: "Square the input.",
			PROMPT: { value: 4 },
			ANSWER: { value: 16 }
		}
	];

	beforeAll(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should seed examples with context and explanation fields', async () => {
		await transformer.seed(contextExamples);
		const history = transformer.getHistory();
		expect(history.length).toBe(contextExamples.length * 2);

		contextExamples.forEach((example, idx) => {
			const userMsg = history[idx * 2];
			const modelMsg = history[idx * 2 + 1];
			expect(userMsg.role).toBe('user');
			expect(modelMsg.role).toBe('model');
			if (example.CONTEXT) {
				expect(userMsg.parts[0].text).toMatch(example.CONTEXT);
			}
			const parsedModel = JSON.parse(modelMsg.parts[0].text);
			expect(parsedModel.data).toEqual(example.ANSWER);
			if (example.EXPLANATION) {
				expect(parsedModel.explanation).toBe(example.EXPLANATION);
			} else {
				expect(parsedModel.explanation).toBeUndefined();
			}
		});
	});

	it('should use context in the prompt', async () => {
		await transformer.seed(contextExamples);
		const result = await transformer.send({ value: 41, CONTEXT: "Add 1 to the input. Put the answer in a key called 'value'" });
		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
		expect(Number(result.value)).toBe(42);
	});
});


describe('Transformer — System Prompt Handling', () => {
	it('should use default JSON instructions when systemPrompt not provided', async () => {
		const t = new Transformer({ apiKey: GEMINI_API_KEY });
		expect(t.systemPrompt).toContain('JSON transformation engine');
		expect(t.chatConfig.systemInstruction).toContain('JSON transformation engine');
	});

	it('should use custom systemPrompt', async () => {
		const custom = 'You are a pirate.';
		const t = new Transformer({ apiKey: GEMINI_API_KEY, systemPrompt: custom });
		expect(t.systemPrompt).toBe(custom);
		expect(t.chatConfig.systemInstruction).toBe(custom);
	});

	it('should remove systemPrompt when set to null', async () => {
		const t = new Transformer({ apiKey: GEMINI_API_KEY, systemPrompt: null });
		expect(t.systemPrompt).toBeNull();
		expect(t.chatConfig.systemInstruction).toBeUndefined();
	});

	it('should remove systemPrompt when set to false', async () => {
		const t = new Transformer({ apiKey: GEMINI_API_KEY, systemPrompt: false });
		expect(t.systemPrompt).toBe(false);
		expect(t.chatConfig.systemInstruction).toBeUndefined();
	});
});


describe('Transformer — Custom Keys', () => {
	it('should respect custom prompt and answer keys', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			promptKey: 'INPUT',
			answerKey: 'OUTPUT'
		});

		await transformer.seed([
			{ INPUT: { a: 1 }, OUTPUT: { b: 2 } }
		]);

		const history = transformer.getHistory();
		const userMsg = JSON.parse(history[0].parts[0].text);
		const modelMsg = JSON.parse(history[1].parts[0].text);

		expect(userMsg).toEqual({ a: 1 });
		expect(modelMsg.data).toEqual({ b: 2 });

		const result = await transformer.send({ a: 10 });
		expect(result.b).toBeDefined();
	});

	it('should handle custom key mappings', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			contextKey: 'background',
			promptKey: 'input',
			answerKey: 'output',
			explanationKey: 'reasoning'
		});
		await transformer.init();

		const examples = [{
			background: "Convert to uppercase",
			input: { text: "hello" },
			output: { text: "HELLO" },
			reasoning: "Simple case conversion"
		}];

		await transformer.seed(examples);
		const result = await transformer.send({ text: "world" });
		expect(result.text).toBe("WORLD");
	});
});


describe('Transformer — Validation & Retry', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should retry on validation failure', async () => {
		await transformer.seed([{ PROMPT: { value: 1 }, ANSWER: { result: 2 } }]);

		let attempts = 0;
		const validator = (payload) => {
			attempts++;
			if (attempts < 2) throw new Error("Validation failed - retry needed");
			return Promise.resolve(payload);
		};

		const result = await transformer.send({ value: 5 }, { maxRetries: 2 }, validator);
		expect(result).toBeTruthy();
		expect(attempts).toBe(2);
	});

	it('should throw after max retries exhausted', async () => {
		const validator = () => { throw new Error("Always fails"); };

		await expect(
			transformer.send({ test: 1 }, { maxRetries: 1 }, validator)
		).rejects.toThrow(/failed after 2 attempts/i);
	});

	it('should use exponential backoff', async () => {
		const startTime = Date.now();
		let attempts = 0;
		const validator = () => {
			attempts++;
			if (attempts < 3) throw new Error("Retry needed");
			return Promise.resolve({ success: true });
		};

		await transformer.send({ test: 1 }, { maxRetries: 3, retryDelay: 100 }, validator);

		const duration = Date.now() - startTime;
		expect(duration).toBeGreaterThan(250); // 100ms + 200ms
	});
});


describe('Transformer — State & Reset', () => {
	it('should clear history on reset()', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);
		expect(transformer.getHistory().length).toBe(2);

		await transformer.reset();
		expect(transformer.getHistory().length).toBe(0);

		const result = await transformer.send({ z: 123 });
		expect(typeof result).toBe('object');
	});

	it('should be idempotent on init()', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		const session = transformer.chatSession;
		await transformer.init();
		expect(transformer.chatSession).toBe(session);
	});

	it('should preserve examples on clearHistory()', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.seed([
			{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }
		]);
		const initialCount = transformer.exampleCount;

		await transformer.send({ x: 5 });
		await transformer.clearHistory();

		const history = transformer.getHistory();
		expect(history.length).toBe(initialCount);
	});
});


describe('Transformer — Data Edge Cases', () => {
	let transformer;

	beforeAll(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should handle empty array as ANSWER', async () => {
		await transformer.seed([{ PROMPT: { type: 'list' }, ANSWER: [] }]);
		const history = transformer.getHistory();
		const modelMsg = JSON.parse(history[1].parts[0].text);
		expect(modelMsg.data).toEqual([]);

		const result = await transformer.send({ type: 'list' });
		expect(Array.isArray(result)).toBe(true);
	});

	it('should handle empty object as PROMPT', async () => {
		await transformer.seed([{ PROMPT: {}, ANSWER: { status: 'empty_input' } }]);
		const result = await transformer.send({});
		expect(result.status).toBe('empty_input');
	});

	it('should handle deeply nested JSON', async () => {
		const complex = [{
			PROMPT: {
				user: { profile: { name: "John", settings: { theme: "dark" } } }
			},
			ANSWER: {
				status: "success",
				updated: { name: "John", theme: "dark" }
			}
		}];

		await transformer.seed(complex);
		const result = await transformer.send({
			user: { profile: { name: "Jane", settings: { theme: "light" } } }
		});
		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
	});
});


describe('Transformer — Seeding Edge Cases', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should handle empty examples array', async () => {
		await transformer.seed([]);
		const history = transformer.getHistory();
		expect(history.length).toBe(0);
	});

	it('should handle null/undefined examples', async () => {
		await transformer.seed(null);
		await transformer.seed(undefined);
	});

	it('should handle many examples', async () => {
		const many = Array.from({ length: 50 }, (_, i) => ({
			PROMPT: { index: i },
			ANSWER: { doubled: i * 2 }
		}));

		await transformer.seed(many);
		const history = transformer.getHistory();
		expect(history.length).toBe(100);

		const result = await transformer.send({ index: 99 });
		expect(result.doubled).toBe(198);
	});
});


describe('Transformer — System Prompt Override via Examples', () => {
	it('should override system prompt from SYSTEM key in examples', async () => {
		const transformer = new Transformer({ apiKey: GEMINI_API_KEY });
		const newPrompt = "You are a poet. Respond with a haiku about the input number.";

		await transformer.seed([
			{ PROMPT: { number: 5 }, ANSWER: { haiku: "Five is a nice number, balanced and so clear, a joy to behold." } },
			{ SYSTEM: newPrompt }
		]);

		expect(transformer.chatConfig.systemInstruction).toBe(newPrompt);
	});
});


describe('Transformer — File-based Examples', () => {
	const examplesFilePath = path.resolve('./tests/examples.json');
	const examplesContent = [
		{
			"userInput": "What is the weather?",
			"assistantResponse": { "answer": "sunny" },
			"meta": "Weather query"
		},
		{
			"userInput": "Tell a joke",
			"assistantResponse": { "joke": "Why did the chicken cross the road?" },
			"meta": "Humor request"
		}
	];

	beforeAll(() => {
		if (!fs.existsSync(path.dirname(examplesFilePath))) {
			fs.mkdirSync(path.dirname(examplesFilePath));
		}
		fs.writeFileSync(examplesFilePath, JSON.stringify(examplesContent, null, 4));
	});

	afterAll(() => {
		fs.unlinkSync(examplesFilePath);
	});

	it('should load examples from file', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			examplesFile: examplesFilePath,
			promptKey: 'userInput',
			answerKey: 'assistantResponse'
		});

		await transformer.seed();
		const history = transformer.getHistory();
		expect(history.length).toBe(4);
	});

	it('should handle missing examples file', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			examplesFile: './nonexistent.json'
		});
		await transformer.init();

		try {
			await transformer.seed();
		} catch (error) {
			expect(error.message).toMatch(/could not load/i);
		}
	});
});


describe('Transformer — Concurrent Operations', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		await transformer.seed([{ PROMPT: { n: 1 }, ANSWER: { doubled: 2 } }]);
	});

	it('should handle multiple concurrent sends', async () => {
		const promises = Array.from({ length: 3 }, (_, i) =>
			transformer.send({ n: i + 1 })
		);

		const results = await Promise.all(promises);
		results.forEach((result) => {
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});
	});
});


describe('Transformer — Cost Estimation', () => {
	it('should estimate cost', async () => {
		const transformer = new Transformer({
			apiKey: GEMINI_API_KEY,
			modelName: 'gemini-2.5-flash'
		});
		await transformer.init();

		const cost = await transformer.estimateCost({ test: 'payload' });
		expect(cost).toHaveProperty('inputTokens');
		expect(cost).toHaveProperty('model');
		expect(cost).toHaveProperty('pricing');
		expect(cost).toHaveProperty('estimatedInputCost');
		expect(cost.model).toBe('gemini-2.5-flash');
	});
});


describe('Transformer — updateSystemPrompt', () => {
	it('should update system prompt and reinitialize', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		const originalPrompt = transformer.systemPrompt;

		await transformer.updateSystemPrompt('You are a math tutor.');
		expect(transformer.systemPrompt).toBe('You are a math tutor.');
		expect(transformer.chatConfig.systemInstruction).toBe('You are a math tutor.');
		expect(transformer.systemPrompt).not.toBe(originalPrompt);
	});

	it('should throw on empty/null prompt', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();

		await expect(transformer.updateSystemPrompt('')).rejects.toThrow(/non-empty string/);
		await expect(transformer.updateSystemPrompt(null)).rejects.toThrow(/non-empty string/);
	});
});


describe('Transformer — Stateless Send', () => {
	it('should send stateless without affecting history', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);

		const historyBefore = transformer.getHistory().length;
		const result = await transformer.send({ x: 5 }, { stateless: true });
		const historyAfter = transformer.getHistory().length;

		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
		expect(historyAfter).toBe(historyBefore);
	});

	it('should throw if chat not initialized', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await expect(
			transformer.send({ x: 1 }, { stateless: true })
		).rejects.toThrow(/not initialized/i);
	});
});


describe('Transformer — rebuild', () => {
	it('should ask model to fix a bad payload', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);

		const result = await transformer.rebuild(
			{ y: -999 },
			'Value of y must be positive and equal to x * 2'
		);
		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
	});
});


describe('Transformer — _preparePayload', () => {
	let transformer;

	beforeAll(async () => {
		transformer = new Transformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should handle null payload', async () => {
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);
		const result = await transformer.send(null);
		expect(result).toBeTruthy();
	});

	it('should handle boolean payload', async () => {
		const result = await transformer.send(true);
		expect(result).toBeTruthy();
	});

	it('should handle string payload', async () => {
		const result = await transformer.send('transform this text');
		expect(result).toBeTruthy();
	});
});


describe('Transformer — exampleData option', () => {
	it('should use exampleData from constructor when seed called with no args', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			exampleData: [
				{ PROMPT: { a: 1 }, ANSWER: { b: 2 } }
			]
		});
		await transformer.init();
		await transformer.seed();
		const history = transformer.getHistory();
		expect(history.length).toBe(2);
	});

	it('should throw on invalid exampleData type', async () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			exampleData: 'not-an-array'
		});
		await transformer.init();
		await expect(transformer.seed()).rejects.toThrow(/invalid example data/i);
	});
});


describe('Transformer — rawSend errors', () => {
	it('should throw when chat not initialized', async () => {
		const transformer = new Transformer({ ...BASE_OPTIONS });
		await expect(transformer.rawSend({ x: 1 })).rejects.toThrow(/not initialized/i);
	});
});


describe('Transformer — grounding config', () => {
	it('should set grounding config', () => {
		const transformer = new Transformer({
			...BASE_OPTIONS,
			enableGrounding: true,
			groundingConfig: { dynamicRetrievalConfig: { mode: 'MODE_DYNAMIC' } }
		});
		expect(transformer.enableGrounding).toBe(true);
	});
});


describe('Transformer — responseSchema', () => {
	it('should set responseSchema in chatConfig', () => {
		const schema = { type: 'object', properties: { name: { type: 'string' } } };
		const transformer = new Transformer({
			...BASE_OPTIONS,
			responseSchema: schema
		});
		expect(transformer.chatConfig.responseSchema).toEqual(schema);
	});
});


describe('attemptJSONRecovery', () => {
	it('should parse valid JSON', () => {
		expect(attemptJSONRecovery('{"a":1}')).toEqual({ a: 1 });
	});

	it('should recover truncated JSON', () => {
		const truncated = '{"a":1,"b":"hello';
		const result = attemptJSONRecovery(truncated);
		expect(result).toBeTruthy();
		expect(result.a).toBe(1);
	});

	it('should return null for non-JSON', () => {
		expect(attemptJSONRecovery('not json at all')).toBeNull();
	});

	it('should handle null/undefined', () => {
		expect(attemptJSONRecovery(null)).toBeNull();
		expect(attemptJSONRecovery(undefined)).toBeNull();
	});
});
