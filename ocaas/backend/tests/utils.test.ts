import { describe, it, expect } from 'vitest';
import { parseJsonSafe, parseJsonFromLLM, toTimestamp, fromTimestamp, nowTimestamp } from '../src/utils/helpers.js';

describe('helpers', () => {
  describe('parseJsonSafe', () => {
    it('should parse valid JSON', () => {
      const result = parseJsonSafe('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('should return undefined on invalid JSON', () => {
      const result = parseJsonSafe('invalid');
      expect(result).toBeUndefined();
    });

    it('should return undefined on null input', () => {
      const result = parseJsonSafe(null);
      expect(result).toBeUndefined();
    });
  });

  describe('parseJsonFromLLM', () => {
    it('should parse plain JSON', () => {
      const result = parseJsonFromLLM('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON in markdown code fence', () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = parseJsonFromLLM(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON in code fence without language', () => {
      const input = '```\n{"key": "value"}\n```';
      const result = parseJsonFromLLM(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('should extract JSON from surrounding text', () => {
      const input = 'Here is the result: {"key": "value"} and some more text';
      const result = parseJsonFromLLM(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON array', () => {
      const result = parseJsonFromLLM('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should throw on empty input', () => {
      expect(() => parseJsonFromLLM('')).toThrow('Empty or invalid content');
    });

    it('should throw when no valid JSON found', () => {
      expect(() => parseJsonFromLLM('just some text')).toThrow('No valid JSON found');
    });
  });

  describe('toTimestamp', () => {
    it('should convert Date to unix timestamp (seconds)', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = toTimestamp(date);
      expect(result).toBe(1704067200); // Unix timestamp in seconds
    });
  });

  describe('fromTimestamp', () => {
    it('should convert unix timestamp (seconds) to Date', () => {
      const result = fromTimestamp(1704067200);
      expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('nowTimestamp', () => {
    it('should return current unix timestamp (seconds)', () => {
      const before = Math.floor(Date.now() / 1000);
      const result = nowTimestamp();
      const after = Math.floor(Date.now() / 1000);
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });
});
