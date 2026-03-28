import { describe, it, expect } from 'vitest';
import { parseJsonSafe, toTimestamp, fromTimestamp, nowTimestamp } from '../src/utils/helpers.js';

describe('helpers', () => {
  describe('parseJsonSafe', () => {
    it('should parse valid JSON', () => {
      const result = parseJsonSafe('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('should return default on invalid JSON', () => {
      const result = parseJsonSafe('invalid', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should return null on invalid JSON with no default', () => {
      const result = parseJsonSafe('invalid');
      expect(result).toBeNull();
    });
  });

  describe('toTimestamp', () => {
    it('should convert Date to timestamp', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = toTimestamp(date);
      expect(result).toBe(1704067200000);
    });
  });

  describe('fromTimestamp', () => {
    it('should convert timestamp to Date', () => {
      const result = fromTimestamp(1704067200000);
      expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('nowTimestamp', () => {
    it('should return current timestamp', () => {
      const before = Date.now();
      const result = nowTimestamp();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });
});
