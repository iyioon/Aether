import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The recovery screen intentionally avoids logging private library state.
  }

  override render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="boot-screen">
        <div className="w-full max-w-[420px]">
          <Alert variant="destructive" role="alert">
            <CircleAlert />
            <AlertTitle>Aether could not open this view</AlertTitle>
            <AlertDescription>
              The app may have been updated while it was open. Reload to use the
              latest version.
            </AlertDescription>
          </Alert>
          <Button
            className="mt-4 w-full"
            size="lg"
            type="button"
            onClick={() => window.location.reload()}
          >
            <RefreshCw data-icon="inline-start" />
            Reload Aether
          </Button>
        </div>
      </main>
    );
  }
}
