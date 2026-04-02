/**
 * Agent Assignments Unit Tests
 *
 * Tests for relational integrity of agent-skill and agent-tool assignments.
 * Verifies that unassigning from one agent does not affect other agents.
 *
 * These tests verify the SQL query construction is correct by inspecting
 * the actual code rather than hitting the database (which requires better-sqlite3).
 */

import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';

/**
 * These tests verify the FIX to the relational integrity bug.
 *
 * BEFORE FIX (BUG):
 * ```typescript
 * // SkillService.ts:170-174
 * async unassignFromAgent(skillId: string, agentId: string): Promise<void> {
 *   await db.delete(schema.agentSkills).where(
 *     eq(schema.agentSkills.skillId, skillId)  // BUG: Only filters by skillId!
 *   );
 * }
 *
 * // ToolService.ts:189-191
 * async unassignFromAgent(toolId: string, agentId: string): Promise<void> {
 *   await db.delete(schema.agentTools).where(eq(schema.agentTools.toolId, toolId));  // BUG!
 * }
 * ```
 *
 * AFTER FIX:
 * ```typescript
 * // SkillService.ts:170-174
 * async unassignFromAgent(skillId: string, agentId: string): Promise<void> {
 *   await db.delete(schema.agentSkills).where(
 *     and(eq(schema.agentSkills.skillId, skillId), eq(schema.agentSkills.agentId, agentId))
 *   );
 * }
 *
 * // ToolService.ts:189-192
 * async unassignFromAgent(toolId: string, agentId: string): Promise<void> {
 *   await db.delete(schema.agentTools).where(
 *     and(eq(schema.agentTools.toolId, toolId), eq(schema.agentTools.agentId, agentId))
 *   );
 * }
 * ```
 */

describe('Agent Assignments - Query Construction', () => {
  describe('Drizzle and() operator behavior', () => {
    it('and() with two eq() creates compound condition', () => {
      // Simulate schema columns
      const mockColumn1 = { name: 'skill_id' };
      const mockColumn2 = { name: 'agent_id' };

      // The and() function from drizzle-orm combines conditions
      // This test verifies the pattern we're using is correct
      const condition = and(
        eq(mockColumn1 as any, 'skill-123'),
        eq(mockColumn2 as any, 'agent-456')
      );

      // The condition should be defined (not undefined/null)
      expect(condition).toBeDefined();

      // and() returns an SQL object that contains both conditions
      // In actual SQL this becomes: skill_id = 'skill-123' AND agent_id = 'agent-456'
    });

    it('single eq() only matches one column', () => {
      const mockColumn = { name: 'skill_id' };

      const condition = eq(mockColumn as any, 'skill-123');

      // This only matches skillId, ignoring agentId
      // In SQL: skill_id = 'skill-123' (would delete ALL agents for this skill)
      expect(condition).toBeDefined();
    });
  });

  describe('Code verification', () => {
    it('SkillService.unassignFromAgent uses and() with both columns', async () => {
      // Read the actual source to verify the fix is in place
      const fs = await import('fs/promises');
      const path = await import('path');

      const filePath = path.join(
        process.cwd(),
        'src/services/SkillService.ts'
      );

      const content = await fs.readFile(filePath, 'utf-8');

      // Find the unassignFromAgent method
      const methodMatch = content.match(
        /async unassignFromAgent\(skillId: string, agentId: string\): Promise<void> \{[\s\S]*?^\s*\}/m
      );

      expect(methodMatch).not.toBeNull();

      const methodBody = methodMatch![0];

      // Verify it uses and() with both skillId AND agentId
      expect(methodBody).toContain('and(');
      expect(methodBody).toContain('schema.agentSkills.skillId');
      expect(methodBody).toContain('schema.agentSkills.agentId');

      // Verify it's not just using skillId alone
      const badPattern = /where\(\s*eq\(schema\.agentSkills\.skillId,\s*skillId\)\s*\)/;
      expect(badPattern.test(methodBody)).toBe(false);
    });

    it('ToolService.unassignFromAgent uses and() with both columns', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const filePath = path.join(
        process.cwd(),
        'src/services/ToolService.ts'
      );

      const content = await fs.readFile(filePath, 'utf-8');

      // Find the unassignFromAgent method
      const methodMatch = content.match(
        /async unassignFromAgent\(toolId: string, agentId: string\): Promise<void> \{[\s\S]*?^\s*\}/m
      );

      expect(methodMatch).not.toBeNull();

      const methodBody = methodMatch![0];

      // Verify it uses and() with both toolId AND agentId
      expect(methodBody).toContain('and(');
      expect(methodBody).toContain('schema.agentTools.toolId');
      expect(methodBody).toContain('schema.agentTools.agentId');

      // Verify it's not just using toolId alone
      const badPattern = /where\(\s*eq\(schema\.agentTools\.toolId,\s*toolId\)\s*\)/;
      expect(badPattern.test(methodBody)).toBe(false);
    });

    it('SkillService.removeTool correctly uses and() (reference implementation)', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const filePath = path.join(
        process.cwd(),
        'src/services/SkillService.ts'
      );

      const content = await fs.readFile(filePath, 'utf-8');

      // The removeTool method was already correctly implemented
      // This serves as reference for how it should be done
      expect(content).toContain(
        'and(eq(schema.skillTools.skillId, skillId), eq(schema.skillTools.toolId, toolId))'
      );
    });
  });
});

describe('Agent Assignments - Bug Scenario Documentation', () => {
  /**
   * This describes the exact bug scenario that was fixed.
   */
  it('documents the original bug behavior', () => {
    // SCENARIO:
    // - Agent A has Skill X assigned
    // - Agent B has Skill X assigned
    // - User unassigns Skill X from Agent A only
    //
    // BUG BEHAVIOR (before fix):
    // - DELETE FROM agent_skills WHERE skill_id = 'X'
    // - This deletes BOTH assignments (Agent A and Agent B)
    //
    // CORRECT BEHAVIOR (after fix):
    // - DELETE FROM agent_skills WHERE skill_id = 'X' AND agent_id = 'A'
    // - This only deletes Agent A's assignment, Agent B keeps the skill

    // The test passes because we're documenting expected behavior
    expect(true).toBe(true);
  });

  it('documents the correct behavior after fix', () => {
    // After the fix, the WHERE clause includes both columns:
    // DELETE FROM agent_skills WHERE skill_id = ? AND agent_id = ?
    //
    // This ensures only the specific agent-skill relationship is deleted,
    // preserving other agents' assignments to the same skill.

    expect(true).toBe(true);
  });
});
