import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Wand2, Bot, Sparkles, Wrench } from 'lucide-react';
import { generationApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import { useTrackedMutation } from '../hooks/useTrackedMutation';
import { Button, Input, Textarea, Card, CardHeader } from '../components/ui';
import { clsx } from 'clsx';

type GenerationType = 'agent' | 'skill' | 'tool';

const typeConfig = {
  agent: {
    icon: Bot,
    title: 'Generate Agent',
    description: 'Create a new AI agent configuration',
    color: 'primary',
  },
  skill: {
    icon: Sparkles,
    title: 'Generate Skill',
    description: 'Create a new reusable skill',
    color: 'purple',
  },
  tool: {
    icon: Wrench,
    title: 'Generate Tool',
    description: 'Create a new executable tool',
    color: 'orange',
  },
};

export function Generator() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [selectedType, setSelectedType] = useState<GenerationType | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    prompt: '',
  });

  const generateMutation = useTrackedMutation({
    mutationFn: generationApi.create,
    activityType: 'generation',
    activityMessage: (data) => `Generating ${data.type}: ${data.name}`,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      addNotification({
        type: 'success',
        title: 'Generation started',
        message: 'Your request is being processed',
      });
      navigate(`/generations`);
    },
    onError: (err: Error) => {
      addNotification({
        type: 'error',
        title: 'Generation failed',
        message: err.message,
      });
    },
  });

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType) return;

    generateMutation.mutate({
      type: selectedType,
      name: form.name,
      description: form.description,
      prompt: form.prompt,
    });
  };

  const resetForm = () => {
    setSelectedType(null);
    setForm({ name: '', description: '', prompt: '' });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader
          title="AI Generator"
          description="Generate agents, skills, and tools using AI"
        />

        {!selectedType ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.keys(typeConfig) as GenerationType[]).map((type) => {
              const config = typeConfig[type];
              const Icon = config.icon;

              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={clsx(
                    'p-6 rounded-xl border-2 border-dark-700 hover:border-dark-500 transition-all text-left group',
                    'hover:bg-dark-900/50'
                  )}
                >
                  <div
                    className={clsx(
                      'w-12 h-12 rounded-lg flex items-center justify-center mb-4',
                      config.color === 'primary' && 'bg-primary-600/20 text-primary-400',
                      config.color === 'purple' && 'bg-purple-600/20 text-purple-400',
                      config.color === 'orange' && 'bg-orange-600/20 text-orange-400'
                    )}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold mb-1">{config.title}</h3>
                  <p className="text-sm text-dark-400">{config.description}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <form onSubmit={handleGenerate} className="space-y-6">
            <div className="flex items-center gap-3 p-4 bg-dark-900 rounded-lg">
              {(() => {
                const config = typeConfig[selectedType];
                const Icon = config.icon;
                return (
                  <>
                    <div
                      className={clsx(
                        'w-10 h-10 rounded-lg flex items-center justify-center',
                        selectedType === 'agent' && 'bg-primary-600/20 text-primary-400',
                        selectedType === 'skill' && 'bg-purple-600/20 text-purple-400',
                        selectedType === 'tool' && 'bg-orange-600/20 text-orange-400'
                      )}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-medium">{config.title}</p>
                      <p className="text-sm text-dark-400">{config.description}</p>
                    </div>
                  </>
                );
              })()}
            </div>

            <Input
              label="Name"
              placeholder={`Enter ${selectedType} name`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />

            <Textarea
              label="Description"
              placeholder={`Describe what this ${selectedType} does`}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />

            <Textarea
              label="Generation Prompt"
              placeholder={`Detailed instructions for the AI to generate this ${selectedType}...`}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              className="min-h-[150px]"
              required
            />

            <div className="flex justify-between pt-4">
              <Button type="button" variant="ghost" onClick={resetForm}>
                Back
              </Button>
              <Button type="submit" loading={generateMutation.isPending}>
                <Wand2 className="w-4 h-4" />
                Generate
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
