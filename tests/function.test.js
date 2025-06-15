// @ts-ignore
import { getFunction } from "@google-cloud/functions-framework/testing";
import { jest } from "@jest/globals";

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

	describe("Root endpoint - GET requests", () => {
		test("GET / without payload returns service info", async () => {
			const res = makeRes();
			await func(prepReq({ path: "/", method: "GET" }), res);
			expect(res._status()).toBe(200);
			expect(res._result().message).toBe("AI Transformer Service");
			expect(res._result().usage).toMatch(/POST with payload/);
		});

		test("GET / with URL params but no payload returns service info", async () => {
			const res = makeRes();
			await func(prepReq({ 
				path: "/", 
				method: "GET",
				query: { modelName: "gemini-2.0-flash", temperature: "0.5" }
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
				body: { payload }
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
				body: { data }
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
				body: { payload, ...options }
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
				body: { payload, examples }
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
				body: { payload, exampleData }
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
				body: { payload }
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
				body: { payload }
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
				body: { payload }
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
				body: { payload }
			}), res);
			
			// Should not crash, just treat as string
			expect(res._status()).toBe(200);
		});
	});
});