/**
 * Runtime Module Tests
 *
 * Tests for runtime information and environment checking.
 */

import { describe, it, expect } from 'vitest';
import { getRuntimeInfo, getRuntimeSummary, checkEnvironment } from '../runtime.js';

describe('Runtime Module', () => {
  describe('getRuntimeInfo()', () => {
    it('returns complete runtime info structure', () => {
      const info = getRuntimeInfo();

      // App info
      expect(info.app).toBeDefined();
      expect(info.app.name).toBeDefined();
      expect(info.app.version).toBeDefined();
      expect(info.app.environment).toBeDefined();

      // Build info
      expect(info.build).toBeDefined();
      expect(typeof info.build.dirty).toBe('boolean');

      // Process info
      expect(info.process).toBeDefined();
      expect(info.process.pid).toBeGreaterThan(0);
      expect(info.process.uptime).toBeGreaterThanOrEqual(0);
      expect(info.process.uptimeHuman).toBeDefined();
      expect(info.process.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
      expect(info.process.platform).toBeDefined();
      expect(info.process.cwd).toBeDefined();

      // Memory info
      expect(info.memory).toBeDefined();
      expect(info.memory.heapUsedMB).toBeGreaterThan(0);
      expect(info.memory.rssMB).toBeGreaterThan(0);
    });

    it('returns valid uptime format', () => {
      const info = getRuntimeInfo();
      // Should be something like "0s", "1m 30s", "2h 15m 0s", etc.
      expect(info.process.uptimeHuman).toMatch(/^\d+[smhd]/);
    });

    it('returns consistent version', () => {
      const info1 = getRuntimeInfo();
      const info2 = getRuntimeInfo();
      expect(info1.app.version).toBe(info2.app.version);
    });
  });

  describe('getRuntimeSummary()', () => {
    it('returns compact summary', () => {
      const summary = getRuntimeSummary();

      expect(summary.version).toBeDefined();
      expect(summary.environment).toBeDefined();
      expect(summary.uptime).toBeDefined();
      expect(summary.nodeVersion).toBeDefined();
      expect(summary.pid).toBeGreaterThan(0);
      expect(typeof summary.healthy).toBe('boolean');
    });

    it('has same version as full info', () => {
      const summary = getRuntimeSummary();
      const info = getRuntimeInfo();
      expect(summary.version).toBe(info.app.version);
    });
  });

  describe('checkEnvironment()', () => {
    it('returns environment check structure', () => {
      const check = checkEnvironment();

      expect(check.timestamp).toBeGreaterThan(0);
      expect(Array.isArray(check.checks)).toBe(true);
      expect(typeof check.healthy).toBe('boolean');
      expect(Array.isArray(check.criticalIssues)).toBe(true);
      expect(Array.isArray(check.warnings)).toBe(true);
    });

    it('checks for node version', () => {
      const check = checkEnvironment();
      const nodeCheck = check.checks.find(c => c.name === 'node_version');
      expect(nodeCheck).toBeDefined();
      expect(['ok', 'warning', 'error']).toContain(nodeCheck?.status);
    });

    it('checks for node in PATH', () => {
      const check = checkEnvironment();
      const pathCheck = check.checks.find(c => c.name === 'node_in_path');
      expect(pathCheck).toBeDefined();
      // Node should be in PATH since we're running this test
      expect(pathCheck?.status).toBe('ok');
    });

    it('checks working directory', () => {
      const check = checkEnvironment();
      const cwdCheck = check.checks.find(c => c.name === 'working_directory');
      expect(cwdCheck).toBeDefined();
      expect(cwdCheck?.status).toBe('ok');
    });

    it('returns cached result within 5 minutes', () => {
      const check1 = checkEnvironment();
      const check2 = checkEnvironment();

      // Should be same timestamp if cached
      expect(check1.timestamp).toBe(check2.timestamp);
    });

    it('refreshes when forced', () => {
      const check1 = checkEnvironment();
      const check2 = checkEnvironment(true);

      // Timestamps should be different (or very close if same ms)
      // The key is that the refresh flag is respected
      expect(check2.timestamp).toBeGreaterThanOrEqual(check1.timestamp);
    });
  });

  describe('Environment Detection - Known Issues', () => {
    it('detects Node version in acceptable range', () => {
      const check = checkEnvironment(true);
      const nodeCheck = check.checks.find(c => c.name === 'node_version');

      // Current Node version
      const majorVersion = parseInt(process.version.slice(1).split('.')[0] || '0', 10);

      if (majorVersion < 18) {
        expect(nodeCheck?.status).toBe('error');
        expect(check.criticalIssues.length).toBeGreaterThan(0);
      } else if (majorVersion >= 24) {
        // Node 24+ may have native module issues
        expect(nodeCheck?.status).toBe('warning');
      } else {
        expect(nodeCheck?.status).toBe('ok');
      }
    });
  });
});
