import { create } from 'zustand';
import type { Agent, Task, SystemStats } from '../types';

interface AppState {
  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;

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
