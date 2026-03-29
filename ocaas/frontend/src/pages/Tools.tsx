import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Trash2, Terminal, Code, Globe } from 'lucide-react';
import { toolApi } from '../lib/api';
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
import { fromTimestamp } from '../lib/date';

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

const typeIcons = {
  script: Terminal,
  binary: Code,
  api: Globe,
};

const statusVariant = {
  active: 'active',
  inactive: 'inactive',
  deprecated: 'error',
} as const;

export function Tools() {
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    version: '1.0.0',
    path: '',
    type: 'script',
    status: 'active',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tools'],
    queryFn: toolApi.list,
  });

  const createMutation = useMutation({
    mutationFn: toolApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      setShowCreate(false);
      setForm({ name: '', description: '', version: '1.0.0', path: '', type: 'script', status: 'active' });
      addNotification({ type: 'success', title: 'Tool created' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to create tool', message: err.message });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      toolApi.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: toolApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      addNotification({ type: 'success', title: 'Tool deleted' });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: form.name,
      description: form.description,
      version: form.version,
      path: form.path,
      type: form.type as 'script' | 'binary' | 'api',
      status: form.status as 'active' | 'inactive' | 'deprecated',
    });
  };

  const tools = data?.tools || [];
  const formatDate = (ts?: number) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleDateString() : '-';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Tools"
          description="Manage executable tools for agents"
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" />
              New Tool
            </Button>
          }
        />

        {isLoading ? (
          <div className="text-center py-8 text-dark-400">Loading...</div>
        ) : tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No tools"
            description="Create tools for agents to execute"
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4" />
                Create Tool
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Type</TableHeader>
                <TableHeader>Version</TableHeader>
                <TableHeader>Executions</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader className="text-right">Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {tools.map((tool) => {
                const TypeIcon = typeIcons[tool.type] || Wrench;

                return (
                  <TableRow key={tool.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-dark-900 rounded-lg">
                          <TypeIcon className="w-4 h-4 text-dark-400" />
                        </div>
                        <div>
                          <p className="font-medium">{tool.name}</p>
                          <p className="text-dark-500 text-xs">{tool.description}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge>{tool.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-dark-400">{tool.version}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-dark-400">{tool.executionCount} runs</span>
                      {tool.lastExecutedAt && (
                        <p className="text-dark-500 text-xs">Last: {formatDate(tool.lastExecutedAt)}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[tool.status]}>
                        {tool.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Select
                          value={tool.status}
                          onChange={(e) =>
                            updateStatusMutation.mutate({
                              id: tool.id,
                              status: e.target.value,
                            })
                          }
                          options={statusOptions}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm('Delete this tool?')) {
                              deleteMutation.mutate(tool.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Tool"
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
          />
          <Input
            label="Version"
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            placeholder="1.0.0"
          />
          <Input
            label="Path"
            value={form.path}
            onChange={(e) => setForm({ ...form, path: e.target.value })}
            placeholder="/tools/my-tool"
            required
          />
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={typeOptions}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={statusOptions}
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
