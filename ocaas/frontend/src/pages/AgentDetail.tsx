import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Power, PowerOff, Trash2, Edit2, Sparkles, Plus, X } from 'lucide-react';
import { agentApi, taskApi, skillApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import type { Skill } from '../types';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  Modal,
  Input,
  Textarea,
  Select,
} from '../components/ui';
import { fromTimestamp } from '../lib/date';
import type { Agent } from '../types';

const typeOptions = [
  { value: 'general', label: 'General' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'orchestrator', label: 'Orchestrator' },
];

const statusVariant = {
  active: 'active',
  inactive: 'inactive',
  busy: 'pending',
  error: 'error',
} as const;

const taskStatusVariant = {
  pending: 'pending',
  queued: 'pending',
  assigned: 'pending',
  running: 'active',
  completed: 'success',
  failed: 'error',
  cancelled: 'inactive',
} as const;

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [showEdit, setShowEdit] = useState(false);
  const [showAssignSkill, setShowAssignSkill] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'general',
    capabilities: '',
  });

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agents', id],
    queryFn: () => agentApi.get(id!),
    enabled: !!id,
  });

  const { data: tasksData } = useQuery({
    queryKey: ['tasks', 'agent', id],
    queryFn: () => taskApi.list({ agentId: id }),
    enabled: !!id,
  });

  // Skills assigned to this agent
  const { data: assignedSkills, isLoading: skillsLoading } = useQuery({
    queryKey: ['agents', id, 'skills'],
    queryFn: () => agentApi.getSkills(id!),
    enabled: !!id,
  });

  // All skills (for assignment modal)
  const { data: allSkillsData } = useQuery({
    queryKey: ['skills'],
    queryFn: () => skillApi.list(),
    enabled: showAssignSkill,
  });

  const activateMutation = useMutation({
    mutationFn: agentApi.activate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', id] });
      addNotification({ type: 'success', title: 'Agent activated' });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: agentApi.deactivate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', id] });
      addNotification({ type: 'info', title: 'Agent deactivated' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: agentApi.delete,
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Agent deleted' });
      navigate('/agents');
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to delete agent', message: err.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Agent>) => agentApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', id] });
      setShowEdit(false);
      addNotification({ type: 'success', title: 'Agent updated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to update agent', message: err.message });
    },
  });

  const assignSkillMutation = useMutation({
    mutationFn: (skillId: string) => skillApi.assignToAgent(skillId, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', id, 'skills'] });
      setShowAssignSkill(false);
      addNotification({ type: 'success', title: 'Skill assigned' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to assign skill', message: err.message });
    },
  });

  const unassignSkillMutation = useMutation({
    mutationFn: (skillId: string) => skillApi.unassignFromAgent(skillId, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', id, 'skills'] });
      addNotification({ type: 'info', title: 'Skill unassigned' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to unassign skill', message: err.message });
    },
  });

  const handleEdit = () => {
    if (!agent) return;
    setForm({
      name: agent.name,
      description: agent.description ?? '',
      type: agent.type,
      capabilities: agent.capabilities?.join(', ') ?? '',
    });
    setShowEdit(true);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    const capabilities = form.capabilities
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    updateMutation.mutate({
      name: form.name,
      description: form.description,
      type: form.type as Agent['type'],
      capabilities,
    });
  };

  if (isLoading) {
    return <div className="text-center py-8 text-dark-400">Loading...</div>;
  }

  if (!agent) {
    return <div className="text-center py-8 text-dark-400">Agent not found</div>;
  }

  const tasks = tasksData?.tasks || [];
  const formatDate = (ts: number) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleString() : '-';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/agents')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <p className="text-dark-400">{agent.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleEdit}
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </Button>
          {agent.status === 'active' ? (
            <Button
              variant="secondary"
              onClick={() => deactivateMutation.mutate(agent.id)}
              loading={deactivateMutation.isPending}
            >
              <PowerOff className="w-4 h-4" />
              Deactivate
            </Button>
          ) : (
            <Button
              variant="success"
              onClick={() => activateMutation.mutate(agent.id)}
              loading={activateMutation.isPending}
            >
              <Power className="w-4 h-4" />
              Activate
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => {
              if (confirm('Delete this agent?')) {
                deleteMutation.mutate(agent.id);
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
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-dark-400">Status</p>
              <Badge variant={statusVariant[agent.status]} className="mt-1">
                {agent.status}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-dark-400">Type</p>
              <Badge className="mt-1">{agent.type}</Badge>
            </div>
            <div>
              <p className="text-sm text-dark-400">Created</p>
              <p className="text-sm mt-1">{formatDate(agent.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Updated</p>
              <p className="text-sm mt-1">{formatDate(agent.updatedAt)}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Capabilities" />
          {!agent.capabilities || agent.capabilities.length === 0 ? (
            <p className="text-dark-400 text-sm">No capabilities defined</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {agent.capabilities.map((cap, idx) => (
                <Badge key={idx}>{cap}</Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Assigned Skills */}
      <Card>
        <CardHeader
          title="Assigned Skills"
          action={
            <Button size="sm" onClick={() => setShowAssignSkill(true)}>
              <Plus className="w-4 h-4" />
              Assign Skill
            </Button>
          }
        />
        {skillsLoading ? (
          <p className="text-dark-400 text-sm">Loading skills...</p>
        ) : !assignedSkills || assignedSkills.length === 0 ? (
          <div className="text-center py-6">
            <Sparkles className="w-8 h-8 text-dark-500 mx-auto mb-2" />
            <p className="text-dark-400">No skills assigned</p>
            <p className="text-dark-500 text-sm">Assign skills to give this agent capabilities</p>
          </div>
        ) : (
          <div className="space-y-2">
            {assignedSkills.map((skill: Skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between p-3 bg-dark-800 rounded-lg hover:bg-dark-750 transition-colors"
              >
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => navigate(`/skills`)}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary-400" />
                    <span className="font-medium">{skill.name}</span>
                    <Badge variant={skill.status === 'active' ? 'active' : 'inactive'} className="text-xs">
                      {skill.status}
                    </Badge>
                  </div>
                  {skill.description && (
                    <p className="text-dark-400 text-sm mt-1 ml-6">{skill.description}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    unassignSkillMutation.mutate(skill.id);
                  }}
                  loading={unassignSkillMutation.isPending}
                  title="Unassign skill"
                >
                  <X className="w-4 h-4 text-dark-400 hover:text-red-400" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent Tasks" />
        {tasks.length === 0 ? (
          <p className="text-dark-400">No tasks assigned to this agent</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Type</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Created</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.slice(0, 10).map((task) => (
                <TableRow
                  key={task.id}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <TableCell className="font-medium">{task.type}</TableCell>
                  <TableCell>
                    <Badge variant={taskStatusVariant[task.status]}>
                      {task.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-dark-400 text-xs">
                    {formatDate(task.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Edit Modal */}
      <Modal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        title={`Edit Agent: ${agent.name}`}
        size="lg"
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Textarea
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={typeOptions}
          />
          <Input
            label="Capabilities"
            value={form.capabilities}
            onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
            placeholder="coding, research, analysis"
          />
          <p className="text-dark-500 text-xs -mt-2">Comma-separated list</p>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowEdit(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={updateMutation.isPending}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Assign Skill Modal */}
      <Modal
        isOpen={showAssignSkill}
        onClose={() => setShowAssignSkill(false)}
        title="Assign Skill to Agent"
      >
        <div className="space-y-4">
          <p className="text-dark-400 text-sm">
            Select a skill to assign to <strong>{agent.name}</strong>
          </p>
          {!allSkillsData?.skills || allSkillsData.skills.length === 0 ? (
            <p className="text-dark-500 text-sm py-4 text-center">No skills available</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {allSkillsData.skills
                .filter((skill: Skill) => !assignedSkills?.some((s: Skill) => s.id === skill.id))
                .map((skill: Skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between p-3 bg-dark-800 rounded-lg hover:bg-dark-750 cursor-pointer transition-colors"
                    onClick={() => assignSkillMutation.mutate(skill.id)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary-400" />
                        <span className="font-medium">{skill.name}</span>
                        <Badge variant={skill.status === 'active' ? 'active' : 'inactive'} className="text-xs">
                          {skill.status}
                        </Badge>
                      </div>
                      {skill.description && (
                        <p className="text-dark-400 text-sm mt-1 ml-6">{skill.description}</p>
                      )}
                    </div>
                    <Plus className="w-4 h-4 text-dark-400" />
                  </div>
                ))}
              {allSkillsData.skills.filter((skill: Skill) => !assignedSkills?.some((s: Skill) => s.id === skill.id)).length === 0 && (
                <p className="text-dark-500 text-sm py-4 text-center">All skills are already assigned</p>
              )}
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowAssignSkill(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
