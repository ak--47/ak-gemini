/**
 * @fileoverview CodeAgent class — AI agent that writes and executes code.
 * Instead of traditional tool-calling with many round-trips, the model gets
 * a single `execute_code` tool and writes JavaScript that can do everything
 * (read files, write files, run commands) in a single script. Output feeds
 * back, and the model decides what to do next.
 *
 * Inspired by the "code mode" philosophy: LLMs are better at writing code
 * to call APIs than at calling APIs directly via tool-calling.
 */

import BaseGemini from './base.js';
import log from './logger.js';
import { execFile } from 'node:child_process';
import { writeFile, unlink, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * @typedef {import('./types').CodeAgentOptions} CodeAgentOptions
 * @typedef {import('./types').CodeAgentResponse} CodeAgentResponse
 * @typedef {import('./types').CodeAgentStreamEvent} CodeAgentStreamEvent
 */

const MAX_OUTPUT_CHARS = 50_000;
const MAX_FILE_TREE_LINES = 500;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', 'build', '__pycache__']);

/**
 * AI agent that writes and executes JavaScript code autonomously.
 *
 * During init, gathers codebase context (file tree + key files) and injects it
 * into the system prompt. The model uses the `execute_code` tool to run scripts
 * in a Node.js child process that inherits the parent's environment variables.
 *
 * @example
 * ```javascript
 * import { CodeAgent } from 'ak-gemini';
 *
 * const agent = new CodeAgent({
 *   workingDirectory: '/path/to/my/project',
 *   onCodeExecution: (code, output) => {
 *     console.log('Executed:', code.slice(0, 100));
 *     console.log('Output:', output.stdout);
 *   }
 * });
 *
 * const result = await agent.chat('List all TODO comments in the codebase');
 * console.log(result.text);
 * console.log(`Ran ${result.codeExecutions.length} scripts`);
 * ```
 */
class CodeAgent extends BaseGemini {
	/**
	 * @param {CodeAgentOptions} [options={}]
	 */
	constructor(options = {}) {
		if (options.systemPrompt === undefined) {
			options = { ...options, systemPrompt: '' };
		}

		super(options);

		// ── Agent config ──
		this.workingDirectory = options.workingDirectory || process.cwd();
		this.maxRounds = options.maxRounds || 10;
		this.timeout = options.timeout || 30_000;
		this.onBeforeExecution = options.onBeforeExecution || null;
		this.onCodeExecution = options.onCodeExecution || null;

		// ── Internal state ──
		this._codebaseContext = null;
		this._contextGathered = false;
		this._stopped = false;
		this._activeProcess = null;
		this._userSystemPrompt = options.systemPrompt || '';
		this._allExecutions = [];

		// ── Single tool: execute_code ──
		this.chatConfig.tools = [{
			functionDeclarations: [{
				name: 'execute_code',
				description: 'Execute JavaScript code in a Node.js child process. The code has access to all Node.js built-in modules (fs, path, child_process, http, etc.). Use console.log() to produce output that will be returned to you. The code runs in the working directory with the same environment variables as the parent process.',
				parametersJsonSchema: {
					type: 'object',
					properties: {
						code: {
							type: 'string',
							description: 'JavaScript code to execute. Use console.log() for output. You can import any built-in Node.js module.'
						}
					},
					required: ['code']
				}
			}]
		}];
		this.chatConfig.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };

		log.debug(`CodeAgent created for directory: ${this.workingDirectory}`);
	}

	// ── Init ─────────────────────────────────────────────────────────────────

	/**
	 * Initialize the agent: gather codebase context, build system prompt,
	 * and create the chat session.
	 * @param {boolean} [force=false]
	 */
	async init(force = false) {
		if (this.chatSession && !force) return;

		// Gather codebase context
		if (!this._contextGathered || force) {
			await this._gatherCodebaseContext();
		}

		// Build augmented system prompt
		const systemPrompt = this._buildSystemPrompt();
		this.chatConfig.systemInstruction = systemPrompt;

		await super.init(force);
	}

	// ── Context Gathering ────────────────────────────────────────────────────

	/**
	 * Gather file tree and key file contents from the working directory.
	 * @private
	 */
	async _gatherCodebaseContext() {
		let fileTree = '';

		// Get file tree
		try {
			fileTree = await this._getFileTreeGit();
		} catch {
			log.debug('git ls-files failed, falling back to readdir');
			fileTree = await this._getFileTreeReaddir(this.workingDirectory, 0, 3);
		}

		// Truncate file tree
		const lines = fileTree.split('\n');
		if (lines.length > MAX_FILE_TREE_LINES) {
			const truncated = lines.slice(0, MAX_FILE_TREE_LINES).join('\n');
			fileTree = `${truncated}\n... (${lines.length - MAX_FILE_TREE_LINES} more files)`;
		}

		// Extract npm package names (lightweight — just the keys)
		let npmPackages = [];
		try {
			const pkgPath = join(this.workingDirectory, 'package.json');
			const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
			npmPackages = [
				...Object.keys(pkg.dependencies || {}),
				...Object.keys(pkg.devDependencies || {})
			];
		} catch { /* no package.json */ }

		this._codebaseContext = { fileTree, npmPackages };
		this._contextGathered = true;
	}

	/**
	 * Get file tree using git ls-files.
	 * @private
	 * @returns {Promise<string>}
	 */
	async _getFileTreeGit() {
		return new Promise((resolve, reject) => {
			execFile('git', ['ls-files'], {
				cwd: this.workingDirectory,
				timeout: 5000,
				maxBuffer: 5 * 1024 * 1024
			}, (err, stdout) => {
				if (err) return reject(err);
				resolve(stdout.trim());
			});
		});
	}

	/**
	 * Fallback file tree via recursive readdir.
	 * @private
	 * @param {string} dir
	 * @param {number} depth
	 * @param {number} maxDepth
	 * @returns {Promise<string>}
	 */
	async _getFileTreeReaddir(dir, depth, maxDepth) {
		if (depth >= maxDepth) return '';
		const entries = [];
		try {
			const items = await readdir(dir, { withFileTypes: true });
			for (const item of items) {
				if (IGNORE_DIRS.has(item.name)) continue;
				if (item.name.startsWith('.') && depth === 0 && item.isDirectory()) continue;

				const relativePath = join(dir, item.name).replace(this.workingDirectory + '/', '');
				if (item.isFile()) {
					entries.push(relativePath);
				} else if (item.isDirectory()) {
					entries.push(relativePath + '/');
					const subEntries = await this._getFileTreeReaddir(join(dir, item.name), depth + 1, maxDepth);
					if (subEntries) entries.push(subEntries);
				}
			}
		} catch {
			// Permission errors, etc. — skip
		}
		return entries.join('\n');
	}

	/**
	 * Build the full system prompt with codebase context.
	 * @private
	 * @returns {string}
	 */
	_buildSystemPrompt() {
		const { fileTree, npmPackages } = this._codebaseContext || { fileTree: '', npmPackages: [] };

		let prompt = `You are a coding agent working in ${this.workingDirectory}.

## Instructions
- Use the execute_code tool to accomplish tasks by writing JavaScript code
- Your code runs in a Node.js child process with access to all built-in modules
- IMPORTANT: Your code runs as an ES module (.mjs). Use import syntax, NOT require():
  - import fs from 'fs';
  - import path from 'path';
  - import { execSync } from 'child_process';
- Use console.log() to produce output — that's how results are returned to you
- Write efficient scripts that do multiple things per execution when possible
- For parallel async operations, use Promise.all():
  const [a, b] = await Promise.all([fetchA(), fetchB()]);
- Read files with fs.readFileSync() when you need to understand their contents
- Handle errors in your scripts with try/catch so you get useful error messages
- Top-level await is supported
- The working directory is: ${this.workingDirectory}`;

		if (fileTree) {
			prompt += `\n\n## File Tree\n\`\`\`\n${fileTree}\n\`\`\``;
		}

		if (npmPackages.length > 0) {
			prompt += `\n\n## Available Packages\nThese npm packages are installed and can be imported: ${npmPackages.join(', ')}`;
		}

		if (this._userSystemPrompt) {
			prompt += `\n\n## Additional Instructions\n${this._userSystemPrompt}`;
		}

		return prompt;
	}

	// ── Code Execution ───────────────────────────────────────────────────────

	/**
	 * Execute a JavaScript code string in a child process.
	 * @private
	 * @param {string} code - JavaScript code to execute
	 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, denied?: boolean}>}
	 */
	async _executeCode(code) {
		// Check if stopped
		if (this._stopped) {
			return { stdout: '', stderr: 'Agent was stopped', exitCode: -1 };
		}

		// Check onBeforeExecution gate
		if (this.onBeforeExecution) {
			try {
				const allowed = await this.onBeforeExecution(code);
				if (allowed === false) {
					return { stdout: '', stderr: 'Execution denied by onBeforeExecution callback', exitCode: -1, denied: true };
				}
			} catch (e) {
				log.warn(`onBeforeExecution callback error: ${e.message}`);
			}
		}

		const tempFile = join(this.workingDirectory, `.code-agent-tmp-${randomUUID()}.mjs`);

		try {
			// Write code to temp file
			await writeFile(tempFile, code, 'utf-8');

			// Execute in child process
			const result = await new Promise((resolve) => {
				const child = execFile('node', [tempFile], {
					cwd: this.workingDirectory,
					timeout: this.timeout,
					env: process.env,
					maxBuffer: 10 * 1024 * 1024
				}, (err, stdout, stderr) => {
					this._activeProcess = null;
					if (err) {
						resolve({
							stdout: err.stdout || stdout || '',
							stderr: (err.stderr || stderr || '') + (err.killed ? '\n[EXECUTION TIMED OUT]' : ''),
							exitCode: err.code || 1
						});
					} else {
						resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: 0 });
					}
				});
				this._activeProcess = child;
			});

			// Truncate output
			const totalLen = result.stdout.length + result.stderr.length;
			if (totalLen > MAX_OUTPUT_CHARS) {
				const half = Math.floor(MAX_OUTPUT_CHARS / 2);
				if (result.stdout.length > half) {
					result.stdout = result.stdout.slice(0, half) + '\n...[OUTPUT TRUNCATED]';
				}
				if (result.stderr.length > half) {
					result.stderr = result.stderr.slice(0, half) + '\n...[STDERR TRUNCATED]';
				}
			}

			// Track execution
			this._allExecutions.push({ code, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode });

			// Fire notification callback
			if (this.onCodeExecution) {
				try { this.onCodeExecution(code, result); }
				catch (e) { log.warn(`onCodeExecution callback error: ${e.message}`); }
			}

			return result;
		} finally {
			// Cleanup temp file
			try { await unlink(tempFile); }
			catch { /* file may already be gone */ }
		}
	}

	/**
	 * Format execution result as a string for the model.
	 * @private
	 * @param {{stdout: string, stderr: string, exitCode: number}} result
	 * @returns {string}
	 */
	_formatOutput(result) {
		let output = '';
		if (result.stdout) output += result.stdout;
		if (result.stderr) output += (output ? '\n' : '') + `[STDERR]: ${result.stderr}`;
		if (result.exitCode !== 0) output += (output ? '\n' : '') + `[EXIT CODE]: ${result.exitCode}`;
		return output || '(no output)';
	}

	// ── Non-Streaming Chat ───────────────────────────────────────────────────

	/**
	 * Send a message and get a complete response (non-streaming).
	 * Automatically handles the code execution loop.
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @param {Record<string, string>} [opts.labels] - Per-message billing labels
	 * @returns {Promise<CodeAgentResponse>} Response with text, codeExecutions, and usage
	 */
	async chat(message, opts = {}) {
		if (!this.chatSession) await this.init();
		this._stopped = false;

		const codeExecutions = [];

		let response = await this.chatSession.sendMessage({ message });

		for (let round = 0; round < this.maxRounds; round++) {
			if (this._stopped) break;

			const functionCalls = response.functionCalls;
			if (!functionCalls || functionCalls.length === 0) break;

			const results = [];
			for (const call of functionCalls) {
				if (this._stopped) break;

				const code = call.args?.code || '';
				const result = await this._executeCode(code);

				codeExecutions.push({
					code,
					output: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode
				});

				results.push({
					id: call.id,
					name: call.name,
					result: this._formatOutput(result)
				});
			}

			if (this._stopped) break;

			// Send function responses back to the model
			response = await this.chatSession.sendMessage({
				message: results.map(r => ({
					functionResponse: {
						id: r.id,
						name: r.name,
						response: { output: r.result }
					}
				}))
			});
		}

		this._captureMetadata(response);

		this._cumulativeUsage = {
			promptTokens: this.lastResponseMetadata.promptTokens,
			responseTokens: this.lastResponseMetadata.responseTokens,
			totalTokens: this.lastResponseMetadata.totalTokens,
			attempts: 1
		};

		return {
			text: response.text || '',
			codeExecutions,
			usage: this.getLastUsage()
		};
	}

	// ── Streaming ────────────────────────────────────────────────────────────

	/**
	 * Send a message and stream the response as events.
	 * Automatically handles the code execution loop between streamed rounds.
	 *
	 * Event types:
	 * - `text` — A chunk of the agent's text response
	 * - `code` — The agent is about to execute code
	 * - `output` — Code finished executing
	 * - `done` — The agent finished
	 *
	 * @param {string} message - The user's message
	 * @param {Object} [opts={}] - Per-message options
	 * @yields {CodeAgentStreamEvent}
	 */
	async *stream(message, opts = {}) {
		if (!this.chatSession) await this.init();
		this._stopped = false;

		const codeExecutions = [];
		let fullText = '';

		let streamResponse = await this.chatSession.sendMessageStream({ message });

		for (let round = 0; round < this.maxRounds; round++) {
			if (this._stopped) break;

			const functionCalls = [];

			// Consume the stream
			for await (const chunk of streamResponse) {
				if (chunk.functionCalls) {
					functionCalls.push(...chunk.functionCalls);
				} else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
					const text = chunk.candidates[0].content.parts[0].text;
					fullText += text;
					yield { type: 'text', text };
				}
			}

			// No function calls — we're done
			if (functionCalls.length === 0) {
				yield {
					type: 'done',
					fullText,
					codeExecutions,
					usage: this.getLastUsage()
				};
				return;
			}

			// Execute code sequentially so we can yield events
			const results = [];
			for (const call of functionCalls) {
				if (this._stopped) break;

				const code = call.args?.code || '';
				yield { type: 'code', code };

				const result = await this._executeCode(code);

				codeExecutions.push({
					code,
					output: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode
				});

				yield {
					type: 'output',
					code,
					stdout: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode
				};

				results.push({
					id: call.id,
					name: call.name,
					result: this._formatOutput(result)
				});
			}

			if (this._stopped) break;

			// Send function responses back and get next stream
			streamResponse = await this.chatSession.sendMessageStream({
				message: results.map(r => ({
					functionResponse: {
						id: r.id,
						name: r.name,
						response: { output: r.result }
					}
				}))
			});
		}

		// Max rounds reached or stopped
		yield {
			type: 'done',
			fullText,
			codeExecutions,
			usage: this.getLastUsage(),
			warning: this._stopped ? 'Agent was stopped' : 'Max tool rounds reached'
		};
	}

	// ── Dump ─────────────────────────────────────────────────────────────────

	/**
	 * Returns all code scripts the agent has written across all chat/stream calls.
	 * @returns {Array<{fileName: string, script: string}>}
	 */
	dump() {
		return this._allExecutions.map((exec, i) => ({
			fileName: `script-${i + 1}.mjs`,
			script: exec.code
		}));
	}

	// ── Stop ─────────────────────────────────────────────────────────────────

	/**
	 * Stop the agent before the next code execution.
	 * If a child process is currently running, it will be killed.
	 */
	stop() {
		this._stopped = true;
		if (this._activeProcess) {
			try { this._activeProcess.kill('SIGTERM'); }
			catch { /* process may already be gone */ }
		}
		log.info('CodeAgent stopped');
	}
}

export default CodeAgent;
