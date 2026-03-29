import { useMutation, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';
import { useAppStore, type StatusActivity } from '../stores/app';

type ActivityType = StatusActivity['type'];

interface TrackedMutationOptions<TData, TError, TVariables, TContext>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'onMutate' | 'onSuccess' | 'onError'> {
  activityType: ActivityType;
  activityMessage: string | ((variables: TVariables) => string);
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => void;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => void;
}

// Internal storage for activity IDs (keyed by mutation instance)
const activityIds = new WeakMap<object, string>();

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
): UseMutationResult<TData, TError, TVariables, TContext> {
  const { updateActivity } = useAppStore();

  const { activityType, activityMessage, onMutate, onSuccess, onError, ...restOptions } = options;

  // Create a stable reference for tracking
  const trackingRef = {};

  return useMutation({
    ...restOptions,
    onMutate: async (variables) => {
      const message =
        typeof activityMessage === 'function'
          ? activityMessage(variables)
          : activityMessage;

      const activityId = crypto.randomUUID();
      activityIds.set(trackingRef, activityId);

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
      return (onMutate ? await onMutate(variables) : undefined) as TContext;
    },
    onSuccess: (data, variables, context) => {
      const activityId = activityIds.get(trackingRef);
      if (activityId) {
        updateActivity(activityId, { status: 'success' });
      }

      if (onSuccess) {
        onSuccess(data, variables, context);
      }
    },
    onError: (error, variables, context) => {
      const activityId = activityIds.get(trackingRef);
      if (activityId) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        updateActivity(activityId, {
          status: 'error',
          message: `${
            typeof activityMessage === 'function'
              ? activityMessage(variables)
              : activityMessage
          } - ${errorMessage}`,
        });
      }

      if (onError) {
        onError(error, variables, context);
      }
    },
  });
}
