/**
 * SkillDetail.tsx
 *
 * Minimal skill detail page for inspection and navigation.
 * Shows: id, name, status, description, assigned agents, linked tools, validation status.
 */

import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Sparkles,
  Wrench,
  Bot,
  Edit2,
  Trash2,
  Play,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Users,
} from 'lucide-react';
import { skillApi, agentApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  Modal,
} from '../components/ui';
import { SkillEditor } from '../components/skills/SkillEditor';
import { SkillExecutionPanel } from '../components/skills/SkillExecutionPanel';
import { fromTimestamp } from '../lib/date';
import { useState } from 'react';
import type { Skill, SkillToolLink, SkillToolExpanded, Agent } from '../types';

const statusVariant = {
  active: 'active',
  inactive: 'inactive',
  deprecated: 'error',
} as const;

export function SkillDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [showEdit, setShowEdit] = useState(false);
  const [showExecute, setShowExecute] = useState(false);

  // Skill data
  const { data: skill, isLoading, error } = useQuery({
    queryKey: ['skills', id],
    queryFn: () => skillApi.get(id!),
    enabled: !!id,
  });

  // Tools linked to this skill
  const { data: linkedTools, isLoading: toolsLoading } = useQuery({
    queryKey: ['skills', id, 'tools'],
    queryFn: () => skillApi.getToolsExpanded(id!),
    enabled: !!id,
  });

  // All agents to find which have this skill assigned
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: agentApi.list,
    enabled: !!id,
  });

  // Check which agents have this skill
  const { data: assignedAgents } = useQuery({
    queryKey: ['skill-agents', id],
    queryFn: async () => {
      if (!agentsData?.agents) return [];
      const assigned: Agent[] = [];
      for (const agent of agentsData.agents) {
        try {
          const skills = await agentApi.getSkills(agent.id);
          if (skills.some((s: Skill) => s.id === id)) {
            assigned.push(agent);
          }
        } catch {
          // ignore errors
        }
      }
      return assigned;
    },
    enabled: !!agentsData?.agents && !!id,
  });

  // Execution preview for validation status
  const { data: executionPreview } = useQuery({
    queryKey: ['skills', id, 'execution-preview'],
    queryFn: () => skillApi.getExecutionPreview(id!),
    enabled: !!id && skill?.status === 'active',
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ skillData, tools }: { skillData: Partial<Skill>; tools?: SkillToolLink[] }) => {
      const updated = await skillApi.update(id!, skillData);
      if (tools !== undefined) {
        await skillApi.setTools(id!, tools);
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills', id] });
      queryClient.invalidateQueries({ queryKey: ['skills', id, 'tools'] });
      setShowEdit(false);
      addNotification({ type: 'success', title: 'Skill updated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to update', message: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => skillApi.delete(id!),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Skill deleted' });
      navigate('/skills');
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to delete', message: err.message });
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
        <h2 className="text-xl font-semibold text-dark-200">Skill Not Found</h2>
        <p className="text-dark-400 mt-2">The skill with ID "{id}" does not exist or was deleted.</p>
        <Button variant="secondary" className="mt-6" onClick={() => navigate('/skills')}>
          <ArrowLeft className="w-4 h-4" />
          Back to Skills
        </Button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return <div className="text-center py-8 text-dark-400">Loading...</div>;
  }

  if (!skill) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-yellow-400 mb-4" />
        <h2 className="text-xl font-semibold text-dark-200">Skill Not Found</h2>
        <Button variant="secondary" className="mt-6" onClick={() => navigate('/skills')}>
          <ArrowLeft className="w-4 h-4" />
          Back to Skills
        </Button>
      </div>
    );
  }

  // Determine runtime usability
  const toolCount = linkedTools?.length ?? 0;
  const isExecutable = skill.status === 'active' && toolCount > 0;
  const hasBlockers = executionPreview?.blockers && executionPreview.blockers.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/skills')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="p-3 rounded-lg bg-purple-500/10">
          <Sparkles className="w-6 h-6 text-purple-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{skill.name}</h1>
            <Badge variant={statusVariant[skill.status]}>{skill.status}</Badge>
            {isExecutable && !hasBlockers && (
              <Badge variant="success" className="text-xs">
                <span className="mr-1">●</span>Runtime Ready
              </Badge>
            )}
            {isExecutable && hasBlockers && (
              <Badge variant="error" className="text-xs">
                <span className="mr-1">●</span>Blocked
              </Badge>
            )}
            {!isExecutable && (
              <Badge variant="inactive" className="text-xs">Not Executable</Badge>
            )}
          </div>
          <p className="text-dark-400">{skill.description || 'No description'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowExecute(true)}
            disabled={!isExecutable}
            title={!isExecutable ? 'Skill not executable (inactive or no tools)' : 'Execute skill'}
          >
            <Play className="w-4 h-4" />
            Execute
          </Button>
          <Button variant="secondary" onClick={() => setShowEdit(true)}>
            <Edit2 className="w-4 h-4" />
            Edit
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm('Delete this skill?')) {
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
              <p className="text-sm font-mono mt-1">{skill.id}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Version</p>
              <p className="text-sm mt-1">{skill.version}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Path</p>
              <p className="text-sm font-mono mt-1">{skill.path || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Status</p>
              <Badge variant={statusVariant[skill.status]} className="mt-1">{skill.status}</Badge>
            </div>
            <div>
              <p className="text-sm text-dark-400">Created</p>
              <p className="text-sm mt-1">{formatDate(skill.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Updated</p>
              <p className="text-sm mt-1">{formatDate(skill.updatedAt)}</p>
            </div>
            {skill.syncedAt && (
              <div>
                <p className="text-sm text-dark-400">Last Synced</p>
                <p className="text-sm mt-1">{formatDate(skill.syncedAt)}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Right: Validation Status */}
        <Card>
          <CardHeader title="Validation Status" />
          {!isExecutable ? (
            <div className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg">
              <XCircle className="w-5 h-5 text-dark-500" />
              <div>
                <p className="text-sm text-dark-300">Not Executable</p>
                <p className="text-xs text-dark-500 mt-0.5">
                  {skill.status !== 'active' ? 'Skill is not active' : 'No tools linked'}
                </p>
              </div>
            </div>
          ) : hasBlockers ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <div>
                  <p className="text-sm text-red-300">Execution Blocked</p>
                  <p className="text-xs text-red-400 mt-0.5">
                    {executionPreview?.blockers?.length} blocker(s) found
                  </p>
                </div>
              </div>
              {executionPreview?.blockers?.map((blocker, idx) => (
                <div key={idx} className="text-xs text-dark-400 pl-3 border-l-2 border-red-500/30">
                  {blocker}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-sm text-green-300">Ready for Execution</p>
                <p className="text-xs text-green-400 mt-0.5">
                  All {toolCount} tool(s) validated
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Linked Tools */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-orange-400" />
              Linked Tools ({toolCount})
            </div>
          }
        />
        {toolsLoading ? (
          <p className="text-dark-400 text-sm">Loading tools...</p>
        ) : !linkedTools || linkedTools.length === 0 ? (
          <div className="text-center py-6">
            <Wrench className="w-8 h-8 text-dark-500 mx-auto mb-2" />
            <p className="text-dark-400">No tools linked</p>
            <p className="text-dark-500 text-sm">Add tools to make this skill executable</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(linkedTools as SkillToolExpanded[]).map((link, idx) => (
              <Link
                key={link.toolId}
                to={`/tools/${link.toolId}`}
                className="flex items-center justify-between p-3 bg-dark-800 rounded-lg hover:bg-dark-750 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-dark-500 text-sm w-6">{idx + 1}.</span>
                  <Wrench className="w-4 h-4 text-orange-400" />
                  <div>
                    <span className="font-medium">{link.tool?.name || link.toolId}</span>
                    {link.role && (
                      <Badge variant="default" className="ml-2 text-xs">{link.role}</Badge>
                    )}
                    {link.required && (
                      <Badge variant="error" className="ml-2 text-xs">Required</Badge>
                    )}
                  </div>
                </div>
                <Badge variant={link.tool?.status === 'active' ? 'active' : 'inactive'}>
                  {link.tool?.status || 'unknown'}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Assigned Agents */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary-400" />
              Assigned Agents ({assignedAgents?.length ?? 0})
            </div>
          }
        />
        {!assignedAgents || assignedAgents.length === 0 ? (
          <div className="text-center py-6">
            <Bot className="w-8 h-8 text-dark-500 mx-auto mb-2" />
            <p className="text-dark-400">No agents using this skill</p>
            <p className="text-dark-500 text-sm">Assign this skill to agents from Agent Detail</p>
          </div>
        ) : (
          <div className="space-y-2">
            {assignedAgents.map((agent: Agent) => (
              <Link
                key={agent.id}
                to={`/agents/${agent.id}`}
                className="flex items-center justify-between p-3 bg-dark-800 rounded-lg hover:bg-dark-750 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Bot className="w-4 h-4 text-primary-400" />
                  <span className="font-medium">{agent.name}</span>
                </div>
                <Badge variant={agent.status === 'active' ? 'active' : 'inactive'}>
                  {agent.status}
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
        title={`Edit Skill: ${skill.name}`}
        size="xl"
      >
        <SkillEditor
          skill={skill}
          onSave={(skillData, tools) => updateMutation.mutate({ skillData, tools })}
          onCancel={() => setShowEdit(false)}
          loading={updateMutation.isPending}
        />
      </Modal>

      {/* Execute Modal */}
      <Modal
        isOpen={showExecute}
        onClose={() => setShowExecute(false)}
        title={`Execute Skill: ${skill.name}`}
        size="xl"
      >
        <SkillExecutionPanel
          skill={skill}
          onClose={() => setShowExecute(false)}
        />
      </Modal>
    </div>
  );
}
