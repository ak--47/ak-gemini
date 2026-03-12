/**
 * @fileoverview Bug Report: Vertex AI usageMetadata.promptTokenCount does not include system instruction tokens
 *
 * ISSUE:
 * When using Google's @google/genai SDK with Vertex AI, the `promptTokenCount` in the response's
 * `usageMetadata` does NOT include tokens from `systemInstruction`. This means reported input token
 * usage is significantly lower than actual consumption.
 *
 * When the same system instruction text is instead prepended to the user message content,
 * `promptTokenCount` correctly reflects the full token count.
 *
 * This script reproduces the issue by comparing token counts across 4 scenarios on both
 * Vertex AI and Gemini API backends.
 *
 * ENVIRONMENT SETUP:
 *   # Vertex AI (ADC)
 *   export GOOGLE_CLOUD_PROJECT="your-project-id"
 *   gcloud auth application-default login
 *
 *   # Gemini API
 *   export GEMINI_API_KEY="your-api-key"
 *
 * USAGE:
 *   node bug-report.js
 *
 * SDK: @google/genai ^1.34.0
 */

import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI } from '@google/genai';

// ── Configuration ──────────────────────────────────────────────────────────────

const MODEL = 'gemini-2.5-flash';

// A substantial system prompt (~500+ tokens) to make the difference obvious
const SYSTEM_INSTRUCTION = `
You are a senior data analyst working for a Fortune 500 retail company. Your primary responsibility
is to analyze sales data, customer behavior patterns, and inventory metrics to provide actionable
business intelligence. You have deep expertise in statistical analysis, time series forecasting,
and market segmentation.

When analyzing data, you must always:
1. Start with a high-level executive summary of key findings
2. Break down the analysis by product category, region, and time period
3. Identify statistically significant trends using appropriate tests (t-tests, chi-squared, ANOVA)
4. Provide confidence intervals for all estimates
5. Flag any data quality issues or anomalies you detect
6. Compare current performance against historical benchmarks and industry standards
7. Calculate year-over-year and quarter-over-quarter growth rates
8. Segment customers using RFM (Recency, Frequency, Monetary) analysis
9. Recommend specific, measurable actions based on your findings
10. Include risk assessments for each recommendation

Your output format must always be structured JSON with the following top-level keys:
- "executive_summary": A brief paragraph summarizing the most critical insights
- "metrics": An object containing all calculated KPIs with their values and trends
- "segments": An array of customer or product segments with their characteristics
- "anomalies": An array of detected data quality issues or unusual patterns
- "recommendations": An array of prioritized action items with expected impact
- "methodology": A brief description of the analytical methods used
- "confidence": Overall confidence level in the analysis (high/medium/low) with justification

Remember to always validate your calculations, cross-reference multiple data sources when available,
and clearly distinguish between correlation and causation in your findings. When uncertain about
any conclusion, explicitly state the limitations and suggest additional data that would help
resolve the uncertainty.

Additional guidelines for specific analysis types:
- For pricing analysis: Include price elasticity calculations and competitive benchmarking
- For inventory analysis: Calculate days of supply, stockout rates, and carrying costs
- For marketing analysis: Compute CAC, LTV, ROAS, and attribution modeling results
- For operations analysis: Track fulfillment rates, delivery times, and customer satisfaction scores
`.trim();

// A simple user prompt
const USER_PROMPT = 'Analyze this sales data: {"product": "Widget A", "units_sold": 1500, "revenue": 45000, "period": "Q4 2024"}';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function createVertexClient() {
	const project = process.env.GOOGLE_CLOUD_PROJECT;
	if (!project) {
		console.warn('  SKIP: GOOGLE_CLOUD_PROJECT not set');
		return null;
	}
	return new GoogleGenAI({
		vertexai: true,
		project,
	});
}

function createGeminiClient() {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		console.warn('  SKIP: GEMINI_API_KEY not set');
		return null;
	}
	return new GoogleGenAI({ apiKey });
}

/**
 * Test A: generateContent WITH systemInstruction in config
 * System prompt tokens should be counted in promptTokenCount
 */
async function testWithSystemInstruction(client, label) {
	const result = await client.models.generateContent({
		model: MODEL,
		contents: [{ role: 'user', parts: [{ text: USER_PROMPT }] }],
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			responseMimeType: 'application/json',
			maxOutputTokens: 200,       // keep output small to focus on input counting
			thinkingConfig: { thinkingBudget: 0 },
		},
	});

	return {
		label,
		promptTokenCount: result.usageMetadata?.promptTokenCount ?? 'N/A',
		candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? 'N/A',
		totalTokenCount: result.usageMetadata?.totalTokenCount ?? 'N/A',
	};
}

/**
 * Test B: generateContent WITHOUT systemInstruction — system text prepended to message
 * This is the baseline: tokens are definitely counted because they're in the message content
 */
async function testWithSystemInContent(client, label) {
	const combinedPrompt = `${SYSTEM_INSTRUCTION}\n\n---\n\n${USER_PROMPT}`;

	const result = await client.models.generateContent({
		model: MODEL,
		contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
		config: {
			responseMimeType: 'application/json',
			maxOutputTokens: 200,
			thinkingConfig: { thinkingBudget: 0 },
		},
	});

	return {
		label,
		promptTokenCount: result.usageMetadata?.promptTokenCount ?? 'N/A',
		candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? 'N/A',
		totalTokenCount: result.usageMetadata?.totalTokenCount ?? 'N/A',
	};
}

/**
 * Test C: countTokens WITH systemInstruction
 * Try both config-level and top-level placement since SDK behavior varies
 */
async function testCountTokensWithSystemInstruction(client, label) {
	// Try top-level systemInstruction first (some SDK versions expect this)
	try {
		const resp = await client.models.countTokens({
			model: MODEL,
			contents: [{ role: 'user', parts: [{ text: USER_PROMPT }] }],
			config: {
				systemInstruction: SYSTEM_INSTRUCTION,
			},
		});
		return { label, totalTokens: resp.totalTokens ?? 'N/A', error: null };
	} catch (e1) {
		// If config-level fails, try adding system text as a content part (workaround)
		try {
			const resp = await client.models.countTokens({
				model: MODEL,
				contents: [
					{ parts: [{ text: SYSTEM_INSTRUCTION }] },
					{ role: 'user', parts: [{ text: USER_PROMPT }] }
				],
			});
			return { label: `${label} (fallback: in contents)`, totalTokens: resp.totalTokens ?? 'N/A', error: `config.systemInstruction not supported: ${e1.message}` };
		} catch (e2) {
			return { label, totalTokens: 'ERROR', error: e2.message };
		}
	}
}

/**
 * Test D: countTokens with system text in contents (baseline)
 */
async function testCountTokensInContent(client, label) {
	const combinedPrompt = `${SYSTEM_INSTRUCTION}\n\n---\n\n${USER_PROMPT}`;

	try {
		const resp = await client.models.countTokens({
			model: MODEL,
			contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
		});
		return { label, totalTokens: resp.totalTokens ?? 'N/A', error: null };
	} catch (e) {
		return { label, totalTokens: 'ERROR', error: e.message };
	}
}

// ── Chat-based Tests (mimics ak-gemini wrapper behavior) ────────────────────────

/**
 * Test E: chats.create() with systemInstruction in config + sendMessage()
 * This is the code path ak-gemini uses — the one exhibiting the reported bug
 */
async function testChatWithSystemInstruction(client, label) {
	const chat = await client.chats.create({
		model: MODEL,
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			responseMimeType: 'application/json',
			maxOutputTokens: 200,
			thinkingConfig: { thinkingBudget: 0 },
		},
		history: [],
	});

	const result = await chat.sendMessage({ message: USER_PROMPT });

	return {
		label,
		promptTokenCount: result.usageMetadata?.promptTokenCount ?? 'N/A',
		candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? 'N/A',
		totalTokenCount: result.usageMetadata?.totalTokenCount ?? 'N/A',
	};
}

/**
 * Test F: chats.create() WITHOUT systemInstruction + system text prepended to message
 * Baseline for chat path — tokens are in the message so they must be counted
 */
async function testChatWithSystemInContent(client, label) {
	const chat = await client.chats.create({
		model: MODEL,
		config: {
			responseMimeType: 'application/json',
			maxOutputTokens: 200,
			thinkingConfig: { thinkingBudget: 0 },
		},
		history: [],
	});

	const combinedPrompt = `${SYSTEM_INSTRUCTION}\n\n---\n\n${USER_PROMPT}`;
	const result = await chat.sendMessage({ message: combinedPrompt });

	return {
		label,
		promptTokenCount: result.usageMetadata?.promptTokenCount ?? 'N/A',
		candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? 'N/A',
		totalTokenCount: result.usageMetadata?.totalTokenCount ?? 'N/A',
	};
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
	console.log('='.repeat(80));
	console.log('BUG REPORT: Vertex AI promptTokenCount excludes system instruction tokens');
	console.log('='.repeat(80));
	console.log(`\nModel: ${MODEL}`);
	console.log(`System instruction length: ~${SYSTEM_INSTRUCTION.split(/\s+/).length} words`);
	console.log(`User prompt length: ~${USER_PROMPT.split(/\s+/).length} words`);
	console.log();

	const generateResults = [];
	const chatResults = [];
	const countTokenResults = [];

	// ── Vertex AI Tests ──

	console.log('─── Vertex AI Tests ───────────────────────────────────────────');
	const vertexClient = createVertexClient();
	if (vertexClient) {
		try {
			console.log('  [generateContent] WITH systemInstruction...');
			generateResults.push(await testWithSystemInstruction(vertexClient, 'Vertex: systemInstruction'));

			console.log('  [generateContent] system text IN content...');
			generateResults.push(await testWithSystemInContent(vertexClient, 'Vertex: in content'));

			console.log('  [chat.sendMessage] WITH systemInstruction in chat config...');
			chatResults.push(await testChatWithSystemInstruction(vertexClient, 'Vertex: chat w/ systemInstruction'));

			console.log('  [chat.sendMessage] system text prepended to message...');
			chatResults.push(await testChatWithSystemInContent(vertexClient, 'Vertex: chat w/ text in message'));

			console.log('  [countTokens] WITH systemInstruction...');
			countTokenResults.push(await testCountTokensWithSystemInstruction(vertexClient, 'Vertex: countTokens w/ systemInstruction'));

			console.log('  [countTokens] system text IN content...');
			countTokenResults.push(await testCountTokensInContent(vertexClient, 'Vertex: countTokens in content'));
		} catch (err) {
			console.error(`  Vertex AI error: ${err.message}`);
		}
	}

	// ── Gemini API Tests ──

	console.log('\n─── Gemini API Tests ──────────────────────────────────────────');
	const geminiClient = createGeminiClient();
	if (geminiClient) {
		try {
			console.log('  [generateContent] WITH systemInstruction...');
			generateResults.push(await testWithSystemInstruction(geminiClient, 'Gemini: systemInstruction'));

			console.log('  [generateContent] system text IN content...');
			generateResults.push(await testWithSystemInContent(geminiClient, 'Gemini: in content'));

			console.log('  [chat.sendMessage] WITH systemInstruction in chat config...');
			chatResults.push(await testChatWithSystemInstruction(geminiClient, 'Gemini: chat w/ systemInstruction'));

			console.log('  [chat.sendMessage] system text prepended to message...');
			chatResults.push(await testChatWithSystemInContent(geminiClient, 'Gemini: chat w/ text in message'));

			console.log('  [countTokens] WITH systemInstruction...');
			countTokenResults.push(await testCountTokensWithSystemInstruction(geminiClient, 'Gemini: countTokens w/ systemInstruction'));

			console.log('  [countTokens] system text IN content...');
			countTokenResults.push(await testCountTokensInContent(geminiClient, 'Gemini: countTokens in content'));
		} catch (err) {
			console.error(`  Gemini API error: ${err.message}`);
		}
	}

	// ── Results ──

	// ── Print Results ──

	const printSection = (title, data, columns) => {
		console.log('\n' + '='.repeat(80));
		console.log(title);
		console.log('='.repeat(80));
		console.log();
		if (data.length === 0) {
			console.log('  (no results)\n');
			return;
		}
		console.table(data.map(r => {
			const row = {};
			for (const col of columns) {
				row[col] = r[col] ?? '';
			}
			return row;
		}));
	};

	const tokenCols = ['label', 'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'];
	printSection('RESULTS: generateContent — usageMetadata', generateResults, tokenCols);
	printSection('RESULTS: chat.sendMessage — usageMetadata', chatResults, tokenCols);
	printSection('RESULTS: countTokens API', countTokenResults, ['label', 'totalTokens', 'error']);

	// ── Analysis ──

	console.log('\n' + '='.repeat(80));
	console.log('ANALYSIS');
	console.log('='.repeat(80));

	const analyzeResultPair = (label, results) => {
		const withSys = results.find(r => r.label.includes('systemInstruction'));
		const inContent = results.find(r => !r.label.includes('systemInstruction'));
		if (!withSys || !inContent) return;

		const diff = inContent.promptTokenCount - withSys.promptTokenCount;
		console.log(`\n  ${label}:`);
		console.log(`    promptTokenCount with systemInstruction: ${withSys.promptTokenCount}`);
		console.log(`    promptTokenCount with text in content:   ${inContent.promptTokenCount}`);
		console.log(`    Difference: ${diff} tokens`);
		if (diff > 50) {
			console.log(`    >>> BUG: ~${diff} system instruction tokens NOT counted in promptTokenCount`);
		} else {
			console.log(`    Counts are approximately equal — no discrepancy.`);
		}
	};

	// Analyze generateContent results
	const vertexGen = generateResults.filter(r => r.label.startsWith('Vertex'));
	const geminiGen = generateResults.filter(r => r.label.startsWith('Gemini'));
	if (vertexGen.length === 2) analyzeResultPair('Vertex AI (generateContent)', vertexGen);
	if (geminiGen.length === 2) analyzeResultPair('Gemini API (generateContent)', geminiGen);

	// Analyze chat results
	const vertexChat = chatResults.filter(r => r.label.startsWith('Vertex'));
	const geminiChat = chatResults.filter(r => r.label.startsWith('Gemini'));
	if (vertexChat.length === 2) analyzeResultPair('Vertex AI (chat.sendMessage)', vertexChat);
	if (geminiChat.length === 2) analyzeResultPair('Gemini API (chat.sendMessage)', geminiChat);

	// Analyze countTokens results
	const vertexCT = countTokenResults.filter(r => r.label.startsWith('Vertex'));
	const geminiCT = countTokenResults.filter(r => r.label.startsWith('Gemini'));
	if (vertexCT.length === 2) {
		const diff = vertexCT[1].totalTokens - vertexCT[0].totalTokens;
		console.log(`\n  Vertex AI (countTokens):`);
		console.log(`    with systemInstruction param: ${vertexCT[0].totalTokens}`);
		console.log(`    with text in contents:        ${vertexCT[1].totalTokens}`);
		console.log(`    Difference: ${diff} tokens`);
	}
	if (geminiCT.length === 2) {
		const diff = geminiCT[1].totalTokens - geminiCT[0].totalTokens;
		console.log(`\n  Gemini API (countTokens):`);
		console.log(`    with systemInstruction param: ${geminiCT[0].totalTokens}`);
		console.log(`    with text in contents:        ${geminiCT[1].totalTokens}`);
		console.log(`    Difference: ${diff} tokens`);
	}

	console.log('\n' + '='.repeat(80));
	console.log('EXPECTED BEHAVIOR');
	console.log('='.repeat(80));
	console.log(`
  promptTokenCount in usageMetadata should include ALL tokens that contribute to
  the model's input context — including system instructions. The system instruction
  text consumes context window capacity and is billed, so it must be reflected in
  the reported token counts.

  Currently, when using systemInstruction config parameter (the recommended approach),
  the promptTokenCount appears to exclude these tokens entirely, making it impossible
  to accurately track or predict API costs.
`);
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
