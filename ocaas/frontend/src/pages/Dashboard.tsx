import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, ListTodo, Sparkles, Wrench, Activity, Clock } from 'lucide-react';
import { systemApi, agentApi, taskApi } from '../lib/api';
import { useAppStore } from '../stores/app';

export function Dashboard() {
  const { setStats, setActiveAgents, setRunningTasks } = useAppStore();

  const { data: statsData } = useQuery({
    queryKey: ['system', 'stats'],
    queryFn: systemApi.stats,
    refetchInterval: 10000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: agentApi.list,
  });

  const { data: tasksData } = useQuery({
    queryKey: ['tasks', 'running'],
    queryFn: () => taskApi.list({ status: 'running' }),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (statsData) {
      setStats(statsData);
    }
  }, [statsData, setStats]);

  useEffect(() => {
    if (agentsData?.agents) {
      setActiveAgents(agentsData.agents.filter((a) => a.status === 'active'));
    }
  }, [agentsData, setActiveAgents]);

  useEffect(() => {
    if (tasksData?.tasks) {
      setRunningTasks(tasksData.tasks);
    }
  }, [tasksData, setRunningTasks]);

  const stats = statsData;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Agents"
          value={stats?.agents.total ?? 0}
          subtitle={`${stats?.agents.active ?? 0} active`}
          icon={Bot}
          color="primary"
        />
        <StatCard
          title="Tasks"
          value={stats?.tasks.total ?? 0}
          subtitle={`${stats?.tasks.running ?? 0} running`}
          icon={ListTodo}
          color="green"
        />
        <StatCard
          title="Skills"
          value={0}
          subtitle="In workspace"
          icon={Sparkles}
          color="purple"
        />
        <StatCard
          title="Tools"
          value={0}
          subtitle="Available"
          icon={Wrench}
          color="orange"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary-400" />
            Active Agents
          </h2>
          {agentsData?.agents.filter((a) => a.status === 'active').length === 0 ? (
            <p className="text-dark-400">No active agents</p>
          ) : (
            <div className="space-y-2">
              {agentsData?.agents
                .filter((a) => a.status === 'active')
                .slice(0, 5)
                .map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between p-3 bg-dark-900 rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-sm text-dark-400">{agent.type}</p>
                    </div>
                    <span className="badge badge-active">{agent.status}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-green-400" />
            Running Tasks
          </h2>
          {tasksData?.tasks.length === 0 ? (
            <p className="text-dark-400">No running tasks</p>
          ) : (
            <div className="space-y-2">
              {tasksData?.tasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 bg-dark-900 rounded-lg"
                >
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-dark-400">
                      {task.type} - Agent: {task.agentId || 'Unassigned'}
                    </p>
                  </div>
                  <span className="badge badge-pending">{task.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: typeof Bot;
  color: 'primary' | 'green' | 'purple' | 'orange';
}) {
  const colors = {
    primary: 'bg-primary-600/20 text-primary-400',
    green: 'bg-green-600/20 text-green-400',
    purple: 'bg-purple-600/20 text-purple-400',
    orange: 'bg-orange-600/20 text-orange-400',
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-dark-400 text-sm">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
          <p className="text-dark-500 text-sm mt-1">{subtitle}</p>
        </div>
        <div className={`p-3 rounded-lg ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
