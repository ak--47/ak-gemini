/**
 * @fileoverview
 * Generic AI transformation module that can be configured for different use cases.
 * Supports various models, system instructions, chat configurations, and example datasets.
 */

/** 
 * @typedef {import('./types').SafetySetting} SafetySetting
 * @typedef {import('./types').ChatConfig} ChatConfig
 * @typedef {import('./types').TransformationExample} TransformationExample
 * @typedef {import('./types').ExampleFileContent} ExampleFileContent
 * @typedef {import('./types').AITransformerOptions} AITransformerOptions
 * @typedef {import('./types').AsyncValidatorFunction} AsyncValidatorFunction
 * @typedef {import('./types').AITransformerContext} ExportedAPI
 * 
 */

//env
import dotenv from 'dotenv';
dotenv.config();
const { NODE_ENV = "unknown", GEMINI_API_KEY } = process.env;



//deps
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import u from 'ak-tools';
import path from 'path';
import log from './logger.js';
export { log };

if (NODE_ENV === 'dev') log.level = 'debug';
if (NODE_ENV === 'test') log.level = 'warn';
if (NODE_ENV.startsWith('prod')) log.level = 'error';



// defaults
const DEFAULT_SAFETY_SETTINGS = [
	{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
	{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
];

const DEFAULT_SYSTEM_INSTRUCTIONS = `
You are an expert JSON transformation engine. Your task is to accurately convert data payloads from one format to another.

You will be provided with example transformations (Source JSON -> Target JSON). 

Learn the mapping rules from these examples.

When presented with new Source JSON, apply the learned transformation rules to produce a new Target JSON payload.

Always respond ONLY with a valid JSON object that strictly adheres to the expected output format.

Do not include any additional text, explanations, or formatting before or after the JSON object.
`;

const DEFAULT_CHAT_CONFIG = {
	responseMimeType: 'application/json',
	temperature: 0.2,
	topP: 0.95,
	topK: 64,
	systemInstruction: DEFAULT_SYSTEM_INSTRUCTIONS,
	safetySettings: DEFAULT_SAFETY_SETTINGS
};

/**
 * main export class for AI Transformer
 * @class AITransformer
 * @description A class that provides methods to initialize, seed, transform, and manage AI-based transformations using Google Gemini API.
 * @implements {ExportedAPI}
 */
// @ts-ignore
export default class AITransformer {
	/**
	 * @param {AITransformerOptions} [options={}] - Configuration options for the transformer	
	 * 
	 */
	constructor(options = {}) {
		this.modelName = "";
		this.promptKey = "";
		this.answerKey = "";
		this.contextKey = "";
		this.maxRetries = 3;
		this.retryDelay = 1000;
		this.systemInstructions = "";
		this.chatConfig = {};
		this.apiKey = GEMINI_API_KEY;
		AITransformFactory.call(this, options);

		//external API
		this.init = initChat.bind(this);
		this.seed = seedWithExamples.bind(this);
		this.message = transformJSON.bind(this);
		this.rebuild = rebuildPayload.bind(this);
		this.reset = resetChat.bind(this);
		this.getHistory = getChatHistory.bind(this);
		this.transformWithValidation = transformWithValidation.bind(this);
		this.estimate = estimateTokenUsage.bind(this);
	}
}
export { AITransformer };
/**
 * factory function to create an AI Transformer instance
 * @param {AITransformerOptions} [options={}] - Configuration options for the transformer
 * @returns {void} - An instance of AITransformer with initialized properties and methods
 */
function AITransformFactory(options = {}) {
	// ? https://ai.google.dev/gemini-api/docs/models
	this.modelName = options.modelName || 'gemini-2.0-flash';
	this.systemInstructions = options.systemInstructions || DEFAULT_SYSTEM_INSTRUCTIONS;

	this.apiKey = options.apiKey || GEMINI_API_KEY;
	if (!this.apiKey) throw new Error("Missing Gemini API key. Provide via options.apiKey or GEMINI_API_KEY env var.");
	// Build chat config, making sure systemInstruction uses the custom instructions
	this.chatConfig = {
		...DEFAULT_CHAT_CONFIG,
		...options.chatConfig,
		systemInstruction: this.systemInstructions
	};

	// response schema is optional, but if provided, it should be a valid JSON schema
	if (options.responseSchema) {
		this.chatConfig.responseSchema = options.responseSchema;
	}

	// examples file is optional, but if provided, it should contain valid PROMPT and ANSWER keys
	this.examplesFile = options.examplesFile || null;
	this.exampleData = options.exampleData || null; // can be used instead of examplesFile

	// Use configurable keys with fallbacks
	this.promptKey = options.sourceKey || 'PROMPT';
	this.answerKey = options.targetKey || 'ANSWER';
	this.contextKey = options.contextKey || 'CONTEXT'; // Now configurable

	// Retry configuration
	this.maxRetries = options.maxRetries || 3;
	this.retryDelay = options.retryDelay || 1000;

	if (this.promptKey === this.answerKey) {
		throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
	}

	log.debug(`Creating AI Transformer with model: ${this.modelName}`);
	log.debug(`Using keys - Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);

	const ai = new GoogleGenAI({ apiKey: this.apiKey });
	this.genAIClient = ai;
	this.chat = null;
}

/**
 * Initializes the chat session with the specified model and configurations.
 * @this {ExportedAPI}
 * @returns {Promise<void>}
 */
async function initChat() {
	if (this.chat) return;

	log.debug(`Initializing Gemini chat session with model: ${this.modelName}...`);

	this.chat = await this.genAIClient.chats.create({
		model: this.modelName,
		// @ts-ignore
		config: this.chatConfig,
		history: [],
	});

	log.debug("Gemini chat session initialized.");
}

/**
 * Seeds the chat session with example transformations.
 * @this {ExportedAPI}
 * @param {TransformationExample[]} [examples] - An array of transformation examples.
 * @returns {Promise<void>}
 */
async function seedWithExamples(examples) {
	await this.init();

	if (!examples || !Array.isArray(examples) || examples.length === 0) {
		if (this.examplesFile) {
			log.debug(`No examples provided, loading from file: ${this.examplesFile}`);
			examples = await u.load(path.resolve(this.examplesFile), true);
		} else {
			log.debug("No examples provided and no examples file specified. Skipping seeding.");
			return;
		}
	}

	log.debug(`Seeding chat with ${examples.length} transformation examples...`);
	const historyToAdd = [];

	for (const example of examples) {
		// Use the configurable keys from constructor
		const contextValue = example[this.contextKey] || "";
		const promptValue = example[this.promptKey] || "";
		const answerValue = example[this.answerKey] || "";

		// Add context as user message with special formatting to make it part of the example flow
		if (contextValue) {
			let contextText = u.isJSON(contextValue) ? JSON.stringify(contextValue, null, 2) : contextValue;
			// Prefix context to make it clear it's contextual information
			historyToAdd.push({
				role: 'user',
				parts: [{ text: `Context: ${contextText}` }]
			});
			// Add a brief model acknowledgment
			historyToAdd.push({
				role: 'model',
				parts: [{ text: "I understand the context." }]
			});
		}

		if (promptValue) {
			let promptText = u.isJSON(promptValue) ? JSON.stringify(promptValue, null, 2) : promptValue;
			historyToAdd.push({ role: 'user', parts: [{ text: promptText }] });
		}

		if (answerValue) {
			let answerText = u.isJSON(answerValue) ? JSON.stringify(answerValue, null, 2) : answerValue;
			historyToAdd.push({ role: 'model', parts: [{ text: answerText }] });
		}
	}

	const currentHistory = this?.chat?.getHistory() || [];

	this.chat = await this.genAIClient.chats.create({
		model: this.modelName,
		// @ts-ignore
		config: this.chatConfig,
		history: [...currentHistory, ...historyToAdd],
	});

	log.debug("Transformation examples seeded successfully.");
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
 * Transforms payload with automatic validation and retry logic
 * @param {Object} sourcePayload - The source payload to transform
 * @param {AsyncValidatorFunction} validatorFn - Async function that validates the transformed payload
 * @param {Object} [options] - Options for the validation process
 * @param {number} [options.maxRetries] - Override default max retries
 * @param {number} [options.retryDelay] - Override default retry delay
 * @returns {Promise<Object>} - The validated transformed payload
 * @throws {Error} If transformation or validation fails after all retries
 */
async function transformWithValidation(sourcePayload, validatorFn, options = {}) {
	const maxRetries = options.maxRetries ?? this.maxRetries;
	const retryDelay = options.retryDelay ?? this.retryDelay;

	let lastPayload = null;
	let lastError = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			// First attempt uses normal transformation, subsequent attempts use rebuild
			const transformedPayload = attempt === 0
				? await this.message(sourcePayload)
				: await this.rebuild(lastPayload, lastError.message);

			// Validate the transformed payload
			const validatedPayload = await validatorFn(transformedPayload);

			log.debug(`Transformation and validation succeeded on attempt ${attempt + 1}`);
			return validatedPayload;

		} catch (error) {
			lastError = error;

			if (attempt === 0) {
				// First attempt failed - could be transformation or validation error
				lastPayload = await this.message(sourcePayload).catch(() => null);
			}

			if (attempt < maxRetries) {
				const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
				log.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error.message);
				await new Promise(res => setTimeout(res, delay));
			} else {
				log.error(`All ${maxRetries + 1} attempts failed`);
				throw new Error(`Transformation with validation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
			}
		}
	}
}


/**
 * Estimate total token usage if you were to send a new payload as the next message.
 * Considers system instructions, current chat history (including examples), and the new message.
 * @param {object|string} nextPayload - The next user message to be sent (object or string)
 * @returns {Promise<{ totalTokens: number, ... }>} - The result of Gemini's countTokens API
 */
async function estimateTokenUsage(nextPayload) {
	// Compose the conversation contents, Gemini-style
	const contents = [];

	// (1) System instructions (if applicable)
	if (this.systemInstructions) {
		// Add as a 'system' part; adjust role if Gemini supports
		contents.push({ parts: [{ text: this.systemInstructions }] });
	}

	// (2) All current chat history (seeded examples + real user/model turns)
	if (this.chat && typeof this.chat.getHistory === "function") {
		const history = this.chat.getHistory();
		if (Array.isArray(history) && history.length > 0) {
			contents.push(...history);
		}
	}

	// (3) The next user message
	const nextMessage = typeof nextPayload === "string"
		? nextPayload
		: JSON.stringify(nextPayload, null, 2);

	contents.push({ parts: [{ text: nextMessage }] });

	// Call Gemini's token estimator
	const resp = await this.genAIClient.models.countTokens({
		model: this.modelName,
		contents,
	});

	return resp; // includes totalTokens, possibly breakdown
}

/**
 * Rebuilds a payload based on server error feedback
 * @param {Object} lastPayload - The payload that failed validation
 * @param {string} serverError - The error message from the server
 * @returns {Promise<Object>} - A new corrected payload
 * @throws {Error} If the rebuild process fails.
 */
async function rebuildPayload(lastPayload, serverError) {
	await this.init();

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
 * @this {ExportedAPI}
 * @returns {Promise<void>}
 */
async function resetChat() {
	if (this.chat) {
		log.debug("Resetting Gemini chat session...");
		this.chat = await this.genAIClient.chats.create({
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


if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	log.info("RUNNING AI Transformer as standalone script...");
	(
		async () => {
			try {
				log.info("Initializing AI Transformer...");
				const transformer = new AITransformer({
					modelName: 'gemini-2.0-flash',
					sourceKey: 'INPUT', // Custom source key
					targetKey: 'OUTPUT', // Custom target key
					contextKey: 'CONTEXT', // Custom context key
					maxRetries: 2,

				});

				const examples = [
					{
						CONTEXT: "Generate professional profiles with emoji representations",
						INPUT: { "name": "Alice" },
						OUTPUT: { "name": "Alice", "profession": "data scientist", "life_as_told_by_emoji": ["🔬", "💡", "📊", "🧠", "🌟"] }
					},
					{
						INPUT: { "name": "Bob" },
						OUTPUT: { "name": "Bob", "profession": "product manager", "life_as_told_by_emoji": ["📋", "🤝", "🚀", "💬", "🎯"] }
					},
					{
						INPUT: { "name": "Eve" },
						OUTPUT: { "name": "Even", "profession": "security analyst", "life_as_told_by_emoji": ["🕵️‍♀️", "🔒", "💻", "👀", "⚡️"] }
					},
				];

				await transformer.init();
				await transformer.seed(examples);
				log.info("AI Transformer initialized and seeded with examples.");

				// Test normal transformation
				const normalResponse = await transformer.message({ "name": "AK" });
				log.info("Normal Payload Transformed", normalResponse);

				// Test transformation with validation
				const mockValidator = async (payload) => {
					// Simulate validation logic
					if (!payload.profession || !payload.life_as_told_by_emoji) {
						throw new Error("Missing required fields: profession or life_as_told_by_emoji");
					}
					if (!Array.isArray(payload.life_as_told_by_emoji)) {
						throw new Error("life_as_told_by_emoji must be an array");
					}
					return payload; // Return the payload if validation passes
				};

				const validatedResponse = await transformer.transformWithValidation(
					{ "name": "Lynn" },
					mockValidator
				);
				log.info("Validated Payload Transformed", validatedResponse);

				if (NODE_ENV === 'dev') debugger;
			} catch (error) {
				log.error("Error in AI Transformer script:", error);
				if (NODE_ENV === 'dev') debugger;
			}
		})();
}