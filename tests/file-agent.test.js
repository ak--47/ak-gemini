/**
 * @fileoverview LIVE (paid) tests for the 3.1.0 file primitives.
 * Vertex `global` for most cases (3.8-flash and TTS are not served in
 * us-central1), plus the Gemini API for the upload and JPEG paths.
 * Keep this file small: every case is a real API call.
 */

import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import dotenv from 'dotenv';
import { Message, Chat, Transformer, ToolAgent, CodeAgent, RagAgent, FileAgent } from '../index.js';
import { BASE_OPTIONS } from './auth-helper.js';

const GEMINI_API_KEY = dotenv.parse(readFileSync(new URL('../.env', import.meta.url))).GEMINI_API_KEY;
const VTX = { ...BASE_OPTIONS, location: 'global' };
const GEM = { apiKey: GEMINI_API_KEY, logLevel: 'warn' };
const DIR = mkdtempSync(join(tmpdir(), 'akg-live-files-'));

// ── Fixtures ──

function crc32(buf) {
	let crc = 0xffffffff;
	for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
	return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}
/** A solid red 64x64 PNG. */
function redPng() {
	const w = 64, h = 64, row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).fill(Buffer.from([255, 0, 0]))]);
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), pngChunk('IEND', Buffer.alloc(0))
	]);
}
/** A one-page PDF whose only text is "Banana". */
function bananaPdf() {
	const stream = 'BT /F1 48 Tf 72 700 Td (Banana) Tj ET';
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let out = '%PDF-1.4\n';
	const offsets = [];
	objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

const PNG = join(DIR, 'red.png');
const PDF = join(DIR, 'banana.pdf');
writeFileSync(PNG, redPng());
writeFileSync(PDF, bananaPdf());
const FILES = [PNG, PDF];
const ASK = 'In two words: the colour of the image, then the word in the PDF.';
const expectRead = (text) => {
	expect(text.toLowerCase()).toContain('red');
	expect(text.toLowerCase()).toContain('banana');
};

const costs = [];
afterAll(() => {
	const total = costs.reduce((s, c) => s + (c || 0), 0);
	console.log(`[file-agent.test] estimated cost: $${total.toFixed(5)} over ${costs.length} calls`);
});

describe('files option (live, Vertex)', () => {
	it('Message', async () => {
		const r = await new Message(VTX).send(ASK, { files: FILES });
		costs.push(r.usage.estimatedCost);
		expectRead(r.text);
	}, 60000);

	it('Chat', async () => {
		const c = new Chat(VTX);
		const r = await c.send(ASK, { files: FILES });
		costs.push(r.usage.estimatedCost);
		expectRead(r.text);
	}, 60000);

	it('Transformer', async () => {
		const t = new Transformer({ ...VTX, maxRetries: 1 });
		await t.init();
		const out = await t.send({ task: 'Return {"colour": <image colour>, "word": <word in the PDF>}' }, { files: FILES });
		costs.push(t.getLastUsage()?.estimatedCost);
		expect(String(out.colour).toLowerCase()).toContain('red');
		expect(String(out.word).toLowerCase()).toContain('banana');
	}, 60000);

	it('ToolAgent', async () => {
		const a = new ToolAgent({ ...VTX, tools: [{ name: 'noop', description: 'Never needed.', parametersJsonSchema: { type: 'object', properties: {} } }], toolExecutor: async () => ({}) });
		const r = await a.chat(ASK, { files: FILES });
		costs.push(r.usage?.estimatedCost);
		expectRead(r.text);
	}, 60000);

	it('CodeAgent', async () => {
		const a = new CodeAgent({ ...VTX, workingDirectory: DIR });
		const r = await a.chat(`${ASK} Answer directly; do not run any tools.`, { files: FILES });
		costs.push(r.usage?.estimatedCost);
		expectRead(r.text);
	}, 90000);

	it('RagAgent', async () => {
		const a = new RagAgent({ ...VTX, localData: [{ name: 'note', data: 'unused' }] });
		const r = await a.chat(ASK, { files: FILES });
		costs.push(r.usage?.estimatedCost);
		expectRead(r.text);
	}, 60000);
});

describe('files option (live, Gemini API upload path)', () => {
	it('Chat uploads the binaries and reports usage.files', async () => {
		const c = new Chat(GEM);
		const r = await c.send(ASK, { files: FILES });
		costs.push(r.usage.estimatedCost);
		expectRead(r.text);
		expect(r.usage.files).toHaveLength(2);
		const client = await c._ensureClient();
		for (const f of r.usage.files) await client.files.delete({ name: f.name });
	}, 90000);
});

describe('FileAgent.write (live)', () => {
	it('json (Vertex)', async () => {
		const r = await new FileAgent(VTX).write('Three primary colours as {"colours": [..]}', { format: 'json' });
		costs.push(r.usage.estimatedCost);
		expect(Array.isArray(JSON.parse(r.data.toString()).colours)).toBe(true);
	}, 60000);

	it('png (Vertex) writes PNG bytes', async () => {
		// Not "a red circle": that prompt ends in IMAGE_RECITATION (no image) every time.
		const out = join(DIR, 'out', 'mug.png');
		const r = await new FileAgent(VTX).write('A photo of a red ceramic mug on a wooden desk.', { path: out });
		costs.push(r.usage.estimatedCost);
		expect(readFileSync(out).subarray(0, 4).toString('hex')).toBe('89504e47');
		expect(r.usage.model).toBe('gemini-nano-banana-2.1');
	}, 120000);

	it('jpg (Gemini API) writes JPEG bytes', async () => {
		const r = await new FileAgent(GEM).write('A photo of a blue coffee mug on a wooden desk.', { format: 'jpg' });
		costs.push(r.usage.estimatedCost);
		expect(r.data.subarray(0, 3).toString('hex')).toBe('ffd8ff');
	}, 120000);

	it('wav (Vertex) writes a WAV file', async () => {
		const r = await new FileAgent(VTX).write('Say: hello there.', { format: 'wav' });
		costs.push(r.usage.estimatedCost);
		expect(r.data.subarray(0, 4).toString()).toBe('RIFF');
		expect(r.data.subarray(8, 12).toString()).toBe('WAVE');
		expect(r.data.readUInt32LE(24)).toBe(24000);
		expect(r.usage.model).toBe('gemini-3.8-flash-tts');
		expect(r.usage.estimatedCost).toBeGreaterThan(0);
	}, 60000);
});
