const API_BASE = '/api';

// Response wrapper type from backend
type DataResponse<T> = { data: T };

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || error.error || 'Request failed');
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),

  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),

  put: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  patch: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
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
  // sync: () => api.post('/skills/sync'), // TODO: Backend route not implemented

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

// System API
export const systemApi = {
  // Backend health (OCAAS server)
  health: () => api.get<{ status: string; timestamp: number }>('/system/health'),

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
