/**
 * @fileoverview File primitives shared by every class: supported formats,
 * MIME tables, UnsupportedFormatError, input resolution (toParts), Files API
 * upload + poll, and WAV/PCM helpers.
 *
 * The strict path (`toParts`, used by the per-call `files` option and
 * FileAgent) never falls back: an unknown format throws. `LEGACY_MIME_TYPES`
 * exists only so `RagAgent.remoteFiles` keeps its lenient 3.0.0 behaviour.
 */

import { stat, readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

// ── Formats ──────────────────────────────────────────────────────────────────

/** Extensions read as UTF-8 and sent as labelled text parts. */
const TEXT_MIME_TYPES = {
	'.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
	'.json': 'application/json', '.yaml': 'application/yaml', '.yml': 'application/yaml',
	'.xml': 'text/xml', '.html': 'text/html', '.htm': 'text/html',
	'.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
	'.css': 'text/css', '.py': 'text/x-python', '.rb': 'text/plain', '.sh': 'text/plain',
	'.svg': 'image/svg+xml'
};

/** Binary formats Gemini reads natively (inline or as fileData). */
const BINARY_MIME_TYPES = {
	'.pdf': 'application/pdf',
	// Images
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
	'.heic': 'image/heic', '.heif': 'image/heif',
	// Audio
	'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.aiff': 'audio/aiff', '.aac': 'audio/aac',
	'.ogg': 'audio/ogg', '.flac': 'audio/flac',
	// Video
	'.mp4': 'video/mp4', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.mov': 'video/quicktime',
	'.avi': 'video/x-msvideo', '.flv': 'video/x-flv', '.webm': 'video/webm', '.wmv': 'video/wmv',
	'.3gp': 'video/3gpp'
};

/** @type {Readonly<Record<string, string>>} Strict readable map: extension → MIME. */
const MIME_TYPES = Object.freeze({ ...TEXT_MIME_TYPES, ...BINARY_MIME_TYPES });

/** @type {ReadonlySet<string>} */
const TEXT_EXTENSIONS = new Set(Object.keys(TEXT_MIME_TYPES));

/**
 * The exact 3.0.0 RagAgent map. Used ONLY by RagAgent.remoteFiles, which stays
 * lenient (uploads .docx, .gif, unknown types) so 3.1.0 breaks no caller.
 * @type {Readonly<Record<string, string>>}
 */
const LEGACY_MIME_TYPES = Object.freeze({
	'.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/csv',
	'.html': 'text/html', '.htm': 'text/html', '.xml': 'text/xml',
	'.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.ts': 'text/plain', '.css': 'text/css', '.yaml': 'text/plain', '.yml': 'text/plain',
	'.py': 'text/x-python', '.rb': 'text/plain', '.sh': 'text/plain',
	'.pdf': 'application/pdf',
	'.doc': 'application/msword',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
	'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
	'.flac': 'audio/flac', '.aac': 'audio/aac',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
	'.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
});

/** @type {ReadonlyArray<string>} Every extension the strict `files` option reads. */
const READ_FORMATS = Object.freeze(Object.keys(MIME_TYPES));

const TEXT_MIMES = new Set(Object.values(TEXT_MIME_TYPES));
const BINARY_MIMES = new Set(Object.values(BINARY_MIME_TYPES));

/**
 * Formats FileAgent writes, per kind. Image formats depend on the backend
 * (measured 2026-11-20): the Gemini API returns JPEG and rejects
 * `outputMimeType`; Vertex honours image/png and image/jpeg, and 400s on webp.
 */
const WRITE_FORMATS = Object.freeze({
	text: Object.freeze(['txt', 'md', 'csv', 'json', 'yaml', 'yml', 'html', 'xml', 'svg']),
	image: Object.freeze({
		vertex: Object.freeze(['png', 'jpg', 'jpeg']),
		gemini: Object.freeze(['jpg', 'jpeg'])
	}),
	audio: Object.freeze(['wav'])
});

/**
 * Flat list of formats FileAgent writes on one backend.
 * @param {boolean} vertexai
 * @returns {string[]}
 */
function writeFormatsFor(vertexai) {
	return [...WRITE_FORMATS.text, ...WRITE_FORMATS.image[vertexai ? 'vertex' : 'gemini'], ...WRITE_FORMATS.audio];
}

/**
 * Inline request limits in raw bytes (measured 2026-11-20). The Gemini API
 * documents 100 MB (150 MiB was accepted; 240 MiB timed out). Vertex states a
 * 256,000,000-byte cap per inline part; ak-gemini applies it to the total.
 */
const INLINE_LIMIT_BYTES = Object.freeze({ gemini: 100_000_000, vertex: 256_000_000 });

/** Whether an https:// URL works as fileData (measured 2026-11-20, PNG + PDF). */
const HTTPS_URI_SUPPORT = Object.freeze({ gemini: true, vertex: true });

// ── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when a file format cannot be read or written. Lists the supported set. */
class UnsupportedFormatError extends Error {
	/**
	 * @param {string} format - Extension without the dot (or a MIME type)
	 * @param {'read'|'write'} direction
	 * @param {{ vertexai?: boolean, who?: string }} [opts]
	 */
	constructor(format, direction, { vertexai = false, who = 'FileAgent' } = {}) {
		const backend = vertexai ? 'vertex' : 'gemini';
		const shown = format === '' ? 'a file with no extension' : (format.includes('/') ? `"${format}"` : `".${format}"`);
		let message;
		let supported;
		if (direction === 'write') {
			supported = writeFormatsFor(vertexai);
			message = `Cannot write ${shown}. ${who} (${vertexai ? 'Vertex' : 'Gemini API'}) writes: ${supported.map(f => '.' + f).join(' ')}`;
			if (!vertexai && WRITE_FORMATS.image.vertex.includes(format) && !WRITE_FORMATS.image.gemini.includes(format)) {
				const extra = WRITE_FORMATS.image.vertex.filter(f => !WRITE_FORMATS.image.gemini.includes(f));
				message += ` The Gemini API writes images as ${WRITE_FORMATS.image.gemini.map(f => '.' + f).join(' ')} only; Vertex also writes ${extra.map(f => '.' + f).join(' ')}.`;
			}
		} else {
			supported = [...READ_FORMATS];
			message = `Cannot read ${shown}. ak-gemini reads: ${supported.join(' ')}`;
		}
		super(message);
		this.name = 'UnsupportedFormatError';
		this.format = format;
		this.direction = direction;
		this.supported = supported;
		this.backend = backend;
	}
}

// ── MIME helpers ─────────────────────────────────────────────────────────────

/**
 * Lowercased extension of a path or URL (URL: pathname only, so a signed
 * URL's query string is ignored). Includes the dot; '' when there is none.
 * @param {string} nameOrUri
 * @returns {string}
 */
function extOf(nameOrUri) {
	let p = nameOrUri;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(nameOrUri)) {
		try { p = new URL(nameOrUri).pathname; } catch { /* not a parseable URL — use as-is */ }
	}
	return extname(p).toLowerCase();
}

/**
 * Strict MIME type for a file name or URI, or null if unsupported.
 * @param {string} nameOrUri
 * @returns {string|null}
 */
function mimeFromName(nameOrUri) {
	return MIME_TYPES[extOf(nameOrUri)] || null;
}

/** @param {string} mime */
function baseMime(mime) {
	return String(mime).split(';')[0].trim().toLowerCase();
}

// ── Upload + poll (moved from RagAgent) ──────────────────────────────────────

/**
 * Upload a file (path or Blob) via the Files API. Gemini API only.
 * @param {any} client - GoogleGenAI client
 * @param {string|Blob} file
 * @param {{ mimeType: string, displayName?: string }} config
 */
async function uploadFile(client, file, { mimeType, displayName }) {
	return client.files.upload({ file, config: { displayName, mimeType } });
}

/**
 * Poll until an uploaded file reaches ACTIVE.
 * @param {any} client
 * @param {any} file
 * @param {{ intervalMs?: number, timeoutMs?: number }} [opts]
 */
async function waitForFileActive(client, file, { intervalMs = 2000, timeoutMs = 60_000 } = {}) {
	if (file.state === 'ACTIVE') return;

	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const updated = await client.files.get({ name: file.name });
		if (updated.state === 'ACTIVE') return;
		if (updated.state === 'FAILED') {
			throw new Error(`File processing failed: ${file.displayName || file.name}`);
		}
		await new Promise(r => setTimeout(r, intervalMs));
	}
	throw new Error(`File processing timed out after ${timeoutMs / 1000}s: ${file.displayName || file.name}`);
}

// ── Input resolution ─────────────────────────────────────────────────────────

/**
 * Classify one input without any network call. Reads text files; stats binaries.
 * @param {any} input
 * @param {boolean} vertexai
 */
async function classify(input, vertexai) {
	if (typeof input === 'string') {
		if (/^gs:\/\//i.test(input) || /^https?:\/\//i.test(input)) return classifyUri(input, undefined, vertexai);
		const path = resolve(input);
		const name = basename(path);
		const ext = extOf(path);
		// stat first: a missing file throws ENOENT here, before any upload.
		const st = await stat(path);
		if (TEXT_EXTENSIONS.has(ext)) {
			return { kind: 'text', part: { text: `--- File: ${name} ---\n${await readFile(path, 'utf-8')}` } };
		}
		const mimeType = BINARY_MIME_TYPES[ext];
		if (!mimeType) throw new UnsupportedFormatError(ext.replace(/^\./, ''), 'read', { vertexai });
		return { kind: 'binary', path, name, mimeType, size: st.size };
	}

	if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
		throw new Error('A MIME type is required for raw bytes. Pass { data, mimeType } instead of a bare Buffer.');
	}

	if (input && typeof input === 'object') {
		if (typeof input.uri === 'string') return classifyUri(input.uri, input.mimeType, vertexai);
		if (input.data !== undefined) {
			if (!input.mimeType) throw new Error('A MIME type is required: pass { data, mimeType }.');
			const mime = baseMime(input.mimeType);
			if (typeof input.data === 'string' && !/^[A-Za-z0-9+/_-]*={0,2}$/.test(input.data.replace(/\s+/g, ''))) {
				// Node's base64 decoder never throws, so plain text or a data: URL would become garbage.
				throw new Error('A string in { data } must be base64. For plain text pass a Buffer (Buffer.from(text)); strip any "data:...;base64," prefix.');
			}
			const buf = typeof input.data === 'string' ? Buffer.from(input.data, 'base64') : Buffer.from(input.data);
			if (TEXT_MIMES.has(mime) || mime.startsWith('text/')) {
				return { kind: 'text', part: { text: `--- File: ${input.name || 'data'} ---\n${buf.toString('utf-8')}` } };
			}
			if (!BINARY_MIMES.has(mime)) throw new UnsupportedFormatError(mime, 'read', { vertexai });
			return { kind: 'binary', buffer: buf, name: input.name || 'data', mimeType: mime, size: buf.length };
		}
	}

	throw new Error(`Unrecognized file input: ${JSON.stringify(input)?.slice(0, 100)}. Pass a path, a gs:// or https:// URI, { uri, mimeType }, or { data, mimeType }.`);
}

/**
 * @param {string} uri
 * @param {string|undefined} explicitMime
 * @param {boolean} vertexai
 */
function classifyUri(uri, explicitMime, vertexai) {
	if (/^gs:\/\//i.test(uri) && !vertexai) {
		throw new Error(`gs:// URIs work only on Vertex AI (${uri}). On the Gemini API pass a local path, an https:// URL, or { data, mimeType }.`);
	}
	if (/^https?:\/\//i.test(uri) && !HTTPS_URI_SUPPORT[vertexai ? 'vertex' : 'gemini']) {
		throw new Error(`https:// URIs are not accepted as file data on this backend (${uri}).`);
	}
	let mimeType;
	if (explicitMime) {
		mimeType = baseMime(explicitMime);
		if (!BINARY_MIMES.has(mimeType) && !TEXT_MIMES.has(mimeType)) throw new UnsupportedFormatError(mimeType, 'read', { vertexai });
	} else {
		mimeType = mimeFromName(uri);
		if (!mimeType) throw new UnsupportedFormatError(extOf(uri).replace(/^\./, ''), 'read', { vertexai });
	}
	return { kind: 'uri', part: { fileData: { fileUri: uri, mimeType } } };
}

/**
 * Resolve file inputs into Gemini `Part`s.
 *
 * Inline accounting is on the TOTAL of inline bytes in the request (plus
 * `inlineBytesUsed`, e.g. bytes already in chat history). Gemini API: files over
 * the limit upload, then the largest remaining upload until the rest fits.
 * Vertex cannot upload: over the limit throws and names gs:// URIs.
 *
 * @param {any} files - One input or an array
 * @param {any} client - GoogleGenAI client (only used to upload)
 * @param {{ vertexai?: boolean, alwaysUpload?: boolean, inlineBytesUsed?: number, inlineLimit?: number, withRetry?: (fn: () => Promise<any>) => Promise<any> }} [opts]
 * @returns {Promise<{ parts: any[], uploaded: Array<{ name: string, uri: string, mimeType: string, displayName: string, sizeBytes: string }> }>}
 */
async function toParts(files, client, opts = {}) {
	const {
		vertexai = false,
		alwaysUpload = false,
		inlineBytesUsed = 0,
		withRetry = fn => fn(),
		inlineLimit = INLINE_LIMIT_BYTES[vertexai ? 'vertex' : 'gemini']
	} = opts;
	const list = files == null ? [] : (Array.isArray(files) ? files : [files]);

	// 1. Classify everything before any network call.
	const items = [];
	for (const input of list) items.push(await classify(input, vertexai));

	// 2. Decide inline vs upload.
	const binaries = items.filter(i => i.kind === 'binary');
	if (vertexai) {
		const total = inlineBytesUsed + binaries.reduce((s, b) => s + b.size, 0);
		if (total > inlineLimit) {
			throw new Error(
				`Inline files total ${total} bytes${inlineBytesUsed ? ` (including ${inlineBytesUsed} already in this conversation)` : ''}, ` +
				`over the Vertex inline limit of ${inlineLimit} bytes. Vertex cannot upload files; pass a gs:// URI instead.`
			);
		}
	} else {
		for (const b of binaries) if (alwaysUpload || b.size > inlineLimit) b.upload = true;
		let total = inlineBytesUsed + binaries.filter(b => !b.upload).reduce((s, b) => s + b.size, 0);
		const remaining = binaries.filter(b => !b.upload).sort((a, b) => b.size - a.size);
		while (total > inlineLimit && remaining.length) {
			const b = /** @type {any} */ (remaining.shift());
			b.upload = true;
			total -= b.size;
		}
	}

	// 3. Build parts in input order.
	const parts = [];
	const uploaded = [];
	for (const item of items) {
		if (item.kind !== 'binary') { parts.push(item.part); continue; }
		if (item.upload) {
			const source = item.path ?? new Blob([item.buffer], { type: item.mimeType });
			let f;
			try {
				f = await withRetry(() => uploadFile(client, source, { mimeType: item.mimeType, displayName: item.name }));
				await waitForFileActive(client, f);
			} catch (error) {
				// Report every upload made so far (including one that failed to go
				// ACTIVE) so the caller can delete them.
				error.uploaded = f ? [...uploaded, { name: f.name, uri: f.uri, mimeType: f.mimeType || item.mimeType, displayName: f.displayName || item.name, sizeBytes: f.sizeBytes }] : [...uploaded];
				throw error;
			}
			uploaded.push({ name: f.name, uri: f.uri, mimeType: f.mimeType || item.mimeType, displayName: f.displayName || item.name, sizeBytes: f.sizeBytes });
			parts.push({ fileData: { fileUri: f.uri, mimeType: f.mimeType || item.mimeType } });
		} else {
			const buf = item.buffer ?? await readFile(item.path);
			parts.push({ inlineData: { data: buf.toString('base64'), mimeType: item.mimeType } });
		}
	}

	return { parts, uploaded };
}

// ── WAV / PCM ────────────────────────────────────────────────────────────────

/**
 * Wrap raw little-endian PCM in a 44-byte RIFF/WAVE header.
 * @param {Buffer} pcm
 * @param {{ sampleRate: number, channels?: number, bitsPerSample?: number }} fmt
 * @returns {Buffer}
 */
function pcmToWav(pcm, { sampleRate, channels = 1, bitsPerSample = 16 }) {
	const blockAlign = channels * bitsPerSample / 8;
	const h = Buffer.alloc(44);
	h.write('RIFF', 0, 'ascii');
	h.writeUInt32LE(36 + pcm.length, 4);
	h.write('WAVE', 8, 'ascii');
	h.write('fmt ', 12, 'ascii');
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20);                       // PCM
	h.writeUInt16LE(channels, 22);
	h.writeUInt32LE(sampleRate, 24);
	h.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
	h.writeUInt16LE(blockAlign, 32);
	h.writeUInt16LE(bitsPerSample, 34);
	h.write('data', 36, 'ascii');
	h.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([h, pcm]);
}

/**
 * Read the PCM format from an `audio/L16` MIME type
 * (e.g. `audio/L16;codec=pcm;rate=24000` or `audio/l16; rate=24000; channels=1`).
 * @param {string} mime
 * @returns {{ sampleRate: number, channels: number }}
 */
function parsePcmMime(mime) {
	const m = String(mime).toLowerCase();
	if (!/^audio\/(l16|pcm)\b/.test(m)) throw new Error(`Unexpected audio MIME type "${mime}"; expected audio/L16 PCM.`);
	const rate = m.match(/rate=(\d+)/);
	if (!rate) throw new Error(`Audio MIME type "${mime}" has no sample rate.`);
	const ch = m.match(/channels=(\d+)/);
	return { sampleRate: Number(rate[1]), channels: ch ? Number(ch[1]) : 1 };
}

/**
 * Extract PCM and its format from a PCM WAV file.
 * @param {Buffer} wav
 * @returns {{ pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number }}
 */
function wavToPcm(wav) {
	if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
		throw new Error('Audio bytes are not a WAV file (missing RIFF/WAVE header).');
	}
	let fmt = null;
	let off = 12;
	while (off + 8 <= wav.length) {
		const id = wav.toString('ascii', off, off + 4);
		let size = wav.readUInt32LE(off + 4);
		const body = off + 8;
		if (id === 'fmt ') {
			const format = wav.readUInt16LE(body);
			if (format !== 1) throw new Error(`WAV audio format ${format} is not PCM.`);
			fmt = { channels: wav.readUInt16LE(body + 2), sampleRate: wav.readUInt32LE(body + 4), bitsPerSample: wav.readUInt16LE(body + 14) };
		} else if (id === 'data') {
			if (!fmt) throw new Error('WAV file has a data chunk before its fmt chunk.');
			// Streamed WAVs may carry 0xFFFFFFFF or an overlong size: take what is there.
			if (size > wav.length - body) size = wav.length - body;
			return { pcm: wav.subarray(body, body + size), ...fmt };
		}
		off = body + size + (size % 2);
	}
	throw new Error('WAV file has no data chunk.');
}

export {
	MIME_TYPES, LEGACY_MIME_TYPES, TEXT_EXTENSIONS, READ_FORMATS, WRITE_FORMATS, INLINE_LIMIT_BYTES, HTTPS_URI_SUPPORT,
	writeFormatsFor, UnsupportedFormatError, mimeFromName, uploadFile, waitForFileActive, toParts,
	pcmToWav, parsePcmMime, wavToPcm
};
