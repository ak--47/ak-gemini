import dotenv from 'dotenv';
dotenv.config();
import { RagAgent } from '../index.js';
import { join } from 'node:path';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const { GEMINI_API_KEY } = process.env;
delete process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run tests");

const BASE_OPTIONS = {
	modelName: 'gemini-2.0-flash-lite',
	apiKey: GEMINI_API_KEY,
	logLevel: 'warn'
};

let testDir;
let testFile;
let localTextFile;

beforeAll(async () => {
	testDir = await mkdtemp(join(tmpdir(), 'rag-agent-test-'));
	testFile = join(testDir, 'test-doc.md');
	await writeFile(testFile, `# Test Document

## Overview
This document is about the fictional Zephyr API.

## Authentication
The Zephyr API uses bearer tokens for authentication.
Include the token in the Authorization header: \`Authorization: Bearer <token>\`.

## Endpoints
- GET /api/users — List all users
- POST /api/users — Create a new user
- GET /api/users/:id — Get a user by ID

## Rate Limiting
The API allows 100 requests per minute per API key.
`);

	localTextFile = join(testDir, 'local-doc.md');
	await writeFile(localTextFile, `# Widget Manual

## Overview
The Gizmo Widget v3.2 supports three modes: turbo, eco, and silent.

## Configuration
Set the mode via the config file at \`/etc/gizmo/widget.yaml\`.
Default timeout is 45 seconds.

## Troubleshooting
If the widget enters failsafe mode, check the power supply voltage (must be 12V DC).
`);
});

afterAll(async () => {
	if (testDir) await rm(testDir, { recursive: true, force: true });
});

describe('RagAgent', () => {

	// ── Constructor ──────────────────────────────────────────────────────────

	describe('Constructor', () => {
		it('should create with default options', () => {
			const agent = new RagAgent({ ...BASE_OPTIONS });
			expect(agent.modelName).toBe('gemini-2.0-flash-lite');
			expect(agent.remoteFiles).toEqual([]);
			expect(agent.localFiles).toEqual([]);
			expect(agent.localData).toEqual([]);
			expect(agent._uploadedRemoteFiles).toEqual([]);
			expect(agent._localFileContents).toEqual([]);
			expect(agent._initialized).toBe(false);
			expect(agent.systemPrompt).toContain('Answer questions based on the provided documents');
		});

		it('should accept all context source types', () => {
			const data = [{ name: 'test', data: { x: 1 } }];
			const agent = new RagAgent({
				...BASE_OPTIONS,
				remoteFiles: ['/tmp/a.pdf'],
				localFiles: ['/tmp/b.md'],
				localData: data,
				systemPrompt: 'Custom prompt.'
			});
			expect(agent.remoteFiles).toEqual(['/tmp/a.pdf']);
			expect(agent.localFiles).toEqual(['/tmp/b.md']);
			expect(agent.localData).toBe(data);
			expect(agent.systemPrompt).toBe('Custom prompt.');
		});
	});

	// ── Local Files ─────────────────────────────────────────────────────────

	describe('localFiles', () => {
		it('should read local files and seed content into history', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [localTextFile]
			});

			await agent.init();
			expect(agent._initialized).toBe(true);
			expect(agent._localFileContents).toHaveLength(1);
			expect(agent._localFileContents[0].name).toBe('local-doc.md');
			expect(agent._localFileContents[0].content).toContain('Gizmo Widget');

			const history = agent.getHistory();
			expect(history.length).toBeGreaterThanOrEqual(2);
		});

		it('should answer questions grounded in local file content', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [localTextFile]
			});

			const result = await agent.chat('What modes does the Gizmo Widget support?');
			expect(result.text).toBeTruthy();
			expect(result.text.toLowerCase()).toMatch(/turbo|eco|silent/);
			expect(result.usage).toBeTruthy();
			expect(result.usage.promptTokens).toBeGreaterThan(0);
		}, 30_000);

		it('should add local files and reinitialize', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [localTextFile]
			});
			await agent.init();
			expect(agent._localFileContents).toHaveLength(1);

			const extraFile = join(testDir, 'extra-local.txt');
			await writeFile(extraFile, 'The maximum widget count is 42.');

			await agent.addLocalFiles([extraFile]);
			expect(agent.localFiles).toHaveLength(2);
			expect(agent._localFileContents).toHaveLength(2);
		});
	});

	// ── Local Data ──────────────────────────────────────────────────────────

	describe('localData', () => {
		it('should serialize objects into context', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localData: [
					{ name: 'employees', data: [
						{ id: 1, name: 'Alice', role: 'engineer' },
						{ id: 2, name: 'Bob', role: 'designer' },
						{ id: 3, name: 'Carol', role: 'manager' }
					]}
				]
			});

			const result = await agent.chat('Who is the designer?');
			expect(result.text).toBeTruthy();
			expect(result.text.toLowerCase()).toContain('bob');
		}, 30_000);

		it('should handle string data without double-serializing', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localData: [
					{ name: 'note', data: 'The secret code is ALPHA-7' }
				]
			});

			const result = await agent.chat('What is the secret code?');
			expect(result.text).toBeTruthy();
			expect(result.text).toMatch(/ALPHA-7/);
		}, 30_000);

		it('should add data and reinitialize', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localData: [{ name: 'a', data: { x: 1 } }]
			});
			await agent.init();

			await agent.addLocalData([{ name: 'b', data: { y: 2 } }]);
			expect(agent.localData).toHaveLength(2);
		});
	});

	// ── Remote Files (via Files API) ────────────────────────────────────────

	describe('remoteFiles', () => {
		it('should upload remote files and seed chat history', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				remoteFiles: [testFile]
			});

			await agent.init();
			expect(agent._initialized).toBe(true);
			expect(agent._uploadedRemoteFiles).toHaveLength(1);
			expect(agent._uploadedRemoteFiles[0].originalPath).toContain('test-doc.md');
			expect(agent._uploadedRemoteFiles[0].uri).toBeTruthy();

			const history = agent.getHistory();
			expect(history.length).toBeGreaterThanOrEqual(2);
		}, 30_000);

		it('should be idempotent (skip if already initialized)', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				remoteFiles: [testFile]
			});

			await agent.init();
			const firstFiles = agent._uploadedRemoteFiles;
			await agent.init();
			expect(agent._uploadedRemoteFiles).toBe(firstFiles);
		}, 30_000);

		it('should answer questions grounded in remote document', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				remoteFiles: [testFile]
			});

			const result = await agent.chat('What authentication method does the Zephyr API use?');
			expect(result.text).toBeTruthy();
			expect(result.text.toLowerCase()).toMatch(/bearer|token/);
			expect(result.usage).toBeTruthy();
		}, 30_000);

		it('should add remote files and reinitialize', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				remoteFiles: [testFile]
			});
			await agent.init();
			expect(agent._uploadedRemoteFiles).toHaveLength(1);

			const extraFile = join(testDir, 'extra-remote.txt');
			await writeFile(extraFile, 'Extra document content about widgets.');

			await agent.addRemoteFiles([extraFile]);
			expect(agent.remoteFiles).toHaveLength(2);
			expect(agent._uploadedRemoteFiles).toHaveLength(2);
		}, 30_000);
	});

	// ── Streaming ────────────────────────────────────────────────────────────

	describe('stream()', () => {
		it('should yield text and done events', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [localTextFile]
			});

			const events = [];
			for await (const event of agent.stream('What is the default timeout?')) {
				events.push(event);
			}

			const textEvents = events.filter(e => e.type === 'text');
			const doneEvents = events.filter(e => e.type === 'done');

			expect(textEvents.length).toBeGreaterThan(0);
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0].fullText).toBeTruthy();
			expect(doneEvents[0].fullText.toLowerCase()).toMatch(/45|timeout/);
		}, 30_000);
	});

	// ── getContext() ─────────────────────────────────────────────────────────

	describe('getContext()', () => {
		it('should return empty context before init', () => {
			const agent = new RagAgent({ ...BASE_OPTIONS });
			const ctx = agent.getContext();
			expect(ctx.remoteFiles).toEqual([]);
			expect(ctx.localFiles).toEqual([]);
			expect(ctx.localData).toEqual([]);
		});

		it('should return metadata for all source types', async () => {
			const agent = new RagAgent({
				...BASE_OPTIONS,
				localFiles: [localTextFile],
				localData: [
					{ name: 'users', data: [{ id: 1 }] },
					{ name: 'config', data: { timeout: 30 } },
					{ name: 'note', data: 'hello' }
				]
			});

			await agent.init();
			const ctx = agent.getContext();

			expect(ctx.remoteFiles).toEqual([]);

			expect(ctx.localFiles).toHaveLength(1);
			expect(ctx.localFiles[0].name).toBe('local-doc.md');
			expect(ctx.localFiles[0].path).toContain('local-doc.md');
			expect(ctx.localFiles[0].size).toBeGreaterThan(0);

			expect(ctx.localData).toHaveLength(3);
			expect(ctx.localData[0]).toEqual({ name: 'users', type: 'array' });
			expect(ctx.localData[1]).toEqual({ name: 'config', type: 'object' });
			expect(ctx.localData[2]).toEqual({ name: 'note', type: 'string' });
		});
	});
});
