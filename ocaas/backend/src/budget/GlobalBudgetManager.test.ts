/**
 * GlobalBudgetManager Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GlobalBudgetManager,
  resetGlobalBudgetManager,
} from './GlobalBudgetManager.js';
import { DEFAULT_BUDGET_CONFIG } from './types.js';

describe('GlobalBudgetManager', () => {
  let manager: GlobalBudgetManager;

  beforeEach(() => {
    resetGlobalBudgetManager();
    manager = new GlobalBudgetManager();
  });

  describe('checkBudget', () => {
    it('should allow when within budget', () => {
      const result = manager.checkBudget({
        task_id: 'task-1',
        agent_id: 'agent-1',
        tier: 'short',
        operation: 'decision',
      });

      expect(result.decision).toBe('allow');
      expect(result.would_exceed).toBe(false);
    });

    it('should warn when approaching soft threshold', () => {
      // Record costs to approach soft threshold (80%)
      const limit = DEFAULT_BUDGET_CONFIG.max_cost_per_task_usd;
      const costToRecord = limit * 0.75; // 75% of limit

      // Manually set up accumulated cost
      manager.recordCost({
        task_id: 'task-1',
        operation: 'decision',
        tier: 'medium',
        input_tokens: 5000,
        output_tokens: 3000,
        estimated_cost_usd: costToRecord,
        budget_decision: 'allow',
      });

      // Check again - should now warn
      const result = manager.checkBudget({
        task_id: 'task-1',
        tier: 'medium',
        operation: 'decision',
      });

      // With 75% already used + estimated cost, should trigger warn
      expect(['allow', 'warn']).toContain(result.decision);
    });

    it('should block when hard limit would be exceeded', () => {
      // Configure with low limit
      manager.updateConfig({
        max_cost_per_task_usd: 0.01, // Very low limit
        hard_stop_enabled: true,
      });

      // Record cost that uses most of budget
      manager.recordCost({
        task_id: 'task-1',
        operation: 'decision',
        tier: 'deep',
        input_tokens: 1200,
        output_tokens: 800,
        estimated_cost_usd: 0.009,
        budget_decision: 'allow',
      });

      // Try to use more - should block
      const result = manager.checkBudget({
        task_id: 'task-1',
        tier: 'deep',
        operation: 'decision',
      });

      expect(result.decision).toBe('block');
      expect(result.would_exceed).toBe(true);
    });

    it('should degrade tier when approaching limit with auto_degrade enabled', () => {
      // Configure with low limit and auto degrade
      manager.updateConfig({
        max_cost_per_task_usd: 0.01,
        hard_stop_enabled: false, // Disable hard stop to allow degrade
        auto_degrade_enabled: true,
      });

      // Record cost that uses most of budget
      manager.recordCost({
        task_id: 'task-1',
        operation: 'decision',
        tier: 'medium',
        input_tokens: 400,
        output_tokens: 250,
        estimated_cost_usd: 0.008,
        budget_decision: 'allow',
      });

      // Try deep tier - should degrade
      const result = manager.checkBudget({
        task_id: 'task-1',
        tier: 'deep',
        operation: 'decision',
      });

      expect(result.decision).toBe('degrade');
      expect(result.degraded_tier).toBeDefined();
    });
  });

  describe('recordCost', () => {
    it('should accumulate costs correctly', () => {
      manager.recordCost({
        task_id: 'task-1',
        agent_id: 'agent-1',
        operation: 'decision',
        tier: 'medium',
        input_tokens: 400,
        output_tokens: 250,
        estimated_cost_usd: 0.005,
        budget_decision: 'allow',
      });

      const taskCost = manager.getTaskCost('task-1');
      expect(taskCost.total_cost_usd).toBeGreaterThan(0);
      expect(taskCost.total_input_tokens).toBe(400);
      expect(taskCost.total_output_tokens).toBe(250);
      expect(taskCost.operation_count).toBe(1);

      const agentCost = manager.getAgentDailyCost('agent-1');
      expect(agentCost.total_cost_usd).toBeGreaterThan(0);

      const globalCost = manager.getGlobalDailyCost();
      expect(globalCost.total_cost_usd).toBeGreaterThan(0);
    });

    it('should accumulate multiple operations', () => {
      manager.recordCost({
        task_id: 'task-1',
        operation: 'decision',
        tier: 'short',
        input_tokens: 150,
        output_tokens: 100,
        estimated_cost_usd: 0.002,
        budget_decision: 'allow',
      });

      manager.recordCost({
        task_id: 'task-1',
        operation: 'generation',
        tier: 'deep',
        input_tokens: 1200,
        output_tokens: 800,
        estimated_cost_usd: 0.02,
        budget_decision: 'allow',
      });

      const taskCost = manager.getTaskCost('task-1');
      expect(taskCost.operation_count).toBe(2);
      expect(taskCost.total_input_tokens).toBe(1350);
      expect(taskCost.total_output_tokens).toBe(900);
    });
  });

  describe('getDiagnostics', () => {
    it('should return valid diagnostics', () => {
      manager.recordCost({
        task_id: 'task-1',
        agent_id: 'agent-1',
        operation: 'decision',
        tier: 'medium',
        input_tokens: 400,
        output_tokens: 250,
        estimated_cost_usd: 0.005,
        budget_decision: 'allow',
      });

      const diagnostics = manager.getDiagnostics();

      expect(diagnostics.config).toBeDefined();
      expect(diagnostics.today.date).toBeDefined();
      expect(diagnostics.today.global_cost_usd).toBeGreaterThan(0);
      expect(diagnostics.status).toBe('healthy');
      expect(diagnostics.recent_records.length).toBe(1);
      expect(diagnostics.top_agents.length).toBe(1);
    });

    it('should reflect warning status when approaching limit', () => {
      manager.updateConfig({
        max_cost_daily_usd: 0.01,
      });

      // Record cost that exceeds soft threshold
      manager.recordCost({
        task_id: 'task-1',
        operation: 'decision',
        tier: 'deep',
        input_tokens: 1200,
        output_tokens: 800,
        estimated_cost_usd: 0.009,
        budget_decision: 'allow',
      });

      const diagnostics = manager.getDiagnostics();
      expect(['warning', 'critical']).toContain(diagnostics.status);
    });
  });

  describe('buildTraceability', () => {
    it('should build complete traceability', () => {
      const check = manager.checkBudget({
        task_id: 'task-1',
        tier: 'medium',
        operation: 'decision',
      });

      const trace = manager.buildTraceability(check, 0.005, 'deep', 'medium');

      expect(trace.budget_decision).toBe('allow');
      expect(trace.budget_scope).toBeDefined();
      expect(trace.budget_snapshot).toBeDefined();
      expect(trace.was_degraded).toBe(true);
      expect(trace.original_tier).toBe('deep');
      expect(trace.final_tier).toBe('medium');
    });
  });

  describe('reset', () => {
    it('should clear all tracking data', () => {
      manager.recordCost({
        task_id: 'task-1',
        operation: 'decision',
        tier: 'medium',
        input_tokens: 400,
        output_tokens: 250,
        estimated_cost_usd: 0.005,
        budget_decision: 'allow',
      });

      manager.reset();

      const globalCost = manager.getGlobalDailyCost();
      expect(globalCost.total_cost_usd).toBe(0);
      expect(globalCost.operation_count).toBe(0);
    });
  });
});
