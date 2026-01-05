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
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, ThinkingLevel } from '@google/genai';
import u from 'ak-tools';
import path from 'path';
import log from './logger.js';
export { log };
export { ThinkingLevel, HarmCategory, HarmBlockThreshold };



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

const DEFAULT_THINKING_CONFIG = {
	thinkingBudget: 0,
	thinkingLevel: ThinkingLevel.MINIMAL
};

const DEFAULT_MAX_OUTPUT_TOKENS = 50_000; // Default ceiling for output tokens

// Models that support thinking features (as of Dec 2024)
// Using regex patterns for more precise matching
const THINKING_SUPPORTED_MODELS = [
	/^gemini-3-flash(-preview)?$/,
	/^gemini-3-pro(-preview|-image-preview)?$/,
	/^gemini-2\.5-pro/,
	/^gemini-2\.5-flash(-preview)?$/,
	/^gemini-2\.5-flash-lite(-preview)?$/,
	/^gemini-2\.0-flash$/ // Experimental support, exact match only
];

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
		// this.systemInstructions = "";
		this.chatConfig = {};
		this.apiKey = GEMINI_API_KEY;
		this.onlyJSON = true; // always return JSON
		this.asyncValidator = null; // for transformWithValidation
		this.logLevel = 'info'; // default log level
		this.lastResponseMetadata = null; // stores metadata from last API response
		this.exampleCount = 0; // tracks number of example history items from seed()
		// Cumulative usage tracking across retry attempts
		this._cumulativeUsage = {
			promptTokens: 0,
			responseTokens: 0,
			totalTokens: 0,
			attempts: 0
		};
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
		this.transformWithValidation = prepareAndValidateMessage.bind(this);
		this.estimate = estimateInputTokens.bind(this);
		this.updateSystemInstructions = updateSystemInstructions.bind(this);
		this.estimateCost = estimateCost.bind(this);
		this.clearConversation = clearConversation.bind(this);
		this.getLastUsage = getLastUsage.bind(this);
	}
}

export default AITransformer;
export { attemptJSONRecovery }; // Export for testing

/**
 * factory function to create an AI Transformer instance
 * @param {AITransformerOptions} [options={}] - Configuration options for the transformer
 * @returns {void} - An instance of AITransformer with initialized properties and methods
 */
function AITransformFactory(options = {}) {
	// ? https://ai.google.dev/gemini-api/docs/models
	this.modelName = options.modelName || 'gemini-2.5-flash';

	// Only use default if systemInstructions was not provided at all
	if (options.systemInstructions === undefined) {
		this.systemInstructions = DEFAULT_SYSTEM_INSTRUCTIONS;
	} else {
		// Use the provided value (could be null, false, or a custom string)
		this.systemInstructions = options.systemInstructions;
	}

	// Configure log level - priority: options.logLevel > LOG_LEVEL env > NODE_ENV based defaults > 'info'
	if (options.logLevel) {
		this.logLevel = options.logLevel;
		if (this.logLevel === 'none') {
			// Set to silent to disable all logging
			log.level = 'silent';
		} else {
			// Set the log level as specified
			log.level = this.logLevel;
		}
	} else if (LOG_LEVEL) {
		// Use environment variable if no option specified
		this.logLevel = LOG_LEVEL;
		log.level = LOG_LEVEL;
	} else if (NODE_ENV === 'dev') {
		this.logLevel = 'debug';
		log.level = 'debug';
	} else if (NODE_ENV === 'test') {
		this.logLevel = 'warn';
		log.level = 'warn';
	} else if (NODE_ENV.startsWith('prod')) {
		this.logLevel = 'error';
		log.level = 'error';
	} else {
		// Default to info
		this.logLevel = 'info';
		log.level = 'info';
	}

	// Vertex AI configuration
	this.vertexai = options.vertexai || false;
	this.project = options.project || process.env.GOOGLE_CLOUD_PROJECT || null;
	this.location = options.location || process.env.GOOGLE_CLOUD_LOCATION || undefined;
	this.googleAuthOptions = options.googleAuthOptions || null;

	// API Key (for Gemini API, not Vertex AI)
	this.apiKey = options.apiKey !== undefined && options.apiKey !== null ? options.apiKey : GEMINI_API_KEY;

	// Validate authentication - need either API key (for Gemini API) or Vertex AI config
	if (!this.vertexai && !this.apiKey) {
		throw new Error("Missing Gemini API key. Provide via options.apiKey or GEMINI_API_KEY env var. For Vertex AI, set vertexai: true with project and location.");
	}
	if (this.vertexai && !this.project) {
		throw new Error("Vertex AI requires a project ID. Provide via options.project or GOOGLE_CLOUD_PROJECT env var.");
	}

	// Build chat config, making sure systemInstruction uses the custom instructions
	this.chatConfig = {
		...DEFAULT_CHAT_CONFIG,
		...options.chatConfig		
	};

	// Handle systemInstructions: use custom if provided, otherwise keep default from DEFAULT_CHAT_CONFIG
	// If explicitly set to null/false, remove it entirely
	if (this.systemInstructions) {
		this.chatConfig.systemInstruction = this.systemInstructions;
	} else if (options.systemInstructions !== undefined) {
		// Explicitly set to null/false/empty - remove system instruction
		delete this.chatConfig.systemInstruction;
	}

	// Handle maxOutputTokens with explicit null check
	// Priority: options.maxOutputTokens > options.chatConfig.maxOutputTokens > DEFAULT
	// Setting to null explicitly removes the limit
	if (options.maxOutputTokens !== undefined) {
		if (options.maxOutputTokens === null) {
			delete this.chatConfig.maxOutputTokens;
		} else {
			this.chatConfig.maxOutputTokens = options.maxOutputTokens;
		}
	} else if (options.chatConfig?.maxOutputTokens !== undefined) {
		if (options.chatConfig.maxOutputTokens === null) {
			delete this.chatConfig.maxOutputTokens;
		} else {
			this.chatConfig.maxOutputTokens = options.chatConfig.maxOutputTokens;
		}
	} else {
		this.chatConfig.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
	}

	// Only add thinkingConfig if the model supports it
	const modelSupportsThinking = THINKING_SUPPORTED_MODELS.some(pattern =>
		pattern.test(this.modelName)
	);

	// Handle thinkingConfig - null explicitly removes it, undefined means not specified
	if (options.thinkingConfig !== undefined) {
		if (options.thinkingConfig === null) {
			// Explicitly remove thinkingConfig if set to null
			delete this.chatConfig.thinkingConfig;
			if (log.level !== 'silent') {
				log.debug(`thinkingConfig set to null - removed from configuration`);
			}
		} else if (modelSupportsThinking) {
			// Handle thinkingConfig - merge with defaults
			const thinkingConfig = {
				...DEFAULT_THINKING_CONFIG,
				...options.thinkingConfig
			};
			this.chatConfig.thinkingConfig = thinkingConfig;

			if (log.level !== 'silent') {
				log.debug(`Model ${this.modelName} supports thinking. Applied thinkingConfig:`, thinkingConfig);
			}
		} else {
			if (log.level !== 'silent') {
				log.warn(`Model ${this.modelName} does not support thinking features. Ignoring thinkingConfig.`);
			}
		}
	}

	// response schema is optional, but if provided, it should be a valid JSON schema
	if (options.responseSchema) {
		this.chatConfig.responseSchema = options.responseSchema;
	}

	// examples file is optional, but if provided, it should contain valid PROMPT and ANSWER keys
	this.examplesFile = options.examplesFile || null;
	this.exampleData = options.exampleData || null; // can be used instead of examplesFile

	// Use configurable keys with fallbacks
	this.promptKey = options.promptKey || options.sourceKey || 'PROMPT';
	this.answerKey = options.answerKey || options.targetKey || 'ANSWER';
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

	// Grounding configuration (disabled by default to avoid costs)
	this.enableGrounding = options.enableGrounding || false;
	this.groundingConfig = options.groundingConfig || {};

	// Billing labels for cost segmentation (Vertex AI only)
	this.labels = options.labels || {};
	if (Object.keys(this.labels).length > 0 && log.level !== 'silent') {
		if (!this.vertexai) {
			log.warn(`Billing labels are only supported with Vertex AI. Labels will be ignored.`);
		} else {
			log.debug(`Billing labels configured: ${JSON.stringify(this.labels)}`);
		}
	}

	if (this.promptKey === this.answerKey) {
		throw new Error("Source and target keys cannot be the same. Please provide distinct keys.");
	}

	if (log.level !== 'silent') {
		log.debug(`Creating AI Transformer with model: ${this.modelName}`);
		log.debug(`Using keys - Source: "${this.promptKey}", Target: "${this.answerKey}", Context: "${this.contextKey}"`);
		log.debug(`Max output tokens set to: ${this.chatConfig.maxOutputTokens}`);
		// Log authentication method
		if (this.vertexai) {
			log.debug(`Using Vertex AI - Project: ${this.project}, Location: ${this.location || 'global (default)'}`);
			if (this.googleAuthOptions?.keyFilename) {
				log.debug(`Auth: Service account key file: ${this.googleAuthOptions.keyFilename}`);
			} else if (this.googleAuthOptions?.credentials) {
				log.debug(`Auth: Inline credentials provided`);
			} else {
				log.debug(`Auth: Application Default Credentials (ADC)`);
			}
		} else {
			log.debug(`Using Gemini API with key: ${this.apiKey.substring(0, 10)}...`);
		}
		log.debug(`Grounding ${this.enableGrounding ? 'ENABLED' : 'DISABLED'} (costs $35/1k queries)`);
	}

	// Initialize Google GenAI client with appropriate configuration
	const clientOptions = this.vertexai
		? {
			vertexai: true,
			project: this.project,
			...(this.location && { location: this.location }),
			...(this.googleAuthOptions && { googleAuthOptions: this.googleAuthOptions })
		}
		: { apiKey: this.apiKey };

	const ai = new GoogleGenAI(clientOptions);
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

	// Add grounding tools if enabled
	const chatOptions = {
		model: this.modelName,
		// @ts-ignore
		config: {
			...this.chatConfig,
			...(this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels })
		},
		history: [],
	};

	// Only add tools if grounding is explicitly enabled
	if (this.enableGrounding) {
		chatOptions.config.tools = [{
			googleSearch: this.groundingConfig
		}];
		log.debug(`Search grounding ENABLED for this session (WARNING: costs $35/1k queries)`);
	}

	this.chat = await this.genAIClient.chats.create(chatOptions);

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
				// @ts-ignore
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
		config: {
			...this.chatConfig,
			...(this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels })
		},
		history: [...currentHistory, ...historyToAdd],
	});

	// Track example count for clearConversation() and stateless messages
	this.exampleCount = currentHistory.length + historyToAdd.length;

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
 * @param {Object} [messageOptions] - Optional per-message options (e.g., labels).
 * @returns {Promise<Object>} - The transformed payload.
 */
async function rawMessage(sourcePayload, messageOptions = {}) {
	if (!this.chat) {
		throw new Error("Chat session not initialized.");
	}

	const actualPayload = typeof sourcePayload === 'string'
		? sourcePayload
		: JSON.stringify(sourcePayload, null, 2);

	// Merge instance labels with per-message labels (per-message takes precedence)
	// Labels only supported with Vertex AI
	const mergedLabels = { ...this.labels, ...(messageOptions.labels || {}) };
	const hasLabels = this.vertexai && Object.keys(mergedLabels).length > 0;

	try {
		const sendParams = { message: actualPayload };

		// Add config with labels if we have any (Vertex AI only)
		if (hasLabels) {
			sendParams.config = { labels: mergedLabels };
		}

		const result = await this.chat.sendMessage(sendParams);

		// Capture and log response metadata for model verification and debugging
		this.lastResponseMetadata = {
			modelVersion: result.modelVersion || null,
			requestedModel: this.modelName,
			promptTokens: result.usageMetadata?.promptTokenCount || 0,
			responseTokens: result.usageMetadata?.candidatesTokenCount || 0,
			totalTokens: result.usageMetadata?.totalTokenCount || 0,
			timestamp: Date.now()
		};

		if (result.usageMetadata && log.level !== 'silent') {
			log.debug(`API response metadata:`, {
				modelVersion: result.modelVersion || 'not-provided',
				requestedModel: this.modelName,
				promptTokens: result.usageMetadata.promptTokenCount,
				responseTokens: result.usageMetadata.candidatesTokenCount,
				totalTokens: result.usageMetadata.totalTokenCount
			});
		}

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

	// Handle stateless messages separately - they don't add to chat history
	if (options.stateless) {
		return await statelessMessage.call(this, sourcePayload, options, validatorFn);
	}

	const maxRetries = options.maxRetries ?? this.maxRetries;
	const retryDelay = options.retryDelay ?? this.retryDelay;

	// Check if grounding should be enabled for this specific message
	const enableGroundingForMessage = options.enableGrounding ?? this.enableGrounding;
	const groundingConfigForMessage = options.groundingConfig ?? this.groundingConfig;

	// Reinitialize chat if grounding settings changed for this message
	if (enableGroundingForMessage !== this.enableGrounding) {
		const originalGrounding = this.enableGrounding;
		const originalConfig = this.groundingConfig;

		try {
			// Temporarily change grounding settings
			this.enableGrounding = enableGroundingForMessage;
			this.groundingConfig = groundingConfigForMessage;

			// Force reinit with new settings
			await this.init(true);

			// Log the change
			if (enableGroundingForMessage) {
				log.warn(`Search grounding ENABLED for this message (WARNING: costs $35/1k queries)`);
			} else {
				log.debug(`Search grounding DISABLED for this message`);
			}
		} catch (error) {
			// Restore original settings on error
			this.enableGrounding = originalGrounding;
			this.groundingConfig = originalConfig;
			throw error;
		}

		// Schedule restoration after message completes
		const restoreGrounding = async () => {
			this.enableGrounding = originalGrounding;
			this.groundingConfig = originalConfig;
			await this.init(true);
		};

		// Store restoration function to call after message completes
		options._restoreGrounding = restoreGrounding;
	}

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

	// Extract per-message labels for passing to rawMessage
	const messageOptions = {};
	if (options.labels) {
		messageOptions.labels = options.labels;
	}

	// Reset cumulative usage tracking for this message call
	this._cumulativeUsage = {
		promptTokens: 0,
		responseTokens: 0,
		totalTokens: 0,
		attempts: 0
	};

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			// Step 1: Get the transformed payload
			const transformedPayload = (attempt === 0)
				? await this.rawMessage(lastPayload, messageOptions) // Use the new raw method with per-message options
				: await this.rebuild(lastPayload, lastError.message);

			// Accumulate token usage from this attempt
			if (this.lastResponseMetadata) {
				this._cumulativeUsage.promptTokens += this.lastResponseMetadata.promptTokens || 0;
				this._cumulativeUsage.responseTokens += this.lastResponseMetadata.responseTokens || 0;
				this._cumulativeUsage.totalTokens += this.lastResponseMetadata.totalTokens || 0;
				this._cumulativeUsage.attempts = attempt + 1;
			}

			lastPayload = transformedPayload; // Always update lastPayload *before* validation

			// Step 2: Validate if a validator is provided
			if (validatorFn) {
				await validatorFn(transformedPayload); // Validator throws on failure
			}

			// Step 3: Success!
			log.debug(`Transformation succeeded on attempt ${attempt + 1}`);

			// Restore original grounding settings if they were changed
			if (options._restoreGrounding) {
				await options._restoreGrounding();
			}

			return transformedPayload;

		} catch (error) {
			lastError = error;
			log.warn(`Attempt ${attempt + 1} failed: ${error.message}`);

			if (attempt >= maxRetries) {
				log.error(`All ${maxRetries + 1} attempts failed.`)
;
				// Restore original grounding settings even on failure
				if (options._restoreGrounding) {
					await options._restoreGrounding();
				}

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
 * @this {ExportedAPI}
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

		// Capture and log response metadata for rebuild calls too
		this.lastResponseMetadata = {
			modelVersion: result.modelVersion || null,
			requestedModel: this.modelName,
			promptTokens: result.usageMetadata?.promptTokenCount || 0,
			responseTokens: result.usageMetadata?.candidatesTokenCount || 0,
			totalTokens: result.usageMetadata?.totalTokenCount || 0,
			timestamp: Date.now()
		};

		if (result.usageMetadata && log.level !== 'silent') {
			log.debug(`Rebuild response metadata - tokens used:`, result.usageMetadata.totalTokenCount);
		}
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
 * Estimate INPUT tokens only for a payload before sending.
 * This estimates the tokens that will be consumed by your prompt (input), NOT the response (output).
 * Includes: system instructions + chat history (seeded examples) + your new message.
 * Use this to preview input token costs and avoid exceeding context window limits.
 *
 * NOTE: Output tokens cannot be predicted before the API call. Use getLastUsage() after
 * calling message() to see actual input + output token consumption.
 *
 * @this {ExportedAPI}
 * @param {object|string} nextPayload - The next user message to be sent (object or string)
 * @returns {Promise<{ inputTokens: number }>} - Estimated input token count
 */
async function estimateInputTokens(nextPayload) {
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

	// Return with clear naming - this is INPUT tokens only
	return { inputTokens: resp.totalTokens };
}

// Model pricing per million tokens (as of Dec 2025)
// https://ai.google.dev/gemini-api/docs/pricing
const MODEL_PRICING = {
	'gemini-2.5-flash': { input: 0.15, output: 0.60 },
	'gemini-2.5-flash-lite': { input: 0.02, output: 0.10 },
	'gemini-2.5-pro': { input: 2.50, output: 10.00 },
	'gemini-3-pro': { input: 2.00, output: 12.00 },
	'gemini-3-pro-preview': { input: 2.00, output: 12.00 },
	'gemini-2.0-flash': { input: 0.10, output: 0.40 },
	'gemini-2.0-flash-lite': { input: 0.02, output: 0.10 }
};

/**
 * Estimates the cost of sending a payload based on input token count and model pricing.
 * NOTE: This only estimates INPUT cost. Output cost depends on response length and cannot be predicted.
 * @this {ExportedAPI}
 * @param {object|string} nextPayload - The next user message to be sent (object or string)
 * @returns {Promise<Object>} - Cost estimation including input tokens, model, pricing, and estimated input cost
 */
async function estimateCost(nextPayload) {
	const tokenInfo = await this.estimate(nextPayload);
	const pricing = MODEL_PRICING[this.modelName] || { input: 0, output: 0 };

	return {
		inputTokens: tokenInfo.inputTokens,
		model: this.modelName,
		pricing: pricing,
		estimatedInputCost: (tokenInfo.inputTokens / 1_000_000) * pricing.input,
		note: 'Cost is for input tokens only; output cost depends on response length'
	};
}


/**
 * Resets the current chat session, clearing all history and examples
 * @this {ExportedAPI}
 * @returns {Promise<void>}
 */
async function resetChat() {
	if (this.chat) {
		log.debug("Resetting Gemini chat session...");

		// Prepare chat options with grounding if enabled
		const chatOptions = {
			model: this.modelName,
			// @ts-ignore
			config: {
				...this.chatConfig,
				...(this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels })
			},
			history: [],
		};

		// Only add tools if grounding is explicitly enabled
		if (this.enableGrounding) {
			chatOptions.config.tools = [{
				googleSearch: this.groundingConfig
			}];
			log.debug(`Search grounding preserved during reset (WARNING: costs $35/1k queries)`);
		}

		this.chat = await this.genAIClient.chats.create(chatOptions);
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
 * Updates system instructions and reinitializes the chat session
 * @this {ExportedAPI}
 * @param {string} newInstructions - The new system instructions
 * @returns {Promise<void>}
 */
async function updateSystemInstructions(newInstructions) {
	if (!newInstructions || typeof newInstructions !== 'string') {
		throw new Error('System instructions must be a non-empty string');
	}

	this.systemInstructions = newInstructions.trim();
	this.chatConfig.systemInstruction = this.systemInstructions;

	log.debug('Updating system instructions and reinitializing chat...');
	await this.init(true); // Force reinitialize with new instructions
}

/**
 * Clears conversation history while preserving seeded examples.
 * Useful for starting a fresh conversation within the same session
 * without losing the few-shot learning examples.
 * @this {ExportedAPI}
 * @returns {Promise<void>}
 */
async function clearConversation() {
	if (!this.chat) {
		log.warn("Cannot clear conversation: chat not initialized.");
		return;
	}

	const history = this.chat.getHistory();
	const exampleHistory = history.slice(0, this.exampleCount || 0);

	this.chat = await this.genAIClient.chats.create({
		model: this.modelName,
		// @ts-ignore
		config: {
			...this.chatConfig,
			...(this.vertexai && Object.keys(this.labels).length > 0 && { labels: this.labels })
		},
		history: exampleHistory,
	});

	// Reset usage tracking for the new conversation
	this.lastResponseMetadata = null;
	this._cumulativeUsage = {
		promptTokens: 0,
		responseTokens: 0,
		totalTokens: 0,
		attempts: 0
	};

	log.debug(`Conversation cleared. Preserved ${exampleHistory.length} example items.`);
}

/**
 * Returns structured usage data from the last message call for billing verification.
 * Includes CUMULATIVE token counts across all retry attempts.
 * Call this after message() or statelessMessage() to get actual token consumption.
 *
 * @this {ExportedAPI}
 * @returns {Object|null} Usage data with promptTokens, responseTokens, totalTokens, attempts, etc.
 *                        Returns null if no API call has been made yet.
 */
function getLastUsage() {
	if (!this.lastResponseMetadata) {
		return null;
	}

	const meta = this.lastResponseMetadata;
	const cumulative = this._cumulativeUsage || { promptTokens: 0, responseTokens: 0, totalTokens: 0, attempts: 1 };

	// Use cumulative tokens if tracking was active (attempts > 0), otherwise fall back to last response
	const useCumulative = cumulative.attempts > 0;

	return {
		// Token breakdown for billing - CUMULATIVE across all retry attempts
		promptTokens: useCumulative ? cumulative.promptTokens : meta.promptTokens,
		responseTokens: useCumulative ? cumulative.responseTokens : meta.responseTokens,
		totalTokens: useCumulative ? cumulative.totalTokens : meta.totalTokens,

		// Number of attempts (1 = success on first try, 2+ = retries were needed)
		attempts: useCumulative ? cumulative.attempts : 1,

		// Model verification for billing cross-check
		modelVersion: meta.modelVersion,      // Actual model that responded (e.g., 'gemini-2.5-flash-001')
		requestedModel: meta.requestedModel,  // Model you requested (e.g., 'gemini-2.5-flash')

		// Timestamp for audit trail
		timestamp: meta.timestamp
	};
}

/**
 * Sends a one-off message using generateContent (not chat).
 * Does NOT affect chat history - useful for isolated requests.
 * @this {ExportedAPI}
 * @param {Object|string} sourcePayload - The source payload.
 * @param {Object} [options] - Options including labels.
 * @param {AsyncValidatorFunction|null} [validatorFn] - Optional validator.
 * @returns {Promise<Object>} - The transformed payload.
 */
async function statelessMessage(sourcePayload, options = {}, validatorFn = null) {
	if (!this.chat) {
		throw new Error("Chat session not initialized. Please call init() first.");
	}

	const payloadStr = typeof sourcePayload === 'string'
		? sourcePayload
		: JSON.stringify(sourcePayload, null, 2);

	// Build contents including examples from current chat history
	const contents = [];

	// Include seeded examples if we have them
	if (this.exampleCount > 0) {
		const history = this.chat.getHistory();
		const exampleHistory = history.slice(0, this.exampleCount);
		contents.push(...exampleHistory);
	}

	// Add the user message
	contents.push({ role: 'user', parts: [{ text: payloadStr }] });

	// Merge labels (Vertex AI only)
	const mergedLabels = { ...this.labels, ...(options.labels || {}) };

	// Use generateContent instead of chat.sendMessage
	const result = await this.genAIClient.models.generateContent({
		model: this.modelName,
		contents: contents,
		config: {
			...this.chatConfig,
			...(this.vertexai && Object.keys(mergedLabels).length > 0 && { labels: mergedLabels })
		}
	});

	// Capture and log response metadata
	this.lastResponseMetadata = {
		modelVersion: result.modelVersion || null,
		requestedModel: this.modelName,
		promptTokens: result.usageMetadata?.promptTokenCount || 0,
		responseTokens: result.usageMetadata?.candidatesTokenCount || 0,
		totalTokens: result.usageMetadata?.totalTokenCount || 0,
		timestamp: Date.now()
	};

	// Set cumulative usage for stateless message (single attempt, no retries)
	this._cumulativeUsage = {
		promptTokens: this.lastResponseMetadata.promptTokens,
		responseTokens: this.lastResponseMetadata.responseTokens,
		totalTokens: this.lastResponseMetadata.totalTokens,
		attempts: 1
	};

	if (result.usageMetadata && log.level !== 'silent') {
		log.debug(`Stateless message metadata:`, {
			modelVersion: result.modelVersion || 'not-provided',
			promptTokens: result.usageMetadata.promptTokenCount,
			responseTokens: result.usageMetadata.candidatesTokenCount
		});
	}

	const modelResponse = result.text;
	const extractedJSON = extractJSON(modelResponse);

	let transformedPayload = extractedJSON?.data ? extractedJSON.data : extractedJSON;

	// Validate if a validator is provided
	if (validatorFn) {
		await validatorFn(transformedPayload);
	}

	return transformedPayload;
}


/*
----
HELPERS
----
*/

/**
 * Attempts to recover truncated JSON by progressively removing characters from the end
 * until valid JSON is found or recovery fails
 * @param {string} text - The potentially truncated JSON string
 * @param {number} maxAttempts - Maximum number of characters to remove
 * @returns {Object|null} - Parsed JSON object or null if recovery fails
 */
function attemptJSONRecovery(text, maxAttempts = 100) {
	if (!text || typeof text !== 'string') return null;

	// First, try parsing as-is
	try {
		return JSON.parse(text);
	} catch (e) {
		// Continue with recovery
	}

	let workingText = text.trim();

	// First attempt: try to close unclosed structures without removing characters
	// Count open/close braces and brackets in the original text
	let braces = 0;
	let brackets = 0;
	let inString = false;
	let escapeNext = false;

	for (let j = 0; j < workingText.length; j++) {
		const char = workingText[j];

		if (escapeNext) {
			escapeNext = false;
			continue;
		}

		if (char === '\\') {
			escapeNext = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (!inString) {
			if (char === '{') braces++;
			else if (char === '}') braces--;
			else if (char === '[') brackets++;
			else if (char === ']') brackets--;
		}
	}

	// Try to fix by just adding closing characters
	if ((braces > 0 || brackets > 0 || inString) && workingText.length > 2) {
		let fixedText = workingText;

		// Close any open strings first
		if (inString) {
			fixedText += '"';
		}

		// Add missing closing characters
		while (braces > 0) {
			fixedText += '}';
			braces--;
		}
		while (brackets > 0) {
			fixedText += ']';
			brackets--;
		}

		try {
			const result = JSON.parse(fixedText);
			if (log.level !== 'silent') {
				log.warn(`JSON response appears truncated (possibly hit maxOutputTokens limit). Recovered by adding closing characters.`);
			}
			return result;
		} catch (e) {
			// Simple fix didn't work, continue with more aggressive recovery
		}
	}

	// Second attempt: progressively remove characters from the end

	for (let i = 0; i < maxAttempts && workingText.length > 2; i++) {
		// Remove one character from the end
		workingText = workingText.slice(0, -1);

		// Count open/close braces and brackets
		let braces = 0;
		let brackets = 0;
		let inString = false;
		let escapeNext = false;

		for (let j = 0; j < workingText.length; j++) {
			const char = workingText[j];

			if (escapeNext) {
				escapeNext = false;
				continue;
			}

			if (char === '\\') {
				escapeNext = true;
				continue;
			}

			if (char === '"') {
				inString = !inString;
				continue;
			}

			if (!inString) {
				if (char === '{') braces++;
				else if (char === '}') braces--;
				else if (char === '[') brackets++;
				else if (char === ']') brackets--;
			}
		}

		// If we have balanced braces/brackets, try parsing
		if (braces === 0 && brackets === 0 && !inString) {
			try {
				const result = JSON.parse(workingText);
				if (log.level !== 'silent') {
					log.warn(`JSON response appears truncated (possibly hit maxOutputTokens limit). Recovered by removing ${i + 1} characters from the end.`);
				}
				return result;
			} catch (e) {
				// Continue trying
			}
		}

		// After a few attempts, try adding closing characters
		if (i > 5) {
			let fixedText = workingText;

			// Close any open strings first
			if (inString) {
				fixedText += '"';
			}

			// Add missing closing characters
			while (braces > 0) {
				fixedText += '}';
				braces--;
			}
			while (brackets > 0) {
				fixedText += ']';
				brackets--;
			}

			try {
				const result = JSON.parse(fixedText);
				if (log.level !== 'silent') {
					log.warn(`JSON response appears truncated (possibly hit maxOutputTokens limit). Recovered by adding closing characters.`);
				}
				return result;
			} catch (e) {
				// Recovery failed, continue trying
			}
		}
	}

	return null;
}

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

	// Strategy 6: Last resort - attempt recovery for potentially truncated JSON
	// This is especially useful when maxOutputTokens might have cut off the response
	const recoveredJSON = attemptJSONRecovery(text);
	if (recoveredJSON !== null) {
		return recoveredJSON;
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
					modelName: 'gemini-2.5-flash',
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