/**
 * Jest environment for ak-gemini tests.
 *
 * @google/genai 3.x sends every Node request through a dispatcher that reads
 * Node's undici global dispatcher from `globalThis[Symbol.for('undici.globalDispatcher.1')]`.
 * Node sets that symbol on the REAL global object. Jest runs each test file in a
 * vm context with its own `globalThis`, which lacks it, so every API call fails
 * with "fetch failed" / "Undici globalDispatcher is not available."
 *
 * This environment copies the real dispatcher into the test context. Production
 * code is unaffected: outside jest, `globalThis` is the real global.
 */
const { TestEnvironment } = require('jest-environment-node');

const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

class AkGeminiEnvironment extends TestEnvironment {
	async setup() {
		await super.setup();
		// Node initializes undici lazily; constructing Headers forces it.
		if (!globalThis[UNDICI_GLOBAL_DISPATCHER]) new Headers();
		const dispatcher = globalThis[UNDICI_GLOBAL_DISPATCHER];
		if (!dispatcher) throw new Error('Node did not expose an undici global dispatcher; @google/genai 3.x requests will fail.');
		this.global[UNDICI_GLOBAL_DISPATCHER] = dispatcher;
	}
}

module.exports = AkGeminiEnvironment;
