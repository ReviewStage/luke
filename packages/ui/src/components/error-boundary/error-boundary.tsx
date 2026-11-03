/**
 * error-boundary.tsx -- a place whose drawing failed says so, with Reload, rather than leaving the window blank.
 *
 * A render that throws, or a chunk of code that could not be read, takes
 * down everything up to the nearest boundary above it, and with none, the
 * whole window, which React then leaves empty. So every window's root and
 * every surface drawn on demand (`@repo/panel`'s `lazyRoute`) stands under
 * one of these: what failed beneath it is replaced by `ReloadState`, its
 * sentence and Reload, and the rest of the window keeps going. Reload runs
 * `onReload` where one is given, the window's own reload at a root or a
 * route's forgetting of its failed chunk, and then draws the place again.
 *
 * A window whose first read failed has no surface to stand a boundary
 * over, so it draws what a boundary would have, `ReloadState`, alone.
 *
 * `ReloadState` is the product's own, and says little: the mark, faint,
 * over the sentence as the place's heading and Reload as its one primary
 * press, because a place that failed to draw is most often mended by the
 * next draw, and an alert glyph over a quiet line reads as something broken
 * for good. It stands as an empty state does (`EmptyState`), a little above
 * the middle of the room it fills.
 *
 * Note that it reports nothing itself, because the root it stands in hears
 * every error a boundary caught (`createRoot`'s `onCaughtError`), the one
 * place that knows where a window reports to. Note too that it is a door of
 * its own (`@repo/ui/error-boundary`), outside the barrel, because every
 * window's root draws it, which would otherwise parse the whole barrel on its
 * way to its first paint.
 */

import { Component, type ReactNode } from "react";
import { ProductMark } from "../../marks/product-mark.js";
import { EMPTY_STATE_ACTION_LOOK, EmptyState } from "../empty-state/empty-state.js";

/** What a place whose drawing failed says where its caller names nothing more fitting. */
const SHOWN_FAILED = "This page could not be shown.";

/** Reload's words. */
const RELOAD = "Reload";

/**
 * What a place whose drawing failed stands in its stead: the faint mark over
 * `failure`, or the boundary's own sentence, as one alert with Reload, whose
 * press is `onReload`.
 */
export function ReloadState({
  failure = SHOWN_FAILED,
  onReload,
}: {
  failure?: string | undefined;
  onReload: () => void;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={<ProductMark inherit />}
      title={failure}
      alert
      action={{ label: RELOAD, look: EMPTY_STATE_ACTION_LOOK.PRIMARY, onClick: onReload }}
    />
  );
}

interface ErrorBoundaryProps {
  /** What failed, as "This window could not be shown." */
  readonly failure?: string | undefined;
  /** What Reload does before the place is drawn again; nothing more where none is given. */
  readonly onReload?: (() => void) | undefined;
  readonly children?: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Draws `children`, or, once one of them has thrown while drawing, the
 * centered `failure` with Reload, which runs `onReload` and draws them again.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  reload = (): void => {
    this.props.onReload?.();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <ReloadState failure={this.props.failure} onReload={this.reload} />;
  }
}
