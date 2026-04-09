/**
 * ToolDetail.tsx
 *
 * Minimal tool detail page for inspection and navigation.
 * Shows: id, name, type, status, description, linked skills, validation status.
 */

import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Wrench,
  Sparkles,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Terminal,
  Code,
  Globe,
  Activity,
} from 'lucide-react';
import { toolApi, skillApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  Modal,
} from '../components/ui';
import { ToolEditor } from '../components/tools/ToolEditor';
import { fromTimestamp } from '../lib/date';
import { useState } from 'react';
import type { Tool, Skill } from '../types';

const statusVariant = {
  active: 'active',
  inactive: 'inactive',
  deprecated: 'error',
} as const;

const typeIcons = {
  script: Terminal,
  binary: Code,
  api: Globe,
};

export function ToolDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [showEdit, setShowEdit] = useState(false);

  // Tool data
  const { data: tool, isLoading, error } = useQuery({
    queryKey: ['tools', id],
    queryFn: () => toolApi.get(id!),
    enabled: !!id,
  });

  // Validation result
  const { data: validationResult, isLoading: validating } = useQuery({
    queryKey: ['tools', id, 'validation'],
    queryFn: () => toolApi.validateExisting(id!),
    enabled: !!id && !!tool,
    retry: false,
  });

  // Find skills that link this tool
  const { data: skillsData } = useQuery({
    queryKey: ['skills'],
    queryFn: () => skillApi.list({ expand: 'tools' }),
    enabled: !!id,
  });

  // Filter skills that have this tool
  const linkedSkills = skillsData?.skills?.filter((skill: Skill & { tools?: Array<{ toolId: string }> }) =>
    skill.tools?.some(t => t.toolId === id)
  ) || [];

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Tool>) => toolApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools', id] });
      queryClient.invalidateQueries({ queryKey: ['tools', id, 'validation'] });
      setShowEdit(false);
      addNotification({ type: 'success', title: 'Tool updated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to update', message: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => toolApi.delete(id!),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Tool deleted' });
      navigate('/tools');
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to delete', message: err.message });
    },
  });

  const revalidateMutation = useMutation({
    mutationFn: () => toolApi.validateExisting(id!),
    onSuccess: (result) => {
      queryClient.setQueryData(['tools', id, 'validation'], result);
      if (result.valid) {
        addNotification({ type: 'success', title: 'Validation passed', message: `Score: ${result.score}/100` });
      } else {
        addNotification({ type: 'warning', title: 'Validation issues found' });
      }
    },
  });

  const formatDate = (ts?: number) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleString() : '-';
  };

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-xl font-semibold text-dark-200">Tool Not Found</h2>
        <p className="text-dark-400 mt-2">The tool with ID "{id}" does not exist or was deleted.</p>
        <Button variant="secondary" className="mt-6" onClick={() => navigate('/tools')}>
          <ArrowLeft className="w-4 h-4" />
          Back to Tools
        </Button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return <div className="text-center py-8 text-dark-400">Loading...</div>;
  }

  if (!tool) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-yellow-400 mb-4" />
        <h2 className="text-xl font-semibold text-dark-200">Tool Not Found</h2>
        <Button variant="secondary" className="mt-6" onClick={() => navigate('/tools')}>
          <ArrowLeft className="w-4 h-4" />
          Back to Tools
        </Button>
      </div>
    );
  }

  const TypeIcon = typeIcons[tool.type] || Wrench;
  const isValid = validationResult?.valid === true;
  const hasIssues = validationResult && !validationResult.valid;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/tools')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="p-3 rounded-lg bg-orange-500/10">
          <TypeIcon className="w-6 h-6 text-orange-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{tool.name}</h1>
            <Badge variant={statusVariant[tool.status]}>{tool.status}</Badge>
            {isValid && (
              <Badge variant="success" className="text-xs">
                <span className="mr-1">●</span>Validated
              </Badge>
            )}
            {hasIssues && (
              <Badge variant="error" className="text-xs">
                <span className="mr-1">●</span>Issues
              </Badge>
            )}
          </div>
          <p className="text-dark-400">{tool.description || 'No description'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => revalidateMutation.mutate()}
            loading={revalidateMutation.isPending}
            title="Re-validate tool"
          >
            <CheckCircle className="w-4 h-4" />
            Validate
          </Button>
          <Button variant="secondary" onClick={() => setShowEdit(true)}>
            <Edit2 className="w-4 h-4" />
            Edit
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm('Delete this tool?')) {
                deleteMutation.mutate();
              }
            }}
            loading={deleteMutation.isPending}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Details */}
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-dark-400">ID</p>
              <p className="text-sm font-mono mt-1">{tool.id}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Type</p>
              <div className="flex items-center gap-2 mt-1">
                <TypeIcon className="w-4 h-4 text-orange-400" />
                <Badge>{tool.type}</Badge>
              </div>
            </div>
            <div>
              <p className="text-sm text-dark-400">Version</p>
              <p className="text-sm mt-1">{tool.version}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Path</p>
              <p className="text-sm font-mono mt-1">{tool.path || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Status</p>
              <Badge variant={statusVariant[tool.status]} className="mt-1">{tool.status}</Badge>
            </div>
            <div>
              <p className="text-sm text-dark-400">Executions</p>
              <p className="text-sm mt-1">{tool.executionCount ?? 0} runs</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Created</p>
              <p className="text-sm mt-1">{formatDate(tool.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Updated</p>
              <p className="text-sm mt-1">{formatDate(tool.updatedAt)}</p>
            </div>
            {tool.lastExecutedAt && (
              <div>
                <p className="text-sm text-dark-400">Last Executed</p>
                <p className="text-sm mt-1">{formatDate(tool.lastExecutedAt)}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Right: Validation Status */}
        <Card>
          <CardHeader title="Validation Status" />
          {validating ? (
            <p className="text-dark-400 text-sm">Validating...</p>
          ) : !validationResult ? (
            <div className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg">
              <Activity className="w-5 h-5 text-dark-500" />
              <div>
                <p className="text-sm text-dark-300">Not Validated</p>
                <p className="text-xs text-dark-500 mt-0.5">Click Validate to check</p>
              </div>
            </div>
          ) : isValid ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <div>
                  <p className="text-sm text-green-300">Validation Passed</p>
                  <p className="text-xs text-green-400 mt-0.5">
                    Score: {validationResult.score}/100
                  </p>
                </div>
              </div>
              {validationResult.issues?.filter((i) => i.severity === 'warning').length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-dark-400">Warnings:</p>
                  {validationResult.issues.filter((i) => i.severity === 'warning').map((issue, idx) => (
                    <div key={idx} className="text-xs text-yellow-400 pl-3 border-l-2 border-yellow-500/30">
                      {issue.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <XCircle className="w-5 h-5 text-red-400" />
                <div>
                  <p className="text-sm text-red-300">Validation Failed</p>
                  <p className="text-xs text-red-400 mt-0.5">
                    Score: {validationResult.score}/100
                  </p>
                </div>
              </div>
              {validationResult.issues && validationResult.issues.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {validationResult.issues.map((issue: { severity: string; message: string }, idx: number) => (
                    <div
                      key={idx}
                      className={`text-xs pl-3 border-l-2 ${
                        issue.severity === 'error'
                          ? 'text-red-400 border-red-500/30'
                          : 'text-yellow-400 border-yellow-500/30'
                      }`}
                    >
                      [{issue.severity}] {issue.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Tool Configuration */}
      {tool.config && (
        <Card>
          <CardHeader title="Configuration" />
          <pre className="text-xs font-mono bg-dark-900 p-4 rounded-lg overflow-auto max-h-64">
            {JSON.stringify(tool.config, null, 2)}
          </pre>
        </Card>
      )}

      {/* Linked Skills */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              Linked Skills ({linkedSkills.length})
            </div>
          }
        />
        {linkedSkills.length === 0 ? (
          <div className="text-center py-6">
            <Sparkles className="w-8 h-8 text-dark-500 mx-auto mb-2" />
            <p className="text-dark-400">No skills using this tool</p>
            <p className="text-dark-500 text-sm">Link this tool to skills from Skill editor</p>
          </div>
        ) : (
          <div className="space-y-2">
            {linkedSkills.map((skill: Skill) => (
              <Link
                key={skill.id}
                to={`/skills/${skill.id}`}
                className="flex items-center justify-between p-3 bg-dark-800 rounded-lg hover:bg-dark-750 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span className="font-medium">{skill.name}</span>
                </div>
                <Badge variant={skill.status === 'active' ? 'active' : 'inactive'}>
                  {skill.status}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Edit Modal */}
      <Modal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        title={`Edit Tool: ${tool.name}`}
        size="xl"
      >
        <ToolEditor
          tool={tool}
          onSave={(data) => updateMutation.mutate(data)}
          onCancel={() => setShowEdit(false)}
          loading={updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}
