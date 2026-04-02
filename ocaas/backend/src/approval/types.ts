export type ApprovalType = 'task' | 'agent' | 'skill' | 'tool' | 'generation' | 'permission' | 'job_retry';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalDTO {
  id: string;
  type: ApprovalType;
  resourceId?: string;
  status: ApprovalStatus;
  requestedAt: number;
  expiresAt?: number;
  respondedAt?: number;
  respondedBy?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateApprovalInput {
  type: ApprovalType;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  expiresIn?: number; // ms from now, defaults to humanTimeout
}

export interface ApprovalResponse {
  approved: boolean;
  respondedBy: string;
  reason?: string;
}
