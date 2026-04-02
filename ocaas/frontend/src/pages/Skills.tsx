import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2, Edit2, Wrench, Play } from 'lucide-react';
import { skillApi } from '../lib/api';
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
import { SkillEditor } from '../components/skills/SkillEditor';
import { SkillExecutionPanel } from '../components/skills/SkillExecutionPanel';
import { fromTimestamp } from '../lib/date';
import type { Skill, SkillToolLink } from '../types';

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
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [executingSkill, setExecutingSkill] = useState<Skill | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => skillApi.list({ expand: 'toolCount' }),
  });

  const createMutation = useMutation({
    mutationFn: async ({ skill, tools }: { skill: Partial<Skill>; tools?: SkillToolLink[] }) => {
      const created = await skillApi.create(skill);
      if (tools && tools.length > 0) {
        await skillApi.setTools(created.id, tools);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setShowCreate(false);
      addNotification({ type: 'success', title: 'Skill created' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to create skill', message: err.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, skill, tools }: { id: string; skill: Partial<Skill>; tools?: SkillToolLink[] }) => {
      const updated = await skillApi.update(id, skill);
      if (tools !== undefined) {
        await skillApi.setTools(id, tools);
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setEditingSkill(null);
      addNotification({ type: 'success', title: 'Skill updated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to update skill', message: err.message });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' | 'deprecated' }) =>
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

  const handleCreate = (skillData: Partial<Skill>, tools?: SkillToolLink[]) => {
    createMutation.mutate({ skill: skillData, tools });
  };

  const handleUpdate = (skillData: Partial<Skill>, tools?: SkillToolLink[]) => {
    if (editingSkill) {
      updateMutation.mutate({ id: editingSkill.id, skill: skillData, tools });
    }
  };

  const skills = data?.skills || [];
  const formatDate = (ts?: number) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleDateString() : '-';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Skills"
          description="Manage reusable agent skills composed of tools"
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" />
              New Skill
            </Button>
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
                <TableHeader>Tools</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Synced</TableHeader>
                <TableHeader className="text-right">Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {skills.map((skill) => (
                <TableRow key={skill.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-dark-900 rounded-lg">
                        <Sparkles className="w-4 h-4 text-dark-400" />
                      </div>
                      <div>
                        <p className="font-medium">{skill.name}</p>
                        <p className="text-dark-500 text-xs truncate max-w-[200px]">
                          {skill.description || skill.path}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge>{skill.version}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-dark-400">
                      <Wrench className="w-3 h-3" />
                      <span className="text-sm">{skill.toolCount ?? 0}</span>
                    </div>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExecutingSkill(skill)}
                        title="Execute skill"
                        disabled={skill.status !== 'active' || (skill.toolCount ?? 0) === 0}
                      >
                        <Play className="w-4 h-4 text-green-400" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingSkill(skill)}
                        title="Edit skill"
                      >
                        <Edit2 className="w-4 h-4 text-dark-400" />
                      </Button>
                      <Select
                        value={skill.status}
                        onChange={(e) =>
                          updateStatusMutation.mutate({
                            id: skill.id,
                            status: e.target.value as 'active' | 'inactive' | 'deprecated',
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

      {/* Create Modal */}
      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Skill"
        size="xl"
      >
        <SkillEditor
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingSkill}
        onClose={() => setEditingSkill(null)}
        title={`Edit Skill: ${editingSkill?.name}`}
        size="xl"
      >
        {editingSkill && (
          <SkillEditor
            skill={editingSkill}
            onSave={handleUpdate}
            onCancel={() => setEditingSkill(null)}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      {/* Execute Modal */}
      <Modal
        isOpen={!!executingSkill}
        onClose={() => setExecutingSkill(null)}
        title={`Execute Skill: ${executingSkill?.name}`}
        size="xl"
      >
        {executingSkill && (
          <SkillExecutionPanel
            skill={executingSkill}
            onClose={() => setExecutingSkill(null)}
          />
        )}
      </Modal>
    </div>
  );
}
