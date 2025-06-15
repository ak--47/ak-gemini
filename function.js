import { http } from '@google-cloud/functions-framework';
import dotenv from 'dotenv';
dotenv.config();

import AITransformer from './index.js';
import { sLog, uid, timer } from 'ak-tools';

const { NODE_ENV = "" } = process.env;
if (!NODE_ENV) throw new Error("NODE_ENV is required");

const transformers = new Map(); // Use Map for better performance

/**
 * Merges URL query params with request body, with body taking precedence
 * @param {object} req - Express request object
 * @returns {object} Merged parameters
 */
function mergeParams(req) {
	const urlParams = req.query || {};
	const bodyParams = req.body || {};
	
	// Parse JSON strings from URL params
	const parsedUrlParams = {};
	for (const [key, value] of Object.entries(urlParams)) {
		try {
			// Try to parse as JSON, fall back to string
			parsedUrlParams[key] = typeof value === 'string' && (value.startsWith('{') || value.startsWith('[')) 
				? JSON.parse(value) 
				: value;
		} catch {
			parsedUrlParams[key] = value;
		}
	}
	
	// Body params override URL params
	return { ...parsedUrlParams, ...bodyParams };
}

/**
 * Creates a cache key for transformer instances
 * @param {string} id - Transformer ID
 * @param {object} options - Transformer options
 * @returns {string} Cache key
 */
function getCacheKey(id, options) {
	// Create a stable key from options (exclude examples which change frequently)
	const stableOptions = { ...options };
	delete stableOptions.exampleData;
	delete stableOptions.examples;
	return `${id}:${JSON.stringify(stableOptions)}`;
}

/**
 * Gets or creates a transformer instance with caching
 * @param {string} id - Transformer ID
 * @param {object} options - Transformer options
 * @returns {Promise<AITransformer>}
 */
async function getTransformer(id = 'default', options = {}) {
	const cacheKey = getCacheKey(id, options);
	
	if (!transformers.has(cacheKey)) {
		const transformer = new AITransformer(options);
		await transformer.init();
		transformers.set(cacheKey, transformer);
		sLog(`Created new transformer: ${cacheKey}`);
	}
	
	return transformers.get(cacheKey);
}

function sendJson(res, status, obj) {
	res.status(status).set('content-type', 'application/json').send(JSON.stringify(obj));
}

http('entry', async (req, res) => {
	const runId = uid();
	const t = timer('job');
	t.start();

	const path = req.path || req.url || '/';
	const method = req.method?.toLowerCase() || 'get';
	
	try {
		let result;

		// Health check endpoint
		if (path === '/health') {
			sendJson(res, 200, { status: 'ok', message: 'Service is healthy', runId });
			return;
		}

		// Main transformation endpoint
		if (path === '/') {
			const params = mergeParams(req);
			
			// Extract transformer configuration
			const {
				id = 'default',
				examples,
				exampleData,
				payload,
				data = payload, // Allow 'data' as alias for 'payload'
				...transformerOptions
			} = params;

			// For GET requests without payload, just return service info
			if (method === 'get' && !data && !payload) {
				result = { 
					status: 'ok', 
					message: 'AI Transformer Service',
					runId,
					usage: 'POST with payload/data to transform, or include examples to seed first'
				};
			} else {
				// Validate required payload
				const inputPayload = data || payload;
				if (!inputPayload) {
					throw new Error("Missing 'payload' or 'data' parameter");
				}

				sLog(`Processing transformation (ID=${id})`, { 
					runId, 
					method: req.method, 
					hasExamples: !!(examples || exampleData),
					payloadSize: JSON.stringify(inputPayload).length 
				});

				// Get or create transformer with options
				const transformer = await getTransformer(id, transformerOptions);

				// Seed with examples if provided
				if (examples || exampleData) {
					const exampleSet = examples || exampleData;
					await transformer.seed(exampleSet);
					sLog(`Seeded transformer with ${exampleSet.length} examples`);
				}

				// Perform transformation
				result = await transformer.message(inputPayload);
			}
		} else {
			// Unknown path
			sendJson(res, 404, { error: `Invalid path: ${path}` });
			return;
		}

		sLog(`FINISH: ${path} (${method.toUpperCase()}) ... ${t.report(false).human}`, { 
			runId,
			resultSize: JSON.stringify(result).length 
		});
		sendJson(res, 200, result);

	} catch (e) {
		const errorMsg = (e && e.message) || String(e);
		sLog(`ERROR: ${path} (${method.toUpperCase()})`, { runId, error: errorMsg });
		sendJson(res, 500, { error: errorMsg, runId });
	}
});