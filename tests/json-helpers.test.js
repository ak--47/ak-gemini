import { extractJSON, attemptJSONRecovery } from '../json-helpers.js';
import { isJSON, isJSONStr } from '../json-helpers.js';

describe('json-helpers', () => {

	// ── isJSON ───────────────────────────────────────────────────────────────

	describe('isJSON()', () => {
		it('should return true for objects', () => {
			expect(isJSON({ a: 1 })).toBe(true);
		});

		it('should return true for arrays', () => {
			expect(isJSON([1, 2, 3])).toBe(true);
		});

		it('should return false for strings', () => {
			expect(isJSON('hello')).toBe(false);
		});

		it('should return false for numbers', () => {
			expect(isJSON(42)).toBe(false);
		});

		it('should return false for null', () => {
			expect(isJSON(null)).toBe(false);
		});

		it('should return false for undefined', () => {
			expect(isJSON(undefined)).toBe(false);
		});

		it('should return false for circular references', () => {
			const obj = {};
			obj.self = obj;
			expect(isJSON(obj)).toBe(false);
		});
	});

	// ── isJSONStr ────────────────────────────────────────────────────────────

	describe('isJSONStr()', () => {
		it('should return true for valid JSON object string', () => {
			expect(isJSONStr('{"a":1}')).toBe(true);
		});

		it('should return true for valid JSON array string', () => {
			expect(isJSONStr('[1,2,3]')).toBe(true);
		});

		it('should return false for plain string', () => {
			expect(isJSONStr('"hello"')).toBe(false);
		});

		it('should return false for number string', () => {
			expect(isJSONStr('42')).toBe(false);
		});

		it('should return false for invalid JSON', () => {
			expect(isJSONStr('{bad json}')).toBe(false);
		});

		it('should return false for non-string input', () => {
			expect(isJSONStr(123)).toBe(false);
			expect(isJSONStr(null)).toBe(false);
			expect(isJSONStr(undefined)).toBe(false);
		});
	});

	// ── attemptJSONRecovery ──────────────────────────────────────────────────

	describe('attemptJSONRecovery()', () => {
		it('should return null for null/undefined input', () => {
			expect(attemptJSONRecovery(null)).toBeNull();
			expect(attemptJSONRecovery(undefined)).toBeNull();
			expect(attemptJSONRecovery('')).toBeNull();
		});

		it('should return null for non-string input', () => {
			expect(attemptJSONRecovery(42)).toBeNull();
		});

		it('should parse valid JSON as-is', () => {
			const result = attemptJSONRecovery('{"a": 1}');
			expect(result).toEqual({ a: 1 });
		});

		it('should recover truncated JSON with missing closing brace', () => {
			const result = attemptJSONRecovery('{"name": "Alice", "age": 30');
			expect(result).not.toBeNull();
			expect(result.name).toBe('Alice');
		});

		it('should recover truncated JSON with missing closing bracket', () => {
			const result = attemptJSONRecovery('[1, 2, 3');
			expect(result).not.toBeNull();
			expect(result).toEqual([1, 2, 3]);
		});

		it('should recover nested truncated JSON by adding closing chars', () => {
			const result = attemptJSONRecovery('{"items": [{"id": 1}, {"id": 2}]');
			expect(result).not.toBeNull();
			expect(result.items).toHaveLength(2);
		});

		it('should recover JSON with unclosed string', () => {
			const result = attemptJSONRecovery('{"name": "Alice');
			expect(result).not.toBeNull();
		});

		it('should handle escaped characters in strings', () => {
			const result = attemptJSONRecovery('{"msg": "hello \\"world\\""}');
			expect(result).toEqual({ msg: 'hello "world"' });
		});

		it('should handle backslash escapes during recovery', () => {
			const result = attemptJSONRecovery('{"path": "C:\\\\Users\\\\test"');
			expect(result).not.toBeNull();
		});

		it('should return null for completely unrecoverable text', () => {
			const result = attemptJSONRecovery('This is not JSON at all', 5);
			expect(result).toBeNull();
		});

		it('should recover by progressive removal when simple close fails', () => {
			// Truncated mid-value — simple close won't work, progressive removal needed
			const result = attemptJSONRecovery('{"a": 1, "b": 2, "c": "trunc');
			expect(result).not.toBeNull();
		});
	});

	// ── extractJSON ──────────────────────────────────────────────────────────

	describe('extractJSON()', () => {

		// Strategy 1: Direct parse
		it('should parse plain JSON text', () => {
			const result = extractJSON('{"name": "Alice", "age": 30}');
			expect(result).toEqual({ name: 'Alice', age: 30 });
		});

		it('should parse JSON array', () => {
			const result = extractJSON('[1, 2, 3]');
			expect(result).toEqual([1, 2, 3]);
		});

		it('should handle whitespace around JSON', () => {
			const result = extractJSON('  \n  {"a": 1}  \n  ');
			expect(result).toEqual({ a: 1 });
		});

		// Strategy 2: Code blocks
		it('should extract JSON from ```json code block', () => {
			const text = 'Here is the result:\n```json\n{"name": "Bob"}\n```\nDone.';
			const result = extractJSON(text);
			expect(result).toEqual({ name: 'Bob' });
		});

		it('should extract JSON from ``` code block (no language tag)', () => {
			const text = 'Result:\n```\n{"key": "value"}\n```';
			const result = extractJSON(text);
			expect(result).toEqual({ key: 'value' });
		});

		it('should try multiple code blocks and find valid one', () => {
			const text = '```json\nnot valid json\n```\n```json\n{"valid": true}\n```';
			const result = extractJSON(text);
			expect(result).toEqual({ valid: true });
		});

		// Strategy 3: Regex bracket matching
		it('should extract JSON embedded in surrounding text', () => {
			const text = 'The result is {"answer": 42} and that is final.';
			const result = extractJSON(text);
			expect(result).toEqual({ answer: 42 });
		});

		it('should extract JSON array from surrounding text', () => {
			const text = 'Here are the items: [1, 2, 3] in the list.';
			const result = extractJSON(text);
			expect(result).toEqual([1, 2, 3]);
		});

		// Strategy 4: Advanced bracket matching (findCompleteJSONStructures)
		it('should extract nested JSON from text using bracket matching', () => {
			const text = 'Prefix text {"outer": {"inner": [1, 2]}} suffix text';
			const result = extractJSON(text);
			expect(result).toEqual({ outer: { inner: [1, 2] } });
		});

		it('should handle strings with braces inside JSON', () => {
			const json = '{"code": "function() { return {}; }"}';
			const text = `Here is the output: ${json}`;
			const result = extractJSON(text);
			expect(result).toEqual({ code: 'function() { return {}; }' });
		});

		// Strategy 5: Cleaned text (remove preamble)
		it('should handle "Sure, here is your..." preamble', () => {
			const text = 'Sure, here is your JSON:\n{"result": true}';
			const result = extractJSON(text);
			expect(result).toEqual({ result: true });
		});

		it('should handle "Here is the..." preamble', () => {
			const text = 'Here is the transformed output:\n{"data": 123}';
			const result = extractJSON(text);
			expect(result).toEqual({ data: 123 });
		});

		// Strategy 6: Recovery of truncated JSON
		it('should recover truncated JSON as last resort', () => {
			const text = '{"name": "Alice", "items": [1, 2, 3';
			const result = extractJSON(text);
			expect(result).not.toBeNull();
			expect(result.name).toBe('Alice');
		});

		// Error cases
		it('should throw for null/undefined input', () => {
			expect(() => extractJSON(null)).toThrow('No text provided');
			expect(() => extractJSON(undefined)).toThrow('No text provided');
			expect(() => extractJSON('')).toThrow('No text provided');
		});

		it('should throw for non-string input', () => {
			expect(() => extractJSON(42)).toThrow('No text provided');
		});

		it('should throw when no JSON can be extracted', () => {
			expect(() => extractJSON('This has no JSON content whatsoever.')).toThrow(/Could not extract valid JSON/);
		});

		it('should handle JSON with comments removed', () => {
			const text = '{"a": 1} // this is a comment';
			const result = extractJSON(text);
			expect(result).toEqual({ a: 1 });
		});
	});
});
