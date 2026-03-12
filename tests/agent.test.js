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

	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			expect(agent.modelName).toBe('gemini-2.0-flash-lite');
			expect(agent.systemPrompt).toBe('You are a helpful AI assistant.');
			expect(typeof agent.init).toBe('function');
			expect(typeof agent.chat).toBe('function');
			expect(typeof agent.stream).toBe('function');
		});

		it('should accept custom system prompt', () => {
			const agent = new AIAgent({ ...BASE_OPTIONS, systemPrompt: 'You are a pirate.' });
			expect(agent.systemPrompt).toBe('You are a pirate.');
		});

		it('should throw on missing auth', () => {
			expect(() => new AIAgent({})).toThrow(/api key/i);
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
	});

	describe('init', () => {
		it('should initialize and connect', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			expect(agent.chatSession).toBeTruthy();
			expect(agent.genAIClient).toBeTruthy();
		});

		it('should be idempotent', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			const session1 = agent.chatSession;
			await agent.init();
			expect(agent.chatSession).toBe(session1);
		});
	});

	describe('chat (non-streaming)', () => {
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
			expect(response.usage).toBeTruthy();
			expect(response.usage.promptTokens).toBeGreaterThan(0);
		});

		it('should trigger http_get tool when asked to fetch a URL', async () => {
			const fetchAgent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'You are a helpful assistant. When asked to fetch a URL, always use the http_get tool.'
			});
			await fetchAgent.init();
			const response = await fetchAgent.chat('Please fetch this URL: https://jsonplaceholder.typicode.com/todos/1');
			expect(response.toolCalls.length).toBeGreaterThan(0);
			expect(response.toolCalls[0].name).toBe('http_get');
			expect(response.toolCalls[0].result.status).toBe(200);
		});

		it('should trigger write_markdown tool when asked to write a report', async () => {
			const markdownAgent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'You are a report writer. When asked to write any report, always use the write_markdown tool to generate it.'
			});
			await markdownAgent.init();
			const response = await markdownAgent.chat('Write a very brief markdown report about the color blue. Use the write_markdown tool.');
			expect(response.markdownFiles.length).toBeGreaterThan(0);
			expect(response.markdownFiles[0].filename).toBeTruthy();
			expect(response.markdownFiles[0].content).toBeTruthy();
		});

		it('should fire onToolCall callback', async () => {
			const calls = [];
			const cbAgent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use the http_get tool when asked to fetch anything.',
				onToolCall: (name, args) => calls.push({ name, args })
			});
			await cbAgent.init();
			await cbAgent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			expect(calls.length).toBeGreaterThan(0);
			expect(calls[0].name).toBe('http_get');
		});

		it('should fire onMarkdown callback', async () => {
			const files = [];
			const cbAgent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'When asked to write anything, always use the write_markdown tool.',
				onMarkdown: (filename, content) => files.push({ filename, content })
			});
			await cbAgent.init();
			await cbAgent.chat('Write a one-line markdown document about cats. Use the write_markdown tool.');
			expect(files.length).toBeGreaterThan(0);
		});

		it('should auto-init if init was not called', async () => {
			const lazyAgent = new AIAgent({ ...BASE_OPTIONS });
			const response = await lazyAgent.chat('Say hello.');
			expect(response.text).toBeTruthy();
		});
	});

	describe('stream', () => {
		let agent;

		beforeAll(async () => {
			agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'You are a helpful assistant. Respond concisely.'
			});
			await agent.init();
		});

		it('should stream text responses', async () => {
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

		it('should yield tool events during streaming', async () => {
			const streamAgent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use the http_get tool when asked to fetch anything.'
			});
			await streamAgent.init();

			const events = [];
			for await (const event of streamAgent.stream('Fetch https://jsonplaceholder.typicode.com/todos/1')) {
				events.push(event);
			}

			const toolCallEvents = events.filter(e => e.type === 'tool_call');
			const toolResultEvents = events.filter(e => e.type === 'tool_result');
			expect(toolCallEvents.length).toBeGreaterThan(0);
			expect(toolResultEvents.length).toBeGreaterThan(0);
		});
	});

	describe('conversation management', () => {
		it('should clear history', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			await agent.chat('My name is TestUser.');
			const historyBefore = agent.getHistory();
			expect(historyBefore.length).toBeGreaterThan(0);
			await agent.clearHistory();
			const historyAfter = agent.getHistory();
			expect(historyAfter.length).toBe(0);
		});

		it('should return usage data', async () => {
			const agent = new AIAgent({ ...BASE_OPTIONS });
			await agent.init();
			expect(agent.getLastUsage()).toBeNull();
			await agent.chat('Hello.');
			const usage = agent.getLastUsage();
			expect(usage).toBeTruthy();
			expect(usage.promptTokens).toBeGreaterThan(0);
			expect(usage.totalTokens).toBeGreaterThan(0);
			expect(usage.requestedModel).toBe('gemini-2.0-flash-lite');
		});
	});

	describe('error handling', () => {
		it('should handle tool execution failures gracefully', async () => {
			const agent = new AIAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use http_get when asked to fetch. Never explain, just fetch.',
				httpTimeout: 1000
			});
			await agent.init();
			// Use a URL that will likely timeout or fail
			const response = await agent.chat('Fetch https://httpbin.org/delay/10');
			// Should not throw - error should be sent back to model
			expect(response.text).toBeTruthy();
			expect(response.toolCalls.length).toBeGreaterThan(0);
			expect(response.toolCalls[0].result.error).toBeTruthy();
		});
	});
});
