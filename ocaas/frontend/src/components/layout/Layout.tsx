import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Notifications } from './Notifications';
import { StatusBar } from './StatusBar';
import { GatewayMonitor } from './GatewayMonitor';
import { socketClient } from '../../lib/socket';
import { useAppStore } from '../../stores/app';

export function Layout() {
  const { setConnected, sidebarCollapsed } = useAppStore();

  useEffect(() => {
    socketClient.connect();

    // Check connection status periodically and subscribe when connected
    const checkConnection = setInterval(() => {
      const connected = socketClient.isConnected();
      setConnected(connected);
      if (connected) {
        socketClient.subscribe(['agents', 'tasks', 'generations', 'system']);
        clearInterval(checkConnection);
      }
    }, 100);

    return () => {
      clearInterval(checkConnection);
      socketClient.disconnect();
      setConnected(false);
    };
  }, [setConnected]);

  return (
    <div className="flex h-screen bg-dark-950">
      <Sidebar />
      <div
        className={`flex-1 flex flex-col transition-all duration-300 ${
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        <StatusBar />
      </div>
      <Notifications />
      <GatewayMonitor />
    </div>
  );
}
