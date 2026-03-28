import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Zap, Eye, Hand, Bot, Sparkles, Wrench, Loader2 } from 'lucide-react';
import { systemApi } from '../../lib/api';
import { Button } from '../ui/Button';
import type { AutonomyLevel, AutonomyConfig } from '../../types';

const levelConfig: Record<AutonomyLevel, { icon: typeof Zap; color: string; label: string; description: string }> = {
  autonomous: {
    icon: Zap,
    color: 'text-green-400',
    label: 'Autonomous',
    description: 'Full auto-execution',
  },
  supervised: {
    icon: Eye,
    color: 'text-yellow-400',
    label: 'Supervised',
    description: 'Requires approvals',
  },
  manual: {
    icon: Hand,
    color: 'text-red-400',
    label: 'Manual',
    description: 'Human-only',
  },
};

function ToggleItem({ label, icon: Icon, enabled, onChange, disabled }: {
  label: string;
  icon: typeof Bot;
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-dark-400" />
        <span className="text-sm">{label}</span>
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled ? 'bg-primary-600' : 'bg-dark-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export function AutonomyPanel() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['system', 'autonomy'],
    queryFn: systemApi.getAutonomy,
    refetchInterval: 10000,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<AutonomyConfig>) => systemApi.updateAutonomy(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system', 'autonomy'] });
    },
  });

  const setLevel = (level: AutonomyLevel) => {
    updateMutation.mutate({ level });
  };

  const toggleCapability = (key: 'canCreateAgents' | 'canGenerateSkills' | 'canGenerateTools') => {
    if (!config) return;
    updateMutation.mutate({ [key]: !config[key] });
  };

  const currentLevel = config?.level || 'manual';
  const LevelIcon = levelConfig[currentLevel].icon;
  const levelColor = levelConfig[currentLevel].color;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary-400" />
          Autonomy Control
        </h2>
        {updateMutation.isPending && (
          <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
        )}
      </div>

      {isLoading ? (
        <div className="text-dark-400 text-sm">Loading...</div>
      ) : (
        <>
          {/* Current Level */}
          <div className="flex items-center gap-3 mb-4 p-3 bg-dark-900 rounded-lg">
            <LevelIcon className={`w-6 h-6 ${levelColor}`} />
            <div>
              <p className={`font-medium ${levelColor}`}>
                {levelConfig[currentLevel].label}
              </p>
              <p className="text-xs text-dark-400">
                {levelConfig[currentLevel].description}
              </p>
            </div>
          </div>

          {/* Level Buttons */}
          <div className="flex gap-2 mb-4">
            {(Object.keys(levelConfig) as AutonomyLevel[]).map((level) => {
              const cfg = levelConfig[level];
              const Icon = cfg.icon;
              const isActive = currentLevel === level;
              return (
                <Button
                  key={level}
                  size="sm"
                  variant={isActive ? 'primary' : 'secondary'}
                  onClick={() => setLevel(level)}
                  disabled={updateMutation.isPending}
                  className="flex-1"
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{cfg.label}</span>
                </Button>
              );
            })}
          </div>

          {/* Capabilities */}
          <div className="border-t border-dark-700 pt-3">
            <p className="text-sm text-dark-400 mb-2">Auto-generation</p>
            <ToggleItem
              label="Agents"
              icon={Bot}
              enabled={config?.canCreateAgents ?? false}
              onChange={() => toggleCapability('canCreateAgents')}
              disabled={updateMutation.isPending}
            />
            <ToggleItem
              label="Skills"
              icon={Sparkles}
              enabled={config?.canGenerateSkills ?? false}
              onChange={() => toggleCapability('canGenerateSkills')}
              disabled={updateMutation.isPending}
            />
            <ToggleItem
              label="Tools"
              icon={Wrench}
              enabled={config?.canGenerateTools ?? false}
              onChange={() => toggleCapability('canGenerateTools')}
              disabled={updateMutation.isPending}
            />
          </div>
        </>
      )}
    </div>
  );
}
