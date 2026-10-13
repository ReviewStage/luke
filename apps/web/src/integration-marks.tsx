import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { LINEAR_PATH } from "@sidecar/surface";

/**
 * integration-marks.tsx -- each integration's own mark, traced from the path data `@sidecar/surface` generates.
 *
 * Brand marks, not glyphs of ours, drawn on `currentColor` the way the GitHub
 * mark is on a dark ground. The desktop's Settings rows trace the same paths
 * in their own React.
 */

/** One provider's mark, at whatever size the caller's class gives it. */
export function IntegrationMark({
  provider,
  className,
}: {
  provider: IntegrationProvider;
  className?: string;
}): React.JSX.Element {
  switch (provider) {
    case INTEGRATION_PROVIDER.LINEAR:
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d={LINEAR_PATH} />
        </svg>
      );
  }
}
