/**
 * Runtime Information Module
 *
 * Provides system runtime metadata for observability and diagnostics.
 * Detects environment issues early and exposes build/version info.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Startup timestamp
const STARTUP_TIME = Date.now();

// Cache for expensive operations
let cachedGitInfo: GitInfo | null = null;
let cachedEnvCheck: EnvironmentCheck | null = null;

export interface RuntimeInfo {
  app: {
    name: string;
    version: string;
    environment: string;
  };
  build: {
    timestamp: number | null;
    commitHash: string | null;
    commitDate: string | null;
    branch: string | null;
    dirty: boolean;
  };
  process: {
    pid: number;
    uptime: number;
    uptimeHuman: string;
    startedAt: number;
    nodeVersion: string;
    platform: string;
    arch: string;
    cwd: string;
  };
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
}

export interface GitInfo {
  commitHash: string | null;
  commitDate: string | null;
  branch: string | null;
  dirty: boolean;
}

export interface EnvironmentCheck {
  timestamp: number;
  checks: EnvironmentCheckItem[];
  healthy: boolean;
  criticalIssues: string[];
  warnings: string[];
}

export interface EnvironmentCheckItem {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Get package.json info
 */
function getPackageInfo(): { name: string; version: string } {
  try {
    // Navigate from dist/utils/runtime.js or src/utils/runtime.ts
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Try multiple paths (dev vs production)
    const paths = [
      join(__dirname, '../../package.json'),      // from src/utils
      join(__dirname, '../../../package.json'),   // from dist/utils
      join(process.cwd(), 'package.json'),        // cwd
    ];

    for (const p of paths) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        return { name: pkg.name || 'ocaas-backend', version: pkg.version || '0.0.0' };
      }
    }
  } catch {
    // Ignore
  }
  return { name: '@ocaas/backend', version: '1.0.0' };
}

/**
 * Get Git info (cached)
 */
function getGitInfo(): GitInfo {
  if (cachedGitInfo) return cachedGitInfo;

  const info: GitInfo = {
    commitHash: null,
    commitDate: null,
    branch: null,
    dirty: false,
  };

  try {
    // Check if in git repo
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });

    // Get commit hash
    info.commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

    // Get commit date
    info.commitDate = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim();

    // Get branch
    info.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();

    // Check if dirty
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    info.dirty = status.length > 0;
  } catch {
    // Not in git repo or git not available
  }

  cachedGitInfo = info;
  return info;
}

/**
 * Get build timestamp from dist directory
 */
function getBuildTimestamp(): number | null {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Check if running from dist
    if (__dirname.includes('dist')) {
      const distIndex = join(__dirname, '../index.js');
      if (existsSync(distIndex)) {
        return statSync(distIndex).mtime.getTime();
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Format uptime to human readable
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Get current runtime info
 */
export function getRuntimeInfo(): RuntimeInfo {
  const pkg = getPackageInfo();
  const git = getGitInfo();
  const mem = process.memoryUsage();
  const uptimeMs = Date.now() - STARTUP_TIME;

  return {
    app: {
      name: pkg.name,
      version: pkg.version,
      environment: process.env.NODE_ENV || 'development',
    },
    build: {
      timestamp: getBuildTimestamp(),
      commitHash: git.commitHash,
      commitDate: git.commitDate,
      branch: git.branch,
      dirty: git.dirty,
    },
    process: {
      pid: process.pid,
      uptime: uptimeMs,
      uptimeHuman: formatUptime(uptimeMs),
      startedAt: STARTUP_TIME,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    },
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
      rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
    },
  };
}

/**
 * Check if a command exists in PATH
 */
function commandExists(cmd: string): { exists: boolean; path?: string; version?: string } {
  try {
    // Windows uses 'where', Unix uses 'which'
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const path = execSync(`${whichCmd} ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];

    // Try to get version
    let version: string | undefined;
    try {
      version = execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
    } catch {
      // Some commands don't support --version
    }

    return { exists: true, path, version };
  } catch {
    return { exists: false };
  }
}

/**
 * Run environment checks
 */
export function checkEnvironment(forceRefresh = false): EnvironmentCheck {
  if (cachedEnvCheck && !forceRefresh) {
    // Return cached if less than 5 minutes old
    if (Date.now() - cachedEnvCheck.timestamp < 5 * 60 * 1000) {
      return cachedEnvCheck;
    }
  }

  const checks: EnvironmentCheckItem[] = [];
  const criticalIssues: string[] = [];
  const warnings: string[] = [];

  // 1. Check Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0] || '0', 10);

  if (nodeMajor < 18) {
    checks.push({
      name: 'node_version',
      status: 'error',
      message: `Node.js ${nodeVersion} is too old. Minimum required: v18.0.0`,
      details: { version: nodeVersion, required: '>=18.0.0' },
    });
    criticalIssues.push(`Node.js ${nodeVersion} is below minimum required version (18.0.0)`);
  } else if (nodeMajor >= 24) {
    checks.push({
      name: 'node_version',
      status: 'warning',
      message: `Node.js ${nodeVersion} may have compatibility issues with native modules`,
      details: { version: nodeVersion, recommended: '20.x or 22.x' },
    });
    warnings.push(`Node.js ${nodeVersion} may have native module compatibility issues`);
  } else {
    checks.push({
      name: 'node_version',
      status: 'ok',
      message: `Node.js ${nodeVersion}`,
      details: { version: nodeVersion },
    });
  }

  // 2. Check if node command exists in PATH (for script tools)
  const nodeCmd = commandExists('node');
  if (!nodeCmd.exists) {
    checks.push({
      name: 'node_in_path',
      status: 'error',
      message: 'Node.js not found in PATH. Script tools will fail.',
    });
    criticalIssues.push('Node.js not in PATH - script tools cannot execute');
  } else {
    checks.push({
      name: 'node_in_path',
      status: 'ok',
      message: 'Node.js available in PATH',
      details: { path: nodeCmd.path, version: nodeCmd.version },
    });
  }

  // 3. Check npm (for potential package operations)
  const npmCmd = commandExists('npm');
  if (!npmCmd.exists) {
    checks.push({
      name: 'npm_in_path',
      status: 'warning',
      message: 'npm not found in PATH',
    });
    warnings.push('npm not in PATH');
  } else {
    checks.push({
      name: 'npm_in_path',
      status: 'ok',
      message: 'npm available',
      details: { version: npmCmd.version },
    });
  }

  // 4. Check git (for version tracking)
  const gitCmd = commandExists('git');
  if (!gitCmd.exists) {
    checks.push({
      name: 'git_in_path',
      status: 'warning',
      message: 'git not found in PATH. Version tracking unavailable.',
    });
    warnings.push('git not in PATH - version tracking disabled');
  } else {
    checks.push({
      name: 'git_in_path',
      status: 'ok',
      message: 'git available',
      details: { version: gitCmd.version },
    });
  }

  // 5. Check working directory
  const cwd = process.cwd();
  const cwdExists = existsSync(cwd);
  if (!cwdExists) {
    checks.push({
      name: 'working_directory',
      status: 'error',
      message: `Working directory does not exist: ${cwd}`,
    });
    criticalIssues.push(`Working directory invalid: ${cwd}`);
  } else {
    checks.push({
      name: 'working_directory',
      status: 'ok',
      message: cwd,
    });
  }

  // 6. Check environment variables
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') {
    // In production, check for common misconfigurations
    if (!process.env.PORT) {
      checks.push({
        name: 'port_config',
        status: 'warning',
        message: 'PORT not set, using default',
      });
      warnings.push('PORT environment variable not set');
    }
  }
  checks.push({
    name: 'environment',
    status: 'ok',
    message: `Running in ${env} mode`,
    details: { NODE_ENV: env },
  });

  // 7. Check if running from dist vs src
  const __filename = fileURLToPath(import.meta.url);
  const isFromDist = __filename.includes('dist');
  checks.push({
    name: 'build_mode',
    status: 'ok',
    message: isFromDist ? 'Running from compiled dist/' : 'Running from source (tsx/ts-node)',
    details: { compiled: isFromDist },
  });

  const result: EnvironmentCheck = {
    timestamp: Date.now(),
    checks,
    healthy: criticalIssues.length === 0,
    criticalIssues,
    warnings,
  };

  cachedEnvCheck = result;
  return result;
}

/**
 * Get compact runtime summary for health endpoint
 */
export function getRuntimeSummary(): {
  version: string;
  environment: string;
  uptime: string;
  nodeVersion: string;
  pid: number;
  commit: string | null;
  healthy: boolean;
} {
  const info = getRuntimeInfo();
  const envCheck = checkEnvironment();

  return {
    version: info.app.version,
    environment: info.app.environment,
    uptime: info.process.uptimeHuman,
    nodeVersion: info.process.nodeVersion,
    pid: info.process.pid,
    commit: info.build.commitHash,
    healthy: envCheck.healthy,
  };
}
