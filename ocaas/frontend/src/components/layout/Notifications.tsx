import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../stores/app';

const icons = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

const styles = {
  info: 'bg-primary-900/80 border-primary-700 text-primary-200',
  success: 'bg-green-900/80 border-green-700 text-green-200',
  warning: 'bg-yellow-900/80 border-yellow-700 text-yellow-200',
  error: 'bg-red-900/80 border-red-700 text-red-200',
};

export function Notifications() {
  const { notifications, removeNotification } = useAppStore();

  useEffect(() => {
    // Auto-dismiss notifications after 5 seconds
    const timers = notifications.map((notification) =>
      setTimeout(() => {
        removeNotification(notification.id);
      }, 5000)
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [notifications, removeNotification]);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map((notification) => {
        const Icon = icons[notification.type];

        return (
          <div
            key={notification.id}
            className={clsx(
              'flex items-start gap-3 p-4 rounded-lg border backdrop-blur-sm shadow-lg',
              styles[notification.type]
            )}
          >
            <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">{notification.title}</p>
              {notification.message && (
                <p className="text-sm opacity-80 mt-0.5">{notification.message}</p>
              )}
            </div>
            <button
              onClick={() => removeNotification(notification.id)}
              className="p-1 rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
