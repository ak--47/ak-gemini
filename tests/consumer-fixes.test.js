/**
 * @fileoverview Offline (mocked) unit tests for the 2026-07 consumer-review fixes.
 * These do NOT hit the real API — the genAIClient is stubbed on the instance.
 * Covers: responseMimeType auto-pairing (#1), init() healthCheck gating (#3),
 * concurrency-safe per-call usage (#4), estimatedCost + alias pricing (#5).
 */

import { jest } from '@jest/globals';
import { Message } from '../index.js';
import { validateSchema, resolvePricing, computeCost } from '../index.js';

const KEY = { apiKey: 'test-key', logLevel: 'silent' };

/** Replace the SDK client with a stub so nothing hits the network. */
function stubGen(msg, generateContent, list) {
	msg.genAIClient = {
		models: {
			generateContent: generateContent || jest.fn(),
			list: list || jest.fn(async () => [])
		}
	};
}

function fakeResponse(text, prompt, candidates, modelVersion = 'gemini-2.5-flash') {
	return {
		text,
		modelVersion,
		usageMetadata: {
			promptTokenCount: prompt,
			candidatesTokenCount: candidates,
			totalTokenCount: prompt + candidates
		}
	};
}

describe('consumer-fixes (ak-gemini)', () => {

	// ── #1 responseMimeType auto-pairing ──
	describe('#1 responseSchema auto-pairs responseMimeType', () => {
		const schema = { type: 'object', properties: { a: { type: 'string' } } };

		it('defaults responseMimeType to application/json when only responseSchema given', () => {
			const msg = new Message({ ...KEY, responseSchema: schema });
			expect(msg.chatConfig.responseMimeType).toBe('application/json');
			expect(msg.chatConfig.responseSchema).toBe(schema);
		});

		it('respects an explicit responseMimeType', () => {
			const msg = new Message({ ...KEY, responseSchema: schema, responseMimeType: 'text/x.enum' });
			expect(msg.chatConfig.responseMimeType).toBe('text/x.enum');
		});

		it('does not set responseMimeType when no schema and no mime type', () => {
			const msg = new Message({ ...KEY });
			expect(msg.chatConfig.responseMimeType).toBeUndefined();
		});
	});

	// ── #3 init() healthCheck gating ──
	describe('#3 init() does not call models.list() unless healthCheck', () => {
		it('performs no network call on init by default', async () => {
			const msg = new Message({ ...KEY });
			const list = jest.fn(async () => []);
			stubGen(msg, jest.fn(), list);
			await msg.init();
			expect(list).not.toHaveBeenCalled();
		});

		it('calls models.list() when healthCheck: true', async () => {
			const msg = new Message({ ...KEY, healthCheck: true });
			const list = jest.fn(async () => []);
			stubGen(msg, jest.fn(), list);
			await msg.init();
			expect(list).toHaveBeenCalledTimes(1);
		});
	});

	// ── #4 concurrency-safe per-call usage ──
	describe('#4 concurrent send() results carry their own usage', () => {
		it('does not cross-talk usage between concurrent sends', async () => {
			const msg = new Message({ ...KEY });
			// token count keyed by payload; delays interleave completion order
			const N = { A: 10, B: 20, C: 30 };
			const D = { A: 30, B: 10, C: 20 };
			const generateContent = jest.fn(async ({ contents }) => {
				const txt = contents[0].parts[0].text;
				await new Promise(r => setTimeout(r, D[txt]));
				return fakeResponse(`resp-${txt}`, N[txt], N[txt] * 2);
			});
			stubGen(msg, generateContent);

			const [ra, rb, rc] = await Promise.all([msg.send('A'), msg.send('B'), msg.send('C')]);
			expect(ra.usage.promptTokens).toBe(10);
			expect(ra.usage.responseTokens).toBe(20);
			expect(ra.usage.totalTokens).toBe(30);
			expect(rb.usage.totalTokens).toBe(60);
			expect(rc.usage.totalTokens).toBe(90);
		});
	});

	// ── #5 estimatedCost + alias pricing ──
	describe('#5 estimatedCost in usage', () => {
		it('computes non-null estimatedCost for a priced model', async () => {
			const msg = new Message({ ...KEY });
			stubGen(msg, jest.fn(async () => fakeResponse('r', 1_000_000, 1_000_000, 'gemini-2.5-flash')));
			const r = await msg.send('hi');
			// gemini-2.5-flash: input 0.30, output 2.50 per M
			expect(r.usage.estimatedCost).toBeCloseTo(0.30 + 2.50, 5);
		});

		it('returns null estimatedCost when neither modelVersion nor requestedModel is priced', async () => {
			const msg = new Message({ ...KEY, modelName: 'some-unknown-model' });
			stubGen(msg, jest.fn(async () => fakeResponse('r', 100, 100, 'some-unknown-model')));
			const r = await msg.send('hi');
			expect(r.usage.estimatedCost).toBeNull();
		});

		it('falls back to requestedModel pricing when modelVersion is unknown', async () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-2.5-flash' });
			stubGen(msg, jest.fn(async () => fakeResponse('r', 1_000_000, 0, 'some-weird-unpriced-build')));
			const r = await msg.send('hi');
			expect(r.usage.estimatedCost).toBeCloseTo(0.30, 5);
		});

		it('resolves -latest aliases for pricing', () => {
			expect(resolvePricing('gemini-flash-latest')).toEqual(resolvePricing('gemini-3.5-flash'));
			expect(resolvePricing('gemini-pro-latest')).toEqual(resolvePricing('gemini-3.1-pro-preview'));
			expect(resolvePricing('totally-made-up')).toBeNull();
		});

		it('resolves version-suffixed builds the API echoes in modelVersion', () => {
			// API returns a pinned build (e.g. -001) even when you request the bare id
			expect(resolvePricing('gemini-2.5-flash-001')).toEqual(resolvePricing('gemini-2.5-flash'));
			expect(resolvePricing('gemini-3-flash-preview-09-2025')).toEqual(resolvePricing('gemini-3-flash-preview'));
		});

		it('estimatedCost is non-null when modelVersion carries a build suffix', async () => {
			const msg = new Message({ ...KEY });
			stubGen(msg, jest.fn(async () => fakeResponse('r', 1_000_000, 0, 'gemini-2.5-flash-001')));
			const r = await msg.send('hi');
			expect(r.usage.estimatedCost).toBeCloseTo(0.30, 5);
		});

		it('computeCost returns null for unknown model', () => {
			expect(computeCost('nope', 100, 100)).toBeNull();
			expect(computeCost('gemini-2.5-flash', 1_000_000, 0)).toBeCloseTo(0.30, 5);
		});
	});

	// ── validateSchema (shared helper) ──
	describe('validateSchema()', () => {
		const schema = {
			type: 'object',
			required: ['source', 'count'],
			additionalProperties: false,
			properties: {
				source: { type: 'string', enum: ['web', 'db'] },
				count: { type: 'integer' },
				tags: { type: 'array', items: { type: 'string' } }
			}
		};

		it('passes a valid object', () => {
			expect(validateSchema({ source: 'web', count: 3, tags: ['a'] }, schema)).toEqual([]);
		});

		it('flags a bad enum value', () => {
			const errs = validateSchema({ source: 'ftp', count: 1 }, schema);
			expect(errs.some(e => e.includes('enum'))).toBe(true);
		});

		it('flags a missing required key', () => {
			const errs = validateSchema({ source: 'web' }, schema);
			expect(errs.some(e => e.includes('count'))).toBe(true);
		});

		it('flags an unexpected property', () => {
			const errs = validateSchema({ source: 'web', count: 1, extra: true }, schema);
			expect(errs.some(e => e.includes('extra'))).toBe(true);
		});

		it('flags a wrong type', () => {
			const errs = validateSchema({ source: 'web', count: 'x' }, schema);
			expect(errs.some(e => e.includes('count') && e.includes('integer'))).toBe(true);
		});

		it('flags a bad array item type', () => {
			const errs = validateSchema({ source: 'web', count: 1, tags: ['a', 5] }, schema);
			expect(errs.some(e => e.includes('tags[1]'))).toBe(true);
		});
	});
});
