import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { nowTimestamp } from '../utils/helpers.js';

const logger = createLogger('WorkspaceSync');

const SKILL_REQUIRED_FILES = ['SKILL.md', 'agent-instructions.md'];

export interface SyncResult {
  success: boolean;
  synced: string[];
  errors: string[];
}

export class WorkspaceSync {
  private workspacePath: string;
  private skillsPath: string;
  private toolsPath: string;

  constructor() {
    this.workspacePath = config.openclaw.workspacePath;
    this.skillsPath = join(this.workspacePath, 'skills');
    this.toolsPath = join(this.workspacePath, 'tools');
  }

  ensureDirectories(): void {
    if (!existsSync(this.workspacePath)) {
      mkdirSync(this.workspacePath, { recursive: true });
    }
    if (!existsSync(this.skillsPath)) {
      mkdirSync(this.skillsPath, { recursive: true });
    }
    if (!existsSync(this.toolsPath)) {
      mkdirSync(this.toolsPath, { recursive: true });
    }
  }

  async discoverSkills(): Promise<SyncResult> {
    const result: SyncResult = { success: true, synced: [], errors: [] };

    if (!existsSync(this.skillsPath)) {
      return result;
    }

    const { skillService } = getServices();
    const entries = readdirSync(this.skillsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(this.skillsPath, entry.name);
      const name = entry.name;

      // Validate structure
      const hasRequired = SKILL_REQUIRED_FILES.every(file =>
        existsSync(join(skillPath, file))
      );

      if (!hasRequired) {
        result.errors.push(`Skill '${name}' missing required files`);
        continue;
      }

      try {
        // Read skill metadata
        const skillMd = readFileSync(join(skillPath, 'SKILL.md'), 'utf-8');
        const description = this.extractDescription(skillMd);

        // Check if exists in DB
        const existing = await skillService.getByName(name);

        if (existing) {
          await skillService.markSynced(existing.id);
        } else {
          await skillService.create({
            name,
            description,
            path: skillPath,
          });
        }

        result.synced.push(name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Skill '${name}': ${msg}`);
      }
    }

    logger.info({ synced: result.synced.length, errors: result.errors.length }, 'Skills sync completed');
    return result;
  }

  async discoverTools(): Promise<SyncResult> {
    const result: SyncResult = { success: true, synced: [], errors: [] };

    if (!existsSync(this.toolsPath)) {
      return result;
    }

    const { toolService } = getServices();
    const entries = readdirSync(this.toolsPath, { withFileTypes: true });

    for (const entry of entries) {
      const toolPath = join(this.toolsPath, entry.name);
      const name = basename(entry.name, '.sh').replace(/\.py$/, '');

      try {
        const existing = await toolService.getByName(name);

        if (existing) {
          await toolService.markSynced(existing.id);
        } else {
          await toolService.create({
            name,
            path: toolPath,
            type: entry.name.endsWith('.py') ? 'script' : 'binary',
          });
        }

        result.synced.push(name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Tool '${name}': ${msg}`);
      }
    }

    logger.info({ synced: result.synced.length, errors: result.errors.length }, 'Tools sync completed');
    return result;
  }

  async writeSkill(name: string, files: Record<string, string>): Promise<string> {
    this.ensureDirectories();

    const skillPath = join(this.skillsPath, name);

    if (existsSync(skillPath)) {
      throw new Error(`Skill '${name}' already exists in workspace`);
    }

    mkdirSync(skillPath, { recursive: true });

    for (const [filename, content] of Object.entries(files)) {
      const filePath = join(skillPath, filename);
      const dir = join(skillPath, ...filename.split('/').slice(0, -1));
      if (dir !== skillPath && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, content, 'utf-8');
    }

    logger.info({ name, files: Object.keys(files) }, 'Skill written to workspace');
    return skillPath;
  }

  async writeTool(name: string, content: string, type: 'sh' | 'py' = 'sh'): Promise<string> {
    this.ensureDirectories();

    const filename = `${name}.${type}`;
    const toolPath = join(this.toolsPath, filename);

    if (existsSync(toolPath)) {
      throw new Error(`Tool '${name}' already exists in workspace`);
    }

    writeFileSync(toolPath, content, { mode: 0o755 });

    logger.info({ name, path: toolPath }, 'Tool written to workspace');
    return toolPath;
  }

  private extractDescription(markdown: string): string {
    const lines = markdown.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        return trimmed.slice(0, 200);
      }
    }
    return '';
  }

  async fullSync(): Promise<{ skills: SyncResult; tools: SyncResult }> {
    this.ensureDirectories();
    const skills = await this.discoverSkills();
    const tools = await this.discoverTools();
    return { skills, tools };
  }
}

let workspaceSyncInstance: WorkspaceSync | null = null;

export function getWorkspaceSync(): WorkspaceSync {
  if (!workspaceSyncInstance) {
    workspaceSyncInstance = new WorkspaceSync();
  }
  return workspaceSyncInstance;
}
