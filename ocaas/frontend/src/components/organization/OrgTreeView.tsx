import { useState } from 'react';
import { ChevronRight, ChevronDown, User, Crown, Briefcase, Users, Wrench } from 'lucide-react';
import { clsx } from 'clsx';
import { Badge } from '../ui';
import type { HierarchyNode, RoleType, Agent } from '../../types';

interface OrgTreeViewProps {
  tree: HierarchyNode[];
  agents: Map<string, Agent>;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

const roleIcons: Record<RoleType, React.ElementType> = {
  ceo: Crown,
  manager: Briefcase,
  supervisor: Users,
  worker: User,
  specialist: Wrench,
};

const roleColors: Record<RoleType, string> = {
  ceo: 'text-yellow-400',
  manager: 'text-blue-400',
  supervisor: 'text-green-400',
  worker: 'text-dark-300',
  specialist: 'text-purple-400',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-500',
  inactive: 'bg-dark-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
};

function TreeNode({
  node,
  agents,
  selectedAgentId,
  onSelectAgent,
  depth = 0,
}: {
  node: HierarchyNode;
  agents: Map<string, Agent>;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.subordinates.length > 0;
  const agent = agents.get(node.agentId);
  const Icon = roleIcons[node.roleType];
  const isSelected = selectedAgentId === node.agentId;

  return (
    <div className="select-none">
      <div
        className={clsx(
          'flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors',
          isSelected ? 'bg-primary-600/30 text-primary-300' : 'hover:bg-dark-700',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelectAgent(node.agentId)}
      >
        {/* Expand/collapse */}
        <button
          className="w-4 h-4 flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-dark-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-dark-400" />
            )
          ) : null}
        </button>

        {/* Role icon */}
        <Icon className={clsx('w-4 h-4', roleColors[node.roleType])} />

        {/* Status dot */}
        {agent && (
          <span
            className={clsx('w-2 h-2 rounded-full', statusColors[agent.status])}
            title={agent.status}
          />
        )}

        {/* Name */}
        <span className="text-sm font-medium truncate">
          {agent?.name || node.agentId}
        </span>

        {/* Role badge */}
        <Badge variant="default" className="text-xs ml-auto">
          {node.roleType}
        </Badge>

        {/* Subordinate count */}
        {hasChildren && (
          <span className="text-xs text-dark-500">({node.subordinates.length})</span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.subordinates.map((child) => (
            <TreeNode
              key={child.agentId}
              node={child}
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgTreeView({ tree, agents, selectedAgentId, onSelectAgent }: OrgTreeViewProps) {
  if (tree.length === 0) {
    return (
      <div className="text-center py-8 text-dark-400">
        <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No hierarchy configured</p>
        <p className="text-xs mt-1">Add agents to the organization</p>
      </div>
    );
  }

  return (
    <div className="py-2">
      {tree.map((node) => (
        <TreeNode
          key={node.agentId}
          node={node}
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
      ))}
    </div>
  );
}
