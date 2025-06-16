// @ts-ignore
import { getFunction } from "@google-cloud/functions-framework/testing";
import { jest } from "@jest/globals";
import dotenv from "dotenv";
dotenv.config();
const { CODE_PHRASE = "" } = process.env;
if (!CODE_PHRASE) {
	throw new Error("CODE_PHRASE environment variable is not set");
}

// Mock the AITransformer module
const mockInit = jest.fn();
const mockSeed = jest.fn();
const mockMessage = jest.fn();
const mockReset = jest.fn();

const mockTransformer = {
	init: mockInit,
	seed: mockSeed,
	message: mockMessage,
	reset: mockReset,
	modelName: 'mock-model'
};

// Mock the AITransformer constructor
const MockAITransformer = jest.fn(() => mockTransformer);

// Mock the module
jest.unstable_mockModule('../index.js', () => ({
	default: MockAITransformer
}));

// Mock environment variables for testing
const originalEnv = process.env;
beforeAll(() => {
	process.env.CODE_PHRASE = CODE_PHRASE;
});
afterAll(() => {
	process.env = originalEnv;
});

let func;
beforeAll(async () => {
	await import("../function.js");
	func = getFunction("entry");
});

beforeEach(() => {
	jest.clearAllMocks();
	mockInit.mockResolvedValue(undefined);
	mockSeed.mockResolvedValue(undefined);
	mockMessage.mockResolvedValue({ transformed: true });
	mockReset.mockResolvedValue(undefined);
});

// Helper to create a req object
function prepReq(req) {
	return {
		body: req.body || {},
		path: req.path || '/',
		method: req.method || "POST",
		query: req.query || {},
		headers: req.headers || { "content-type": "application/json" }
	};
}

// Helper response stub
function makeRes() {
	let _result, _status, _headers = {};
	const res = {
		send: x => { _result = typeof x === "string" ? JSON.parse(x) : x; return res; },
		status: x => { _status = x; return res; },
		set: (k, v) => { _headers[k] = v; return res; },
		_result: () => _result,
		_status: () => _status,
		_headers: () => _headers,
	};
	return res;
}

describe("Cloud Function - Simplified API", () => {

	describe("Health endpoint", () => {
		test("/health returns health status", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/health" }), res);
			expect(res._status()).toBe(200);
			expect(res._result().status).toBe("ok");
			expect(res._result().message).toBe("Service is healthy");
		});
	});

	describe("Help endpoint", () => {
		test("GET /help returns comprehensive API documentation", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/help", method: "GET" }), res);
			
			expect(res._status()).toBe(200);
			const helpDoc = res._result();
			
			// Check main structure
			expect(helpDoc.service).toBe("AI Transformer Service");
			expect(helpDoc.description).toMatch(/Google Gemini API wrapper/);
			expect(helpDoc.version).toBeDefined();
			expect(helpDoc.runId).toBeDefined();
			
			// Check endpoints documentation
			expect(helpDoc.endpoints).toBeDefined();
			expect(helpDoc.endpoints['/']).toBeDefined();
			expect(helpDoc.endpoints['/health']).toBeDefined();
			expect(helpDoc.endpoints['/help']).toBeDefined();
			
			// Check main endpoint documentation
			const mainEndpoint = helpDoc.endpoints['/'];
			expect(mainEndpoint.methods).toEqual(['GET', 'POST']);
			expect(mainEndpoint.post.parameters).toBeDefined();
			expect(mainEndpoint.post.parameters.payload).toBeDefined();
			expect(mainEndpoint.post.parameters.examples).toBeDefined();
			expect(mainEndpoint.post.parameters.modelName).toBeDefined();
		});

		test("POST /help also returns help documentation", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/help", method: "POST" }), res);
			
			expect(res._status()).toBe(200);
			expect(res._result().service).toBe("AI Transformer Service");
		});

		test("Help documentation includes parameter details", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/help" }), res);
			
			const helpDoc = res._result();
			const params = helpDoc.endpoints['/'].post.parameters;
			
			// Core transformation parameters
			expect(params.payload.type).toBe('object|string|array|primitive');
			expect(params.data.description).toMatch(/alias for payload/i);
			
			// Configuration parameters
			expect(params.modelName.default).toBe('gemini-2.0-flash');
			expect(params.modelName.options).toContain('gemini-1.5-flash');
			expect(params.id.default).toBe('default');
			
			// Few-shot learning parameters
			expect(params.examples.type).toBe('array');
			expect(params.examples.example).toBeDefined();
			expect(params.exampleData.description).toMatch(/alias for examples/i);
			
			// Custom key mappings
			expect(params.promptKey.default).toBe('PROMPT');
			expect(params.answerKey.default).toBe('ANSWER');
			expect(params.contextKey.default).toBe('CONTEXT');
			expect(params.explanationKey.default).toBe('EXPLANATION');
			
			// AI configuration
			expect(params.chatConfig.properties.temperature).toBeDefined();
			expect(params.chatConfig.properties.topP).toBeDefined();
			expect(params.responseSchema.description).toMatch(/JSON schema/i);
			
			// Behavior control
			expect(params.onlyJSON.default).toBe(true);
			expect(params.maxRetries.default).toBe(3);
			expect(params.retryDelay.default).toBe(1000);
		});

		test("Help documentation includes practical examples", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/help" }), res);
			
			const helpDoc = res._result();
			
			// Check examples section exists
			expect(helpDoc.examples).toBeDefined();
			expect(helpDoc.examples.basic_transformation).toBeDefined();
			expect(helpDoc.examples.with_examples).toBeDefined();
			expect(helpDoc.examples.with_context).toBeDefined();
			expect(helpDoc.examples.custom_model).toBeDefined();
			expect(helpDoc.examples.url_parameters).toBeDefined();
			expect(helpDoc.examples.response_schema).toBeDefined();
			
			// Check example structure
			const basicExample = helpDoc.examples.basic_transformation;
			expect(basicExample.description).toBeDefined();
			expect(basicExample.request.method).toBe('POST');
			expect(basicExample.request.url).toBe('/');
			expect(basicExample.request.body.payload).toBeDefined();
			
			// Check few-shot example
			const examplesExample = helpDoc.examples.with_examples;
			expect(examplesExample.request.body.examples).toBeDefined();
			expect(Array.isArray(examplesExample.request.body.examples)).toBe(true);
			expect(examplesExample.request.body.examples[0].PROMPT).toBeDefined();
			expect(examplesExample.request.body.examples[0].ANSWER).toBeDefined();
		});

		test("Help documentation includes curl examples", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/help" }), res);
			
			const helpDoc = res._result();
			
			// Check curl examples section
			expect(helpDoc.curl_examples).toBeDefined();
			expect(Array.isArray(helpDoc.curl_examples)).toBe(true);
			expect(helpDoc.curl_examples.length).toBeGreaterThan(0);
			
			// Check curl example structure
			const curlExamples = helpDoc.curl_examples;
			curlExamples.forEach(example => {
				expect(example.name).toBeDefined();
				expect(example.command).toBeDefined();
				expect(typeof example.command).toBe('string');
				expect(example.command).toMatch(/curl/);
			});
			
			// Check specific examples
			const healthExample = curlExamples.find(ex => ex.name === 'Health Check');
			expect(healthExample.command).toMatch(/GET.*\/health/);
			
			const basicExample = curlExamples.find(ex => ex.name === 'Basic Transformation');
			expect(basicExample.command).toMatch(/POST/);
			expect(basicExample.command).toMatch(/Content-Type: application\/json/);
			expect(basicExample.command).toMatch(/payload/);
		});

		test("Help documentation includes useful notes", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/help" }), res);
			
			const helpDoc = res._result();
			
			// Check notes section
			expect(helpDoc.notes).toBeDefined();
			expect(Array.isArray(helpDoc.notes)).toBe(true);
			expect(helpDoc.notes.length).toBeGreaterThan(0);
			
			// Check for key implementation details
			const notesText = helpDoc.notes.join(' ');
			expect(notesText).toMatch(/caches transformer instances/i);
			expect(notesText).toMatch(/URL parameters.*merged/i);
			expect(notesText).toMatch(/JSON strings.*parsed/i);
			expect(notesText).toMatch(/payload.*data.*parameter/i);
		});

		test("Help endpoint works with query parameters", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/help", 
				method: "GET",
				query: { format: "json", verbose: "true" }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(res._result().service).toBe("AI Transformer Service");
		});

		test("Help documentation has consistent structure", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/help" }), res);
			
			const helpDoc = res._result();
			
			// Required top-level properties
			expect(helpDoc).toHaveProperty('service');
			expect(helpDoc).toHaveProperty('description');
			expect(helpDoc).toHaveProperty('version');
			expect(helpDoc).toHaveProperty('endpoints');
			expect(helpDoc).toHaveProperty('examples');
			expect(helpDoc).toHaveProperty('curl_examples');
			expect(helpDoc).toHaveProperty('notes');
			expect(helpDoc).toHaveProperty('runId');
			
			// Endpoints should have consistent structure
			Object.values(helpDoc.endpoints).forEach(endpoint => {
				expect(endpoint).toHaveProperty('methods');
				expect(endpoint).toHaveProperty('description');
				expect(Array.isArray(endpoint.methods)).toBe(true);
			});
		});
	});

	describe("Authentication", () => {
		test("Main endpoint requires authentication", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload: { test: 123 } } // No code_phrase
			}), res);
			
			expect(res._status()).toBe(401);
			expect(res._result().error).toMatch(/unauthorized/i);
			expect(res._result().hint).toMatch(/code_phrase/i);
		});

		test("Main endpoint allows access with correct code_phrase in body", async () => {
			const payload = { test: 456 };
			mockMessage.mockResolvedValue({ transformed: payload });
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { 
					code_phrase: CODE_PHRASE,
					payload 
				}
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockMessage).toHaveBeenCalledWith(payload);
		});

		test("Main endpoint allows access with correct CODE_PHRASE in body", async () => {
			const payload = { test: 789 };
			mockMessage.mockResolvedValue({ transformed: payload });
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { 
					CODE_PHRASE: CODE_PHRASE,
					payload 
				}
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockMessage).toHaveBeenCalledWith(payload);
		});

		test("Main endpoint allows access with code in URL parameters", async () => {
			const payload = { test: 101112 };
			mockMessage.mockResolvedValue({ transformed: payload });
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				query: { code_phrase: CODE_PHRASE },
				body: { code_phrase: CODE_PHRASE, payload }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockMessage).toHaveBeenCalledWith(payload);
		});

		test("Main endpoint supports alternative auth parameter names", async () => {
			const payload = { test: 131415 };
			mockMessage.mockResolvedValue({ transformed: payload });
			
			// Test 'code' parameter
			const res1 = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { 
					code: CODE_PHRASE,
					payload 
				}
			}), res1);
			expect(res1._status()).toBe(200);
			
			// Test 'auth' parameter
			const res2 = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { 
					auth: CODE_PHRASE,
					payload 
				}
			}), res2);
			expect(res2._status()).toBe(200);
		});

		test("Main endpoint rejects wrong code_phrase", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { 
					code_phrase: 'wrong-secret',
					payload: { test: 123 } 
				}
			}), res);
			
			expect(res._status()).toBe(401);
			expect(res._result().error).toMatch(/unauthorized/i);
		});

		test("Body auth takes precedence over URL auth", async () => {
			const payload = { test: 161718 };
			mockMessage.mockResolvedValue({ transformed: payload });
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				query: { code_phrase: 'wrong-key' },
				body: { 
					code_phrase: CODE_PHRASE, // Correct one in body
					payload 
				}
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockMessage).toHaveBeenCalledWith(payload);
		});

		test("/health endpoint bypasses authentication", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/health",
				method: "GET"
				// No code_phrase provided
			}), res);
			
			expect(res._status()).toBe(200);
			expect(res._result().status).toBe("ok");
		});

		test("/help endpoint bypasses authentication", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/help",
				method: "GET"
				// No code_phrase provided
			}), res);
			
			expect(res._status()).toBe(200);
			expect(res._result().service).toBe("AI Transformer Service");
		});

		test("Authentication failure logs include runId", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload: { test: 123 } } // No auth
			}), res);
			
			expect(res._status()).toBe(401);
			expect(res._result().runId).toBeDefined();
			expect(typeof res._result().runId).toBe('string');
		});
	});

	describe("Root endpoint - GET requests", () => {
		test("GET / without payload returns service info", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "GET",
				query: { code_phrase: CODE_PHRASE }
			}), res);
			expect(res._status()).toBe(200);
			expect(res._result().message).toBe("AI Transformer Service");
			expect(res._result().usage).toMatch(/POST with payload/);
		});

		test("GET / with URL params but no payload returns service info", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "GET",
				query: { 
					code_phrase: CODE_PHRASE,
					modelName: "gemini-2.0-flash", 
					temperature: "0.5" 
				}
			}), res);
			expect(res._status()).toBe(200);
			expect(res._result().message).toBe("AI Transformer Service");
		});
	});

	describe("Root endpoint - POST requests", () => {
		test("POST / with payload transforms data", async () => {
			const payload = { test: 123 };
			mockMessage.mockResolvedValue({ transformed: payload });
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { code_phrase: CODE_PHRASE, payload }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(res._result()).toEqual({ transformed: payload });
			expect(MockAITransformer).toHaveBeenCalled();
			expect(mockInit).toHaveBeenCalled();
			expect(mockMessage).toHaveBeenCalledWith(payload);
		});

		test("POST / with data parameter (alias for payload)", async () => {
			const data = { test: 456 };
			mockMessage.mockResolvedValue({ transformed: data });
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { code_phrase: CODE_PHRASE, data }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockMessage).toHaveBeenCalledWith(data);
		});

		test("POST / with transformer configuration options", async () => {
			const payload = { test: 789 };
			const options = {
				modelName: "gemini-2.0-flash",
				temperature: 0.7,
				maxRetries: 2
			};
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { code_phrase: CODE_PHRASE, payload, ...options }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(MockAITransformer).toHaveBeenCalledWith(expect.objectContaining(options));
		});

		test("POST / with examples seeds transformer first", async () => {
			const payload = { test: 999 };
			const examples = [
				{ PROMPT: { input: 1 }, ANSWER: { output: 2 } }
			];
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { code_phrase: CODE_PHRASE, payload, examples }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockSeed).toHaveBeenCalledWith(examples);
			expect(mockMessage).toHaveBeenCalledWith(payload);
		});

		test("POST / with exampleData parameter", async () => {
			const payload = { test: 111 };
			const exampleData = [
				{ PROMPT: { x: 1 }, ANSWER: { y: 2 } }
			];
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { code_phrase: CODE_PHRASE, payload, exampleData }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockSeed).toHaveBeenCalledWith(exampleData);
		});
	});

	describe("Parameter merging", () => {
		test("URL params are parsed and merged with body params", async () => {
			const payload = { test: 222 };
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				query: { 
					modelName: "gemini-1.5-flash",
					temperature: "0.3",
					examples: JSON.stringify([{ PROMPT: { a: 1 }, ANSWER: { b: 2 } }])
				},
				body: { code_phrase: CODE_PHRASE, payload }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(MockAITransformer).toHaveBeenCalledWith(expect.objectContaining({
				modelName: "gemini-1.5-flash",
				temperature: "0.3"
			}));
		});

		test("Body params override URL params", async () => {
			const payload = { test: 333 };
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				query: { 
					modelName: "gemini-from-url",
					temperature: "0.1"
				},
				body: { 
					payload,
					modelName: "gemini-from-body",
					temperature: 0.9
				}
			}), res);
			
			expect(res._status()).toBe(200);
			expect(MockAITransformer).toHaveBeenCalledWith(expect.objectContaining({
				modelName: "gemini-from-body",
				temperature: 0.9
			}));
		});
	});

	describe("Transformer caching", () => {
		test("Same configuration reuses transformer instance", async () => {
			const payload1 = { test: 444 };
			const payload2 = { test: 555 };
			const options = { modelName: "gemini-2.0-flash", temperature: 0.5 };
			
			// First request
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload: payload1, ...options }
			}), makeRes());
			
			// Second request with same options
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload: payload2, ...options }
			}), makeRes());
			
			// Should only create transformer once
			expect(MockAITransformer).toHaveBeenCalledTimes(1);
			expect(mockInit).toHaveBeenCalledTimes(1);
		});

		test("Different configuration creates new transformer", async () => {
			const payload = { test: 666 };
			
			// First request
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload, modelName: "gemini-1.5-flash" }
			}), makeRes());
			
			// Second request with different model
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload, modelName: "gemini-2.0-flash" }
			}), makeRes());
			
			// Should create two transformers
			expect(MockAITransformer).toHaveBeenCalledTimes(2);
		});
	});

	describe("Error handling", () => {
		test("Missing payload returns 500 error", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { modelName: "gemini-2.0-flash" } // No payload
			}), res);
			
			expect(res._status()).toBe(500);
			expect(res._result().error).toMatch(/missing.*payload.*data/i);
		});

		test("Transformer error is handled gracefully", async () => {
			mockMessage.mockRejectedValue(new Error("Transformation failed"));
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload: { test: 777 } }
			}), res);
			
			expect(res._status()).toBe(500);
			expect(res._result().error).toBe("Transformation failed");
		});

		test("Unknown path returns 404", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/unknown-endpoint" }), res);
			expect(res._status()).toBe(404);
			expect(res._result().error).toMatch(/invalid path/i);
		});
	});

	describe("ID-based transformer instances", () => {
		test("Different IDs create separate transformer instances", async () => {
			const payload = { test: 888 };
			
			// First request with id1
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload, id: "transformer1" }
			}), makeRes());
			
			// Second request with id2
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				body: { payload, id: "transformer2" }
			}), makeRes());
			
			// Should create two transformers
			expect(MockAITransformer).toHaveBeenCalledTimes(2);
		});

		test("ID from query parameter works", async () => {
			const payload = { test: 999 };
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				query: { id: "url-id" },
				body: { code_phrase: CODE_PHRASE, payload }
			}), res);
			
			expect(res._status()).toBe(200);
			// The transformer should be created (we can't easily test the cache key, but we can verify it works)
			expect(MockAITransformer).toHaveBeenCalled();
		});
	});

	describe("JSON parsing in URL params", () => {
		test("JSON strings in URL params are parsed", async () => {
			const payload = { test: 1010 };
			const complexExample = { PROMPT: { nested: { data: 1 } }, ANSWER: { result: 2 } };
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				query: { 
					examples: JSON.stringify([complexExample])
				},
				body: { code_phrase: CODE_PHRASE, payload }
			}), res);
			
			expect(res._status()).toBe(200);
			expect(mockSeed).toHaveBeenCalledWith([complexExample]);
		});

		test("Invalid JSON in URL params falls back to string", async () => {
			const payload = { test: 1111 };
			
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "POST",
				query: { 
					invalidJson: "{ invalid json }"
				},
				body: { code_phrase: CODE_PHRASE, payload }
			}), res);
			
			// Should not crash, just treat as string
			expect(res._status()).toBe(200);
		});
	});
});