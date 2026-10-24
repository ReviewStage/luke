/**
 * error-boundary.tsx -- a place whose drawing failed says so, with Reload, rather than leaving the window blank.
 *
 * A render that throws, or a chunk of code that could not be read, takes
 * down everything up to the nearest boundary above it, and with none, the
 * whole window, which React then leaves empty. So every window's root and
 * every surface drawn on demand (`@luke/panel`'s `lazyRoute`) stands under
 * one of these: what failed beneath it is replaced by the centred
 * `ErrorState`, its sentence and Reload, and the rest of the window keeps
 * going. Reload runs `onReload` where one is given, the window's own reload
 * at a root or a route's forgetting of its failed chunk, and then draws the
 * place again.
 *
 * A window whose first read failed has no surface to stand a boundary
 * over, so it draws what a boundary would have, `ReloadState`, alone.
 *
 * Note that it reports nothing itself, because the root it stands in hears
 * every error a boundary caught (`createRoot`'s `onCaughtError`), the one
 * place that knows where a window reports to. Note too that it is a door of
 * its own (`@luke/ui/error-boundary`), outside the barrel, because every
 * window's root draws it, the hidden voice window's among them, which would
 * otherwise parse the whole barrel on its way to its first paint.
 */

import { Component, type ReactNode } from "react";
import { ERROR_STATE_PLACEMENT, ErrorState } from "../error-state/error-state.js";

/** What a place whose drawing failed says where its caller names nothing more fitting. */
const SHOWN_FAILED = "This could not be shown.";

/**
 * What a place whose drawing failed stands in its stead: the centred
 * `failure`, or the boundary's own sentence, and Reload, whose press is
 * `onReload`.
 */
export function ReloadState({
  failure = SHOWN_FAILED,
  onReload,
}: {
  failure?: string | undefined;
  onReload: () => void;
}): React.JSX.Element {
  return (
    <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onReload={onReload}>
      {failure}
    </ErrorState>
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
 * centred `failure` with Reload, which runs `onReload` and draws them again.
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
