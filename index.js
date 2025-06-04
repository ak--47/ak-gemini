/**
 * @fileoverview
 * Generic AI transformation module that can be configured for different use cases.
 * Supports various models, system instructions, chat configurations, and example datasets.
 */

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import u from 'ak-tools';
import dotenv from 'dotenv';
import path from 'path';
import log from './logger.js';

dotenv.config();
const { NODE_ENV = "unknown", GEMINI_API_KEY = "" } = process.env;

// --- Configuration ---
if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY environment variable.");

// TYPES
/**
 * @typedef {Object} SafetySetting
 * @property {string} category - The harm category
 * @property {string} threshold - The blocking threshold
 */

/**
 * @typedef {Object} ChatConfig
 * @property {string} [responseMimeType] - MIME type for responses
 * @property {number} [temperature] - Controls randomness (0.0 to 1.0)
 * @property {number} [topP] - Controls diversity via nucleus sampling
 * @property {number} [topK] - Controls diversity by limiting top-k tokens
 * @property {string} [systemInstruction] - System instruction for the model
 * @property {SafetySetting[]} [safetySettings] - Safety settings array
 */

/**
 * @typedef {Object} AITransformerOptions
 * @property {string} [modelName='gemini-1.5-pro'] - The Gemini model to use
 * @property {string} [systemInstructions] - Custom system instructions for the model
 * @property {ChatConfig} [chatConfig] - Configuration object for the chat session
 * @property {string} [examplesFile] - Path to JSON file containing transformation examples
 * @property {TransformationExample[]} [exampleData] - Inline examples to seed the transformer
 * @property {string} [sourceKey='PROMPT'] - Key name for source data in examples
 * @property {string} [targetKey='ANSWER'] - Key name for target data in examples
 */

/**
 * @typedef {Object} TransformationExample
 * @property {Object} [CONTEXT] - optional context for the transformation
 * @property {Object} [PROMPT] - what the user provides as input
 * @property {Object} [ANSWER] - what the model should return as output
 */

/**
 * @typedef {Object} ExampleFileContent
 * @property {TransformationExample[]} examples - Array of transformation examples
 */


// Default safety settings
const DEFAULT_SAFETY_SETTINGS = [
	{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
];

// Default system instructions
const DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON). 

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.
`;

// Default chat configuration
const DEFAULT_CHAT_CONFIG = {
	responseMimeType: 'application/json',
	temperature: 0.2,
	topP: 0.95,
	topK: 64,
	systemInstruction: DEFAULT_SYSTEM_INSTRUCTIONS,
	safetySettings: DEFAULT_SAFETY_SETTINGS
};



/**
 * Generic AI Transformer class for converting data between formats using Google's Gemini AI
 */
export default class AITransformer {
	/**
	 * Creates a new AI Transformer instance
	 * @param {AITransformerOptions} [options={}] - Configuration options for the transformer
	 */
	constructor(options = {}) {
		// ? https://ai.google.dev/gemini-api/docs/models
		this.modelName = options.modelName || 'gemini-2.0-flash';
		this.systemInstructions = options.systemInstructions || DEFAULT_SYSTEM_INSTRUCTIONS;

		// Build chat config, making sure systemInstruction uses the custom instructions
		this.chatConfig = {
			...DEFAULT_CHAT_CONFIG,
			...options.chatConfig,
			systemInstruction: this.systemInstructions
		};

		// response schema is optional, but if provided, it should be a valid JSON schema
		// todo: ^ check this
		if (options.responseSchema) {
			this.chatConfig.responseSchema = options.responseSchema;
		}

		// examples file is optional, but if provided, it should contain valid PROMPT and ANSWER keys
		this.examplesFile = options.examplesFile || null;
		this.exampleData = options.exampleData || null; // can be used instead of examplesFile
		this.promptKey = options.sourceKey || 'PROMPT';
		this.answerKey = options.targetKey || 'ANSWER';
		this.contextKey = options.contextKey || null; // context is optional
		if (this.promptKey === this.answerKey) {
			throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
		}
		log.debug(`[AK-GEMINI]: Creating AI Transformer with model: ${this.modelName}`);

		this.genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
		this.chat = null;
	}

	init = initChat;
	seed = seedWithExamples;
	message = transformJSON;
	rebuild = rebuildPayload;
	reset = resetChat;
	getHistory = getChatHistory;

}



/**
	 * Initializes the chat session with the specified model and configurations.
	 * @returns {Promise<void>}
	 */
async function initChat() {
	if (this.chat) return;

	log.debug(`[AK-GEMINI]: Initializing Gemini chat session with model: ${this.modelName}...`);

	this.chat = await this.genAI.chats.create({
		model: this.modelName,
		// @ts-ignore
		config: this.chatConfig,
		history: [],
	});

	log.debug("[AK-GEMINI]: Gemini chat session initialized.");
}

/**
 * Seeds the chat session with example transformations.
 * @param {TransformationExample[]} [examples] - An array of transformation examples.
 * @returns {Promise<void>}
 */
async function seedWithExamples(examples) {
	await this.init();

	if (!examples || !Array.isArray(examples) || examples.length === 0) {
		if (this.examplesFile) {
			log.debug(`[AK-GEMINI]: No examples provided, loading from file: ${this.examplesFile}`);
			examples = await u.load(path.resolve(this.examplesFile), true);
		} else {
			log.debug("[AK-GEMINI]: No examples provided and no examples file specified. Skipping seeding.");
			return;
		}
	}

	log.debug(`[AK-GEMINI]: Seeding chat with ${examples.length} transformation examples...`);
	const historyToAdd = [];

	for (const example of examples) {
		let { CONTEXT = "", PROMPT = "", ANSWER = "" } = example; // how to ensure we have the right keys that the user provided?

		if (CONTEXT && u.isJSON(CONTEXT)) CONTEXT = JSON.stringify(CONTEXT, null, 2);
		if (CONTEXT) historyToAdd.push({ role: 'system', parts: [{ text: CONTEXT }] }); // is this the right way to add additional context for an example? or should it be @ the end AFTER the response?

		if (PROMPT && u.isJSON(PROMPT)) PROMPT = JSON.stringify(PROMPT, null, 2);
		if (PROMPT) historyToAdd.push({ role: 'user', parts: [{ text: PROMPT }] });

		if (ANSWER && u.isJSON(ANSWER)) ANSWER = JSON.stringify(ANSWER, null, 2);
		if (ANSWER) historyToAdd.push({ role: 'model', parts: [{ text: ANSWER }] });

	}

	const currentHistory = this.chat.getHistory();

	this.chat = await this.genAI.chats.create({
		model: this.modelName,
		// @ts-ignore
		config: this.chatConfig,
		history: [...currentHistory, ...historyToAdd],
	});

	log.debug("[AK-GEMINI]: Transformation examples seeded successfully.");
}

/**
 * Transforms a source JSON payload into a target JSON payload
 * @param {Object} sourcePayload - The source payload (as a JavaScript object).
 * @returns {Promise<Object>} - The transformed target payload (as a JavaScript object).
 * @throws {Error} If the transformation fails or returns invalid JSON.
 */
async function transformJSON(sourcePayload) {
	if (!this.chat) {
		throw new Error("Chat session not initialized. Call initChat() or seedWithExamples() first.");
	}

	let result;
	let actualPayload;
	if (sourcePayload && u.isJSON(sourcePayload)) actualPayload = JSON.stringify(sourcePayload, null, 2);
	else if (typeof sourcePayload === 'string') actualPayload = sourcePayload;
	else throw new Error("Invalid source payload. Must be a JSON object or a valid JSON string.");
	try {
		result = await this.chat.sendMessage({ message: actualPayload });
	} catch (error) {
		log.error("Error with Gemini API:", error);
		throw new Error(`Transformation failed: ${error.message}`);
	}

	try {
		const modelResponse = result.text;
		const parsedResponse = JSON.parse(modelResponse);
		return parsedResponse;
	} catch (parseError) {
		log.error("Error parsing Gemini response:", parseError);
		throw new Error(`Invalid JSON response from Gemini: ${parseError.message}`);
	}
}

/**
 * Rebuilds a payload based on server error feedback
 * @param {Object} lastPayload - The payload that failed validation
 * @param {string} serverError - The error message from the server
 * @returns {Promise<Object>} - A new corrected payload
 * @throws {Error} If the rebuild process fails.
 */
async function rebuildPayload(lastPayload, serverError) {
	await this.initChat();

	const prompt = `
The previous JSON payload (below) failed validation.
The server's error message is quoted afterward.

---------------- BAD PAYLOAD ----------------
${JSON.stringify(lastPayload, null, 2)}
---------------- SERVER ERROR ----------------
${serverError}

Please return a NEW JSON payload that corrects the issue.
Respond with JSON only – no comments or explanations.
`;

	let result;
	try {
		result = await this.chat.sendMessage({ message: prompt });
	} catch (err) {
		throw new Error(`Gemini call failed while repairing payload: ${err.message}`);
	}

	try {
		const text = result.text ?? result.response ?? '';
		return typeof text === 'object' ? text : JSON.parse(text);
	} catch (parseErr) {
		throw new Error(`Gemini returned non-JSON while repairing payload: ${parseErr.message}`);
	}
}

/**
 * Resets the current chat session, clearing all history and examples
 * @returns {Promise<void>}
 */
async function resetChat() {
	if (this.chat) {
		log.debug("Resetting Gemini chat session...");
		this.chat = await this.genAI.chats.create({
			model: this.modelName,
			// @ts-ignore
			config: this.chatConfig,
			history: [],
		});
		log.debug("Chat session reset.");
	} else {
		log.warn("Cannot reset chat session: chat not yet initialized.");
	}
}

/**
 * Retrieves the current conversation history for debugging or inspection
 * @returns {Array<Object>} - An array of message objects in the conversation.
 */
function getChatHistory() {
	if (!this.chat) {
		log.warn("Chat session not initialized. No history available.");
		return [];
	}
	return this.chat.getHistory();
}

/**
 * Utility function for retry logic with exponential backoff
 * @param {Function} fn - The function to retry
 * @param {number} [retries=3] - Number of retry attempts
 * @param {number} [delay=1000] - Initial delay in milliseconds
 * @returns {Promise<*>} - The result of the function call
 * @throws {Error} If all retry attempts fail
 */
async function withRetry(fn, retries = 3, delay = 1000) {
	for (let i = 0; i < retries; i++) {
		try {
			return await fn();
		} catch (error) {
			if (i < retries - 1) {
				log.warn(`Attempt ${i + 1} failed, retrying in ${delay / 1000}s...`, error.message);
				await new Promise(res => setTimeout(res, delay));
				delay *= 2; // Exponential backoff
			} else {
				throw error; // Re-throw if all retries fail
			}
		}
	}
}



if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	log.info("RUNNING AI Transformer as standalone script...");
	(
		async () => {
			try {
				log.info("Initializing AI Transformer...");
				const transformer = new AITransformer({
					modelName: 'gemini-2.5-flash-preview-05-20',
					// systemInstructions: DEFAULT_SYSTEM_INSTRUCTIONS,
					// examplesFile: './examples.json', // Path to your examples file
					// sourceKey: 'PROMPT',
					// targetKey: 'ANSWER'
				});

				await transformer.init();
				await transformer.seed([
					{
						PROMPT: { "name": "Alice" }, ANSWER: { "profession": "data scientist", "life_as_told_by_emoji": ["🔬", "💡", "📊", "🧠", "🌟"] }
					},
					{
						PROMPT: { "name": "Bob" }, ANSWER: { "profession": "product manager", "life_as_told_by_emoji": ["📋", "🤝", "🚀", "💬", "🎯"] }
					},
					{
						PROMPT: { "name": "Eve" }, ANSWER: { "profession": "security analyst", "life_as_told_by_emoji": ["🕵️‍♀️", "🔒", "💻", "👀", "⚡️"] }
					},
				]);
				log.info("AI Transformer initialized and seeded with examples.");
				const response = await transformer.message({ "name": "AK" });
				log.info("Payload Transformed", response);
				if (NODE_ENV === 'dev') debugger;
			} catch (error) {
				log.error("Error in AI Transformer script:", error);
				if (NODE_ENV === 'dev') debugger;
			}
		})();
}