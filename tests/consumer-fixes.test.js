/**
 * @fileoverview Offline (mocked) unit tests for the 2026-07 consumer-review fixes.
 * These do NOT hit the real API — the genAIClient is stubbed on the instance.
 * Covers: responseMimeType auto-pairing (#1), init() healthCheck gating (#3),
 * concurrency-safe per-call usage (#4), estimatedCost + alias pricing (#5).
 */

import { jest } from '@jest/globals';
import { Message, Chat, Transformer, ToolAgent } from '../index.js';
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
			expect(resolvePricing('gemini-flash-latest')).toEqual(resolvePricing('gemini-3.7-flash'));
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
			// input 0.30 + (candidates 1M + thoughts 1M) * output 2.50 = 0.30 + 5.00
			expect(r.usage.estimatedCost).toBeCloseTo(0.30 + 5.00, 5);
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
			// gemini-2.5-flash: input 0.30, cachedInput 0.03
			const expected = (2_000 / 1e6) * 0.30 + (8_000 / 1e6) * 0.03;
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
			expect(computeCost('gemini-2.5-flash', 1_000, 0, 0, 5_000)).toBeCloseTo((1_000 / 1e6) * 0.03, 10);
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
			// 3.6-flash is untiered, and on its promo rate until 2026-12-31.
			expect(computeCost('gemini-3.6-flash', 1_000_000, 0, 0, 0, { at: '2026-08-24' })).toBeCloseTo(0.75, 10);
			expect(computeCost('gemini-3.6-flash', 1_000_000, 0, 0, 0, { at: '2027-01-01' })).toBeCloseTo(1.50, 10);
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
			expect(resolvePricing('gemini-3.6-flash', { at: '2027-01-01' })).toMatchObject({ input: 1.50, output: 7.50, cachedInput: 0.15 });
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

	// ── 2.6.2: per-message labels must not discard the session config ──
	describe('per-message labels preserve the create-time generation config', () => {
		const schema = { type: 'object', properties: { canary: { type: 'string' } }, required: ['canary'] };

		/**
		 * Stubs `chats.create` with a fake that reproduces the SDK's replace
		 * semantics: `config: params.config ?? this.config` (@google/genai
		 * dist/index.mjs, Chat#sendMessage). `seen` collects the config that
		 * each send actually resolved to.
		 */
		function stubChats(instance, seen, text) {
			instance.genAIClient = {
				models: { list: jest.fn(async () => []) },
				chats: {
					create: jest.fn((createOpts) => ({
						config: createOpts.config,
						getHistory: () => [],
						async sendMessage(params) {
							seen.push(params.config ?? this.config);
							return fakeResponse(text, 10, 5);
						},
						async sendMessageStream(params) {
							seen.push(params.config ?? this.config);
							return (async function* () { yield fakeResponse(text, 10, 5); })();
						}
					}))
				}
			};
		}

		const vertexOpts = {
			logLevel: 'silent',
			vertexai: true,
			project: 'test-project',
			labels: { app: 'my-app', component: 'probe' },
			systemPrompt: 'You are a canary.',
			// Chat has no top-level responseSchema option — it goes through chatConfig,
			// which is exactly the shape the production repro used.
			chatConfig: { responseMimeType: 'application/json', responseSchema: schema }
		};

		it('Chat.send keeps systemInstruction/responseSchema alongside labels', async () => {
			const seen = [];
			const chat = new Chat(vertexOpts);
			stubChats(chat, seen, 'ok');
			await chat.init();
			await chat.send('hello');

			expect(seen).toHaveLength(1);
			expect(seen[0].systemInstruction).toBe('You are a canary.');
			expect(seen[0].responseSchema).toBe(schema);
			expect(seen[0].responseMimeType).toBe('application/json');
			expect(seen[0].labels).toEqual({ app: 'my-app', component: 'probe' });
		});

		it('Chat.send merges per-message labels over instance labels', async () => {
			const seen = [];
			const chat = new Chat(vertexOpts);
			stubChats(chat, seen, 'ok');
			await chat.init();
			await chat.send('hello', { labels: { component: 'override', extra: 'x' } });

			expect(seen[0].systemInstruction).toBe('You are a canary.');
			expect(seen[0].labels).toEqual({ app: 'my-app', component: 'override', extra: 'x' });
		});

		it('Chat.stream keeps the session config and applies per-message labels', async () => {
			const seen = [];
			const chat = new Chat(vertexOpts);
			stubChats(chat, seen, 'ok');
			await chat.init();
			// eslint-disable-next-line no-empty
			for await (const _ of chat.stream('hello', { labels: { component: 'streamed' } })) { }

			expect(seen[0].systemInstruction).toBe('You are a canary.');
			expect(seen[0].responseSchema).toBe(schema);
			expect(seen[0].labels).toEqual({ app: 'my-app', component: 'streamed' });
		});

		it('Transformer.rawSend keeps systemInstruction/responseSchema alongside labels', async () => {
			const seen = [];
			const tf = new Transformer(vertexOpts);
			stubChats(tf, seen, '{"canary":"alive"}');
			await tf.init();
			const out = await tf.rawSend('hello');

			expect(out).toEqual({ canary: 'alive' });
			expect(seen[0].systemInstruction).toBe('You are a canary.');
			expect(seen[0].responseSchema).toBe(schema);
			expect(seen[0].labels).toEqual({ app: 'my-app', component: 'probe' });
		});

		it('ToolAgent.chat applies per-message labels without dropping tools', async () => {
			const seen = [];
			const agent = new ToolAgent({
				...vertexOpts,
				tools: [{ name: 'noop', description: 'does nothing', parametersJsonSchema: { type: 'object' } }],
				toolExecutor: async () => 'done'
			});
			stubChats(agent, seen, 'ok');
			await agent.init();
			await agent.chat('hello', { labels: { component: 'agent' } });

			expect(seen[0].systemInstruction).toBe('You are a canary.');
			expect(seen[0].tools).toBeDefined();
			expect(seen[0].labels).toEqual({ app: 'my-app', component: 'agent' });
		});

		it('carries grounding tools and cachedContent into stateless Message.send', async () => {
			// #7 — grounding tools and cachedContent live in _getChatCreateOptions(),
			// not chatConfig, so a config built from chatConfig alone dropped both.
			const seenConfig = [];
			const msg = new Message({ ...KEY, systemPrompt: 'sys', enableGrounding: true });
			msg.cachedContent = 'caches/abc';
			stubGen(msg, jest.fn(async (req) => { seenConfig.push(req.config); return fakeResponse('ok', 1, 1); }));
			await msg.send('hi');

			expect(seenConfig[0].tools).toEqual([{ googleSearch: {} }]);
			expect(seenConfig[0].cachedContent).toBe('caches/abc');
			// #9 — a cache carries its own system instruction; strip it for this call
			expect(seenConfig[0].systemInstruction).toBeUndefined();
		});

		it('does not attach labels on the non-vertex path', async () => {
			const seen = [];
			const chat = new Chat({ ...KEY, systemPrompt: 'You are a canary.', labels: { app: 'my-app' } });
			stubChats(chat, seen, 'ok');
			await chat.init();
			await chat.send('hello', { labels: { component: 'probe' } });

			expect(seen[0].systemInstruction).toBe('You are a canary.');
			expect(seen[0].labels).toBeUndefined();
		});
	});

	// ── 2.7.0: streaming usage, chunk handling, retry class, cache detach ──
	describe('2.7.0 defect sweep', () => {
		/** Chunk with usageMetadata attached. */
		const usageChunk = (prompt, candidates) => ({
			usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: candidates, totalTokenCount: prompt + candidates },
			modelVersion: 'gemini-2.5-flash'
		});
		const textChunk = (...parts) => ({ candidates: [{ content: { parts } }] });

		/** Stubs a chat session that replays scripted chunk arrays, one array per round. */
		function stubStream(instance, rounds) {
			let round = 0;
			instance.genAIClient = {
				models: { list: jest.fn(async () => []) },
				chats: {
					create: jest.fn((createOpts) => ({
						config: createOpts.config,
						getHistory: () => [],
						async sendMessage() { return { ...usageChunk(100, 50), text: 'ok' }; },
						async sendMessageStream() {
							const chunks = rounds[round++] || [];
							return (async function* () { for (const c of chunks) yield c; })();
						}
					}))
				}
			};
		}

		// ── #1 stream() usage ──
		it('Chat.stream reports real usage on the done event', async () => {
			const chat = new Chat({ ...KEY, modelName: 'gemini-2.5-flash' });
			stubStream(chat, [[textChunk({ text: 'hi' }), usageChunk(1_000_000, 0)]]);
			await chat.init();

			let done = null;
			for await (const ev of chat.stream('hello')) if (ev.type === 'done') done = ev;

			expect(done.usage).not.toBeNull();
			expect(done.usage.promptTokens).toBe(1_000_000);
			expect(done.usage.estimatedCost).toBeCloseTo(0.30, 5);
		});

		it('Chat.stream does not report stale usage from an earlier call', async () => {
			const chat = new Chat({ ...KEY, modelName: 'gemini-2.5-flash' });
			stubStream(chat, [[textChunk({ text: 'a' }), usageChunk(10, 5)]]);
			await chat.init();
			// Seed stale instance state, as a prior non-streaming send would.
			chat._captureMetadata({ ...usageChunk(999_999, 999_999) });

			let done = null;
			for await (const ev of chat.stream('hello')) if (ev.type === 'done') done = ev;
			expect(done.usage.promptTokens).toBe(10);
		});

		// ── #2 text alongside functionCall ──
		it('ToolAgent.stream keeps text emitted in the same chunk as a functionCall', async () => {
			const agent = new ToolAgent({
				...KEY, modelName: 'gemini-2.5-flash',
				tools: [{ name: 'noop', description: 'n', parametersJsonSchema: { type: 'object' } }],
				toolExecutor: async () => 'done'
			});
			// Round 0: preamble text AND a functionCall in one chunk. Round 1: final answer.
			stubStream(agent, [
				[{ functionCalls: [{ id: '1', name: 'noop', args: {} }], ...textChunk({ text: 'Let me look that up…' }) }, usageChunk(10, 5)],
				[textChunk({ text: 'Found it.' }), usageChunk(20, 10)]
			]);
			await agent.init();

			const texts = [];
			let done = null;
			for await (const ev of agent.stream('hi')) {
				if (ev.type === 'text') texts.push(ev.text);
				if (ev.type === 'done') done = ev;
			}
			expect(texts).toContain('Let me look that up…');
			expect(done.fullText).toBe('Let me look that up…Found it.');
		});

		// ── #3 multi-part chunks ──
		it('Chat.stream reads every part and skips thought summaries', async () => {
			const chat = new Chat({ ...KEY, modelName: 'gemini-2.5-flash' });
			stubStream(chat, [[
				textChunk({ text: 'thinking out loud', thought: true }, { text: 'part one ' }, { text: 'part two' }),
				usageChunk(10, 5)
			]]);
			await chat.init();

			let done = null;
			for await (const ev of chat.stream('hello')) if (ev.type === 'done') done = ev;
			expect(done.fullText).toBe('part one part two');
		});

		// ── #5 multi-round token accounting ──
		it('ToolAgent.chat sums tokens across every round', async () => {
			const agent = new ToolAgent({
				...KEY, modelName: 'gemini-2.5-flash',
				tools: [{ name: 'noop', description: 'n', parametersJsonSchema: { type: 'object' } }],
				toolExecutor: async () => 'done'
			});
			let call = 0;
			const responses = [
				{ ...usageChunk(100, 10), functionCalls: [{ id: '1', name: 'noop', args: {} }], text: '' },
				{ ...usageChunk(200, 20), text: 'final' }
			];
			agent.genAIClient = {
				models: { list: jest.fn(async () => []) },
				chats: { create: jest.fn((o) => ({ config: o.config, getHistory: () => [], sendMessage: async () => responses[call++] })) }
			};
			await agent.init();
			const r = await agent.chat('hi');

			expect(r.usage.promptTokens).toBe(300);   // 100 + 200, not just the final round
			expect(r.usage.responseTokens).toBe(30);
			expect(r.usage.attempts).toBe(2);         // two API round-trips
		});

		// ── #4 rebuild() shares rawSend()'s parsing ──
		it('Transformer.rebuild extracts fenced JSON and unwraps the data envelope', async () => {
			const tf = new Transformer({ ...KEY, modelName: 'gemini-2.5-flash' });
			tf.genAIClient = {
				models: { list: jest.fn(async () => []) },
				chats: {
					create: jest.fn((o) => ({
						config: o.config, getHistory: () => [],
						sendMessage: async () => ({ ...usageChunk(10, 5), text: '```json\n{"data":{"fixed":true}}\n```' })
					}))
				}
			};
			await tf.init();
			// Bare JSON.parse threw on the fence; no unwrap returned {data:{...}}.
			expect(await tf.rebuild({ broken: true }, 'nope')).toEqual({ fixed: true });
		});

		// ── #6 extraction failures retry the task, not rebuild() ──
		it('Transformer.send retries an unparseable response with a format nudge', async () => {
			const tf = new Transformer({ ...KEY, modelName: 'gemini-2.5-flash', retryDelay: 1 });
			const sent = [];
			let call = 0;
			tf.genAIClient = {
				models: { list: jest.fn(async () => []) },
				chats: {
					create: jest.fn((o) => ({
						config: o.config, getHistory: () => [],
						sendMessage: async ({ message }) => {
							sent.push(message);
							// Attempt 0 returns prose; attempt 1 returns valid JSON.
							return call++ === 0
								? { ...usageChunk(10, 5), text: 'Here is a haiku about the ocean instead.' }
								: { ...usageChunk(10, 5), text: '{"ok":true}' };
						}
					}))
				}
			};
			await tf.init();
			const out = await tf.send({ some: 'input' });

			expect(out).toEqual({ ok: true });
			// The retry must NOT be a rebuild() prompt calling the user's input a bad payload.
			expect(sent[1]).not.toContain('BAD PAYLOAD');
			expect(sent[1]).toContain('could not be parsed as JSON');
			expect(sent[1]).toContain('"some": "input"');
		});

		it('Transformer.send still rebuilds the model output on a validation failure', async () => {
			const tf = new Transformer({ ...KEY, modelName: 'gemini-2.5-flash', retryDelay: 1 });
			const sent = [];
			let call = 0;
			tf.genAIClient = {
				models: { list: jest.fn(async () => []) },
				chats: {
					create: jest.fn((o) => ({
						config: o.config, getHistory: () => [],
						sendMessage: async ({ message }) => {
							sent.push(message);
							return call++ === 0
								? { ...usageChunk(10, 5), text: '{"wrong":1}' }
								: { ...usageChunk(10, 5), text: '{"right":1}' };
						}
					}))
				}
			};
			await tf.init();
			const validator = async (p) => { if (!p.right) throw new Error('needs a right key'); };
			const out = await tf.send({ some: 'input' }, {}, validator);

			expect(out).toEqual({ right: 1 });
			// The repair prompt shows the MODEL's output, not the user's input.
			expect(sent[1]).toContain('BAD PAYLOAD');
			expect(sent[1]).toContain('"wrong": 1');
		});

		// ── #9 useCache no longer destroys the system prompt ──
		it('detaching a cache restores the system instruction', async () => {
			const chat = new Chat({ ...KEY, systemPrompt: 'stay yourself' });
			stubStream(chat, []);
			await chat.init();

			await chat.useCache('caches/abc');
			expect(chat._getChatCreateOptions().config.systemInstruction).toBeUndefined();
			expect(chat.chatConfig.systemInstruction).toBe('stay yourself');

			chat.cachedContent = null;
			expect(chat._getChatCreateOptions().config.systemInstruction).toBe('stay yourself');
		});

		// ── pricing table freshness ──
		it('prices gemini-3.7-flash on its promo rate and after it lapses', () => {
			expect(computeCost('gemini-3.7-flash', 1_000_000, 1_000_000, 0, 0, { at: '2026-08-24' }))
				.toBeCloseTo(0.75 + 3.75, 10);
			expect(computeCost('gemini-3.7-flash', 1_000_000, 1_000_000, 0, 0, { at: '2027-01-01' }))
				.toBeCloseTo(1.50 + 7.50, 10);
			expect(resolvePricing('gemini-3.7-flash', { at: '2026-08-24' }).introUntil).toBe('2026-12-31');
			expect(resolvePricing('gemini-3.7-flash', { at: '2027-01-01' }).introUntil).toBeUndefined();
		});

		it('defaults to gemini-3.7-flash', () => {
			expect(new Chat({ ...KEY }).modelName).toBe('gemini-3.7-flash');
		});
	});
});
