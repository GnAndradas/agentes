/**
 * PanelErrorBoundary
 *
 * Catches errors in individual panels without crashing the entire page.
 * Shows a fallback UI when a panel throws an error.
 */

import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  panelName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[PanelErrorBoundary] ${this.props.panelName || 'Panel'} crashed:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-4 bg-red-900/10 border border-red-800/30 rounded-lg min-h-[80px]">
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-xs font-medium">
              {this.props.panelName || 'Panel'} error
            </span>
          </div>
          <p className="text-[10px] text-dark-500 text-center mb-2 max-w-[200px]">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-dark-400 hover:text-white bg-dark-800 hover:bg-dark-700 rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
