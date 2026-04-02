import { useState, useEffect } from 'react';
import { Crown, Briefcase, Users, User, Wrench, ArrowUpRight, Shield, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Badge, Select, Card } from '../ui';
import type { AgentOrgProfile, Agent, WorkProfile, RoleType, EffectivePolicies } from '../../types';

interface OrgNodeEditorProps {
  agentId: string;
  agent: Agent | undefined;
  profile: AgentOrgProfile | null;
  profiles: WorkProfile[];
  agents: Agent[];
  escalationChain: Array<{ agentId: string; roleType: RoleType }>;
  effectivePolicies: EffectivePolicies | null;
  onSave: (data: {
    roleType: RoleType;
    supervisorAgentId: string | null;
    workProfileId: string;
    department?: string;
  }) => void;
  onDelete: () => void;
  isSaving: boolean;
}

const roleOptions: Array<{ value: RoleType; label: string }> = [
  { value: 'ceo', label: 'CEO' },
  { value: 'manager', label: 'Manager' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'worker', label: 'Worker' },
];

const roleIcons: Record<RoleType, React.ElementType> = {
  ceo: Crown,
  manager: Briefcase,
  supervisor: Users,
  worker: User,
  specialist: Wrench,
};

export function OrgNodeEditor({
  agentId,
  agent,
  profile,
  profiles,
  agents,
  escalationChain,
  effectivePolicies,
  onSave,
  onDelete,
  isSaving,
}: OrgNodeEditorProps) {
  const [roleType, setRoleType] = useState<RoleType>(profile?.roleType || 'worker');
  const [supervisorAgentId, setSupervisorAgentId] = useState<string>(profile?.supervisorAgentId || '');
  const [workProfileId, setWorkProfileId] = useState<string>(profile?.workProfileId || profiles[0]?.id || '');
  const [department, setDepartment] = useState<string>(profile?.department || '');

  // Update form when profile changes
  useEffect(() => {
    if (profile) {
      setRoleType(profile.roleType);
      setSupervisorAgentId(profile.supervisorAgentId || '');
      setWorkProfileId(profile.workProfileId);
      setDepartment(profile.department || '');
    } else {
      setRoleType('worker');
      setSupervisorAgentId('');
      setWorkProfileId(profiles[0]?.id || '');
      setDepartment('');
    }
  }, [profile, profiles]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      roleType,
      supervisorAgentId: supervisorAgentId || null,
      workProfileId,
      department: department || undefined,
    });
  };

  // Filter potential supervisors (can't be self, should be higher in hierarchy)
  const potentialSupervisors = agents.filter((a) => a.id !== agentId);

  const RoleIcon = roleIcons[roleType];

  if (!agent) {
    return (
      <div className="text-center py-8 text-dark-400">
        <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>Select an agent from the tree</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Agent Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-dark-700">
        <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center bg-dark-700')}>
          <RoleIcon className="w-5 h-5 text-primary-400" />
        </div>
        <div>
          <h3 className="font-semibold">{agent.name}</h3>
          <p className="text-xs text-dark-400">{agent.type} • {agent.status}</p>
        </div>
        <Badge variant={profile ? 'active' : 'inactive'} className="ml-auto">
          {profile ? 'In Org' : 'Not Assigned'}
        </Badge>
      </div>

      {/* Edit Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Role */}
        <div>
          <label className="block text-sm text-dark-300 mb-1">Role</label>
          <Select
            value={roleType}
            onChange={(e) => setRoleType(e.target.value as RoleType)}
            options={roleOptions}
          />
        </div>

        {/* Supervisor */}
        <div>
          <label className="block text-sm text-dark-300 mb-1">Reports To</label>
          <Select
            value={supervisorAgentId}
            onChange={(e) => setSupervisorAgentId(e.target.value)}
            options={[
              { value: '', label: '— None (Top Level) —' },
              ...potentialSupervisors.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </div>

        {/* Work Profile */}
        <div>
          <label className="block text-sm text-dark-300 mb-1">Work Profile</label>
          <Select
            value={workProfileId}
            onChange={(e) => setWorkProfileId(e.target.value)}
            options={profiles.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.preset})`,
            }))}
          />
        </div>

        {/* Department */}
        <div>
          <label className="block text-sm text-dark-300 mb-1">Department</label>
          <input
            type="text"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g., Engineering, Sales"
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={isSaving} className="flex-1">
            {profile ? 'Update' : 'Add to Org'}
          </Button>
          {profile && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (confirm('Remove from organization?')) onDelete();
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </form>

      {/* Escalation Chain */}
      {escalationChain.length > 0 && (
        <Card className="mt-4 p-3">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpRight className="w-4 h-4 text-dark-400" />
            <span className="text-sm font-medium">Escalation Path</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {escalationChain.map((step, i) => {
              const stepAgent = agents.find((a) => a.id === step.agentId);
              return (
                <Badge key={step.agentId} variant="default" className="text-xs">
                  {i + 1}. {stepAgent?.name || step.agentId} ({step.roleType})
                </Badge>
              );
            })}
            <Badge variant="pending" className="text-xs">Human</Badge>
          </div>
        </Card>
      )}

      {/* Effective Policies Summary */}
      {effectivePolicies && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          {/* Autonomy */}
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-medium">Autonomy</span>
            </div>
            <div className="space-y-1 text-xs text-dark-400">
              <p>Max Complexity: {effectivePolicies.autonomy.maxComplexity}/10</p>
              <p>Max Priority: {effectivePolicies.autonomy.maxPriority}/4</p>
              <p>Can Delegate: {effectivePolicies.autonomy.canDelegate ? 'Yes' : 'No'}</p>
              <p>Can Create: {effectivePolicies.autonomy.canCreateResources ? 'Yes' : 'No'}</p>
            </div>
          </Card>

          {/* Escalation */}
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium">Escalation</span>
            </div>
            <div className="space-y-1 text-xs text-dark-400">
              <p>Can Escalate: {effectivePolicies.escalation.canEscalate ? 'Yes' : 'No'}</p>
              <p>Max Retries: {effectivePolicies.escalation.maxRetriesBeforeEscalate}</p>
              <p>Timeout: {Math.round(effectivePolicies.escalation.escalateTimeoutMs / 1000)}s</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
