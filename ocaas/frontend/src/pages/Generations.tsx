import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { History, CheckCircle, XCircle, Play, Bot, Sparkles, Wrench, Eye } from 'lucide-react';
import { generationApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import {
  Button,
  Badge,
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
import type { Generation } from '../types';
import { fromTimestamp } from '../lib/date';

const statusVariant = {
  draft: 'inactive',
  generated: 'pending',
  pending_approval: 'pending',
  approved: 'success',
  rejected: 'error',
  active: 'active',
  failed: 'error',
} as const;

const typeIcons = {
  agent: Bot,
  skill: Sparkles,
  tool: Wrench,
};

export function Generations() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ['generations'],
    queryFn: () => generationApi.list(),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => generationApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      addNotification({ type: 'success', title: 'Generation approved' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to approve', message: err.message });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => generationApi.reject(id, 'Rejected by user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      addNotification({ type: 'info', title: 'Generation rejected' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to reject', message: err.message });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => generationApi.activate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      addNotification({ type: 'success', title: 'Generation activated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to activate', message: err.message });
    },
  });

  const generations = data?.generations || [];
  const formatDate = (ts: number) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleString() : '-';
  };

  const canApprove = (g: Generation) =>
    g.status === 'generated' || g.status === 'pending_approval';
  const canActivate = (g: Generation) => g.status === 'approved';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Generations"
          description="Review and manage AI-generated content"
        />

        {isLoading ? (
          <div className="text-center py-8 text-dark-400">Loading...</div>
        ) : generations.length === 0 ? (
          <EmptyState
            icon={History}
            title="No generations"
            description="Use the Generator to create new content"
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Type</TableHeader>
                <TableHeader>Name</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Created</TableHeader>
                <TableHeader className="text-right">Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {generations.map((generation) => {
                const TypeIcon = typeIcons[generation.type];

                return (
                  <TableRow
                    key={generation.id}
                    onClick={() => navigate(`/generations/${generation.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <TypeIcon className="w-4 h-4 text-dark-400" />
                        <span className="capitalize">{generation.type}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{generation.name}</p>
                        <p className="text-dark-500 text-xs truncate max-w-xs">
                          {generation.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[generation.status]}>
                        {generation.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-dark-400 text-xs">
                      {formatDate(generation.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/generations/${generation.id}`);
                          }}
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canApprove(generation) && (
                          <>
                            <Button
                              variant="success"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                approveMutation.mutate(generation.id);
                              }}
                              loading={approveMutation.isPending}
                            >
                              <CheckCircle className="w-4 h-4" />
                              Approve
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                rejectMutation.mutate(generation.id);
                              }}
                              loading={rejectMutation.isPending}
                            >
                              <XCircle className="w-4 h-4" />
                              Reject
                            </Button>
                          </>
                        )}
                        {canActivate(generation) && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              activateMutation.mutate(generation.id);
                            }}
                            loading={activateMutation.isPending}
                          >
                            <Play className="w-4 h-4" />
                            Activate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
