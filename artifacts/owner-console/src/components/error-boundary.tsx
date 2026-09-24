import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ resetError }: ErrorFallbackProps) {
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[#f4efe5] p-6">
      <div className="w-full max-w-lg rounded-xl border border-[#d9d0c1] bg-[#fbf8f1] p-8 text-center shadow-[0_12px_30px_rgba(38,43,58,.08)]">
        <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#b85c2c]">Console safeguard</div>
        <h1 className="mt-3 font-display text-3xl text-[#262b3a]">
          This view needs a reset.
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#687080]">
          The console kept production safe, but this view could not finish loading. Try again without exposing any internal details.
        </p>
        <button
          type="button"
          onClick={resetError}
          className="mt-6 rounded-lg bg-[#262b3a] px-4 py-2.5 text-sm font-semibold text-[#fbf8f1] hover:bg-[#30394d]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
