/**
 * Offline tests — no API calls.
 * Covers seed() model-turn format (prose vs JSON envelope) and
 * top-level sampling option promotion (temperature/topP/topK).
 */

import Chat from '../chat.js';
import Transformer from '../transformer.js';
import BaseGemini from '../base.js';

const apiKey = 'offline-fake-key';

describe('seed() model-turn format', () => {

	it('Chat.seed() stores model turns as verbatim prose (no JSON envelope)', async () => {
		const chat = new Chat({ apiKey });
		await chat.seed([{ PROMPT: 'What is 2+2?', ANSWER: 'Four.' }]);
		const history = chat.getHistory();
		const modelTurn = history.find(h => h.role === 'model');
		expect(modelTurn).toBeDefined();
		expect(modelTurn.parts[0].text).toBe('Four.');
	});

	it('Chat.seed() with object ANSWER serializes without the data envelope', async () => {
		const chat = new Chat({ apiKey });
		await chat.seed([{ PROMPT: 'Give me config', ANSWER: { retries: 3 } }]);
		const modelTurn = chat.getHistory().find(h => h.role === 'model');
		const parsed = JSON.parse(modelTurn.parts[0].text);
		expect(parsed).toEqual({ retries: 3 });
		expect(parsed.data).toBeUndefined();
	});

	it('Transformer.seed() still wraps model turns in the {data} envelope', async () => {
		const t = new Transformer({ apiKey });
		await t.seed([{ PROMPT: { a: 1 }, ANSWER: { b: 2 } }]);
		const modelTurn = t.getHistory().find(h => h.role === 'model');
		const parsed = JSON.parse(modelTurn.parts[0].text);
		expect(parsed.data).toEqual({ b: 2 });
	});

	it('BaseGemini.seed() defaults to json format (back-compat)', async () => {
		const base = new BaseGemini({ apiKey });
		await base.seed([{ PROMPT: 'in', ANSWER: 'out' }]);
		const modelTurn = base.getHistory().find(h => h.role === 'model');
		const parsed = JSON.parse(modelTurn.parts[0].text);
		expect(parsed.data).toBe('out');
	});

	it('BaseGemini.seed() honors explicit format: "text"', async () => {
		const base = new BaseGemini({ apiKey });
		await base.seed([{ PROMPT: 'in', ANSWER: 'out' }], { format: 'text' });
		const modelTurn = base.getHistory().find(h => h.role === 'model');
		expect(modelTurn.parts[0].text).toBe('out');
	});

});

describe('top-level sampling options', () => {

	it('promotes top-level temperature into chatConfig', () => {
		const chat = new Chat({ apiKey, temperature: 0.1 });
		expect(chat.chatConfig.temperature).toBe(0.1);
	});

	it('promotes top-level topP and topK into chatConfig', () => {
		const chat = new Chat({ apiKey, topP: 0.5, topK: 10 });
		expect(chat.chatConfig.topP).toBe(0.5);
		expect(chat.chatConfig.topK).toBe(10);
	});

	it('top-level wins over chatConfig', () => {
		const chat = new Chat({ apiKey, temperature: 0.1, chatConfig: { temperature: 0.9 } });
		expect(chat.chatConfig.temperature).toBe(0.1);
	});

	it('defaults preserved when unset', () => {
		const chat = new Chat({ apiKey });
		expect(chat.chatConfig.temperature).toBe(0.7);
		expect(chat.chatConfig.topP).toBe(0.95);
		expect(chat.chatConfig.topK).toBe(64);
	});

	it('chatConfig alone still works (no top-level override)', () => {
		const chat = new Chat({ apiKey, chatConfig: { temperature: 0.2 } });
		expect(chat.chatConfig.temperature).toBe(0.2);
	});

	it('temperature: 0 is promoted (falsy value handled)', () => {
		const chat = new Chat({ apiKey, temperature: 0 });
		expect(chat.chatConfig.temperature).toBe(0);
	});

});
