import { AlertTriangle, Wrench, Sparkles, Shield, Database, Hand, Wand2 } from 'lucide-react';
import { Button, Badge, Card } from '../ui';
import type { JobBlocked } from '../../types';

interface BlockedJobViewProps {
  blocked: JobBlocked;
  jobId: string;
  onApproveGeneration?: (suggestion: JobBlocked['suggestions'][0]) => void;
  onReject?: () => void;
  isGenerating?: boolean;
}

// jobId is available for future use (e.g., displaying in UI or for tracking)

const missingTypeIcons: Record<string, React.ElementType> = {
  tool: Wrench,
  skill: Sparkles,
  capability: Shield,
  permission: Shield,
  data: Database,
};

const suggestionTypeLabels: Record<string, string> = {
  create_tool: 'Create Tool',
  create_skill: 'Create Skill',
  request_permission: 'Request Permission',
  provide_data: 'Provide Data',
  manual_action: 'Manual Action',
};

export function BlockedJobView({
  blocked,
  jobId: _jobId,
  onApproveGeneration,
  onReject,
  isGenerating,
}: BlockedJobViewProps) {
  void _jobId; // Reserved for future use (tracking, display)
  const autoGeneratable = blocked.suggestions.filter((s) => s.canAutoGenerate);
  const manualRequired = blocked.suggestions.filter((s) => !s.canAutoGenerate);

  return (
    <Card className="border-yellow-500/50 bg-yellow-500/5">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-dark-700">
        <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-yellow-400">Job Blocked</h3>
          <p className="text-sm text-dark-400">{blocked.description}</p>
        </div>
        {blocked.requiresHuman && (
          <Badge variant="pending" className="text-xs">
            <Hand className="w-3 h-3 mr-1" />
            Needs Human
          </Badge>
        )}
      </div>

      {/* Missing Resources */}
      <div className="p-4 border-b border-dark-700">
        <h4 className="text-sm font-medium text-dark-300 mb-3">Missing Resources</h4>
        <div className="space-y-2">
          {blocked.missing.map((item, i) => {
            const Icon = missingTypeIcons[item.type] || AlertTriangle;
            return (
              <div
                key={i}
                className="flex items-center gap-3 p-2 bg-dark-800 rounded-lg"
              >
                <Icon className="w-4 h-4 text-dark-400" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{item.identifier}</span>
                    <Badge variant="default" className="text-xs">{item.type}</Badge>
                    {item.required && (
                      <Badge variant="error" className="text-xs">Required</Badge>
                    )}
                  </div>
                  <p className="text-xs text-dark-500 truncate">{item.reason}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Suggestions */}
      {blocked.suggestions.length > 0 && (
        <div className="p-4">
          <h4 className="text-sm font-medium text-dark-300 mb-3">Resolution Options</h4>

          {/* Auto-generatable */}
          {autoGeneratable.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-dark-500 mb-2">Can be auto-generated:</p>
              <div className="space-y-2">
                {autoGeneratable.map((suggestion, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg border border-dark-700"
                  >
                    <Wand2 className="w-4 h-4 text-primary-400" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{suggestion.target}</span>
                        <Badge
                          variant={
                            suggestion.priority === 'required' ? 'error' :
                            suggestion.priority === 'recommended' ? 'pending' :
                            'default'
                          }
                          className="text-xs"
                        >
                          {suggestion.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-dark-500">{suggestion.description}</p>
                    </div>
                    {onApproveGeneration && (
                      <Button
                        size="sm"
                        onClick={() => onApproveGeneration(suggestion)}
                        loading={isGenerating}
                      >
                        Generate
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual required */}
          {manualRequired.length > 0 && (
            <div>
              <p className="text-xs text-dark-500 mb-2">Requires manual action:</p>
              <div className="space-y-2">
                {manualRequired.map((suggestion, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg border border-dark-700"
                  >
                    <Hand className="w-4 h-4 text-orange-400" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {suggestionTypeLabels[suggestion.type] || suggestion.type}
                        </span>
                        <Badge variant="pending" className="text-xs">Manual</Badge>
                      </div>
                      <p className="text-xs text-dark-500">{suggestion.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {onReject && (
        <div className="flex justify-end gap-2 p-4 border-t border-dark-700">
          <Button variant="secondary" size="sm" onClick={onReject}>
            Skip / Cancel Job
          </Button>
        </div>
      )}
    </Card>
  );
}
