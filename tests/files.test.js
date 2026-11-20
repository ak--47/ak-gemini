/**
 * @fileoverview Offline tests for the 3.1.0 file primitives (files.js, the
 * per-call `files` option, FileAgent). No network: every SDK client is a stub.
 */

import { jest } from '@jest/globals';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	MIME_TYPES, LEGACY_MIME_TYPES, READ_FORMATS, WRITE_FORMATS, INLINE_LIMIT_BYTES, HTTPS_URI_SUPPORT,
	writeFormatsFor, UnsupportedFormatError, mimeFromName, toParts, waitForFileActive,
	pcmToWav, parsePcmMime, wavToPcm
} from '../files.js';

const DIR = mkdtempSync(join(tmpdir(), 'akg-files-'));
const fx = (name, content) => { const p = join(DIR, name); writeFileSync(p, content); return p; };

const MD = fx('a.md', '# hi');
const PDF = fx('doc.pdf', Buffer.alloc(1000, 1));
const PNG = fx('pic.png', Buffer.alloc(1024, 2));
const PNG_UPPER = fx('photo.PNG', Buffer.alloc(10, 2));
const BIG1 = fx('big1.pdf', Buffer.alloc(600, 3));
const BIG2 = fx('big2.pdf', Buffer.alloc(400, 3));
const BIG3 = fx('big3.pdf', Buffer.alloc(300, 3));
const XLSX = fx('sheet.xlsx', 'x');
const DOCX = fx('legacy.docx', 'x');

function stubClient(overrides = {}) {
	return {
		files: {
			upload: jest.fn(async ({ config }) => ({ name: 'files/x', uri: 'https://u/x', mimeType: config.mimeType, displayName: config.displayName, sizeBytes: '1', state: 'ACTIVE' })),
			get: jest.fn(),
			...overrides
		}
	};
}

describe('formats and UnsupportedFormatError', () => {
	it('lists the Vertex write set exactly as the spec message shape', () => {
		const err = new UnsupportedFormatError('xlsx', 'write', { vertexai: true, who: 'FileAgent' });
		expect(err.message).toBe('Cannot write ".xlsx". FileAgent (Vertex) writes: .txt .md .csv .json .yaml .yml .html .xml .svg .png .jpg .jpeg .wav');
		expect(err.supported).toEqual(writeFormatsFor(true));
		expect(err.format).toBe('xlsx');
		expect(err.direction).toBe('write');
		expect(err.backend).toBe('vertex');
		expect(err).toBeInstanceOf(Error);
	});

	it('explains the Gemini API image limit when a Vertex-only image format is asked for', () => {
		const err = new UnsupportedFormatError('png', 'write', { vertexai: false, who: 'FileAgent' });
		expect(err.message).toContain('FileAgent (Gemini API) writes:');
		expect(err.message).toContain('The Gemini API writes images as .jpg .jpeg only; Vertex also writes .png.');
		expect(err.supported).toEqual(writeFormatsFor(false));
	});

	it('names the read direction', () => {
		const err = new UnsupportedFormatError('docx', 'read', { vertexai: true });
		expect(err.direction).toBe('read');
		expect(err.message).toMatch(/^Cannot read "\.docx"\. ak-gemini reads: \.txt /);
	});

	it('keeps the strict and legacy MIME maps apart', () => {
		expect(MIME_TYPES['.docx']).toBeUndefined();
		expect(MIME_TYPES['.gif']).toBeUndefined();
		expect(LEGACY_MIME_TYPES['.docx']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		expect(READ_FORMATS).toContain('.pdf');
		expect(READ_FORMATS).not.toContain('.doc');
		expect(WRITE_FORMATS.image.gemini).toEqual(['jpg', 'jpeg']);
		expect(WRITE_FORMATS.image.vertex).toEqual(['png', 'jpg', 'jpeg']);
		expect(INLINE_LIMIT_BYTES).toEqual({ gemini: 100_000_000, vertex: 256_000_000 });
		expect(HTTPS_URI_SUPPORT).toEqual({ gemini: true, vertex: true });
	});

	it('reads the MIME from a URL pathname, not its query string', () => {
		expect(mimeFromName('https://h/a.pdf?X-Goog-Signature=abc')).toBe('application/pdf');
		expect(mimeFromName('photo.PNG')).toBe('image/png');
		expect(mimeFromName('noext')).toBeNull();
	});
});

describe('toParts rows', () => {
	const gem = { vertexai: false };
	const vtx = { vertexai: true };

	it('sends a text path as a labelled text part', async () => {
		const { parts } = await toParts([MD], stubClient(), gem);
		expect(parts).toEqual([{ text: '--- File: a.md ---\n# hi' }]);
	});

	it('inlines a small binary path', async () => {
		const { parts, uploaded } = await toParts(PDF, stubClient(), vtx);
		expect(parts[0].inlineData.mimeType).toBe('application/pdf');
		expect(Buffer.from(parts[0].inlineData.data, 'base64').length).toBe(1000);
		expect(uploaded).toEqual([]);
	});

	it('uploads a binary over the limit on the Gemini API', async () => {
		const client = stubClient();
		const { parts, uploaded } = await toParts([PDF], client, { ...gem, inlineLimit: 500 });
		expect(client.files.upload).toHaveBeenCalledTimes(1);
		expect(parts).toEqual([{ fileData: { fileUri: 'https://u/x', mimeType: 'application/pdf' } }]);
		expect(uploaded).toHaveLength(1);
		expect(uploaded[0]).toMatchObject({ name: 'files/x', uri: 'https://u/x', mimeType: 'application/pdf' });
	});

	it('throws on Vertex for a binary over the limit, naming gs://', async () => {
		await expect(toParts([PDF], stubClient(), { ...vtx, inlineLimit: 500 })).rejects.toThrow(/gs:\/\//);
	});

	it('sends gs:// as fileData on Vertex', async () => {
		const { parts } = await toParts(['gs://b/a.pdf'], stubClient(), vtx);
		expect(parts).toEqual([{ fileData: { fileUri: 'gs://b/a.pdf', mimeType: 'application/pdf' } }]);
	});

	it('rejects gs:// on the Gemini API before any request', async () => {
		const client = stubClient();
		await expect(toParts(['gs://b/a.pdf'], client, gem)).rejects.toThrow(/gs:\/\//);
		expect(client.files.upload).not.toHaveBeenCalled();
	});

	it('sends https:// as fileData on both backends, with an explicit mimeType object', async () => {
		for (const o of [gem, vtx]) {
			const { parts } = await toParts(['https://h/a.png', { uri: 'https://h/blob', mimeType: 'application/pdf' }], stubClient(), o);
			expect(parts).toEqual([
				{ fileData: { fileUri: 'https://h/a.png', mimeType: 'image/png' } },
				{ fileData: { fileUri: 'https://h/blob', mimeType: 'application/pdf' } }
			]);
		}
	});

	it('takes the MIME of a signed https URL from its pathname', async () => {
		const { parts } = await toParts(['https://h/a.pdf?X-Goog-Signature=abc'], stubClient(), vtx);
		expect(parts[0].fileData.mimeType).toBe('application/pdf');
	});

	it('decodes a text-MIME buffer to a text part', async () => {
		const { parts } = await toParts([{ data: Buffer.from('a,b'), mimeType: 'text/csv', name: 'x.csv' }], stubClient(), vtx);
		expect(parts).toEqual([{ text: '--- File: x.csv ---\na,b' }]);
	});

	it('inlines a binary buffer and a base64 string', async () => {
		const { parts } = await toParts([
			{ data: Buffer.from([1, 2, 3]), mimeType: 'image/png' },
			{ data: 'AQID', mimeType: 'image/png' }
		], stubClient(), vtx);
		expect(parts).toEqual([
			{ inlineData: { data: 'AQID', mimeType: 'image/png' } },
			{ inlineData: { data: 'AQID', mimeType: 'image/png' } }
		]);
	});

	it('uploads a buffer over the limit on the Gemini API and throws on Vertex', async () => {
		const client = stubClient();
		const big = { data: Buffer.alloc(600), mimeType: 'application/pdf' };
		const { parts } = await toParts([big], client, { ...gem, inlineLimit: 500 });
		expect(parts[0].fileData).toBeDefined();
		expect(client.files.upload.mock.calls[0][0].file).toBeInstanceOf(Blob);
		await expect(toParts([big], stubClient(), { ...vtx, inlineLimit: 500 })).rejects.toThrow(/gs:\/\//);
	});

	it('requires a MIME type for a bare buffer', async () => {
		await expect(toParts([Buffer.from('x')], stubClient(), vtx)).rejects.toThrow(/MIME type is required/);
	});

	it('throws UnsupportedFormatError for an unsupported extension or MIME', async () => {
		await expect(toParts([XLSX], stubClient(), vtx)).rejects.toBeInstanceOf(UnsupportedFormatError);
		await expect(toParts([{ data: 'AA', mimeType: 'application/msword' }], stubClient(), vtx)).rejects.toBeInstanceOf(UnsupportedFormatError);
		await expect(toParts(['https://h/a.docx'], stubClient(), vtx)).rejects.toBeInstanceOf(UnsupportedFormatError);
	});

	it('treats an uppercase extension like a lowercase one', async () => {
		const { parts } = await toParts([PNG_UPPER], stubClient(), vtx);
		expect(parts[0].inlineData.mimeType).toBe('image/png');
	});

	it('throws ENOENT for a missing path before uploading anything', async () => {
		const client = stubClient();
		await expect(toParts([PDF, join(DIR, 'missing.pdf')], client, { ...gem, alwaysUpload: true }))
			.rejects.toMatchObject({ code: 'ENOENT' });
		expect(client.files.upload).not.toHaveBeenCalled();
	});

	it('keeps input order', async () => {
		const { parts } = await toParts([PNG, MD], stubClient(), vtx);
		expect(parts[0].inlineData).toBeDefined();
		expect(parts[1].text).toMatch(/^--- File: a\.md/);
	});
});

describe('inline total', () => {
	const files = [BIG1, BIG2, BIG3]; // 600 + 400 + 300 = 1300

	it('uploads the largest file on the Gemini API until the rest fits', async () => {
		const client = stubClient();
		const { parts } = await toParts(files, client, { vertexai: false, inlineLimit: 800 });
		expect(client.files.upload).toHaveBeenCalledTimes(1);
		expect(client.files.upload.mock.calls[0][0].config.displayName).toBe('big1.pdf');
		expect(parts[0].fileData).toBeDefined();
		expect(parts[1].inlineData).toBeDefined();
		expect(parts[2].inlineData).toBeDefined();
	});

	it('throws on Vertex when the total is over, even though each file fits', async () => {
		await expect(toParts(files, stubClient(), { vertexai: true, inlineLimit: 800 })).rejects.toThrow(/gs:\/\//);
	});

	it('counts bytes already used (Gemini API uploads, Vertex throws)', async () => {
		const client = stubClient();
		const { parts } = await toParts([BIG3], client, { vertexai: false, inlineLimit: 800, inlineBytesUsed: 600 });
		expect(parts[0].fileData).toBeDefined();
		await expect(toParts([BIG3], stubClient(), { vertexai: true, inlineLimit: 800, inlineBytesUsed: 600 })).rejects.toThrow(/gs:\/\//);
	});

	it('alwaysUpload uploads on the Gemini API but inlines on Vertex', async () => {
		const client = stubClient();
		const g = await toParts([PNG], client, { vertexai: false, alwaysUpload: true });
		expect(g.parts[0].fileData).toBeDefined();
		const v = await toParts([PNG], stubClient(), { vertexai: true, alwaysUpload: true });
		expect(v.parts[0].inlineData).toBeDefined();
	});

	it('routes uploads through withRetry', async () => {
		const withRetry = jest.fn(fn => fn());
		await toParts([PNG], stubClient(), { vertexai: false, alwaysUpload: true, withRetry });
		expect(withRetry).toHaveBeenCalled();
	});
});

describe('WAV helpers', () => {
	it('pcmToWav writes a 44-byte header', () => {
		const wav = pcmToWav(Buffer.from([1, 2, 3, 4]), { sampleRate: 24000 });
		expect(wav.length).toBe(48);
		expect(wav.subarray(0, 4).toString()).toBe('RIFF');
		expect(wav.subarray(8, 12).toString()).toBe('WAVE');
		expect(wav.readUInt32LE(4)).toBe(40);
		expect(wav.readUInt16LE(22)).toBe(1);
		expect(wav.readUInt32LE(24)).toBe(24000);
		expect(wav.readUInt32LE(28)).toBe(48000);
		expect(wav.readUInt16LE(32)).toBe(2);
		expect(wav.readUInt16LE(34)).toBe(16);
		expect(wav.readUInt32LE(40)).toBe(4);
	});

	it('parsePcmMime reads the rate and channels in either spelling', () => {
		expect(parsePcmMime('audio/L16;codec=pcm;rate=24000')).toEqual({ sampleRate: 24000, channels: 1 });
		expect(parsePcmMime('audio/l16; rate=16000; channels=2')).toEqual({ sampleRate: 16000, channels: 2 });
		expect(() => parsePcmMime('audio/mpeg')).toThrow();
		expect(() => parsePcmMime('audio/L16')).toThrow(/rate/);
	});

	it('wavToPcm reverses pcmToWav and rejects non-WAV bytes', () => {
		const wav = pcmToWav(Buffer.from([9, 8, 7, 6]), { sampleRate: 22050, channels: 2 });
		expect(wavToPcm(wav)).toEqual({ pcm: Buffer.from([9, 8, 7, 6]), sampleRate: 22050, channels: 2, bitsPerSample: 16 });
		expect(() => wavToPcm(Buffer.from('not a wav file at all, nope'))).toThrow(/WAV/);
	});
});

describe('waitForFileActive', () => {
	it('polls until ACTIVE', async () => {
		const client = stubClient({ get: jest.fn().mockResolvedValueOnce({ state: 'PROCESSING' }).mockResolvedValueOnce({ state: 'ACTIVE' }) });
		await waitForFileActive(client, { name: 'files/x', state: 'PROCESSING' }, { intervalMs: 1 });
		expect(client.files.get).toHaveBeenCalledTimes(2);
	});

	it('throws on FAILED', async () => {
		const client = stubClient({ get: jest.fn().mockResolvedValue({ state: 'FAILED' }) });
		await expect(waitForFileActive(client, { name: 'files/x', displayName: 'd', state: 'PROCESSING' }, { intervalMs: 1 }))
			.rejects.toThrow('File processing failed: d');
	});
});


describe('RagAgent.remoteFiles stays lenient', () => {
	it('uploads a .docx with the 3.0.0 MIME and warns once per file', async () => {
		const { RagAgent, log } = await import('../index.js');
		// Construct first: setting the pino level re-binds log.warn and would drop a spy.
		const agent = new RagAgent({ apiKey: 'k', logLevel: 'silent', remoteFiles: [DOCX] });
		const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
		try {
			const client = { ...stubClient(), chats: { create: jest.fn(() => ({})) } };
			agent.genAIClient = client;
			agent._createChatSession = jest.fn(() => ({}));
			await agent.init();
			await agent.init(true);
			expect(client.files.upload).toHaveBeenCalledTimes(2);
			expect(client.files.upload.mock.calls[0][0].config.mimeType).toBe(LEGACY_MIME_TYPES['.docx']);
			const docxWarnings = warn.mock.calls.filter(c => String(c[0]).includes('legacy.docx'));
			expect(docxWarnings).toHaveLength(1);
			expect(docxWarnings[0][0]).toContain('strict "files" option would reject it');
		} finally {
			warn.mockRestore();
		}
	});
});

// ── Task 3: per-call `files` on every send method ──

const resp = (text = 'ok', extra = {}) => ({
	text, modelVersion: 'gemini-3.8-flash',
	candidates: [{ content: { parts: [{ text }] } }],
	usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
	...extra
});
async function* oneChunk(text = 'ok') { yield resp(text); }

/** A chat-session class wired to stubs. */
function wire(agent, { text = 'ok', history = [] } = {}) {
	agent.genAIClient = stubClient();
	agent.chatSession = {
		sendMessage: jest.fn(async () => resp(text)),
		sendMessageStream: jest.fn(async () => oneChunk(text)),
		getHistory: jest.fn(() => history)
	};
	agent._initialized = true;
	return agent;
}

describe('per-call files option', () => {
	let mod;
	beforeAll(async () => { mod = await import('../index.js'); });
	const KEY = { apiKey: 'k', logLevel: 'silent' };
	const VTX = { vertexai: true, project: 'p', location: 'global', logLevel: 'silent' };

	it('Message inlines files after the prompt and reports usage.files', async () => {
		const msg = new mod.Message(KEY);
		const generateContent = jest.fn(async () => resp());
		msg.genAIClient = { ...stubClient(), models: { generateContent } };
		const r = await msg.send('hi', { files: [PNG] });
		const parts = generateContent.mock.calls[0][0].contents[0].parts;
		expect(parts[0]).toEqual({ text: 'hi' });
		expect(parts[1].inlineData.mimeType).toBe('image/png');
		expect(r.usage.files).toEqual([]);
	});

	it('Message without files sends exactly the 3.0.0 parts', async () => {
		const msg = new mod.Message(KEY);
		const generateContent = jest.fn(async () => resp());
		msg.genAIClient = { ...stubClient(), models: { generateContent } };
		await msg.send('hi');
		await msg.send('hi', { files: [] });
		expect(generateContent.mock.calls[0][0].contents[0].parts).toEqual([{ text: 'hi' }]);
		expect(generateContent.mock.calls[1][0].contents[0].parts).toEqual([{ text: 'hi' }]);
	});

	const chatCases = [
		['Chat.send', () => new mod.Chat(KEY), (a, o) => a.send('hi', o)],
		['Chat.stream', () => new mod.Chat(KEY), async (a, o) => { for await (const _ of a.stream('hi', o)); }, true],
		['ToolAgent.chat', () => new mod.ToolAgent({ ...KEY, tools: [{ name: 't', description: 'd', parametersJsonSchema: { type: 'object' } }], toolExecutor: async () => 1 }), (a, o) => a.chat('hi', o)],
		['ToolAgent.stream', () => new mod.ToolAgent({ ...KEY, tools: [{ name: 't', description: 'd', parametersJsonSchema: { type: 'object' } }], toolExecutor: async () => 1 }), async (a, o) => { for await (const _ of a.stream('hi', o)); }, true],
		['CodeAgent.chat', () => new mod.CodeAgent(KEY), (a, o) => a.chat('hi', o)],
		['CodeAgent.stream', () => new mod.CodeAgent(KEY), async (a, o) => { for await (const _ of a.stream('hi', o)); }, true],
		['RagAgent.chat', () => new mod.RagAgent(KEY), (a, o) => a.chat('hi', o)],
		['RagAgent.stream', () => new mod.RagAgent(KEY), async (a, o) => { for await (const _ of a.stream('hi', o)); }, true],
	];

	for (const [label, make, call, streaming] of chatCases) {
		it(`${label} uploads files on the Gemini API and keeps a string message without files`, async () => {
			const a = wire(make());
			const fn = streaming ? a.chatSession.sendMessageStream : a.chatSession.sendMessage;
			await call(a, { files: [PNG] });
			const msg = fn.mock.calls[0][0].message;
			expect(msg[0]).toEqual({ text: 'hi' });
			expect(msg[1]).toEqual({ fileData: { fileUri: 'https://u/x', mimeType: 'image/png' } });
			expect(a.genAIClient.files.upload).toHaveBeenCalledTimes(1);
			expect(a.getLastUsage().files).toHaveLength(1);

			await call(a, {});
			await call(a, { files: [] });
			expect(fn.mock.calls[1][0].message).toBe('hi');
			expect(fn.mock.calls[2][0].message).toBe('hi');
			expect(a.getLastUsage().files).toEqual([]);
		});
	}

	it('Transformer.send and rawSend attach files; validation retries do not re-attach them', async () => {
		const t = wire(new mod.Transformer({ ...KEY, maxRetries: 1, retryDelay: 1 }), { text: '{"a":1}' });
		let n = 0;
		await t.send('hi', { files: [PNG] }, async () => { if (n++ === 0) throw new Error('bad'); });
		const calls = t.chatSession.sendMessage.mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][0].message[1].fileData.mimeType).toBe('image/png');
		expect(typeof calls[1][0].message).toBe('string');
		expect(t.getLastUsage().files).toHaveLength(1);

		await t.rawSend('hi', { files: [MD] });
		expect(calls[2][0].message).toEqual([{ text: 'hi' }, { text: '--- File: a.md ---\n# hi' }]);
		await t.rawSend('hi');
		expect(calls[3][0].message).toBe('hi');
	});

	it('Transformer.send throws a format error once, without retrying', async () => {
		const t = wire(new mod.Transformer({ ...KEY, maxRetries: 3, retryDelay: 1 }));
		await expect(t.send('hi', { files: [XLSX] })).rejects.toBeInstanceOf(UnsupportedFormatError);
		expect(t.chatSession.sendMessage).not.toHaveBeenCalled();
	});

	it('Transformer stateless send inlines files', async () => {
		const t = wire(new mod.Transformer(KEY), { text: '{"a":1}' });
		const generateContent = jest.fn(async () => resp('{"a":1}'));
		t.genAIClient = { ...stubClient(), models: { generateContent } };
		await t.send('hi', { stateless: true, files: [PNG] });
		const parts = generateContent.mock.calls[0][0].contents.at(-1).parts;
		expect(parts[1].inlineData.mimeType).toBe('image/png');
	});

	it('ToolAgent sends files only with the first message of a tool loop', async () => {
		const a = wire(new mod.ToolAgent({ ...KEY, tools: [{ name: 't', description: 'd', parametersJsonSchema: { type: 'object' } }], toolExecutor: async () => 1 }));
		a.chatSession.sendMessage
			.mockResolvedValueOnce(resp('', { functionCalls: [{ id: '1', name: 't', args: {} }] }))
			.mockResolvedValueOnce(resp('done'));
		await a.chat('hi', { files: [PNG] });
		const calls = a.chatSession.sendMessage.mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][0].message.some(p => p.fileData)).toBe(true);
		expect(calls[1][0].message.some(p => p.fileData || p.inlineData)).toBe(false);
	});

	it('Vertex chat inlines, and throws before sending when history plus new files exceed the limit', async () => {
		const c = wire(new mod.Chat(VTX));
		await c.send('hi', { files: [PNG] });
		expect(c.chatSession.sendMessage.mock.calls[0][0].message[1].inlineData).toBeDefined();
		expect(c.genAIClient.files.upload).not.toHaveBeenCalled();

		// A stub base64 string whose length decodes to ~256 MB (no real allocation).
		const big = { length: Math.ceil(INLINE_LIMIT_BYTES.vertex * 4 / 3) };
		const full = wire(new mod.Chat(VTX), { history: [{ role: 'user', parts: [{ inlineData: { data: big, mimeType: 'image/png' } }] }] });
		await expect(full.send('hi', { files: [PNG] })).rejects.toThrow(/already in this conversation.*gs:\/\//s);
		expect(full.chatSession.sendMessage).not.toHaveBeenCalled();
	});
});

// ── Task 4: ImageGenerator input shapes + shared helpers ──

describe('ImageGenerator inputImages', () => {
	let ImageGenerator, buildImageConfig, parseImageResponse;
	beforeAll(async () => ({ default: ImageGenerator, buildImageConfig, parseImageResponse } = await import('../image-generator.js')));
	const imgResp = { candidates: [{ content: { parts: [{ inlineData: { data: 'AQID', mimeType: 'image/png' } }, { text: 'hi' }] } }], usageMetadata: {} };
	function gen(opts = {}) {
		const g = new ImageGenerator({ apiKey: 'k', logLevel: 'silent', ...opts });
		const generateContent = jest.fn(async () => imgResp);
		g.genAIClient = { ...stubClient(), models: { generateContent } };
		return { g, generateContent };
	}

	it('accepts a path', async () => {
		const { g, generateContent } = gen();
		await g.generate('x', { inputImages: [PNG] });
		expect(generateContent.mock.calls[0][0].contents[0].parts[1].inlineData.mimeType).toBe('image/png');
	});

	it('keeps the 3.0.0 base64 object shape unchanged', async () => {
		const { g, generateContent } = gen();
		await g.generate('x', { inputImages: [{ data: 'AAAA', mimeType: 'image/png' }] });
		expect(generateContent.mock.calls[0][0].contents[0].parts[1]).toEqual({ inlineData: { data: 'AAAA', mimeType: 'image/png' } });
	});

	it('rejects an unsupported image format', async () => {
		const { g } = gen();
		await expect(g.generate('x', { inputImages: [fx('anim.gif', 'GIF89a')] })).rejects.toBeInstanceOf(UnsupportedFormatError);
	});

	it('buildImageConfig adds outputMimeType only when given', () => {
		expect(buildImageConfig({}, {}, {})).toEqual({ responseModalities: ['IMAGE'] });
		expect(buildImageConfig({ aspectRatio: '1:1' }, { includeText: true }, { outputMimeType: 'image/jpeg' }))
			.toEqual({ responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '1:1', outputMimeType: 'image/jpeg' } });
	});

	it('parseImageResponse returns images and text', () => {
		expect(parseImageResponse(imgResp)).toEqual({ images: [{ data: 'AQID', mimeType: 'image/png' }], text: 'hi' });
		expect(parseImageResponse({})).toEqual({ images: [], text: null });
	});
});

// ── Task 5: FileAgent — validation, text route, read() ──

describe('FileAgent text route', () => {
	let FileAgent;
	beforeAll(async () => ({ FileAgent } = await import('../file-agent.js').then(m => ({ FileAgent: m.default }))));
	function agent(text = 'hello', opts = {}) {
		const fa = new FileAgent({ apiKey: 'k', logLevel: 'silent', ...opts });
		const generateContent = jest.fn(async () => resp(text));
		fa.genAIClient = { ...stubClient(), models: { generateContent } };
		return { fa, generateContent };
	}

	it('needs a format or a path', async () => {
		const { fa } = agent();
		await expect(fa.write('x', {})).rejects.toThrow('FileAgent.write() needs { format } or { path }');
	});

	it('rejects a format that disagrees with the path extension', async () => {
		const { fa, generateContent } = agent();
		await expect(fa.write('x', { format: 'md', path: join(DIR, 'a.csv') })).rejects.toThrow('format "md" does not match path extension ".csv"');
		expect(generateContent).not.toHaveBeenCalled();
	});

	it('throws UnsupportedFormatError before any call for an unwritable format', async () => {
		const { fa, generateContent } = agent();
		const err = await fa.write('x', { format: 'xlsx' }).catch(e => e);
		expect(err).toBeInstanceOf(UnsupportedFormatError);
		expect(err.message).toMatch(/^Cannot write "\.xlsx"\. FileAgent \(Gemini API\) writes:/);
		expect(generateContent).not.toHaveBeenCalled();
	});

	it('throws for a path with no extension and writes nothing', async () => {
		const { fa } = agent();
		const out = join(DIR, 'report');
		const err = await fa.write('x', { path: out }).catch(e => e);
		expect(err).toBeInstanceOf(UnsupportedFormatError);
		expect(err.format).toBe('');
		expect(existsSync(out)).toBe(false);
	});

	it('routes a case-insensitive text format to the text model and strips a code fence', async () => {
		const { fa, generateContent } = agent('```csv\na,b\n1,2\n```');
		const r = await fa.write('table', { format: 'CSV' });
		expect(generateContent.mock.calls[0][0].model).toBe(fa.modelName);
		expect(r.data.toString()).toBe('a,b\n1,2');
		expect(r).toMatchObject({ format: 'csv', mimeType: 'text/csv', path: null, text: 'a,b\n1,2' });
		expect(r.usage.model).toBe(fa.modelName);
	});

	it('json output uses JSON mode and must parse', async () => {
		const schema = { type: 'object', properties: { a: { type: 'number' } } };
		const { fa, generateContent } = agent('{"a":1}');
		const r = await fa.write('x', { format: 'json', responseSchema: schema });
		const cfg = generateContent.mock.calls[0][0].config;
		expect(cfg.responseMimeType).toBe('application/json');
		expect(cfg.responseSchema).toBe(schema);
		expect(JSON.parse(r.data.toString())).toEqual({ a: 1 });
		expect(r.mimeType).toBe('application/json');

		const bad = agent('not json');
		const err = await bad.fa.write('x', { format: 'json' }).catch(e => e);
		expect(err.message).toMatch(/not valid JSON/);
		expect(err.raw).toBe('not json');
	});

	it('path mode creates parent folders and returns the path', async () => {
		const { fa } = agent('# Title');
		const out = join(DIR, 'sub', 'deeper', 'out.md');
		const r = await fa.write('doc', { path: out });
		expect(r.path).toBe(out);
		expect(readFileSync(out, 'utf8')).toBe('# Title');
		expect(r.mimeType).toBe('text/markdown');
	});

	it('passes input files after the prompt', async () => {
		const { fa, generateContent } = agent('hola');
		await fa.write('translate', { format: 'md', files: [MD] });
		expect(generateContent.mock.calls[0][0].contents[0].parts[1]).toEqual({ text: '--- File: a.md ---\n# hi' });
	});

	it('read() sends files with the prompt and parses JSON when a schema is given', async () => {
		const { fa, generateContent } = agent('{"total":5}');
		const r = await fa.read([PDF], 'total?', { responseSchema: { type: 'object' } });
		const call = generateContent.mock.calls[0][0];
		expect(call.contents[0].parts[0]).toEqual({ text: 'total?' });
		expect(call.contents[0].parts[1].inlineData.mimeType).toBe('application/pdf');
		expect(call.config.responseMimeType).toBe('application/json');
		expect(r.data).toEqual({ total: 5 });
		expect(r.usage.files).toEqual([]);
	});

	it('is stateless', async () => {
		const { fa } = agent();
		expect(fa.getHistory()).toEqual([]);
		expect(await fa.seed()).toEqual([]);
	});
});

// ── Task 6: FileAgent image + audio routes, TTS pricing ──

describe('FileAgent image and audio routes', () => {
	let FileAgent, DEFAULT_SPEECH_MODEL, resolvePricing, MODEL_PRICING_AS_OF;
	beforeAll(async () => {
		const m = await import('../file-agent.js');
		FileAgent = m.default; DEFAULT_SPEECH_MODEL = m.DEFAULT_SPEECH_MODEL;
		({ resolvePricing, MODEL_PRICING_AS_OF } = await import('../index.js'));
	});
	const VTX = { vertexai: true, project: 'p', location: 'global', logLevel: 'silent' };
	const GEM = { apiKey: 'k', logLevel: 'silent' };
	const partsResp = (parts) => ({ candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 40, totalTokenCount: 45 } });
	function agent(opts, parts) {
		const fa = new FileAgent(opts);
		const generateContent = jest.fn(async () => partsResp(parts));
		fa.genAIClient = { ...stubClient(), models: { generateContent } };
		return { fa, generateContent };
	}
	const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64');
	const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]).toString('base64');

	it('Gemini API jpg goes to the image model without outputMimeType', async () => {
		const { fa, generateContent } = agent(GEM, [{ inlineData: { data: JPEG_B64, mimeType: 'image/jpeg' } }]);
		const out = join(DIR, 'img', 'mug.jpg');
		const r = await fa.write('a mug', { path: out });
		const call = generateContent.mock.calls[0][0];
		expect(call.model).toBe('gemini-nano-banana-2.1');
		expect(call.config.imageConfig?.outputMimeType).toBeUndefined();
		expect(r.data.equals(Buffer.from(JPEG_B64, 'base64'))).toBe(true);
		expect(readFileSync(out).equals(r.data)).toBe(true);
		expect(r).toMatchObject({ format: 'jpg', mimeType: 'image/jpeg', text: null });
		expect(r.usage.model).toBe('gemini-nano-banana-2.1');
	});

	it('Vertex sends outputMimeType for the requested format', async () => {
		const { fa, generateContent } = agent(VTX, [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }]);
		await fa.write('a mug', { format: 'png', aspectRatio: '1:1' });
		expect(generateContent.mock.calls[0][0].config.imageConfig).toEqual({ aspectRatio: '1:1', outputMimeType: 'image/png' });
		const j = agent(VTX, [{ inlineData: { data: JPEG_B64, mimeType: 'image/jpeg' } }]);
		await j.fa.write('a mug', { format: 'jpeg' });
		expect(j.generateContent.mock.calls[0][0].config.imageConfig.outputMimeType).toBe('image/jpeg');
	});

	it('png on the Gemini API throws before any call', async () => {
		const { fa, generateContent } = agent(GEM, []);
		await expect(fa.write('x', { format: 'png' })).rejects.toBeInstanceOf(UnsupportedFormatError);
		expect(generateContent).not.toHaveBeenCalled();
	});

	it('throws and writes nothing when the returned MIME differs or is missing', async () => {
		const out = join(DIR, 'img', 'wrong.jpg');
		const { fa } = agent(GEM, [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }]);
		await expect(fa.write('x', { path: out })).rejects.toThrow(/image\/png.*image\/jpeg|image\/jpeg.*image\/png/);
		expect(existsSync(out)).toBe(false);
		const none = agent(GEM, [{ inlineData: { data: JPEG_B64 } }]);
		await expect(none.fa.write('x', { format: 'jpg' })).rejects.toThrow(/MIME/);
	});

	it('names the finish reason when the image model refuses', async () => {
		const fa = new FileAgent(GEM);
		fa.genAIClient = { ...stubClient(), models: { generateContent: jest.fn(async () => ({
			candidates: [{ finishReason: 'IMAGE_RECITATION', finishMessage: 'Try rephrasing the prompt.' }], usageMetadata: {}
		})) } };
		await expect(fa.write('x', { format: 'jpg' })).rejects.toThrow(/no image \(IMAGE_RECITATION\)\. Try rephrasing the prompt\./);
	});

	it('throws when the image model returns no image', async () => {
		const { fa } = agent(GEM, [{ text: 'I cannot draw that' }]);
		await expect(fa.write('x', { format: 'jpg' })).rejects.toThrow(/no image.*I cannot draw that/s);
	});

	it('wav passes a WAV response through and uses the speech model and default voice', async () => {
		const wav = pcmToWav(Buffer.from([1, 2, 3, 4]), { sampleRate: 24000 });
		const { fa, generateContent } = agent(VTX, [{ inlineData: { data: wav.toString('base64'), mimeType: 'audio/wav' } }]);
		const r = await fa.write('say hi', { format: 'wav' });
		const call = generateContent.mock.calls[0][0];
		expect(call.model).toBe(DEFAULT_SPEECH_MODEL);
		expect(DEFAULT_SPEECH_MODEL).toBe('gemini-3.8-flash-tts');
		expect(call.config).toEqual({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } });
		expect(call.contents[0].parts).toEqual([{ text: 'say hi' }]);
		expect(r.data.equals(wav)).toBe(true);
		expect(r.mimeType).toBe('audio/wav');
		expect(r.usage.model).toBe('gemini-3.8-flash-tts');
	});

	it('wav wraps L16 PCM parts in a WAV header, concatenating parts', async () => {
		const mime = 'audio/l16; rate=24000; channels=1';
		const { fa } = agent(GEM, [
			{ inlineData: { data: Buffer.from([1, 2]).toString('base64'), mimeType: mime } },
			{ inlineData: { data: Buffer.from([3, 4]).toString('base64'), mimeType: mime } }
		]);
		const r = await fa.write('say hi', { format: 'wav', voice: 'Puck', languageCode: 'en-US' });
		expect(r.data.length).toBe(48);
		expect(r.data.readUInt32LE(24)).toBe(24000);
		expect(r.data.subarray(44)).toEqual(Buffer.from([1, 2, 3, 4]));
	});

	it('multi-speaker turns become parts with speechMetadata', async () => {
		const wav = pcmToWav(Buffer.from([1, 2]), { sampleRate: 24000 });
		const { fa, generateContent } = agent(GEM, [{ inlineData: { data: wav.toString('base64'), mimeType: 'audio/wav' } }]);
		await fa.write([{ speaker: 'A', text: 'Hi.' }, { speaker: 'B', text: 'Hello.', style: 'cheerful' }], {
			format: 'wav', speakers: [{ speaker: 'A', voice: 'Puck' }, { speaker: 'B', voice: 'Kore' }]
		});
		const call = generateContent.mock.calls[0][0];
		expect(call.contents[0].parts).toEqual([
			{ text: 'Hi.', speechMetadata: { speaker: 'A' } },
			{ text: 'Hello.', speechMetadata: { speaker: 'B', style: 'cheerful' } }
		]);
		expect(call.config.speechConfig).toEqual({ multiSpeakerVoiceConfig: { speakerVoiceConfigs: [
			{ speaker: 'A', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
			{ speaker: 'B', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
		] } });
	});

	it('wav throws on no audio or an unexpected audio MIME', async () => {
		await expect(agent(GEM, [{ text: 'no' }]).fa.write('x', { format: 'wav' })).rejects.toThrow(/no audio/);
		await expect(agent(GEM, [{ inlineData: { data: 'AAAA', mimeType: 'audio/mpeg' } }]).fa.write('x', { format: 'wav' })).rejects.toThrow(/audio\/mpeg/);
	});

	it('prices the TTS models from the 2026-11-20 pricing page', () => {
		expect(resolvePricing('gemini-3.8-flash-tts', { at: '2026-11-20' })).toMatchObject({ input: 0.50, output: 9.00 });
		expect(resolvePricing('gemini-3.8-flash-tts', { at: '2027-01-02' })).toMatchObject({ input: 1.00, output: 18.00 });
		expect(resolvePricing('gemini-3.8-flash-lite-tts', { at: '2026-11-20' })).toMatchObject({ input: 0.50, output: 6.00 });
		expect(resolvePricing('gemini-3.8-flash-lite-tts', { at: '2027-01-02' })).toMatchObject({ input: 1.00, output: 12.00 });
		expect(resolvePricing('gemini-3.1-flash-tts-preview')).toMatchObject({ input: 1.00, output: 20.00 });
		expect(resolvePricing('gemini-2.5-flash-preview-tts')).toMatchObject({ input: 0.50, output: 10.00 });
		expect(resolvePricing('gemini-2.5-pro-preview-tts')).toMatchObject({ input: 1.00, output: 20.00 });
		expect(MODEL_PRICING_AS_OF).toBe('2026-11-20');
	});
});

// ── Final review fixes ──

describe('final review fixes', () => {
	let mod, FileAgent;
	beforeAll(async () => { mod = await import('../index.js'); FileAgent = mod.FileAgent; });
	const KEY = { apiKey: 'k', logLevel: 'silent' };

	it('I1: SpeechTurn[] with files throws instead of dropping the files', async () => {
		const fa = new FileAgent(KEY);
		fa.genAIClient = { ...stubClient(), models: { generateContent: jest.fn() } };
		await expect(fa.write([{ speaker: 'A', text: 'hi' }], { format: 'wav', speakers: [{ speaker: 'A', voice: 'Kore' }], files: [MD] }))
			.rejects.toThrow(/files.*SpeechTurn|SpeechTurn.*files/);
		await expect(fa.write([{ speaker: 'A', text: 'hi' }], { format: 'md' })).rejects.toThrow(/string prompt/);
		expect(fa.genAIClient.models.generateContent).not.toHaveBeenCalled();
	});

	it('I2: a retry after a failed first send re-attaches the files', async () => {
		const t = wire(new mod.Transformer({ ...KEY, maxRetries: 1, retryDelay: 1 }), { text: '{"a":1}' });
		t.chatSession.sendMessage.mockRejectedValueOnce(new Error('503 UNAVAILABLE'));
		await t.send('hi', { files: [PNG] });
		const calls = t.chatSession.sendMessage.mock.calls;
		expect(calls).toHaveLength(2);
		expect(Array.isArray(calls[1][0].message)).toBe(true);
		expect(calls[1][0].message[1]).toEqual(calls[0][0].message[1]);
		expect(t.genAIClient.files.upload).toHaveBeenCalledTimes(1);
	});

	it('I3: an extraction retry keeps getLastUsage().files', async () => {
		const t = wire(new mod.Transformer({ ...KEY, maxRetries: 1, retryDelay: 1 }), { text: '{"a":1}' });
		t.chatSession.sendMessage.mockResolvedValueOnce(resp('not json at all'));
		// History records the first (successful) turn, so the retry does not re-attach.
		t.chatSession.getHistory.mockReturnValueOnce([]).mockReturnValue([{ role: 'user', parts: [] }, { role: 'model', parts: [] }]);
		await t.send('hi', { files: [PNG] });
		expect(t.getLastUsage().files).toHaveLength(1);
		expect(typeof t.chatSession.sendMessage.mock.calls[1][0].message).toBe('string');
	});

	it('M1: a non-base64 string in { data } throws instead of decoding to garbage', async () => {
		await expect(toParts([{ data: 'name,age\n1,2', mimeType: 'text/csv' }], stubClient(), { vertexai: true })).rejects.toThrow(/base64/);
		await expect(toParts([{ data: 'data:image/png;base64,AAAA', mimeType: 'image/png' }], stubClient(), { vertexai: true })).rejects.toThrow(/base64/);
		const ok = await toParts([{ data: 'YSxi\n', mimeType: 'text/csv', name: 'x.csv' }], stubClient(), { vertexai: true });
		expect(ok.parts[0].text).toBe('--- File: x.csv ---\na,b');
	});

	it('M5: a Markdown reply that starts and ends with code blocks is not stripped', async () => {
		const md = '```js\na()\n```\nprose\n```py\nb()\n```';
		const fa = new FileAgent(KEY);
		fa.genAIClient = { ...stubClient(), models: { generateContent: jest.fn(async () => resp(md)) } };
		const r = await fa.write('doc', { format: 'md' });
		expect(r.text).toBe(md);
	});
});

// ── Easy minors before release ──

describe('release minors', () => {
	let mod;
	beforeAll(async () => { mod = await import('../index.js'); });
	const KEY = { apiKey: 'k', logLevel: 'silent' };

	it('FOUND 1: ImageGenerator resolves all path inputs before any upload', async () => {
		const { default: ImageGenerator } = await import('../image-generator.js');
		const g = new ImageGenerator(KEY);
		g.genAIClient = { ...stubClient(), models: { generateContent: jest.fn() } };
		const huge = { data: Buffer.alloc(INLINE_LIMIT_BYTES.gemini + 1), mimeType: 'image/png' };
		await expect(g.generate('x', { inputImages: [huge, join(DIR, 'missing.png')] })).rejects.toMatchObject({ code: 'ENOENT' });
		expect(g.genAIClient.files.upload).not.toHaveBeenCalled();
	});

	it('FOUND 1: ImageGenerator keeps input order across legacy and path entries', async () => {
		const { default: ImageGenerator } = await import('../image-generator.js');
		const g = new ImageGenerator(KEY);
		const generateContent = jest.fn(async () => ({ candidates: [{ content: { parts: [] } }], usageMetadata: {} }));
		g.genAIClient = { ...stubClient(), models: { generateContent } };
		await g.generate('x', { inputImages: [PNG, { data: 'AAAA', mimeType: 'image/webp' }, PNG_UPPER] });
		const parts = generateContent.mock.calls[0][0].contents[0].parts;
		expect(parts.map(p => p.inlineData?.mimeType)).toEqual([undefined, 'image/png', 'image/webp', 'image/png']);
	});

	it('FOUND 2: FileAgent.getLastUsage() returns the last call usage', async () => {
		const fa = new mod.FileAgent(KEY);
		fa.genAIClient = { ...stubClient(), models: { generateContent: jest.fn(async () => resp('hi')) } };
		expect(fa.getLastUsage()).toBeNull();
		const r = await fa.write('x', { format: 'txt' });
		expect(fa.getLastUsage()).toEqual(r.usage);
		const rr = await fa.read([MD], 'q');
		expect(fa.getLastUsage()).toEqual(rr.usage);
	});

	it('FOUND 3: RagAgent.remoteFiles uploads strict-only formats with their real MIME, no warning', async () => {
		const agent = new mod.RagAgent({ ...KEY, remoteFiles: [fx('shot.heic', 'x')] });
		const warn = jest.spyOn(mod.log, 'warn').mockImplementation(() => {});
		try {
			const client = { ...stubClient(), chats: { create: jest.fn(() => ({})) } };
			agent.genAIClient = client;
			agent._createChatSession = jest.fn(() => ({}));
			await agent.init();
			expect(client.files.upload.mock.calls[0][0].config.mimeType).toBe('image/heic');
			expect(warn.mock.calls.filter(c => String(c[0]).includes('shot.heic'))).toHaveLength(0);
		} finally {
			warn.mockRestore();
		}
	});

	it('FOUND 4: a failed upload reports the uploads that already succeeded', async () => {
		const client = stubClient();
		client.files.upload
			.mockResolvedValueOnce({ name: 'files/a', uri: 'https://u/a', mimeType: 'image/png', state: 'ACTIVE' })
			.mockRejectedValueOnce(new Error('upload broke'));
		const err = await toParts([PNG, PDF], client, { vertexai: false, alwaysUpload: true }).catch(e => e);
		expect(err.message).toBe('upload broke');
		expect(err.uploaded).toEqual([expect.objectContaining({ name: 'files/a' })]);
	});
});
