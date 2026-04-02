/**
 * Tool Editor Component
 *
 * A comprehensive editor for creating and editing tools with
 * type-specific configuration forms.
 */

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { toolApi } from '../../lib/api';
import {
  Button,
  Input,
  Textarea,
  Select,
  Badge,
} from '../ui';
import type {
  Tool,
  ToolType,
  ToolStatus,
  ScriptToolConfig,
  BinaryToolConfig,
  ApiToolConfig,
  ToolValidationResult,
  ToolValidationIssue,
} from '../../types';

// =============================================================================
// TYPES
// =============================================================================

interface ToolEditorProps {
  tool?: Tool;
  onSave: (data: Partial<Tool>) => void;
  onCancel: () => void;
  loading?: boolean;
}

interface ToolFormData {
  name: string;
  description: string;
  version: string;
  path: string;
  type: ToolType;
  status: ToolStatus;
  inputSchema: string;
  outputSchema: string;
  config: ScriptToolConfig | BinaryToolConfig | ApiToolConfig;
}

// =============================================================================
// OPTIONS
// =============================================================================

const typeOptions = [
  { value: 'script', label: 'Script' },
  { value: 'binary', label: 'Binary' },
  { value: 'api', label: 'API' },
];

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'deprecated', label: 'Deprecated' },
];

const httpMethodOptions = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'PATCH', label: 'PATCH' },
  { value: 'DELETE', label: 'DELETE' },
];

const responseTypeOptions = [
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'binary', label: 'Binary' },
];

const authTypeOptions = [
  { value: '', label: 'None' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'api_key', label: 'API Key' },
];

// =============================================================================
// HELPERS
// =============================================================================

function getDefaultConfig(type: ToolType): ScriptToolConfig | BinaryToolConfig | ApiToolConfig {
  switch (type) {
    case 'script':
      return { runtime: 'node', timeoutMs: 30000 };
    case 'binary':
      return { timeoutMs: 30000, shell: false };
    case 'api':
      return { method: 'GET', timeoutMs: 30000, followRedirects: true, responseType: 'json' };
  }
}

function parseJsonSafe(str: string): Record<string, unknown> | undefined {
  if (!str || str.trim() === '') return undefined;
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

function stringifyJsonSafe(obj: unknown): string {
  if (!obj) return '';
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return '';
  }
}

// =============================================================================
// VALIDATION DISPLAY
// =============================================================================

function ValidationResult({ result }: { result: ToolValidationResult }) {
  const [expanded, setExpanded] = useState(true);

  const errorCount = result.issues.filter(i => i.severity === 'error').length;
  const warningCount = result.issues.filter(i => i.severity === 'warning').length;

  return (
    <div className={`rounded-lg border p-4 ${result.valid ? 'border-green-600 bg-green-900/20' : 'border-red-600 bg-red-900/20'}`}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {result.valid ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-400" />
          )}
          <span className="font-medium">
            {result.valid ? 'Validation Passed' : 'Validation Failed'}
          </span>
          <Badge variant={result.valid ? 'active' : 'error'}>
            Score: {result.score}/100
          </Badge>
          {errorCount > 0 && <Badge variant="error">{errorCount} errors</Badge>}
          {warningCount > 0 && <Badge variant="pending">{warningCount} warnings</Badge>}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          {result.issues.length > 0 && (
            <div>
              <p className="text-sm text-dark-400 mb-2">Issues:</p>
              <ul className="space-y-1">
                {result.issues.map((issue, i) => (
                  <IssueItem key={i} issue={issue} />
                ))}
              </ul>
            </div>
          )}

          {result.suggestions.length > 0 && (
            <div>
              <p className="text-sm text-dark-400 mb-2">Suggestions:</p>
              <ul className="space-y-1">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-dark-300">
                    <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IssueItem({ issue }: { issue: ToolValidationIssue }) {
  const Icon = issue.severity === 'error' ? AlertCircle : issue.severity === 'warning' ? AlertCircle : Info;
  const color = issue.severity === 'error' ? 'text-red-400' : issue.severity === 'warning' ? 'text-yellow-400' : 'text-blue-400';

  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`w-4 h-4 ${color} mt-0.5 flex-shrink-0`} />
      <span>
        <span className="text-dark-400">{issue.field}:</span>{' '}
        <span className="text-dark-200">{issue.message}</span>
      </span>
    </li>
  );
}

// =============================================================================
// CONFIG FORMS
// =============================================================================

function ScriptConfigForm({
  config,
  onChange,
}: {
  config: ScriptToolConfig;
  onChange: (c: ScriptToolConfig) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Runtime"
          value={config.runtime || ''}
          onChange={(e) => onChange({ ...config, runtime: e.target.value })}
          placeholder="node, python3, bash"
        />
        <Input
          label="Entrypoint"
          value={config.entrypoint || ''}
          onChange={(e) => onChange({ ...config, entrypoint: e.target.value })}
          placeholder="index.js, main.py"
        />
      </div>
      <Input
        label="Arguments Template"
        value={config.argsTemplate || ''}
        onChange={(e) => onChange({ ...config, argsTemplate: e.target.value })}
        placeholder="--input {{input}} --output {{output}}"
      />
      <Input
        label="Working Directory"
        value={config.workingDirectory || ''}
        onChange={(e) => onChange({ ...config, workingDirectory: e.target.value })}
        placeholder="/path/to/working/dir"
      />
      <Input
        label="Timeout (ms)"
        type="number"
        value={config.timeoutMs || ''}
        onChange={(e) => onChange({ ...config, timeoutMs: parseInt(e.target.value) || undefined })}
        placeholder="30000"
      />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="captureStderr"
          checked={config.captureStderr || false}
          onChange={(e) => onChange({ ...config, captureStderr: e.target.checked })}
          className="rounded border-dark-600 bg-dark-800"
        />
        <label htmlFor="captureStderr" className="text-sm text-dark-300">
          Capture stderr separately
        </label>
      </div>
    </div>
  );
}

function BinaryConfigForm({
  config,
  onChange,
}: {
  config: BinaryToolConfig;
  onChange: (c: BinaryToolConfig) => void;
}) {
  return (
    <div className="space-y-4">
      <Input
        label="Binary Path"
        value={config.binaryPath || ''}
        onChange={(e) => onChange({ ...config, binaryPath: e.target.value })}
        placeholder="/usr/bin/my-tool"
      />
      <Input
        label="Arguments Template"
        value={config.argsTemplate || ''}
        onChange={(e) => onChange({ ...config, argsTemplate: e.target.value })}
        placeholder="--input {{input}} --output {{output}}"
      />
      <Input
        label="Working Directory"
        value={config.workingDirectory || ''}
        onChange={(e) => onChange({ ...config, workingDirectory: e.target.value })}
        placeholder="/path/to/working/dir"
      />
      <Input
        label="Timeout (ms)"
        type="number"
        value={config.timeoutMs || ''}
        onChange={(e) => onChange({ ...config, timeoutMs: parseInt(e.target.value) || undefined })}
        placeholder="30000"
      />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="shell"
          checked={config.shell || false}
          onChange={(e) => onChange({ ...config, shell: e.target.checked })}
          className="rounded border-dark-600 bg-dark-800"
        />
        <label htmlFor="shell" className="text-sm text-dark-300">
          Run in shell mode
        </label>
      </div>
    </div>
  );
}

function ApiConfigForm({
  config,
  onChange,
}: {
  config: ApiToolConfig;
  onChange: (c: ApiToolConfig) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Select
          label="Method"
          value={config.method || 'GET'}
          onChange={(e) => onChange({ ...config, method: e.target.value as ApiToolConfig['method'] })}
          options={httpMethodOptions}
        />
        <div className="col-span-2">
          <Input
            label="URL"
            value={config.url || ''}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            placeholder="https://api.example.com/{{resource}}"
          />
        </div>
      </div>

      <Textarea
        label="Headers (JSON)"
        value={stringifyJsonSafe(config.headers)}
        onChange={(e) => {
          const parsed = parseJsonSafe(e.target.value);
          if (parsed || e.target.value === '') {
            onChange({ ...config, headers: parsed as Record<string, string> });
          }
        }}
        placeholder='{"Content-Type": "application/json"}'
        rows={3}
      />

      <Textarea
        label="Body Template (for POST/PUT/PATCH)"
        value={config.bodyTemplate || ''}
        onChange={(e) => onChange({ ...config, bodyTemplate: e.target.value })}
        placeholder='{"data": "{{input}}"}'
        rows={3}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Timeout (ms)"
          type="number"
          value={config.timeoutMs || ''}
          onChange={(e) => onChange({ ...config, timeoutMs: parseInt(e.target.value) || undefined })}
          placeholder="30000"
        />
        <Select
          label="Response Type"
          value={config.responseType || 'json'}
          onChange={(e) => onChange({ ...config, responseType: e.target.value as ApiToolConfig['responseType'] })}
          options={responseTypeOptions}
        />
      </div>

      <div className="border-t border-dark-700 pt-4 mt-4">
        <p className="text-sm text-dark-400 mb-3">Authentication</p>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Auth Type"
            value={config.auth?.type || ''}
            onChange={(e) => {
              if (!e.target.value) {
                const { auth, ...rest } = config;
                onChange(rest);
              } else {
                onChange({
                  ...config,
                  auth: { type: e.target.value as 'bearer' | 'basic' | 'api_key', ...config.auth },
                });
              }
            }}
            options={authTypeOptions}
          />
          {config.auth?.type && (
            <Input
              label={config.auth.type === 'api_key' ? 'API Key' : config.auth.type === 'basic' ? 'Username:Password' : 'Token'}
              value={config.auth?.value || ''}
              onChange={(e) => onChange({ ...config, auth: { ...config.auth!, value: e.target.value } })}
              type="password"
              placeholder={config.auth.type === 'basic' ? 'user:pass' : 'token/key'}
            />
          )}
        </div>
        {config.auth?.type === 'api_key' && (
          <Input
            label="Header Name"
            value={config.auth?.headerName || ''}
            onChange={(e) => onChange({ ...config, auth: { ...config.auth!, headerName: e.target.value } })}
            placeholder="X-API-Key"
            className="mt-4"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="followRedirects"
          checked={config.followRedirects !== false}
          onChange={(e) => onChange({ ...config, followRedirects: e.target.checked })}
          className="rounded border-dark-600 bg-dark-800"
        />
        <label htmlFor="followRedirects" className="text-sm text-dark-300">
          Follow redirects
        </label>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ToolEditor({ tool, onSave, onCancel, loading }: ToolEditorProps) {
  const [form, setForm] = useState<ToolFormData>(() => ({
    name: tool?.name || '',
    description: tool?.description || '',
    version: tool?.version || '1.0.0',
    path: tool?.path || '',
    type: tool?.type || 'script',
    status: tool?.status || 'active',
    inputSchema: stringifyJsonSafe(tool?.inputSchema),
    outputSchema: stringifyJsonSafe(tool?.outputSchema),
    config: (tool?.config as ScriptToolConfig | BinaryToolConfig | ApiToolConfig) || getDefaultConfig(tool?.type || 'script'),
  }));

  const [validationResult, setValidationResult] = useState<ToolValidationResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reset config when type changes
  useEffect(() => {
    if (!tool) {
      setForm(prev => ({
        ...prev,
        config: getDefaultConfig(prev.type),
      }));
    }
  }, [form.type, tool]);

  const validateMutation = useMutation({
    mutationFn: async () => {
      const data = buildToolData();
      return toolApi.validate(data);
    },
    onSuccess: (result) => {
      setValidationResult(result);
    },
  });

  const buildToolData = (): Partial<Tool> => {
    return {
      name: form.name,
      description: form.description || undefined,
      version: form.version,
      path: form.path,
      type: form.type,
      status: form.status,
      inputSchema: parseJsonSafe(form.inputSchema),
      outputSchema: parseJsonSafe(form.outputSchema),
      config: form.config as Record<string, unknown>,
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(buildToolData());
  };

  const handleValidate = () => {
    validateMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Fields */}
      <div className="space-y-4">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          placeholder="my-tool"
        />

        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What does this tool do?"
          rows={2}
        />

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Version"
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            placeholder="1.0.0"
          />
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ToolType })}
            options={typeOptions}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ToolStatus })}
            options={statusOptions}
          />
        </div>

        <Input
          label="Path"
          value={form.path}
          onChange={(e) => setForm({ ...form, path: e.target.value })}
          required
          placeholder="/tools/my-tool"
        />
      </div>

      {/* Type-specific Config */}
      <div className="border-t border-dark-700 pt-6">
        <h3 className="text-lg font-medium mb-4">
          {form.type === 'script' && 'Script Configuration'}
          {form.type === 'binary' && 'Binary Configuration'}
          {form.type === 'api' && 'API Configuration'}
        </h3>

        {form.type === 'script' && (
          <ScriptConfigForm
            config={form.config as ScriptToolConfig}
            onChange={(c) => setForm({ ...form, config: c })}
          />
        )}
        {form.type === 'binary' && (
          <BinaryConfigForm
            config={form.config as BinaryToolConfig}
            onChange={(c) => setForm({ ...form, config: c })}
          />
        )}
        {form.type === 'api' && (
          <ApiConfigForm
            config={form.config as ApiToolConfig}
            onChange={(c) => setForm({ ...form, config: c })}
          />
        )}
      </div>

      {/* Advanced: Schemas */}
      <div className="border-t border-dark-700 pt-6">
        <button
          type="button"
          className="flex items-center gap-2 text-dark-400 hover:text-dark-200"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          <span>Advanced: Input/Output Schemas</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <Textarea
              label="Input Schema (JSON Schema)"
              value={form.inputSchema}
              onChange={(e) => setForm({ ...form, inputSchema: e.target.value })}
              placeholder='{"type": "object", "properties": {...}}'
              rows={4}
              className="font-mono text-sm"
            />
            <Textarea
              label="Output Schema (JSON Schema)"
              value={form.outputSchema}
              onChange={(e) => setForm({ ...form, outputSchema: e.target.value })}
              placeholder='{"type": "string"}'
              rows={4}
              className="font-mono text-sm"
            />
          </div>
        )}
      </div>

      {/* Validation Result */}
      {validationResult && (
        <ValidationResult result={validationResult} />
      )}

      {/* Actions */}
      <div className="flex justify-between items-center pt-4 border-t border-dark-700">
        <Button
          type="button"
          variant="secondary"
          onClick={handleValidate}
          loading={validateMutation.isPending}
        >
          Validate
        </Button>

        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {tool ? 'Update Tool' : 'Create Tool'}
          </Button>
        </div>
      </div>
    </form>
  );
}
