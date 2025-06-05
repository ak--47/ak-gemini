// @ts-ignore
import { getFunction } from "@google-cloud/functions-framework/testing";
import { jest } from "@jest/globals";

let func;
beforeAll(async () => {
	await import("../function.js");
	func = getFunction("entry");
});

// Helper to create a req object
function prepReq(req) {
	return {
		body: req.body || {},
		path: req.path,
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
		// Don't use getters for .status or .result!
		_result: () => _result,
		_status: () => _status,
		_headers: () => _headers,
	};
	return res;
}

describe("cloud function entrypoint", () => {

	test("/", async () => {
		const res = makeRes();
		await func(prepReq({ path: "/" }), res);
		expect(res._status()).toBe(200);
		expect(res._result().message).toBe("Service is alive");
	});

	test("/init creates and initializes a transformer", async () => {
		const res = makeRes();
		await func(prepReq({ path: "/init", body: { options: { modelName: "gemini-x" }, id: "foo" } }), res);
		expect(res._status()).toBe(200);
		expect(res._result()).toEqual({ status: "initialized", model: "mock-model", id: "foo" });
		expect(mockInit).toHaveBeenCalled();
	});

	test("/seed calls transformer.seed with examples", async () => {
		const res = makeRes();
		const examples = [{ PROMPT: { test: 1 }, ANSWER: { test: 2 } }];
		await func(prepReq({ path: "/seed", body: { examples, id: "foo" } }), res);
		expect(res._status()).toBe(200);
		expect(res._result()).toEqual({ status: "seeded", count: 1, id: "foo" });
		expect(mockSeed).toHaveBeenCalledWith(examples);
	});

	test("/transform calls transformer.message", async () => {
		const res = makeRes();
		const payload = { test: 123 };
		mockMessage.mockResolvedValue({ output: 321 });
		await func(prepReq({ path: "/transform", body: { payload, id: "foo" } }), res);
		expect(res._status()).toBe(200);
		expect(res._result()).toEqual({ output: 321 });
		expect(mockMessage).toHaveBeenCalledWith(payload);
	});

	test("/reset calls transformer.reset", async () => {
		const res = makeRes();
		await func(prepReq({ path: "/reset", body: { id: "foo" } }), res);
		expect(res._status()).toBe(200);
		expect(res._result()).toEqual({ status: "reset", id: "foo" });
		expect(mockReset).toHaveBeenCalled();
	});

	test("/validate calls transformer.transformWithValidation", async () => {
		const res = makeRes();
		const payload = { foo: 1 };
		const validatorString = "(p) => Promise.resolve(p)";
		await func(prepReq({
			path: "/validate",
			body: { payload, validator: validatorString, id: "foo", options: { maxRetries: 1 } }
		}), res);
		expect(res._status()).toBe(200);
		expect(res._result()).toEqual({ result: "validated" });
		expect(mockTransformWithValidation).toHaveBeenCalled();
	});

	test("returns 404 for unknown path", async () => {
		const res = makeRes();
		await func(prepReq({ path: "/not-a-real-route" }), res);
		expect(res._status()).toBe(404);
		expect(res._result().error).toMatch(/invalid path/i);
	});

	test("handles missing payload or examples", async () => {
		const res = makeRes();
		await func(prepReq({ path: "/transform", body: {} }), res);
		expect(res._status()).toBe(500);
		expect(res._result().error).toMatch(/payload/i);

		const res2 = makeRes();
		await func(prepReq({ path: "/seed", body: {} }), res2);
		expect(res2._status()).toBe(500);
		expect(res2._result().error).toMatch(/examples/i);
	});

	test("handles errors from underlying methods", async () => {
		mockMessage.mockRejectedValue(new Error("broken"));
		const res = makeRes();
		await func(prepReq({ path: "/transform", body: { payload: { test: 1 } } }), res);
		expect(res._status()).toBe(500);
		expect(res._result().error).toMatch(/broken/);
	});
});
