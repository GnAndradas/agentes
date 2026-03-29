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
  FileCode,
  Settings,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import { generationApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import { useTrackedMutation } from '../hooks/useTrackedMutation';
import { Button, Badge, Card, CardHeader } from '../components/ui';
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

  // Format content for display
  const contentJson = generation.generatedContent
    ? JSON.stringify(generation.generatedContent, null, 2)
    : null;
  const validationJson = generation.validationResult
    ? JSON.stringify(generation.validationResult, null, 2)
    : null;
  const metadataJson = generation.metadata
    ? JSON.stringify(generation.metadata, null, 2)
    : null;

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Details */}
        <Card className="lg:col-span-2">
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
              <p className="text-sm text-dark-400">Status</p>
              <Badge variant={statusVariant[generation.status]} className="mt-1">
                {generation.status.replace('_', ' ')}
              </Badge>
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
            {generation.approvedBy && (
              <div>
                <p className="text-sm text-dark-400">Approved By</p>
                <p className="text-sm mt-1">{generation.approvedBy}</p>
              </div>
            )}
            {generation.approvedAt && (
              <div>
                <p className="text-sm text-dark-400">Approved At</p>
                <p className="text-sm mt-1">{formatDate(generation.approvedAt)}</p>
              </div>
            )}
            {generation.activatedAt && (
              <div>
                <p className="text-sm text-dark-400">Activated At</p>
                <p className="text-sm mt-1">{formatDate(generation.activatedAt)}</p>
              </div>
            )}
            {generation.description && (
              <div className="col-span-2">
                <p className="text-sm text-dark-400">Description</p>
                <p className="text-sm mt-1">{generation.description}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Validation Result */}
        {validationJson && (
          <Card>
            <CardHeader title="Validation" />
            <pre className="text-xs font-mono bg-dark-900 p-3 rounded-lg overflow-auto max-h-48 text-green-400">
              {validationJson}
            </pre>
          </Card>
        )}
      </div>

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

      {/* Generated Content */}
      {contentJson && (
        <Card>
          <CardHeader
            title="Generated Content"
            action={
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-dark-400" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(contentJson)}
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            }
          />
          <pre className="text-xs font-mono bg-dark-900 p-4 rounded-lg overflow-auto max-h-96 text-primary-300">
            {contentJson}
          </pre>
        </Card>
      )}

      {/* Metadata */}
      {metadataJson && (
        <Card>
          <CardHeader
            title="Metadata"
            action={<Settings className="w-4 h-4 text-dark-400" />}
          />
          <pre className="text-xs font-mono bg-dark-900 p-3 rounded-lg overflow-auto max-h-48 text-dark-300">
            {metadataJson}
          </pre>
        </Card>
      )}
    </div>
  );
}
