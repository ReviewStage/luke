import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { LINEAR_PATH } from "@sidecar/surface";

/**
 * integration-marks.tsx -- each integration's own mark, traced from the path data `@sidecar/surface` generates.
 *
 * Brand marks, not glyphs of ours, each drawn in `currentColor` the way the
 * GitHub mark is, so it reads in the ink of whatever row it stands in. The
 * web's landing page traces the same paths in its own React, as the account
 * marks are traced twice.
 */
export function IntegrationMark({
  provider,
  className = "provider-mark integration-mark",
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
