/**
 * GenerationContentPanel
 *
 * Displays generated content specialized by type (agent/skill/tool).
 * Shows structured view for known fields + raw JSON for extras.
 */

import { useState } from 'react';
import {
  Bot,
  Sparkles,
  Wrench,
  FileCode,
  Code,
  Eye,
  Copy,
  Check,
} from 'lucide-react';
import { Button, Badge } from '../ui';
import type { Generation, GenerationType } from '../../types';

interface GenerationContentPanelProps {
  generation: Generation;
}

type ViewMode = 'structured' | 'raw';

// =============================================================================
// TYPE-SPECIFIC CONTENT SHAPES
// =============================================================================

interface AgentContent {
  name?: string;
  description?: string;
  type?: string;
  capabilities?: string[];
  config?: Record<string, unknown>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

interface SkillContent {
  name?: string;
  description?: string;
  version?: string;
  capabilities?: string[];
  requirements?: string[];
  markdown?: string;
  content?: string;
}

interface ToolContent {
  name?: string;
  description?: string;
  version?: string;
  type?: string;
  code?: string;
  script?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

// =============================================================================
// HELPERS
// =============================================================================

function extractAgentContent(content: Record<string, unknown>): AgentContent {
  return {
    name: content.name as string | undefined,
    description: content.description as string | undefined,
    type: content.type as string | undefined,
    capabilities: content.capabilities as string[] | undefined,
    config: content.config as Record<string, unknown> | undefined,
    systemPrompt: content.systemPrompt as string | undefined,
    maxTokens: content.maxTokens as number | undefined,
    temperature: content.temperature as number | undefined,
  };
}

function extractSkillContent(content: Record<string, unknown>): SkillContent {
  return {
    name: content.name as string | undefined,
    description: content.description as string | undefined,
    version: content.version as string | undefined,
    capabilities: content.capabilities as string[] | undefined,
    requirements: content.requirements as string[] | undefined,
    markdown: content.markdown as string | undefined,
    content: content.content as string | undefined,
  };
}

function extractToolContent(content: Record<string, unknown>): ToolContent {
  return {
    name: content.name as string | undefined,
    description: content.description as string | undefined,
    version: content.version as string | undefined,
    type: content.type as string | undefined,
    code: content.code as string | undefined,
    script: content.script as string | undefined,
    inputSchema: content.inputSchema as Record<string, unknown> | undefined,
    outputSchema: content.outputSchema as Record<string, unknown> | undefined,
    config: content.config as Record<string, unknown> | undefined,
  };
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function FieldRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | undefined;
  mono?: boolean;
}) {
  if (value === undefined || value === null || value === '') return null;

  return (
    <div className="py-2 px-3 bg-dark-900 rounded">
      <span className="text-xs text-dark-400 block mb-1">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono text-dark-300' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function CapabilitiesList({
  capabilities,
  label = 'Capabilities',
}: {
  capabilities: string[] | undefined;
  label?: string;
}) {
  if (!capabilities || capabilities.length === 0) return null;

  return (
    <div className="py-2 px-3 bg-dark-900 rounded">
      <span className="text-xs text-dark-400 block mb-2">{label}</span>
      <div className="flex flex-wrap gap-1">
        {capabilities.map((cap, i) => (
          <Badge key={i} variant="default" className="text-xs">
            {cap}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function CodeBlock({
  code,
  language = 'text',
  label,
}: {
  code: string | undefined;
  language?: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="py-2 px-3 bg-dark-900 rounded">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-dark-400">{label}</span>
        <Button variant="ghost" size="sm" onClick={copyToClipboard}>
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </Button>
      </div>
      <pre className={`text-xs font-mono bg-dark-800 p-3 rounded overflow-auto max-h-64 ${
        language === 'json' ? 'text-primary-300' :
        language === 'markdown' ? 'text-purple-300' :
        'text-green-300'
      }`}>
        {code}
      </pre>
    </div>
  );
}

function JsonBlock({ data, label }: { data: Record<string, unknown>; label: string }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data, null, 2);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="py-2 px-3 bg-dark-900 rounded">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-dark-400">{label}</span>
        <Button variant="ghost" size="sm" onClick={copyToClipboard}>
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </Button>
      </div>
      <pre className="text-xs font-mono bg-dark-800 p-3 rounded overflow-auto max-h-48 text-primary-300">
        {json}
      </pre>
    </div>
  );
}

// Type-specific views
function AgentContentView({ content }: { content: AgentContent }) {
  return (
    <div className="space-y-2">
      <FieldRow label="Name" value={content.name} />
      <FieldRow label="Description" value={content.description} />
      <FieldRow label="Type" value={content.type} />
      <CapabilitiesList capabilities={content.capabilities} />
      {content.systemPrompt && (
        <CodeBlock code={content.systemPrompt} label="System Prompt" language="text" />
      )}
      <FieldRow label="Max Tokens" value={content.maxTokens} mono />
      <FieldRow label="Temperature" value={content.temperature} mono />
      {content.config && Object.keys(content.config).length > 0 && (
        <JsonBlock data={content.config} label="Config" />
      )}
    </div>
  );
}

function SkillContentView({ content }: { content: SkillContent }) {
  const markdownContent = content.markdown || content.content;

  return (
    <div className="space-y-2">
      <FieldRow label="Name" value={content.name} />
      <FieldRow label="Description" value={content.description} />
      <FieldRow label="Version" value={content.version} mono />
      <CapabilitiesList capabilities={content.capabilities} />
      <CapabilitiesList capabilities={content.requirements} label="Requirements" />
      {markdownContent && (
        <CodeBlock code={markdownContent} label="Skill Content (Markdown)" language="markdown" />
      )}
    </div>
  );
}

function ToolContentView({ content }: { content: ToolContent }) {
  const codeContent = content.code || content.script;

  return (
    <div className="space-y-2">
      <FieldRow label="Name" value={content.name} />
      <FieldRow label="Description" value={content.description} />
      <FieldRow label="Version" value={content.version} mono />
      <FieldRow label="Type" value={content.type} />
      {codeContent && (
        <CodeBlock code={codeContent} label="Tool Code" language="code" />
      )}
      {content.inputSchema && Object.keys(content.inputSchema).length > 0 && (
        <JsonBlock data={content.inputSchema} label="Input Schema" />
      )}
      {content.outputSchema && Object.keys(content.outputSchema).length > 0 && (
        <JsonBlock data={content.outputSchema} label="Output Schema" />
      )}
      {content.config && Object.keys(content.config).length > 0 && (
        <JsonBlock data={content.config} label="Config" />
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const typeIcons: Record<GenerationType, React.ElementType> = {
  agent: Bot,
  skill: Sparkles,
  tool: Wrench,
};

const typeColors: Record<GenerationType, string> = {
  agent: 'text-primary-400',
  skill: 'text-purple-400',
  tool: 'text-orange-400',
};

export function GenerationContentPanel({ generation }: GenerationContentPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('structured');
  const content = generation.generatedContent;

  if (!content) {
    return (
      <div className="text-center py-6">
        <FileCode className="w-8 h-8 text-dark-500 mx-auto mb-2" />
        <p className="text-dark-400 text-sm">No generated content available</p>
      </div>
    );
  }

  const Icon = typeIcons[generation.type];
  const color = typeColors[generation.type];
  const contentJson = JSON.stringify(content, null, 2);

  const renderStructuredView = () => {
    switch (generation.type) {
      case 'agent':
        return <AgentContentView content={extractAgentContent(content)} />;
      case 'skill':
        return <SkillContentView content={extractSkillContent(content)} />;
      case 'tool':
        return <ToolContentView content={extractToolContent(content)} />;
      default:
        return <JsonBlock data={content} label="Content" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-sm font-medium capitalize">
            {generation.type} Content
          </span>
        </div>
        <div className="flex items-center gap-1 bg-dark-800 rounded p-0.5">
          <Button
            variant={viewMode === 'structured' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('structured')}
            className="px-2 py-1 text-xs"
          >
            <Eye className="w-3 h-3 mr-1" />
            Structured
          </Button>
          <Button
            variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('raw')}
            className="px-2 py-1 text-xs"
          >
            <Code className="w-3 h-3 mr-1" />
            Raw
          </Button>
        </div>
      </div>

      {/* Content view */}
      {viewMode === 'structured' ? (
        renderStructuredView()
      ) : (
        <pre className="text-xs font-mono bg-dark-900 p-4 rounded overflow-auto max-h-96 text-primary-300">
          {contentJson}
        </pre>
      )}
    </div>
  );
}
