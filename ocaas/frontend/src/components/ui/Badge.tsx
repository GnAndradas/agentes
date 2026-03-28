import { clsx } from 'clsx';

interface BadgeProps {
  variant?: 'default' | 'active' | 'inactive' | 'pending' | 'error' | 'success';
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  const variants = {
    default: 'bg-dark-700 text-dark-200',
    active: 'bg-green-500/20 text-green-400',
    inactive: 'bg-dark-500/20 text-dark-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    error: 'bg-red-500/20 text-red-400',
    success: 'bg-green-500/20 text-green-400',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
