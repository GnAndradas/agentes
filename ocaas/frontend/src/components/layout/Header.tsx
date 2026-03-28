import { useLocation } from 'react-router-dom';
import { Bell, Wifi, WifiOff } from 'lucide-react';
import { useAppStore } from '../../stores/app';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/agents': 'Agents',
  '/tasks': 'Tasks',
  '/skills': 'Skills',
  '/tools': 'Tools',
  '/generator': 'Generator',
  '/generations': 'Generations',
  '/settings': 'Settings',
};

export function Header() {
  const location = useLocation();
  const { connected, notifications } = useAppStore();

  const basePath = '/' + location.pathname.split('/')[1];
  const title = pageTitles[basePath] || 'OCAAS';

  const unreadCount = notifications.length;

  return (
    <header className="h-16 bg-dark-900 border-b border-dark-700 flex items-center justify-between px-6">
      <h1 className="text-xl font-semibold">{title}</h1>

      <div className="flex items-center gap-4">
        <div
          className={`flex items-center gap-2 text-sm ${
            connected ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {connected ? (
            <>
              <Wifi className="w-4 h-4" />
              <span>Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4" />
              <span>Disconnected</span>
            </>
          )}
        </div>

        <button className="relative p-2 rounded-lg hover:bg-dark-800 transition-colors">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
