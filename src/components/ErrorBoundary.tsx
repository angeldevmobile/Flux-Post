import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { trackCrash } from "@/lib/analytics";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    trackCrash(`${error.message}\n${info.componentStack ?? ""}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="flex items-center justify-center w-full h-full"
        style={{ background: "#0A0A0A" }}
      >
        <div
          className="flex flex-col items-center gap-4 max-w-[420px] w-full mx-4 p-6 rounded-xl text-center"
          style={{ background: "#111111", border: "1px solid #27272A" }}
        >
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 48, height: 48, background: "#EF444415", border: "1px solid #EF444430" }}
          >
            <span style={{ fontSize: 22 }}>⚠</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold text-white">Something went wrong</span>
            <span className="text-[12px]" style={{ color: "#71717A" }}>
              An unexpected error occurred. Reload the app to continue.
            </span>
          </div>
          <div
            className="w-full px-3 py-2 rounded-lg text-left font-mono text-[11px] break-all"
            style={{ background: "#0A0A0A", border: "1px solid #27272A", color: "#A1A1AA" }}
          >
            {error.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ height: 36, background: "#A855F7" }}
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
