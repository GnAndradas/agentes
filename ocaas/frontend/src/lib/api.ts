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
  list: async () => {
    const res = await api.get<DataResponse<import('../types').Skill[]>>('/skills');
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

// System API
export const systemApi = {
  health: () => api.get<{ status: string; timestamp: number }>('/system/health'),
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
