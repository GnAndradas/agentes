import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Sparkles,
  Wrench,
  CheckCircle,
  XCircle,
  Play,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import { generationApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import { useTrackedMutation } from '../hooks/useTrackedMutation';
import { Button, Badge, Card, CardHeader } from '../components/ui';
import { fromTimestamp } from '../lib/date';
import {
  GenerationOriginPanel,
  GenerationContentPanel,
  GenerationLifecyclePanel,
  GenerationResourceLink,
} from '../components/generations';

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

const typeColors = {
  agent: 'text-primary-400',
  skill: 'text-purple-400',
  tool: 'text-orange-400',
};

export function GenerationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [copied, setCopied] = useState(false);

  const { data: generation, isLoading } = useQuery({
    queryKey: ['generations', id],
    queryFn: () => generationApi.get(id!),
    enabled: !!id,
  });

  const approveMutation = useTrackedMutation({
    mutationFn: () => generationApi.approve(id!),
    activityType: 'approval',
    activityMessage: () => `Approving: ${generation?.name || id}`,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generations', id] });
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      addNotification({ type: 'success', title: 'Generation approved and activated' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to approve', message: err.message });
    },
  });

  const rejectMutation = useTrackedMutation({
    mutationFn: () => generationApi.reject(id!, 'Rejected by user'),
    activityType: 'approval',
    activityMessage: () => `Rejecting: ${generation?.name || id}`,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generations', id] });
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      addNotification({ type: 'info', title: 'Generation rejected' });
    },
  });

  const activateMutation = useTrackedMutation({
    mutationFn: () => generationApi.activate(id!),
    activityType: 'generation',
    activityMessage: () => `Activating: ${generation?.name || id}`,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generations', id] });
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      addNotification({ type: 'success', title: 'Generation activated' });
    },
  });

  const formatDate = (ts: number | undefined) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleString() : '-';
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-dark-400">Loading...</div>;
  }

  if (!generation) {
    return <div className="text-center py-8 text-dark-400">Generation not found</div>;
  }

  const TypeIcon = typeIcons[generation.type];
  const typeColor = typeColors[generation.type];
  const canApprove = generation.status === 'generated' || generation.status === 'pending_approval';
  const canActivate = generation.status === 'approved';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/generations')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className={`p-3 rounded-lg bg-dark-800 ${typeColor}`}>
          <TypeIcon className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{generation.name}</h1>
            <Badge variant={statusVariant[generation.status]}>
              {generation.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-dark-400">
            {generation.type.charAt(0).toUpperCase() + generation.type.slice(1)} Generation
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canApprove && (
            <>
              <Button
                variant="success"
                onClick={() => approveMutation.mutate()}
                loading={approveMutation.isPending}
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </Button>
              <Button
                variant="danger"
                onClick={() => rejectMutation.mutate()}
                loading={rejectMutation.isPending}
              >
                <XCircle className="w-4 h-4" />
                Reject
              </Button>
            </>
          )}
          {canActivate && (
            <Button
              variant="primary"
              onClick={() => activateMutation.mutate()}
              loading={activateMutation.isPending}
            >
              <Play className="w-4 h-4" />
              Activate
            </Button>
          )}
        </div>
      </div>

      {/* Error message if failed */}
      {generation.errorMessage && (
        <Card className="border-red-800 bg-red-900/10">
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-400">Generation Failed</p>
              <p className="text-sm text-red-300 mt-1">{generation.errorMessage}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Resource Link - Top banner when active */}
      <GenerationResourceLink generation={generation} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Details */}
          <Card>
            <CardHeader title="Details" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-dark-400">Type</p>
                <div className="flex items-center gap-2 mt-1">
                  <TypeIcon className={`w-4 h-4 ${typeColor}`} />
                  <span className="capitalize">{generation.type}</span>
                </div>
              </div>
              <div>
                <p className="text-sm text-dark-400">Target Path</p>
                <p className="text-sm mt-1 font-mono text-dark-300">
                  {generation.targetPath || '-'}
                </p>
              </div>
              <div>
                <p className="text-sm text-dark-400">Created</p>
                <p className="text-sm mt-1">{formatDate(generation.createdAt)}</p>
              </div>
              {generation.description && (
                <div className="col-span-2">
                  <p className="text-sm text-dark-400">Description</p>
                  <p className="text-sm mt-1">{generation.description}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Generated Content - Specialized by Type */}
          <Card>
            <CardHeader title="Generated Content" />
            <GenerationContentPanel generation={generation} />
          </Card>

          {/* Prompt */}
          {generation.prompt && (
            <Card>
              <CardHeader
                title="Generation Prompt"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(generation.prompt)}
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </Button>
                }
              />
              <pre className="text-sm font-mono bg-dark-900 p-4 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
                {generation.prompt}
              </pre>
            </Card>
          )}
        </div>

        {/* Right Column - Lifecycle & Origin */}
        <div className="space-y-6">
          {/* Lifecycle & Validation */}
          <Card>
            <CardHeader title="Lifecycle" />
            <GenerationLifecyclePanel generation={generation} />
          </Card>

          {/* Origin */}
          <Card>
            <CardHeader title="Origin" />
            <GenerationOriginPanel generation={generation} />
          </Card>
        </div>
      </div>
    </div>
  );
}
