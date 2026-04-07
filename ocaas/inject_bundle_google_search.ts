/**
 * PROMPT 12: Operational test script - Bundle creation via SystemicGenerator
 *
 * Usage: cd backend && npx tsx ../inject_bundle_google_search.ts
 */

// Load environment
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to load .env from backend directory
const envPaths = [
  resolve(__dirname, 'backend', '.env'),
  resolve(__dirname, '.env'),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
    break;
  }
}

// =============================================================================
// ENVIRONMENT VALIDATION (PROMPT 12)
// =============================================================================

function validateEnv(): boolean {
  const errors: string[] = [];

  // Required for bundle generation (uses AI)
  if (!process.env.OPENCLAW_API_KEY) {
    errors.push('Missing OPENCLAW_API_KEY - required for AI-based generation');
  }

  // Gateway URL (optional but recommended)
  if (!process.env.OPENCLAW_GATEWAY_URL) {
    console.warn('⚠️  OPENCLAW_GATEWAY_URL not set - using default');
  }

  if (errors.length > 0) {
    console.error('❌ Environment validation failed:');
    for (const err of errors) {
      console.error(`   - ${err}`);
    }
    return false;
  }

  return true;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('🔍 Validating environment...');

  if (!validateEnv()) {
    process.exit(1);
  }

  console.log('✅ Environment OK');
  console.log('');

  // Dynamic import to allow env to be loaded first
  const { getSystemicGenerator } = await import('./backend/src/generator/SystemicGeneratorService.js');

  const systemicGen = getSystemicGenerator();

  console.log('🚀 Creating bundle: google-first-result-search');
  console.log('');

  const result = await systemicGen.generateBundle({
    name: 'google-first-result-search',
    description: 'Search Google and return first result',
    objective: 'Given a query, return the first organic result from Google search',
    capabilities: ['web-search', 'scraping'],
  });

  if (!result.success) {
    console.error('❌ Bundle creation failed:', result.error);
    process.exit(1);
  }

  console.log('✅ Bundle created successfully!');
  console.log('');
  console.log('📦 Results:');
  console.log(`   Tool ID:  ${result.toolId}`);
  console.log(`   Skill ID: ${result.skillId}`);
  console.log(`   Agent ID: ${result.agentId}`);
  console.log('');

  // Show bundleId if present
  if (result.bundleId) {
    console.log(`   Bundle ID: ${result.bundleId}`);
    console.log(`   Bundle Status: ${result.bundleStatus || 'complete'}`);
  }
}

main().catch(err => {
  console.error('❌ Script error:', err.message || err);
  process.exit(1);
});
