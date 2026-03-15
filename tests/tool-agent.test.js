import dotenv from 'dotenv';
dotenv.config();
import { ToolAgent } from '../index.js';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run agent tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash-lite',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};

// ── User-Provided Tools for Testing ──────────────────────────────────────────

const HTTP_TOOLS = [
	{
		name: 'http_get',
		description: 'Make an HTTP GET request to any URL. Returns the response status and body.',
		parametersJsonSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'The full URL to request' },
				headers: {
					type: 'object',
					description: 'Optional HTTP headers',
					additionalProperties: { type: 'string' }
				}
			},
			required: ['url']
		}
	},
	{
		name: 'http_post',
		description: 'Make an HTTP POST request with a JSON body.',
		parametersJsonSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'The full URL to request' },
				body: { type: 'object', description: 'The JSON body to send' },
				headers: {
					type: 'object',
					description: 'Optional HTTP headers',
					additionalProperties: { type: 'string' }
				}
			},
			required: ['url']
		}
	}
];

const MAX_BODY = 50_000;

async function httpToolExecutor(name, args) {
	switch (name) {
		case 'http_get': {
			const resp = await fetch(args.url, {
				method: 'GET',
				headers: args.headers || {},
				signal: AbortSignal.timeout(30000)
			});
			const text = await resp.text();
			const body = text.length > MAX_BODY ? text.slice(0, MAX_BODY) + '\n...[TRUNCATED]' : text;
			let parsed;
			try { parsed = JSON.parse(body); } catch { parsed = body; }
			return { status: resp.status, statusText: resp.statusText, body: parsed };
		}
		case 'http_post': {
			const headers = { 'Content-Type': 'application/json', ...(args.headers || {}) };
			const resp = await fetch(args.url, {
				method: 'POST',
				headers,
				body: args.body ? JSON.stringify(args.body) : undefined,
				signal: AbortSignal.timeout(30000)
			});
			const text = await resp.text();
			const body = text.length > MAX_BODY ? text.slice(0, MAX_BODY) + '\n...[TRUNCATED]' : text;
			let parsed;
			try { parsed = JSON.parse(body); } catch { parsed = body; }
			return { status: resp.status, statusText: resp.statusText, body: parsed };
		}
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

function makeAgentWithTools(extraOpts = {}) {
	return new ToolAgent({
		...BASE_OPTIONS,
		tools: HTTP_TOOLS,
		toolExecutor: httpToolExecutor,
		...extraOpts
	});
}


describe('ToolAgent', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should create with tools and executor', () => {
			const agent = makeAgentWithTools();
			expect(agent.modelName).toBe('gemini-2.0-flash-lite');
			expect(agent.tools.length).toBe(2);
			expect(agent.toolExecutor).toBe(httpToolExecutor);
			expect(agent.maxToolRounds).toBe(10);
		});

		it('should create without tools (chat-only mode)', () => {
			const agent = new ToolAgent({ ...BASE_OPTIONS });
			expect(agent.tools).toEqual([]);
			expect(agent.toolExecutor).toBeNull();
		});

		it('should throw if tools provided without executor', () => {
			expect(() => new ToolAgent({
				...BASE_OPTIONS,
				tools: HTTP_TOOLS
			})).toThrow(/toolExecutor/i);
		});

		it('should throw if executor provided without tools', () => {
			expect(() => new ToolAgent({
				...BASE_OPTIONS,
				toolExecutor: httpToolExecutor
			})).toThrow(/tool declarations/i);
		});

		it('should accept custom systemPrompt', () => {
			const agent = makeAgentWithTools({ systemPrompt: 'You are a pirate.' });
			expect(agent.systemPrompt).toBe('You are a pirate.');
		});

		it('should accept custom maxToolRounds', () => {
			const agent = makeAgentWithTools({ maxToolRounds: 5 });
			expect(agent.maxToolRounds).toBe(5);
		});

		it('should accept onToolCall callback', () => {
			const cb = () => {};
			const agent = makeAgentWithTools({ onToolCall: cb });
			expect(agent.onToolCall).toBe(cb);
		});

		it('should configure tools in chatConfig', () => {
			const agent = makeAgentWithTools();
			expect(agent.chatConfig.tools).toBeTruthy();
			expect(agent.chatConfig.tools[0].functionDeclarations.length).toBe(2);
			expect(agent.chatConfig.toolConfig.functionCallingConfig.mode).toBe('AUTO');
		});

		it('should throw on missing auth', () => {
			expect(() => new ToolAgent({})).toThrow(/api key/i);
		});
	});

	// ── Initialization ───────────────────────────────────────────────────────

	describe('init()', () => {
		it('should initialize and create chat session', async () => {
			const agent = makeAgentWithTools();
			await agent.init();
			expect(agent.chatSession).toBeTruthy();
			expect(agent.genAIClient).toBeTruthy();
		});

		it('should be idempotent', async () => {
			const agent = makeAgentWithTools();
			await agent.init();
			const session = agent.chatSession;
			await agent.init();
			expect(agent.chatSession).toBe(session);
		});
	});

	// ── chat() — Non-streaming ───────────────────────────────────────────────

	describe('chat() — non-streaming', () => {

		describe('simple text conversations', () => {
			let agent;
			beforeAll(async () => {
				agent = makeAgentWithTools({
					systemPrompt: 'You are a helpful assistant. Respond concisely. When asked simple questions, answer directly without using tools.'
				});
				await agent.init();
			});

			it('should handle a simple text conversation', async () => {
				const response = await agent.chat('What is 2 + 2? Reply with just the number.');
				expect(response.text).toBeTruthy();
				expect(response.text).toContain('4');
				expect(response.toolCalls).toEqual([]);
			});

			it('should return AgentResponse structure', async () => {
				const response = await agent.chat('Say hello.');
				expect(response).toHaveProperty('text');
				expect(response).toHaveProperty('toolCalls');
				expect(response).toHaveProperty('usage');
				expect(typeof response.text).toBe('string');
				expect(Array.isArray(response.toolCalls)).toBe(true);
			});

			it('should include usage data', async () => {
				const response = await agent.chat('Say hi.');
				expect(response.usage).toBeTruthy();
				expect(response.usage.promptTokens).toBeGreaterThan(0);
				expect(response.usage.totalTokens).toBeGreaterThan(0);
			});

			it('should auto-init', async () => {
				const lazyAgent = makeAgentWithTools();
				const response = await lazyAgent.chat('Say hello.');
				expect(response.text).toBeTruthy();
				expect(lazyAgent.chatSession).toBeTruthy();
			});
		});

		describe('http_get tool', () => {
			let agent;
			beforeAll(async () => {
				agent = makeAgentWithTools({
					systemPrompt: 'You are a helpful assistant. When asked to fetch a URL, always use the http_get tool.'
				});
				await agent.init();
			});

			it('should trigger http_get when asked to fetch', async () => {
				const response = await agent.chat('Please fetch this URL: https://jsonplaceholder.typicode.com/todos/1');
				expect(response.toolCalls.length).toBeGreaterThan(0);
				expect(response.toolCalls[0].name).toBe('http_get');
				expect(response.toolCalls[0].args.url).toContain('jsonplaceholder');
				expect(response.toolCalls[0].result.status).toBe(200);
			});

			it('should return parsed JSON body', async () => {
				const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
				const tc = response.toolCalls.find(t => t.name === 'http_get');
				expect(tc).toBeTruthy();
				expect(typeof tc.result.body).toBe('object');
				expect(tc.result.body.userId).toBe(1);
			});
		});

		describe('http_post tool', () => {
			it('should trigger http_post', async () => {
				const agent = makeAgentWithTools({
					systemPrompt: 'When asked to POST, always use the http_post tool.'
				});
				await agent.init();
				const response = await agent.chat(
					'POST {"title":"foo","body":"bar","userId":1} to https://jsonplaceholder.typicode.com/posts'
				);
				const postCalls = response.toolCalls.filter(tc => tc.name === 'http_post');
				expect(postCalls.length).toBeGreaterThan(0);
				expect(postCalls[0].result.status).toBe(201);
			});
		});
	});

	// ── Callbacks ────────────────────────────────────────────────────────────

	describe('Callbacks', () => {
		it('should fire onToolCall callback', async () => {
			const calls = [];
			const agent = makeAgentWithTools({
				systemPrompt: 'Always use http_get when asked to fetch.',
				onToolCall: (name, args) => calls.push({ name, args })
			});
			await agent.init();
			await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			expect(calls.length).toBeGreaterThan(0);
			expect(calls[0].name).toBe('http_get');
		});

		it('should not crash if onToolCall throws', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'Always use http_get when asked to fetch.',
				onToolCall: () => { throw new Error('callback boom'); }
			});
			await agent.init();
			const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			expect(response).toBeTruthy();
			expect(response.toolCalls.length).toBeGreaterThan(0);
		});
	});

	// ── stream() — Streaming ─────────────────────────────────────────────────

	describe('stream()', () => {
		it('should stream text with text and done events', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'Respond concisely.'
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

		it('should yield tool_call and tool_result events', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'Always use http_get when asked to fetch.'
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
			expect(toolResultEvents.length).toBeGreaterThan(0);
			expect(toolResultEvents[0].result.status).toBe(200);
		});

		it('should auto-init', async () => {
			const agent = makeAgentWithTools();
			const events = [];
			for await (const event of agent.stream('Say hello.')) {
				events.push(event);
			}
			expect(events.some(e => e.type === 'done')).toBe(true);
			expect(agent.chatSession).toBeTruthy();
		});

		it('should accumulate full text', async () => {
			const agent = makeAgentWithTools({ systemPrompt: 'Respond concisely.' });
			await agent.init();

			let accumulated = '';
			let doneText = '';
			for await (const event of agent.stream('List three colors.')) {
				if (event.type === 'text') accumulated += event.text;
				if (event.type === 'done') doneText = event.fullText;
			}
			expect(accumulated).toBe(doneText);
		});
	});

	// ── Multi-turn ───────────────────────────────────────────────────────────

	describe('Multi-turn Conversation', () => {
		it('should remember context across turns', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'You remember context. Respond concisely.'
			});
			await agent.init();

			await agent.chat('My name is Zorblax.');
			const response = await agent.chat('What is my name?');
			expect(response.text.toLowerCase()).toContain('zorblax');
		});

		it('should lose context after clearHistory', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'Respond concisely. If unknown, say "I don\'t know".'
			});
			await agent.init();

			await agent.chat('My secret is ALPHA-7.');
			await agent.clearHistory();
			const response = await agent.chat('What is my secret?');
			expect(response.text.toLowerCase()).not.toContain('alpha-7');
		});
	});

	// ── Conversation Management ──────────────────────────────────────────────

	describe('Conversation Management', () => {
		it('should return empty history before messages', () => {
			const agent = makeAgentWithTools();
			expect(agent.getHistory()).toEqual([]);
		});

		it('should return non-empty history after messages', async () => {
			const agent = makeAgentWithTools();
			await agent.init();
			await agent.chat('Hello.');
			expect(agent.getHistory().length).toBeGreaterThan(0);
		});

		it('should clear history and reset state', async () => {
			const agent = makeAgentWithTools();
			await agent.init();
			await agent.chat('Test.');
			expect(agent.getHistory().length).toBeGreaterThan(0);

			await agent.clearHistory();
			expect(agent.getHistory().length).toBe(0);
			expect(agent.lastResponseMetadata).toBeNull();
		});

		it('should work after clearHistory', async () => {
			const agent = makeAgentWithTools();
			await agent.init();
			await agent.chat('First.');
			await agent.clearHistory();
			const response = await agent.chat('Second.');
			expect(response.text).toBeTruthy();
		});
	});

	// ── Usage & Metadata ─────────────────────────────────────────────────────

	describe('Usage & Metadata', () => {
		it('should return null usage before any call', () => {
			const agent = makeAgentWithTools();
			expect(agent.getLastUsage()).toBeNull();
		});

		it('should return structured usage after chat', async () => {
			const agent = makeAgentWithTools();
			await agent.init();
			await agent.chat('Hello.');
			const usage = agent.getLastUsage();
			expect(usage).toBeTruthy();
			expect(usage.promptTokens).toBeGreaterThan(0);
			expect(usage.requestedModel).toBe('gemini-2.0-flash-lite');
		});
	});

	// ── Error Handling ───────────────────────────────────────────────────────

	describe('Error Handling', () => {
		it('should handle tool execution failures gracefully', async () => {
			const agent = new ToolAgent({
				...BASE_OPTIONS,
				systemPrompt: 'Always use http_get when asked to fetch.',
				tools: HTTP_TOOLS,
				toolExecutor: async (name, args) => {
					if (name === 'http_get') {
						const resp = await fetch(args.url, {
							signal: AbortSignal.timeout(1000)
						});
						return { status: resp.status, body: await resp.text() };
					}
				}
			});
			await agent.init();
			const response = await agent.chat('Fetch https://httpbin.org/delay/10');
			expect(response.text).toBeTruthy();
			expect(response.toolCalls.length).toBeGreaterThan(0);
			expect(response.toolCalls[0].result.error).toBeTruthy();
		});

		it('should handle 404 responses', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'Always use http_get when asked to fetch.'
			});
			await agent.init();
			const response = await agent.chat('Fetch https://httpbin.org/status/404');
			expect(response).toBeTruthy();
			const getCalls = response.toolCalls.filter(tc => tc.name === 'http_get');
			if (getCalls.length > 0) {
				expect(getCalls[0].result.status).toBe(404);
			}
		});
	});

	// ── Configuration ────────────────────────────────────────────────────────

	describe('Configuration', () => {
		it('should respect custom chatConfig', () => {
			const agent = makeAgentWithTools({ chatConfig: { temperature: 0.1, topK: 10 } });
			expect(agent.chatConfig.temperature).toBe(0.1);
			expect(agent.chatConfig.topK).toBe(10);
		});

		it('should use systemPrompt over chatConfig.systemInstruction', () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'I am the system prompt.',
				chatConfig: { systemInstruction: 'I should be overridden.' }
			});
			expect(agent.chatConfig.systemInstruction).toBe('I am the system prompt.');
		});

		it('should include safety settings by default', () => {
			const agent = makeAgentWithTools();
			expect(agent.chatConfig.safetySettings).toBeTruthy();
			expect(agent.chatConfig.safetySettings.length).toBeGreaterThan(0);
		});
	});

	// ── onBeforeExecution ────────────────────────────────────────────────────

	describe('onBeforeExecution', () => {
		it('should accept onBeforeExecution callback', () => {
			const cb = async () => true;
			const agent = makeAgentWithTools({ onBeforeExecution: cb });
			expect(agent.onBeforeExecution).toBe(cb);
		});

		it('should call onBeforeExecution before tool execution', async () => {
			const calls = [];
			const agent = makeAgentWithTools({
				systemPrompt: 'Always use http_get when asked to fetch.',
				onBeforeExecution: async (name, args) => {
					calls.push({ name, args });
					return true;
				}
			});
			await agent.init();
			await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			expect(calls.length).toBeGreaterThan(0);
			expect(calls[0].name).toBe('http_get');
		});

		it('should deny tool execution when callback returns false', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'Always use http_get when asked to fetch.',
				onBeforeExecution: async () => false
			});
			await agent.init();
			const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			expect(response.toolCalls.length).toBeGreaterThan(0);
			expect(response.toolCalls[0].result.error).toContain('denied');
		});
	});

	// ── stop() ──────────────────────────────────────────────────────────────

	describe('stop()', () => {
		it('should have stop method', () => {
			const agent = makeAgentWithTools();
			expect(typeof agent.stop).toBe('function');
		});

		it('should set _stopped flag', () => {
			const agent = makeAgentWithTools();
			expect(agent._stopped).toBe(false);
			agent.stop();
			expect(agent._stopped).toBe(true);
		});

		it('should stop agent from onBeforeExecution callback', async () => {
			const agent = makeAgentWithTools({
				systemPrompt: 'Always use http_get when asked to fetch.',
				onBeforeExecution: async () => {
					agent.stop();
					return false;
				}
			});
			await agent.init();
			const response = await agent.chat('Fetch https://jsonplaceholder.typicode.com/todos/1');
			expect(agent._stopped).toBe(true);
			expect(response.toolCalls[0].result.error).toContain('denied');
		});
	});

	// ── Concurrent Operations ────────────────────────────────────────────────

	describe('Concurrent Operations', () => {
		it('should handle concurrent chats on separate instances', async () => {
			const agents = Array.from({ length: 3 }, () =>
				makeAgentWithTools({ systemPrompt: 'Reply with one word.' })
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
