import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Power, PowerOff, Trash2, Edit2 } from 'lucide-react';
import { agentApi, taskApi } from '../lib/api';
import { useAppStore } from '../stores/app';
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
} from '../components/ui';

const statusVariant = {
  active: 'active',
  inactive: 'inactive',
  busy: 'pending',
  error: 'error',
} as const;

const taskStatusVariant = {
  pending: 'pending',
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
  });

  if (isLoading) {
    return <div className="text-center py-8 text-dark-400">Loading...</div>;
  }

  if (!agent) {
    return <div className="text-center py-8 text-dark-400">Agent not found</div>;
  }

  const tasks = tasksData?.tasks || [];
  const formatDate = (ts: number) => new Date(ts).toLocaleString();

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
          {agent.capabilities.length === 0 ? (
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
    </div>
  );
}
