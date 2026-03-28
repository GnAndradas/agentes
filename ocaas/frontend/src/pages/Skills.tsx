import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, RefreshCw, Trash2 } from 'lucide-react';
import { skillApi } from '../lib/api';
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

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'deprecated', label: 'Deprecated' },
];

const statusVariant = {
  active: 'active',
  inactive: 'inactive',
  deprecated: 'error',
} as const;

export function Skills() {
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    version: '1.0.0',
    path: '',
    status: 'active',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: skillApi.list,
  });

  const createMutation = useMutation({
    mutationFn: skillApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setShowCreate(false);
      setForm({ name: '', description: '', version: '1.0.0', path: '', status: 'active' });
      addNotification({ type: 'success', title: 'Skill created' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to create skill', message: err.message });
    },
  });

  const syncMutation = useMutation({
    mutationFn: skillApi.sync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      addNotification({ type: 'success', title: 'Skills synchronized' });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      skillApi.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: skillApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      addNotification({ type: 'success', title: 'Skill deleted' });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: form.name,
      description: form.description,
      version: form.version,
      path: form.path,
      status: form.status as 'active' | 'inactive' | 'deprecated',
    });
  };

  const skills = data?.skills || [];
  const formatDate = (ts?: number) => ts ? new Date(ts).toLocaleDateString() : '-';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Skills"
          description="Manage reusable agent skills"
          action={
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => syncMutation.mutate()}
                loading={syncMutation.isPending}
              >
                <RefreshCw className="w-4 h-4" />
                Sync
              </Button>
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4" />
                New Skill
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <div className="text-center py-8 text-dark-400">Loading...</div>
        ) : skills.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No skills"
            description="Create skills to extend agent capabilities"
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4" />
                Create Skill
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Version</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Synced</TableHeader>
                <TableHeader className="text-right">Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {skills.map((skill) => (
                <TableRow key={skill.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{skill.name}</p>
                      <p className="text-dark-500 text-xs">{skill.description}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge>{skill.version}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[skill.status]}>
                      {skill.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-dark-400 text-xs">
                    {formatDate(skill.syncedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Select
                        value={skill.status}
                        onChange={(e) =>
                          updateStatusMutation.mutate({
                            id: skill.id,
                            status: e.target.value,
                          })
                        }
                        options={statusOptions}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Delete this skill?')) {
                            deleteMutation.mutate(skill.id);
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
        title="Create Skill"
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
            placeholder="/skills/my-skill"
            required
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
