import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Network, Users, Plus, RefreshCw } from 'lucide-react';
import { orgApi, agentApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import { OrgTreeView, OrgNodeEditor } from '../components/organization';
import { Button, Card, CardHeader, Modal, Select, Badge, EmptyState } from '../components/ui';
import type { RoleType } from '../types';

export function Organization() {
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addAgentId, setAddAgentId] = useState('');
  const [addRole, setAddRole] = useState<RoleType>('worker');

  // Fetch data
  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['org', 'tree'],
    queryFn: () => orgApi.getHierarchyTree(),
  });

  const { data: hierarchyData } = useQuery({
    queryKey: ['org', 'hierarchy'],
    queryFn: () => orgApi.listHierarchy(),
  });

  const { data: profilesData } = useQuery({
    queryKey: ['org', 'profiles'],
    queryFn: () => orgApi.listProfiles(),
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: agentApi.list,
  });

  // Fetch selected agent data
  const { data: selectedProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['org', 'profile', selectedAgentId],
    queryFn: () => orgApi.getAgentProfile(selectedAgentId!),
    enabled: !!selectedAgentId,
    retry: false,
  });

  const { data: escalationChain } = useQuery({
    queryKey: ['org', 'escalation', selectedAgentId],
    queryFn: () => orgApi.getEscalationChain(selectedAgentId!),
    enabled: !!selectedAgentId && !!selectedProfile,
  });

  const { data: effectivePolicies } = useQuery({
    queryKey: ['org', 'policies', selectedAgentId],
    queryFn: () => orgApi.getEffectivePolicies(selectedAgentId!),
    enabled: !!selectedAgentId && !!selectedProfile,
  });

  // Mutations
  const upsertMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: Parameters<typeof orgApi.upsertAgentProfile>[1] }) =>
      orgApi.upsertAgentProfile(agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org'] });
      addNotification({ type: 'success', title: 'Organization updated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to update', message: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (agentId: string) => orgApi.deleteAgentProfile(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org'] });
      setSelectedAgentId(null);
      addNotification({ type: 'success', title: 'Removed from organization' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to remove', message: err.message });
    },
  });

  // Derived data
  const agents = agentsData?.agents || [];
  const agentsMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const tree = treeData || [];
  const profiles = profilesData || [];
  const hierarchy = hierarchyData || [];

  // Agents not yet in hierarchy
  const agentsInOrg = new Set(hierarchy.map((p) => p.agentId));
  const unassignedAgents = agents.filter((a) => !agentsInOrg.has(a.id));

  const selectedAgent = selectedAgentId ? agentsMap.get(selectedAgentId) : undefined;

  const handleAddToOrg = () => {
    if (!addAgentId) return;
    upsertMutation.mutate({
      agentId: addAgentId,
      data: {
        roleType: addRole,
        supervisorAgentId: null,
        workProfileId: profiles[0]?.id || 'balanced',
      },
    });
    setShowAddModal(false);
    setAddAgentId('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader
          title="Organization"
          description="Manage agent hierarchy, roles, and policies"
          action={
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['org'] })}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              {unassignedAgents.length > 0 && (
                <Button onClick={() => setShowAddModal(true)}>
                  <Plus className="w-4 h-4" />
                  Add Agent
                </Button>
              )}
            </div>
          }
        />
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-600/20 flex items-center justify-center">
              <Network className="w-5 h-5 text-primary-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{hierarchy.length}</p>
              <p className="text-xs text-dark-400">In Organization</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-600/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{unassignedAgents.length}</p>
              <p className="text-xs text-dark-400">Unassigned</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-center">
            <p className="text-lg font-semibold">{tree.length}</p>
            <p className="text-xs text-dark-400">Top-Level Nodes</p>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-center">
            <p className="text-lg font-semibold">{profiles.length}</p>
            <p className="text-xs text-dark-400">Work Profiles</p>
          </div>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Tree View */}
        <Card className="col-span-2 min-h-[500px]">
          <CardHeader title="Hierarchy" />
          {treeLoading ? (
            <div className="text-center py-8 text-dark-400">Loading...</div>
          ) : tree.length === 0 && unassignedAgents.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No agents available"
              description="Create agents first to build your organization"
            />
          ) : tree.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No hierarchy yet"
              description="Add agents to the organization to see the tree"
              action={
                <Button onClick={() => setShowAddModal(true)}>
                  <Plus className="w-4 h-4" />
                  Add First Agent
                </Button>
              }
            />
          ) : (
            <OrgTreeView
              tree={tree}
              agents={agentsMap}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
            />
          )}
        </Card>

        {/* Editor Panel */}
        <Card className="min-h-[500px]">
          <CardHeader title="Agent Details" />
          <div className="p-4">
            {selectedAgentId ? (
              profileLoading ? (
                <div className="text-center py-8 text-dark-400">Loading...</div>
              ) : (
                <OrgNodeEditor
                  agentId={selectedAgentId}
                  agent={selectedAgent}
                  profile={selectedProfile || null}
                  profiles={profiles}
                  agents={agents}
                  escalationChain={escalationChain || []}
                  effectivePolicies={effectivePolicies || null}
                  onSave={(data) => upsertMutation.mutate({ agentId: selectedAgentId, data })}
                  onDelete={() => deleteMutation.mutate(selectedAgentId)}
                  isSaving={upsertMutation.isPending}
                />
              )
            ) : (
              <div className="text-center py-8 text-dark-400">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Select an agent from the tree</p>
                <p className="text-xs mt-1">or add a new one to the organization</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Unassigned Agents */}
      {unassignedAgents.length > 0 && (
        <Card>
          <CardHeader title="Unassigned Agents" />
          <div className="p-4 flex flex-wrap gap-2">
            {unassignedAgents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => {
                  setAddAgentId(agent.id);
                  setShowAddModal(true);
                }}
                className="flex items-center gap-2 px-3 py-2 bg-dark-700 rounded-lg hover:bg-dark-600 transition-colors"
              >
                <span className="text-sm">{agent.name}</span>
                <Badge variant="inactive" className="text-xs">{agent.type}</Badge>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Add Agent Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Agent to Organization">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dark-300 mb-1">Agent</label>
            <Select
              value={addAgentId}
              onChange={(e) => setAddAgentId(e.target.value)}
              options={[
                { value: '', label: '— Select Agent —' },
                ...unassignedAgents.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm text-dark-300 mb-1">Initial Role</label>
            <Select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as RoleType)}
              options={[
                { value: 'ceo', label: 'CEO' },
                { value: 'manager', label: 'Manager' },
                { value: 'supervisor', label: 'Supervisor' },
                { value: 'specialist', label: 'Specialist' },
                { value: 'worker', label: 'Worker' },
              ]}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddToOrg} disabled={!addAgentId} loading={upsertMutation.isPending}>
              Add
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
