import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Bot, Power, PowerOff, Trash2 } from 'lucide-react';
import { agentApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import {
  Button,
  Badge,
  Modal,
  Input,
  Textarea,
  Select,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  Card,
  CardHeader,
  EmptyState,
} from '../components/ui';
import type { Agent } from '../types';

const statusVariant = {
  active: 'active',
  inactive: 'inactive',
  busy: 'pending',
  error: 'error',
} as const;

const typeOptions = [
  { value: 'general', label: 'General' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'orchestrator', label: 'Orchestrator' },
];

export function Agents() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'general',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: agentApi.list,
  });

  const createMutation = useMutation({
    mutationFn: agentApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setShowCreate(false);
      setForm({ name: '', description: '', type: 'general' });
      addNotification({ type: 'success', title: 'Agent created' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to create agent', message: err.message });
    },
  });

  const activateMutation = useMutation({
    mutationFn: agentApi.activate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      addNotification({ type: 'success', title: 'Agent activated' });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: agentApi.deactivate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      addNotification({ type: 'info', title: 'Agent deactivated' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: agentApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      addNotification({ type: 'success', title: 'Agent deleted' });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: form.name,
      description: form.description,
      type: form.type as Agent['type'],
      capabilities: [],
      config: {},
    });
  };

  const agents = data?.agents || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Agents"
          description="Manage your AI agents"
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" />
              New Agent
            </Button>
          }
        />

        {isLoading ? (
          <div className="text-center py-8 text-dark-400">Loading...</div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents yet"
            description="Create your first agent to get started"
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4" />
                Create Agent
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Type</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Capabilities</TableHeader>
                <TableHeader className="text-right">Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {agents.map((agent) => (
                <TableRow
                  key={agent.id}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-dark-500 text-xs">{agent.description}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge>{agent.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[agent.status]}>
                      {agent.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {agent.capabilities.length > 0
                      ? agent.capabilities.slice(0, 3).join(', ')
                      : '-'}
                    {agent.capabilities.length > 3 &&
                      ` +${agent.capabilities.length - 3}`}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {agent.status === 'active' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            deactivateMutation.mutate(agent.id);
                          }}
                        >
                          <PowerOff className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            activateMutation.mutate(agent.id);
                          }}
                        >
                          <Power className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this agent?')) {
                            deleteMutation.mutate(agent.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Agent"
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
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
            required
          />
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={typeOptions}
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
