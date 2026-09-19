import { Component, ErrorInfo, Fragment, ReactNode } from 'react';
import { Card, Button, Badge } from '..';
import { AlertCircleIcon, RefreshIcon, HomeIcon } from '../../assets/icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  /** Bumped by Reset View: remounts the subtree so the failed render starts from scratch */
  resetKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    resetKey: 0,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in UI component:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    // Clearing the flag alone re-renders the same element tree, which throws
    // again on the spot; the key bump discards the broken subtree's state too
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      resetKey: prev.resetKey + 1,
    }));
    this.props.onReset?.();
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            padding: '32px 20px',
            maxWidth: '640px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <Card
            title="Something went wrong"
            subtitle="An unexpected render error occurred in this view"
            icon={<AlertCircleIcon size={22} className="ui-toast-icon danger" />}
            action={<Badge variant="danger">Render Exception</Badge>}
          >
            <p className="setting-description">
              The application encountered an unhandled exception. You can reload the window or return to recover.
            </p>

            {this.state.error && (
              <div
                style={{
                  backgroundColor: 'var(--bg-app)',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.857rem',
                  color: 'var(--danger)',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.error.toString()}
              </div>
            )}

            {this.state.errorInfo?.componentStack && (
              <details style={{ fontSize: '0.857rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  Component stack
                </summary>
                <pre
                  style={{
                    margin: '8px 0 0',
                    maxHeight: '220px',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.786rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {this.state.errorInfo.componentStack.trim()}
                </pre>
              </details>
            )}

            <Card.Footer>
              <Button
                size="sm"
                variant="secondary"
                icon={<HomeIcon size={14} />}
                onClick={this.handleReset}
              >
                Reset View
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<RefreshIcon size={14} />}
                onClick={this.handleReload}
              >
                Reload Window
              </Button>
            </Card.Footer>
          </Card>
        </div>
      );
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
