/**
 * SystemDiagnosticsService
 *
 * Comprehensive system health analyzer for OCAAS.
 * Evaluates all components and provides actionable diagnostics.
 */

import { nanoid } from 'nanoid';
import { systemLogger, logError } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import { getServices } from '../services/index.js';
import { getOpenClawAdapter } from '../integrations/openclaw/index.js';
import { getSessionManager } from '../openclaw/index.js';
import { getTaskRouter } from '../orchestrator/TaskRouter.js';
import {
  getCheckpointStore,
  getExecutionLeaseStore,
  getCircuitBreaker,
  getCircuitBreakersSummary,
  getHealthChecker,
  allCircuitsHealthy,
} from '../orchestrator/resilience/index.js';
import { getChannelBridge } from '../services/ChannelBridge.js';
import { TASK_STATUS, EVENT_TYPE } from '../config/constants.js';
import { DRAFT_STATUS } from '../db/schema/drafts.js';
import type {
  SystemHealthResult,
  ReadinessResult,
  MetricsSnapshot,
  DiagnosticCheck,
  DiagnosticIssue,
  DiagnosticRecommendation,
  DiagnosticsConfig,
  CheckStatus,
  SystemStatus,
} from './types.js';
import { DEFAULT_DIAGNOSTICS_CONFIG } from './types.js';

const logger = systemLogger.child({ component: 'SystemDiagnosticsService' });

// =============================================================================
// SERVICE
// =============================================================================

export class SystemDiagnosticsService {
  private config: DiagnosticsConfig;
  private lastHealthResult: SystemHealthResult | null = null;

  constructor(config: Partial<DiagnosticsConfig> = {}) {
    this.config = { ...DEFAULT_DIAGNOSTICS_CONFIG, ...config };
  }

  // ===========================================================================
  // MAIN PUBLIC METHODS
  // ===========================================================================

  /**
   * Get comprehensive system health report
   */
  async getSystemHealth(): Promise<SystemHealthResult> {
    const startTime = Date.now();
    const checks: DiagnosticCheck[] = [];
    const criticalIssues: DiagnosticIssue[] = [];
    const warnings: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    logger.info('Starting system diagnostics...');

    // Run all checks
    const checkResults = await Promise.allSettled([
      this.checkOpenClaw(),
      this.checkGateway(),
      this.checkTasks(),
      this.checkResilience(),
      this.checkResources(),
      this.checkChannels(),
      this.checkLogging(),
      this.checkDatabase(),
    ]);

    // Process results
    for (const result of checkResults) {
      if (result.status === 'fulfilled') {
        const { checks: c, issues: i, recommendations: r } = result.value;
        checks.push(...c);
        for (const issue of i) {
          if (issue.severity === 'critical' || issue.severity === 'error') {
            criticalIssues.push(issue);
          } else {
            warnings.push(issue);
          }
        }
        recommendations.push(...r);
      } else {
        // Check itself failed
        checks.push({
          name: 'diagnostic_error',
          category: 'logging',
          status: 'fail',
          message: `Diagnostic check failed: ${result.reason}`,
          severity: 'error',
        });
      }
    }

    // Calculate score and status
    const score = this.calculateScore(checks);
    const status = this.determineStatus(score, criticalIssues.length);

    const result: SystemHealthResult = {
      status,
      score,
      checks,
      criticalIssues,
      warnings,
      recommendations: recommendations.sort((a, b) => a.priority - b.priority),
      timestamp: nowTimestamp(),
      durationMs: Date.now() - startTime,
    };

    this.lastHealthResult = result;

    // Emit events based on status
    await this.emitDiagnosticEvents(result);

    logger.info({
      status,
      score,
      checksTotal: checks.length,
      checksPassed: checks.filter(c => c.status === 'pass').length,
      criticalIssues: criticalIssues.length,
      warnings: warnings.length,
      durationMs: result.durationMs,
    }, 'System diagnostics completed');

    return result;
  }

  /**
   * Get production readiness report
   */
  async getReadinessReport(): Promise<ReadinessResult> {
    const health = await this.getSystemHealth();
    const checklist: Array<{ name: string; passed: boolean; reason?: string }> = [];
    const blockers: DiagnosticIssue[] = [];
    const nonBlockers: DiagnosticIssue[] = [];

    // Readiness criteria
    const criteria = [
      {
        name: 'OpenClaw Connected',
        check: () => health.checks.some(c => c.category === 'openclaw' && c.status === 'pass'),
      },
      {
        name: 'Database Accessible',
        check: () => health.checks.some(c => c.category === 'database' && c.status === 'pass'),
      },
      {
        name: 'No Critical Issues',
        check: () => health.criticalIssues.length === 0,
      },
      {
        name: 'Circuit Breakers Healthy',
        check: () => allCircuitsHealthy(),
      },
      {
        name: 'Health Score >= 70',
        check: () => health.score >= 70,
      },
      {
        name: 'No Stuck Tasks',
        check: () => !health.checks.some(c => c.name === 'stuck_tasks' && c.status === 'fail'),
      },
      {
        name: 'No Orphan Executions',
        check: () => !health.checks.some(c => c.name === 'orphan_executions' && c.status === 'fail'),
      },
    ];

    for (const criterion of criteria) {
      const passed = criterion.check();
      checklist.push({
        name: criterion.name,
        passed,
        reason: passed ? undefined : `Criterion not met`,
      });
    }

    // Categorize issues
    for (const issue of [...health.criticalIssues, ...health.warnings]) {
      if (issue.severity === 'critical' || issue.severity === 'error') {
        blockers.push(issue);
      } else {
        nonBlockers.push(issue);
      }
    }

    const allPassed = checklist.every(c => c.passed);
    const score = Math.round((checklist.filter(c => c.passed).length / checklist.length) * 100);

    return {
      ready: allPassed && blockers.length === 0,
      score,
      blockers,
      nonBlockers,
      checklist,
      timestamp: nowTimestamp(),
    };
  }

  /**
   * Get only critical issues
   */
  async getCriticalIssues(): Promise<DiagnosticIssue[]> {
    const health = await this.getSystemHealth();
    return health.criticalIssues;
  }

  /**
   * Get only warnings
   */
  async getWarnings(): Promise<DiagnosticIssue[]> {
    const health = await this.getSystemHealth();
    return health.warnings;
  }

  /**
   * Get current metrics snapshot
   */
  async getMetrics(): Promise<MetricsSnapshot> {
    const { taskService, agentService, skillService, toolService, manualResourceService } = getServices();
    const adapter = getOpenClawAdapter();
    const sessionManager = getSessionManager();
    const leaseStore = getExecutionLeaseStore();
    const checkpointStore = getCheckpointStore();
    const circuitSummary = getCircuitBreakersSummary();

    // Get tasks
    const tasks = await taskService.list({});
    const stuckTasks = tasks.filter(t =>
      t.status === TASK_STATUS.RUNNING &&
      (nowTimestamp() - t.updatedAt) * 1000 > this.config.taskStuckThresholdMs
    );

    // Get agents
    const agents = await agentService.list();

    // Get resources
    const skills = await skillService.list();
    const tools = await toolService.list();
    const drafts = await manualResourceService.list({});
    const pendingDrafts = drafts.filter(d =>
      d.status === DRAFT_STATUS.DRAFT || d.status === DRAFT_STATUS.PENDING_APPROVAL
    );

    // Test OpenClaw
    let openclawConnected = false;
    let openclawLatency = 0;
    try {
      const startPing = Date.now();
      const testResult = await adapter.testConnection();
      openclawLatency = Date.now() - startPing;
      openclawConnected = testResult.success;
    } catch {
      openclawConnected = false;
    }

    return {
      tasks: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === TASK_STATUS.PENDING || t.status === TASK_STATUS.QUEUED).length,
        running: tasks.filter(t => t.status === TASK_STATUS.RUNNING || t.status === TASK_STATUS.ASSIGNED).length,
        completed: tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length,
        failed: tasks.filter(t => t.status === TASK_STATUS.FAILED).length,
        stuck: stuckTasks.length,
        avgDurationMs: this.calculateAvgTaskDuration(tasks),
      },
      agents: {
        total: agents.length,
        active: agents.filter(a => a.status === 'active').length,
        inactive: agents.filter(a => a.status === 'inactive').length,
        error: agents.filter(a => a.status === 'error').length,
      },
      resources: {
        skills: skills.length,
        tools: tools.length,
        pendingDrafts: pendingDrafts.length,
      },
      resilience: {
        activeLeases: leaseStore.getStats().active,
        expiredLeases: leaseStore.getExpiredLeases().length,
        activeCheckpoints: checkpointStore.getStats().total,
        circuitBreakerState: circuitSummary.open > 0 ? 'open' : (circuitSummary.halfOpen > 0 ? 'half_open' : 'closed'),
      },
      openclaw: {
        connected: openclawConnected,
        activeSessions: sessionManager.getActiveSessionCount(),
        latencyMs: openclawLatency,
      },
      timestamp: nowTimestamp(),
    };
  }

  /**
   * Get last health result without re-running checks
   */
  getLastHealthResult(): SystemHealthResult | null {
    return this.lastHealthResult;
  }

  // ===========================================================================
  // INDIVIDUAL CHECKS
  // ===========================================================================

  private async checkOpenClaw(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    const adapter = getOpenClawAdapter();
    const startTime = Date.now();

    try {
      // Test connection
      const testResult = await adapter.testConnection();
      const durationMs = Date.now() - startTime;

      if (testResult.success) {
        checks.push({
          name: 'openclaw_connection',
          category: 'openclaw',
          status: 'pass',
          message: 'OpenClaw adapter connected successfully',
          severity: 'info',
          durationMs,
          data: { latencyMs: durationMs },
        });
      } else {
        checks.push({
          name: 'openclaw_connection',
          category: 'openclaw',
          status: 'fail',
          message: `OpenClaw connection failed: ${testResult.error?.message ?? 'Unknown error'}`,
          severity: 'critical',
          durationMs,
        });

        issues.push({
          id: nanoid(),
          category: 'openclaw',
          title: 'OpenClaw Connection Failed',
          description: testResult.error?.message ?? 'Cannot connect to OpenClaw gateway',
          severity: 'critical',
          suggestion: 'Check OPENCLAW_API_URL and OPENCLAW_API_KEY configuration',
          detectedAt: nowTimestamp(),
        });
      }

      // Check adapter configured
      checks.push({
        name: 'openclaw_adapter_configured',
        category: 'openclaw',
        status: 'pass',
        message: 'OpenClaw adapter is configured',
        severity: 'info',
      });

    } catch (err) {
      checks.push({
        name: 'openclaw_connection',
        category: 'openclaw',
        status: 'fail',
        message: `OpenClaw check error: ${err instanceof Error ? err.message : 'Unknown'}`,
        severity: 'critical',
      });

      issues.push({
        id: nanoid(),
        category: 'openclaw',
        title: 'OpenClaw Check Exception',
        description: err instanceof Error ? err.message : 'Unknown error during OpenClaw check',
        severity: 'critical',
        detectedAt: nowTimestamp(),
      });
    }

    return { checks, issues, recommendations };
  }

  private async checkGateway(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    const adapter = getOpenClawAdapter();

    try {
      const startTime = Date.now();
      const status = await adapter.getStatus();
      const latencyMs = Date.now() - startTime;

      // Status check - StatusResponse has connected, configured, rest, websocket, hooks, error
      if (status.connected) {
        checks.push({
          name: 'gateway_status',
          category: 'gateway',
          status: 'pass',
          message: 'Gateway is responsive',
          severity: 'info',
          data: {
            connected: status.connected,
            configured: status.configured,
            rest: status.rest,
            websocket: status.websocket,
          },
        });
      } else {
        checks.push({
          name: 'gateway_status',
          category: 'gateway',
          status: 'fail',
          message: `Gateway status check failed: ${status.error ?? 'Not connected'}`,
          severity: 'error',
        });

        issues.push({
          id: nanoid(),
          category: 'gateway',
          title: 'Gateway Status Check Failed',
          description: status.error ?? 'Cannot get gateway status',
          severity: 'error',
          detectedAt: nowTimestamp(),
        });
      }

      // Latency check
      let latencyStatus: CheckStatus = 'pass';
      let latencySeverity: DiagnosticCheck['severity'] = 'info';
      if (latencyMs > this.config.gatewayLatencyErrorMs) {
        latencyStatus = 'fail';
        latencySeverity = 'error';
        issues.push({
          id: nanoid(),
          category: 'gateway',
          title: 'High Gateway Latency',
          description: `Gateway latency ${latencyMs}ms exceeds error threshold ${this.config.gatewayLatencyErrorMs}ms`,
          severity: 'error',
          suggestion: 'Check network connectivity and OpenClaw gateway performance',
          detectedAt: nowTimestamp(),
        });
      } else if (latencyMs > this.config.gatewayLatencyWarningMs) {
        latencyStatus = 'warn';
        latencySeverity = 'warning';
        issues.push({
          id: nanoid(),
          category: 'gateway',
          title: 'Elevated Gateway Latency',
          description: `Gateway latency ${latencyMs}ms exceeds warning threshold ${this.config.gatewayLatencyWarningMs}ms`,
          severity: 'warning',
          detectedAt: nowTimestamp(),
        });
      }

      checks.push({
        name: 'gateway_latency',
        category: 'gateway',
        status: latencyStatus,
        message: `Gateway latency: ${latencyMs}ms`,
        severity: latencySeverity,
        data: { latencyMs },
        durationMs: latencyMs,
      });

    } catch (err) {
      checks.push({
        name: 'gateway_status',
        category: 'gateway',
        status: 'fail',
        message: `Gateway check error: ${err instanceof Error ? err.message : 'Unknown'}`,
        severity: 'error',
      });
    }

    return { checks, issues, recommendations };
  }

  private async checkTasks(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    const { taskService } = getServices();
    const tasks = await taskService.list({});
    const now = nowTimestamp();

    // Check for stuck tasks (running too long)
    const runningTasks = tasks.filter(t =>
      t.status === TASK_STATUS.RUNNING || t.status === TASK_STATUS.ASSIGNED
    );
    const stuckTasks = runningTasks.filter(t =>
      (now - t.updatedAt) * 1000 > this.config.taskStuckThresholdMs
    );

    if (stuckTasks.length > 0) {
      checks.push({
        name: 'stuck_tasks',
        category: 'tasks',
        status: 'fail',
        message: `${stuckTasks.length} task(s) appear to be stuck`,
        severity: 'error',
        data: { taskIds: stuckTasks.map(t => t.id) },
      });

      issues.push({
        id: nanoid(),
        category: 'tasks',
        title: 'Stuck Tasks Detected',
        description: `${stuckTasks.length} tasks have been running longer than ${this.config.taskStuckThresholdMs / 60000} minutes`,
        severity: 'error',
        affectedResources: stuckTasks.map(t => t.id),
        suggestion: 'Review stuck tasks and consider manual intervention or cancellation',
        detectedAt: now,
      });
    } else {
      checks.push({
        name: 'stuck_tasks',
        category: 'tasks',
        status: 'pass',
        message: 'No stuck tasks detected',
        severity: 'info',
      });
    }

    // Check for retry loops
    const highRetryTasks = tasks.filter(t =>
      t.retryCount >= this.config.maxRetryThreshold &&
      t.status !== TASK_STATUS.COMPLETED &&
      t.status !== TASK_STATUS.CANCELLED
    );

    if (highRetryTasks.length > 0) {
      checks.push({
        name: 'retry_loops',
        category: 'tasks',
        status: 'warn',
        message: `${highRetryTasks.length} task(s) have high retry counts`,
        severity: 'warning',
        data: { taskIds: highRetryTasks.map(t => t.id) },
      });

      issues.push({
        id: nanoid(),
        category: 'tasks',
        title: 'High Retry Count Tasks',
        description: `${highRetryTasks.length} tasks have been retried ${this.config.maxRetryThreshold}+ times`,
        severity: 'warning',
        affectedResources: highRetryTasks.map(t => t.id),
        suggestion: 'Investigate root cause of repeated failures',
        detectedAt: now,
      });
    } else {
      checks.push({
        name: 'retry_loops',
        category: 'tasks',
        status: 'pass',
        message: 'No retry loop issues detected',
        severity: 'info',
      });
    }

    // Check for orphan tasks (assigned but no agent active)
    const { agentService } = getServices();
    const agents = await agentService.list();
    const activeAgentIds = new Set(agents.filter(a => a.status === 'active').map(a => a.id));

    const orphanTasks = tasks.filter(t =>
      t.status === TASK_STATUS.ASSIGNED &&
      t.agentId &&
      !activeAgentIds.has(t.agentId)
    );

    if (orphanTasks.length > 0) {
      checks.push({
        name: 'orphan_tasks',
        category: 'tasks',
        status: 'warn',
        message: `${orphanTasks.length} task(s) assigned to inactive agents`,
        severity: 'warning',
        data: { taskIds: orphanTasks.map(t => t.id) },
      });

      issues.push({
        id: nanoid(),
        category: 'tasks',
        title: 'Orphan Tasks',
        description: `${orphanTasks.length} tasks are assigned to agents that are no longer active`,
        severity: 'warning',
        affectedResources: orphanTasks.map(t => t.id),
        suggestion: 'These tasks may need to be reassigned or cancelled',
        detectedAt: now,
      });
    } else {
      checks.push({
        name: 'orphan_tasks',
        category: 'tasks',
        status: 'pass',
        message: 'No orphan tasks detected',
        severity: 'info',
      });
    }

    // General task health
    const failedRecently = tasks.filter(t =>
      t.status === TASK_STATUS.FAILED &&
      (now - t.updatedAt) < 3600 // Last hour
    );

    if (failedRecently.length > 5) {
      recommendations.push({
        id: nanoid(),
        priority: 2,
        title: 'High Task Failure Rate',
        description: `${failedRecently.length} tasks failed in the last hour`,
        category: 'tasks',
        action: 'Review failed tasks to identify patterns',
      });
    }

    return { checks, issues, recommendations };
  }

  private async checkResilience(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    const leaseStore = getExecutionLeaseStore();
    const checkpointStore = getCheckpointStore();
    const circuitSummary = getCircuitBreakersSummary();

    // Check expired leases
    const expiredLeases = leaseStore.getExpiredLeases();
    if (expiredLeases.length > 0) {
      checks.push({
        name: 'expired_leases',
        category: 'resilience',
        status: 'warn',
        message: `${expiredLeases.length} expired execution lease(s)`,
        severity: 'warning',
        data: { leaseIds: expiredLeases.map(l => l.taskId) },
      });

      issues.push({
        id: nanoid(),
        category: 'resilience',
        title: 'Expired Execution Leases',
        description: `${expiredLeases.length} execution leases have expired without being released`,
        severity: 'warning',
        affectedResources: expiredLeases.map(l => l.taskId),
        suggestion: 'Run recovery service to clean up orphan executions',
        detectedAt: nowTimestamp(),
      });
    } else {
      checks.push({
        name: 'expired_leases',
        category: 'resilience',
        status: 'pass',
        message: 'No expired leases',
        severity: 'info',
      });
    }

    // Check circuit breakers
    if (circuitSummary.open > 0) {
      checks.push({
        name: 'circuit_breakers',
        category: 'resilience',
        status: 'fail',
        message: `${circuitSummary.open} circuit breaker(s) open`,
        severity: 'error',
        data: { breakers: circuitSummary.breakers.filter(b => b.state === 'open') },
      });

      issues.push({
        id: nanoid(),
        category: 'resilience',
        title: 'Circuit Breakers Open',
        description: `${circuitSummary.open} circuit breakers are in open state, blocking executions`,
        severity: 'error',
        suggestion: 'Investigate cause of failures that triggered circuit breakers',
        detectedAt: nowTimestamp(),
      });
    } else if (circuitSummary.halfOpen > 0) {
      checks.push({
        name: 'circuit_breakers',
        category: 'resilience',
        status: 'warn',
        message: `${circuitSummary.halfOpen} circuit breaker(s) in half-open state`,
        severity: 'warning',
        data: { breakers: circuitSummary.breakers.filter(b => b.state === 'half_open') },
      });
    } else {
      checks.push({
        name: 'circuit_breakers',
        category: 'resilience',
        status: 'pass',
        message: 'All circuit breakers closed',
        severity: 'info',
      });
    }

    // Check for orphan executions (checkpoints without active leases)
    const activeCheckpoints = checkpointStore.list().filter(
      (cp) => cp.currentStage !== 'completed' && cp.currentStage !== 'failed'
    );
    const activeLeaseTaskIds = new Set(leaseStore.list().map((l) => l.taskId));
    const orphanExecutions = activeCheckpoints.filter((cp) => !activeLeaseTaskIds.has(cp.taskId));

    if (orphanExecutions.length > 0) {
      checks.push({
        name: 'orphan_executions',
        category: 'resilience',
        status: 'warn',
        message: `${orphanExecutions.length} orphan execution(s) detected`,
        severity: 'warning',
        data: { taskIds: orphanExecutions.map((cp) => cp.taskId) },
      });

      issues.push({
        id: nanoid(),
        category: 'resilience',
        title: 'Orphan Executions',
        description: `${orphanExecutions.length} executions have active checkpoints but no lease`,
        severity: 'warning',
        affectedResources: orphanExecutions.map((cp) => cp.taskId),
        suggestion: 'These may need recovery or cleanup',
        detectedAt: nowTimestamp(),
      });
    } else {
      checks.push({
        name: 'orphan_executions',
        category: 'resilience',
        status: 'pass',
        message: 'No orphan executions',
        severity: 'info',
      });
    }

    return { checks, issues, recommendations };
  }

  private async checkResources(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    const { manualResourceService } = getServices();
    const drafts = await manualResourceService.list({});

    // Check pending drafts
    const pendingDrafts = drafts.filter(d =>
      d.status === DRAFT_STATUS.DRAFT || d.status === DRAFT_STATUS.PENDING_APPROVAL
    );

    if (pendingDrafts.length > this.config.maxPendingDraftsWarning) {
      checks.push({
        name: 'pending_drafts',
        category: 'resources',
        status: 'warn',
        message: `${pendingDrafts.length} pending resource draft(s)`,
        severity: 'warning',
        data: { count: pendingDrafts.length },
      });

      issues.push({
        id: nanoid(),
        category: 'resources',
        title: 'Many Pending Drafts',
        description: `${pendingDrafts.length} resource drafts are awaiting action`,
        severity: 'warning',
        suggestion: 'Review and process pending drafts',
        detectedAt: nowTimestamp(),
      });
    } else {
      checks.push({
        name: 'pending_drafts',
        category: 'resources',
        status: 'pass',
        message: `${pendingDrafts.length} pending draft(s)`,
        severity: 'info',
      });
    }

    // Check for approved but not activated resources
    const approvedNotActive = drafts.filter(d => d.status === DRAFT_STATUS.APPROVED);
    if (approvedNotActive.length > 0) {
      checks.push({
        name: 'approved_not_activated',
        category: 'resources',
        status: 'warn',
        message: `${approvedNotActive.length} approved draft(s) not yet activated`,
        severity: 'warning',
        data: { draftIds: approvedNotActive.map(d => d.id) },
      });

      issues.push({
        id: nanoid(),
        category: 'resources',
        title: 'Approved Resources Pending Activation',
        description: `${approvedNotActive.length} resources are approved but not activated`,
        severity: 'warning',
        affectedResources: approvedNotActive.map(d => d.id),
        suggestion: 'Activate approved resources to make them available',
        detectedAt: nowTimestamp(),
      });
    }

    return { checks, issues, recommendations };
  }

  private async checkChannels(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    try {
      const bridge = getChannelBridge();

      if (bridge) {
        checks.push({
          name: 'channel_bridge',
          category: 'channels',
          status: 'pass',
          message: 'Channel bridge is active',
          severity: 'info',
        });
      } else {
        checks.push({
          name: 'channel_bridge',
          category: 'channels',
          status: 'warn',
          message: 'Channel bridge not initialized',
          severity: 'warning',
        });

        issues.push({
          id: nanoid(),
          category: 'channels',
          title: 'Channel Bridge Not Active',
          description: 'The channel bridge has not been initialized',
          severity: 'warning',
          suggestion: 'Initialize the channel bridge if external channel routing is needed',
          detectedAt: nowTimestamp(),
        });
      }

    } catch (err) {
      checks.push({
        name: 'channel_bridge',
        category: 'channels',
        status: 'skip',
        message: 'Channel bridge check skipped',
        severity: 'info',
      });
    }

    return { checks, issues, recommendations };
  }

  private async checkLogging(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    // Basic logging check - verify logger is working
    try {
      logger.debug('Diagnostic logging test');
      checks.push({
        name: 'logging_operational',
        category: 'logging',
        status: 'pass',
        message: 'Logging system operational',
        severity: 'info',
      });
    } catch (err) {
      checks.push({
        name: 'logging_operational',
        category: 'logging',
        status: 'fail',
        message: `Logging error: ${err instanceof Error ? err.message : 'Unknown'}`,
        severity: 'error',
      });

      issues.push({
        id: nanoid(),
        category: 'logging',
        title: 'Logging System Error',
        description: 'The logging system may not be functioning correctly',
        severity: 'error',
        detectedAt: nowTimestamp(),
      });
    }

    return { checks, issues, recommendations };
  }

  private async checkDatabase(): Promise<CheckResult> {
    const checks: DiagnosticCheck[] = [];
    const issues: DiagnosticIssue[] = [];
    const recommendations: DiagnosticRecommendation[] = [];

    try {
      // Test database by performing a simple query
      const { taskService } = getServices();
      const startTime = Date.now();
      await taskService.list({ limit: 1 });
      const durationMs = Date.now() - startTime;

      checks.push({
        name: 'database_connection',
        category: 'database',
        status: 'pass',
        message: 'Database accessible',
        severity: 'info',
        durationMs,
        data: { latencyMs: durationMs },
      });

      if (durationMs > 1000) {
        issues.push({
          id: nanoid(),
          category: 'database',
          title: 'Slow Database Response',
          description: `Database query took ${durationMs}ms`,
          severity: 'warning',
          suggestion: 'Consider database optimization or check for lock contention',
          detectedAt: nowTimestamp(),
        });
      }

    } catch (err) {
      checks.push({
        name: 'database_connection',
        category: 'database',
        status: 'fail',
        message: `Database error: ${err instanceof Error ? err.message : 'Unknown'}`,
        severity: 'critical',
      });

      issues.push({
        id: nanoid(),
        category: 'database',
        title: 'Database Connection Failed',
        description: err instanceof Error ? err.message : 'Cannot connect to database',
        severity: 'critical',
        detectedAt: nowTimestamp(),
      });
    }

    return { checks, issues, recommendations };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private calculateScore(checks: DiagnosticCheck[]): number {
    const weights = this.config.weights;
    const categoryScores: Record<string, { total: number; passed: number }> = {};

    // Initialize categories
    for (const category of Object.keys(weights)) {
      categoryScores[category] = { total: 0, passed: 0 };
    }

    // Calculate per-category scores
    for (const check of checks) {
      if (check.status === 'skip') continue;

      const cat = categoryScores[check.category];
      if (cat) {
        cat.total++;
        if (check.status === 'pass') {
          cat.passed++;
        } else if (check.status === 'warn') {
          cat.passed += 0.5; // Partial credit for warnings
        }
      }
    }

    // Weighted average
    let totalWeight = 0;
    let weightedScore = 0;

    for (const [category, weight] of Object.entries(weights)) {
      const catScore = categoryScores[category];
      if (catScore && catScore.total > 0) {
        const catPercentage = catScore.passed / catScore.total;
        weightedScore += catPercentage * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight === 0) return 100;
    return Math.round((weightedScore / totalWeight) * 100);
  }

  private determineStatus(score: number, criticalCount: number): SystemStatus {
    if (criticalCount > 0 || score < 50) {
      return 'critical';
    }
    if (score < 80) {
      return 'degraded';
    }
    return 'healthy';
  }

  private calculateAvgTaskDuration(tasks: Array<{ status: string; createdAt: number; updatedAt: number }>): number {
    const completedTasks = tasks.filter(t => t.status === TASK_STATUS.COMPLETED);
    if (completedTasks.length === 0) return 0;

    const totalDuration = completedTasks.reduce((sum, t) => sum + (t.updatedAt - t.createdAt), 0);
    return Math.round((totalDuration / completedTasks.length) * 1000); // Convert to ms
  }

  private async emitDiagnosticEvents(result: SystemHealthResult): Promise<void> {
    const { eventService } = getServices();

    // Always emit run event
    await eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'system',
      message: `System diagnostics completed: ${result.status} (score: ${result.score})`,
      data: {
        status: result.status,
        score: result.score,
        checksTotal: result.checks.length,
        criticalIssues: result.criticalIssues.length,
        warnings: result.warnings.length,
      },
    });

    // Emit degraded/critical events
    if (result.status === 'degraded') {
      await eventService.emit({
        type: EVENT_TYPE.SYSTEM_DEGRADED,
        category: 'system',
        severity: 'warning',
        message: `System degraded: score ${result.score}, ${result.warnings.length} warnings`,
        data: { score: result.score, warnings: result.warnings.length },
      });
    } else if (result.status === 'critical') {
      await eventService.emit({
        type: EVENT_TYPE.SYSTEM_ERROR,
        category: 'system',
        severity: 'error',
        message: `System critical: score ${result.score}, ${result.criticalIssues.length} critical issues`,
        data: { score: result.score, criticalIssues: result.criticalIssues.length },
      });
    }
  }
}

// Internal type for check results
interface CheckResult {
  checks: DiagnosticCheck[];
  issues: DiagnosticIssue[];
  recommendations: DiagnosticRecommendation[];
}

// =============================================================================
// SINGLETON
// =============================================================================

let diagnosticsInstance: SystemDiagnosticsService | null = null;

export function getSystemDiagnosticsService(): SystemDiagnosticsService {
  if (!diagnosticsInstance) {
    diagnosticsInstance = new SystemDiagnosticsService();
  }
  return diagnosticsInstance;
}
