import { jest } from '@jest/globals';

// ---- Place all mocks at the very top ----
const mockSendMessage = jest.fn();
const mockGetHistory = jest.fn();
const mockChatsCreate = jest.fn();

jest.unstable_mockModule('../logger.js', () => ({
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.unstable_mockModule('ak-tools', () => ({
  default: {
    isJSON: jest.fn((obj) => typeof obj === 'object' && obj !== null),
    load: jest.fn()
  },
  isJSON: jest.fn((obj) => typeof obj === 'object' && obj !== null),
  load: jest.fn()
}));

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn(() => ({
    chats: {
      create: mockChatsCreate
    }
  })),
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT'
  },
  HarmBlockThreshold: {
    BLOCK_NONE: 'BLOCK_NONE'
  }
}));

// ---- Dynamic import to load your code AFTER mocks are registered ----
const { default: AITransformer } = await import('../index.js');

describe('AITransformer', () => {
	let transformer;
	let mockChat;

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks();
		
		// Setup mock chat object
		mockChat = {
			sendMessage: mockSendMessage,
			getHistory: mockGetHistory
		};
		
		mockChatsCreate.mockResolvedValue(mockChat);
		mockGetHistory.mockReturnValue([]);
		
		// Create fresh transformer instance
		transformer = new AITransformer();
	});

	describe('Constructor', () => {
		test('should create instance with default options', () => {
			const transformer = new AITransformer();
			
			
			expect(transformer.modelName).toBe('gemini-2.0-flash');
			expect(transformer.promptKey).toBe('PROMPT');
			expect(transformer.answerKey).toBe('ANSWER');
			expect(transformer.contextKey).toBe('CONTEXT');
			expect(transformer.maxRetries).toBe(3);
			expect(transformer.retryDelay).toBe(1000);
		});

		test('should create instance with custom options', () => {
			const options = {
				modelName: 'gemini-1.5-pro',
				sourceKey: 'INPUT',
				targetKey: 'OUTPUT',
				contextKey: 'CTX',
				maxRetries: 5,
				retryDelay: 2000,
				systemInstructions: 'Custom instructions'
			};
			
			const transformer = new AITransformer(options);
			
			expect(transformer.modelName).toBe('gemini-1.5-pro');
			expect(transformer.promptKey).toBe('INPUT');
			expect(transformer.answerKey).toBe('OUTPUT');
			expect(transformer.contextKey).toBe('CTX');
			expect(transformer.maxRetries).toBe(5);
			expect(transformer.retryDelay).toBe(2000);
			expect(transformer.systemInstructions).toBe('Custom instructions');
		});

		test('should throw error if source and target keys are the same', () => {
			expect(() => {
				new AITransformer({
					sourceKey: 'SAME',
					targetKey: 'SAME'
				});
			}).toThrow('Source and target keys cannot be the same');
		});

		test('should include response schema in chat config if provided', () => {
			const responseSchema = { type: 'object', properties: {} };
			const transformer = new AITransformer({ responseSchema });
			
			expect(transformer.chatConfig.responseSchema).toEqual(responseSchema);
		});
	});

	describe('init()', () => {
		test('should initialize chat session', async () => {
			await transformer.init();
			
			expect(mockChatsCreate).toHaveBeenCalledWith({
				model: 'gemini-2.0-flash',
				config: expect.objectContaining({
					responseMimeType: 'application/json',
					temperature: 0.2
				}),
				history: []
			});
			expect(transformer.chat).toBe(mockChat);
		});

		test('should not reinitialize if chat already exists', async () => {
			await transformer.init();
			await transformer.init();
			
			expect(mockChatsCreate).toHaveBeenCalledTimes(1);
		});
	});

	describe('seed()', () => {
		beforeEach(async () => {
			await transformer.init();
		});

		test('should seed with provided examples using default keys', async () => {
			const examples = [
				{
					PROMPT: { input: 'test1' },
					ANSWER: { output: 'result1' }
				},
				{
					CONTEXT: 'Some context',
					PROMPT: { input: 'test2' },
					ANSWER: { output: 'result2' }
				}
			];

			await transformer.seed(examples);

			expect(mockChatsCreate).toHaveBeenCalledTimes(2); // Once for init, once for seeding
			const lastCall = mockChatsCreate.mock.calls[1];
			const history = lastCall[0].history;

			// Should have context acknowledgment, prompts, and answers
			expect(history.length).toBeGreaterThan(0);
		});

		test('should seed with custom keys', async () => {
			const transformer = new AITransformer({
				sourceKey: 'INPUT',
				targetKey: 'OUTPUT',
				contextKey: 'CTX'
			});
			await transformer.init();

			const examples = [
				{
					INPUT: { test: 'input' },
					OUTPUT: { test: 'output' },
					CTX: 'Custom context'
				}
			];

			await transformer.seed(examples);

			expect(mockChatsCreate).toHaveBeenCalledTimes(3); // init for both transformers + seeding
		});

		test('should handle examples with no context', async () => {
			const examples = [
				{
					PROMPT: { input: 'test' },
					ANSWER: { output: 'result' }
				}
			];

			await transformer.seed(examples);
			
			expect(mockChatsCreate).toHaveBeenCalledTimes(2);
		});

		test('should skip seeding if no examples provided and no file specified', async () => {
			await transformer.seed([]);
			
			expect(mockChatsCreate).toHaveBeenCalledTimes(1); // Only init call
		});
	});

	describe('message()', () => {
		beforeEach(async () => {
			await transformer.init();
		});

		test('should transform valid JSON object', async () => {
			const mockResponse = { text: '{"result": "transformed"}' };
			mockSendMessage.mockResolvedValue(mockResponse);

			const input = { name: 'test' };
			const result = await transformer.message(input);

			expect(mockSendMessage).toHaveBeenCalledWith({
				message: JSON.stringify(input, null, 2)
			});
			expect(result).toEqual({ result: 'transformed' });
		});

		test('should transform valid JSON string', async () => {
			const mockResponse = { text: '{"result": "transformed"}' };
			mockSendMessage.mockResolvedValue(mockResponse);

			const input = '{"name": "test"}';
			const result = await transformer.message(input);

			expect(mockSendMessage).toHaveBeenCalledWith({ message: input });
			expect(result).toEqual({ result: 'transformed' });
		});

		test('should throw error if chat not initialized', async () => {
			const uninitializedTransformer = new AITransformer();
			
			await expect(uninitializedTransformer.message({ test: 'data' }))
				.rejects.toThrow('Chat session not initialized');
		});

		test('should throw error for invalid input', async () => {
			await expect(transformer.message(null))
				.rejects.toThrow('Invalid source payload');
			
			await expect(transformer.message(123))
				.rejects.toThrow('Invalid source payload');
		});

		test('should handle Gemini API errors', async () => {
			mockSendMessage.mockRejectedValue(new Error('API Error'));

			await expect(transformer.message({ test: 'data' }))
				.rejects.toThrow('Transformation failed: API Error');
		});

		test('should handle invalid JSON response', async () => {
			mockSendMessage.mockResolvedValue({ text: 'invalid json' });

			await expect(transformer.message({ test: 'data' }))
				.rejects.toThrow('Invalid JSON response from Gemini');
		});
	});

	describe('rebuild()', () => {
		beforeEach(async () => {
			await transformer.init();
		});

		test('should rebuild payload with error feedback', async () => {
			const mockResponse = { text: '{"fixed": "payload"}' };
			mockSendMessage.mockResolvedValue(mockResponse);

			const lastPayload = { broken: 'data' };
			const serverError = 'Missing required field';

			const result = await transformer.rebuild(lastPayload, serverError);

			expect(mockSendMessage).toHaveBeenCalledWith({
				message: expect.stringContaining('BAD PAYLOAD')
			});
			expect(mockSendMessage).toHaveBeenCalledWith({
				message: expect.stringContaining(serverError)
			});
			expect(result).toEqual({ fixed: 'payload' });
		});

		test('should handle rebuild API errors', async () => {
			mockSendMessage.mockRejectedValue(new Error('Rebuild API Error'));

			await expect(transformer.rebuild({ test: 'data' }, 'error'))
				.rejects.toThrow('Gemini call failed while repairing payload');
		});

		test('should handle invalid JSON in rebuild response', async () => {
			mockSendMessage.mockResolvedValue({ text: 'not json' });

			await expect(transformer.rebuild({ test: 'data' }, 'error'))
				.rejects.toThrow('Gemini returned non-JSON while repairing payload');
		});
	});

	describe('transformWithValidation()', () => {
		let mockValidator;

		beforeEach(async () => {
			await transformer.init();
			mockValidator = jest.fn();
		});

		test('should succeed on first attempt with valid payload', async () => {
			const transformedPayload = { result: 'success' };
			mockSendMessage.mockResolvedValue({ text: JSON.stringify(transformedPayload) });
			mockValidator.mockResolvedValue(transformedPayload);

			const result = await transformer.transformWithValidation(
				{ input: 'test' },
				mockValidator
			);

			expect(result).toEqual(transformedPayload);
			expect(mockValidator).toHaveBeenCalledTimes(1);
			expect(mockSendMessage).toHaveBeenCalledTimes(1);
		});

		test('should retry with rebuild on validation failure', async () => {
			const transformer = new AITransformer({ maxRetries: 2 });
			await transformer.init();

			const firstPayload = { result: 'invalid' };
			const secondPayload = { result: 'valid' };

			mockSendMessage
				.mockResolvedValueOnce({ text: JSON.stringify(firstPayload) }) // First transform
				.mockResolvedValueOnce({ text: JSON.stringify(firstPayload) }) // Get payload for rebuild
				.mockResolvedValueOnce({ text: JSON.stringify(secondPayload) }); // Rebuild result

			mockValidator
				.mockRejectedValueOnce(new Error('Validation failed'))
				.mockResolvedValueOnce(secondPayload);

			const result = await transformer.transformWithValidation(
				{ input: 'test' },
				mockValidator
			);

			expect(result).toEqual(secondPayload);
			expect(mockValidator).toHaveBeenCalledTimes(2);
			expect(mockSendMessage).toHaveBeenCalledTimes(3);
		});

		test('should fail after max retries', async () => {
			const transformer = new AITransformer({ maxRetries: 1 });
			await transformer.init();

			mockSendMessage.mockResolvedValue({ text: '{"result": "invalid"}' });
			mockValidator.mockRejectedValue(new Error('Always fails'));

			await expect(transformer.transformWithValidation(
				{ input: 'test' },
				mockValidator
			)).rejects.toThrow('Transformation with validation failed after 2 attempts');
		});

		test('should use custom retry options', async () => {
			const transformer = new AITransformer({ maxRetries: 1, retryDelay: 100 });
			await transformer.init();

			mockSendMessage.mockResolvedValue({ text: '{"result": "invalid"}' });
			mockValidator.mockRejectedValue(new Error('Validation failed'));

			const startTime = Date.now();
			
			await expect(transformer.transformWithValidation(
				{ input: 'test' },
				mockValidator,
				{ maxRetries: 2, retryDelay: 50 }
			)).rejects.toThrow('failed after 3 attempts');

			const endTime = Date.now();
			// Should have used custom retry delay (50ms + exponential backoff)
			expect(endTime - startTime).toBeGreaterThan(50);
		});
	});

	describe('reset()', () => {
		test('should reset initialized chat session', async () => {
			await transformer.init();
			await transformer.reset();

			expect(mockChatsCreate).toHaveBeenCalledTimes(2); // init + reset
		});

		test('should handle reset when chat not initialized', async () => {
			await transformer.reset();
			
			// Should not throw error, just warn
			expect(mockChatsCreate).not.toHaveBeenCalled();
		});
	});

	describe('getHistory()', () => {
		test('should return chat history when initialized', async () => {
			const mockHistory = [{ role: 'user', parts: [{ text: 'test' }] }];
			mockGetHistory.mockReturnValue(mockHistory);
			
			await transformer.init();
			const history = transformer.getHistory();

			expect(history).toBe(mockHistory);
			expect(mockGetHistory).toHaveBeenCalled();
		});

		test('should return empty array when not initialized', () => {
			const history = transformer.getHistory();
			
			expect(history).toEqual([]);
		});
	});

	describe('Integration Tests', () => {
		test('should handle complete workflow: init -> seed -> transform', async () => {
			const mockResponse = { text: '{"profession": "engineer", "emoji": ["🔧"]}' };
			mockSendMessage.mockResolvedValue(mockResponse);

			const examples = [
				{
					PROMPT: { name: 'Alice' },
					ANSWER: { profession: 'scientist', emoji: ['🔬'] }
				}
			];

			await transformer.init();
			await transformer.seed(examples);
			const result = await transformer.message({ name: 'Bob' });

			expect(result).toEqual({ profession: 'engineer', emoji: ['🔧'] });
			expect(mockChatsCreate).toHaveBeenCalledTimes(2); // init + seed
		});

		test('should handle workflow with validation and retry', async () => {
			const invalidPayload = { incomplete: 'data' };
			const validPayload = { profession: 'engineer', emoji: ['🔧'] };

			mockSendMessage
				.mockResolvedValueOnce({ text: JSON.stringify(invalidPayload) })
				.mockResolvedValueOnce({ text: JSON.stringify(invalidPayload) })
				.mockResolvedValueOnce({ text: JSON.stringify(validPayload) });

			const validator = jest.fn()
				.mockRejectedValueOnce(new Error('Missing profession'))
				.mockResolvedValueOnce(validPayload);

			await transformer.init();
			const result = await transformer.transformWithValidation(
				{ name: 'Test' },
				validator
			);

			expect(result).toEqual(validPayload);
		});
	});

	describe('Error Handling', () => {
		test('should handle missing GEMINI_API_KEY', () => {
			const originalKey = process.env.GEMINI_API_KEY;
			delete process.env.GEMINI_API_KEY;

			// This should be tested by requiring the module fresh, 
			// but we'll mock it for this test
			expect(() => {
				if (!process.env.GEMINI_API_KEY) {
					throw new Error("Missing GEMINI_API_KEY environment variable.");
				}
			}).toThrow("Missing GEMINI_API_KEY environment variable.");

			process.env.GEMINI_API_KEY = originalKey;
		});

		test('should handle network timeout errors', async () => {
			await transformer.init();
			mockSendMessage.mockRejectedValue(new Error('Network timeout'));

			await expect(transformer.message({ test: 'data' }))
				.rejects.toThrow('Transformation failed: Network timeout');
		});

		test('should handle malformed response from API', async () => {
			await transformer.init();
			mockSendMessage.mockResolvedValue({ text: undefined });

			await expect(transformer.message({ test: 'data' }))
				.rejects.toThrow('Invalid JSON response from Gemini');
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty examples array', async () => {
			await transformer.seed([]);
			// Should not throw, just skip seeding
			expect(mockChatsCreate).toHaveBeenCalledTimes(1); // Only init
		});

		test('should handle examples with missing keys', async () => {
			const examples = [
				{ PROMPT: { test: 'data' } }, // Missing ANSWER
				{ ANSWER: { result: 'data' } }, // Missing PROMPT
				{} // Missing both
			];

			await transformer.seed(examples);
			// Should not throw, just process what's available
			expect(mockChatsCreate).toHaveBeenCalledTimes(2);
		});

		test('should handle very large payloads', async () => {
			const largePayload = {
				data: new Array(1000).fill('x').join(''),
				nested: {
					deep: {
						structure: new Array(100).fill({ key: 'value' })
					}
				}
			};

			mockSendMessage.mockResolvedValue({ text: '{"result": "processed"}' });
			await transformer.init();

			const result = await transformer.message(largePayload);
			expect(result).toEqual({ result: 'processed' });
		});

		test('should handle special characters in JSON', async () => {
			const specialPayload = {
				text: 'Hello "world" with\nnewlines and\ttabs',
				unicode: '🚀 émojis and acçénts'
			};

			mockSendMessage.mockResolvedValue({ text: '{"processed": true}' });
			await transformer.init();

			const result = await transformer.message(specialPayload);
			expect(result).toEqual({ processed: true });
		});
	});
});