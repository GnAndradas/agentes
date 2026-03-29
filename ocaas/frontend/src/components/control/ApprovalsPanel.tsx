import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Clock, AlertTriangle, Bot, Sparkles, Wrench, ListTodo } from 'lucide-react';
import { approvalApi } from '../../lib/api';
import { fromTimestamp } from '../../lib/date';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { Approval } from '../../types';

const typeIcons = {
  agent: Bot,
  skill: Sparkles,
  tool: Wrench,
  task: ListTodo,
};

const typeColors = {
  agent: 'text-primary-400',
  skill: 'text-purple-400',
  tool: 'text-orange-400',
  task: 'text-green-400',
};

function formatTime(timestamp: number): string {
  const date = fromTimestamp(timestamp);
  if (!date) return '-';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ApprovalItem({ approval, onApprove, onReject, isLoading }: {
  approval: Approval;
  onApprove: () => void;
  onReject: () => void;
  isLoading: boolean;
}) {
  const Icon = typeIcons[approval.type] || AlertTriangle;
  const colorClass = typeColors[approval.type] || 'text-dark-400';
  const metadata = approval.metadata as Record<string, unknown> | undefined;

  return (
    <div className="flex items-start gap-3 p-3 bg-dark-900 rounded-lg">
      <div className={`p-2 rounded-lg bg-dark-800 ${colorClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm capitalize">{approval.type}</span>
          <Badge variant="pending">pending</Badge>
        </div>
        <p className="text-sm text-dark-400 truncate mt-1">
          {metadata?.name as string || metadata?.title as string || approval.resourceId || 'No details'}
        </p>
        <p className="text-xs text-dark-500 mt-1">
          <Clock className="w-3 h-3 inline mr-1" />
          {formatTime(approval.requestedAt)}
        </p>
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="success"
          onClick={onApprove}
          disabled={isLoading}
          title="Approve"
        >
          <CheckCircle className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={onReject}
          disabled={isLoading}
          title="Reject"
        >
          <XCircle className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export function ApprovalsPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: approvalApi.getPending,
    refetchInterval: 5000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalApi.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  const approvals = data?.approvals || [];
  const isPending = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          Pending Approvals
        </h2>
        {approvals.length > 0 && (
          <Badge variant="pending">{approvals.length}</Badge>
        )}
      </div>

      {isLoading ? (
        <div className="text-dark-400 text-sm">Loading...</div>
      ) : approvals.length === 0 ? (
        <div className="text-dark-400 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />
          No pending approvals
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {approvals.map((approval) => (
            <ApprovalItem
              key={approval.id}
              approval={approval}
              onApprove={() => approveMutation.mutate(approval.id)}
              onReject={() => rejectMutation.mutate(approval.id)}
              isLoading={isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
