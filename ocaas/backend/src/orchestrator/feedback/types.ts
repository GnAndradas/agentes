/**
 * Agent Feedback Types
 * Allows agents to report issues during execution back to the orchestrator
 */

export const FEEDBACK_TYPE = {
  MISSING_TOOL: 'missing_tool',
  MISSING_SKILL: 'missing_skill',
  MISSING_CAPABILITY: 'missing_capability',
  BLOCKED: 'blocked',
  CANNOT_CONTINUE: 'cannot_continue',
} as const;

export type FeedbackType = typeof FEEDBACK_TYPE[keyof typeof FEEDBACK_TYPE];

export interface AgentFeedback {
  /** Unique feedback ID */
  id: string;
  /** Type of feedback */
  type: FeedbackType;
  /** Agent reporting the feedback */
  agentId: string;
  /** Task being executed when feedback was generated */
  taskId: string;
  /** Session ID if available */
  sessionId?: string;
  /** Human-readable message from agent */
  message: string;
  /** What the agent needs (tool name, skill name, capability, etc) */
  requirement?: string;
  /** Additional context from agent */
  context?: Record<string, unknown>;
  /** Timestamp */
  createdAt: number;
  /** Whether this feedback has been processed */
  processed: boolean;
  /** Result of processing (if any) */
  processingResult?: {
    action?: string;
    generationId?: string;
    approvalId?: string;
    error?: string;
  };
}

export interface CreateFeedbackInput {
  type: FeedbackType;
  agentId: string;
  taskId: string;
  sessionId?: string;
  message: string;
  requirement?: string;
  context?: Record<string, unknown>;
}

/**
 * Maps feedback types to suggested actions
 */
export function feedbackToActionType(feedbackType: FeedbackType): 'create_tool' | 'create_skill' | 'create_agent' | null {
  switch (feedbackType) {
    case FEEDBACK_TYPE.MISSING_TOOL:
      return 'create_tool';
    case FEEDBACK_TYPE.MISSING_SKILL:
      return 'create_skill';
    case FEEDBACK_TYPE.MISSING_CAPABILITY:
      return 'create_agent';
    case FEEDBACK_TYPE.BLOCKED:
    case FEEDBACK_TYPE.CANNOT_CONTINUE:
      return null; // These need human intervention or analysis
    default:
      return null;
  }
}
