#!/usr/bin/env node
/**
 * CLI for ak-gemini — streams a Gemini response to stdout.
 * Usage: node ak-gemini/cli.js "your prompt here"
 *        MODEL=gemini-2.5-pro node ak-gemini/cli.js "prompt"
 */

import { Message } from './index.js';

// Silence SDK console.debug noise (e.g., "project/location will take precedence" warning)
console.debug = () => {};

const prompt = process.argv.slice(2).join(' ');

if (!prompt || prompt === '-h' || prompt === '--help') {
	console.log('Usage: node ak-gemini/cli.js "your prompt"');
	console.log('  MODEL env var overrides default model (gemini-3.1-flash-lite-preview)');
	console.log('  Google Search grounding is enabled by default');
	process.exit(prompt ? 0 : 1);
}

try {
	const msg = new Message({
		modelName: process.env.MODEL || 'gemini-3.1-flash-lite-preview',
		vertexai: true,
		project: process.env.GOOGLE_CLOUD_PROJECT || 'mixpanel-gtm-training',
		systemPrompt: 'Respond in plain text only. Do not use markdown formatting (no bold, italic, headers, bullet points, code fences, etc.).',
		logLevel: 'none'
	});
	await msg.init();

	const stream = await msg.genAIClient.models.generateContentStream({
		model: msg.modelName,
		contents: [{ role: 'user', parts: [{ text: prompt }] }],
		config: {
			...msg.chatConfig,
			tools: [{ googleSearch: {} }]
		}
	});

	for await (const chunk of stream) {
		process.stdout.write(chunk.text || '');
	}
	process.stdout.write('\n');
} catch (err) {
	console.error(`❌ ${err.message}`);
	process.exit(1);
}
