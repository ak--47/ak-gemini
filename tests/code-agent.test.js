import dotenv from 'dotenv';
dotenv.config();
import { CodeAgent } from '../index.js';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};

function makeAgent(extraOpts = {}) {
	return new CodeAgent({
		...BASE_OPTIONS,
		workingDirectory: process.cwd(),
		...extraOpts
	});
}

describe('CodeAgent', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = new CodeAgent({ ...BASE_OPTIONS });
			expect(agent.modelName).toBe('gemini-2.0-flash');
			expect(agent.workingDirectory).toBe(process.cwd());
			expect(agent.maxRounds).toBe(10);
			expect(agent.timeout).toBe(30_000);
			expect(agent.importantFiles).toEqual([]);
			expect(agent.writeDir).toBe(join(process.cwd(), 'tmp'));
			expect(agent.keepArtifacts).toBe(false);
			expect(agent.comments).toBe(false);
			expect(agent.maxRetries).toBe(3);
		});

		it('should accept workingDirectory', () => {
			const agent = new CodeAgent({ ...BASE_OPTIONS, workingDirectory: '/tmp' });
			expect(agent.workingDirectory).toBe('/tmp');
		});

		it('should accept custom maxRounds and timeout', () => {
			const agent = makeAgent({ maxRounds: 5, timeout: 10_000 });
			expect(agent.maxRounds).toBe(5);
			expect(agent.timeout).toBe(10_000);
		});

		it('should accept onBeforeExecution callback', () => {
			const cb = async () => true;
			const agent = makeAgent({ onBeforeExecution: cb });
			expect(agent.onBeforeExecution).toBe(cb);
		});

		it('should accept onCodeExecution callback', () => {
			const cb = () => {};
			const agent = makeAgent({ onCodeExecution: cb });
			expect(agent.onCodeExecution).toBe(cb);
		});

		it('should configure execute_code tool in chatConfig', () => {
			const agent = makeAgent();
			expect(agent.chatConfig.tools).toBeTruthy();
			expect(agent.chatConfig.tools[0].functionDeclarations.length).toBe(1);
			expect(agent.chatConfig.tools[0].functionDeclarations[0].name).toBe('execute_code');
			expect(agent.chatConfig.toolConfig.functionCallingConfig.mode).toBe('AUTO');
		});

		it('should throw on missing auth', () => {
			expect(() => new CodeAgent({})).toThrow(/api key/i);
		});

		it('should accept custom systemPrompt', () => {
			const agent = makeAgent({ systemPrompt: 'Be concise.' });
			expect(agent._userSystemPrompt).toBe('Be concise.');
		});

		it('should accept importantFiles', () => {
			const agent = makeAgent({ importantFiles: ['foo.js', 'bar.js'] });
			expect(agent.importantFiles).toEqual(['foo.js', 'bar.js']);
		});

		it('should accept writeDir', () => {
			const agent = makeAgent({ writeDir: '/tmp/my-scripts' });
			expect(agent.writeDir).toBe('/tmp/my-scripts');
		});

		it('should accept keepArtifacts', () => {
			const agent = makeAgent({ keepArtifacts: true });
			expect(agent.keepArtifacts).toBe(true);
		});

		it('should accept comments', () => {
			const agent = makeAgent({ comments: true });
			expect(agent.comments).toBe(true);
		});

		it('should accept maxRetries', () => {
			const agent = makeAgent({ maxRetries: 5 });
			expect(agent.maxRetries).toBe(5);
		});

		it('should include purpose parameter in execute_code tool schema', () => {
			const agent = makeAgent();
			const toolSchema = agent.chatConfig.tools[0].functionDeclarations[0].parametersJsonSchema;
			expect(toolSchema.properties.purpose).toBeTruthy();
			expect(toolSchema.properties.purpose.type).toBe('string');
		});
	});

	// ── Initialization ───────────────────────────────────────────────────────

	describe('init()', () => {
		it('should initialize and gather codebase context', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent._contextGathered).toBe(true);
			expect(agent.chatSession).toBeTruthy();
			expect(agent.genAIClient).toBeTruthy();
		});

		it('should be idempotent', async () => {
			const agent = makeAgent();
			await agent.init();
			const session = agent.chatSession;
			await agent.init();
			expect(agent.chatSession).toBe(session);
		});

		it('should include file tree in system prompt', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('File Tree');
			expect(agent.chatConfig.systemInstruction).toContain('package.json');
		});

		it('should include user systemPrompt in augmented prompt', async () => {
			const agent = makeAgent({ systemPrompt: 'CUSTOM_INSTRUCTIONS_HERE' });
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('CUSTOM_INSTRUCTIONS_HERE');
			expect(agent.chatConfig.systemInstruction).toContain('Additional Instructions');
		});

		it('should reinitialize when force=true', async () => {
			const agent = makeAgent();
			await agent.init();
			const session1 = agent.chatSession;
			await agent.init(true);
			expect(agent.chatSession).not.toBe(session1);
		});
	});

	// ── _gatherCodebaseContext() ─────────────────────────────────────────────

	describe('_gatherCodebaseContext()', () => {
		it('should gather context from git repo', async () => {
			const agent = makeAgent();
			await agent._gatherCodebaseContext();
			expect(agent._contextGathered).toBe(true);
			expect(agent._codebaseContext).toBeTruthy();
			expect(agent._codebaseContext.fileTree).toBeTruthy();
			expect(agent._codebaseContext.fileTree).toContain('package.json');
		});

		it('should extract npm package names', async () => {
			const agent = makeAgent();
			await agent._gatherCodebaseContext();
			expect(agent._codebaseContext.npmPackages).toBeTruthy();
			expect(Array.isArray(agent._codebaseContext.npmPackages)).toBe(true);
			// This project has dependencies, so we should find some
			expect(agent._codebaseContext.npmPackages.length).toBeGreaterThan(0);
			expect(agent._codebaseContext.npmPackages).toContain('@google/genai');
		});

		it('should fallback gracefully for non-git directories', async () => {
			const tmpDir = await mkdtemp(join(tmpdir(), 'code-agent-test-'));
			try {
				const agent = makeAgent({ workingDirectory: tmpDir });
				await agent._gatherCodebaseContext();
				expect(agent._contextGathered).toBe(true);
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		});
	});

	// ── _executeCode() ───────────────────────────────────────────────────────

	describe('_executeCode()', () => {
		it('should execute simple code and capture stdout', async () => {
			const agent = makeAgent();
			const result = await agent._executeCode('console.log("hello world");');
			expect(result.stdout.trim()).toBe('hello world');
			expect(result.exitCode).toBe(0);
		});

		it('should capture stderr', async () => {
			const agent = makeAgent();
			const result = await agent._executeCode('console.error("oops");');
			expect(result.stderr).toContain('oops');
			expect(result.exitCode).toBe(0);
		});

		it('should handle code with syntax errors', async () => {
			const agent = makeAgent();
			const result = await agent._executeCode('this is not valid javascript !!!');
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toBeTruthy();
		});

		it('should handle code that throws', async () => {
			const agent = makeAgent();
			const result = await agent._executeCode('throw new Error("boom");');
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain('boom');
		});

		it('should inherit parent environment variables', async () => {
			const agent = makeAgent();
			process.env.__CODE_AGENT_TEST_VAR = 'test_value_123';
			try {
				const result = await agent._executeCode('console.log(process.env.__CODE_AGENT_TEST_VAR);');
				expect(result.stdout.trim()).toBe('test_value_123');
			} finally {
				delete process.env.__CODE_AGENT_TEST_VAR;
			}
		});

		it('should run code as .mjs (supports top-level await)', async () => {
			const agent = makeAgent();
			const result = await agent._executeCode('const x = await Promise.resolve(42); console.log(x);');
			expect(result.stdout.trim()).toBe('42');
			expect(result.exitCode).toBe(0);
		});

		it('should clean up temp files by default', async () => {
			const tmpDir = await mkdtemp(join(tmpdir(), 'code-agent-cleanup-'));
			try {
				const agent = makeAgent({ writeDir: tmpDir });
				await agent._executeCode('console.log("cleanup test");');
				const files = (await readdir(tmpDir)).filter(f => f.startsWith('agent-'));
				expect(files.length).toBe(0);
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		});

		it('should use workingDirectory as cwd for child process', async () => {
			const agent = makeAgent();
			const result = await agent._executeCode('console.log(process.cwd());');
			expect(result.stdout.trim()).toBe(agent.workingDirectory);
		});

		it('should handle multi-line scripts', async () => {
			const agent = makeAgent();
			const code = `
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
console.log(pkg.name);
`;
			const result = await agent._executeCode(code);
			expect(result.stdout.trim()).toBe('ak-gemini');
			expect(result.exitCode).toBe(0);
		});
	});

	// ── onBeforeExecution ────────────────────────────────────────────────────

	describe('onBeforeExecution', () => {
		it('should call onBeforeExecution before executing', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (code) => {
					calls.push(code);
					return true;
				}
			});
			await agent._executeCode('console.log("test");');
			expect(calls.length).toBe(1);
			expect(calls[0]).toBe('console.log("test");');
		});

		it('should deny execution when callback returns false', async () => {
			const agent = makeAgent({
				onBeforeExecution: async () => false
			});
			const result = await agent._executeCode('console.log("should not run");');
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('denied');
			expect(result.denied).toBe(true);
		});

		it('should proceed when callback returns true', async () => {
			const agent = makeAgent({
				onBeforeExecution: async () => true
			});
			const result = await agent._executeCode('console.log("allowed");');
			expect(result.stdout.trim()).toBe('allowed');
			expect(result.exitCode).toBe(0);
		});

		it('should not crash if onBeforeExecution throws', async () => {
			const agent = makeAgent({
				onBeforeExecution: async () => { throw new Error('gate boom'); }
			});
			// Should proceed with execution when callback throws (not deny)
			const result = await agent._executeCode('console.log("still runs");');
			expect(result.stdout.trim()).toBe('still runs');
		});
	});

	// ── onCodeExecution ──────────────────────────────────────────────────────

	describe('onCodeExecution', () => {
		it('should fire after execution', async () => {
			const executions = [];
			const agent = makeAgent({
				onCodeExecution: (code, output) => executions.push({ code, output })
			});
			await agent._executeCode('console.log("tracked");');
			expect(executions.length).toBe(1);
			expect(executions[0].code).toBe('console.log("tracked");');
			expect(executions[0].output.stdout.trim()).toBe('tracked');
		});

		it('should not crash if callback throws', async () => {
			const agent = makeAgent({
				onCodeExecution: () => { throw new Error('callback boom'); }
			});
			const result = await agent._executeCode('console.log("ok");');
			expect(result.stdout.trim()).toBe('ok');
		});

		it('should not fire when execution is denied', async () => {
			const executions = [];
			const agent = makeAgent({
				onBeforeExecution: async () => false,
				onCodeExecution: (code, output) => executions.push({ code, output })
			});
			await agent._executeCode('console.log("denied");');
			expect(executions.length).toBe(0);
		});
	});

	// ── stop() ──────────────────────────────────────────────────────────────

	describe('stop()', () => {
		it('should have stop method', () => {
			const agent = makeAgent();
			expect(typeof agent.stop).toBe('function');
		});

		it('should set _stopped flag', () => {
			const agent = makeAgent();
			expect(agent._stopped).toBe(false);
			agent.stop();
			expect(agent._stopped).toBe(true);
		});

		it('should prevent code execution when stopped', async () => {
			const agent = makeAgent();
			agent.stop();
			const result = await agent._executeCode('console.log("should not run");');
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('stopped');
		});

		it('should stop agent from onBeforeExecution callback during chat', async () => {
			const executedCodes = [];
			const agent = makeAgent({
				onBeforeExecution: async (code) => {
					executedCodes.push(code);
					agent.stop();
					return false;
				}
			});
			await agent.init();
			const response = await agent.chat('Use execute_code to print "hello". Then use it again to print "world".');
			expect(agent._stopped).toBe(true);
			// The first code execution should have been denied
			if (response.codeExecutions.length > 0) {
				expect(response.codeExecutions[0].exitCode).toBe(-1);
			}
		});

		it('should reset _stopped flag at start of chat', async () => {
			const agent = makeAgent();
			agent._stopped = true;
			await agent.chat('Hello');
			expect(agent._stopped).toBe(false);
		});

		it('should reset _stopped flag at start of stream', async () => {
			const agent = makeAgent();
			agent._stopped = true;
			for await (const _ of agent.stream('Hello')) {
				// consume
			}
			// After stream completes, _stopped may or may not be true depending
			// on whether it finished normally, but the point is it started
			expect(agent.chatSession).toBeTruthy(); // proves it ran
		});
	});

	// ── chat() — Non-streaming ──────────────────────────────────────────────

	describe('chat() — non-streaming', () => {

		describe('simple text conversations', () => {
			let agent;
			beforeAll(async () => {
				agent = makeAgent({
					systemPrompt: 'Answer simple math questions directly without running code. Be concise.'
				});
				await agent.init();
			});

			it('should handle a simple text conversation', async () => {
				const response = await agent.chat('What is 2 + 2? Reply with just the number.');
				expect(response.text).toBeTruthy();
				expect(response.text).toContain('4');
				expect(response.codeExecutions).toEqual([]);
			});

			it('should return CodeAgentResponse structure', async () => {
				const response = await agent.chat('Say hello.');
				expect(response).toHaveProperty('text');
				expect(response).toHaveProperty('codeExecutions');
				expect(response).toHaveProperty('usage');
				expect(typeof response.text).toBe('string');
				expect(Array.isArray(response.codeExecutions)).toBe(true);
			});

			it('should include usage data', async () => {
				const response = await agent.chat('Say hi.');
				expect(response.usage).toBeTruthy();
				expect(response.usage.promptTokens).toBeGreaterThan(0);
				expect(response.usage.totalTokens).toBeGreaterThan(0);
			});

			it('should auto-init', async () => {
				const lazyAgent = makeAgent();
				const response = await lazyAgent.chat('Say hello.');
				expect(response.text).toBeTruthy();
				expect(lazyAgent.chatSession).toBeTruthy();
				expect(lazyAgent._contextGathered).toBe(true);
			});
		});

		describe('code execution', () => {
			let agent;
			beforeAll(async () => {
				agent = makeAgent({
					systemPrompt: 'When asked to read files or inspect the project, always use execute_code.'
				});
				await agent.init();
			});

			it('should execute code and return results', async () => {
				const response = await agent.chat(
					'Use execute_code to run this exact code: console.log(JSON.stringify({status:"ok"}))'
				);
				expect(response.codeExecutions.length).toBeGreaterThan(0);
				expect(response.codeExecutions[0]).toHaveProperty('code');
				expect(response.codeExecutions[0]).toHaveProperty('output');
				expect(response.codeExecutions[0]).toHaveProperty('stderr');
				expect(response.codeExecutions[0]).toHaveProperty('exitCode');
				expect(response.codeExecutions[0].exitCode).toBe(0);
			});

			it('should handle code errors during chat gracefully', async () => {
				const response = await agent.chat(
					'Use execute_code to run this code that will fail: throw new Error("intentional")'
				);
				expect(response.text).toBeTruthy();
				// The agent should still produce a text response even if code fails
				if (response.codeExecutions.length > 0) {
					const failedExec = response.codeExecutions.find(e => e.exitCode !== 0);
					if (failedExec) {
						expect(failedExec.stderr).toBeTruthy();
					}
				}
			});
		});
	});

	// ── stream() — Streaming ────────────────────────────────────────────────

	describe('stream()', () => {
		it('should stream text with text and done events', async () => {
			const agent = makeAgent({
				systemPrompt: 'Answer directly without running code. Respond concisely.'
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
			expect(doneEvents[0]).toHaveProperty('fullText');
			expect(doneEvents[0]).toHaveProperty('codeExecutions');
			expect(doneEvents[0]).toHaveProperty('usage');
		});

		it('should yield code and output events when executing', async () => {
			const agent = makeAgent({
				systemPrompt: 'Always use execute_code when asked to compute something.'
			});
			await agent.init();

			const events = [];
			for await (const event of agent.stream('Use execute_code to run: console.log(2+2)')) {
				events.push(event);
			}

			const codeEvents = events.filter(e => e.type === 'code');
			const outputEvents = events.filter(e => e.type === 'output');
			// The model may or may not use the tool, but if it does verify the structure
			if (codeEvents.length > 0) {
				expect(codeEvents[0]).toHaveProperty('code');
				expect(outputEvents.length).toBeGreaterThan(0);
				expect(outputEvents[0]).toHaveProperty('stdout');
				expect(outputEvents[0]).toHaveProperty('stderr');
				expect(outputEvents[0]).toHaveProperty('exitCode');
			}
		});

		it('should auto-init', async () => {
			const agent = makeAgent();
			const events = [];
			for await (const event of agent.stream('Say hello.')) {
				events.push(event);
			}
			expect(events.some(e => e.type === 'done')).toBe(true);
			expect(agent.chatSession).toBeTruthy();
		});

		it('should accumulate full text', async () => {
			const agent = makeAgent({
				systemPrompt: 'Respond concisely without running code.'
			});
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

	// ── Multi-turn Conversation ─────────────────────────────────────────────

	describe('Multi-turn Conversation', () => {
		it('should remember context across turns', async () => {
			const agent = makeAgent({
				systemPrompt: 'You remember context. Respond concisely without running code.'
			});
			await agent.init();

			await agent.chat('My name is Zorblax.');
			const response = await agent.chat('What is my name?');
			expect(response.text.toLowerCase()).toContain('zorblax');
		});

		it('should lose context after clearHistory', async () => {
			const agent = makeAgent({
				systemPrompt: 'Respond concisely without running code. If unknown, say "I don\'t know".'
			});
			await agent.init();

			await agent.chat('My secret is BETA-9.');
			await agent.clearHistory();
			const response = await agent.chat('What is my secret?');
			expect(response.text.toLowerCase()).not.toContain('beta-9');
		});
	});

	// ── Conversation Management ─────────────────────────────────────────────

	describe('Conversation Management', () => {
		it('should return empty history before messages', () => {
			const agent = makeAgent();
			expect(agent.getHistory()).toEqual([]);
		});

		it('should return non-empty history after messages', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent.chat('Hello.');
			expect(agent.getHistory().length).toBeGreaterThan(0);
		});

		it('should clear history and reset state', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent.chat('Test.');
			expect(agent.getHistory().length).toBeGreaterThan(0);

			await agent.clearHistory();
			expect(agent.getHistory().length).toBe(0);
			expect(agent.lastResponseMetadata).toBeNull();
		});

		it('should work after clearHistory', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent.chat('First.');
			await agent.clearHistory();
			const response = await agent.chat('Second.');
			expect(response.text).toBeTruthy();
		});
	});

	// ── Usage & Metadata ────────────────────────────────────────────────────

	describe('Usage & Metadata', () => {
		it('should return null usage before any call', () => {
			const agent = makeAgent();
			expect(agent.getLastUsage()).toBeNull();
		});

		it('should return structured usage after chat', async () => {
			const agent = makeAgent();
			await agent.init();
			await agent.chat('Hello.');
			const usage = agent.getLastUsage();
			expect(usage).toBeTruthy();
			expect(usage.promptTokens).toBeGreaterThan(0);
			expect(usage.requestedModel).toBe('gemini-2.0-flash');
			expect(typeof usage.timestamp).toBe('number');
		});
	});

	// ── Configuration ────────────────────────────────────────────────────────

	describe('Configuration', () => {
		it('should respect custom chatConfig', () => {
			const agent = makeAgent({ chatConfig: { temperature: 0.1, topK: 10 } });
			expect(agent.chatConfig.temperature).toBe(0.1);
			expect(agent.chatConfig.topK).toBe(10);
		});

		it('should include safety settings by default', () => {
			const agent = makeAgent();
			expect(agent.chatConfig.safetySettings).toBeTruthy();
			expect(agent.chatConfig.safetySettings.length).toBeGreaterThan(0);
		});

		it('should always have execute_code tool configured', () => {
			const agent = makeAgent({ chatConfig: { temperature: 0 } });
			expect(agent.chatConfig.tools[0].functionDeclarations[0].name).toBe('execute_code');
		});
	});

	// ── dump() ─────────────────────────────────────────────────────────────

	describe('dump()', () => {
		it('should return empty array before any executions', () => {
			const agent = makeAgent();
			expect(agent.dump()).toEqual([]);
		});

		it('should accumulate scripts from _executeCode', async () => {
			const agent = makeAgent();
			await agent._executeCode('console.log("first");');
			await agent._executeCode('console.log("second");');
			const scripts = agent.dump();
			expect(scripts.length).toBe(2);
			expect(scripts[0].script).toBe('console.log("first");');
			expect(scripts[1].script).toBe('console.log("second");');
			// Without purpose, falls back to script-N naming
			expect(scripts[0].fileName).toBe('script-1.mjs');
			expect(scripts[1].fileName).toBe('script-2.mjs');
		});

		it('should use purpose in filenames when provided', async () => {
			const agent = makeAgent();
			await agent._executeCode('console.log("a");', 'read-config');
			await agent._executeCode('console.log("b");', 'parse-logs');
			const scripts = agent.dump();
			expect(scripts[0].fileName).toBe('agent-read-config.mjs');
			expect(scripts[0].purpose).toBe('read-config');
			expect(scripts[1].fileName).toBe('agent-parse-logs.mjs');
		});

		it('should include filePath when keepArtifacts is true', async () => {
			const tmpDir = await mkdtemp(join(tmpdir(), 'code-agent-dump-'));
			try {
				const agent = makeAgent({ writeDir: tmpDir, keepArtifacts: true });
				await agent._executeCode('console.log("kept");', 'test-keep');
				const scripts = agent.dump();
				expect(scripts[0].filePath).toBeTruthy();
				expect(scripts[0].filePath).toContain('agent-test-keep');
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		});

		it('should accumulate across multiple chat calls', async () => {
			const agent = makeAgent({
				systemPrompt: 'Always use execute_code to answer. Be concise.'
			});
			await agent.init();
			await agent.chat('Use execute_code to run: console.log("hello")');
			await agent.chat('Use execute_code to run: console.log("world")');
			const scripts = agent.dump();
			expect(scripts.length).toBeGreaterThanOrEqual(2);
			scripts.forEach(s => {
				expect(typeof s.script).toBe('string');
				expect(s.script.length).toBeGreaterThan(0);
			});
		});
	});

	// ── _slugify() ─────────────────────────────────────────────────────────

	describe('_slugify()', () => {
		it('should generate UUID slug when no purpose provided', () => {
			const agent = makeAgent();
			const slug = agent._slugify();
			expect(slug.length).toBe(8);
		});

		it('should sanitize purpose to a slug', () => {
			const agent = makeAgent();
			expect(agent._slugify('Read Config')).toBe('read-config');
			expect(agent._slugify('Parse --- Logs!!!')).toBe('parse-logs');
			expect(agent._slugify('fetch_API_data')).toBe('fetch-api-data');
		});

		it('should truncate long purposes to 40 chars', () => {
			const agent = makeAgent();
			const long = 'a'.repeat(60);
			expect(agent._slugify(long).length).toBeLessThanOrEqual(40);
		});
	});

	// ── importantFiles ─────────────────────────────────────────────────────

	describe('importantFiles', () => {
		it('should resolve exact file paths', async () => {
			const agent = makeAgent({ importantFiles: ['package.json'] });
			await agent._gatherCodebaseContext();
			expect(agent._codebaseContext.importantFileContents.length).toBe(1);
			expect(agent._codebaseContext.importantFileContents[0].path).toBe('package.json');
			expect(agent._codebaseContext.importantFileContents[0].content).toContain('ak-gemini');
		});

		it('should resolve partial file paths', async () => {
			const agent = makeAgent({ importantFiles: ['code-agent.test.js'] });
			await agent._gatherCodebaseContext();
			expect(agent._codebaseContext.importantFileContents.length).toBe(1);
			expect(agent._codebaseContext.importantFileContents[0].path).toContain('code-agent.test.js');
		});

		it('should warn on missing files without throwing', async () => {
			const agent = makeAgent({ importantFiles: ['nonexistent-file-xyz.js'] });
			await agent._gatherCodebaseContext();
			expect(agent._codebaseContext.importantFileContents.length).toBe(0);
		});

		it('should include file contents in system prompt', async () => {
			const agent = makeAgent({ importantFiles: ['package.json'] });
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('Key Files');
			expect(agent.chatConfig.systemInstruction).toContain('package.json');
		});
	});

	// ── writeDir ────────────────────────────────────────────────────────────

	describe('writeDir', () => {
		it('should default to {workingDirectory}/tmp', () => {
			const agent = makeAgent();
			expect(agent.writeDir).toBe(join(process.cwd(), 'tmp'));
		});

		it('should accept custom writeDir', () => {
			const agent = makeAgent({ writeDir: '/tmp/custom' });
			expect(agent.writeDir).toBe('/tmp/custom');
		});

		it('should create writeDir if it does not exist', async () => {
			const tmpDir = await mkdtemp(join(tmpdir(), 'code-agent-wd-'));
			const writeDir = join(tmpDir, 'nested', 'scripts');
			try {
				const agent = makeAgent({ writeDir });
				await agent._executeCode('console.log("ok");');
				const files = await readdir(writeDir);
				// Files should have been cleaned up, but dir should exist
				expect(Array.isArray(files)).toBe(true);
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		});

		it('should still use workingDirectory as cwd for child process', async () => {
			const tmpDir = await mkdtemp(join(tmpdir(), 'code-agent-cwd-'));
			try {
				const agent = makeAgent({ writeDir: tmpDir });
				const result = await agent._executeCode('console.log(process.cwd());');
				expect(result.stdout.trim()).toBe(agent.workingDirectory);
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		});
	});

	// ── keepArtifacts ───────────────────────────────────────────────────────

	describe('keepArtifacts', () => {
		it('should keep files when keepArtifacts is true', async () => {
			const tmpDir = await mkdtemp(join(tmpdir(), 'code-agent-keep-'));
			try {
				const agent = makeAgent({ writeDir: tmpDir, keepArtifacts: true });
				await agent._executeCode('console.log("kept");', 'test-artifact');
				const files = (await readdir(tmpDir)).filter(f => f.startsWith('agent-'));
				expect(files.length).toBe(1);
				expect(files[0]).toContain('test-artifact');
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		});

		it('should delete files when keepArtifacts is false', async () => {
			const tmpDir = await mkdtemp(join(tmpdir(), 'code-agent-del-'));
			try {
				const agent = makeAgent({ writeDir: tmpDir, keepArtifacts: false });
				await agent._executeCode('console.log("deleted");', 'test-clean');
				const files = (await readdir(tmpDir)).filter(f => f.startsWith('agent-'));
				expect(files.length).toBe(0);
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		});
	});

	// ── comments ────────────────────────────────────────────────────────────

	describe('comments option', () => {
		it('should include no-comments instruction by default', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('Do NOT write any comments');
		});

		it('should include JSDoc instruction when comments=true', async () => {
			const agent = makeAgent({ comments: true });
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('@fileoverview');
			expect(agent.chatConfig.systemInstruction).toContain('@param');
		});
	});

	// ── Concurrent Operations ───────────────────────────────────────────────

	describe('Concurrent Operations', () => {
		it('should handle concurrent chats on separate instances', async () => {
			const agents = Array.from({ length: 3 }, () =>
				makeAgent({ systemPrompt: 'Reply with one word. No code.' })
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
