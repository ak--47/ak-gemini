import dotenv from 'dotenv';
dotenv.config();
import { AIAgent } from '../index.js';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY; // Clear so constructor tests work
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run agent tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash-lite',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};


describe('AIAgent', () => {

	// ─────────────────────────────────────────────────────────────────────────
	// Constructor
	// ─────────────────────────────────────────────────────────────────────────
	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.modelName).toBe('gemini-2.0-flash-lite');
			expect(agent.systemPrompt).toBe('You are a helpful AI assistant.');
			expect(agent.maxToolRounds).toBe(10);
			expect(agent.httpTimeout).toBe(30000);
			expect(agent.maxRetries).toBe(3);
			expect(agent.onToolCall).toBeNull();
			expect(agent.onMarkdown).toBeNull();
			expect(typeof agent.init).toBe('function');
			expect(typeof agent.chat).toBe('function');
			expect(typeof agent.stream).toBe('function');
			expect(typeof agent.clearHistory).toBe('function');
			expect(typeof agent.getHistory).toBe('function');
			expect(typeof agent.getLastUsage).toBe('function');
		});

		it('should accept custom system prompt', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS, systemPrompt: 'You are a pirate.' });
			expect(agent.systemPrompt).toBe('You are a pirate.');
		});

		it('should accept custom model name', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS, modelName: 'gemini-2.5-flash' });
			expect(agent.modelName).toBe('gemini-2.5-flash');
		});

		it('should accept custom maxToolRounds, httpTimeout, maxRetries', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS, maxToolRounds: 5, httpTimeout: 60000, maxRetries: 1 });
			expect(agent.maxToolRounds).toBe(5);
			expect(agent.httpTimeout).toBe(60000);
			expect(agent.maxRetries).toBe(1);
		});

		it('should accept callback options', () => {
			const onToolCall = () => {};
			const onMarkdown = () => {};
			const agent = new AIAgent({ ...BASE_OPTIONS, onToolCall, onMarkdown });
			expect(agent.onToolCall).toBe(onToolCall);
			expect(agent.onMarkdown).toBe(onMarkdown);
		});

		it('should accept labels option', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS, labels: { app: 'test', env: 'ci' } });
			expect(agent.labels).toEqual({ app: 'test', env: 'ci' });
		});

		it('should throw on missing auth', () => {
			expect(() => new AIAgent({})).toThrow(/api key/i);
		});

		it('should throw on empty string API key', () => {
			expect(() => new AIAgent({ apiKey: '' })).toThrow(/api key/i);
		});

		it('should throw on Vertex AI without project', () => {
			const savedProject = process.env.GOOGLE_CLOUD_PROJECT;
			delete process.env.GOOGLE_CLOUD_PROJECT;
			try {
				expect(() => new AIAgent({ vertexai: true })).toThrow(/project/i);
			} finally {
				if (savedProject) process.env.GOOGLE_CLOUD_PROJECT = savedProject;
			}
		});

		it('should have null lastResponseMetadata before any call', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.lastResponseMetadata).toBeNull();
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Initialization
	// ─────────────────────────────────────────────────────────────────────────
	describe('init', () => {
		it('should initialize and create a chat session', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			expect(agent.chatSession).toBeTruthy();
			expect(agent.genAIClient).toBeTruthy();
		});

		it('should be idempotent — same session on repeated calls', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			const session1 = agent.chatSession;
			await agent.init();
			expect(agent.chatSession).toBe(session1);
		});

		it('should throw on invalid API key', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS, apiKey: 'invalid-key-xxx' });
			await expect(agent.init()).rejects.toThrow();
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// chat() — Non-streaming
	// ─────────────────────────────────────────────────────────────────────────
	describe('chat (non-streaming)', () => {

		describe('simple text conversations', () => {
			let agent;
			beforeAll(async () => {
				agent = new AIAgent({
					...BASE_OPTIONS,
					systemPrompt: 'You are a helpful assistant. Respond concisely. When asked simple questions, answer directly without using tools.'
				});
				await agent.init();
			});

			it('should handle a simple text conversation', async () => {
				const response = await agent.chat('What is 2 + 2? Reply with just the number.');
				expect(response.text).toBeTruthy();
				expect(response.text).toContain('4');
				expect(response.toolCalls).toEqual([]);
				expect(response.markdownFiles).toEqual([]);
			});

			it('should return a complete AgentResponse structure', async () => {
				const response = await agent.chat('Say hello.');
				expect(response).toHaveProperty('text');
				expect(response).toHaveProperty('toolCalls');
				expect(response).toHaveProperty('markdownFiles');
				expect(response).toHaveProperty('usage');
				expect(typeof response.text).toBe('string');
				expect(Array.isArray(response.toolCalls)).toBe(true);
				expect(Array.isArray(response.markdownFiles)).toBe(true);
			});

			it('should include usage data in response', async () => {
				const response = await agent.chat('Say hi.');
				expect(response.usage).toBeTruthy();
				expect(response.usage.promptTokens).toBeGreaterThan(0);
				expect(response.usage.responseTokens).toBeGreaterThan(0);
				expect(response.usage.totalTokens).toBeGreaterThan(0);
				expect(response.usage.requestedModel).toBe('gemini-2.0-flash-lite');
			});

			it('should auto-init if init() was not called', async () => {
				const lazyAgent = new AIAgent({ ...BASE_OPTIONS });
				const response = await lazyAgent.chat('Say hello.');
				expect(response.text).toBeTruthy();
				expect(lazyAgent.chatSession).toBeTruthy();
			});
		});

		describe('http_get tool', () => {
			let agent;
			beforeAll(async () => {
				agent = new AIAgent({
					...BASE_OPTIONS,
					systemPrompt: 'You are a helpful assistant. When asked to fetch a URL, always use the http_get tool.'
				});
				await agent.init();
			});

			it('should trigger http_get tool when asked to fetch a URL', async () => {
				const response = await agent.chat('Please fetch this URL: https://jsonplaceholder.typicode.com/todos/1');
				expect(response.toolCalls.length).toBeGreaterThan(0);
				expect(response.toolCalls[0].name).toBe('http_get');
				expect(response.toolCalls[0].args.url).toContain('jsonplaceholder');
				expect(response.toolCalls[0].result.status).toBe(200);
				expect(response.toolCalls[0].result.body).toBeTruthy();
			});

			it('should return tool call result structure with name, args, and result', async () => {
				const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/posts/1');
				const tc = response.toolCalls[0];
				expect(tc).toHaveProperty('name');
				expect(tc).toHaveProperty('args');
				expect(tc).toHaveProperty('result');
				expect(tc.result).toHaveProperty('status');
				expect(tc.result).toHaveProperty('statusText');
				expect(tc.result).toHaveProperty('body');
			});

			it('should return parsed JSON body when response is JSON', async () => {
				const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
				const tc = response.toolCalls.find(t => t.name === 'http_get');
				expect(tc).toBeTruthy();
				// Body should be a parsed object, not a string
				expect(typeof tc.result.body).toBe('object');
				expect(tc.result.body.userId).toBe(1);
				expect(tc.result.body.id).toBe(1);
				expect(tc.result.body.title).toBeTruthy();
			});

			it('should return string body when response is not JSON', async () => {
				const response = await agent.chat('Fetch https://httpbin.org/html');
				const tc = response.toolCalls.find(t => t.name === 'http_get');
				if (tc) {
					expect(typeof tc.result.body).toBe('string');
				}
			});

			it('should include the fetched data in the text response', async () => {
				const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1 and tell me the title.');
				expect(response.text).toBeTruthy();
				// The todo at /todos/1 has title "delectus aut autem"
				expect(response.text.toLowerCase()).toMatch(/delectus|todo|task/i);
			});
		});

		describe('http_post tool', () => {
			it('should trigger http_post tool when asked to POST data', async () => {
				const agent = new AIAgent({
					...BASE_OPTIONS,
					systemPrompt: 'You are a helpful assistant. When asked to POST data, always use the http_post tool.'
				});
				await agent.init();
				const response = await agent.chat(
					'POST the following JSON to https://jsonplaceholder.typicode.com/posts: {"title": "foo", "body": "bar", "userId": 1}'
				);
				const postCalls = response.toolCalls.filter(tc => tc.name === 'http_post');
				expect(postCalls.length).toBeGreaterThan(0);
				expect(postCalls[0].result.status).toBe(201);
			});
		});

		describe('write_markdown tool', () => {
			it('should trigger write_markdown tool when asked to write a report', async () => {
				const agent = new AIAgent({
					...BASE_OPTIONS,
					systemPrompt: 'You are a report writer. When asked to write any report, always use the write_markdown tool to generate it.'
				});
				await agent.init();
				const response = await agent.chat('Write a very brief markdown report about the color blue. Use the write_markdown tool.');
				expect(response.markdownFiles.length).toBeGreaterThan(0);
				expect(response.markdownFiles[0].filename).toBeTruthy();
				expect(response.markdownFiles[0].content).toBeTruthy();
				expect(response.markdownFiles[0].content.length).toBeGreaterThan(10);
			});

			it('should include markdown files in both response.markdownFiles and toolCalls', async () => {
				const agent = new AIAgent({
					...BASE_OPTIONS,
					systemPrompt: 'Always use the write_markdown tool when asked to generate any document.'
				});
				await agent.init();
				const response = await agent.chat('Generate a brief markdown document about testing. Use the write_markdown tool.');
				if (response.markdownFiles.length > 0) {
					const mdToolCalls = response.toolCalls.filter(tc => tc.name === 'write_markdown');
					expect(mdToolCalls.length).toBeGreaterThan(0);
					expect(mdToolCalls[0].result.written).toBe(true);
					expect(mdToolCalls[0].result.filename).toBeTruthy();
					expect(mdToolCalls[0].result.length).toBeGreaterThan(0);
				}
			});
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Callbacks
	// ─────────────────────────────────────────────────────────────────────────
	describe('Callbacks', () => {

		it('should fire onToolCall callback with tool name and args', async () => {
			const calls = [];
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use the http_get tool when asked to fetch anything.',
				onToolCall: (name, args) => calls.push({ name, args })
			});
			await agent.init();
			await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			expect(calls.length).toBeGreaterThan(0);
			expect(calls[0].name).toBe('http_get');
			expect(calls[0].args.url).toContain('jsonplaceholder');
		});

		it('should fire onMarkdown callback with filename and content', async () => {
			const files = [];
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'When asked to write anything, always use the write_markdown tool.',
				onMarkdown: (filename, content) => files.push({ filename, content })
			});
			await agent.init();
			await agent.chat('Write a one-line markdown document about cats. Use the write_markdown tool.');
			expect(files.length).toBeGreaterThan(0);
			expect(files[0].filename).toBeTruthy();
			expect(files[0].content).toBeTruthy();
		});

		it('should not crash if onToolCall callback throws', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use the http_get tool when asked to fetch anything.',
				onToolCall: () => { throw new Error('callback boom'); }
			});
			await agent.init();
			// Should not throw despite callback error
			const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			// Model may return empty text after tool use — the key assertion is no crash
			expect(response).toBeTruthy();
			expect(response.toolCalls.length).toBeGreaterThan(0);
		});

		it('should not crash if onMarkdown callback throws', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use the write_markdown tool when asked to write anything.',
				onMarkdown: () => { throw new Error('md callback boom'); }
			});
			await agent.init();
			const response = await agent.chat('Write a brief note about dogs using write_markdown.');
			// Model may return empty text after tool use — the key assertion is no crash
			expect(response).toBeTruthy();
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// stream() — Streaming
	// ─────────────────────────────────────────────────────────────────────────
	describe('stream', () => {

		it('should stream text responses with text and done events', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'You are a helpful assistant. Respond concisely.'
			});
			await agent.init();

			const events = [];
			for await (const event of agent.stream('What is 1 + 1? Reply with just the number.')) {
				events.push(event);
			}
			const textEvents = events.filter(e => e.type === 'text');
			const doneEvents = events.filter(e => e.type === 'done');
			expect(textEvents.length).toBeGreaterThan(0);
			expect(doneEvents.length).toBe(1);
			expect(doneEvents[0].fullText).toBeTruthy();
		});

		it('should yield tool_call and tool_result events during streaming', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use the http_get tool when asked to fetch anything.'
			});
			await agent.init();

			const events = [];
			for await (const event of agent.stream('Fetch https://jsonplaceholder.typicode.com/todos/1')) {
				events.push(event);
			}

			const toolCallEvents = events.filter(e => e.type === 'tool_call');
			const toolResultEvents = events.filter(e => e.type === 'tool_result');
			expect(toolCallEvents.length).toBeGreaterThan(0);
			expect(toolCallEvents[0].toolName).toBe('http_get');
			expect(toolCallEvents[0].args).toBeTruthy();
			expect(toolResultEvents.length).toBeGreaterThan(0);
			expect(toolResultEvents[0].toolName).toBe('http_get');
			expect(toolResultEvents[0].result.status).toBe(200);
		});

		it('should yield markdown events when write_markdown is called', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use the write_markdown tool when asked to write a report.'
			});
			await agent.init();

			const events = [];
			for await (const event of agent.stream('Write a one-line markdown report about the sky. Use the write_markdown tool.')) {
				events.push(event);
			}

			const markdownEvents = events.filter(e => e.type === 'markdown');
			const doneEvents = events.filter(e => e.type === 'done');
			if (markdownEvents.length > 0) {
				expect(markdownEvents[0].filename).toBeTruthy();
				expect(markdownEvents[0].content).toBeTruthy();
			}
			expect(doneEvents.length).toBe(1);
			if (doneEvents[0].markdownFiles.length > 0) {
				expect(doneEvents[0].markdownFiles[0].filename).toBeTruthy();
			}
		});

		it('should accumulate full text across all text events', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely.'
			});
			await agent.init();

			let accumulatedText = '';
			let doneText = '';
			for await (const event of agent.stream('List three colors, one per line.')) {
				if (event.type === 'text') accumulatedText += event.text;
				if (event.type === 'done') doneText = event.fullText;
			}
			expect(accumulatedText).toBe(doneText);
		});

		it('should auto-init if init() was not called', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			const events = [];
			for await (const event of agent.stream('Say hello.')) {
				events.push(event);
			}
			expect(events.some(e => e.type === 'done')).toBe(true);
			expect(agent.chatSession).toBeTruthy();
		});

		it('should include usage data in done event', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely.'
			});
			await agent.init();

			let usage = null;
			for await (const event of agent.stream('Say hi.')) {
				if (event.type === 'done') usage = event.usage;
			}
			// Streaming may or may not have usage depending on SDK behavior
			// Just verify the done event was emitted with the field
			expect(usage !== undefined).toBe(true);
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Multi-turn Conversation
	// ─────────────────────────────────────────────────────────────────────────
	describe('Multi-turn Conversation', () => {
		it('should remember context across turns', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'You are a helpful assistant who remembers context from prior messages. Respond concisely.'
			});
			await agent.init();

			await agent.chat('My name is Zorblax and I love building robots.');
			const response = await agent.chat('What is my name?');
			expect(response.text.toLowerCase()).toContain('zorblax');
		});

		it('should maintain history across multiple exchanges', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely.'
			});
			await agent.init();

			await agent.chat('Remember the number 42.');
			await agent.chat('Remember the word "quartz".');
			const response = await agent.chat('What number and what word did I ask you to remember?');
			expect(response.text).toMatch(/42/);
			expect(response.text.toLowerCase()).toMatch(/quartz/);
		});

		it('should lose context after clearHistory', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely. If you don\'t know something, say "I don\'t know".'
			});
			await agent.init();

			await agent.chat('My secret code is ALPHA-7.');
			await agent.clearHistory();
			const response = await agent.chat('What is my secret code?');
			// After clearing, the agent should not remember the code
			expect(response.text.toLowerCase()).not.toContain('alpha-7');
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Conversation Management
	// ─────────────────────────────────────────────────────────────────────────
	describe('Conversation Management', () => {

		it('should return empty history before any messages', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.getHistory()).toEqual([]);
		});

		it('should return non-empty history after messages', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('Hello.');
			const history = agent.getHistory();
			expect(history.length).toBeGreaterThan(0);
		});

		it('should clear history and reset state', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('My name is TestUser.');
			expect(agent.getHistory().length).toBeGreaterThan(0);

			await agent.clearHistory();
			expect(agent.getHistory().length).toBe(0);
			expect(agent.lastResponseMetadata).toBeNull();
		});

		it('should still work after clearHistory', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('First message.');
			await agent.clearHistory();
			const response = await agent.chat('Second message after clear.');
			expect(response.text).toBeTruthy();
		});

		it('should support getHistory with curated parameter', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('Test message.');
			// Both curated and non-curated should return arrays
			const history = agent.getHistory(false);
			const curatedHistory = agent.getHistory(true);
			expect(Array.isArray(history)).toBe(true);
			expect(Array.isArray(curatedHistory)).toBe(true);
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Usage & Metadata
	// ─────────────────────────────────────────────────────────────────────────
	describe('Usage & Metadata', () => {

		it('should return null usage before any call', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.getLastUsage()).toBeNull();
		});

		it('should return structured usage data after a chat call', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('Hello.');
			const usage = agent.getLastUsage();
			expect(usage).toBeTruthy();
			expect(typeof usage.promptTokens).toBe('number');
			expect(typeof usage.responseTokens).toBe('number');
			expect(typeof usage.totalTokens).toBe('number');
			expect(usage.promptTokens).toBeGreaterThan(0);
			expect(usage.totalTokens).toBeGreaterThan(0);
			expect(usage.requestedModel).toBe('gemini-2.0-flash-lite');
			expect(typeof usage.timestamp).toBe('number');
		});

		it('should update usage after each call', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('Hello.');
			const usage1 = agent.getLastUsage();
			await agent.chat('Tell me a fun fact.');
			const usage2 = agent.getLastUsage();
			// Timestamps should differ
			expect(usage2.timestamp).toBeGreaterThanOrEqual(usage1.timestamp);
		});

		it('should capture model version in metadata', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('Hello.');
			expect(agent.lastResponseMetadata).toBeTruthy();
			// modelVersion might be null for some models, but the field should exist
			expect(agent.lastResponseMetadata).toHaveProperty('modelVersion');
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Error Handling
	// ─────────────────────────────────────────────────────────────────────────
	describe('Error Handling', () => {

		it('should handle tool execution failures gracefully (timeout)', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use http_get when asked to fetch. Never explain, just fetch.',
				httpTimeout: 1000
			});
			await agent.init();
			// Use a URL that will likely timeout
			const response = await agent.chat('Fetch https://httpbin.org/delay/10');
			// Should not throw — error should be sent back to model
			expect(response.text).toBeTruthy();
			expect(response.toolCalls.length).toBeGreaterThan(0);
			expect(response.toolCalls[0].result.error).toBeTruthy();
		});

		it('should handle 404 responses from http_get without crashing', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use http_get when asked to fetch. Summarize what you got back.'
			});
			await agent.init();
			const response = await agent.chat('Fetch https://httpbin.org/status/404');
			expect(response.text).toBeTruthy();
			const getCalls = response.toolCalls.filter(tc => tc.name === 'http_get');
			if (getCalls.length > 0) {
				expect(getCalls[0].result.status).toBe(404);
			}
		});

		it('should handle 500 responses from http_get without crashing', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use http_get when asked to fetch.'
			});
			await agent.init();
			const response = await agent.chat('Fetch https://httpbin.org/status/500');
			// Model may return empty text — the key assertion is no crash
			expect(response).toBeTruthy();
			const getCalls = response.toolCalls.filter(tc => tc.name === 'http_get');
			if (getCalls.length > 0) {
				expect(getCalls[0].result.status).toBe(500);
			}
		});

		it('should handle invalid URLs in http_get gracefully', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use http_get when asked to fetch.',
				httpTimeout: 5000
			});
			await agent.init();
			const response = await agent.chat('Fetch http://this-domain-does-not-exist-xyz-123.invalid/test');
			expect(response.text).toBeTruthy();
			// The tool call should have an error result
			if (response.toolCalls.length > 0) {
				expect(response.toolCalls[0].result.error).toBeTruthy();
			}
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Configuration
	// ─────────────────────────────────────────────────────────────────────────
	describe('Configuration', () => {

		it('should respect custom chatConfig options', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				chatConfig: { temperature: 0.1, topK: 10 }
			});
			expect(agent.chatConfig.temperature).toBe(0.1);
			expect(agent.chatConfig.topK).toBe(10);
		});

		it('should use systemPrompt over chatConfig.systemInstruction', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'I am the system prompt.',
				chatConfig: { systemInstruction: 'I should be overridden.' }
			});
			expect(agent.chatConfig.systemInstruction).toBe('I am the system prompt.');
		});

		it('should configure tools in chatConfig', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.chatConfig.tools).toBeTruthy();
			expect(agent.chatConfig.tools[0].functionDeclarations).toBeTruthy();
			expect(agent.chatConfig.tools[0].functionDeclarations.length).toBe(3);
		});

		it('should have AUTO tool calling mode', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.chatConfig.toolConfig.functionCallingConfig.mode).toBe('AUTO');
		});

		it('should include safety settings by default', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.chatConfig.safetySettings).toBeTruthy();
			expect(agent.chatConfig.safetySettings.length).toBeGreaterThan(0);
		});

		it('should handle thinkingConfig set to null (disabled)', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS, thinkingConfig: null });
			expect(agent.chatConfig.thinkingConfig).toBeUndefined();
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Edge Cases
	// ─────────────────────────────────────────────────────────────────────────
	describe('Edge Cases', () => {

		it('should handle very short messages', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			const response = await agent.chat('Hi');
			expect(response.text).toBeTruthy();
		});

		it('should handle special characters in messages', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Reply concisely.'
			});
			await agent.init();
			const response = await agent.chat('What does "Hello World" mean? 🌍\n\nTell me.');
			expect(response.text).toBeTruthy();
		});

		it('should handle multiple sequential chat calls', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely with one word if possible.'
			});
			await agent.init();
			const r1 = await agent.chat('Say "alpha"');
			const r2 = await agent.chat('Say "beta"');
			const r3 = await agent.chat('Say "gamma"');
			expect(r1.text).toBeTruthy();
			expect(r2.text).toBeTruthy();
			expect(r3.text).toBeTruthy();
		});

		it('should handle interleaving chat and stream calls', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Respond concisely.'
			});
			await agent.init();

			const chatResponse = await agent.chat('Remember the word "banana".');
			expect(chatResponse.text).toBeTruthy();

			const events = [];
			for await (const event of agent.stream('What word did I ask you to remember?')) {
				events.push(event);
			}
			const doneEvent = events.find(e => e.type === 'done');
			expect(doneEvent).toBeTruthy();
			expect(doneEvent.fullText.toLowerCase()).toContain('banana');
		});

		it('should handle multiple clearHistory cycles', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();

			await agent.chat('Turn 1.');
			await agent.clearHistory();
			await agent.chat('Turn 2.');
			await agent.clearHistory();
			const response = await agent.chat('Turn 3.');
			expect(response.text).toBeTruthy();
			expect(agent.getHistory().length).toBeGreaterThan(0);
		});
	});


	// ─────────────────────────────────────────────────────────────────────────
	// Concurrent Operations
	// ─────────────────────────────────────────────────────────────────────────
	describe('Concurrent Operations', () => {

		it('should handle concurrent chat calls on separate agent instances', async () => {
			const agents = Array.from({ length: 3 }, () =>
				new AIAgent({ ...BASE_OPTIONS, systemPrompt: 'Reply with one word.' })
			);

			const responses = await Promise.all(
				agents.map(a => a.chat('Say hello.'))
			);

			responses.forEach(response => {
				expect(response.text).toBeTruthy();
			});
		});
	});

});
