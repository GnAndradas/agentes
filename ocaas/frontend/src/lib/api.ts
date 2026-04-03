const API_BASE = '/api';

// Response wrapper type from backend
type DataResponse<T> = { data: T };

interface RequestOptions extends Omit<RequestInit, 'body'> {
  jsonBody?: unknown;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const { jsonBody, ...rest } = options;

  const headers: Record<string, string> = { ...(rest.headers as Record<string, string> || {}) };
  let body: string | undefined;

  if (jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(jsonBody);
  }

  const response = await fetch(url, {
    ...rest,
    headers,
    body,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || 'Request failed');
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  // Safe JSON parsing
  const text = await response.text();
  return text ? JSON.parse(text) : (undefined as T);
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),

  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      jsonBody: data ?? {},
    }),

  put: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      jsonBody: data,
    }),

  patch: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, {
      method: 'PATCH',
      jsonBody: data,
    }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
};

// Agent API
export const agentApi = {
  list: async () => {
    const res = await api.get<DataResponse<import('../types').Agent[]>>('/agents');
    return { agents: res.data };
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Agent>>(`/agents/${id}`);
    return res.data;
  },
  create: async (data: Partial<import('../types').Agent>) => {
    const res = await api.post<DataResponse<import('../types').Agent>>('/agents', data);
    return res.data;
  },
  update: async (id: string, data: Partial<import('../types').Agent>) => {
    const res = await api.patch<DataResponse<import('../types').Agent>>(`/agents/${id}`, data);
    return res.data;
  },
  delete: (id: string) => api.delete(`/agents/${id}`),
  activate: (id: string) => api.post(`/agents/${id}/activate`),
  deactivate: (id: string) => api.post(`/agents/${id}/deactivate`),
  // Agent-Skill assignments
  getSkills: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Skill[]>>(`/agents/${id}/skills`);
    return res.data;
  },
  getTools: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Tool[]>>(`/agents/${id}/tools`);
    return res.data;
  },
};

// Task API
export const taskApi = {
  list: async (params?: { status?: string; agentId?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    const res = await api.get<DataResponse<import('../types').Task[]>>(`/tasks${query}`);
    return { tasks: res.data };
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Task>>(`/tasks/${id}`);
    return res.data;
  },
  getSubtasks: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Task[]>>(`/tasks/${id}/subtasks`);
    return { subtasks: res.data };
  },
  create: async (data: { title: string; description?: string; type: string; priority?: number }) => {
    const res = await api.post<DataResponse<import('../types').Task>>('/tasks', data);
    return res.data;
  },
  cancel: (id: string) => api.post(`/tasks/${id}/cancel`),
  retry: (id: string) => api.post(`/tasks/${id}/retry`),
};

// Skill API
export const skillApi = {
  list: async (options?: { expand?: 'toolCount' | 'tools' }) => {
    const query = options?.expand ? `?expand=${options.expand}` : '';
    const res = await api.get<DataResponse<import('../types').Skill[]>>(`/skills${query}`);
    return { skills: res.data };
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Skill>>(`/skills/${id}`);
    return res.data;
  },
  create: async (data: Partial<import('../types').Skill>) => {
    const res = await api.post<DataResponse<import('../types').Skill>>('/skills', data);
    return res.data;
  },
  update: async (id: string, data: Partial<import('../types').Skill>) => {
    const res = await api.patch<DataResponse<import('../types').Skill>>(`/skills/${id}`, data);
    return res.data;
  },
  delete: (id: string) => api.delete(`/skills/${id}`),

  // Skill-Agent assignments
  assignToAgent: (skillId: string, agentId: string) =>
    api.post<{ success: boolean }>(`/skills/${skillId}/assign`, { agentId }),
  unassignFromAgent: (skillId: string, agentId: string) =>
    api.delete(`/skills/${skillId}/assign/${agentId}`),

  // Skill-Tool composition
  getTools: async (id: string, expand?: boolean) => {
    const query = expand ? '?expand=tool' : '';
    const res = await api.get<DataResponse<import('../types').SkillToolLink[] | import('../types').SkillToolExpanded[]>>(`/skills/${id}/tools${query}`);
    return res.data;
  },
  getToolsExpanded: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').SkillToolExpanded[]>>(`/skills/${id}/tools?expand=tool`);
    return res.data;
  },
  setTools: async (id: string, tools: Array<{ toolId: string; orderIndex?: number; required?: boolean; role?: string; config?: Record<string, unknown> }>) => {
    const res = await api.put<DataResponse<import('../types').SkillToolLink[]>>(`/skills/${id}/tools`, { tools });
    return res.data;
  },
  addTool: async (id: string, data: { toolId: string; orderIndex?: number; required?: boolean; role?: string; config?: Record<string, unknown> }) => {
    const res = await api.post<DataResponse<import('../types').SkillToolLink>>(`/skills/${id}/tools`, data);
    return res.data;
  },
  updateToolLink: async (skillId: string, toolId: string, data: { orderIndex?: number; required?: boolean; role?: string; config?: Record<string, unknown> }) => {
    const res = await api.patch<DataResponse<import('../types').SkillToolLink>>(`/skills/${skillId}/tools/${toolId}`, data);
    return res.data;
  },
  removeTool: (skillId: string, toolId: string) => api.delete(`/skills/${skillId}/tools/${toolId}`),

  // Skill Execution
  execute: async (id: string, options?: {
    mode?: import('../types').ExecutionMode;
    input?: Record<string, unknown>;
    context?: Record<string, unknown>;
    timeoutMs?: number;
    stopOnError?: boolean;
    caller?: { type: 'agent' | 'user' | 'system'; id: string; name?: string };
  }) => {
    const res = await api.post<DataResponse<import('../types').SkillExecutionResult>>(`/skills/${id}/execute`, options || {});
    return res.data;
  },
  validateExecution: async (id: string, input?: Record<string, unknown>) => {
    const res = await api.post<DataResponse<import('../types').SkillValidationResult>>(`/skills/${id}/validate-execution`, { input });
    return res.data;
  },
  getExecutionPreview: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').SkillExecutionPreview>>(`/skills/${id}/execution-preview`);
    return res.data;
  },
};

// Tool API
export const toolApi = {
  list: async () => {
    const res = await api.get<DataResponse<import('../types').Tool[]>>('/tools');
    return { tools: res.data };
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Tool>>(`/tools/${id}`);
    return res.data;
  },
  create: async (data: Partial<import('../types').Tool>) => {
    const res = await api.post<DataResponse<import('../types').Tool>>('/tools', data);
    return res.data;
  },
  update: async (id: string, data: Partial<import('../types').Tool>) => {
    const res = await api.patch<DataResponse<import('../types').Tool>>(`/tools/${id}`, data);
    return res.data;
  },
  delete: (id: string) => api.delete(`/tools/${id}`),
  // Validation endpoints
  validate: async (data: Partial<import('../types').Tool>) => {
    const res = await api.post<DataResponse<import('../types').ToolValidationResult>>('/tools/validate', data);
    return res.data;
  },
  validateExisting: async (id: string) => {
    const res = await api.post<DataResponse<import('../types').ToolValidationResult & { toolId: string; toolName: string }>>(`/tools/${id}/validate`);
    return res.data;
  },
  validateConfig: async (type: import('../types').ToolType, config: unknown) => {
    const res = await api.post<DataResponse<{ valid: boolean; config?: unknown; errors?: string[] }>>('/tools/validate-config', { type, config });
    return res.data;
  },
};

// Generation API
export const generationApi = {
  list: async (params?: { type?: string; status?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    const res = await api.get<DataResponse<import('../types').Generation[]>>(`/generations${query}`);
    return { generations: res.data };
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Generation>>(`/generations/${id}`);
    return res.data;
  },
  create: async (data: { type: string; name: string; description: string; prompt: string }) => {
    const res = await api.post<DataResponse<import('../types').Generation>>('/generations', data);
    return res.data;
  },
  approve: (id: string, approvedBy = 'system') => api.post(`/generations/${id}/approve`, { approvedBy }),
  reject: (id: string, reason: string) => api.post(`/generations/${id}/reject`, { reason }),
  activate: (id: string) => api.post(`/generations/${id}/activate`),
};

// Gateway diagnostic types (full, slower)
export interface GatewayDiagnostic {
  timestamp: number;
  checkedAt: number;
  rest: {
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
    error?: string;
    models?: string[];
  };
  hooks: {
    configured: boolean;
    probed: boolean; // true if actually tested
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
    error?: string;
  };
  generation?: {
    enabled: boolean;
    working: boolean;
    latencyMs: number;
    error?: string;
  };
  websocket: {
    connected: boolean;
    sessionId?: string;
  };
  overall: {
    healthy: boolean;
    message: string;
  };
  lastError?: string;
}

// Quick status for StatusBar polling (fast, real probe)
export interface QuickStatus {
  timestamp: number;
  backend: boolean; // Always true if response arrives
  rest: {
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
    error?: string;
  };
  hooks: {
    configured: boolean;
    probed: boolean; // false = not tested, just config check
    working: boolean;
    error?: string;
  };
  probe: {
    enabled: boolean;
    tested: boolean; // false = not run on quick status
    working: boolean;
    error?: string;
  };
  websocket: {
    connected: boolean;
  };
}

// Runtime/Health types
export interface HealthResponse {
  status: string;
  timestamp: number;
  version: string;
  environment: string;
  uptime: string;
  nodeVersion: string;
  pid: number;
  commit: string | null;
  healthy: boolean;
}

export interface RuntimeInfo {
  app: { name: string; version: string; environment: string };
  build: { timestamp: number | null; commitHash: string | null; commitDate: string | null; branch: string | null; dirty: boolean };
  process: { pid: number; uptime: number; uptimeHuman: string; startedAt: number; nodeVersion: string; platform: string; arch: string; cwd: string };
  memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
  environment: EnvironmentCheck;
}

export interface EnvironmentCheck {
  timestamp: number;
  checks: Array<{ name: string; status: 'ok' | 'warning' | 'error'; message: string; details?: Record<string, unknown> }>;
  healthy: boolean;
  criticalIssues: string[];
  warnings: string[];
}

// System API
export const systemApi = {
  // Backend health with runtime summary
  health: () => api.get<HealthResponse>('/system/health'),

  // Full runtime info
  runtime: async () => {
    const res = await api.get<DataResponse<RuntimeInfo>>('/system/runtime');
    return res.data;
  },

  // Environment check
  environment: async (refresh?: boolean) => {
    const query = refresh ? '?refresh=true' : '';
    const res = await api.get<DataResponse<EnvironmentCheck>>(`/system/environment${query}`);
    return res.data;
  },

  // Quick gateway status (for polling) - HONEST: makes real requests
  gatewayStatus: async () => {
    const res = await api.get<DataResponse<QuickStatus>>('/system/gateway');
    return res.data;
  },

  // Full gateway diagnostic (slower, runs generation probe if enabled)
  gatewayDiagnostic: async () => {
    const res = await api.get<DataResponse<GatewayDiagnostic>>('/system/gateway/diagnostic');
    return res.data;
  },

  stats: () => api.get<import('../types').SystemStats>('/system/stats'),
  getAutonomy: async () => {
    const res = await api.get<DataResponse<import('../types').AutonomyConfig>>('/system/autonomy');
    return res.data;
  },
  updateAutonomy: async (data: Partial<import('../types').AutonomyConfig>) => {
    const res = await api.put<DataResponse<import('../types').AutonomyConfig>>('/system/autonomy', data);
    return res.data;
  },
  getOrchestrator: async () => {
    const res = await api.get<DataResponse<import('../types').OrchestratorStatus>>('/system/orchestrator');
    return res.data;
  },
};

// Approval API
export const approvalApi = {
  list: async (params?: { status?: string; type?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    const res = await api.get<DataResponse<import('../types').Approval[]>>(`/approvals${query}`);
    return { approvals: res.data };
  },
  getPending: async () => {
    const res = await api.get<DataResponse<import('../types').Approval[]>>('/approvals/pending');
    return { approvals: res.data };
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').Approval>>(`/approvals/${id}`);
    return res.data;
  },
  approve: async (id: string) => {
    const res = await api.post<DataResponse<import('../types').Approval>>(`/approvals/${id}/approve`);
    return res.data;
  },
  reject: async (id: string, reason?: string) => {
    const res = await api.post<DataResponse<import('../types').Approval>>(`/approvals/${id}/reject`, { reason });
    return res.data;
  },
  respond: async (id: string, approved: boolean, reason?: string) => {
    const res = await api.post<DataResponse<import('../types').Approval>>(`/approvals/${id}/respond`, { approved, reason });
    return res.data;
  },
  delete: (id: string) => api.delete(`/approvals/${id}`),
};

// Feedback API
export const feedbackApi = {
  list: async (params?: { taskId?: string; processed?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    const res = await api.get<DataResponse<import('../types').AgentFeedback[]>>(`/feedback${query}`);
    return { feedback: res.data };
  },
  getByTask: async (taskId: string) => {
    const res = await api.get<DataResponse<import('../types').AgentFeedback[]>>(`/feedback/task/${taskId}`);
    return { feedback: res.data };
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').AgentFeedback>>(`/feedback/${id}`);
    return res.data;
  },
  clearForTask: (taskId: string) => api.delete(`/feedback/task/${taskId}`),
};

// Events API
export const eventApi = {
  list: async (params?: { type?: string; category?: string; limit?: string }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    const res = await api.get<DataResponse<import('../types').SystemEvent[]>>(`/system/events${query}`);
    return { events: res.data };
  },
};

// Organization API
export const orgApi = {
  // Work Profiles
  listProfiles: async () => {
    const res = await api.get<DataResponse<import('../types').WorkProfile[]>>('/org/profiles');
    return res.data;
  },
  getProfile: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').WorkProfile>>(`/org/profiles/${id}`);
    return res.data;
  },

  // Hierarchy
  listHierarchy: async () => {
    const res = await api.get<DataResponse<import('../types').AgentOrgProfile[]>>('/org/hierarchy');
    return res.data;
  },
  getHierarchyTree: async (rootAgentId?: string) => {
    const query = rootAgentId ? `?rootAgentId=${rootAgentId}` : '';
    const res = await api.get<DataResponse<import('../types').HierarchyNode[]>>(`/org/hierarchy/tree${query}`);
    return res.data;
  },
  getAgentProfile: async (agentId: string) => {
    const res = await api.get<DataResponse<import('../types').AgentOrgProfile>>(`/org/hierarchy/${agentId}`);
    return res.data;
  },
  upsertAgentProfile: async (agentId: string, data: {
    roleType: import('../types').RoleType;
    supervisorAgentId?: string | null;
    workProfileId: string;
    department?: string;
  }) => {
    const res = await api.put<DataResponse<import('../types').AgentOrgProfile>>(`/org/hierarchy/${agentId}`, data);
    return res.data;
  },
  deleteAgentProfile: async (agentId: string) => {
    await api.delete(`/org/hierarchy/${agentId}`);
  },
  getEscalationChain: async (agentId: string) => {
    const res = await api.get<DataResponse<Array<{ agentId: string; roleType: import('../types').RoleType }>>>(`/org/hierarchy/${agentId}/escalation-chain`);
    return res.data;
  },
  getSubordinates: async (agentId: string) => {
    const res = await api.get<DataResponse<import('../types').AgentOrgProfile[]>>(`/org/hierarchy/${agentId}/subordinates`);
    return res.data;
  },
  getEffectivePolicies: async (agentId: string) => {
    const res = await api.get<DataResponse<import('../types').EffectivePolicies>>(`/org/policies/agent/${agentId}`);
    return res.data;
  },
};

// Jobs API
export const jobApi = {
  list: async (params?: { status?: import('../types').JobStatus; taskId?: string; agentId?: string; limit?: number }) => {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : '';
    const res = await api.get<DataResponse<import('../types').JobSummary[]>>(`/jobs${query}`);
    return res.data;
  },
  get: async (id: string) => {
    const res = await api.get<DataResponse<import('../types').JobSummary & { payload: unknown; response: unknown; events: unknown[] }>>(`/jobs/${id}`);
    return res.data;
  },
  getByTask: async (taskId: string) => {
    const res = await api.get<DataResponse<import('../types').JobSummary[]>>(`/jobs/task/${taskId}`);
    return res.data;
  },
  getByAgent: async (agentId: string) => {
    const res = await api.get<DataResponse<Array<{ id: string; taskId: string; goal: string; status: import('../types').JobStatus; createdAt: number }>>>(`/jobs/agent/${agentId}`);
    return res.data;
  },
  getStats: async () => {
    const res = await api.get<DataResponse<import('../types').JobStats>>('/jobs/stats');
    return res.data;
  },
  getActive: async () => {
    const res = await api.get<DataResponse<Array<{ id: string; taskId: string; agentId: string; agentName: string; goal: string; sessionId?: string; createdAt: number; runningFor: number }>>>('/jobs/active');
    return res.data;
  },
  getBlocked: async () => {
    const res = await api.get<DataResponse<Array<{ id: string; taskId: string; agentId: string; agentName: string; goal: string; blocked: import('../types').JobBlocked; createdAt: number }>>>('/jobs/blocked');
    return res.data;
  },
  abort: async (id: string) => {
    await api.post(`/jobs/${id}/abort`);
  },
  retry: async (id: string) => {
    const res = await api.post<DataResponse<{ newJobId: string; dispatched: boolean }>>(`/jobs/${id}/retry`);
    return res.data;
  },
};
