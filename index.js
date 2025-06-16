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
const { NODE_ENV = "unknown", GEMINI_API_KEY, LOG_LEVEL = "" } = process.env;



//deps
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import u from 'ak-tools';
import path from 'path';
import log from './logger.js';
export { log };

if (NODE_ENV === 'dev') log.level = 'debug';
if (NODE_ENV === 'test') log.level = 'warn';
if (NODE_ENV.startsWith('prod')) log.level = 'error';

if (LOG_LEVEL) {
	log.level = LOG_LEVEL;
	log.debug(`Setting log level to ${LOG_LEVEL}`);
}



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
 * @typedef {import('./types').AITransformer} AITransformerUtility
 */



/**
 * main export class for AI Transformer
 * @class AITransformer
 * @type {AITransformerUtility}
 * @description A class that provides methods to initialize, seed, transform, and manage AI-based transformations using Google Gemini API.
 * @implements {ExportedAPI}
 */
class AITransformer {
	/**
	 * @param {AITransformerOptions} [options={}] - Configuration options for the transformer	
	 * 
	 */
	constructor(options = {}) {
		this.modelName = "";
		this.promptKey = "";
		this.answerKey = "";
		this.contextKey = "";
		this.explanationKey = "";
		this.systemInstructionKey = "";
		this.maxRetries = 3;
		this.retryDelay = 1000;
		this.systemInstructions = "";
		this.chatConfig = {};
		this.apiKey = GEMINI_API_KEY;
		this.onlyJSON = true; // always return JSON
		this.asyncValidator = null; // for transformWithValidation
		AITransformFactory.call(this, options);

		//external API
		this.init = initChat.bind(this);
		this.seed = seedWithExamples.bind(this);

		// Internal "raw" message sender
		this.rawMessage = rawMessage.bind(this);

		// The public `.message()` method uses the GLOBAL validator
		this.message = (payload, opts = {}, validatorFn = null) => {

			return prepareAndValidateMessage.call(this, payload, opts, validatorFn || this.asyncValidator);
		};

		this.rebuild = rebuildPayload.bind(this);
		this.reset = resetChat.bind(this);
		this.getHistory = getChatHistory.bind(this);
		this.messageAndValidate = prepareAndValidateMessage.bind(this);
		this.estimate = estimateTokenUsage.bind(this);
	}
}

export default AITransformer;

/**
 * factory function to create an AI Transformer instance
 * @param {AITransformerOptions} [options={}] - Configuration options for the transformer
 * @returns {void} - An instance of AITransformer with initialized properties and methods
 */
function AITransformFactory(options = {}) {
	// ? https://ai.google.dev/gemini-api/docs/models
	this.modelName = options.modelName || 'gemini-2.0-flash';
	this.systemInstructions = options.systemInstructions || DEFAULT_SYSTEM_INSTRUCTIONS;

	this.apiKey = options.apiKey !== undefined && options.apiKey !== null ? options.apiKey : GEMINI_API_KEY;
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
	this.promptKey = options.promptKey || 'PROMPT';
	this.answerKey = options.answerKey || 'ANSWER';
	this.contextKey = options.contextKey || 'CONTEXT'; // Optional key for context
	this.explanationKey = options.explanationKey || 'EXPLANATION'; // Optional key for explanations
	this.systemInstructionsKey = options.systemInstructionsKey || 'SYSTEM'; // Optional key for system instructions

	// Retry configuration
	this.maxRetries = options.maxRetries || 3;
	this.retryDelay = options.retryDelay || 1000;

	//allow async validation function
	this.asyncValidator = options.asyncValidator || null; // Function to validate transformed payloads

	//are we forcing json responses only?
	this.onlyJSON = options.onlyJSON !== undefined ? options.onlyJSON : true; // If true, only return JSON responses

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
 * @param {boolean} [force=false] - If true, forces reinitialization of the chat session.
 * @this {ExportedAPI}
 * @returns {Promise<void>}
 */
async function initChat(force = false) {
	if (this.chat && !force) return;

	log.debug(`Initializing Gemini chat session with model: ${this.modelName}...`);

	this.chat = await this.genAIClient.chats.create({
		model: this.modelName,
		// @ts-ignore
		config: this.chatConfig,
		history: [],
	});

	try {
		await this.genAIClient.models.list();
		log.debug("Gemini API connection successful.");
	} catch (e) {
		throw new Error(`Gemini chat initialization failed: ${e.message}`);
	}



	log.debug("Gemini chat session initialized.");
}

/**
 * Seeds the chat session with example transformations.
 * @this {ExportedAPI}
 * @param {TransformationExample[]} [examples] - An array of transformation examples.
 * @this {ExportedAPI}
 * @returns {Promise<void>}
 */
async function seedWithExamples(examples) {
	await this.init();

	if (!examples || !Array.isArray(examples) || examples.length === 0) {
		if (this.examplesFile) {
			log.debug(`No examples provided, loading from file: ${this.examplesFile}`);
			try {
				examples = await u.load(path.resolve(this.examplesFile), true);
			}
			catch (err) {
				throw new Error(`Could not load examples from file: ${this.examplesFile}. Please check the file path and format.`);
			}
		}

		else if (this.exampleData) {
			log.debug(`Using example data provided in options.`);
			if (Array.isArray(this.exampleData)) {
				examples = this.exampleData;
			} else {
				throw new Error(`Invalid example data provided. Expected an array of examples.`);
			}
		}

		else {
			log.debug("No examples provided and no examples file specified. Skipping seeding.");
			return;
		}
	}

	const instructionExample = examples.find(ex => ex[this.systemInstructionsKey]);
	if (instructionExample) {
		log.debug(`Found system instructions in examples; reinitializing chat with new instructions.`);
		this.systemInstructions = instructionExample[this.systemInstructionsKey];
		this.chatConfig.systemInstruction = this.systemInstructions;
		await this.init(true); // Reinitialize chat with new system instructions
	}

	log.debug(`Seeding chat with ${examples.length} transformation examples...`);
	const historyToAdd = [];

	for (const example of examples) {
		// Use the configurable keys from constructor
		const contextValue = example[this.contextKey] || "";
		const promptValue = example[this.promptKey] || "";
		const answerValue = example[this.answerKey] || "";
		const explanationValue = example[this.explanationKey] || "";
		let userText = "";
		let modelResponse = {};

		// Add context as user message with special formatting to make it part of the example flow
		if (contextValue) {
			let contextText = isJSON(contextValue) ? JSON.stringify(contextValue, null, 2) : contextValue;
			// Prefix context to make it clear it's contextual information
			userText += `CONTEXT:\n${contextText}\n\n`;
		}

		if (promptValue) {
			let promptText = isJSON(promptValue) ? JSON.stringify(promptValue, null, 2) : promptValue;
			userText += promptText;
		}

		if (answerValue) modelResponse.data = answerValue;
		if (explanationValue) modelResponse.explanation = explanationValue;
		const modelText = JSON.stringify(modelResponse, null, 2);

		if (userText.trim().length && modelText.trim().length > 0) {
			historyToAdd.push({ role: 'user', parts: [{ text: userText.trim() }] });
			historyToAdd.push({ role: 'model', parts: [{ text: modelText.trim() }] });
		}

	}


	const currentHistory = this?.chat?.getHistory() || [];
	log.debug(`Adding ${historyToAdd.length} examples to chat history (${currentHistory.length} current examples)...`);
	this.chat = await this.genAIClient.chats.create({
		model: this.modelName,
		// @ts-ignore
		config: this.chatConfig,
		history: [...currentHistory, ...historyToAdd],
	});


	const newHistory = this.chat.getHistory();
	log.debug(`Created new chat session with ${newHistory.length} examples.`);
	return newHistory;
}

/**
 * Transforms a source JSON payload into a target JSON payload
 * @param {Object} sourcePayload - The source payload (as a JavaScript object).
 * @returns {Promise<Object>} - The transformed target payload (as a JavaScript object).
 * @throws {Error} If the transformation fails or returns invalid JSON.
 */
/**
 * (Internal) Sends a single prompt to the model and parses the response.
 * No validation or retry logic.
 * @this {ExportedAPI}
 * @param {Object|string} sourcePayload - The source payload.
 * @returns {Promise<Object>} - The transformed payload.
 */
async function rawMessage(sourcePayload) {
	if (!this.chat) {
		throw new Error("Chat session not initialized.");
	}

	const actualPayload = typeof sourcePayload === 'string'
		? sourcePayload
		: JSON.stringify(sourcePayload, null, 2);

	try {
		const result = await this.chat.sendMessage({ message: actualPayload });
		const modelResponse = result.text;
		const extractedJSON = extractJSON(modelResponse); // Assuming extractJSON is defined

		// Unwrap the 'data' property if it exists
		if (extractedJSON?.data) {
			return extractedJSON.data;
		}
		return extractedJSON;

	} catch (error) {
		if (this.onlyJSON && error.message.includes("Could not extract valid JSON")) {
			throw new Error(`Invalid JSON response from Gemini: ${error.message}`);
		}
		// For other API errors, just re-throw
		throw new Error(`Transformation failed: ${error.message}`);
	}
}

/**
 * (Engine) Transforms a payload with validation and automatic retry logic.
 * @this {ExportedAPI}
 * @param {Object} sourcePayload - The source payload to transform.
 * @param {Object} [options] - Options for the validation process.
 * @param {AsyncValidatorFunction | null} validatorFn - The specific validator to use for this run.
 * @returns {Promise<Object>} - The validated transformed payload.
 */
async function prepareAndValidateMessage(sourcePayload, options = {}, validatorFn = null) {
	if (!this.chat) {
		throw new Error("Chat session not initialized. Please call init() first.");
	}
	const maxRetries = options.maxRetries ?? this.maxRetries;
	const retryDelay = options.retryDelay ?? this.retryDelay;

	let lastError = null;
	let lastPayload = null; // Store the payload that caused the validation error

	// Prepare the payload
	if (sourcePayload && isJSON(sourcePayload)) {
		lastPayload = JSON.stringify(sourcePayload, null, 2);
	} else if (typeof sourcePayload === 'string') {
		lastPayload = sourcePayload;
	}
	else if (typeof sourcePayload === 'boolean' || typeof sourcePayload === 'number') {
		lastPayload = sourcePayload.toString();
	}
	else if (sourcePayload === null || sourcePayload === undefined) {
		lastPayload = JSON.stringify({}); // Convert null/undefined to empty object
	}
	else {
		throw new Error("Invalid source payload. Must be a JSON object or string.");
	}

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			// Step 1: Get the transformed payload
			const transformedPayload = (attempt === 0)
				? await this.rawMessage(lastPayload) // Use the new raw method
				: await this.rebuild(lastPayload, lastError.message);

			lastPayload = transformedPayload; // Always update lastPayload *before* validation

			// Step 2: Validate if a validator is provided
			if (validatorFn) {
				await validatorFn(transformedPayload); // Validator throws on failure
			}

			// Step 3: Success!
			log.debug(`Transformation succeeded on attempt ${attempt + 1}`);
			return transformedPayload;

		} catch (error) {
			lastError = error;
			log.warn(`Attempt ${attempt + 1} failed: ${error.message}`);

			if (attempt >= maxRetries) {
				log.error(`All ${maxRetries + 1} attempts failed.`);
				throw new Error(`Transformation failed after ${maxRetries + 1} attempts. Last error: ${error.message}`);
			}

			// Wait before retrying
			const delay = retryDelay * Math.pow(2, attempt);
			await new Promise(res => setTimeout(res, delay));
		}
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
	await this.init(); // Ensure chat is initialized
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
 * Estimate total token usage if you were to send a new payload as the next message.
 * Considers system instructions, current chat history (including examples), and the new message.
 * @param {object|string} nextPayload - The next user message to be sent (object or string)
 * @returns {Promise<{ totalTokens: number }>} - The result of Gemini's countTokens API
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


/*
----
HELPERS
----
*/

function isJSON(data) {
	try {
		const attempt = JSON.stringify(data);
		if (attempt?.startsWith('{') || attempt?.startsWith('[')) {
			if (attempt?.endsWith('}') || attempt?.endsWith(']')) {
				return true;
			}
		}
		return false;
	} catch (e) {
		return false;
	}
}

function isJSONStr(string) {
	if (typeof string !== 'string') return false;
	try {
		const result = JSON.parse(string);
		const type = Object.prototype.toString.call(result);
		return type === '[object Object]' || type === '[object Array]';
	} catch (err) {
		return false;
	}
}

function extractJSON(text) {
	if (!text || typeof text !== 'string') {
		throw new Error('No text provided for JSON extraction');
	}

	// Strategy 1: Try parsing the entire response as JSON
	if (isJSONStr(text.trim())) {
		return JSON.parse(text.trim());
	}

	// Strategy 2: Look for JSON code blocks (```json...``` or ```...```)
	const codeBlockPatterns = [
		/```json\s*\n?([\s\S]*?)\n?\s*```/gi,
		/```\s*\n?([\s\S]*?)\n?\s*```/gi
	];

	for (const pattern of codeBlockPatterns) {
		const matches = text.match(pattern);
		if (matches) {
			for (const match of matches) {
				const jsonContent = match.replace(/```json\s*\n?/gi, '').replace(/```\s*\n?/gi, '').trim();
				if (isJSONStr(jsonContent)) {
					return JSON.parse(jsonContent);
				}
			}
		}
	}

	// Strategy 3: Look for JSON objects/arrays using bracket matching
	const jsonPatterns = [
		// Match complete JSON objects
		/\{[\s\S]*\}/g,
		// Match complete JSON arrays
		/\[[\s\S]*\]/g
	];

	for (const pattern of jsonPatterns) {
		const matches = text.match(pattern);
		if (matches) {
			for (const match of matches) {
				const candidate = match.trim();
				if (isJSONStr(candidate)) {
					return JSON.parse(candidate);
				}
			}
		}
	}

	// Strategy 4: Advanced bracket matching for nested structures
	const advancedExtract = findCompleteJSONStructures(text);
	if (advancedExtract.length > 0) {
		// Return the first valid JSON structure found
		for (const candidate of advancedExtract) {
			if (isJSONStr(candidate)) {
				return JSON.parse(candidate);
			}
		}
	}

	// Strategy 5: Clean up common formatting issues and retry
	const cleanedText = text
		.replace(/^\s*Sure,?\s*here\s+is\s+your?\s+.*?[:\n]/gi, '') // Remove conversational intros
		.replace(/^\s*Here\s+is\s+the\s+.*?[:\n]/gi, '')
		.replace(/^\s*The\s+.*?is\s*[:\n]/gi, '')
		.replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* comments */
		.replace(/\/\/.*$/gm, '') // Remove // comments
		.trim();

	if (isJSONStr(cleanedText)) {
		return JSON.parse(cleanedText);
	}

	// If all else fails, throw an error with helpful information
	throw new Error(`Could not extract valid JSON from model response. Response preview: ${text.substring(0, 200)}...`);
}

function findCompleteJSONStructures(text) {
	const results = [];
	const startChars = ['{', '['];

	for (let i = 0; i < text.length; i++) {
		if (startChars.includes(text[i])) {
			const extracted = extractCompleteStructure(text, i);
			if (extracted) {
				results.push(extracted);
			}
		}
	}

	return results;
}


function extractCompleteStructure(text, startPos) {
	const startChar = text[startPos];
	const endChar = startChar === '{' ? '}' : ']';
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = startPos; i < text.length; i++) {
		const char = text[i];

		if (escaped) {
			escaped = false;
			continue;
		}

		if (char === '\\' && inString) {
			escaped = true;
			continue;
		}

		if (char === '"' && !escaped) {
			inString = !inString;
			continue;
		}

		if (!inString) {
			if (char === startChar) {
				depth++;
			} else if (char === endChar) {
				depth--;
				if (depth === 0) {
					return text.substring(startPos, i + 1);
				}
			}
		}
	}

	return null; // Incomplete structure
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

				const validatedResponse = await transformer.messageAndValidate(
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