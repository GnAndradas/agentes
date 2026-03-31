/**
 * Execution Lease Store
 *
 * Manages execution ownership/leases to prevent duplicate task execution
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../../utils/logger.js';
import { nowTimestamp } from '../../utils/helpers.js';
import type { ExecutionLease } from './types.js';

const logger = createLogger('ExecutionLeaseStore');

// Default lease duration: 5 minutes
const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000;

// Instance ID for this OCAAS instance
const INSTANCE_ID = `ocaas_${nanoid(8)}`;

export class ExecutionLeaseStore {
  private leases = new Map<string, ExecutionLease>();
  private leaseDurationMs: number;

  constructor(leaseDurationMs: number = DEFAULT_LEASE_DURATION_MS) {
    this.leaseDurationMs = leaseDurationMs;
  }

  /**
   * Get the instance ID
   */
  getInstanceId(): string {
    return INSTANCE_ID;
  }

  /**
   * Attempt to acquire a lease for a task
   * Returns the lease if acquired, null if already held by another
   */
  acquire(taskId: string, executionId: string): ExecutionLease | null {
    const existing = this.leases.get(taskId);
    const now = nowTimestamp();

    // Check if there's an existing active lease
    if (existing && existing.active && existing.expiresAt > now) {
      // Lease already held and not expired
      if (existing.executionId !== executionId) {
        logger.warn({
          taskId,
          existingExecutionId: existing.executionId,
          requestedExecutionId: executionId,
          expiresAt: existing.expiresAt,
        }, 'Lease conflict - task already has active lease');
        return null;
      }
      // Same execution trying to re-acquire - just return existing
      return existing;
    }

    // If existing lease is expired or inactive, clean it up
    if (existing && (!existing.active || existing.expiresAt <= now)) {
      logger.info({
        taskId,
        oldExecutionId: existing.executionId,
        wasExpired: existing.expiresAt <= now,
      }, 'Previous lease expired or released, acquiring new lease');
    }

    // Create new lease
    const lease: ExecutionLease = {
      taskId,
      executionId,
      instanceId: INSTANCE_ID,
      acquiredAt: now,
      expiresAt: now + this.leaseDurationMs,
      lastRenewalAt: now,
      active: true,
    };

    this.leases.set(taskId, lease);
    logger.debug({ taskId, executionId, expiresAt: lease.expiresAt }, 'Lease acquired');
    return lease;
  }

  /**
   * Renew an existing lease
   * Returns updated lease or null if not owned by this execution
   */
  renew(taskId: string, executionId: string): ExecutionLease | null {
    const lease = this.leases.get(taskId);
    const now = nowTimestamp();

    if (!lease) {
      logger.warn({ taskId, executionId }, 'Cannot renew - no lease exists');
      return null;
    }

    if (lease.executionId !== executionId) {
      logger.warn({
        taskId,
        expectedExecutionId: executionId,
        actualExecutionId: lease.executionId,
      }, 'Cannot renew - execution ID mismatch');
      return null;
    }

    if (!lease.active) {
      logger.warn({ taskId, executionId }, 'Cannot renew - lease is inactive');
      return null;
    }

    // Check if lease is expired (grace period of 1 second)
    if (lease.expiresAt < now - 1000) {
      logger.warn({
        taskId,
        executionId,
        expiredAt: lease.expiresAt,
        now,
      }, 'Cannot renew - lease has expired');
      lease.active = false;
      return null;
    }

    // Renew the lease
    lease.expiresAt = now + this.leaseDurationMs;
    lease.lastRenewalAt = now;

    logger.debug({ taskId, executionId, newExpiresAt: lease.expiresAt }, 'Lease renewed');
    return lease;
  }

  /**
   * Release a lease
   */
  release(taskId: string, executionId: string): boolean {
    const lease = this.leases.get(taskId);

    if (!lease) {
      logger.debug({ taskId }, 'No lease to release');
      return false;
    }

    if (lease.executionId !== executionId) {
      logger.warn({
        taskId,
        expectedExecutionId: executionId,
        actualExecutionId: lease.executionId,
      }, 'Cannot release - execution ID mismatch');
      return false;
    }

    lease.active = false;
    logger.debug({ taskId, executionId }, 'Lease released');
    return true;
  }

  /**
   * Force release a lease (admin operation)
   */
  forceRelease(taskId: string): boolean {
    const lease = this.leases.get(taskId);
    if (!lease) return false;

    lease.active = false;
    logger.info({ taskId, executionId: lease.executionId }, 'Lease force released');
    return true;
  }

  /**
   * Get lease for a task
   */
  get(taskId: string): ExecutionLease | null {
    return this.leases.get(taskId) ?? null;
  }

  /**
   * Check if a task has an active (non-expired) lease
   */
  hasActiveLease(taskId: string): boolean {
    const lease = this.leases.get(taskId);
    if (!lease) return false;
    return lease.active && lease.expiresAt > nowTimestamp();
  }

  /**
   * Check if this execution owns the lease
   */
  ownsLease(taskId: string, executionId: string): boolean {
    const lease = this.leases.get(taskId);
    if (!lease) return false;
    return lease.active && lease.executionId === executionId && lease.expiresAt > nowTimestamp();
  }

  /**
   * Get all active leases
   */
  getActiveLeases(): ExecutionLease[] {
    const now = nowTimestamp();
    return Array.from(this.leases.values()).filter(
      lease => lease.active && lease.expiresAt > now
    );
  }

  /**
   * Get expired but still marked as active leases (orphans)
   */
  getExpiredLeases(): ExecutionLease[] {
    const now = nowTimestamp();
    return Array.from(this.leases.values()).filter(
      lease => lease.active && lease.expiresAt <= now
    );
  }

  /**
   * Get leases by instance
   */
  getLeasesByInstance(instanceId: string): ExecutionLease[] {
    return Array.from(this.leases.values()).filter(
      lease => lease.instanceId === instanceId && lease.active
    );
  }

  /**
   * Cleanup expired leases
   */
  cleanupExpired(): number {
    const now = nowTimestamp();
    let cleaned = 0;

    for (const [taskId, lease] of this.leases) {
      if (lease.expiresAt < now - this.leaseDurationMs) {
        // Remove leases that have been expired for more than one lease duration
        this.leases.delete(taskId);
        cleaned++;
      } else if (lease.active && lease.expiresAt <= now) {
        // Mark recently expired leases as inactive but keep for history
        lease.active = false;
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Expired leases cleaned up');
    }

    return cleaned;
  }

  /**
   * Get lease statistics
   */
  getStats(): {
    total: number;
    active: number;
    expired: number;
    byInstance: Record<string, number>;
  } {
    const now = nowTimestamp();
    const all = Array.from(this.leases.values());
    const byInstance: Record<string, number> = {};

    for (const lease of all) {
      if (lease.active && lease.expiresAt > now) {
        byInstance[lease.instanceId] = (byInstance[lease.instanceId] ?? 0) + 1;
      }
    }

    return {
      total: all.length,
      active: all.filter(l => l.active && l.expiresAt > now).length,
      expired: all.filter(l => l.active && l.expiresAt <= now).length,
      byInstance,
    };
  }

  /**
   * Delete lease record entirely
   */
  delete(taskId: string): boolean {
    return this.leases.delete(taskId);
  }

  /**
   * List all leases
   */
  list(): ExecutionLease[] {
    return Array.from(this.leases.values());
  }
}

// Singleton
let storeInstance: ExecutionLeaseStore | null = null;

export function getExecutionLeaseStore(): ExecutionLeaseStore {
  if (!storeInstance) {
    storeInstance = new ExecutionLeaseStore();
  }
  return storeInstance;
}
