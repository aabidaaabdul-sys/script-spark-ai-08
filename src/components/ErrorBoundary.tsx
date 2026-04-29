import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : "Unexpected error.",
    };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ hasError: false, message: undefined });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="max-w-md space-y-4 text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-primary shadow-glow" />
            <h2 className="font-display text-2xl">Something glitched</h2>
            <p className="text-sm text-muted-foreground">
              {this.state.message ?? "The interface hit a snag, but your work is safe."}
            </p>
            <div className="flex justify-center gap-2">
              <button
                onClick={this.reset}
                className="rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
