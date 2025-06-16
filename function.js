import { http } from '@google-cloud/functions-framework';
import dotenv from 'dotenv';
dotenv.config();

import AITransformer from './index.js';
import { sLog, uid, timer } from 'ak-tools';

const { NODE_ENV = "", CODE_PHRASE } = process.env;
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

/**
 * Authentication middleware - checks for CODE_PHRASE in body or URL params
 * @param {object} req - Express request object
 * @returns {boolean} True if authenticated, false otherwise
 */
function checkAuth(req) {
	if (!CODE_PHRASE) {
		// If no CODE_PHRASE is set, allow all requests (dev mode)
		return true;
	}
	
	const params = mergeParams(req);
	const providedCode = params.code_phrase || params.CODE_PHRASE || params.code || params.auth;
	
	return providedCode === CODE_PHRASE;
}

http('entry', async (req, res) => {
	const runId = uid();
	const t = timer('job');
	t.start();

	const path = req.path || req.url || '/';
	const method = req.method?.toLowerCase() || 'get';
	
	// Skip auth for health and help endpoints
	const skipAuth = ['/health', '/help'].includes(path);
	
	// Check authentication first (unless skipped)
	if (!skipAuth && !checkAuth(req)) {
		sLog(`AUTH FAIL: ${path} (${method.toUpperCase()}) - Invalid or missing CODE_PHRASE`, { runId });
		sendJson(res, 401, { 
			error: 'Unauthorized - missing or invalid authentication', 
			runId,
			hint: 'Include code_phrase in request body or URL parameters'
		});
		return;
	}
	
	try {
		let result;

		// Health check endpoint
		if (path === '/health') {
			sendJson(res, 200, { status: 'ok', message: 'Service is healthy', runId });
			return;
		}

		// Help documentation endpoint
		if (path === '/help') {
			const helpDoc = {
				service: 'AI Transformer Service',
				description: 'Google Gemini API wrapper for JSON transformation with few-shot learning',
				version: '1.0.0',
				endpoints: {
					'/': {
						methods: ['GET', 'POST'],
						description: 'Main transformation endpoint',
						get: {
							description: 'Returns service information without payload',
							response: {
								status: 'ok',
								message: 'AI Transformer Service',
								runId: 'unique-run-id',
								usage: 'POST with payload/data to transform, or include examples to seed first'
							}
						},
						post: {
							description: 'Transforms input data using AI',
							required: ['payload OR data'],
							parameters: {
								// Authentication (required for main endpoint)
								code_phrase: {
									type: 'string',
									required: true,
									description: 'Authentication code phrase (can also use: CODE_PHRASE, code, auth)',
									note: 'Not required for /health and /help endpoints',
									example: 'your-secret-phrase'
								},
								
								// Core transformation
								payload: {
									type: 'object|string|array|primitive',
									description: 'Data to transform (alias: data)',
									example: { name: 'John', age: 30 }
								},
								data: {
									type: 'object|string|array|primitive',
									description: 'Alias for payload parameter',
									example: { input: 'transform this' }
								},
								
								// Transformer configuration
								id: {
									type: 'string',
									default: 'default',
									description: 'Transformer instance ID for caching',
									example: 'user-profiles'
								},
								modelName: {
									type: 'string',
									default: 'gemini-2.0-flash',
									description: 'Gemini model to use',
									options: ['gemini-2.0-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-flash', 'gemini-1.5-pro']
								},
								apiKey: {
									type: 'string',
									description: 'Override default Gemini API key (optional)',
									note: 'Usually set via GEMINI_API_KEY environment variable'
								},
								
								// Few-shot learning
								examples: {
									type: 'array',
									description: 'Training examples for few-shot learning',
									example: [
										{ 
											PROMPT: { name: 'Alice' }, 
											ANSWER: { greeting: 'Hello Alice!' },
											CONTEXT: 'Generate friendly greetings',
											EXPLANATION: 'Create personalized greeting'
										}
									]
								},
								exampleData: {
									type: 'array',
									description: 'Alias for examples parameter',
									note: 'Same format as examples'
								},
								examplesFile: {
									type: 'string',
									description: 'Path to JSON file containing examples',
									example: './training-data.json'
								},
								
								// Custom field mappings
								promptKey: {
									type: 'string',
									default: 'PROMPT',
									description: 'Key name for input examples',
									example: 'INPUT'
								},
								answerKey: {
									type: 'string',
									default: 'ANSWER',
									description: 'Key name for output examples',
									example: 'OUTPUT'
								},
								contextKey: {
									type: 'string',
									default: 'CONTEXT',
									description: 'Key name for context information',
									example: 'INSTRUCTIONS'
								},
								explanationKey: {
									type: 'string',
									default: 'EXPLANATION',
									description: 'Key name for explanations',
									example: 'REASONING'
								},
								systemInstructionsKey: {
									type: 'string',
									default: 'SYSTEM',
									description: 'Key name for system instructions override'
								},
								
								// AI model configuration
								systemInstructions: {
									type: 'string',
									description: 'Custom system prompt for the AI',
									example: 'You are a helpful data transformer. Convert input to the specified format.'
								},
								chatConfig: {
									type: 'object',
									description: 'Gemini chat configuration',
									properties: {
										temperature: {
											type: 'number',
											default: 0.2,
											range: '0.0-2.0',
											description: 'Response randomness'
										},
										topP: {
											type: 'number', 
											default: 0.95,
											range: '0.0-1.0',
											description: 'Nucleus sampling parameter'
										},
										topK: {
											type: 'number',
											default: 64,
											description: 'Top-k sampling parameter'
										},
										responseMimeType: {
											type: 'string',
											default: 'application/json',
											description: 'Expected response format'
										}
									}
								},
								responseSchema: {
									type: 'object',
									description: 'JSON schema to enforce output structure',
									example: {
										type: 'object',
										properties: {
											name: { type: 'string' },
											age: { type: 'number' }
										},
										required: ['name']
									}
								},
								
								// Behavior control
								onlyJSON: {
									type: 'boolean',
									default: true,
									description: 'Whether to enforce JSON-only responses'
								},
								maxRetries: {
									type: 'number',
									default: 3,
									description: 'Maximum retry attempts on failure'
								},
								retryDelay: {
									type: 'number',
									default: 1000,
									description: 'Delay between retries in milliseconds'
								},
								asyncValidator: {
									type: 'function',
									description: 'Custom validation function for responses',
									note: 'Not applicable via HTTP - for SDK use only'
								}
							},
							response: {
								success: 'Transformed data object',
								error: {
									error: 'Error message',
									runId: 'unique-run-id'
								}
							}
						}
					},
					'/health': {
						methods: ['GET', 'POST'],
						description: 'Health check endpoint',
						response: {
							status: 'ok',
							message: 'Service is healthy',
							runId: 'unique-run-id'
						}
					},
					'/help': {
						methods: ['GET', 'POST'],
						description: 'This help documentation',
						response: 'This documentation object'
					}
				},
				examples: {
					basic_transformation: {
						description: 'Simple data transformation',
						request: {
							method: 'POST',
							url: '/',
							body: {
								code_phrase: 'your-secret-phrase',
								payload: { name: 'John Doe', age: 30 }
							}
						}
					},
					with_examples: {
						description: 'Transformation with few-shot learning',
						request: {
							method: 'POST',
							url: '/',
							body: {
								code_phrase: 'your-secret-phrase',
								payload: { text: 'hello world' },
								examples: [
									{
										PROMPT: { text: 'good morning' },
										ANSWER: { uppercase: 'GOOD MORNING', length: 12 }
									},
									{
										PROMPT: { text: 'goodbye' },
										ANSWER: { uppercase: 'GOODBYE', length: 7 }
									}
								]
							}
						}
					},
					with_context: {
						description: 'Using context for specific instructions',
						request: {
							method: 'POST',
							url: '/',
							body: {
								code_phrase: 'your-secret-phrase',
								payload: { number: 42 },
								examples: [
									{
										CONTEXT: 'Double the input number',
										PROMPT: { number: 5 },
										ANSWER: { result: 10 }
									}
								]
							}
						}
					},
					custom_model: {
						description: 'Using different model with custom configuration',
						request: {
							method: 'POST',
							url: '/',
							body: {
								code_phrase: 'your-secret-phrase',
								payload: { task: 'analyze sentiment' },
								modelName: 'gemini-1.5-pro',
								chatConfig: {
									temperature: 0.1,
									topP: 0.9
								}
							}
						}
					},
					url_parameters: {
						description: 'Using URL parameters for configuration',
						request: {
							method: 'POST',
							url: '/?modelName=gemini-2.0-flash&temperature=0.5&code_phrase=your-secret-phrase',
							body: {
								payload: { input: 'data to transform' }
							}
						}
					},
					response_schema: {
						description: 'Enforcing specific output structure',
						request: {
							method: 'POST',
							url: '/',
							body: {
								code_phrase: 'your-secret-phrase',
								payload: { name: 'Alice', contact: 'alice@example.com' },
								responseSchema: {
									type: 'object',
									properties: {
										user_id: { type: 'string' },
										display_name: { type: 'string' },
										email: { type: 'string' }
									},
									required: ['user_id', 'display_name']
								}
							}
						}
					}
				},
				curl_examples: [
					{
						name: 'Health Check',
						command: 'curl -X GET https://your-service.com/health'
					},
					{
						name: 'Basic Transformation',
						command: `curl -X POST https://your-service.com/ \\
  -H "Content-Type: application/json" \\
  -d '{"code_phrase": "your-secret-phrase", "payload": {"name": "John", "age": 30}}'`
					},
					{
						name: 'With Examples',
						command: `curl -X POST https://your-service.com/ \\
  -H "Content-Type: application/json" \\
  -d '{
    "code_phrase": "your-secret-phrase",
    "payload": {"text": "hello"},
    "examples": [
      {"PROMPT": {"text": "hi"}, "ANSWER": {"greeting": "Hello there!"}}
    ]
  }'`
					},
					{
						name: 'URL Parameters',
						command: `curl -X POST "https://your-service.com/?modelName=gemini-1.5-flash&temperature=0.3&code_phrase=your-secret-phrase" \\
  -H "Content-Type: application/json" \\
  -d '{"payload": {"input": "transform this"}}'`
					}
				],
				notes: [
					'Authentication required: Include code_phrase (or CODE_PHRASE, code, auth) in request body or URL parameters',
					'/health and /help endpoints do not require authentication',
					'The service caches transformer instances based on configuration for better performance',
					'URL parameters are merged with request body, with body taking precedence',
					'JSON strings in URL parameters are automatically parsed',
					'The service supports both payload and data as parameter names',
					'System instructions can be overridden via examples using the systemInstructionsKey',
					'Response schemas enforce strict output structure when provided',
					'All endpoints accept both GET and POST requests',
					'Validation functions are only available when using the SDK directly'
				],
				runId
			};
			
			sendJson(res, 200, helpDoc);
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