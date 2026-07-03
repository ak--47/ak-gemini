// jest.config.js
export default {
	testEnvironment: 'node',
	transform: {},
	moduleNameMapper: {	'^(\\.{1,2}/.*)\\.js$': '$1.js'	},
	coverageDirectory: "./coverage",
	setupFiles: [
		"<rootDir>/tests/jest.setup.js"
	],
	// Real-API calls take 5-15s; jest's 5s default causes flaky timeouts.
	// (tests/setup.js tried to set this but was never registered, and
	// setupFiles runs before the jest global exists anyway.)
	testTimeout: 30000,
	verbose: true

};
