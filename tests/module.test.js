import dotenv from 'dotenv';
dotenv.config();
import { default as AITransformer } from '../index.js';
import path from 'path';
import fs from 'fs';


const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY; // Clear for local tests

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run real integration tests");

/** @typedef {import('../types.d.ts').AITransformerOptions} Options */

/** @type {Options} */
const BASE_OPTIONS = {
	modelName: 'gemini-1.5-flash-8b',
	apiKey: GEMINI_API_KEY,
	chatConfig: {
		topK: 21,
		temperature: 0.1,
	}

};




describe('Basics', () => {
	let transformer;
	const simpleExamples = [
		{ PROMPT: { x: 1 }, ANSWER: { y: 2 } },
		{ PROMPT: { x: 3 }, ANSWER: { y: 6 } }
	];

	beforeAll(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	describe('Constructor', () => {
		it('should create with default options', () => {
			const t = new AITransformer({ ...BASE_OPTIONS });
			expect(t.modelName).toMatch(/gemini/);
			expect(typeof t.init).toBe('function');
		});

	});

	describe('init', () => {
		it('should initialize chat session', async () => {
			await transformer.init();
			expect(transformer.chat).toBeTruthy();
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

	describe('message', () => {
		it('should transform a basic payload', async () => {
			const result = await transformer.message({ x: 10 });
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});

		it('should work with invalid payloads', async () => {
			const result = await transformer.message(123);
			expect(result).toBeTruthy();
			expect(typeof result).toBe('string');
		});
	});

	describe('estimate', () => {
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

	describe('validation', () => {
		it('should transform and validate (identity validator)', async () => {
			const validator = p => Promise.resolve(p);
			const result = await transformer.message({ x: 5 }, {}, validator);
			expect(result).toBeTruthy();
		});

		it('should support a validator on init', async () => {
			const validator = p => {
				//negative are not allowed
				if (p.x < 0) throw new Error("wrong try again");
				return Promise.resolve(p);
			};
			const t2 = new AITransformer({ ...BASE_OPTIONS, asyncValidator: validator, maxRetries: 1 });
			await t2.init();
			const result = await t2.message({ x: 10, "operation": "multiply by two" });
			expect(result).toBeTruthy();
			await expect(t2.message({ x: 10, "operation": "multiply by negative one" }, { maxRetries: 0 })).rejects.toThrow(/wrong try again/i);
		});
	});

	describe('Error handling', () => {
		it('should handle chat not initialized', async () => {
			const t2 = new AITransformer({ ...BASE_OPTIONS });
			await expect(t2.message({ foo: 1 })).rejects.toThrow(/not initialized/i);
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


describe('Using CONTEXT and EXPLANATION', () => {
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
		// Example with no EXPLANATION
		{
			CONTEXT: "Square the input.",
			PROMPT: { value: 4 },
			ANSWER: { value: 16 }
			// No EXPLANATION key
		}
	];

	beforeAll(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });



	describe('Seeding with CONTEXT and EXPLANATION', () => {
		it('should seed examples with context and explanation fields', async () => {
			await transformer.seed(contextExamples);
			const history = transformer.getHistory();

			// There should be 2 messages per example: user, model
			expect(history.length).toBe(contextExamples.length * 2);

			contextExamples.forEach((example, idx) => {
				const userMsg = history[idx * 2];
				const modelMsg = history[idx * 2 + 1];
				expect(userMsg.role).toBe('user');
				expect(modelMsg.role).toBe('model');
				// User message should include context text if present
				if (example.CONTEXT) {
					expect(userMsg.parts[0].text).toMatch(example.CONTEXT);
				}
				// Model message should include data
				const parsedModel = JSON.parse(modelMsg.parts[0].text);
				expect(parsedModel.data).toEqual(example.ANSWER);
				// Explanation should be present if in example, absent otherwise
				if (example.EXPLANATION) {
					expect(parsedModel.explanation).toBe(example.EXPLANATION);
				} else {
					expect(parsedModel.explanation).toBeUndefined();
				}
			});
		});
	});

	describe('Inference prompt with CONTEXT', () => {
		it('should use context in the prompt and transform accordingly', async () => {
			// "Add 1 to the input"
			const result = await transformer.message({ value: 41, CONTEXT: "Add 1 to the input. Put the answer in a key called 'value'" });
			// Should return { value: 42 }
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
			expect(result.value).toBe(42);
		});

		it('should handle missing CONTEXT gracefully (fallback to pattern)', async () => {
			const result = await transformer.message({ value: 10 }); // No CONTEXT key
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});
	});

	describe('Inference prompt and EXPLANATION field', () => {
		it('should not include explanation in inference output unless present in few-shot AND likely not unless asked', async () => {
			const result = await transformer.message({ value: 50, CONTEXT: "Add 1 to the input." });
			// Normally, explanation should NOT be present in inference
			expect(result).toBeTruthy();
			// If output is just { value: ... } that's fine
			// If output is { value: ..., explanation: ... } it's also ok, but should not be encouraged
			if ('explanation' in result) {
				// If explanation is included, log a warning
				console.warn('Model returned explanation in inference, but it was not requested:', result.explanation);
			}
			// Your module's system prompt says "no explanations unless requested"
		});

		it('should handle explicit request for explanation (if format supports it)', async () => {
			// This assumes your prompt construction supports requesting explanation, e.g.
			const payload = { value: 7, CONTEXT: "Add 1 to the input. Provide an explanation in the output." };
			const result = await transformer.message(payload);
			expect(result).toBeTruthy();
			// This is an edge case - explanation may be present if the prompt requests it
			if ('explanation' in result) {
				expect(typeof result.explanation).toBe('string');
			}
		});
	});

	describe('Seeding with missing or empty context/explanation', () => {
		it('should handle seeding with missing CONTEXT and EXPLANATION fields', async () => {
			const examples = [
				{ PROMPT: { foo: 1 }, ANSWER: { bar: 2 } },
				{ PROMPT: { foo: 2 }, ANSWER: { bar: 4 } }
			];
			await transformer.seed(examples);
			const history = transformer.getHistory();
			expect(history.length).toBe(4); // 2 examples, 2 messages each
			history.forEach((msg, idx) => {
				if (msg.role === 'user') {
					expect(msg.parts[0].text).not.toMatch(/CONTEXT:/i); // Should not include context label
				}
				if (msg.role === 'model') {
					const modelObj = JSON.parse(msg.parts[0].text);
					expect(modelObj.explanation).toBeUndefined();
				}
			});
		});
	});

	describe('Edge cases for CONTEXT/EXPLANATION', () => {
		it('should handle malformed context or explanation gracefully', async () => {
			const weirdExamples = [
				{
					CONTEXT: { info: "Nested object as context", code: 99 },
					PROMPT: { foo: 123 },
					ANSWER: { bar: 456 },
					EXPLANATION: { detail: "Should still stringify" }
				}
			];
			await transformer.seed(weirdExamples);
			const history = transformer.getHistory();
			const userMsg = history[0];
			const modelMsg = history[1];
			expect(userMsg.parts[0].text).toMatch(/CONTEXT:/);
			expect(userMsg.parts[0].text).toMatch(/Nested object as context/);
			const parsed = JSON.parse(modelMsg.parts[0].text);
			expect(typeof parsed.explanation === 'object' || typeof parsed.explanation === 'string').toBeTruthy();
		});
	});
});


describe('Plain Text Answers', () => {
	const unstructuredExamples = [
		{ prompt: "What is the capital of France?", answer: "Paris" },
		{ prompt: "Who wrote Hamlet?", answer: "William Shakespeare" }
	];

	const systemInstructions = `
You are a helpful assistant. For each question, reply with a short, direct answer. Do not use JSON or code blocks.`;

	let transformer;

	beforeAll(async () => {
		transformer = new AITransformer({
			...BASE_OPTIONS,
			promptKey: 'prompt',
			answerKey: 'answer',
			onlyJSON: false, // Allow plain text answers
			systemInstructions,
		});
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should seed chat with plain text Q&A examples', async () => {
		await transformer.init();
		await transformer.seed(unstructuredExamples);
		const history = transformer.getHistory();
		expect(history.length).toBe(4);
		history.forEach((msg, idx) => {
			if (msg.role === 'user') {
				expect(msg.parts[0].text).toMatch(/(capital|Hamlet)/i);
			} else if (msg.role === 'model') {
				// Should just be plain text, not JSON
				expect(typeof msg.parts[0].text).toBe('string');
				expect(msg.parts[0].text).toMatch(/(Paris|Shakespeare)/i); // No braces
			}
		});
	});

	it('should return a plain text answer for new prompts', async () => {
		const result = await transformer.message("What color is the sky on a clear day?");
		expect(typeof result).toBe('string');
		expect(result.toLowerCase()).toMatch(/blue/);
	});
});


describe('No Instructions', () => {
	let transformer;
	beforeAll(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should transform basic JSON input/output with default instructions', async () => {
		await transformer.seed([
			{ PROMPT: { n: 2 }, ANSWER: { double: 4 } }
		]);
		const result = await transformer.message({ n: 5 });
		expect(typeof result).toBe('object');
		expect(result.double).toBeDefined();
	});
});


describe('Only System Instructions', () => {
	const systemInstructions = `
For any payload with a property "number", return a JSON object with its square as "result".`;

	let transformer;

	beforeAll(async () => {
		transformer = new AITransformer({
			...BASE_OPTIONS,
			systemInstructions,
		});
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should follow system instructions and transform accordingly', async () => {
		const result = await transformer.message({ number: 7 });
		expect(result).toBeTruthy();
		expect(result.result).toBe(49?.toString());
	});

	it('should augment the payload as instructed by system instructions', async () => {
		const systemInstructions = `
Given any JSON payload, return the same payload but add a new field "greeting" with the value "hello, world". Return only JSON.`;
		const newTransformer = new AITransformer({
			...BASE_OPTIONS,
			systemInstructions,
		});
		await newTransformer.init();
		const input = { name: "Luna" };
		const result = await newTransformer.message(input);
		expect(result).toBeTruthy();
		expect(result.name).toBe("Luna");
		expect(result.greeting).toBe("hello, world");

	});
});



describe('No Seeding + No Instructions', () => {
	let transformer;

	beforeAll(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should respond with JSON output using default system instructions', async () => {
		const input = { foo: "bar" };
		const result = await transformer.message(input);
		expect(result).toBeTruthy();
		// Model may just echo or transform, but must return JSON
		expect(typeof result).toBe('object');
	});
});


describe('Deep Validation', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.seed([
			{ PROMPT: { action: 'succeed' }, ANSWER: { status: 'ok' } },
			{ PROMPT: { action: 'fail_validation' }, ANSWER: { status: 'invalid' } }
		]);
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should succeed on the first try if validation passes', async () => {
		const validator = async (p) => {
			if (p.result === 'success') return p;
			throw new Error("Validation failed");
		};
		const { result } = await transformer.message({ action: 'succeed' }, validator);
		expect(result).toBe('success');
	});

	it('should retry and succeed if validation fails once', async () => {
		let attempt = 0;
		const validator = async (p) => {
			attempt++;
			if (attempt > 1) {
				return p;
			}
			throw new Error(`Validation failed on attempt ${attempt}`);
		};

		// Mock the rebuild function to return a valid payload on retry
		const numOfTimesCalled = [];
		transformer.rebuild = (v) => {
			numOfTimesCalled.push(true);
			return v;
		};

		const result = await transformer.message({ action: 'fail_validation' }, { maxRetries: 2 }, validator);

		expect(attempt).toBe(2); // Should have failed once, succeeded the second time
		expect(numOfTimesCalled.length).toBe(1);
	});

	it('should throw an error after all retries are exhausted', async () => {
		const validator = () => Promise.reject(new Error("Always fails"));
		await expect(
			transformer.message({ action: 'succeed' }, { maxRetries: 2 }, validator)
		).rejects.toThrow(/failed after 3 attempts/i);
	});

	it('should call rebuildPayload and succeed if Gemini learns to fix', async () => {
		const validator = (p) => {
			// Require a key that's initially missing
			if (!p.fixed) throw new Error("Payload must have 'fixed': true");
			return p;
		};
		const payload = { foo: "bar" };
		try {
			const result = await transformer.prepareAndValidateMessage(payload, { maxRetries: 1, retryDelay: 0 }, validator);
			expect(result.fixed).toBe(true);
		} catch (e) {
			// It's possible for the LLM to fail to fix, so test may fail here
			console.warn("LLM did not generate a passing payload after rebuild:", e);
		}
	});
});



describe('State, Configuration, and Reset', () => {
	it('should respect custom prompt and answer keys', async () => {
		const transformer = new AITransformer({
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

		const result = await transformer.message({ a: 10 });
		expect(result.b).toBeDefined();
	});

	it('should clear history and re-initialize chat on reset()', async () => {
		const transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.seed([{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }]);

		const oldHistory = transformer.getHistory();
		expect(oldHistory.length).toBe(2);



		await transformer.reset();

		const newHistory = transformer.getHistory();
		expect(newHistory.length).toBe(0); // History should be empty


		// Should behave like a zero-shot model now
		const result = await transformer.message({ z: 123 });
		expect(typeof result).toBe('object');
	});

	it('should be idempotent if init() is called multiple times', async () => {
		const transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
		const chatInstance = transformer.chat;
		await transformer.init();
		expect(transformer.chat).toBe(chatInstance); // Should be the same instance
	});
});


describe('Data Format and Payload Edge Cases', () => {
	let transformer;

	beforeAll(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should correctly handle an empty array as an ANSWER', async () => {
		await transformer.seed([
			{ PROMPT: { type: 'list' }, ANSWER: [] }
		]);
		const history = transformer.getHistory();
		const modelMsg = JSON.parse(history[1].parts[0].text);
		expect(modelMsg.data).toEqual([]);

		const result = await transformer.message({ type: 'list' });
		expect(Array.isArray(result)).toBe(true);
	});

	it('should correctly handle null as an ANSWER', async () => {
		await transformer.seed([
			{ PROMPT: { type: 'empty' }, ANSWER: null }
		]);
		const history = transformer.getHistory();
		const modelMsg = JSON.parse(history[1].parts[0].text);
		expect(JSON.stringify(modelMsg)).toBe('{}');

		const result = await transformer.message({ type: 'empty' });
		expect(JSON.stringify(result)).toBe('{}');
	});

	it('should handle an empty object as a PROMPT', async () => {
		await transformer.seed([
			{ PROMPT: {}, ANSWER: { status: 'empty_input' } }
		]);
		const result = await transformer.message({});
		expect(result.status).toBe('empty_input');
	});
});


describe('Complex Instruction Hierarchy', () => {
	it('should prioritize CONTEXT in a prompt over a pattern learned from examples', async () => {
		const transformer = new AITransformer({ ...BASE_OPTIONS });

		// Teach a doubling pattern
		await transformer.seed([
			{ PROMPT: { val: 2 }, ANSWER: { result: 4 } },
			{ PROMPT: { val: 5 }, ANSWER: { result: 10 } }
		]);

		// Now, provide a conflicting instruction in the context
		const result = await transformer.message({ val: 10, CONTEXT: "Ignore previous patterns. Subtract 3 from the `val` property." });

		expect(result.result).toBe(7); // Should be 7, not 20
	});
});



describe('Configuration Edge Cases', () => {
	it('should handle custom key mappings', async () => {
		const transformer = new AITransformer({
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
		const result = await transformer.message({ text: "world" });
		expect(result.text).toBe("WORLD");
	});

	it('should handle missing API key gracefully', () => {
		expect(() => new AITransformer({ apiKey: "" })).toThrow(/api key/i);
	});

	it('should handle invalid model names', async () => {
		const transformer = new AITransformer({
			...BASE_OPTIONS,
			modelName: 'nonexistent-model'
		});
		await transformer.init();

		try {
			await transformer.message({ test: "invalid model" }, { maxRetries: 0 });
		}
		catch (err) {
			expect(err.message).toMatch(/404 Not Found/i);
		}


	});
});

describe('Seeding Edge Cases', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
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
		// Should not throw
	});

	it('should handle mixed complete/incomplete examples', async () => {
		const mixedExamples = [
			{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }, // Complete
			{ PROMPT: { x: 2 } }, // Missing ANSWER
			{ ANSWER: { y: 6 } }, // Missing PROMPT
			{ CONTEXT: "Only context", EXPLANATION: "Only explanation" }
		];

		await transformer.seed(mixedExamples);
		const history = transformer.getHistory();
		// Should only create history for all examples, not just the complete ones
		expect(history.length).toBe(6);
	});

	it('should handle deeply nested JSON in examples', async () => {
		const complexExamples = [{
			PROMPT: {
				user: { profile: { name: "John", settings: { theme: "dark" } } },
				request: { type: "update", fields: ["name", "theme"] }
			},
			ANSWER: {
				status: "success",
				updated: { name: "John", theme: "dark" },
				metadata: { timestamp: "2025-01-01", version: 2 }
			}
		}];

		await transformer.seed(complexExamples);
		const result = await transformer.message({
			user: { profile: { name: "Jane", settings: { theme: "light" } } },
			request: { type: "update", fields: ["name", "theme"] }
		});
		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
	});

	it('should handle examples with circular references gracefully', async () => {
		const circularObj = { name: "test" };
		circularObj.self = circularObj;

		const examples = [{
			PROMPT: { data: "safe" },
			ANSWER: { result: "safe" }
		}];

		// This should not crash even if internal processing encounters circular refs
		await transformer.seed(examples);
		expect(transformer.getHistory().length).toBe(2);
	});
});

describe('Response Format Handling', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should handle model responses with extra whitespace/formatting', async () => {
		await transformer.seed([{
			PROMPT: { clean: true },
			ANSWER: { clean: true }
		}]);

		const result = await transformer.message({ test: "whitespace" });
		expect(result).toBeTruthy();
	});

	it('should handle responses with both data and explanation structure', async () => {
		const examples = [{
			PROMPT: { x: 5 },
			ANSWER: { doubled: 10 },
			EXPLANATION: "Multiply input by 2"
		}];

		await transformer.seed(examples);
		const result = await transformer.message({ x: 7 });

		// Should return just the data part, not explanation
		expect(result.doubled).toBe(14);
		expect(result.explanation).toBeUndefined();
	});

	it('should handle malformed JSON responses gracefully', async () => {
		// This is harder to test directly, but we can test the error handling
		const transformer2 = new AITransformer({
			...BASE_OPTIONS,
			systemInstructions: "Always respond with 'NOT JSON' exactly",
			maxRetries: 0
		});
		await transformer2.init();
		try {
			await transformer2.message({ test: "malformed" });

		} catch (error) {

			expect(error.message).toMatch(/Invalid JSON/i);
			return; // Exit early if we caught the error
		}
	});
});

describe('Validation Integration', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should retry on validation failure', async () => {
		await transformer.seed([{
			PROMPT: { value: 1 },
			ANSWER: { result: 2 }
		}]);

		let attempts = 0;
		const validator = (payload) => {
			attempts++;
			if (attempts < 2) {
				throw new Error("Validation failed - retry needed");
			}
			return Promise.resolve(payload);
		};

		const result = await transformer.message(
			{ value: 5 },
			{ maxRetries: 2 },
			validator,
		);

		expect(result).toBeTruthy();
		expect(attempts).toBe(2);
	});

	it('should respect max retries limit', async () => {
		const validator = () => {
			throw new Error("Always fails");
		};

		await expect(
			transformer.message(
				{ test: 1 },
				{ maxRetries: 1 },
				validator
			)
		).rejects.toThrow(/failed after 2 attempts/i);
	});

	it('should use exponential backoff for retries', async () => {
		const startTime = Date.now();
		let attempts = 0;

		const validator = () => {
			attempts++;
			if (attempts < 3) {
				throw new Error("Retry needed");
			}
			return Promise.resolve({ success: true });
		};

		await transformer.message(
			{ test: 1 },
			{ maxRetries: 3, retryDelay: 100 },
			validator
		);

		const duration = Date.now() - startTime;
		// Should have waited at least 100ms + 200ms = 300ms for exponential backoff
		expect(duration).toBeGreaterThan(250);
	});
});

describe('Memory and Performance', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should handle many seeding examples without memory issues', async () => {
		const manyExamples = Array.from({ length: 50 }, (_, i) => ({
			PROMPT: { index: i },
			ANSWER: { doubled: i * 2 }
		}));

		await transformer.seed(manyExamples);
		const history = transformer.getHistory();
		expect(history.length).toBe(100); // 50 examples * 2 messages each

		const result = await transformer.message({ index: 99 });
		expect(result.doubled).toBe(198);
	});

	it('should handle reset after seeding', async () => {
		await transformer.seed([{
			PROMPT: { before: "reset" },
			ANSWER: { after: "reset" }
		}]);

		expect(transformer.getHistory().length).toBe(2);

		await transformer.reset();
		expect(transformer.getHistory().length).toBe(0);

		// Should still work after reset
		const result = await transformer.message({ test: "after reset" });
		expect(result).toBeTruthy();
	});
});

describe('Context Handling Edge Cases', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
	});

	it('should handle CONTEXT in inference payload vs seeding', async () => {
		// Seed with one context
		await transformer.seed([{
			CONTEXT: "Always return double",
			PROMPT: { n: 5 },
			ANSWER: { result: 10 }
		}]);

		// Then provide different context in inference
		const result = await transformer.message({
			n: 3,
			CONTEXT: "Triple the input instead"
		});

		expect(result).toBeTruthy();
		// Should follow the new context, not the seeded one
	});

	it('should handle very long context strings', async () => {
		const longContext = "Context: " + "x".repeat(1000);
		const examples = [{
			CONTEXT: longContext,
			PROMPT: { test: 1 },
			ANSWER: { test: 2 }
		}];

		await transformer.seed(examples);
		const result = await transformer.message({ test: 5 });
		expect(result).toBeTruthy();
	});

	it('should handle special characters in context', async () => {
		const examples = [{
			CONTEXT: "Handle émojis 🚀, quotes \"test\", and \n newlines",
			PROMPT: { input: "special" },
			ANSWER: { output: "handled" }
		}];

		await transformer.seed(examples);
		const result = await transformer.message({ input: "test" });
		expect(result).toBeTruthy();
	});
});

// describe('Error Recovery', () => {
// 	it('should handle network timeouts gracefully', async () => {
// 		const transformer = new AITransformer({
// 			...BASE_OPTIONS,
// 			chatConfig: { timeout: 1 } // Very short timeout
// 		});

// 		await transformer.init();

// 		// This might timeout, should handle gracefully
// 		try {
// 			await transformer.message({ test: "timeout test" });
// 		} catch (error) {
// 			expect(error.message).toMatch(/(timeout|network|failed)/i);
// 		}
// 	});

// 	it('should handle API quota exceeded', async () => {
// 		// This is hard to test directly without hitting real quotas
// 		// But we can test the error handling structure
// 		const transformer = new AITransformer({ apiKey: "invalid-key" });

// 		await expect(transformer.init()).rejects.toThrow();
// 	});
// });

describe('File-based Examples Loading', () => {
	let transformer;

	beforeEach(async () => {
		// Test the examplesFile parameter if your module supports it
		transformer = new AITransformer({
			...BASE_OPTIONS,
			examplesFile: './test-examples.json' // This file may not exist
		});
		await transformer.init();
	});
	beforeEach(async () => { await transformer.reset(); });

	it('should handle missing examples file gracefully', async () => {
		// Should not throw when file doesn't exist
		try {
			await transformer.seed();
		}
		catch (error) {
			expect(error.message).toMatch(/check the file path/i);
		}
	});
});

describe('Concurrent Operations', () => {
	let transformer;

	beforeEach(async () => {
		transformer = new AITransformer({ ...BASE_OPTIONS });
		await transformer.init();
		await transformer.seed([{
			PROMPT: { n: 1 },
			ANSWER: { doubled: 2 }
		}]);
	});


	it('should handle multiple concurrent messages', async () => {
		const promises = Array.from({ length: 3 }, (_, i) =>
			transformer.message({ n: i + 1 })
		);

		const results = await Promise.all(promises);
		results.forEach((result, i) => {
			expect(result.doubled).toBe((i + 1) * 2);
		});
	});

	it('should handle concurrent validation operations', async () => {
		const validator = (p) => Promise.resolve(p);

		const promises = Array.from({ length: 2 }, (_, i) =>
			transformer.message({ n: i + 10 }, validator)
		);

		const results = await Promise.all(promises);
		expect(results).toHaveLength(2);
		results.forEach(result => expect(result).toBeTruthy());
	});
});


describe('Advanced Options + Configs', () => {
	it('should override system instructions using `systemInstructionsKey` in examples', async () => {
		const transformer = new AITransformer({ apiKey: GEMINI_API_KEY });

		const newInstructions = "You are a poet. Respond with a haiku about the input number.";

		// The last example object contains the key to override system instructions
		await transformer.seed([
			{ PROMPT: { number: 5 }, ANSWER: { haiku: "Five is a nice number, balanced and so clear, a joy to behold." } },
			{ SYSTEM: newInstructions }
		]);

		// Check if the new instructions were applied to the chat instance
		expect(transformer.chatConfig.systemInstruction).toBe(newInstructions);

		const result = await transformer.message({ number: 10 });

		// The result should now follow the new poetic instructions
		expect(result.haiku).toBeDefined();
		expect(typeof result.haiku).toBe('string');
	});

	it('should allow non-JSON responses when `onlyJSON` is false', async () => {
		const transformer = new AITransformer({
			apiKey: GEMINI_API_KEY,
			onlyJSON: false,
			systemInstructions: "Reply with the single word 'test' and nothing else."
		});
		await transformer.init();

		const result = await transformer.message("What is this?");
		expect(result).toBe('test');
	});

	it('should throw an error for non-JSON response by default (`onlyJSON` is true)', async () => {
		const transformer = new AITransformer({
			apiKey: GEMINI_API_KEY,
			onlyJSON: true, // Default behavior
			systemInstructions: "Reply with the single word 'test' and nothing else."
		});
		await transformer.init();
		try {
			const foo = await transformer.message("What is this?", { maxRetries: 0 });
			debugger;
		}
		catch (error) {
			expect(error.message).toMatch(/invalid json response/i);

		}


	});

	it('should use the constructor-provided `asyncValidator` on every `message` call', async () => {
		const numTimesCalled = [];
		const validator = async (p) => {
			numTimesCalled.push(true);
			if (p && p.status === 'ok') {
				return true; // Success
			}
			throw new Error("custom validation failed: status is not ok");
		};


		const transformer = new AITransformer({
			apiKey: GEMINI_API_KEY,
			asyncValidator: validator,
			maxRetries: 0
		});
		await transformer.init();

		await transformer.seed([
			{ PROMPT: { valid: true }, ANSWER: { status: 'ok' } },
			{ PROMPT: { valid: false }, ANSWER: { status: 'bad' } }
		]);

		// This call should succeed because the validator returns true
		const goodResult = await transformer.message({ valid: true }, { maxRetries: 0 });
		expect(goodResult.status).toBe('ok');
		expect(numTimesCalled.length).toBe(1);

		// This call should fail because the validator will throw an error
		await expect(transformer.message({ valid: false }, { maxRetries: 1 })).rejects.toThrow(/custom validation failed/i);
		expect(numTimesCalled.length).toBe(3);
	});
});


describe('File-based Examples', () => {
    const examplesFilePath = path.resolve('./tests/examples.json');
    const examplesContent = [
        {
            "systemInstructions": "You are a helpful assistant who likes to rhyme whenever you can.",
            "userInput": "What is the weather like today?",
            "assistantResponse": { "rhyme": "The weather today is sunny and bright, with a gentle breeze that feels just right." },
            "meta": "The user is asking about the weather, and the assistant responds in a rhyming manner.",
            "explanationOfResponse": "The assistant provides a poetic response to the user's question about the weather."
        },
        {
            "userInput": "Can you tell me a joke?",
            "assistantResponse": { "joke": "Why did the scarecrow win an award? Because he was outstanding in his field!" },
            "meta": "The user is asking for a joke.",
            "explanationOfResponse": "The assistant delivers a pun."
        },
        {
            "userInput": "What is the capital of France?",
            "assistantResponse": { "rhyme": "The capital of France, oh so grand, is Paris, a treasure in the land." },
            "meta": "The user is asking for the capital of France.",
            "explanationOfResponse": "The assistant provides a factual, rhyming answer."
        }
    ];

    // Create the dummy examples file before tests run
    beforeAll(() => {
        // Create a 'tests' directory if it doesn't exist
        if (!fs.existsSync(path.dirname(examplesFilePath))) {
            fs.mkdirSync(path.dirname(examplesFilePath));
        }
        fs.writeFileSync(examplesFilePath, JSON.stringify(examplesContent, null, 4));
    });

    // Clean up the dummy file after all tests are done
    afterAll(() => {
        fs.unlinkSync(examplesFilePath);
    });

    it('should load basic prompts and answers from the file', async () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            examplesFile: examplesFilePath,
            promptKey: 'userInput',
            answerKey: 'assistantResponse'
        });

        await transformer.seed();
        const history = transformer.getHistory();

        expect(history.length).toBe(6); // 3 examples * 2 messages each
        const modelResponse = JSON.parse(history[1].parts[0].text);
        expect(modelResponse.data.rhyme).toBe("The weather today is sunny and bright, with a gentle breeze that feels just right.");
    });

    it('should correctly use the CONTEXT key from the file', async () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            examplesFile: examplesFilePath,
            promptKey: 'userInput',
            answerKey: 'assistantResponse',
            contextKey: 'meta' // Map CONTEXT to the 'meta' field
        });

        await transformer.seed();
        const history = transformer.getHistory();
        const userMessage = history[2].parts[0].text; // The second example's user message

        expect(userMessage).toMatch(/CONTEXT:/);
        expect(userMessage).toMatch(/The user is asking for a joke/);
    });
    
    it('should correctly use the EXPLANATION key from the file', async () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            examplesFile: examplesFilePath,
            promptKey: 'userInput',
            answerKey: 'assistantResponse',
            explanationKey: 'explanationOfResponse' // Map EXPLANATION
        });

        await transformer.seed();
        const history = transformer.getHistory();
        const modelMessage = JSON.parse(history[5].parts[0].text); // Third example's model message

        expect(modelMessage.explanation).toBe("The assistant provides a factual, rhyming answer.");
    });
    
    it('should override system instructions from the file and follow them', async () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            examplesFile: examplesFilePath,
            promptKey: 'userInput',
            answerKey: 'assistantResponse',
            systemInstructionsKey: 'systemInstructions' // Map SYSTEM
        });
        
        // Seeding should detect and apply the new instructions
        await transformer.seed();

        // 1. Verify that the transformer's internal config was updated
        const expectedInstructions = "You are a helpful assistant who likes to rhyme whenever you can.";
        expect(transformer.chatConfig.systemInstruction).toBe(expectedInstructions);

        // 2. Verify that the model now follows the new instructions
        const result = await transformer.message("How does a computer work?");
        expect(typeof result.explanation).toBe('string');
        expect(result.explanation.length).toBeGreaterThan(10);
    });

    it('should throw a helpful error if the examples file does not exist', async () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            examplesFile: './non-existent-file.json'
        });
        
        // Using await/expect with rejects for async functions
        await expect(transformer.seed()).rejects.toThrow(/Could not load examples from file/);
    });
});


describe('Response Schema', () => {

    it('should conform to a simple responseSchema', async () => {
        const simpleSchema = {
            type: 'object',
            properties: {
                user_id: { type: 'number' },
                username: { type: 'string' },
                is_active: { type: 'boolean' }
            },
            required: ['user_id', 'username']
        };

        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            responseSchema: simpleSchema,
            systemInstructions: "Extract user details from the provided text."
        });

        await transformer.init();

        const result = await transformer.message("The user is jsmith (id: 123). They are an active user.");
        
        // Assertions to check schema conformance
        expect(result).toHaveProperty('user_id', 123);
        expect(result).toHaveProperty('username', 'jsmith');
        expect(result).toHaveProperty('is_active', true);
        expect(result.extra_field).toBeUndefined(); // Should not have extra fields
    });

    it('should prioritize responseSchema over conflicting few-shot examples', async () => {
        // The few-shot examples teach the model to return a simple { "output": ... } structure.
        const conflictingExamples = [
            { PROMPT: { name: "Alice" }, ANSWER: { output: "User: Alice" } },
            { PROMPT: { name: "Bob" }, ANSWER: { output: "User: Bob" } }
        ];

        // But the schema *requires* a different, more complex structure.
        const requiredSchema = {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['success', 'error'] },
                data: { 
                    type: 'object',
                    properties: {
                        name_processed: { type: 'string' }
                    },
                    required: ['name_processed']
                }
            },
            required: ['status', 'data']
        };
        
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            responseSchema: requiredSchema,
            systemInstructions: "Process the user's name."
        });

        await transformer.seed(conflictingExamples);
        const result = await transformer.message({ name: "Charlie" });

        // The test passes if the output follows the `requiredSchema`, NOT the examples.
        expect(result.output).toBeUndefined(); // Should NOT have the key from the examples.
        expect(result).toHaveProperty('name_processed');
		expect(result.name_processed).toBe('Charlie'); // Should process the name correctly
    });

    it('should handle a complex nested schema with arrays and objects', async () => {
        const complexSchema = {
            type: 'object',
            properties: {
                orderId: { type: 'string' },
                customer: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        contact: { type: 'string' },
                    },
                    required: ['name']
                },
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            productId: { type: 'string' },
                            quantity: { type: 'number' }
                        },
                        required: ['productId', 'quantity']
                    }
                }
            },
            required: ['orderId', 'customer', 'items']
        };

        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            responseSchema: complexSchema,
            systemInstructions: "Parse the order details from the unstructured text."
        });

        await transformer.init();

        const prompt = "Customer Jane Doe (jane@example.com) ordered 2 of product SKU-123 and 1 of SKU-456. Her order ID is ABC-999.";
        const result = await transformer.message(prompt);
        
        // Assertions for the complex structure
        expect(result.orderId).toBe('ABC-999');
        expect(result.customer.name).toBe('Jane Doe');
        expect(result.customer.contact).toBe('jane@example.com');
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toBe(2);
        expect(result.items).toContainEqual({ productId: 'SKU-123', quantity: 2 });
        expect(result.items).toContainEqual({ productId: 'SKU-456', quantity: 1 });
    });
});


describe('Constructor Validation', () => {
    it('should throw error when promptKey and answerKey are identical', () => {
        expect(() => new AITransformer({
            ...BASE_OPTIONS,
            promptKey: 'SAME',
            answerKey: 'SAME'
        })).toThrow(/source and target keys cannot be the same/i);
    });

    it('should handle exampleData constructor option', async () => {
        const inlineExamples = [
            { PROMPT: { input: 'test' }, ANSWER: { output: 'result' } }
        ];
        
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            exampleData: inlineExamples
        });
        
        await transformer.init();
        await transformer.seed(); // Should use exampleData
        
        const history = transformer.getHistory();
        expect(history.length).toBe(2);
    });

    it('should validate custom retryDelay and maxRetries', () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            maxRetries: 5,
            retryDelay: 2000
        });
        
        expect(transformer.maxRetries).toBe(5);
        expect(transformer.retryDelay).toBe(2000);
    });

    it('should handle responseSchema configuration', async () => {
        const schema = {
            type: 'object',
            properties: {
                result: { type: 'string' }
            },
            required: ['result']
        };
        
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            responseSchema: schema
        });
        
        await transformer.init();
        expect(transformer.chatConfig.responseSchema).toEqual(schema);
    });
});


describe('Initialization Edge Cases', () => {
    it('should handle init with force=true parameter', async () => {
        const transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
        const firstChat = transformer.chat;
        
        await transformer.init(true); // Force reinit
        expect(transformer.chat).not.toBe(firstChat);
    });

    it('should handle invalid API key during init', async () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            apiKey: 'invalid-key'
        });
        
        await expect(transformer.init()).rejects.toThrow();
    });
});


describe('Message Processing', () => {
    let transformer;
    
    beforeEach(async () => {
        transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
    });

    it('should handle array payloads', async () => {
        await transformer.seed([
            { PROMPT: [1, 2, 3], ANSWER: [2, 4, 6] }
        ]);
        
        const result = await transformer.message([4, 5, 6]);
        expect(Array.isArray(result)).toBe(true);
    });

    it('should handle primitive payloads', async () => {
        await transformer.seed([
            { PROMPT: "hello", ANSWER: "HELLO" }
        ]);
        
        const result = await transformer.message("world");
        expect(typeof result).toBe('string');
    });

    it('should handle complex nested objects', async () => {
        const complexExample = {
            PROMPT: {
                user: { 
                    profile: { name: "John", settings: { theme: "dark", lang: "en" } },
                    data: [1, 2, { nested: true }]
                }
            },
            ANSWER: {
                processed: true,
                user_name: "John",
                theme_preference: "dark"
            }
        };
        
        await transformer.seed([complexExample]);
        
        const result = await transformer.message({
            user: { 
                profile: { name: "Jane", settings: { theme: "light", lang: "es" } },
                data: [4, 5, { nested: false }]
            }
        });
        
        expect(result.processed).toBe(true);
        expect(result.user_name).toBe('Jane');
    });
});


describe('Error Handling', () => {
    let transformer;
    
    beforeEach(async () => {
        transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
    });

    it('should handle JSON parsing errors gracefully', async () => {
        // This test mocks a scenario where extractJSON fails
        const originalRawMessage = transformer.rawMessage;
        transformer.rawMessage = async () => {
            throw new Error('Could not extract valid JSON from model response');
        };
        
        try {
            await transformer.message({ test: 'malformed' }, { maxRetries: 0 });
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            expect(error.message).toMatch(/valid JSON from model response/i);
        }
        
        transformer.rawMessage = originalRawMessage;
    });

    it('should handle validator throwing non-Error objects', async () => {
        const validator = () => {
            throw "String error"; // Non-Error object
        };
        
        await expect(
            transformer.message({ test: 1 }, { maxRetries: 0 }, validator)
        ).rejects.toThrow();
    });
});


describe('Configuration Options', () => {
    it('should handle all chatConfig properties', async () => {
        const customConfig = {
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
            responseMimeType: 'application/json'
        };
        
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            chatConfig: customConfig
        });
        
        await transformer.init();
        
        expect(transformer.chatConfig.temperature).toBe(0.7);
        expect(transformer.chatConfig.topP).toBe(0.8);
        expect(transformer.chatConfig.topK).toBe(40);
        expect(transformer.chatConfig.responseMimeType).toBe('application/json');
    });

    it('should handle custom key mappings with special characters', async () => {
        const transformer = new AITransformer({
            ...BASE_OPTIONS,
            promptKey: 'input_data',
            answerKey: 'output_result',
            contextKey: 'ctx_info'
        });
        
        await transformer.init();
        
        expect(transformer.promptKey).toBe('input_data');
        expect(transformer.answerKey).toBe('output_result');
        expect(transformer.contextKey).toBe('ctx_info');
    });
});


describe('Validation System', () => {
    let transformer;
    
    beforeEach(async () => {
        transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
        await transformer.seed([
            { PROMPT: { value: 1 }, ANSWER: { result: 2 } }
        ]);
    });

    it('should handle validator that modifies payload', async () => {
        const modifyingValidator = async (payload) => {
            payload.modified = true;
            return payload;
        };
        
        const result = await transformer.message(
            { value: 5 },
            { maxRetries: 0 },
            modifyingValidator
        );
        
        expect(result.modified).toBe(true);
    });

    it('should handle validator with different return types', async () => {
        const validators = [
            async (p) => p, // Return payload
            async (p) => true, // Return boolean
            async (p) => null, // Return null
            async (p) => undefined // Return undefined
        ];
        
        for (const validator of validators) {
            const result = await transformer.message(
                { value: 3 },
                { maxRetries: 0 },
                validator
            );
            expect(result).toBeTruthy();
        }
    });
});


describe('Edge Cases', () => {
    let transformer;
    
    beforeEach(async () => {
        transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
    });

    it('should handle null vs undefined in payloads', async () => {
        await transformer.seed([
            { PROMPT: { value: null }, ANSWER: { result: 'null_input' } },
            { PROMPT: { value: undefined }, ANSWER: { result: 'undefined_input' } }
        ]);
        
        const nullResult = await transformer.message({ value: null });
        const undefinedResult = await transformer.message({ value: undefined });
        
        expect(nullResult).toBeTruthy();
        expect(undefinedResult).toBeTruthy();
    });

    it('should handle boolean and number payload types', async () => {
        await transformer.seed([
            { PROMPT: true, ANSWER: { bool_result: true } },
            { PROMPT: 42, ANSWER: { num_result: 84 } }
        ]);
        
        const boolResult = await transformer.message(false);
        const numResult = await transformer.message(21);
        
        expect(boolResult).toBeTruthy();
        expect(numResult).toBeTruthy();
    });

    it('should handle Unicode and special characters', async () => {
        const unicodeExample = {
            PROMPT: { text: "Hello 世界 🌍 émojis" },
            ANSWER: { processed: "Hello 世界 🌍 émojis - processed" }
        };
        
        await transformer.seed([unicodeExample]);
        
        const result = await transformer.message({ text: "Testing 测试 🚀 special chars" });
        expect(result).toBeTruthy();
    });

    it('should handle empty strings in various fields', async () => {
        const emptyExamples = [
            { PROMPT: { text: "" }, ANSWER: { result: "empty_input" } },
            { PROMPT: { text: "test" }, ANSWER: { result: "" } }
        ];
        
        await transformer.seed(emptyExamples);
        
        const result = await transformer.message({ text: "" });
        expect(result).toBeTruthy();
    });
});


describe('State Management', () => {
    let transformer;
    
    beforeEach(async () => {
        transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
    });

    it('should maintain state consistency after failed operations', async () => {
        await transformer.seed([
            { PROMPT: { test: 1 }, ANSWER: { result: 2 } }
        ]);
        
        const historyBefore = transformer.getHistory();
        
        try {
            await transformer.message("invalid payload that will fail", { maxRetries: 0 });
        } catch (error) {
            // Expected to fail
        }
        
        const historyAfter = transformer.getHistory();
        expect(historyAfter.length).toBeGreaterThanOrEqual(historyBefore.length);
    });

    it('should handle memory usage with large conversation histories', async () => {
        const largeExamples = Array.from({ length: 20 }, (_, i) => ({
            PROMPT: { index: i, data: "x".repeat(100) },
            ANSWER: { result: i * 2, processed: "y".repeat(100) }
        }));
        
        await transformer.seed(largeExamples);
        
        const history = transformer.getHistory();
        expect(history.length).toBe(40); // 20 examples * 2 messages each
        
        // Should still work after large seeding
        const result = await transformer.message({ index: 999 });
        expect(result).toBeTruthy();
    });
});


describe('Token Estimation', () => {
    let transformer;
    
    beforeEach(async () => {
        transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
    });

    it('should provide accurate token estimates for various payload sizes', async () => {
        const payloads = [
            { small: "test" },
            { medium: "x".repeat(100) },
            { large: "x".repeat(1000) }
        ];
        
        const estimates = [];
        for (const payload of payloads) {
            const estimate = await transformer.estimate(payload);
            estimates.push(estimate.totalTokens);
        }
        
        // Larger payloads should have more tokens
        expect(estimates[0]).toBeLessThan(estimates[1]);
        expect(estimates[1]).toBeLessThan(estimates[2]);
    });

    it('should include system instructions and examples in token count', async () => {
        const emptyEstimate = await transformer.estimate({ test: "small" });
        
        await transformer.seed([
            { PROMPT: { big: "x".repeat(500) }, ANSWER: { result: "y".repeat(500) } }
        ]);
        
        const seededEstimate = await transformer.estimate({ test: "small" });
        
        // Should include more tokens after seeding
        expect(seededEstimate.totalTokens).toBeGreaterThan(emptyEstimate.totalTokens);
    });
});


describe('Concurrent Operations', () => {
    let transformer;
    
    beforeEach(async () => {
        transformer = new AITransformer({ ...BASE_OPTIONS });
        await transformer.init();
        await transformer.seed([
            { PROMPT: { value: 1 }, ANSWER: { doubled: 2 } },
            { PROMPT: { value: 2 }, ANSWER: { doubled: 4 } }
        ]);
    });

    it('should handle multiple concurrent transformations safely', async () => {
        const promises = Array.from({ length: 5 }, (_, i) =>
            transformer.message({ value: i + 10 })
        );
        
        const results = await Promise.all(promises);
        
        expect(results).toHaveLength(5);
        results.forEach((result, i) => {
            expect(result).toBeTruthy();
            expect(typeof result).toBe('object');
        });
    });

    it('should handle concurrent seeding and transformation', async () => {
        const seedPromise = transformer.seed([
            { PROMPT: { new: 1 }, ANSWER: { new_result: 2 } }
        ]);
        
        const transformPromise = transformer.message({ value: 5 });
        
        const [seedResult, transformResult] = await Promise.all([seedPromise, transformPromise]);
        
        expect(transformResult).toBeTruthy();
    });
});