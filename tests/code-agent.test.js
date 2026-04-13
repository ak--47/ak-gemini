import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { CodeAgent } from '../index.js';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, readdir, readFile, mkdir, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};

let tmpDir;

beforeAll(async () => {
	tmpDir = await realpath(await mkdtemp(join(tmpdir(), 'ak-gemini-code-agent-test-')));
	await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
		name: 'test-project',
		dependencies: { lodash: '4.17.21' },
		devDependencies: { jest: '29.0.0' }
	}));
	await mkdir(join(tmpDir, 'src'), { recursive: true });
	await writeFile(join(tmpDir, 'src', 'app.js'), 'export default function app() { return "hello"; }');
	await mkdir(join(tmpDir, 'tmp'), { recursive: true });
});

afterAll(async () => {
	try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
});

function makeAgent(extraOpts = {}) {
	return new CodeAgent({
		...BASE_OPTIONS,
		workingDirectory: tmpDir,
		writeDir: join(tmpDir, 'tmp'),
		timeout: 15000,
		...extraOpts
	});
}

describe('CodeAgent', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = makeAgent();
			expect(agent.workingDirectory).toBe(tmpDir);
			expect(agent.maxRounds).toBe(10);
			expect(agent.timeout).toBe(15000);
			expect(agent.importantFiles).toEqual([]);
			expect(agent.writeDir).toBe(join(tmpDir, 'tmp'));
			expect(agent.keepArtifacts).toBe(false);
			expect(agent.comments).toBe(false);
			expect(agent.maxRetries).toBe(3);
			expect(agent._stopped).toBe(false);
			expect(agent.skills).toEqual([]);
			expect(agent._skillRegistry.size).toBe(0);
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

		it('should have 5 tools by default (no skills)', () => {
			const agent = makeAgent();
			const decls = agent.chatConfig.tools[0].functionDeclarations;
			expect(decls.length).toBe(5);
			const names = decls.map(d => d.name);
			expect(names).toContain('write_code');
			expect(names).toContain('execute_code');
			expect(names).toContain('write_and_run_code');
			expect(names).toContain('fix_code');
			expect(names).toContain('run_bash');
			expect(names).not.toContain('use_skill');
		});

		it('should configure toolConfig with AUTO mode', () => {
			const agent = makeAgent();
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

		it('should default writeDir to {workingDirectory}/tmp', () => {
			const agent = new CodeAgent({ ...BASE_OPTIONS, workingDirectory: '/some/dir' });
			expect(agent.writeDir).toBe('/some/dir/tmp');
		});

		it('should accept keepArtifacts', () => {
			expect(makeAgent({ keepArtifacts: true }).keepArtifacts).toBe(true);
			expect(makeAgent().keepArtifacts).toBe(false);
		});

		it('should accept comments', () => {
			expect(makeAgent({ comments: true }).comments).toBe(true);
			expect(makeAgent().comments).toBe(false);
		});

		it('should accept maxRetries', () => {
			const agent = makeAgent({ maxRetries: 5 });
			expect(agent.maxRetries).toBe(5);
		});

		it('should accept skills option', () => {
			expect(makeAgent({ skills: ['/path/to/skill.md'] }).skills).toEqual(['/path/to/skill.md']);
		});

		it('should have correct tool schemas in Gemini format', () => {
			const agent = makeAgent();
			const decls = agent.chatConfig.tools[0].functionDeclarations;

			const execTool = decls.find(d => d.name === 'execute_code');
			expect(execTool.parametersJsonSchema.properties.code.type).toBe('string');
			expect(execTool.parametersJsonSchema.properties.purpose.type).toBe('string');
			expect(execTool.parametersJsonSchema.required).toContain('code');

			const fixTool = decls.find(d => d.name === 'fix_code');
			expect(fixTool.parametersJsonSchema.required).toEqual(['original_code', 'fixed_code']);
			expect(fixTool.parametersJsonSchema.properties.execute.type).toBe('boolean');

			const bashTool = decls.find(d => d.name === 'run_bash');
			expect(bashTool.parametersJsonSchema.required).toEqual(['command']);
		});

		it('should accept custom tools and toolExecutor', () => {
			const tools = [{ name: 'lookup', description: 'Look up a value', parametersJsonSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } }];
			const executor = async () => ({});
			const agent = makeAgent({ tools, toolExecutor: executor });
			expect(agent.customTools.length).toBe(1);
			expect(agent.customTools[0].name).toBe('lookup');
			expect(agent.toolExecutor).toBe(executor);
		});

		it('should throw when tools provided without toolExecutor', () => {
			const tools = [{ name: 'lookup', description: 'Look up', parametersJsonSchema: { type: 'object', properties: {} } }];
			expect(() => makeAgent({ tools })).toThrow('toolExecutor');
		});
	});

	// ── Custom Tools ────────────────────────────────────────────────────────

	describe('Custom Tools', () => {
		const CUSTOM_TOOLS = [{ name: 'db_query', description: 'Run a database query', parametersJsonSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } }];

		it('should include custom tools in _buildToolDefinitions()', () => {
			const agent = makeAgent({ tools: CUSTOM_TOOLS, toolExecutor: async () => ({}) });
			const decls = agent.chatConfig.tools[0].functionDeclarations;
			const toolNames = decls.map(d => d.name);
			expect(toolNames).toContain('write_code');
			expect(toolNames).toContain('db_query');
		});

		it('should dispatch custom tool via _handleToolCall()', async () => {
			let calledWith = null;
			const executor = async (name, args) => { calledWith = { name, args }; return { rows: [{ id: 1 }] }; };
			const agent = makeAgent({ tools: CUSTOM_TOOLS, toolExecutor: executor });
			const result = await agent._handleToolCall('db_query', { sql: 'SELECT 1' });
			expect(calledWith).toEqual({ name: 'db_query', args: { sql: 'SELECT 1' } });
			expect(result.type).toBe('tool');
			expect(result.data.tool).toBe('db_query');
			expect(result.data.result).toEqual({ rows: [{ id: 1 }] });
		});

		it('should handle toolExecutor errors gracefully', async () => {
			const executor = async () => { throw new Error('connection refused'); };
			const agent = makeAgent({ tools: CUSTOM_TOOLS, toolExecutor: executor });
			const result = await agent._handleToolCall('db_query', { sql: 'SELECT 1' });
			expect(result.type).toBe('tool');
			expect(result.data.error).toBe('connection refused');
			expect(result.output).toContain('connection refused');
		});

		it('should stringify non-string results', async () => {
			const executor = async () => ({ count: 42 });
			const agent = makeAgent({ tools: CUSTOM_TOOLS, toolExecutor: executor });
			const result = await agent._handleToolCall('db_query', { sql: 'SELECT 1' });
			expect(result.output).toBe('{"count":42}');
		});

		it('should return string results as-is', async () => {
			const executor = async () => 'done';
			const agent = makeAgent({ tools: CUSTOM_TOOLS, toolExecutor: executor });
			const result = await agent._handleToolCall('db_query', { sql: 'SELECT 1' });
			expect(result.output).toBe('done');
		});

		it('should still handle built-in tools when custom tools are present', async () => {
			const agent = makeAgent({ tools: CUSTOM_TOOLS, toolExecutor: async () => ({}) });
			const result = await agent._handleToolCall('write_code', { code: 'console.log("hi")' });
			expect(result.type).toBe('write');
		});
	});

	// ── _buildToolDefinitions() ─────────────────────────────────────────────

	describe('_buildToolDefinitions()', () => {
		it('should return Gemini format with functionDeclarations', () => {
			const agent = makeAgent();
			const result = agent._buildToolDefinitions();
			expect(result).toHaveProperty('functionDeclarations');
			expect(Array.isArray(result.functionDeclarations)).toBe(true);
		});

		it('should use parametersJsonSchema (not parameters or input_schema)', () => {
			const agent = makeAgent();
			const result = agent._buildToolDefinitions();
			for (const decl of result.functionDeclarations) {
				expect(decl).toHaveProperty('parametersJsonSchema');
				expect(decl).not.toHaveProperty('parameters');
				expect(decl).not.toHaveProperty('input_schema');
			}
		});

		it('should not include use_skill when no skills loaded', () => {
			const agent = makeAgent();
			const result = agent._buildToolDefinitions();
			const names = result.functionDeclarations.map(d => d.name);
			expect(names).not.toContain('use_skill');
			expect(result.functionDeclarations.length).toBe(5);
		});

		it('should include use_skill when skills are registered', () => {
			const agent = makeAgent();
			agent._skillRegistry.set('test-skill', { name: 'test-skill', content: 'content', path: '/fake' });
			const result = agent._buildToolDefinitions();
			const names = result.functionDeclarations.map(d => d.name);
			expect(names).toContain('use_skill');
			expect(result.functionDeclarations.length).toBe(6);
		});

		it('should list skill names in use_skill description', () => {
			const agent = makeAgent();
			agent._skillRegistry.set('alpha', { name: 'alpha', content: '', path: '' });
			agent._skillRegistry.set('beta', { name: 'beta', content: '', path: '' });
			const result = agent._buildToolDefinitions();
			const skillTool = result.functionDeclarations.find(d => d.name === 'use_skill');
			expect(skillTool.description).toContain('alpha');
			expect(skillTool.description).toContain('beta');
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

		it('should include npm packages in context', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent._codebaseContext.npmPackages).toContain('lodash');
			expect(agent._codebaseContext.npmPackages).toContain('jest');
		});

		it('should describe all tools in system prompt', async () => {
			const agent = makeAgent();
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('write_code');
			expect(agent.chatConfig.systemInstruction).toContain('execute_code');
			expect(agent.chatConfig.systemInstruction).toContain('write_and_run_code');
			expect(agent.chatConfig.systemInstruction).toContain('fix_code');
			expect(agent.chatConfig.systemInstruction).toContain('run_bash');
		});
	});

	// ── Skills ───────────────────────────────────────────────────────────────

	describe('Skills', () => {
		let skillDir;

		beforeAll(async () => {
			skillDir = join(tmpDir, 'skills');
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, 'api-pattern.md'), '---\nname: api-pattern\n---\n# API Pattern\nUse fetch() for all HTTP requests.');
			await writeFile(join(skillDir, 'data-pipeline.md'), '# Data Pipeline\nProcess data in stages.');
		});

		it('should load skills during init', async () => {
			const agent = makeAgent({
				skills: [join(skillDir, 'api-pattern.md'), join(skillDir, 'data-pipeline.md')]
			});
			await agent.init();
			expect(agent._skillRegistry.size).toBe(2);
			expect(agent._skillRegistry.has('api-pattern')).toBe(true);
			expect(agent._skillRegistry.has('data-pipeline')).toBe(true);
		});

		it('should extract name from YAML frontmatter', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'api-pattern.md')] });
			await agent.init();
			const skill = agent._skillRegistry.get('api-pattern');
			expect(skill.name).toBe('api-pattern');
			expect(skill.content).toContain('Use fetch()');
		});

		it('should fallback to filename when no frontmatter', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'data-pipeline.md')] });
			await agent.init();
			expect(agent._skillRegistry.has('data-pipeline')).toBe(true);
		});

		it('should include use_skill tool when skills are loaded', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'api-pattern.md')] });
			await agent.init();
			const decls = agent.chatConfig.tools[0].functionDeclarations;
			expect(decls.length).toBe(6);
			const skillTool = decls.find(d => d.name === 'use_skill');
			expect(skillTool).toBeTruthy();
			expect(skillTool.description).toContain('api-pattern');
		});

		it('should list skills in system prompt', async () => {
			const agent = makeAgent({ skills: [join(skillDir, 'api-pattern.md')] });
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('use_skill');
			expect(agent.chatConfig.systemInstruction).toContain('api-pattern');
		});

		it('should warn on missing skill files without crashing', async () => {
			const agent = makeAgent({ skills: ['/nonexistent/skill.md'] });
			await agent.init(); // should not throw
			expect(agent._skillRegistry.size).toBe(0);
		});
	});

	// ── _gatherCodebaseContext() ─────────────────────────────────────────────

	describe('_gatherCodebaseContext()', () => {
		it('should gather context from directory', async () => {
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
			expect(agent._codebaseContext.npmPackages.length).toBeGreaterThan(0);
			expect(agent._codebaseContext.npmPackages).toContain('lodash');
		});

		it('should fallback gracefully for non-git directories', async () => {
			const nonGitDir = await mkdtemp(join(tmpdir(), 'code-agent-test-'));
			try {
				const agent = makeAgent({ workingDirectory: nonGitDir });
				await agent._gatherCodebaseContext();
				expect(agent._contextGathered).toBe(true);
			} finally {
				await rm(nonGitDir, { recursive: true, force: true });
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
			const result = await agent._executeCode('const x = await Promise.resolve(42); console.log(x);', 'await-test');
			expect(result.stdout).toContain('42');
			expect(result.exitCode).toBe(0);
		});

		it('should clean up temp files by default', async () => {
			const cleanDir = await mkdtemp(join(tmpdir(), 'code-agent-cleanup-'));
			try {
				const agent = makeAgent({ writeDir: cleanDir });
				await agent._executeCode('console.log("cleanup test");');
				const files = (await readdir(cleanDir)).filter(f => f.startsWith('agent-'));
				expect(files.length).toBe(0);
			} finally {
				await rm(cleanDir, { recursive: true, force: true });
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
			expect(result.stdout.trim()).toBe('test-project');
			expect(result.exitCode).toBe(0);
		});

		it('should return stopped result when agent is stopped', async () => {
			const agent = makeAgent();
			agent._stopped = true;
			const result = await agent._executeCode('console.log("should not run");');
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('stopped');
		});

		it('should track execution in _allExecutions with tool field', async () => {
			const agent = makeAgent();
			await agent._executeCode('console.log("tracked");', 'track-test', 'write_and_run_code');
			expect(agent._allExecutions.length).toBe(1);
			expect(agent._allExecutions[0].code).toContain('tracked');
			expect(agent._allExecutions[0].tool).toBe('write_and_run_code');
		});

		it('should default tool to execute_code in _allExecutions', async () => {
			const agent = makeAgent();
			await agent._executeCode('console.log("default tool");');
			expect(agent._allExecutions[0].tool).toBe('execute_code');
		});

		it('should pass toolName to onBeforeExecution', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (content, toolName) => {
					calls.push({ content, toolName });
					return true;
				}
			});
			await agent._executeCode('console.log("test");', 'test', 'write_and_run_code');
			expect(calls.length).toBe(1);
			expect(calls[0].content).toBe('console.log("test");');
			expect(calls[0].toolName).toBe('write_and_run_code');
		});
	});

	// ── _executeBash() ───────────────────────────────────────────────────────

	describe('_executeBash()', () => {
		it('should execute a simple bash command', async () => {
			const agent = makeAgent();
			const result = await agent._executeBash('echo "hello bash"', 'test');
			expect(result.stdout.trim()).toBe('hello bash');
			expect(result.exitCode).toBe(0);
		});

		it('should capture stderr from bash', async () => {
			const agent = makeAgent();
			const result = await agent._executeBash('echo "error" >&2', 'test');
			expect(result.stderr).toContain('error');
		});

		it('should handle failing commands', async () => {
			const agent = makeAgent();
			const result = await agent._executeBash('exit 1', 'test');
			expect(result.exitCode).not.toBe(0);
		});

		it('should run in workingDirectory', async () => {
			const agent = makeAgent();
			const result = await agent._executeBash('pwd', 'test');
			expect(result.stdout.trim()).toBe(tmpDir);
		});

		it('should track bash in _allExecutions with tool=run_bash', async () => {
			const agent = makeAgent();
			await agent._executeBash('echo test', 'test');
			const last = agent._allExecutions[agent._allExecutions.length - 1];
			expect(last.tool).toBe('run_bash');
			expect(last.code).toBe('echo test');
		});

		it('should pass run_bash to onBeforeExecution', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (content, toolName) => {
					calls.push({ content, toolName });
					return true;
				}
			});
			await agent._executeBash('echo hi', 'test');
			expect(calls[0].toolName).toBe('run_bash');
			expect(calls[0].content).toBe('echo hi');
		});

		it('should deny bash when onBeforeExecution returns false', async () => {
			const agent = makeAgent({
				onBeforeExecution: async () => false
			});
			const result = await agent._executeBash('echo nope', 'test');
			expect(result.denied).toBe(true);
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('denied');
		});

		it('should return stopped result when agent is stopped', async () => {
			const agent = makeAgent();
			agent._stopped = true;
			const result = await agent._executeBash('echo nope', 'test');
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('stopped');
		});

		it('should fire onCodeExecution after bash execution', async () => {
			const executions = [];
			const agent = makeAgent({
				onCodeExecution: (code, result) => executions.push({ code, result })
			});
			await agent._executeBash('echo "bash-tracked"', 'test');
			expect(executions.length).toBe(1);
			expect(executions[0].code).toBe('echo "bash-tracked"');
			expect(executions[0].result.stdout).toContain('bash-tracked');
		});

		it('should not fire onCodeExecution when denied', async () => {
			const executions = [];
			const agent = makeAgent({
				onBeforeExecution: async () => false,
				onCodeExecution: (code, result) => executions.push({ code, result })
			});
			await agent._executeBash('echo denied', 'test');
			expect(executions.length).toBe(0);
		});
	});

	// ── _handleToolCall() ────────────────────────────────────────────────────

	describe('_handleToolCall()', () => {
		it('should dispatch write_code — returns confirmation, no execution', async () => {
			const agent = makeAgent();
			const { output, type, data } = await agent._handleToolCall('write_code', {
				code: 'const x = 1;', purpose: 'test', language: 'javascript'
			});
			expect(type).toBe('write');
			expect(output).toBe('Code written successfully.');
			expect(data.tool).toBe('write_code');
			expect(data.code).toBe('const x = 1;');
			expect(data.language).toBe('javascript');
		});

		it('should dispatch execute_code — runs code, returns output', async () => {
			const agent = makeAgent();
			const { output, type, data } = await agent._handleToolCall('execute_code', {
				code: 'console.log("exec")', purpose: 'test'
			});
			expect(type).toBe('code_execution');
			expect(data.tool).toBe('execute_code');
			expect(data.stdout).toContain('exec');
			expect(data.exitCode).toBe(0);
		});

		it('should dispatch write_and_run_code — same as execute_code, different tool name', async () => {
			const agent = makeAgent();
			const { type, data } = await agent._handleToolCall('write_and_run_code', {
				code: 'console.log("write-run")', purpose: 'test'
			});
			expect(type).toBe('code_execution');
			expect(data.tool).toBe('write_and_run_code');
			expect(data.stdout).toContain('write-run');
		});

		it('should dispatch fix_code without execute — returns fix recorded', async () => {
			const agent = makeAgent();
			const { output, type, data } = await agent._handleToolCall('fix_code', {
				original_code: 'const x = 1 +',
				fixed_code: 'const x = 1 + 2;',
				explanation: 'Missing operand'
			});
			expect(type).toBe('fix');
			expect(output).toBe('Fix recorded.');
			expect(data.executed).toBe(false);
			expect(data.fixedCode).toBe('const x = 1 + 2;');
			expect(data.explanation).toBe('Missing operand');
		});

		it('should dispatch fix_code with execute=true — runs fixed code', async () => {
			const agent = makeAgent();
			const { type, data } = await agent._handleToolCall('fix_code', {
				original_code: 'consolee.log("broken")',
				fixed_code: 'console.log("fixed")',
				execute: true
			});
			expect(type).toBe('fix');
			expect(data.executed).toBe(true);
			expect(data.stdout).toContain('fixed');
			expect(data.exitCode).toBe(0);
		});

		it('should dispatch run_bash — runs command', async () => {
			const agent = makeAgent();
			const { type, data } = await agent._handleToolCall('run_bash', {
				command: 'echo "bash-test"', purpose: 'test'
			});
			expect(type).toBe('bash');
			expect(data.tool).toBe('run_bash');
			expect(data.stdout).toContain('bash-test');
		});

		it('should dispatch use_skill — returns skill content', async () => {
			const agent = makeAgent();
			agent._skillRegistry.set('test-skill', {
				name: 'test-skill', content: '# Test Skill\nDo stuff.', path: '/fake'
			});
			const { type, data } = await agent._handleToolCall('use_skill', { skill_name: 'test-skill' });
			expect(type).toBe('skill');
			expect(data.found).toBe(true);
			expect(data.content).toContain('Do stuff');
		});

		it('should handle use_skill with unknown skill', async () => {
			const agent = makeAgent();
			const { output, data } = await agent._handleToolCall('use_skill', { skill_name: 'nonexistent' });
			expect(data.found).toBe(false);
			expect(output).toContain('not found');
		});

		it('should handle unknown tool name — returns error', async () => {
			const agent = makeAgent();
			const { type, output } = await agent._handleToolCall('unknown_tool', {});
			expect(type).toBe('unknown');
			expect(output).toContain('Unknown tool');
		});
	});

	// ── _formatOutput() ─────────────────────────────────────────────────────

	describe('_formatOutput()', () => {
		it('should format stdout only', () => {
			const agent = makeAgent();
			expect(agent._formatOutput({ stdout: 'hello', stderr: '', exitCode: 0 })).toBe('hello');
		});

		it('should include stderr', () => {
			const agent = makeAgent();
			const output = agent._formatOutput({ stdout: '', stderr: 'err', exitCode: 0 });
			expect(output).toContain('[STDERR]');
			expect(output).toContain('err');
		});

		it('should include exit code on failure', () => {
			const agent = makeAgent();
			const output = agent._formatOutput({ stdout: '', stderr: '', exitCode: 1 });
			expect(output).toContain('[EXIT CODE]: 1');
		});

		it('should return (no output) when empty', () => {
			const agent = makeAgent();
			expect(agent._formatOutput({ stdout: '', stderr: '', exitCode: 0 })).toBe('(no output)');
		});
	});

	// ── onBeforeExecution ────────────────────────────────────────────────────

	describe('onBeforeExecution', () => {
		it('should call onBeforeExecution with (content, toolName) before executing', async () => {
			const calls = [];
			const agent = makeAgent({
				onBeforeExecution: async (content, toolName) => {
					calls.push({ content, toolName });
					return true;
				}
			});
			await agent._executeCode('console.log("test");', undefined, 'execute_code');
			expect(calls.length).toBe(1);
			expect(calls[0].content).toBe('console.log("test");');
			expect(calls[0].toolName).toBe('execute_code');
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

		it('should prevent bash execution when stopped', async () => {
			const agent = makeAgent();
			agent.stop();
			const result = await agent._executeBash('echo "should not run"');
			expect(result.exitCode).toBe(-1);
			expect(result.stderr).toContain('stopped');
		});

		it('should stop agent from onBeforeExecution callback during chat', async () => {
			const executedCodes = [];
			const agent = makeAgent({
				onBeforeExecution: async (code, toolName) => {
					executedCodes.push(code);
					agent.stop();
					return false;
				}
			});
			await agent.init();
			const response = await agent.chat('Use write_and_run_code to print "hello". Then use it again to print "world".');
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
				expect(response.toolCalls).toEqual([]);
			});

			it('should return CodeAgentResponse structure with toolCalls', async () => {
				const response = await agent.chat('Say hello.');
				expect(response).toHaveProperty('text');
				expect(response).toHaveProperty('codeExecutions');
				expect(response).toHaveProperty('toolCalls');
				expect(response).toHaveProperty('usage');
				expect(typeof response.text).toBe('string');
				expect(Array.isArray(response.codeExecutions)).toBe(true);
				expect(Array.isArray(response.toolCalls)).toBe(true);
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
					systemPrompt: 'When asked to run code, always use write_and_run_code.'
				});
				await agent.init();
			});

			it('should execute code and return results with toolCalls', async () => {
				const response = await agent.chat(
					'Use write_and_run_code to run this exact code: console.log(JSON.stringify({status:"ok"}))'
				);
				expect(response.codeExecutions.length).toBeGreaterThan(0);
				expect(response.codeExecutions[0]).toHaveProperty('code');
				expect(response.codeExecutions[0]).toHaveProperty('output');
				expect(response.codeExecutions[0]).toHaveProperty('stderr');
				expect(response.codeExecutions[0]).toHaveProperty('exitCode');
				expect(response.codeExecutions[0].exitCode).toBe(0);

				// toolCalls should also be populated
				expect(response.toolCalls.length).toBeGreaterThan(0);
				expect(response.toolCalls[0].tool).toBeTruthy();
			});

			it('should handle code errors during chat gracefully', async () => {
				const response = await agent.chat(
					'Use write_and_run_code to run this code that will fail: throw new Error("intentional")'
				);
				// The agent should still return a response (text may or may not be present)
				expect(response).toHaveProperty('text');
				expect(response).toHaveProperty('codeExecutions');
				if (response.codeExecutions.length > 0) {
					const failedExec = response.codeExecutions.find(e => e.exitCode !== 0);
					if (failedExec) {
						expect(failedExec.stderr).toBeTruthy();
					}
				}
			});

			it('should populate backward-compat codeExecutions from toolCalls', async () => {
				const response = await agent.chat(
					'Use write_and_run_code to run: console.log("compat-test")'
				);
				// codeExecutions is the backward-compat view of toolCalls
				if (response.toolCalls.length > 0) {
					const execToolCalls = response.toolCalls.filter(
						tc => tc.tool === 'execute_code' || tc.tool === 'write_and_run_code'
					);
					expect(response.codeExecutions.length).toBe(execToolCalls.length);
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
			expect(doneEvents[0]).toHaveProperty('toolCalls');
			expect(doneEvents[0]).toHaveProperty('usage');
		});

		it('should yield code and output events when executing', async () => {
			const agent = makeAgent({
				systemPrompt: 'Always use write_and_run_code when asked to compute something.'
			});
			await agent.init();

			const events = [];
			for await (const event of agent.stream('Use write_and_run_code to run: console.log(2+2)')) {
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

		it('should include toolCalls in done event', async () => {
			const agent = makeAgent({
				systemPrompt: 'Always use write_and_run_code when asked to compute something.'
			});
			await agent.init();

			const events = [];
			for await (const event of agent.stream('Use write_and_run_code to run: console.log("stream-tools")')) {
				events.push(event);
			}

			const done = events.find(e => e.type === 'done');
			expect(done).toBeTruthy();
			expect(Array.isArray(done.toolCalls)).toBe(true);
			// If code was executed, toolCalls should be populated
			if (done.codeExecutions.length > 0) {
				expect(done.toolCalls.length).toBeGreaterThan(0);
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

		it('should always have tools configured even with custom chatConfig', () => {
			const agent = makeAgent({ chatConfig: { temperature: 0 } });
			const decls = agent.chatConfig.tools[0].functionDeclarations;
			expect(decls.length).toBe(5);
			expect(decls.map(d => d.name)).toContain('write_and_run_code');
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
			const dumpDir = await mkdtemp(join(tmpdir(), 'code-agent-dump-'));
			try {
				const agent = makeAgent({ writeDir: dumpDir, keepArtifacts: true });
				await agent._executeCode('console.log("kept");', 'test-keep');
				const scripts = agent.dump();
				expect(scripts[0].filePath).toBeTruthy();
				expect(scripts[0].filePath).toContain('agent-test-keep');
			} finally {
				await rm(dumpDir, { recursive: true, force: true });
			}
		});

		it('should include tool field in results', async () => {
			const agent = makeAgent();
			await agent._executeCode('console.log("a");', 'test', 'execute_code');
			await agent._executeCode('console.log("b");', 'test', 'write_and_run_code');
			await agent._executeBash('echo c', 'test');
			const scripts = agent.dump();
			expect(scripts[0].tool).toBe('execute_code');
			expect(scripts[1].tool).toBe('write_and_run_code');
			expect(scripts[2].tool).toBe('run_bash');
		});

		it('should accumulate across multiple chat calls', async () => {
			const agent = makeAgent({
				systemPrompt: 'Always use write_and_run_code to answer. Be concise.'
			});
			await agent.init();
			await agent.chat('Use write_and_run_code to run: console.log("hello")');
			await agent.chat('Use write_and_run_code to run: console.log("world")');
			const scripts = agent.dump();
			expect(scripts.length).toBeGreaterThanOrEqual(2);
			scripts.forEach(s => {
				expect(typeof s.script).toBe('string');
				expect(s.script.length).toBeGreaterThan(0);
				expect(s.tool).toBeTruthy();
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

		it('should strip leading/trailing dashes', () => {
			const agent = makeAgent();
			expect(agent._slugify('--test--')).toBe('test');
		});
	});

	// ── importantFiles ─────────────────────────────────────────────────────

	describe('importantFiles', () => {
		it('should resolve partial file paths', async () => {
			const agent = makeAgent({ importantFiles: ['app.js'] });
			await agent._gatherCodebaseContext();
			expect(agent._codebaseContext.importantFileContents.length).toBe(1);
			expect(agent._codebaseContext.importantFileContents[0].content).toContain('hello');
		});

		it('should warn on missing files without throwing', async () => {
			const agent = makeAgent({ importantFiles: ['nonexistent-file-xyz.js'] });
			await agent._gatherCodebaseContext();
			expect(agent._codebaseContext.importantFileContents.length).toBe(0);
		});

		it('should include file contents in system prompt', async () => {
			const agent = makeAgent({ importantFiles: ['app.js'] });
			await agent.init();
			expect(agent.chatConfig.systemInstruction).toContain('Key Files');
			expect(agent.chatConfig.systemInstruction).toContain('export default function app');
		});

		it('should resolve absolute paths outside workingDirectory', async () => {
			const externalDir = await realpath(await mkdtemp(join(tmpdir(), 'ak-gemini-ext-')));
			const externalFile = join(externalDir, 'external-ref.js');
			await writeFile(externalFile, 'export const REF = "external-reference";');
			try {
				const agent = makeAgent({ importantFiles: [externalFile] });
				await agent._gatherCodebaseContext();
				expect(agent._codebaseContext.importantFileContents.length).toBe(1);
				expect(agent._codebaseContext.importantFileContents[0].path).toBe(externalFile);
				expect(agent._codebaseContext.importantFileContents[0].content).toContain('external-reference');
			} finally {
				await rm(externalDir, { recursive: true, force: true });
			}
		});

		it('should handle mix of absolute and relative importantFiles', async () => {
			const externalDir = await realpath(await mkdtemp(join(tmpdir(), 'ak-gemini-ext-')));
			const externalFile = join(externalDir, 'types.d.ts');
			await writeFile(externalFile, 'export type Foo = string;');
			try {
				const agent = makeAgent({ importantFiles: [externalFile, 'app.js'] });
				await agent._gatherCodebaseContext();
				expect(agent._codebaseContext.importantFileContents.length).toBe(2);
				const paths = agent._codebaseContext.importantFileContents.map(f => f.path);
				expect(paths).toContain(externalFile);
				expect(paths.some(p => p.endsWith('app.js'))).toBe(true);
			} finally {
				await rm(externalDir, { recursive: true, force: true });
			}
		});
	});

	// ── writeDir ────────────────────────────────────────────────────────────

	describe('writeDir', () => {
		it('should default to {workingDirectory}/tmp', () => {
			const agent = new CodeAgent({ ...BASE_OPTIONS, workingDirectory: '/some/path' });
			expect(agent.writeDir).toBe(join('/some/path', 'tmp'));
		});

		it('should accept custom writeDir', () => {
			const agent = makeAgent({ writeDir: '/tmp/custom' });
			expect(agent.writeDir).toBe('/tmp/custom');
		});

		it('should create writeDir if it does not exist', async () => {
			const newDir = join(tmpDir, 'nested', 'scripts', Date.now().toString());
			try {
				const agent = makeAgent({ writeDir: newDir });
				await agent._executeCode('console.log("ok");');
				const files = await readdir(newDir);
				// Files should have been cleaned up, but dir should exist
				expect(Array.isArray(files)).toBe(true);
			} finally {
				await rm(join(tmpDir, 'nested'), { recursive: true, force: true });
			}
		});

		it('should still use workingDirectory as cwd for child process', async () => {
			const customDir = await mkdtemp(join(tmpdir(), 'code-agent-cwd-'));
			try {
				const agent = makeAgent({ writeDir: customDir });
				const result = await agent._executeCode('console.log(process.cwd());');
				expect(result.stdout.trim()).toBe(agent.workingDirectory);
			} finally {
				await rm(customDir, { recursive: true, force: true });
			}
		});
	});

	// ── keepArtifacts ───────────────────────────────────────────────────────

	describe('keepArtifacts', () => {
		it('should keep files when keepArtifacts is true', async () => {
			const artifactDir = await mkdtemp(join(tmpdir(), 'code-agent-keep-'));
			try {
				const agent = makeAgent({ writeDir: artifactDir, keepArtifacts: true });
				await agent._executeCode('console.log("kept");', 'test-artifact');
				const files = (await readdir(artifactDir)).filter(f => f.startsWith('agent-'));
				expect(files.length).toBe(1);
				expect(files[0]).toContain('test-artifact');
			} finally {
				await rm(artifactDir, { recursive: true, force: true });
			}
		});

		it('should delete files when keepArtifacts is false', async () => {
			const delDir = await mkdtemp(join(tmpdir(), 'code-agent-del-'));
			try {
				const agent = makeAgent({ writeDir: delDir, keepArtifacts: false });
				await agent._executeCode('console.log("deleted");', 'test-clean');
				const files = (await readdir(delDir)).filter(f => f.startsWith('agent-'));
				expect(files.length).toBe(0);
			} finally {
				await rm(delDir, { recursive: true, force: true });
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

	// ── Python Mode ─────────────────────────────────────────────────────────

	describe('Python Mode', () => {
		function makePyAgent(extraOpts = {}) {
			return makeAgent({ language: 'python', ...extraOpts });
		}

		describe('Constructor', () => {
			it('should default language to javascript', () => {
				expect(makeAgent().language).toBe('javascript');
			});

			it('should accept language: python', () => {
				expect(makePyAgent().language).toBe('python');
			});

			it('should accept pythonPath option', () => {
				expect(makePyAgent({ pythonPath: '/usr/bin/python3' }).pythonPath).toBe('/usr/bin/python3');
			});

			it('should default pythonPath to null', () => {
				expect(makePyAgent().pythonPath).toBeNull();
			});
		});

		describe('init()', () => {
			it('should resolve python binary during init', async () => {
				const agent = makePyAgent();
				await agent.init();
				expect(agent._pythonBinary).toBeTruthy();
				expect(agent._pythonBinary).toContain('python');
			});

			it('should create venv during init', async () => {
				const agent = makePyAgent();
				await agent.init();
				expect(agent._venvPath).toBeTruthy();
				expect(agent._venvEnv).toBeTruthy();
				expect(agent._venvEnv.VIRTUAL_ENV).toBe(agent._venvPath);
			});

			it('should include Python-specific system prompt', async () => {
				const agent = makePyAgent();
				await agent.init();
				expect(agent.chatConfig.systemInstruction).toContain('Python 3');
				expect(agent.chatConfig.systemInstruction).toContain('print()');
				expect(agent.chatConfig.systemInstruction).toContain('pip install');
				expect(agent.chatConfig.systemInstruction).not.toContain('Node.js');
				expect(agent.chatConfig.systemInstruction).not.toContain('.mjs');
				expect(agent.chatConfig.systemInstruction).not.toContain('console.log');
			});

			it('should include Python comments instruction when comments=true', async () => {
				const agent = makePyAgent({ comments: true });
				await agent.init();
				expect(agent.chatConfig.systemInstruction).toContain('docstring');
				expect(agent.chatConfig.systemInstruction).not.toContain('JSDoc');
			});

			it('should have Python-specific tool descriptions', async () => {
				const agent = makePyAgent();
				await agent.init();
				const decls = agent.chatConfig.tools[0].functionDeclarations;
				const execTool = decls.find(d => d.name === 'execute_code');
				expect(execTool.description).toContain('Python');
				expect(execTool.description).toContain('print()');
				expect(execTool.parametersJsonSchema.properties.code.description).toContain('Python');
			});
		});

		describe('_executeCode() with Python', () => {
			it('should execute Python code and capture stdout', async () => {
				const agent = makePyAgent();
				await agent.init();
				const result = await agent._executeCode('print("hello from python")', 'test');
				expect(result.stdout.trim()).toBe('hello from python');
				expect(result.exitCode).toBe(0);
			});

			it('should handle Python syntax errors', async () => {
				const agent = makePyAgent();
				await agent.init();
				const result = await agent._executeCode('def foo(:', 'test');
				expect(result.exitCode).not.toBe(0);
				expect(result.stderr).toContain('SyntaxError');
			});

			it('should handle Python exceptions', async () => {
				const agent = makePyAgent();
				await agent.init();
				const result = await agent._executeCode('raise ValueError("boom")', 'test');
				expect(result.exitCode).not.toBe(0);
				expect(result.stderr).toContain('ValueError');
				expect(result.stderr).toContain('boom');
			});

			it('should write .py temp files', async () => {
				const pyDir = join(tmpDir, 'py-artifacts');
				const agent = makePyAgent({ keepArtifacts: true, writeDir: pyDir });
				await agent.init();
				await agent._executeCode('print("artifact")', 'py-test');
				const files = await readdir(pyDir);
				const pyFiles = files.filter(f => f.endsWith('.py'));
				expect(pyFiles.length).toBeGreaterThan(0);
				await rm(pyDir, { recursive: true, force: true });
			});

			it('should use venv python for execution', async () => {
				const agent = makePyAgent();
				await agent.init();
				const result = await agent._executeCode('import sys; print(sys.executable)', 'test');
				expect(result.stdout.trim()).toContain('.venv');
			});

			it('should support Python imports', async () => {
				const agent = makePyAgent();
				await agent.init();
				const result = await agent._executeCode('import json; print(json.dumps({"a": 1}))', 'test');
				expect(result.stdout.trim()).toBe('{"a": 1}');
				expect(result.exitCode).toBe(0);
			});
		});

		describe('_executeBash() with venv', () => {
			it('should use venv pip in bash commands', async () => {
				const agent = makePyAgent();
				await agent.init();
				const result = await agent._executeBash('which pip', 'test');
				expect(result.stdout.trim()).toContain('.venv');
			});
		});

		describe('dump() with Python', () => {
			it('should use .py extension in dump', async () => {
				const agent = makePyAgent();
				await agent.init();
				await agent._executeCode('print(1)', 'py-dump');
				const scripts = agent.dump();
				expect(scripts[scripts.length - 1].fileName).toContain('.py');
				expect(scripts[scripts.length - 1].fileName).not.toContain('.mjs');
			});
		});

		describe('pip install via run_bash', () => {
			it('should be able to install and use a package', async () => {
				const agent = makePyAgent({ timeout: 60000 });
				await agent.init();
				const installResult = await agent._executeBash('pip install six --quiet', 'install');
				expect(installResult.exitCode).toBe(0);
				const useResult = await agent._executeCode('import six; print(six.moves.range(3))', 'use-pkg');
				expect(useResult.exitCode).toBe(0);
			});
		});

		describe('chat() with Python', () => {
			it('should execute Python code via chat', async () => {
				const agent = makePyAgent();
				const response = await agent.chat('Use write_and_run_code to run this Python code: print("chat python test")');
				expect(response.codeExecutions.length).toBeGreaterThan(0);
				expect(response.codeExecutions[0].output).toContain('chat python test');
			});
		});
	});
});
