/**
 * @fileoverview Offline (mocked) unit tests for the 2026-07 consumer-review fixes.
 * These do NOT hit the real API — the genAIClient is stubbed on the instance.
 * Covers: responseMimeType auto-pairing (#1), init() healthCheck gating (#3),
 * concurrency-safe per-call usage (#4), estimatedCost + alias pricing (#5).
 */

import { jest } from '@jest/globals';
import { Message, Chat } from '../index.js';
import { validateSchema, resolvePricing, computeCost, MODEL_PRICING, MODEL_ALIASES, MODEL_PRICING_AS_OF, EFFORT_LEVELS } from '../index.js';

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
			// gemini-2.5-flash: input 0.30, output 3.00 per M
			expect(r.usage.estimatedCost).toBeCloseTo(0.30 + 3.00, 5);
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
			expect(resolvePricing('gemini-flash-latest')).toEqual(resolvePricing('gemini-3.6-flash'));
			expect(resolvePricing('gemini-flash-lite-latest')).toEqual(resolvePricing('gemini-3.5-flash-lite'));
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

		// S1: nullable, deep-equal enum, prototype-chain keys
		it('allows null on a nullable field', () => {
			const s = { type: 'object', properties: { note: { type: 'string', nullable: true } } };
			expect(validateSchema({ note: null }, s)).toEqual([]);
			expect(validateSchema({ note: 'hi' }, s)).toEqual([]);
		});

		it('deep-equals object/array enum members', () => {
			const s = { enum: [{ a: 1 }, [1, 2]] };
			expect(validateSchema({ a: 1 }, s)).toEqual([]);
			expect(validateSchema([1, 2], s)).toEqual([]);
			expect(validateSchema({ a: 2 }, s).length).toBeGreaterThan(0);
		});

		it('does not treat prototype keys as present (Object.hasOwn)', () => {
			const s = { type: 'object', additionalProperties: false, properties: { x: { type: 'number' } } };
			// 'toString' is on the prototype but NOT an own key — must be allowed absent
			expect(validateSchema({ x: 1 }, s)).toEqual([]);
			// required 'toString' must report missing even though 'toString' in {} is true
			const s2 = { type: 'object', required: ['toString'] };
			expect(validateSchema({}, s2).some(e => e.includes('toString'))).toBe(true);
		});
	});

	// ── #3 thinking tokens in usage + cost ──
	describe('#3 thoughtsTokens billed at output rate', () => {
		it('includes thoughts in totalTokens and estimatedCost', async () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-2.5-flash' });
			msg.genAIClient = {
				models: {
					generateContent: jest.fn(async () => ({
						text: 'r',
						modelVersion: 'gemini-2.5-flash',
						usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000, thoughtsTokenCount: 1_000_000, totalTokenCount: 3_000_000 }
					})),
					list: jest.fn()
				}
			};
			const r = await msg.send('hi');
			expect(r.usage.thoughtsTokens).toBe(1_000_000);
			expect(r.usage.totalTokens).toBe(3_000_000);
			// input 0.30 + (candidates 1M + thoughts 1M) * output 3.00 = 0.30 + 6.00
			expect(r.usage.estimatedCost).toBeCloseTo(0.30 + 6.00, 5);
		});
	});

	// ── #1 estimateCost() uses resolvePricing (via Chat — Message.estimate is a no-op) ──
	describe('#1 estimateCost resolves aliases and nulls unknown', () => {
		function stubCount(inst, tokens) {
			inst.genAIClient = { models: { countTokens: jest.fn(async () => ({ totalTokens: tokens })), list: jest.fn() } };
		}
		it('resolves a -latest alias (non-null cost)', async () => {
			const chat = new Chat({ ...KEY, modelName: 'gemini-flash-latest' });
			stubCount(chat, 1_000_000);
			const c = await chat.estimateCost('hi');
			expect(c.estimatedInputCost).not.toBeNull();
			expect(c.pricing).not.toBeNull();
		});
		it('returns null for an unknown model', async () => {
			const chat = new Chat({ ...KEY, modelName: 'totally-made-up' });
			stubCount(chat, 1000);
			const c = await chat.estimateCost('hi');
			expect(c.estimatedInputCost).toBeNull();
			expect(c.pricing).toBeNull();
		});
	});

	// ── 2.6.0: cached-token billing (B3) ──
	describe('B3 cached tokens are a SUBSET of promptTokens', () => {
		function cachedResponse(prompt, cached, candidates, modelVersion = 'gemini-2.5-flash') {
			return {
				text: 'r',
				modelVersion,
				usageMetadata: {
					promptTokenCount: prompt,
					cachedContentTokenCount: cached,
					candidatesTokenCount: candidates,
					totalTokenCount: prompt + candidates
				}
			};
		}

		it('surfaces cachedTokens on the per-call usage', async () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-2.5-flash' });
			stubGen(msg, jest.fn(async () => cachedResponse(10_000, 8_000, 0)));
			const r = await msg.send('hi');
			expect(r.usage.cachedTokens).toBe(8_000);
			expect(r.usage.promptTokens).toBe(10_000);   // still the full count, cache included
		});

		it('bills 2000 at the input rate and 8000 at the cached rate', async () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-2.5-flash' });
			stubGen(msg, jest.fn(async () => cachedResponse(10_000, 8_000, 0)));
			const r = await msg.send('hi');
			// gemini-2.5-flash: input 0.30, cachedInput 0.05
			const expected = (2_000 / 1e6) * 0.30 + (8_000 / 1e6) * 0.05;
			expect(r.usage.estimatedCost).toBeCloseTo(expected, 10);
		});

		it('getLastUsage() reports the same cachedTokens as result.usage', async () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-2.5-flash' });
			stubGen(msg, jest.fn(async () => cachedResponse(10_000, 8_000, 0)));
			const r = await msg.send('hi');
			expect(msg.getLastUsage().cachedTokens).toBe(r.usage.cachedTokens);
			expect(msg.getLastUsage().estimatedCost).toBeCloseTo(r.usage.estimatedCost, 10);
		});

		it('computeCost never double-charges when cached >= prompt', () => {
			// Defensive: a malformed response must not produce a negative billable count.
			expect(computeCost('gemini-2.5-flash', 1_000, 0, 0, 5_000)).toBeCloseTo((1_000 / 1e6) * 0.05, 10);
		});

		it('falls back to the full input rate when no cachedInput is published', () => {
			// gemini-2.0-flash has no cachedInput → cached tokens bill at input (overestimate)
			expect(computeCost('gemini-2.0-flash', 1_000_000, 0, 0, 1_000_000)).toBeCloseTo(0.10, 10);
		});
	});

	// ── 2.6.0: tiered pricing (B4) ──
	describe('B4 >200k context tier', () => {
		it('uses the base rate at or below 200k and the tier rate above', () => {
			expect(computeCost('gemini-2.5-pro', 200_000, 0)).toBeCloseTo((200_000 / 1e6) * 1.25, 10);
			expect(computeCost('gemini-2.5-pro', 200_001, 0)).toBeCloseTo((200_001 / 1e6) * 2.50, 10);
		});

		it('switches the output and cached rates with the tier', () => {
			expect(computeCost('gemini-2.5-pro', 300_000, 1_000_000)).toBeCloseTo((300_000 / 1e6) * 2.50 + 15.00, 10);
			// 300k prompt, 100k of it cached → cachedInputAbove200k 0.25
			const expected = (200_000 / 1e6) * 2.50 + (100_000 / 1e6) * 0.25;
			expect(computeCost('gemini-2.5-pro', 300_000, 0, 0, 100_000)).toBeCloseTo(expected, 10);
		});

		it('leaves untiered models on a single rate', () => {
			expect(computeCost('gemini-3.6-flash', 1_000_000, 0)).toBeCloseTo(1.50, 10);
		});
	});

	// ── 2.6.0: pricing table coverage + freshness (B1/B5) ──
	describe('B1/B5 pricing table', () => {
		it('prices every table key and stamps asOf', () => {
			for (const id of Object.keys(MODEL_PRICING)) {
				const p = resolvePricing(id);
				expect(p).not.toBeNull();
				expect(typeof p.input).toBe('number');
				expect(typeof p.output).toBe('number');
				expect(p.asOf).toBe(MODEL_PRICING_AS_OF);
				expect(p.tierThreshold).toBe(200_000);
			}
		});

		it('resolves every alias to a priced model', () => {
			for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
				expect(MODEL_PRICING[canonical]).toBeDefined();
				expect(resolvePricing(alias)).toEqual(resolvePricing(canonical));
			}
		});

		it('includes the newly added models', () => {
			expect(resolvePricing('gemini-3.6-flash')).toMatchObject({ input: 1.50, output: 7.50, cachedInput: 0.15 });
			expect(resolvePricing('gemini-3.5-flash-lite')).toMatchObject({ input: 0.30, output: 2.50, cachedInput: 0.03 });
		});
	});

	// ── 2.6.0: effort → thinkingLevel (B6) ──
	describe('B6 effort maps to thinkingLevel', () => {
		it('sets thinkingLevel and drops thinkingBudget', () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-3.5-flash', effort: 'low' });
			expect(msg.chatConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
		});

		it('clamps ak-claude-only levels to high', () => {
			for (const level of ['xhigh', 'max']) {
				const msg = new Message({ ...KEY, modelName: 'gemini-3.5-flash', effort: level });
				expect(msg.chatConfig.thinkingConfig.thinkingLevel).toBe('high');
			}
		});

		it('wins over an explicit thinkingBudget', () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-3.5-flash', effort: 'medium', thinkingConfig: { thinkingBudget: 4096 } });
			expect(msg.chatConfig.thinkingConfig.thinkingLevel).toBe('medium');
			expect(msg.chatConfig.thinkingConfig.thinkingBudget).toBeUndefined();
		});

		it('leaves thinkingConfig alone when effort is unset', () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-3.5-flash' });
			expect(msg.chatConfig.thinkingConfig).toBeUndefined();
		});

		it('is ignored on a model with no thinking support', () => {
			const msg = new Message({ ...KEY, modelName: 'gemini-3.1-flash-image-preview', effort: 'high' });
			expect(msg.chatConfig.thinkingConfig).toBeUndefined();
		});

		it('rejects an unknown effort level at construction', () => {
			expect(() => new Message({ ...KEY, effort: 'turbo' })).toThrow(/Invalid effort/);
			expect(EFFORT_LEVELS).toContain('minimal');
		});
	});
});
