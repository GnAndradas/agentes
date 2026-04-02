/**
 * Skill Editor Component
 *
 * A comprehensive editor for creating and editing skills with
 * tool composition support.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Wrench,
  AlertCircle,
  Info,
} from 'lucide-react';
import { skillApi, toolApi } from '../../lib/api';
import {
  Button,
  Input,
  Textarea,
  Select,
  Badge,
} from '../ui';
import type {
  Skill,
  SkillStatus,
  SkillToolLink,
  SkillToolExpanded,
  Tool,
} from '../../types';

// =============================================================================
// TYPES
// =============================================================================

interface SkillEditorProps {
  skill?: Skill;
  onSave: (data: Partial<Skill>, tools?: SkillToolLink[]) => void;
  onCancel: () => void;
  loading?: boolean;
}

interface SkillFormData {
  name: string;
  description: string;
  version: string;
  path: string;
  status: SkillStatus;
  capabilities: string;
  requirements: string;
}

interface LinkedToolItem {
  toolId: string;
  orderIndex: number;
  required: boolean;
  role: string;
  tool?: Tool;
}

// =============================================================================
// OPTIONS
// =============================================================================

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'deprecated', label: 'Deprecated' },
];

// =============================================================================
// HELPERS
// =============================================================================

function parseArrayField(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function formatArrayField(arr?: string[]): string {
  return arr?.join(', ') ?? '';
}

// =============================================================================
// TOOL SELECTOR SUB-COMPONENT
// =============================================================================

interface ToolSelectorProps {
  availableTools: Tool[];
  linkedToolIds: Set<string>;
  onAdd: (toolId: string) => void;
}

function ToolSelector({ availableTools, linkedToolIds, onAdd }: ToolSelectorProps) {
  const [selectedToolId, setSelectedToolId] = useState('');

  const unlinkedTools = availableTools.filter((t) => !linkedToolIds.has(t.id));

  if (unlinkedTools.length === 0) {
    return (
      <div className="text-dark-500 text-sm py-2">
        All available tools are already linked to this skill.
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1">
        <Select
          label="Add Tool"
          value={selectedToolId}
          onChange={(e) => setSelectedToolId(e.target.value)}
          options={[
            { value: '', label: 'Select a tool...' },
            ...unlinkedTools.map((t) => ({
              value: t.id,
              label: `${t.name} (${t.type})`,
            })),
          ]}
        />
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          if (selectedToolId) {
            onAdd(selectedToolId);
            setSelectedToolId('');
          }
        }}
        disabled={!selectedToolId}
      >
        <Plus className="w-4 h-4" />
        Add
      </Button>
    </div>
  );
}

// =============================================================================
// LINKED TOOL ROW SUB-COMPONENT
// =============================================================================

interface LinkedToolRowProps {
  item: LinkedToolItem;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onUpdateRequired: (required: boolean) => void;
  onUpdateRole: (role: string) => void;
}

function LinkedToolRow({
  item,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUpdateRequired,
  onUpdateRole,
}: LinkedToolRowProps) {
  return (
    <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-lg border border-dark-700">
      {/* Order controls */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="p-1 hover:bg-dark-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={onMoveUp}
          disabled={index === 0}
          title="Move up"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="p-1 hover:bg-dark-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={onMoveDown}
          disabled={index === total - 1}
          title="Move down"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Tool info */}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-dark-400" />
          <span className="font-medium">{item.tool?.name ?? item.toolId}</span>
          {item.tool && (
            <Badge variant="default">{item.tool.type}</Badge>
          )}
        </div>
        {item.tool?.description && (
          <p className="text-dark-500 text-xs mt-1 truncate max-w-[300px]">
            {item.tool.description}
          </p>
        )}
      </div>

      {/* Required toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={item.required}
          onChange={(e) => onUpdateRequired(e.target.checked)}
          className="rounded border-dark-600 bg-dark-800 text-brand-500 focus:ring-brand-500"
        />
        <span className="text-sm text-dark-400">Required</span>
      </label>

      {/* Role input */}
      <input
        type="text"
        placeholder="Role"
        value={item.role}
        onChange={(e) => onUpdateRole(e.target.value)}
        className="w-24 px-2 py-1 text-sm bg-dark-800 border border-dark-700 rounded focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />

      {/* Remove button */}
      <button
        type="button"
        className="p-2 text-red-400 hover:bg-red-400/10 rounded"
        onClick={onRemove}
        title="Remove tool"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function SkillEditor({ skill, onSave, onCancel, loading }: SkillEditorProps) {
  // Form state
  const [form, setForm] = useState<SkillFormData>({
    name: '',
    description: '',
    version: '1.0.0',
    path: '',
    status: 'active',
    capabilities: '',
    requirements: '',
  });

  // Linked tools state
  const [linkedTools, setLinkedTools] = useState<LinkedToolItem[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);

  // Fetch all available tools
  const { data: toolsData } = useQuery({
    queryKey: ['tools'],
    queryFn: toolApi.list,
  });

  const availableTools = toolsData?.tools ?? [];
  const toolsMap = new Map(availableTools.map((t) => [t.id, t]));

  // Initialize form from skill
  useEffect(() => {
    if (skill) {
      setForm({
        name: skill.name,
        description: skill.description ?? '',
        version: skill.version,
        path: skill.path,
        status: skill.status,
        capabilities: formatArrayField(skill.capabilities),
        requirements: formatArrayField(skill.requirements),
      });

      // Load linked tools if editing existing skill
      if (skill.id) {
        setToolsLoading(true);
        skillApi.getToolsExpanded(skill.id)
          .then((tools) => {
            const items: LinkedToolItem[] = (tools as SkillToolExpanded[]).map((t) => ({
              toolId: t.toolId,
              orderIndex: t.orderIndex,
              required: t.required,
              role: t.role ?? '',
              tool: t.tool,
            }));
            setLinkedTools(items.sort((a, b) => a.orderIndex - b.orderIndex));
          })
          .catch((err) => {
            console.error('Failed to load skill tools:', err);
          })
          .finally(() => {
            setToolsLoading(false);
          });
      }
    }
  }, [skill]);

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const skillData: Partial<Skill> = {
      name: form.name,
      description: form.description || undefined,
      version: form.version,
      path: form.path,
      status: form.status,
      capabilities: parseArrayField(form.capabilities),
      requirements: parseArrayField(form.requirements),
    };

    const toolLinks: SkillToolLink[] = linkedTools.map((t, i) => ({
      toolId: t.toolId,
      orderIndex: i,
      required: t.required,
      role: t.role || undefined,
      createdAt: Date.now(),
    }));

    onSave(skillData, toolLinks.length > 0 ? toolLinks : undefined);
  };

  // Tool management functions
  const addTool = (toolId: string) => {
    const tool = toolsMap.get(toolId);
    setLinkedTools([
      ...linkedTools,
      {
        toolId,
        orderIndex: linkedTools.length,
        required: true,
        role: '',
        tool,
      },
    ]);
  };

  const removeTool = (index: number) => {
    setLinkedTools(linkedTools.filter((_, i) => i !== index));
  };

  const moveTool = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= linkedTools.length) return;

    const newTools = [...linkedTools];
    [newTools[index], newTools[newIndex]] = [newTools[newIndex]!, newTools[index]!];
    setLinkedTools(newTools);
  };

  const updateToolRequired = (index: number, required: boolean) => {
    const newTools = [...linkedTools];
    newTools[index] = { ...newTools[index]!, required };
    setLinkedTools(newTools);
  };

  const updateToolRole = (index: number, role: string) => {
    const newTools = [...linkedTools];
    newTools[index] = { ...newTools[index]!, role };
    setLinkedTools(newTools);
  };

  const linkedToolIds = new Set(linkedTools.map((t) => t.toolId));

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-dark-300 uppercase tracking-wider">
          Basic Information
        </h3>

        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="my-skill"
          required
        />

        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe what this skill does..."
          rows={2}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Version"
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            placeholder="1.0.0"
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as SkillStatus })}
            options={statusOptions}
          />
        </div>

        <Input
          label="Path"
          value={form.path}
          onChange={(e) => setForm({ ...form, path: e.target.value })}
          placeholder="/skills/my-skill"
          required
        />
      </div>

      {/* Capabilities & Requirements Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-dark-300 uppercase tracking-wider">
          Capabilities & Requirements
        </h3>

        <Input
          label="Capabilities"
          value={form.capabilities}
          onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
          placeholder="parsing, validation, transformation"
        />
        <p className="text-dark-500 text-xs -mt-2">Comma-separated list of capabilities</p>

        <Input
          label="Requirements"
          value={form.requirements}
          onChange={(e) => setForm({ ...form, requirements: e.target.value })}
          placeholder="node18, python3"
        />
        <p className="text-dark-500 text-xs -mt-2">Comma-separated list of requirements</p>
      </div>

      {/* Linked Tools Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-dark-300 uppercase tracking-wider">
            Linked Tools
          </h3>
          <Badge variant="default">{linkedTools.length} tools</Badge>
        </div>

        {toolsLoading ? (
          <div className="text-dark-400 text-sm py-4 text-center">Loading tools...</div>
        ) : (
          <>
            {linkedTools.length === 0 ? (
              <div className="flex items-center gap-2 p-4 bg-dark-900 rounded-lg border border-dark-700 text-dark-400">
                <Info className="w-4 h-4" />
                <span className="text-sm">
                  No tools linked yet. Add tools to define what this skill can use.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {linkedTools.map((item, index) => (
                  <LinkedToolRow
                    key={item.toolId}
                    item={item}
                    index={index}
                    total={linkedTools.length}
                    onMoveUp={() => moveTool(index, 'up')}
                    onMoveDown={() => moveTool(index, 'down')}
                    onRemove={() => removeTool(index)}
                    onUpdateRequired={(required) => updateToolRequired(index, required)}
                    onUpdateRole={(role) => updateToolRole(index, role)}
                  />
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-dark-700">
              <ToolSelector
                availableTools={availableTools}
                linkedToolIds={linkedToolIds}
                onAdd={addTool}
              />
            </div>
          </>
        )}

        {/* Warning if skill is active but has no tools */}
        {skill?.status === 'active' && linkedTools.length === 0 && (
          <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>
              This active skill has no linked tools. Consider adding tools or changing status.
            </span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {skill ? 'Save Changes' : 'Create Skill'}
        </Button>
      </div>
    </form>
  );
}
