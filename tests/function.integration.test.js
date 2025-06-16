import { getFunction } from "@google-cloud/functions-framework/testing";
import { jest, describe, test, expect, beforeAll } from "@jest/globals";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();
const { CODE_PHRASE = "", GEMINI_API_KEY = "" } = process.env;

if (!CODE_PHRASE) {
	throw new Error("CODE_PHRASE environment variable is not set");
}

if (!GEMINI_API_KEY) {
	throw new Error("GEMINI_API_KEY environment variable is not set for integration tests");
}

let func;

beforeAll(async () => {
	// Import the actual function (no mocks)
	await import("../function.js");
	func = getFunction("entry");
});

// Helper to create request objects
function createRequest(options = {}) {
	return {
		body: options.body || {},
		path: options.path || '/',
		url: options.url || options.path || '/',
		method: options.method || "POST",
		query: options.query || {},
		headers: options.headers || { "content-type": "application/json" }
	};
}

// Helper to create response objects that capture results
function createResponse() {
	let result, status, headers = {};
	const res = {
		send: (data) => {
			result = typeof data === "string" ? JSON.parse(data) : data;
			return res;
		},
		status: (code) => {
			status = code;
			return res;
		},
		set: (key, value) => {
			headers[key] = value;
			return res;
		},
		getResult: () => result,
		getStatus: () => status,
		getHeaders: () => headers
	};
	return res;
}

describe("Cloud Function Integration Tests", () => {

	describe("Health endpoint", () => {
		test("GET /health returns healthy status", async () => {
			const req = createRequest({ path: "/health", method: "GET" });
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			const result = res.getResult();
			expect(result.status).toBe("ok");
			expect(result.message).toBe("Service is healthy");
			expect(result.runId).toBeDefined();
		});

		test("POST /health also works", async () => {
			const req = createRequest({ path: "/health", method: "POST" });
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			expect(res.getResult().status).toBe("ok");
		});
	});

	describe("Help endpoint", () => {
		test("GET /help returns comprehensive documentation", async () => {
			const req = createRequest({ path: "/help", method: "GET" });
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			const result = res.getResult();
			expect(result.service).toBe("AI Transformer Service");
			expect(result.description).toMatch(/Google Gemini API wrapper/);
			expect(result.endpoints).toBeDefined();
			expect(result.examples).toBeDefined();
			expect(result.curl_examples).toBeDefined();
			expect(result.notes).toBeDefined();
		});

		test("Help includes authentication documentation", async () => {
			const req = createRequest({ path: "/help" });
			const res = createResponse();
			
			await func(req, res);
			
			const result = res.getResult();
			const authParam = result.endpoints['/'].post.parameters.code_phrase;
			expect(authParam.required).toBe(true);
			expect(authParam.description).toMatch(/authentication/i);
			
			// Check that examples include code_phrase
			const basicExample = result.examples.basic_transformation;
			expect(basicExample.request.body.code_phrase).toBeDefined();
		});
	});

	describe("Authentication", () => {
		test("Main endpoint requires authentication", async () => {
			const req = createRequest({
				body: { payload: { test: "no auth" } }
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(401);
			const result = res.getResult();
			expect(result.error).toMatch(/unauthorized/i);
			expect(result.hint).toMatch(/code_phrase/i);
		});

		test("Correct code_phrase allows access", async () => {
			const req = createRequest({
				body: { 
					code_phrase: CODE_PHRASE,
					payload: { test: "authenticated access" }
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			// Should return transformed data (actual AI response)
			const result = res.getResult();
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		});

		test("Wrong code_phrase is rejected", async () => {
			const req = createRequest({
				body: { 
					code_phrase: "wrong-secret",
					payload: { test: "should fail" }
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(401);
		});

		test("Alternative auth parameter names work", async () => {
			// Test with 'code' parameter
			const req1 = createRequest({
				body: { 
					code: CODE_PHRASE,
					payload: { test: "auth with code" }
				}
			});
			const res1 = createResponse();
			
			await func(req1, res1);
			expect(res1.getStatus()).toBe(200);

			// Test with 'auth' parameter
			const req2 = createRequest({
				body: { 
					auth: CODE_PHRASE,
					payload: { test: "auth with auth" }
				}
			});
			const res2 = createResponse();
			
			await func(req2, res2);
			expect(res2.getStatus()).toBe(200);
		});

		test("Auth in URL parameters works", async () => {
			const req = createRequest({
				query: { code_phrase: CODE_PHRASE },
				body: { payload: { test: "url auth" } }
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
		});
	});

	describe("GET requests", () => {
		test("GET / without payload returns service info", async () => {
			const req = createRequest({
				method: "GET",
				query: { code_phrase: CODE_PHRASE }
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			const result = res.getResult();
			expect(result.message).toBe("AI Transformer Service");
			expect(result.usage).toMatch(/POST with payload/);
		});
	});

	describe("AI Transformation (Integration)", () => {
		test("Basic payload transformation works", async () => {
			const req = createRequest({
				body: {
					code_phrase: CODE_PHRASE,
					payload: { name: "Alice", task: "generate greeting" },
					systemInstructions: "Transform the input into a simple greeting message. Return JSON with a 'greeting' field."
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			const result = res.getResult();
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		}, 10000); // 10 second timeout for AI call

		test("Transformation with examples works", async () => {
			const req = createRequest({
				body: {
					code_phrase: CODE_PHRASE,
					payload: { number: 8 },
					examples: [
						{ PROMPT: { number: 2 }, ANSWER: { doubled: 4 } },
						{ PROMPT: { number: 5 }, ANSWER: { doubled: 10 } }
					]
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			const result = res.getResult();
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
			// Should follow the pattern and return doubled value
			expect(result.doubled).toBe(16);
		}, 15000); // 15 second timeout for AI call with examples

		test("Custom model configuration works", async () => {
			const req = createRequest({
				body: {
					code_phrase: CODE_PHRASE,
					payload: { text: "hello world" },
					modelName: "gemini-1.5-flash-8b",
					chatConfig: {
						temperature: 0.1
					},
					systemInstructions: "Convert text to uppercase. Return JSON with 'uppercase' field."
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			const result = res.getResult();
			expect(result).toBeTruthy();
			expect(typeof result).toBe('object');
		}, 10000);

		test("Response schema enforcement works", async () => {
			const req = createRequest({
				body: {
					code_phrase: CODE_PHRASE,
					payload: { name: "Bob", age: 30 },
					responseSchema: {
						type: 'object',
						properties: {
							user_name: { type: 'string' },
							user_age: { type: 'number' },
							status: { type: 'string' }
						},
						required: ['user_name', 'user_age', 'status']
					},
					systemInstructions: "Transform the input to match the required schema exactly."
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			const result = res.getResult();
			expect(result).toBeTruthy();
			expect(result.user_name).toBeDefined();
			expect(result.user_age).toBeDefined();
			expect(result.status).toBeDefined();
		}, 10000);
	});

	describe("Error handling", () => {
		test("Missing payload returns error", async () => {
			const req = createRequest({
				body: { 
					code_phrase: CODE_PHRASE,
					modelName: "gemini-2.0-flash"
					// No payload
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(500);
			const result = res.getResult();
			expect(result.error).toMatch(/missing.*payload/i);
		});

		test("Unknown endpoint returns 404", async () => {
			const req = createRequest({
				path: "/unknown-endpoint",
				query: { code_phrase: CODE_PHRASE }
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(404);
			const result = res.getResult();
			expect(result.error).toMatch(/invalid path/i);
		});
	});

	describe("Transformer caching", () => {
		test("Multiple requests work correctly", async () => {
			// First request
			const req1 = createRequest({
				body: {
					code_phrase: CODE_PHRASE,
					id: "test-transformer-1",
					payload: { value: 1 },
					systemInstructions: "Add 1 to the value. Return JSON with 'result' field."
				}
			});
			const res1 = createResponse();
			
			await func(req1, res1);
			expect(res1.getStatus()).toBe(200);

			// Second request with same ID should reuse transformer
			const req2 = createRequest({
				body: {
					code_phrase: CODE_PHRASE,
					id: "test-transformer-1",
					payload: { value: 2 }
				}
			});
			const res2 = createResponse();
			
			await func(req2, res2);
			expect(res2.getStatus()).toBe(200);
		}, 15000);
	});

	describe("Parameter merging", () => {
		test("URL params are merged with body params", async () => {
			const req = createRequest({
				query: {
					modelName: "gemini-1.5-flash-8b",
					temperature: "0.2"
				},
				body: {
					code_phrase: CODE_PHRASE,
					payload: { test: "param merging" }
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			// Should work with the model from URL params
		}, 10000);

		test("Body params override URL params", async () => {
			const req = createRequest({
				query: {
					modelName: "gemini-from-url"
				},
				body: {
					code_phrase: CODE_PHRASE,
					modelName: "gemini-1.5-flash-8b", // Should override URL
					payload: { test: "override test" }
				}
			});
			const res = createResponse();
			
			await func(req, res);
			
			expect(res.getStatus()).toBe(200);
			// Should use the model from body, not URL
		}, 10000);
	});
});