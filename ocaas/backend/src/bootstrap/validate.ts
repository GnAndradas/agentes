/**
 * OCAAS Startup Validation
 *
 * Validates critical environment and system state before starting.
 * Provides clear error messages for missing or invalid configuration.
 */

import { existsSync, accessSync, constants, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import net from 'net';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, host);
  });
}

/**
 * Validate required environment variables
 */
function validateEnvVars(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical: OPENCLAW_GATEWAY_URL
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  if (!gatewayUrl) {
    errors.push('OPENCLAW_GATEWAY_URL is not set. Required for OpenClaw integration.');
  } else {
    try {
      new URL(gatewayUrl);
    } catch {
      errors.push(`OPENCLAW_GATEWAY_URL is not a valid URL: ${gatewayUrl}`);
    }
  }

  // Critical: API_SECRET_KEY
  const apiKey = process.env.API_SECRET_KEY;
  if (!apiKey) {
    errors.push('API_SECRET_KEY is not set. Required for API authentication.');
  } else if (apiKey.length < 16) {
    errors.push(`API_SECRET_KEY must be at least 16 characters (current: ${apiKey.length})`);
  } else if (apiKey === 'dev-secret-key-min-16') {
    if (process.env.NODE_ENV === 'production') {
      errors.push('API_SECRET_KEY is using default value. Set a secure random value for production.');
    } else {
      warnings.push('API_SECRET_KEY is using default value. Acceptable for development.');
    }
  }

  // Warning: OPENCLAW_API_KEY
  if (!process.env.OPENCLAW_API_KEY) {
    warnings.push('OPENCLAW_API_KEY is not set. Some OpenClaw features may not work.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate database access
 */
function validateDatabase(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const dbPath = process.env.DATABASE_URL || './data/ocaas.db';
  const resolvedPath = resolve(process.cwd(), dbPath);
  const dbDir = dirname(resolvedPath);

  // Check if directory exists
  if (!existsSync(dbDir)) {
    try {
      mkdirSync(dbDir, { recursive: true });
      warnings.push(`Created database directory: ${dbDir}`);
    } catch (err) {
      errors.push(`Cannot create database directory: ${dbDir} - ${err instanceof Error ? err.message : 'unknown'}`);
      return { valid: false, errors, warnings };
    }
  }

  // Check directory is writable
  try {
    accessSync(dbDir, constants.W_OK);
  } catch {
    errors.push(`Database directory is not writable: ${dbDir}`);
  }

  // If DB exists, check it's readable/writable
  if (existsSync(resolvedPath)) {
    try {
      accessSync(resolvedPath, constants.R_OK | constants.W_OK);
    } catch {
      errors.push(`Database file is not accessible: ${resolvedPath}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate port availability
 */
async function validatePort(): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const port = parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '0.0.0.0';

  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: ${process.env.PORT}. Must be 1-65535.`);
    return { valid: false, errors, warnings };
  }

  const available = await isPortAvailable(port, host);
  if (!available) {
    errors.push(`Port ${port} is already in use on ${host}. Stop the existing process or use a different port.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate directories exist and are writable
 */
function validateDirectories(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredDirs = ['logs', 'data'];
  const baseDir = process.cwd();

  for (const dir of requiredDirs) {
    const fullPath = resolve(baseDir, dir);

    if (!existsSync(fullPath)) {
      try {
        mkdirSync(fullPath, { recursive: true });
        warnings.push(`Created directory: ${fullPath}`);
      } catch (err) {
        errors.push(`Cannot create required directory: ${fullPath} - ${err instanceof Error ? err.message : 'unknown'}`);
        continue;
      }
    }

    try {
      accessSync(fullPath, constants.W_OK);
    } catch {
      errors.push(`Directory is not writable: ${fullPath}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Run all startup validations
 */
export async function validateStartup(): Promise<ValidationResult> {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Validate environment variables
  const envResult = validateEnvVars();
  allErrors.push(...envResult.errors);
  allWarnings.push(...envResult.warnings);

  // Validate directories
  const dirResult = validateDirectories();
  allErrors.push(...dirResult.errors);
  allWarnings.push(...dirResult.warnings);

  // Validate database
  const dbResult = validateDatabase();
  allErrors.push(...dbResult.errors);
  allWarnings.push(...dbResult.warnings);

  // Validate port
  const portResult = await validatePort();
  allErrors.push(...portResult.errors);
  allWarnings.push(...portResult.warnings);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Run validation and exit if critical errors found
 */
export async function validateOrExit(logger?: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void }): Promise<void> {
  const log = logger || {
    info: console.log,
    error: console.error,
    warn: console.warn,
  };

  log.info('Validating startup configuration...');

  const result = await validateStartup();

  // Log warnings
  for (const warning of result.warnings) {
    log.warn(`[WARN] ${warning}`);
  }

  // Log errors and exit if any
  if (!result.valid) {
    log.error('\n=== STARTUP VALIDATION FAILED ===\n');
    for (const error of result.errors) {
      log.error(`[ERROR] ${error}`);
    }
    log.error('\nFix the above errors and restart.\n');
    process.exit(1);
  }

  log.info('Startup validation passed.');
}
