import { ErrorBoundary } from "@repo/ui/error-boundary";
import { type ComponentType, createElement, type ReactPromise } from "react";

export interface LazyRoute<P> {
  readonly Route: ComponentType<P>;
  readonly prefetch: () => void;
}

function reloadDocument(): void {
  location.reload();
}

export function lazyRoute<P extends object>(
  load: () => Promise<ComponentType<P>>,
  reload: () => void = reloadDocument,
): LazyRoute<P> {
  let loading: ReactPromise<ComponentType<P>> | undefined;
  const imported = (): ReactPromise<ComponentType<P>> => {
    if (loading !== undefined) return loading;
    const started = load();
    started.then(
      (value) => {
        Object.assign(started, { status: "fulfilled", value });
      },
      (reason) => {
        Object.assign(started, { status: "rejected", reason });
      },
    );
    loading = Object.assign(started, { status: "pending" as const });
    return loading;
  };
  const reloadFailed = (): void => {
    if (loading?.status === "rejected") reload();
  };
  const Imported = (props: P): React.JSX.Element => {
    const module = imported();
    if (module.status === "fulfilled") return createElement(module.value, props);
    if (module.status === "rejected") throw module.reason;
    throw module;
  };
  const Route = (props: P): React.JSX.Element =>
    createElement(ErrorBoundary, { onReload: reloadFailed }, createElement(Imported, props));
  return {
    Route,
    prefetch: () => {
      imported();
    },
  };
}
