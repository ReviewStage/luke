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
 * thrown to the error boundary above the route, as `lazy`'s is.
 *
 * Note that `Route` reads the import as `lazy` does, suspending on it while
 * it is out, but draws at once from an import already landed, where `lazy`
 * suspends once more on it and shows its fallback for a frame; the import
 * is marked settled as React marks a thenable it reads, before React hears
 * of it, so the draw React retries on finds it settled.
 */

/** A drawn surface reached through a dynamic import, and the door that starts that import early. */
export interface LazyRoute<P> {
  readonly Route: ComponentType<P>;
  readonly prefetch: () => void;
}

/** The surface `load` answers, imported once whether its draw or a prefetch asks first. */
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
  const Route = (props: P): React.JSX.Element => {
    const module = imported();
    if (module.status === "fulfilled") return createElement(module.value, props);
    if (module.status === "rejected") throw module.reason;
    throw module;
  };
  return {
    Route,
    prefetch: () => {
      imported();
    },
  };
}
