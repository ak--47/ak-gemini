/**
 * HTTP Integration Tests - Tests the function by making actual HTTP requests
 * to a locally running Cloud Function instance.
 * 
 * Run with: npm run test:integration
 */

import { describe, test, expect } from "@jest/globals";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();
const { CODE_PHRASE = "" } = process.env;

if (!CODE_PHRASE) {
	throw new Error("CODE_PHRASE environment variable is not set");
}

const BASE_URL = "http://localhost:8080";

// Helper to make HTTP requests
async function makeRequest(path = '/', options = {}) {
	const url = `${BASE_URL}${path}`;
	const {
		method = 'GET',
		body = null,
		query = {},
		headers = { 'Content-Type': 'application/json' }
	} = options;

	// Add query parameters
	const searchParams = new URLSearchParams(query);
	const fullUrl = searchParams.toString() ? `${url}?${searchParams}` : url;

	const fetchOptions = {
		method,
		headers,
		...(body && { body: JSON.stringify(body) })
	};

	const response = await fetch(fullUrl, fetchOptions);
	
	let data;
	try {
		data = await response.json();
	} catch (e) {
		data = await response.text();
	}

	return {
		status: response.status,
		data,
		headers: response.headers
	};
}

describe("HTTP Integration Tests", () => {
	
	describe("Health endpoint", () => {
		test("GET /health returns healthy status", async () => {
			const response = await makeRequest('/health');
			
			expect(response.status).toBe(200);
			expect(response.data.status).toBe("ok");
			expect(response.data.message).toBe("Service is healthy");
			expect(response.data.runId).toBeDefined();
		});
	});

	describe("Help endpoint", () => {
		test("GET /help returns documentation", async () => {
			const response = await makeRequest('/help');
			
			expect(response.status).toBe(200);
			expect(response.data.service).toBe("AI Transformer Service");
			expect(response.data.endpoints).toBeDefined();
			expect(response.data.examples).toBeDefined();
		});
	});

	describe("Authentication", () => {
		test("Main endpoint requires authentication", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				body: { payload: { test: "no auth" } }
			});
			
			expect(response.status).toBe(401);
			expect(response.data.error).toMatch(/unauthorized/i);
		});

		test("Correct authentication allows access", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				body: { 
					code_phrase: CODE_PHRASE,
					payload: { test: "authenticated" },
					systemInstructions: "Return JSON with 'status': 'success'"
				}
			});
			
			expect(response.status).toBe(200);
			expect(response.data).toBeTruthy();
		}, 10000);

		test("Authentication via URL parameters works", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				query: { code_phrase: CODE_PHRASE },
				body: { 
					payload: { test: "url auth" },
					systemInstructions: "Return JSON with 'method': 'url_auth'"
				}
			});
			
			expect(response.status).toBe(200);
			expect(response.data).toBeTruthy();
		}, 10000);
	});

	describe("GET requests", () => {
		test("GET / with auth returns service info", async () => {
			const response = await makeRequest('/', {
				query: { code_phrase: CODE_PHRASE }
			});
			
			expect(response.status).toBe(200);
			expect(response.data.message).toBe("AI Transformer Service");
			expect(response.data.usage).toMatch(/POST with payload/);
		});
	});

	describe("AI Transformation", () => {
		test("Basic transformation works", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				body: {
					code_phrase: CODE_PHRASE,
					payload: { name: "Alice" },
					systemInstructions: "Return JSON with a greeting for the person. Use format: {'greeting': 'Hello [name]!'}"
				}
			});
			
			expect(response.status).toBe(200);
			expect(response.data).toBeTruthy();
			expect(typeof response.data).toBe('object');
		}, 15000);

		test("Transformation with examples works", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				body: {
					code_phrase: CODE_PHRASE,
					payload: { number: 6 },
					examples: [
						{ PROMPT: { number: 2 }, ANSWER: { doubled: 4 } },
						{ PROMPT: { number: 3 }, ANSWER: { doubled: 6 } }
					]
				}
			});
			
			expect(response.status).toBe(200);
			expect(response.data).toBeTruthy();
			expect(response.data.doubled).toBe(12);
		}, 15000);

		test("Model configuration works", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				body: {
					code_phrase: CODE_PHRASE,
					payload: { text: "testing" },
					modelName: "gemini-1.5-flash-8b",
					chatConfig: { temperature: 0.1 },
					systemInstructions: "Return JSON with 'processed': true and 'original': [input text]"
				}
			});
			
			expect(response.status).toBe(200);
			expect(response.data).toBeTruthy();
		}, 15000);
	});

	describe("Error handling", () => {
		test("Missing payload returns error", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				body: { code_phrase: CODE_PHRASE }
			});
			
			expect(response.status).toBe(500);
			expect(response.data.error).toMatch(/missing.*payload/i);
		});

		test("Unknown endpoint returns 404", async () => {
			const response = await makeRequest('/unknown', {
				query: { code_phrase: CODE_PHRASE }
			});
			
			expect(response.status).toBe(404);
			expect(response.data.error).toMatch(/invalid path/i);
		});
	});

	describe("Parameter merging", () => {
		test("URL and body parameters are merged", async () => {
			const response = await makeRequest('/', {
				method: 'POST',
				query: { 
					modelName: "gemini-1.5-flash-8b",
					temperature: "0.2"
				},
				body: {
					code_phrase: CODE_PHRASE,
					payload: { test: "merged params" },
					systemInstructions: "Return JSON with 'merged': true"
				}
			});
			
			expect(response.status).toBe(200);
		}, 10000);
	});
});