// A failure in one region of the app stays in that region: the rest keeps working, and the writer is told their work is safe.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../store/store';
import { exportVaultZip } from './io';
import './crash.css';

interface Props {
  /** What failed, for the message: "document", "quick panel", "timeline", "side panel". */
  label: string;
  /** A change of key (say, opening another document) clears the error and tries again. */
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: string | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`The ${this.props.label} failed`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashPanel label={this.props.label} error={error} retry={() => this.setState({ error: null })} />;
  }
}

function CrashPanel({ label, error, retry }: { label: string; error: Error; retry: () => void }) {
  const saveStatus = useStore((s) => s.saveStatus);
  const saved = saveStatus === 'saved' ? 'Everything you wrote is saved in this browser.' : saveStatus === 'saving' ? 'Your latest changes are being saved.' : 'The last save failed, so back up now.';
  return (
    <div className="crash" role="alert" data-testid="crash-panel">
      <strong>Something went wrong in the {label}.</strong>
      <p>
        Your writing is not lost. {saved} The rest of the app still works.
      </p>
      <div className="crash-actions">
        <button className="btn btn-sm" onClick={retry} data-testid="crash-retry">
          Try again
        </button>
        <button className="btn btn-sm" onClick={() => void exportVaultZip()}>
          Back up now
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void navigator.clipboard?.writeText(`${error.name}: ${error.message}\n${error.stack ?? ''}`)}>
          Copy details
        </button>
      </div>
      <pre className="crash-detail">{error.message}</pre>
    </div>
  );
}
