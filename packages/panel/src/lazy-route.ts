import { ErrorBoundary } from "@luke/ui/error-boundary";
import { type ComponentType, createElement, type ReactPromise } from "react";

/**
 * lazy-route.ts -- a surface split off the bundle every window parses, imported the first time it is drawn, or earlier where the pointer says it is about to be.
 *
 * A window parses its whole entry as it opens, so a
 * page most launches never open, a plan's version history, a
 * person's page, or a side panel's Pull request tab, is a chunk of its own,
 * drawn through `Route` under a `Suspense` whose fallback is the page's own
 * frame. `prefetch` starts the same import from a hover or a hint of intent,
 * so the press that follows finds the chunk landed; the import is shared, so
 * the chunk is read once whichever asks first. An import that failed is
 * thrown to the error boundary `Route` stands in (`@luke/ui`'s
 * `ErrorBoundary`), which says so with Reload in the surface's place, and
 * the rest of the window stands.
 *
 * Note that `Route` reads the import as `lazy` does, suspending on it while
 * it is out, but draws at once from an import already landed, where `lazy`
 * suspends once more on it and shows its fallback for a frame; the import
 * is marked settled as React marks a thenable it reads, before React hears
 * of it, so the draw React retries on finds it settled.
 *
 * Note too that a failed import is not kept, as `lazy` keeps one, because a
 * chunk that failed once on a dropped connection is most often there the
 * next time: Reload, or a prefetch, starts it again. A draw does not,
 * because React draws a failed surface more than once before it hands the
 * failure to the boundary, and each draw would start a read that could fail
 * in turn.
 */

/** A drawn surface reached through a dynamic import, and the door that starts that import early. */
export interface LazyRoute<P> {
  readonly Route: ComponentType<P>;
  readonly prefetch: () => void;
}

/** The surface `load` answers, imported once whether its draw or a prefetch asks first, and again after it failed. */
export function lazyRoute<P extends object>(load: () => Promise<ComponentType<P>>): LazyRoute<P> {
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
  // A failed import is let go of, so the next to ask starts it again.
  const forgetFailed = (): void => {
    if (loading?.status === "rejected") loading = undefined;
  };
  const Imported = (props: P): React.JSX.Element => {
    const module = imported();
    if (module.status === "fulfilled") return createElement(module.value, props);
    if (module.status === "rejected") throw module.reason;
    throw module;
  };
  const Route = (props: P): React.JSX.Element =>
    createElement(ErrorBoundary, { onReload: forgetFailed }, createElement(Imported, props));
  return {
    Route,
    prefetch: () => {
      forgetFailed();
      imported();
    },
  };
}
