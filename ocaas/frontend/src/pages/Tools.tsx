import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Trash2, Terminal, Code, Globe, Edit2, CheckCircle } from 'lucide-react';
import { toolApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import {
  Button,
  Badge,
  Modal,
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
import { ToolEditor } from '../components/tools/ToolEditor';
import { fromTimestamp } from '../lib/date';
import type { Tool } from '../types';

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
  const [editingTool, setEditingTool] = useState<Tool | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tools'],
    queryFn: toolApi.list,
  });

  const createMutation = useMutation({
    mutationFn: toolApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      setShowCreate(false);
      addNotification({ type: 'success', title: 'Tool created' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to create tool', message: err.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Tool> }) => toolApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      setEditingTool(null);
      addNotification({ type: 'success', title: 'Tool updated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to update tool', message: err.message });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' | 'deprecated' }) =>
      toolApi.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
    },
  });

  const validateMutation = useMutation({
    mutationFn: toolApi.validateExisting,
    onSuccess: (result) => {
      if (result.valid) {
        addNotification({
          type: 'success',
          title: 'Validation Passed',
          message: `Score: ${result.score}/100`,
        });
      } else {
        addNotification({
          type: 'warning',
          title: 'Validation Issues',
          message: `${result.issues.filter(i => i.severity === 'error').length} errors found`,
        });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: toolApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      addNotification({ type: 'success', title: 'Tool deleted' });
    },
  });

  const handleCreate = (data: Partial<Tool>) => {
    createMutation.mutate(data);
  };

  const handleUpdate = (data: Partial<Tool>) => {
    if (editingTool) {
      updateMutation.mutate({ id: editingTool.id, data });
    }
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
                          <p className="text-dark-500 text-xs truncate max-w-[200px]">
                            {tool.description || tool.path}
                          </p>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingTool(tool)}
                          title="Edit tool"
                        >
                          <Edit2 className="w-4 h-4 text-dark-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => validateMutation.mutate(tool.id)}
                          title="Validate tool"
                          loading={validateMutation.isPending && validateMutation.variables === tool.id}
                        >
                          <CheckCircle className="w-4 h-4 text-dark-400" />
                        </Button>
                        <Select
                          value={tool.status}
                          onChange={(e) =>
                            updateStatusMutation.mutate({
                              id: tool.id,
                              status: e.target.value as 'active' | 'inactive' | 'deprecated',
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

      {/* Create Modal */}
      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Tool"
        size="xl"
      >
        <ToolEditor
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingTool}
        onClose={() => setEditingTool(null)}
        title={`Edit Tool: ${editingTool?.name}`}
        size="xl"
      >
        {editingTool && (
          <ToolEditor
            tool={editingTool}
            onSave={handleUpdate}
            onCancel={() => setEditingTool(null)}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>
    </div>
  );
}
