import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FirstAidKit, ArrowClockwise } from "@phosphor-icons/react";

import { Button } from "@/components/ui";

/**
 * ErrorBoundary — a class-based boundary that catches render/lifecycle errors
 * in the routed content and shows a friendly medkit recovery card instead of a
 * blank white screen.
 *
 * It sits INSIDE the app shell (see App.tsx) so the top nav and footer survive a
 * crash — only the content region is replaced. React requires an actual class
 * for `getDerivedStateFromError` / `componentDidCatch`; the fallback card itself
 * is a function component so it can pull localized copy from i18n.
 *
 * Air-gapped: errors are logged to the console in dev only. No remote reporting.
 */

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error", error, info);
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return <RecoveryCard onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}

/** The medkit recovery card shown after a crash. Reload is the recovery path. */
function RecoveryCard({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className="grid min-h-[60vh] place-items-center px-4 py-16"
    >
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-8 text-center shadow-soft">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-control bg-brand-tint text-brand">
          <FirstAidKit weight="bold" className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-fg">
          {t("status.boundary.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t("status.boundary.body")}
        </p>
        <div className="mt-6 flex justify-center">
          <Button
            onClick={onReload}
            leadingIcon={
              <ArrowClockwise
                weight="bold"
                className="h-4 w-4"
                aria-hidden="true"
              />
            }
          >
            {t("status.boundary.reload")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;
