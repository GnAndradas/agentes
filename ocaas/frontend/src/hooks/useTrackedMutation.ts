import { useMutation, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';
import { useAppStore, type StatusActivity } from '../stores/app';

type ActivityType = StatusActivity['type'];

// Internal context that wraps the user's context
interface TrackedContext<TContext> {
  __activityId: string;
  __originalContext: TContext;
}

interface TrackedMutationOptions<TData, TError, TVariables, TContext>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'onMutate' | 'onSuccess' | 'onError'> {
  activityType: ActivityType;
  activityMessage: string | ((variables: TVariables) => string);
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => void;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => void;
}

/**
 * A mutation hook that automatically tracks activity in the status bar
 */
export function useTrackedMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: TrackedMutationOptions<TData, TError, TVariables, TContext>
): UseMutationResult<TData, TError, TVariables, TrackedContext<TContext>> {
  const { addActivity, updateActivity } = useAppStore();

  const { activityType, activityMessage, onMutate, onSuccess, onError, ...restOptions } = options;

  return useMutation({
    ...restOptions,
    onMutate: async (variables): Promise<TrackedContext<TContext>> => {
      const message =
        typeof activityMessage === 'function'
          ? activityMessage(variables)
          : activityMessage;

      // Generate ID before adding to ensure we have the correct reference
      const activityId = crypto.randomUUID();

      // Add activity with pre-generated ID
      useAppStore.setState((state) => ({
        activities: [
          {
            id: activityId,
            type: activityType,
            status: 'running' as const,
            message,
            timestamp: Date.now(),
          },
          ...state.activities.slice(0, 49),
        ],
      }));

      // Call original onMutate if provided
      const originalContext = onMutate ? await onMutate(variables) : (undefined as TContext);

      return { __activityId: activityId, __originalContext: originalContext };
    },
    onSuccess: (data, variables, context) => {
      if (context?.__activityId) {
        updateActivity(context.__activityId, { status: 'success' });
      }

      // Call original onSuccess if provided
      if (onSuccess) {
        onSuccess(data, variables, context?.__originalContext);
      }
    },
    onError: (error, variables, context) => {
      if (context?.__activityId) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        updateActivity(context.__activityId, {
          status: 'error',
          message: `${
            typeof activityMessage === 'function'
              ? activityMessage(variables)
              : activityMessage
          } - ${errorMessage}`,
        });
      }

      // Call original onError if provided
      if (onError) {
        onError(error, variables, context?.__originalContext);
      }
    },
  });
}
