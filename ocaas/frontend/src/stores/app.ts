import { create } from 'zustand';
import type { Agent, Task, SystemStats } from '../types';

// Status bar activity types
export interface StatusActivity {
  id: string;
  type: 'gateway' | 'generation' | 'task' | 'approval' | 'sync';
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  timestamp: number;
}

interface AppState {
  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;

  // Gateway status
  gatewayConnected: boolean;
  setGatewayConnected: (connected: boolean) => void;

  // Status bar activities (optional debug info)
  statusBarVisible: boolean;
  toggleStatusBar: () => void;
  activities: StatusActivity[];
  addActivity: (activity: Omit<StatusActivity, 'id' | 'timestamp'>) => void;
  updateActivity: (id: string, updates: Partial<StatusActivity>) => void;
  clearActivities: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Active agents (quick access)
  activeAgents: Agent[];
  setActiveAgents: (agents: Agent[]) => void;

  // Running tasks (quick access)
  runningTasks: Task[];
  setRunningTasks: (tasks: Task[]) => void;

  // System stats
  stats: SystemStats | null;
  setStats: (stats: SystemStats) => void;

  // Notifications
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  timestamp: number;
}

export const useAppStore = create<AppState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),

  gatewayConnected: false,
  setGatewayConnected: (connected) => set({ gatewayConnected: connected }),

  statusBarVisible: false,
  toggleStatusBar: () => set((state) => ({ statusBarVisible: !state.statusBarVisible })),
  activities: [],
  addActivity: (activity) =>
    set((state) => ({
      activities: [
        {
          ...activity,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
        ...state.activities.slice(0, 49), // Keep last 50
      ],
    })),
  updateActivity: (id, updates) =>
    set((state) => ({
      activities: state.activities.map((a) =>
        a.id === id ? { ...a, ...updates } : a
      ),
    })),
  clearActivities: () => set({ activities: [] }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  activeAgents: [],
  setActiveAgents: (agents) => set({ activeAgents: agents }),

  runningTasks: [],
  setRunningTasks: (tasks) => set({ runningTasks: tasks }),

  stats: null,
  setStats: (stats) => set({ stats }),

  notifications: [],
  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          ...notification,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
      ],
    })),
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
  clearNotifications: () => set({ notifications: [] }),
}));
