import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  AlertCircle,
  Wrench,
  Sparkles,
  Bot,
  Ban,
  Activity,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { feedbackApi, eventApi } from '../../lib/api';
import { formatRelativeTime } from '../../lib/date';
import { Badge } from '../ui/Badge';
import type { AgentFeedback, SystemEvent } from '../../types';

const feedbackIcons = {
  missing_tool: Wrench,
  missing_skill: Sparkles,
  missing_capability: Bot,
  blocked: Ban,
  cannot_continue: AlertCircle,
};

const feedbackColors = {
  missing_tool: 'text-orange-400',
  missing_skill: 'text-purple-400',
  missing_capability: 'text-primary-400',
  blocked: 'text-red-400',
  cannot_continue: 'text-red-400',
};

function FeedbackItem({ feedback }: { feedback: AgentFeedback }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = feedbackIcons[feedback.type] || AlertCircle;
  const colorClass = feedbackColors[feedback.type] || 'text-dark-400';

  return (
    <div className="p-2 bg-dark-900 rounded-lg">
      <div
        className="flex items-start gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon className={`w-4 h-4 mt-0.5 ${colorClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">
              {feedback.type.replace('_', ' ')}
            </span>
            {feedback.processed ? (
              <Badge variant="success">processed</Badge>
            ) : (
              <Badge variant="pending">pending</Badge>
            )}
          </div>
          <p className="text-xs text-dark-400 truncate">{feedback.message}</p>
          <p className="text-xs text-dark-500 mt-1">{formatRelativeTime(feedback.createdAt)}</p>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-dark-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-dark-500" />
        )}
      </div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-dark-800 text-xs">
          <p><span className="text-dark-500">Agent:</span> {feedback.agentId}</p>
          <p><span className="text-dark-500">Task:</span> {feedback.taskId}</p>
          {feedback.requirement && (
            <p><span className="text-dark-500">Requirement:</span> {feedback.requirement}</p>
          )}
          {feedback.processingResult && (
            <div className="mt-1 p-1 bg-dark-800 rounded">
              {feedback.processingResult.action && (
                <p><span className="text-dark-500">Action:</span> {feedback.processingResult.action}</p>
              )}
              {feedback.processingResult.error && (
                <p className="text-red-400">{feedback.processingResult.error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventItem({ event }: { event: SystemEvent }) {
  const severityColors = {
    info: 'text-primary-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <div className="flex items-start gap-2 p-2 bg-dark-900 rounded-lg">
      <Activity className={`w-4 h-4 mt-0.5 ${severityColors[event.severity]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-dark-500">{event.type}</p>
        <p className="text-sm truncate">{event.message}</p>
        <p className="text-xs text-dark-500 mt-1">{formatRelativeTime(event.createdAt)}</p>
      </div>
    </div>
  );
}

export function FeedbackEventsPanel() {
  const [tab, setTab] = useState<'feedback' | 'events'>('feedback');

  const { data: feedbackData, isLoading: feedbackLoading } = useQuery({
    queryKey: ['feedback'],
    queryFn: () => feedbackApi.list({ processed: 'false' }),
    refetchInterval: 5000,
    enabled: tab === 'feedback',
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', 'recent'],
    queryFn: () => eventApi.list({ limit: '20' }),
    refetchInterval: 5000,
    enabled: tab === 'events',
  });

  const feedback = feedbackData?.feedback || [];
  const events = eventsData?.events || [];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-purple-400" />
          Feedback & Events
        </h2>
      </div>

      {/* Tab Buttons */}
      <div className="flex gap-1 mb-4 p-1 bg-dark-900 rounded-lg">
        <button
          onClick={() => setTab('feedback')}
          className={`flex-1 py-1.5 px-3 text-sm rounded-md transition-colors ${
            tab === 'feedback'
              ? 'bg-dark-700 text-white'
              : 'text-dark-400 hover:text-white'
          }`}
        >
          Feedback
          {feedback.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">
              {feedback.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('events')}
          className={`flex-1 py-1.5 px-3 text-sm rounded-md transition-colors ${
            tab === 'events'
              ? 'bg-dark-700 text-white'
              : 'text-dark-400 hover:text-white'
          }`}
        >
          Events
        </button>
      </div>

      {/* Content */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {tab === 'feedback' ? (
          feedbackLoading ? (
            <div className="text-dark-400 text-sm">Loading...</div>
          ) : feedback.length === 0 ? (
            <div className="text-dark-400 text-sm">No pending feedback</div>
          ) : (
            feedback.map((f) => <FeedbackItem key={f.id} feedback={f} />)
          )
        ) : eventsLoading ? (
          <div className="text-dark-400 text-sm">Loading...</div>
        ) : events.length === 0 ? (
          <div className="text-dark-400 text-sm">No recent events</div>
        ) : (
          events.map((e) => <EventItem key={e.id} event={e} />)
        )}
      </div>
    </div>
  );
}
