/**
 * Test: compare estimate() vs getLastUsage() to find the token count discrepancy
 * the user observes when using Vertex AI with system instructions
 */
import dotenv from 'dotenv';
dotenv.config();

import AITransformer from './index.js';

const SYSTEM_INSTRUCTION = `
You are a senior data analyst working for a Fortune 500 retail company. Your primary responsibility
is to analyze sales data, customer behavior patterns, and inventory metrics to provide actionable
business intelligence. You have deep expertise in statistical analysis, time series forecasting,
and market segmentation.

When analyzing data, you must always:
1. Start with a high-level executive summary of key findings
2. Break down the analysis by product category, region, and time period
3. Identify statistically significant trends using appropriate tests
4. Provide confidence intervals for all estimates
5. Flag any data quality issues or anomalies you detect
6. Compare current performance against historical benchmarks
7. Calculate year-over-year and quarter-over-quarter growth rates
8. Segment customers using RFM analysis
9. Recommend specific, measurable actions based on your findings
10. Include risk assessments for each recommendation

Your output format must always be structured JSON with the following top-level keys:
executive_summary, metrics, segments, anomalies, recommendations, methodology, confidence.

Remember to always validate your calculations, cross-reference multiple data sources when available,
and clearly distinguish between correlation and causation in your findings.

Additional guidelines:
- For pricing analysis: Include price elasticity calculations and competitive benchmarking
- For inventory analysis: Calculate days of supply, stockout rates, and carrying costs
- For marketing analysis: Compute CAC, LTV, ROAS, and attribution modeling results
- For operations analysis: Track fulfillment rates, delivery times, and satisfaction scores
`.trim();

const USER_PROMPT = { product: "Widget A", units_sold: 1500, revenue: 45000, period: "Q4 2024" };

async function runTest(label, options) {
	console.log(`\n${'─'.repeat(70)}`);
	console.log(`TEST: ${label}`);
	console.log(`${'─'.repeat(70)}`);

	const ai = new AITransformer({
		...options,
		systemInstructions: SYSTEM_INSTRUCTION,
		logLevel: 'none',
	});
	await ai.init();

	// Get estimate BEFORE sending
	const estimate = await ai.estimate(USER_PROMPT);
	console.log(`  estimate() → inputTokens: ${estimate.inputTokens}`);

	// Send the message
	await ai.message(USER_PROMPT);

	// Get actual usage AFTER sending
	const usage = ai.getLastUsage();
	console.log(`  getLastUsage() → promptTokens: ${usage.promptTokens}`);
	console.log(`  getLastUsage() → responseTokens: ${usage.responseTokens}`);
	console.log(`  getLastUsage() → totalTokens: ${usage.totalTokens}`);

	const diff = estimate.inputTokens - usage.promptTokens;
	console.log(`\n  DIFFERENCE (estimate - actual): ${diff} tokens`);
	if (Math.abs(diff) > 50) {
		console.log(`  >>> DISCREPANCY DETECTED: ${Math.abs(diff)} token difference`);
	} else {
		console.log(`  Counts match (within margin).`);
	}

	return { label, estimate: estimate.inputTokens, actual: usage.promptTokens, diff };
}

async function runTestWithExamples(label, options) {
	console.log(`\n${'─'.repeat(70)}`);
	console.log(`TEST: ${label} (with seeded examples)`);
	console.log(`${'─'.repeat(70)}`);

	const ai = new AITransformer({
		...options,
		systemInstructions: SYSTEM_INSTRUCTION,
		logLevel: 'none',
	});
	await ai.init();

	// Seed with some examples
	const examples = [
		{
			PROMPT: { item: "Gadget B", sold: 200, revenue: 8000, quarter: "Q3 2024" },
			ANSWER: { summary: "Moderate sales performance", trend: "stable" }
		},
		{
			PROMPT: { item: "Gadget C", sold: 500, revenue: 25000, quarter: "Q2 2024" },
			ANSWER: { summary: "Strong growth trajectory", trend: "upward" }
		}
	];
	await ai.seed(examples);

	// Get estimate BEFORE sending
	const estimate = await ai.estimate(USER_PROMPT);
	console.log(`  estimate() → inputTokens: ${estimate.inputTokens}`);

	// Send the message
	await ai.message(USER_PROMPT);

	// Get actual usage AFTER sending
	const usage = ai.getLastUsage();
	console.log(`  getLastUsage() → promptTokens: ${usage.promptTokens}`);
	console.log(`  getLastUsage() → responseTokens: ${usage.responseTokens}`);
	console.log(`  getLastUsage() → totalTokens: ${usage.totalTokens}`);

	const diff = estimate.inputTokens - usage.promptTokens;
	console.log(`\n  DIFFERENCE (estimate - actual): ${diff} tokens`);
	if (Math.abs(diff) > 50) {
		console.log(`  >>> DISCREPANCY DETECTED: ${Math.abs(diff)} token difference`);
	} else {
		console.log(`  Counts match (within margin).`);
	}

	return { label, estimate: estimate.inputTokens, actual: usage.promptTokens, diff };
}

async function main() {
	console.log('='.repeat(70));
	console.log('COMPARING estimate() vs getLastUsage()');
	console.log('='.repeat(70));

	const results = [];

	// Test 1: Vertex AI, no examples
	try {
		if (process.env.GOOGLE_CLOUD_PROJECT) {
			results.push(await runTest('Vertex AI (no examples)', {
				vertexai: true,
				project: process.env.GOOGLE_CLOUD_PROJECT,
			}));
		}
	} catch (e) { console.error(`  Vertex error: ${e.message}`); }

	// Test 2: Gemini API, no examples
	try {
		if (process.env.GEMINI_API_KEY) {
			results.push(await runTest('Gemini API (no examples)', {}));
		}
	} catch (e) { console.error(`  Gemini error: ${e.message}`); }

	// Test 3: Vertex AI with seeded examples
	try {
		if (process.env.GOOGLE_CLOUD_PROJECT) {
			results.push(await runTestWithExamples('Vertex AI (with examples)', {
				vertexai: true,
				project: process.env.GOOGLE_CLOUD_PROJECT,
			}));
		}
	} catch (e) { console.error(`  Vertex error: ${e.message}`); }

	// Test 4: Gemini API with seeded examples
	try {
		if (process.env.GEMINI_API_KEY) {
			results.push(await runTestWithExamples('Gemini API (with examples)', {}));
		}
	} catch (e) { console.error(`  Gemini error: ${e.message}`); }

	// Summary table
	console.log(`\n${'='.repeat(70)}`);
	console.log('SUMMARY');
	console.log('='.repeat(70));
	console.log();
	console.table(results.map(r => ({
		'Test': r.label,
		'estimate()': r.estimate,
		'getLastUsage().promptTokens': r.actual,
		'Difference': r.diff,
	})));
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
